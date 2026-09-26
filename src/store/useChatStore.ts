import React from "react";
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { isResponsesEndpoint } from "../utils/responses";
import type {
  Conversation,
  Message,
  ModelConfig,
  GenerationState,
  TitleGenerationConfig,
  SearchApiConfig,
  McpTool,
  McpToolResult,
  Attachment,
} from "../types";
import { isGenerationActive } from "../types";
import {
  loadModelConfigs,
  loadConversations,
  saveConversations,
  loadTheme,
  loadApiKeys,
  loadSearchConfigs,
  loadFetchConfigs,
  loadSearchApiKeys,
  clearConversations,
  loadTitleConfig,
  loadMcpConfigs,
  loadMcpEnvSecrets,
  loadMcpApiKeys,
  loadEnabledMcpServers,
  loadHasStarted,
  loadAnimationsDisabled,
  loadAlwaysOnTop,
  loadCloseToTray,
  loadLaunchOnStartup,
  loadSendMessageShortcut,
  loadClearInputOnEscape,
  loadBaseTextSize,
  loadAutoUpdateChecking,
  loadSystemPrompt,
  loadAutoGenerateMemory,
  loadShowContextWindow,
  loadContextTokenizationMode,
  loadMaxToolSteps,
  loadUnlimitedToolSteps,
  loadIsLoggingEnabled,
  loadDisableBgActivity,
  loadNetworkSettings,
  loadLanguage,
  loadSelectedModel,
  saveSelectedModel,
  loadUiLayoutSettings,
  suspendPersistenceForRecovery,
  verifyEncryptedPreferences,
} from "../utils/storage";
import { generateId } from "../utils/generateId";
import { attachWorkspaceChangesToLatestAssistant, removeWorkspaceChangesByUndoToken } from "../utils/workspaceChanges";
import { logError, logInfo, logWarn } from "../utils/logger";
import {
  DEFAULT_AUX_PANEL_WIDTH,
  MAX_AUX_PANEL_WIDTH,
  MIN_AUX_PANEL_WIDTH,
  DEFAULT_MAX_TOOL_STEPS,
  TITLE_MAX_LENGTH,
} from "../config/constants";
import { parseApiError } from "../utils/parseApiError";
import { elapsedSeconds } from "../utils/duration";
import {
  cancelConversationGenerationQueue,
  buildConversationContextMessages,
  enqueueConversationGeneration,
  sendWithToolLoop,
  waitForConversationToolLoops,
} from "../services/toolLoop";
import {
  buildConversationRunContext,
  continueConversationRunContext,
  withToolStepBudget,
  type ConversationRunContext,
  type ToolStepBudget,
} from "../services/conversationRunContext";
import { useSkillStore } from "./useSkillStore";
import { assembleContext, formatContextDisclosure } from "../services/contextAssembler";
import { validateFile } from "../utils/attachments";
import {
  uiToast,
  uiLoading,
  uiConfigLoaded,
  uiHasStarted,
  uiLaunchReady,
  uiTheme,
  uiSidebarOpen,
  uiView,
  uiCloseRenameModal,
  modelCancelStream,
  modelStopHealthCheck,
  modelReleaseListeners,
  modelCheckConnections,
  modelStartHealthCheck,
  modelSetState,
  searchSetState,
  searchPerformSearch,
  searchFetchUrlContent,
  searchCheckConnections,
  searchStartConnectionChecks,
  searchStopConnectionChecks,
  mcpSetState,
} from "./helpers";
import { useModelStore } from "./useModelStore";
import { useSearchStore } from "./useSearchStore";
import { useMcpStore } from "./useMcpStore";
import { useUIStore } from "./useUIStore";
import { useProjectStore } from "./useProjectStore";
import { useGitStore } from "./useGitStore";
import { DEFAULT_THEME_CONFIG } from "../config/themePresets";
import { collectConversationTreeIds, reduceConversationDeletion } from "./conversationLifecycle";
import { parseGitDiff } from "../utils/gitDiff";

const processingTokens = new Set<string>();
const DELETION_SHUTDOWN_TIMEOUT_MS = 2_000;
const CANCELLED_ASSISTANT_MESSAGE = "Cancelled agent execution.";
let conversationDeletionTail: Promise<void> = Promise.resolve();
const activeNormalRuns = new Map<string, Set<Promise<void>>>();
const activeWorktreePublications = new Map<string, Promise<boolean>>();
const projectWorktreePublicationTails = new Map<string, Promise<void>>();

interface PublishWorktreeOptions {
  automatic?: boolean;
}

interface WorktreePublicationResult {
  changedPaths: string[];
  undoToken?: string;
}

async function serializeProjectWorktreePublication<T>(projectId: string, task: () => Promise<T>): Promise<T> {
  const previous = projectWorktreePublicationTails.get(projectId) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => turn);
  projectWorktreePublicationTails.set(projectId, tail);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (projectWorktreePublicationTails.get(projectId) === tail) projectWorktreePublicationTails.delete(projectId);
  }
}

interface ConversationDeletionOptions {
  preferredActiveId?: string | null;
  appendPreferredToHistory?: boolean;
  persist?: boolean;
}

export type SendMessageStatus = "accepted" | "rejected";

async function awaitBoundedShutdown(tasks: Promise<unknown>[], label: string): Promise<boolean> {
  if (tasks.length === 0) return true;
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timeoutId = globalThis.setTimeout(() => resolve("timeout"), DELETION_SHUTDOWN_TIMEOUT_MS);
  });
  const result = await Promise.race([Promise.allSettled(tasks), timeout]);
  if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
  if (result === "timeout") {
    logWarn("chat", `${label} exceeded the bounded deletion shutdown window`, {
      details: `${DELETION_SHUTDOWN_TIMEOUT_MS}ms`,
    });
    return false;
  }
  return result.every((settlement) => settlement.status === "fulfilled" && settlement.value !== false);
}

function truncateTitle(text: string): string {
  return text.length > TITLE_MAX_LENGTH ? text.slice(0, TITLE_MAX_LENGTH) + "\u2026" : text;
}

function resolveModelConfig(models: ModelConfig[], preferredId?: string): ModelConfig | undefined {
  return (
    models.find((model) => model.id === preferredId && model.enabled !== false) ??
    models.find((model) => model.enabled !== false)
  );
}

function updateConversationMessages(
  conversations: Conversation[],
  convId: string,
  updater: (msgs: Message[]) => Message[],
  extra?: Partial<Conversation>,
): Conversation[] {
  return conversations.map((c) => {
    if (c.id !== convId) return c;
    return { ...c, messages: updater(c.messages), timestamp: new Date(), ...extra };
  });
}

function finalizeAssistantMessage(
  conversations: Conversation[],
  convId: string,
  thinkingDuration?: number,
): Conversation[] {
  return updateConversationMessages(conversations, convId, (msgs) => {
    const updated = [...msgs];
    const lastAssistantIdx = [...updated].reverse().findIndex((m) => m.role === "assistant");
    if (lastAssistantIdx >= 0) {
      const idx = updated.length - 1 - lastAssistantIdx;
      const last = updated[idx];
      if (last.isStreaming) {
        updated[idx] = {
          ...last,
          isStreaming: false,
          thinkingDuration: last.thinkingDuration ?? thinkingDuration,
        };
      }
    }
    return updated;
  });
}

function setAssistantError(conversations: Conversation[], convId: string, err: unknown): Conversation[] {
  const parsed = parseApiError(err);
  return updateConversationMessages(conversations, convId, (msgs) => {
    const updated = [...msgs];
    const lastAssistantIdx = [...updated].reverse().findIndex((m) => m.role === "assistant");
    if (lastAssistantIdx >= 0) {
      const idx = updated.length - 1 - lastAssistantIdx;
      const last = updated[idx];
      updated[idx] = { ...last, content: `**Error:** ${parsed.message}`, isStreaming: false };
    }
    return updated;
  });
}

interface EnabledToolLoopConfig {
  searchConfig: SearchApiConfig | undefined;
  searchApiKey: string;
  mcpTools: McpTool[];
  mcpCallTool:
    | ((
        serverId: string,
        toolName: string,
        args: Record<string, string>,
        conversationId: string,
      ) => Promise<McpToolResult>)
    | undefined;
  skills: ReturnType<typeof useSkillStore.getState>["skills"];
}

function getEnabledToolLoopConfig(
  mcpServerIds: readonly string[] = [],
  requestedSearchConfigId?: string | null,
): EnabledToolLoopConfig {
  const { searchConfigs, searchApiKeys } = useSearchStore.getState();
  const searchConfigId = requestedSearchConfigId ?? null;
  const searchConfig = searchConfigId
    ? searchConfigs.find((config) => config.id === searchConfigId && config.enabled)
    : undefined;
  const searchApiKey = searchConfig ? (searchApiKeys[searchConfig.id] ?? searchConfig.apiKey ?? "") : "";

  const mcpTools = useMcpStore.getState().getToolsForServers(mcpServerIds);
  const mcpCallTool =
    mcpTools.length > 0
      ? (serverId: string, toolName: string, args: Record<string, string>, conversationId: string) =>
          useMcpStore.getState().callTool(serverId, toolName, args, conversationId)
      : undefined;

  return {
    searchConfig,
    searchApiKey,
    mcpTools,
    mcpCallTool,
    skills: useSkillStore.getState().skills,
  };
}

function getMessageSearchConfigId(message: Message | undefined): string | null {
  return message?.searchConfigId ?? null;
}

async function prepareReferencedToolLoop(
  mcpServerIds: readonly string[],
  searchConfigId: string | null,
  rejectedAction: string,
): Promise<EnabledToolLoopConfig | null> {
  for (const serverId of mcpServerIds) {
    const mcpState = useMcpStore.getState();
    const config = mcpState.mcpConfigs.find((candidate) => candidate.id === serverId);
    if (!config?.enabled) {
      uiToast(`A referenced MCP server is unavailable. ${rejectedAction}`, "error");
      return null;
    }

    if (!mcpState.enabledServerIds.has(serverId) || mcpState.serverStatuses[serverId] !== "connected") {
      try {
        await mcpState.toggleServerEnabled(serverId, true);
      } catch (error) {
        logError("mcp", `Could not prepare referenced MCP server: "${config.name}"`, { error });
        uiToast(`Could not connect ${config.name}. ${rejectedAction}`, "error");
        return null;
      }
    }
  }

  const toolLoop = getEnabledToolLoopConfig(mcpServerIds, searchConfigId);
  if (searchConfigId && !toolLoop.searchConfig) {
    logWarn("search", "Referenced search provider is unavailable", {
      details: searchConfigId,
      action: "Choose an enabled search provider before trying again.",
    });
    uiToast(`The referenced web-search provider is unavailable. ${rejectedAction}`, "error");
    return null;
  }

  const unresolvedMcpServerIds = mcpServerIds.filter(
    (serverId) => !toolLoop.mcpTools.some((tool) => tool.serverId === serverId),
  );
  if (unresolvedMcpServerIds.length > 0) {
    const unresolvedNames = unresolvedMcpServerIds.map(
      (serverId) => useMcpStore.getState().mcpConfigs.find((config) => config.id === serverId)?.name ?? serverId,
    );
    logWarn("mcp", "Referenced MCP servers did not expose any tools", {
      details: unresolvedNames.join(", "),
      action: "Reconnect the affected MCP server in Settings and verify that it publishes tools.",
    });
    uiToast(`${unresolvedNames.join(", ")} did not provide any tools. ${rejectedAction}`, "error");
    return null;
  }

  return toolLoop;
}

function showMissingModelConfig(message: string) {
  logError("model", message, {
    action: "Go to Settings > Model Providers and add at least one model configuration.",
  });
  uiToast(
    React.createElement(
      "span",
      null,
      "No model configured — add one in ",
      React.createElement(
        "button",
        {
          onClick: () => {
            useUIStore.getState().setView("settings");
            useUIStore.getState().setActiveSection("models");
          },
          className: "text-red-200 underline font-medium hover:text-white transition-colors cursor-pointer",
        },
        "settings/model-providers",
      ),
    ),
    "error",
  );
}

interface ChatState {
  conversations: Conversation[];
  activeId: string | null;
  isStreaming: boolean;
  generationState: GenerationState;
  generationLabel: string;
  generationByConversation: Record<string, { state: GenerationState; label: string }>;
  navigationHistory: string[];
  navigationIndex: number;
  draftAttachments: Attachment[];
  compareIds: string[];
  isCompareMode: boolean;
  activeStreamContent: Record<string, string>;
  activeStreamReasoning: Record<string, string>;
  activeStreamThinkingStart: Record<string, number>;
  activeStreamThinkingEnd: Record<string, number>;
  activeStreamStartTime: Record<string, number>;

  setCompareIds: (ids: string[]) => void;
  setIsCompareMode: (val: boolean) => boolean;

  init: () => Promise<void>;
  cleanupEmptyConversations: (exceptId?: string | null) => Promise<void>;
  setActiveId: (id: string | null, isHistoryMove?: boolean) => Promise<boolean>;
  navigateBack: () => void;
  navigateForward: () => void;
  newChat: () => string;
  newTemporaryChat: () => string;
  newSideChat: () => string | null;
  deleteChat: (id: string) => Promise<boolean>;
  deleteConversationTrees: (rootIds: string[], options?: ConversationDeletionOptions) => Promise<boolean>;
  renameChat: (id: string, newTitle: string) => void;
  togglePinChat: (id: string) => void;
  confirmRename: (newTitle: string) => void;
  sendMessage: (
    text: string,
    attachments?: Attachment[],
    conversationId?: string,
    mcpServerIds?: string[],
    searchConfigId?: string | null,
  ) => Promise<SendMessageStatus>;
  retryLastMessage: (convId: string, messageId?: string) => Promise<void>;
  stopStreaming: (convId?: string, persist?: boolean) => Promise<boolean>;
  exportChat: (id: string) => void | Promise<void>;
  importConversations: (imported: Conversation[]) => Promise<void>;
  persistConversations: () => Promise<void>;
  resumeConversation: (
    convId: string,
    options?: { stepBudget?: ToolStepBudget; runContext?: ConversationRunContext },
  ) => Promise<void>;
  clearAllChats: () => Promise<void>;
  publishPendingWorktree: (convId: string, options?: PublishWorktreeOptions) => Promise<boolean>;
  undoWorkspaceChanges: (convId: string, undoToken?: string) => Promise<boolean>;
  discardPendingWorktree: (convId: string) => Promise<void>;
  cleanup: () => void;
  setGenerationState: (state: GenerationState, label?: string, error?: string) => void;
  setDraftAttachments: (attachments: Attachment[]) => void;
  addDraftFileFromToken: (token: string, name?: string, size?: number) => Promise<void>;
  setConversationProject: (id: string, projectId: string | undefined) => void;
  deleteProjectChats: (projectId: string) => Promise<void>;
}

let initInProgress = false;

async function loadOptionalStartupValue<T>(label: string, loader: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    logWarn("storage", `Optional startup load failed: ${label}`, {
      details: String(error),
      action: "The related preference will use its default for this session.",
    });
    return fallback;
  }
}

function setConversationGeneration(
  state: ChatState,
  convId: string,
  generationState: GenerationState,
  generationLabel: string,
): Record<string, { state: GenerationState; label: string }> {
  if (generationState === "idle") {
    const rest = { ...state.generationByConversation };
    delete rest[convId];
    return rest;
  }
  return {
    ...state.generationByConversation,
    [convId]: { state: generationState, label: generationLabel },
  };
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeId: null,
  isStreaming: false,
  generationState: "idle" as GenerationState,
  generationLabel: "",
  generationByConversation: {},
  navigationHistory: [],
  navigationIndex: -1,
  compareIds: [],
  isCompareMode: false,
  activeStreamContent: {},
  activeStreamReasoning: {},
  activeStreamThinkingStart: {},
  activeStreamThinkingEnd: {},
  activeStreamStartTime: {},

  setCompareIds: (compareIds) => set({ compareIds }),
  setIsCompareMode: (isCompareMode) => {
    set({ isCompareMode });
    return true;
  },

  init: async () => {
    if (initInProgress) return;
    initInProgress = true;
    uiLoading("init", true);
    try {
      const startupVisualsPromise = loadOptionalStartupValue(
        "startup visuals",
        async () => {
          const [theme, storedHasStarted] = await Promise.all([loadTheme(), loadHasStarted()]);
          uiTheme(theme);
          uiLaunchReady(true);
          return { theme, storedHasStarted };
        },
        { theme: DEFAULT_THEME_CONFIG, storedHasStarted: false },
      );

      const [loadedModels, loadedConvs, loadedKeys] = await Promise.all([
        loadModelConfigs(),
        loadConversations(),
        loadApiKeys({ critical: true }),
        verifyEncryptedPreferences(),
        useProjectStore.getState().init(),
      ]);

      const [
        loadedStartupVisuals,
        loadedSearchConfigs,
        loadedFetchConfigs,
        loadedSearchKeys,
        loadedTitleCfg,
        loadedMcpConfigs,
        loadedMcpEnvSecrets,
        loadedMcpKeys,
        loadedMcpEnabledServers,
        loadedAnimationsDisabled,
        loadedAlwaysOnTop,
        loadedCloseToTray,
        loadedLaunchOnStartup,
        loadedSendMessageShortcut,
        loadedClearInputOnEscape,
        loadedBaseTextSize,
        loadedAutoUpdateChecking,
        loadedSystemPrompt,
        loadedAutoGenerateMemory,
        loadedShowContextWindow,
        loadedContextTokenizationMode,
        loadedMaxToolSteps,
        loadedUnlimitedToolSteps,
        loadedIsLoggingEnabled,
        loadedDisableBgActivity,
        loadedNetworkSettings,
        loadedLanguage,
        loadedSelectedModel,
        loadedUiLayout,
      ] = await Promise.all([
        startupVisualsPromise,
        loadOptionalStartupValue("search providers", loadSearchConfigs, null),
        loadOptionalStartupValue("URL fetch providers", loadFetchConfigs, null),
        loadOptionalStartupValue("search credentials", loadSearchApiKeys, {}),
        loadOptionalStartupValue("title generation", loadTitleConfig, {
          enabled: true,
          modelId: "__same__",
          systemPrompt: "",
        }),
        loadOptionalStartupValue("MCP servers", loadMcpConfigs, null),
        loadOptionalStartupValue("MCP environment secrets", loadMcpEnvSecrets, {}),
        loadOptionalStartupValue("MCP credentials", loadMcpApiKeys, {}),
        loadOptionalStartupValue("enabled MCP servers", loadEnabledMcpServers, []),
        loadOptionalStartupValue("animation preference", loadAnimationsDisabled, false),
        loadOptionalStartupValue("always-on-top preference", loadAlwaysOnTop, false),
        loadOptionalStartupValue("close-to-tray preference", loadCloseToTray, false),
        loadOptionalStartupValue("launch-on-startup preference", loadLaunchOnStartup, false),
        loadOptionalStartupValue("send shortcut", loadSendMessageShortcut, "enter" as const),
        loadOptionalStartupValue("clear-input preference", loadClearInputOnEscape, false),
        loadOptionalStartupValue("text size", loadBaseTextSize, "medium" as const),
        loadOptionalStartupValue("update preference", loadAutoUpdateChecking, true),
        loadOptionalStartupValue("system prompt", loadSystemPrompt, ""),
        loadOptionalStartupValue("auto-generate memory preference", loadAutoGenerateMemory, false),
        loadOptionalStartupValue("context-window preference", loadShowContextWindow, false),
        loadOptionalStartupValue("context-tokenization preference", loadContextTokenizationMode, "local" as const),
        loadOptionalStartupValue("tool-step preference", loadMaxToolSteps, DEFAULT_MAX_TOOL_STEPS),
        loadOptionalStartupValue("unlimited tool steps preference", loadUnlimitedToolSteps, false),
        loadOptionalStartupValue("logging preference", loadIsLoggingEnabled, true),
        loadOptionalStartupValue("background-activity preference", loadDisableBgActivity, false),
        loadOptionalStartupValue("network policy", loadNetworkSettings, {
          blockedHosts: [],
          allowedLocalEndpoints: [],
          offlineMode: true,
        }),
        loadOptionalStartupValue("language", loadLanguage, "en"),
        loadOptionalStartupValue("selected model", loadSelectedModel, ""),
        loadOptionalStartupValue("window layout", loadUiLayoutSettings, {}),
      ]);

      const { theme: loadedTheme, storedHasStarted } = loadedStartupVisuals;
      const models = loadedModels || [];
      const modelsWithKeys = models.map((m) => ({
        ...m,
        apiKey: loadedKeys[m.id] ?? m.apiKey,
      }));

      const hasOnboarded = storedHasStarted || modelsWithKeys.length > 0;

      if (!hasOnboarded) {
        localStorage.clear();
      }

      const nonEmptyConvs = hasOnboarded ? (loadedConvs || []).filter((c) => c.messages.length > 0) : [];
      const cleanedConvs = nonEmptyConvs.map((c) => {
        const hasRunningStatus = c.status === "running";
        const hasStreamingMsg = c.messages.some((m) => m.isStreaming);
        if (hasRunningStatus || hasStreamingMsg) {
          const nextMessages = c.messages.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m));
          return {
            ...c,
            status: c.isSubagent ? ("stopped" as const) : c.status === "running" ? ("completed" as const) : c.status,
            messages: nextMessages,
          };
        }
        return c;
      });
      const conversationsNeedRepair = cleanedConvs.some((conversation, index) => conversation !== nonEmptyConvs[index]);
      const searchConfigs = loadedSearchConfigs || [];
      const fetchConfigs = loadedFetchConfigs || [];
      const selectedModel =
        modelsWithKeys.find((model) => model.id === loadedSelectedModel && model.enabled !== false)?.id ??
        modelsWithKeys.find((model) => model.id === cleanedConvs[0]?.model && model.enabled !== false)?.id ??
        modelsWithKeys.find((model) => model.enabled !== false)?.id ??
        "";

      modelSetState({
        models: modelsWithKeys,
        selectedModel,
        apiKeys: loadedKeys,
        modelStatuses: {},
        titleConfig: loadedTitleCfg,
        systemPrompt: loadedSystemPrompt,
        autoGenerateMemory: loadedAutoGenerateMemory,
        maxToolSteps: loadedMaxToolSteps,
        unlimitedToolSteps: loadedUnlimitedToolSteps,
      });
      if (selectedModel !== loadedSelectedModel) {
        void saveSelectedModel(selectedModel);
      }

      searchSetState({
        searchConfigs,
        activeSearchId: searchConfigs.find((c) => c.enabled)?.id ?? null,
        searchStatuses: Object.fromEntries(searchConfigs.map((config) => [config.id, "disconnected" as const])),
        fetchConfigs,
        activeFetchId: fetchConfigs.find((c) => c.enabled)?.id ?? null,
        fetchStatuses: Object.fromEntries(fetchConfigs.map((config) => [config.id, "disconnected" as const])),
        searchApiKeys: loadedSearchKeys,
      });

      const mcpConfigs = (loadedMcpConfigs || []).map((c) => ({
        ...c,
        apiKey: loadedMcpKeys?.[c.id] ?? c.apiKey,
      }));
      const mcpEnabledServers = loadedMcpEnabledServers || [];
      mcpSetState({
        mcpConfigs,
        envSecrets: loadedMcpEnvSecrets,
        mcpApiKeys: loadedMcpKeys || {},
        serverStatuses: Object.fromEntries(mcpConfigs.map((c) => [c.id, "disconnected" as const])),
        selectedServerIds: new Set(),
        enabledServerIds: new Set(
          mcpEnabledServers.filter((id) => mcpConfigs.some((config) => config.id === id && config.enabled)),
        ),
      });

      const initialActiveId = cleanedConvs.length > 0 ? cleanedConvs[0].id : null;
      set({
        conversations: cleanedConvs,
        activeId: initialActiveId,
        navigationHistory: initialActiveId ? [initialActiveId] : [],
        navigationIndex: initialActiveId ? 0 : -1,
      });

      uiHasStarted(hasOnboarded);
      uiConfigLoaded(true);
      uiTheme(hasOnboarded ? loadedTheme : DEFAULT_THEME_CONFIG);

      useUIStore.setState({
        animationsDisabled: hasOnboarded ? loadedAnimationsDisabled : false,
        alwaysOnTop: hasOnboarded ? loadedAlwaysOnTop : false,
        closeToTray: hasOnboarded ? loadedCloseToTray : false,
        launchOnStartup: hasOnboarded ? loadedLaunchOnStartup : false,
        sendMessageShortcut: hasOnboarded ? loadedSendMessageShortcut : "enter",
        clearInputOnEscape: hasOnboarded ? loadedClearInputOnEscape : false,
        baseTextSize: hasOnboarded ? loadedBaseTextSize : "medium",
        autoUpdateChecking: hasOnboarded ? loadedAutoUpdateChecking : true,
        isLoggingEnabled: hasOnboarded ? loadedIsLoggingEnabled : true,
        showContextWindow: hasOnboarded ? loadedShowContextWindow : false,
        contextTokenizationMode: hasOnboarded ? loadedContextTokenizationMode : "local",
        disableBgActivity: hasOnboarded ? loadedDisableBgActivity : false,
        blockedHosts: loadedNetworkSettings.blockedHosts,
        allowedLocalEndpoints: loadedNetworkSettings.allowedLocalEndpoints,
        offlineMode: loadedNetworkSettings.offlineMode,
        language: hasOnboarded ? loadedLanguage : "en",
        sidebarWidth: Math.max(180, Math.min(480, loadedUiLayout.sidebarWidth ?? 260)),
        auxPanelWidth: Math.max(
          MIN_AUX_PANEL_WIDTH,
          Math.min(MAX_AUX_PANEL_WIDTH, loadedUiLayout.auxPanelWidth ?? DEFAULT_AUX_PANEL_WIDTH),
        ),
      });
      if (typeof document !== "undefined") {
        document.documentElement.lang = hasOnboarded ? loadedLanguage : "en";
      }
      document.documentElement.classList.toggle("animations-disabled", hasOnboarded ? loadedAnimationsDisabled : false);

      if (hasOnboarded && conversationsNeedRepair) {
        // Repair interrupted streaming markers after the app is interactive.
        void get().persistConversations();
      }

      window.setTimeout(() => {
        void (async () => {
          try {
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            await getCurrentWindow().setAlwaysOnTop(hasOnboarded ? loadedAlwaysOnTop : false);
          } catch (e) {
            logWarn("general", "Could not apply always-on-top on startup", { details: String(e) });
          }

          try {
            const { invoke } = await import("@tauri-apps/api/core");
            const currentlyEnabled = await invoke<boolean>("is_autostart_enabled");
            if (loadedLaunchOnStartup !== currentlyEnabled) {
              await invoke("set_autostart_enabled", { enabled: loadedLaunchOnStartup });
            }
          } catch (e) {
            logWarn("general", "Could not synchronize launch on startup with OS", { details: String(e) });
          }
        })();
      }, 250);

      window.setTimeout(() => {
        if (!loadedDisableBgActivity) {
          modelCheckConnections();
          modelStartHealthCheck();
          if (!loadedNetworkSettings.offlineMode) {
            void searchCheckConnections();
            searchStartConnectionChecks();
          }
        }
        useMcpStore.getState().connectAllEnabled();
      }, 500);

      logInfo("chat", "App state initialized", {
        details: `Loaded ${modelsWithKeys.length} models, ${nonEmptyConvs.length} conversations, ${searchConfigs.length} search configs, ${mcpConfigs.length} MCP servers`,
      });
    } catch (err) {
      const parsed = parseApiError(err);
      logError("chat", "Failed to initialize app", { error: err, action: "Check your settings and restart the app." });
      await suspendPersistenceForRecovery();
      useUIStore.getState().setStartupRecovery({
        message: "Sythoria could not safely load encrypted app data. Your existing data has not been changed.",
        detail: parsed.message,
      });
      uiLaunchReady(true);
    } finally {
      uiLoading("init", false);
      initInProgress = false;
    }
  },

  cleanupEmptyConversations: async (exceptId?: string | null) => {
    const { conversations, activeId, isCompareMode, compareIds } = get();
    const keepId = exceptId !== undefined ? exceptId : activeId;
    const removableIds = new Set(
      conversations.flatMap((conversation) => {
        if (conversation.pendingWorktree || conversation.id === keepId) return [];
        if (conversation.id.startsWith("compare-")) {
          return isCompareMode && compareIds.includes(conversation.id) ? [] : [conversation.id];
        }
        return conversation.messages.length === 0 ? [conversation.id] : [];
      }),
    );
    if (removableIds.size === 0) return;
    const safeRemovableIds = new Set(
      [...removableIds].filter((conversationId) =>
        [...collectConversationTreeIds(conversations, [conversationId])].every((id) => removableIds.has(id)),
      ),
    );
    const rootIds = conversations.flatMap((conversation) => {
      if (!safeRemovableIds.has(conversation.id)) return [];
      return conversation.parentId && safeRemovableIds.has(conversation.parentId) ? [] : [conversation.id];
    });
    if (rootIds.length === 0) return;
    await get().deleteConversationTrees(rootIds, { preferredActiveId: keepId });
  },

  setActiveId: (id, isHistoryMove = false) => {
    const { activeId, navigationHistory, navigationIndex, conversations } = get();
    if (activeId === id) return Promise.resolve(true);

    const activeConversation = conversations.find((conversation) => conversation.id === activeId);

    if (activeConversation?.isTemporary) {
      return get().deleteConversationTrees([activeConversation.id], {
        preferredActiveId: id,
        appendPreferredToHistory: !isHistoryMove,
      });
    }

    const newHistory = isHistoryMove
      ? navigationHistory
      : id === null
        ? navigationHistory.slice(0, navigationIndex + 1)
        : [...navigationHistory.slice(0, navigationIndex + 1), id];
    const nextNavigationIndex = isHistoryMove ? (id === null ? -1 : newHistory.lastIndexOf(id)) : newHistory.length - 1;

    set({
      activeId: id,
      navigationHistory: newHistory,
      navigationIndex: nextNavigationIndex,
      isCompareMode: false,
      compareIds: [],
    });
    void get().cleanupEmptyConversations(id);
    return Promise.resolve(true);
  },

  navigateBack: () => {
    const { navigationHistory, navigationIndex } = get();
    if (navigationIndex > 0) {
      const newIndex = navigationIndex - 1;
      const id = navigationHistory[newIndex];
      void get().setActiveId(id, true);
      uiView("chat");
      uiSidebarOpen(false);
    }
  },

  navigateForward: () => {
    const { navigationHistory, navigationIndex } = get();
    if (navigationIndex < navigationHistory.length - 1) {
      const newIndex = navigationIndex + 1;
      const id = navigationHistory[newIndex];
      void get().setActiveId(id, true);
      uiView("chat");
      uiSidebarOpen(false);
    }
  },

  newChat: () => {
    const { selectedModel, models } = useModelStore.getState();
    const { activeProjectId, isProjectsEnabled } = useProjectStore.getState();
    const id = generateId();
    const modelConfig = models.find((m) => m.id === selectedModel);
    const conv: Conversation = {
      id,
      title: "New chat",
      timestamp: new Date(),
      messages: [],
      model: modelConfig?.id || selectedModel,
      projectId: (isProjectsEnabled && activeProjectId) || undefined,
    };
    set((state) => ({ conversations: [conv, ...state.conversations] }));
    void get().setActiveId(id);
    uiSidebarOpen(false);
    uiView("chat");
    return id;
  },

  newTemporaryChat: () => {
    const { selectedModel, models } = useModelStore.getState();
    const { activeProjectId, isProjectsEnabled } = useProjectStore.getState();
    const id = "temp-" + generateId();
    const modelConfig = models.find((m) => m.id === selectedModel);
    const conv: Conversation = {
      id,
      title: "Temporary chat",
      timestamp: new Date(),
      messages: [],
      model: modelConfig?.id || selectedModel,
      projectId: (isProjectsEnabled && activeProjectId) || undefined,
      isTemporary: true,
    };
    set((state) => ({ conversations: [conv, ...state.conversations] }));
    void get().setActiveId(id);
    uiSidebarOpen(false);
    uiView("chat");
    return id;
  },

  newSideChat: () => {
    const { selectedModel, models } = useModelStore.getState();
    const { activeProjectId, isProjectsEnabled } = useProjectStore.getState();
    const id = "side-" + generateId();
    const modelConfig = models.find((model) => model.id === selectedModel);
    const conversation: Conversation = {
      id,
      title: "Side chat",
      timestamp: new Date(),
      messages: [],
      model: modelConfig?.id || selectedModel,
      projectId: (isProjectsEnabled && activeProjectId) || undefined,
      isTemporary: true,
    };
    set((state) => ({ conversations: [conversation, ...state.conversations] }));
    return id;
  },

  deleteChat: (id) => get().deleteConversationTrees([id]),

  deleteConversationTrees: async (rootIds, options = {}) => {
    const previousDeletion = conversationDeletionTail;
    let releaseDeletion!: () => void;
    conversationDeletionTail = new Promise<void>((resolve) => {
      releaseDeletion = resolve;
    });
    await previousDeletion;
    try {
      const initialState = get();
      let idsToDelete = collectConversationTreeIds(initialState.conversations, rootIds);
      if (
        idsToDelete.size === 0 ||
        !initialState.conversations.some((conversation) => idsToDelete.has(conversation.id))
      ) {
        return false;
      }

      const stopped = await awaitBoundedShutdown(
        rootIds.map((rootId) => get().stopStreaming(rootId, false)),
        "Conversation run cancellation",
      );
      if (!stopped) {
        if (options.persist !== false) await get().persistConversations();
        uiToast("Chat deletion paused because an active run could not be stopped safely. Retry deletion.", "error");
        return false;
      }
      const expandedIds = collectConversationTreeIds(get().conversations, rootIds);
      const lateDescendantIds = [...expandedIds].filter((conversationId) => !idsToDelete.has(conversationId));
      if (lateDescendantIds.length > 0) {
        const lateDescendantsStopped = await awaitBoundedShutdown(
          lateDescendantIds.map((conversationId) => get().stopStreaming(conversationId, false)),
          "Late descendant cancellation",
        );
        if (!lateDescendantsStopped) {
          if (options.persist !== false) await get().persistConversations();
          uiToast(
            "Chat deletion paused because a descendant run could not be stopped safely. Retry deletion.",
            "error",
          );
          return false;
        }
        idsToDelete = collectConversationTreeIds(get().conversations, rootIds);
      } else {
        idsToDelete = expandedIds;
      }

      type WorktreeDeletion = {
        key: string;
        projectId: string;
        path: string;
        branch: string;
      };
      const worktrees = new Map<string, WorktreeDeletion>();
      const missingProjectWorktrees = new Set<string>();
      for (const conversation of get().conversations) {
        if (!idsToDelete.has(conversation.id) || !conversation.pendingWorktree) continue;
        const projectId = conversation.pendingWorktree.commitScope?.projectId ?? conversation.projectId;
        if (!projectId) {
          missingProjectWorktrees.add(conversation.id);
          continue;
        }
        const key = `${projectId}\u0000${conversation.pendingWorktree.path}\u0000${conversation.pendingWorktree.branch}`;
        worktrees.set(key, {
          key,
          projectId,
          path: conversation.pendingWorktree.path,
          branch: conversation.pendingWorktree.branch,
        });
      }

      const discardResults = await Promise.all(
        [...worktrees.values()].map(async (worktree) => {
          try {
            await invoke("git_worktree_discard", {
              projectId: worktree.projectId,
              worktreePath: worktree.path,
              branchName: worktree.branch,
            });
            return { ...worktree, discarded: true as const };
          } catch (error) {
            logError("chat", "Failed to discard worktree during chat deletion", {
              error,
              details: `Worktree: ${worktree.path}`,
            });
            return { ...worktree, discarded: false as const };
          }
        }),
      );

      const discardedKeys = new Set(discardResults.filter((result) => result.discarded).map((result) => result.key));
      if (discardedKeys.size > 0) {
        set((state) => ({
          conversations: state.conversations.map((conversation) => {
            if (!idsToDelete.has(conversation.id) || !conversation.pendingWorktree) return conversation;
            const projectId = conversation.pendingWorktree.commitScope?.projectId ?? conversation.projectId;
            if (!projectId) return conversation;
            const key = `${projectId}\u0000${conversation.pendingWorktree.path}\u0000${conversation.pendingWorktree.branch}`;
            return discardedKeys.has(key) ? { ...conversation, pendingWorktree: undefined } : conversation;
          }),
        }));
        const activePath = useProjectStore.getState().activeWorktreePath;
        if (discardResults.some((result) => result.discarded && result.path === activePath)) {
          useProjectStore.setState({ activeWorktreePath: null, activeWorktreeBranch: null });
        }
      }

      const failedWorktreeCount =
        missingProjectWorktrees.size + discardResults.filter((result) => !result.discarded).length;
      if (failedWorktreeCount > 0) {
        if (options.persist !== false) await get().persistConversations();
        uiToast(
          `Chat deletion paused because ${failedWorktreeCount} worktree${failedWorktreeCount === 1 ? "" : "s"} could not be discarded. Recovery records were kept for retry.`,
          "error",
        );
        return false;
      }

      set((state) => reduceConversationDeletion(state, idsToDelete, options));

      const uiState = useUIStore.getState();
      if (uiState.activeSubagentId && idsToDelete.has(uiState.activeSubagentId)) {
        uiState.setActiveSubagentId(null);
      }
      if (options.persist !== false) await get().persistConversations();
      return true;
    } finally {
      releaseDeletion();
    }
  },

  deleteProjectChats: async (projectId) => {
    const projectConversations = get().conversations.filter((conversation) => conversation.projectId === projectId);
    if (projectConversations.length === 0) return;
    const projectConversationIds = new Set(projectConversations.map((conversation) => conversation.id));
    const rootIds = projectConversations.flatMap((conversation) =>
      conversation.parentId && projectConversationIds.has(conversation.parentId) ? [] : [conversation.id],
    );
    await get().deleteConversationTrees(rootIds);
  },

  renameChat: (id, newTitle) => {
    set((state) => ({
      conversations: state.conversations.map((c) => (c.id === id ? { ...c, title: newTitle } : c)),
    }));
    get().persistConversations();
  },

  togglePinChat: (id) => {
    set((state) => ({
      conversations: state.conversations.map((c) => (c.id === id ? { ...c, isPinned: !c.isPinned } : c)),
    }));
    get().persistConversations();
  },

  setConversationProject: (id, projectId) => {
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id
          ? {
              ...c,
              messages:
                c.projectId === projectId
                  ? c.messages
                  : attachWorkspaceChangesToLatestAssistant(c.messages, c.workspaceChanges),
              projectId,
              workspaceChanges: c.projectId === projectId ? c.workspaceChanges : undefined,
            }
          : c,
      ),
    }));
    get().persistConversations();
  },

  confirmRename: (newTitle) => {
    const { renameId } = useUIStore.getState();
    if (renameId) {
      get().renameChat(renameId, newTitle);
    }
    uiCloseRenameModal();
  },

  sendMessage: async (
    text,
    attachments,
    requestedConversationId,
    requestedMcpServerIds = [],
    requestedSearchConfigId,
  ) => {
    const { activeId, isCompareMode, compareIds } = get();
    const { selectedModel, models, temperature, titleConfig } = useModelStore.getState();
    const {
      activeProjectId: sendActiveProjectId,
      isProjectsEnabled: sendProjectsEnabled,
      projects: sendProjects,
    } = useProjectStore.getState();
    const uniqueMcpServerIds = [...new Set(requestedMcpServerIds)];
    const submittedSearchConfigId = requestedSearchConfigId ?? null;

    await useSkillStore.getState().loadSkills(true);

    const toolLoop = await prepareReferencedToolLoop(
      uniqueMcpServerIds,
      submittedSearchConfigId,
      "Your message was not sent.",
    );
    if (!toolLoop) {
      return "rejected";
    }

    const requestedConversation = requestedConversationId
      ? get().conversations.find((conversation) => conversation.id === requestedConversationId)
      : undefined;
    if (requestedConversationId && !requestedConversation) return "rejected";
    const targetConversationId = requestedConversation?.id || activeId;
    const targetModelId = requestedConversation?.model || selectedModel;
    const useCompareMode = !requestedConversationId && isCompareMode;

    if (targetConversationId) {
      const activeGen = get().generationByConversation[targetConversationId];
      const isTargetGenerating = isGenerationActive(activeGen?.state);
      if (isTargetGenerating) return "rejected";

      if (useCompareMode && compareIds.length > 0) {
        const isAnyCompareGenerating = compareIds.some((id) => {
          const gen = get().generationByConversation[id];
          return isGenerationActive(gen?.state);
        });
        if (isAnyCompareGenerating) return "rejected";
      }
    }

    let convId = targetConversationId;
    let activeCompareIds = useCompareMode ? [...compareIds] : [];

    if (!resolveModelConfig(models, targetModelId)) {
      showMissingModelConfig(
        "No model configuration selected — user tried to send message without any model configured",
      );
      return "rejected";
    }

    const firstAttachmentName = attachments && attachments.length > 0 ? attachments[0].name : "New chat";
    const initialTitle = text ? truncateTitle(text) : firstAttachmentName;
    if (!convId) {
      const id = generateId();
      const modelConfig = models.find((m) => m.id === targetModelId);
      const conv: Conversation = {
        id,
        title: initialTitle,
        timestamp: new Date(),
        messages: [],
        model: modelConfig?.id || targetModelId,
        projectId: (sendProjectsEnabled && sendActiveProjectId) || undefined,
      };
      set((state) => ({
        conversations: [conv, ...state.conversations],
        activeId: id,
      }));
      convId = id;
    }

    if (useCompareMode && activeCompareIds.length === 0) {
      const id = generateId();
      const secondaryModel = models.find((m) => m.id !== selectedModel && m.enabled !== false)?.id || selectedModel;
      const conv: Conversation = {
        id,
        title: initialTitle + " (Compare)",
        timestamp: new Date(),
        messages: [],
        model: secondaryModel,
        projectId: (sendProjectsEnabled && sendActiveProjectId) || undefined,
      };
      set((state) => ({
        conversations: [conv, ...state.conversations],
        compareIds: [id],
      }));
      activeCompareIds = [id];
    }

    const conversationIds = [convId, ...(useCompareMode ? activeCompareIds : [])];
    const runContexts = conversationIds.flatMap((conversationId) => {
      const conversation = get().conversations.find((candidate) => candidate.id === conversationId);
      if (!conversation) return [];
      const context = buildConversationRunContext({
        conversation,
        models,
        selectedModel: targetModelId,
        temperature,
        projects: sendProjects,
        projectsEnabled: sendProjectsEnabled,
        ...toolLoop,
      });
      return context ? [context] : [];
    });

    if (runContexts.length !== conversationIds.length) {
      showMissingModelConfig("No enabled model configuration was available for every conversation in this send");
      return "rejected";
    }

    if (attachments?.some((attachment) => attachment.kind === "image")) {
      const unsupportedContext = runContexts.find((context) => !context.attachmentCapabilities.images);
      if (unsupportedContext) {
        uiToast(`${unsupportedContext.modelConfig.name} does not support image attachments.`, "error");
        return "rejected";
      }
    }

    const userMsg: Message = {
      id: generateId(),
      role: "user",
      content: text,
      timestamp: new Date(),
      attachments,
      ...(uniqueMcpServerIds.length > 0 ? { mcpServerIds: uniqueMcpServerIds } : {}),
      ...(toolLoop.searchConfig ? { searchConfigId: toolLoop.searchConfig.id } : {}),
    };

    const fallbackTitle = text ? truncateTitle(text) : firstAttachmentName;

    const runForConversation = async (context: ConversationRunContext) => {
      const cId = context.conversationId;
      const currentConvs = get().conversations;
      const conversation = currentConvs.find((c) => c.id === cId);
      const isFirstForThis = (conversation?.messages?.length ?? 0) === 0;
      const isTemporary = conversation?.isTemporary === true;

      set((state) => ({
        conversations: updateConversationMessages(
          state.conversations,
          cId,
          (msgs) => [...attachWorkspaceChangesToLatestAssistant(msgs, conversation?.workspaceChanges), userMsg],
          {
            title:
              isFirstForThis && !isTemporary
                ? activeCompareIds.includes(cId)
                  ? fallbackTitle + " (Compare)"
                  : fallbackTitle
                : undefined,
            recursionDepth: 0,
            workspaceChanges: undefined,
          },
        ),
      }));

      if (isFirstForThis && !isTemporary && titleConfig.enabled) {
        generateConversationTitle(cId, text || fallbackTitle, context.modelConfig, titleConfig, set, get);
      }

      if (context.shouldUseTools) {
        await sendWithToolLoop(
          context,
          (fn) => set(fn as (state: ChatState) => Partial<ChatState>),
          get,
          searchPerformSearch,
          searchFetchUrlContent,
        );
      } else {
        await sendNormal(cId, context.modelConfig, context.temperature, set, get);
      }
    };

    set({
      isStreaming: true,
      generationState: "loading" as GenerationState,
      generationLabel: "Loading",
    });

    void Promise.all(runContexts.map(runForConversation)).catch((error) => {
      logError("chat", "Queued message generation failed", {
        error,
        action: "Retry the message after checking the active model and tool configuration.",
      });
    });
    return "accepted";
  },

  stopStreaming: async (targetConvId, persist = true) => {
    const requestedConvId = typeof targetConvId === "string" ? targetConvId : undefined;
    const targetConvIds = requestedConvId ? collectConversationTreeIds(get().conversations, [requestedConvId]) : null;
    cancelConversationGenerationQueue(targetConvIds ?? get().conversations.map((conversation) => conversation.id));

    const uiStore = useUIStore.getState();
    const pendingConfirmationIds = uiStore.pendingToolConfirmations
      .filter((confirmation) => !targetConvIds || targetConvIds.has(confirmation.conversationId ?? ""))
      .map((confirmation) => confirmation.id);
    for (const confirmationId of pendingConfirmationIds) {
      uiStore.respondToToolConfirmation(confirmationId, false);
    }

    set((state) => {
      const convs = state.conversations.map((c) => {
        if (targetConvIds && !targetConvIds.has(c.id)) return c;
        const nextMessages = c.messages.map((m) => {
          if (m.isStreaming) {
            let thinkingDuration: number | undefined = undefined;
            const start = state.activeStreamThinkingStart?.[c.id];
            if (start) {
              const end = state.activeStreamThinkingEnd?.[c.id] || Date.now();
              thinkingDuration = elapsedSeconds(start, end);
            }
            const content = m.content + (state.activeStreamContent[c.id] || "");
            return {
              ...m,
              content: m.role === "assistant" && content.trim().length === 0 ? CANCELLED_ASSISTANT_MESSAGE : content,
              reasoningContent: (m.reasoningContent || "") + (state.activeStreamReasoning[c.id] || "") || undefined,
              isStreaming: false,
              thinkingDuration: m.thinkingDuration ?? thinkingDuration,
            };
          }
          return m;
        });
        const nextStatus = c.isSubagent && c.status === "running" ? "stopped" : c.status;
        return { ...c, messages: nextMessages, status: nextStatus };
      });

      const nextGenByConv = { ...state.generationByConversation };
      if (targetConvIds) {
        for (const convId of targetConvIds) {
          nextGenByConv[convId] = { state: "cancelled" as GenerationState, label: "Cancelled" };
        }
      } else {
        Object.keys(nextGenByConv).forEach((id) => {
          nextGenByConv[id] = { state: "cancelled" as GenerationState, label: "Cancelled" };
        });
      }

      const stillStreaming = Object.values(nextGenByConv).some((generation) => isGenerationActive(generation.state));

      const nextActiveStreamThinkingStart = { ...state.activeStreamThinkingStart };
      const nextActiveStreamThinkingEnd = { ...state.activeStreamThinkingEnd };
      const nextActiveStreamStartTime = { ...state.activeStreamStartTime };
      const nextActiveStreamContent = { ...state.activeStreamContent };
      const nextActiveStreamReasoning = { ...state.activeStreamReasoning };
      if (targetConvIds) {
        for (const convId of targetConvIds) {
          delete nextActiveStreamContent[convId];
          delete nextActiveStreamReasoning[convId];
          delete nextActiveStreamThinkingStart[convId];
          delete nextActiveStreamThinkingEnd[convId];
          delete nextActiveStreamStartTime[convId];
        }
      } else {
        Object.keys(nextActiveStreamContent).forEach((k) => delete nextActiveStreamContent[k]);
        Object.keys(nextActiveStreamReasoning).forEach((k) => delete nextActiveStreamReasoning[k]);
        Object.keys(nextActiveStreamThinkingStart).forEach((k) => delete nextActiveStreamThinkingStart[k]);
        Object.keys(nextActiveStreamThinkingEnd).forEach((k) => delete nextActiveStreamThinkingEnd[k]);
        Object.keys(nextActiveStreamStartTime).forEach((k) => delete nextActiveStreamStartTime[k]);
      }

      return {
        isStreaming: stillStreaming,
        generationState: stillStreaming ? state.generationState : ("idle" as GenerationState),
        generationLabel: stillStreaming ? state.generationLabel : "",
        generationByConversation: nextGenByConv,
        conversations: convs,
        activeStreamContent: nextActiveStreamContent,
        activeStreamReasoning: nextActiveStreamReasoning,
        activeStreamThinkingStart: nextActiveStreamThinkingStart,
        activeStreamThinkingEnd: nextActiveStreamThinkingEnd,
        activeStreamStartTime: nextActiveStreamStartTime,
      };
    });

    const cancellationTasks = targetConvIds
      ? [
          ...[...targetConvIds].map((convId) => useModelStore.getState().cancelConversationStream(convId)),
          useMcpStore.getState().cancelConversationToolCalls([...targetConvIds]),
          waitForConversationToolLoops(targetConvIds),
          waitForConversationNormalRuns(targetConvIds),
        ]
      : [
          modelCancelStream(),
          useMcpStore
            .getState()
            .cancelConversationToolCalls(get().conversations.map((conversation) => conversation.id)),
          waitForConversationToolLoops(get().conversations.map((conversation) => conversation.id)),
          waitForConversationNormalRuns(get().conversations.map((conversation) => conversation.id)),
        ];
    const stopped = await awaitBoundedShutdown(cancellationTasks, "Stream and tool cancellation");

    const stillStreaming = Object.values(get().generationByConversation).some((generation) =>
      isGenerationActive(generation.state),
    );
    if (!stillStreaming) {
      uiLoading("sendMessage", false);
      uiLoading("toolExecution", false);
    }
    if (persist) await get().persistConversations();
    return stopped;
  },

  retryLastMessage: async (convId, messageId) => {
    const { isStreaming, conversations } = get();
    const { selectedModel, models, temperature } = useModelStore.getState();

    if (isStreaming) return;

    const conv = conversations.find((c) => c.id === convId);
    if (!conv || conv.messages.length === 0) return;

    const { isProjectsEnabled, projects } = useProjectStore.getState();
    const targetIdx =
      messageId === undefined
        ? conv.messages.length - 1
        : conv.messages.findIndex((message) => message.id === messageId);
    if (targetIdx < 0) return;

    let lastUserIdx = -1;
    for (let i = targetIdx; i >= 0; i--) {
      if (conv.messages[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx === -1) return;

    await useSkillStore.getState().loadSkills(true);
    const lastUserMessage = conv.messages[lastUserIdx];
    const toolLoop = await prepareReferencedToolLoop(
      [...new Set(lastUserMessage.mcpServerIds ?? [])],
      getMessageSearchConfigId(lastUserMessage),
      "The retry was not started.",
    );
    if (!toolLoop) return;
    const runContext = buildConversationRunContext({
      conversation: conv,
      models,
      selectedModel,
      temperature,
      projects,
      projectsEnabled: isProjectsEnabled,
      ...toolLoop,
    });
    if (!runContext) {
      showMissingModelConfig(
        "No model configuration selected — user tried to retry message without any model configured",
      );
      return;
    }

    if (
      conv.messages[lastUserIdx].attachments?.some((attachment) => attachment.kind === "image") &&
      !runContext.attachmentCapabilities.images
    ) {
      uiToast(`${runContext.modelConfig.name} does not support image attachments.`, "error");
      return;
    }

    // Preparation can reconnect tools asynchronously; never overwrite a newer conversation.
    const currentConversation = get().conversations.find((c) => c.id === convId);
    if (get().isStreaming || currentConversation?.messages !== conv.messages) return;

    const trimmed = conv.messages.slice(0, lastUserIdx + 1);

    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === convId ? { ...c, messages: trimmed, timestamp: new Date(), workspaceChanges: undefined } : c,
      ),
    }));

    if (runContext.shouldUseTools) {
      await sendWithToolLoop(
        runContext,
        (fn) => set(fn as (state: ChatState) => Partial<ChatState>),
        get,
        searchPerformSearch,
        searchFetchUrlContent,
      );
    } else {
      await sendNormal(convId, runContext.modelConfig, runContext.temperature, set, get);
    }
  },

  publishPendingWorktree: async (convId, options = {}) => {
    const conv = get().conversations.find((c) => c.id === convId);
    if (!conv || !conv.pendingWorktree) return false;
    const pendingWorktree = conv.pendingWorktree;
    const projectId = pendingWorktree.commitScope?.projectId ?? conv.projectId;
    if (!projectId) {
      uiToast("The original project could not be identified. This worktree was left intact for recovery.", "error");
      return false;
    }

    const publicationKey = `${projectId}\u0000${pendingWorktree.path}\u0000${pendingWorktree.branch}`;
    const activePublication = activeWorktreePublications.get(publicationKey);
    if (activePublication) return activePublication;

    const publication = serializeProjectWorktreePublication(projectId, async () => {
      uiLoading("toolExecution", true);
      try {
        const capturedFiles = new Map<string, { additions: number; deletions: number }>();
        try {
          const [diff, status] = await Promise.all([
            invoke<string>("git_diff_changes", {
              projectId,
              worktreePath: pendingWorktree.path,
              files: null,
              runToken: null,
            }),
            invoke<{ unstagedFiles: string[]; stagedFiles: string[] }>("git_get_status", {
              projectId,
              worktreePath: pendingWorktree.path,
            }),
          ]);
          for (const file of parseGitDiff(diff)) {
            const previous = capturedFiles.get(file.path);
            capturedFiles.set(file.path, {
              additions: (previous?.additions ?? 0) + file.additions,
              deletions: (previous?.deletions ?? 0) + file.deletions,
            });
          }
          for (const path of [...status.unstagedFiles, ...status.stagedFiles]) {
            if (path.endsWith("/")) continue;
            if (!capturedFiles.has(path)) capturedFiles.set(path, { additions: 0, deletions: 0 });
          }
        } catch (error) {
          logWarn("git", "Could not capture worktree diff statistics before publishing", {
            details: error instanceof Error ? error.message : String(error),
          });
        }

        const publicationResult = await invoke<WorktreePublicationResult>("git_worktree_apply", {
          projectId,
          worktreePath: pendingWorktree.path,
          branchName: pendingWorktree.branch,
        });
        const changedPaths = publicationResult.changedPaths;

        const workspaceChanges = {
          projectId,
          appliedAt: new Date(),
          undoToken: publicationResult.undoToken,
          files: changedPaths.map((path) => ({
            path,
            additions: capturedFiles.get(path)?.additions ?? 0,
            deletions: capturedFiles.get(path)?.deletions ?? 0,
          })),
        };

        const projectStore = useProjectStore.getState();
        if (projectStore.activeWorktreePath === pendingWorktree.path) {
          useProjectStore.setState({ activeWorktreePath: null, activeWorktreeBranch: null });
        }

        set((state) => ({
          conversations: state.conversations.map((candidate) =>
            candidate.pendingWorktree?.path === pendingWorktree.path &&
            candidate.pendingWorktree.branch === pendingWorktree.branch
              ? {
                  ...candidate,
                  messages: attachWorkspaceChangesToLatestAssistant(candidate.messages, workspaceChanges),
                  pendingWorktree: undefined,
                  workspaceChanges,
                }
              : candidate,
          ),
        }));
        await get().persistConversations();
        if (!options.automatic) uiToast("Changes published to the workspace.", "success");

        const commitScope = pendingWorktree.commitScope;
        if (commitScope && commitScope.projectId === projectId) {
          await useGitStore.getState().autoCommitIfNeeded({
            ...commitScope,
            files: changedPaths,
          });
        } else if (changedPaths.length > 0) {
          logWarn("git", "Skipped auto-commit because the published worktree had no captured run scope");
        }
        return true;
      } catch (err) {
        logError("chat", "Failed to publish worktree changes", { error: err });
        uiToast(
          options.automatic
            ? "Changes are still safely isolated because they could not be published. Open Review to resolve them."
            : "Failed to publish changes: " + parseApiError(err).message,
          "error",
        );
        return false;
      } finally {
        uiLoading("toolExecution", false);
      }
    });

    activeWorktreePublications.set(publicationKey, publication);
    try {
      return await publication;
    } finally {
      if (activeWorktreePublications.get(publicationKey) === publication) {
        activeWorktreePublications.delete(publicationKey);
      }
    }
  },

  undoWorkspaceChanges: async (convId, undoToken) => {
    const conversation = get().conversations.find((candidate) => candidate.id === convId);
    const workspaceChanges = undoToken
      ? conversation?.workspaceChanges?.undoToken === undoToken
        ? conversation.workspaceChanges
        : [...(conversation?.messages ?? [])]
            .reverse()
            .find((message) => message.workspaceChanges?.undoToken === undoToken)?.workspaceChanges
      : conversation?.workspaceChanges;
    if (!workspaceChanges?.undoToken) {
      uiToast("This change can no longer be undone automatically.", "info");
      return false;
    }
    const workspaceUndoToken = workspaceChanges.undoToken;

    return serializeProjectWorktreePublication(workspaceChanges.projectId, async () => {
      uiLoading("toolExecution", true);
      try {
        await invoke("git_workspace_undo", {
          projectId: workspaceChanges.projectId,
          undoToken: workspaceChanges.undoToken,
        });
        set((state) => ({
          conversations: state.conversations.map((candidate) =>
            candidate.workspaceChanges?.undoToken === workspaceUndoToken ||
            candidate.messages.some((message) => message.workspaceChanges?.undoToken === workspaceUndoToken)
              ? {
                  ...candidate,
                  messages: removeWorkspaceChangesByUndoToken(candidate.messages, workspaceUndoToken),
                  workspaceChanges:
                    candidate.workspaceChanges?.undoToken === workspaceUndoToken
                      ? undefined
                      : candidate.workspaceChanges,
                }
              : candidate,
          ),
        }));
        await get().persistConversations();
        uiToast("Captured workspace changes were undone.", "success");
        return true;
      } catch (err) {
        logError("chat", "Failed to undo workspace changes", { error: err });
        uiToast("Could not undo changes: " + parseApiError(err).message, "error");
        return false;
      } finally {
        uiLoading("toolExecution", false);
      }
    });
  },

  discardPendingWorktree: async (convId) => {
    const conv = get().conversations.find((c) => c.id === convId);
    if (!conv || !conv.pendingWorktree) return;
    const pendingWorktree = conv.pendingWorktree;
    const projectId = pendingWorktree.commitScope?.projectId ?? conv.projectId;
    if (!projectId) {
      uiToast("The original project could not be identified. This worktree was left intact for recovery.", "error");
      return;
    }

    await serializeProjectWorktreePublication(projectId, async () => {
      uiLoading("toolExecution", true);
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("git_worktree_discard", {
          projectId,
          worktreePath: pendingWorktree.path,
          branchName: pendingWorktree.branch,
        });

        const projectStore = useProjectStore.getState();
        if (projectStore.activeWorktreePath === pendingWorktree.path) {
          useProjectStore.setState({ activeWorktreePath: null, activeWorktreeBranch: null });
        }

        set((state) => ({
          conversations: state.conversations.map((candidate) =>
            candidate.pendingWorktree?.path === pendingWorktree.path &&
            candidate.pendingWorktree.branch === pendingWorktree.branch
              ? { ...candidate, pendingWorktree: undefined, workspaceChanges: undefined }
              : candidate,
          ),
        }));
        get().persistConversations();
        uiToast("Changes discarded successfully.", "info");
      } catch (err) {
        logError("chat", "Failed to discard worktree changes", { error: err });
        uiToast("Failed to discard changes: " + parseApiError(err).message, "error");
      } finally {
        uiLoading("toolExecution", false);
      }
    });
  },

  exportChat: async (id) => {
    const conv = get().conversations.find((c) => c.id === id);
    if (!conv) return;

    try {
      const defaultName = `${conv.title.replace(/[^a-zA-Z0-9]/g, "_")}.md`;
      const saveResult = await invoke<[string, string] | null>("select_save_file_and_get_token", {
        title: "Export Chat",
        defaultName,
      });

      if (!saveResult) return;
      const [token, filePath] = saveResult;

      let content = "";
      if (filePath.endsWith(".json")) {
        content = JSON.stringify(conv, null, 2);
      } else {
        const lines = [
          `# ${conv.title}`,
          ``,
          ...conv.messages.map((m) => {
            if (m.role === "tool") {
              const result = m.toolResult;
              return `**Tool (${result?.name ?? "unknown"}):** ${m.content.slice(0, 200)}`;
            }
            const label = m.role === "user" ? "You" : "Assistant";
            return `**${label}:** ${m.content}`;
          }),
        ];
        content = lines.join("\n\n");
      }

      await invoke("write_exported_file_by_token", { token, content });
      uiToast("Chat exported", "success");
    } catch (err) {
      logError("chat", "Failed to export chat", { error: err });
      uiToast("Failed to export chat", "error");
    }
  },

  importConversations: async (imported: Conversation[]) => {
    if (!imported || imported.length === 0) return;
    const { conversations } = get();
    const newConversations = [...imported, ...conversations];
    set({
      conversations: newConversations,
      activeId: imported[0].id,
    });
    await get().persistConversations();
    uiToast(`Imported ${imported.length} conversation${imported.length === 1 ? "" : "s"}`, "success");
  },

  persistConversations: async () => {
    const { hasStarted } = useUIStore.getState();
    if (!hasStarted) return;
    const { conversations } = get();
    const persistentConversations = conversations.filter((c) => !c.isTemporary);
    try {
      await saveConversations(persistentConversations);
    } catch {
      uiToast("Chat history could not be saved. The previous encrypted snapshot is still intact.", "error");
    }
  },

  resumeConversation: async (convId, options = {}) => {
    const { conversations } = get();
    const conv = conversations.find((c) => c.id === convId);
    if (!conv) return;

    // Automatic continuations keep the exact capabilities accepted with the
    // originating prompt, including MCP references and the installed skill snapshot.
    if (options.runContext) {
      const context = continueConversationRunContext(options.runContext, convId);
      if (context.shouldUseTools) {
        await sendWithToolLoop(
          context,
          (fn) => set(fn as (state: ChatState) => Partial<ChatState>),
          get,
          searchPerformSearch,
          searchFetchUrlContent,
        );
      } else {
        await sendNormal(convId, context.modelConfig, context.temperature, set, get);
      }
      return;
    }

    const { selectedModel, models, temperature } = useModelStore.getState();
    const { isProjectsEnabled, projects } = useProjectStore.getState();
    const lastUserMessage = [...conv.messages]
      .reverse()
      .find((message) => message.role === "user" && !message.isSystem);
    await useSkillStore.getState().loadSkills(true);
    const toolLoop = await prepareReferencedToolLoop(
      [...new Set(lastUserMessage?.mcpServerIds ?? [])],
      getMessageSearchConfigId(lastUserMessage),
      "The continuation was not started.",
    );
    if (!toolLoop) return;
    let runContext = buildConversationRunContext({
      conversation: conv,
      models,
      selectedModel,
      temperature,
      projects,
      projectsEnabled: isProjectsEnabled,
      ...toolLoop,
    });
    if (!runContext) {
      logError("model", "No enabled model configuration available to resume conversation", {
        action: "Go to Settings > Model Providers and enable a model configuration.",
      });
      uiToast("No enabled model configured — enable one in settings/model-providers", "error");
      return;
    }
    // Notification-driven resumes inherit the originating message's step
    // budget; only fresh user sends start a new one.
    if (options.stepBudget) {
      runContext = withToolStepBudget(runContext, options.stepBudget);
    }

    if (runContext.shouldUseTools) {
      await sendWithToolLoop(
        runContext,
        (fn) => set(fn as (state: ChatState) => Partial<ChatState>),
        get,
        searchPerformSearch,
        searchFetchUrlContent,
      );
    } else {
      await sendNormal(convId, runContext.modelConfig, runContext.temperature, set, get);
    }
  },

  clearAllChats: async () => {
    const snapshot = get();
    const conversationIds = new Set(snapshot.conversations.map((conversation) => conversation.id));
    const rootIds = snapshot.conversations.flatMap((conversation) =>
      conversation.parentId && conversationIds.has(conversation.parentId) ? [] : [conversation.id],
    );
    const deleted = await get().deleteConversationTrees(rootIds, { preferredActiveId: null, persist: false });
    if (!deleted && snapshot.conversations.length > 0) return;
    try {
      await clearConversations();
      uiToast("All chats cleared", "info");
    } catch {
      set({
        conversations: snapshot.conversations.map((conversation) => ({
          ...conversation,
          pendingWorktree: undefined,
        })),
        activeId: snapshot.activeId,
        navigationHistory: snapshot.navigationHistory,
        navigationIndex: snapshot.navigationIndex,
      });
      uiToast("Chat clearing was incomplete. Retry to ensure encrypted files and their key are both removed.", "error");
    }
  },

  cleanup: () => {
    modelStopHealthCheck();
    searchStopConnectionChecks();
    void get().stopStreaming();
    modelReleaseListeners();
  },

  draftAttachments: [],

  setDraftAttachments: (draftAttachments) => set({ draftAttachments }),

  addDraftFileFromToken: async (token: string, name?: string, size?: number) => {
    if (processingTokens.has(token)) {
      return;
    }
    processingTokens.add(token);

    const addToast = useUIStore.getState().addToast;
    const currentDrafts = get().draftAttachments;

    if (name && typeof size === "number") {
      const isDuplicate = currentDrafts.some((a) => a.name === name && a.size === size);
      if (isDuplicate) {
        processingTokens.delete(token);
        return;
      }
    }

    try {
      const payload = await invoke<{
        name: string;
        size: number;
        mimeType: string;
        dataUrl?: string;
        textContent?: string;
      }>("read_file_from_token", { token });

      // Fallback check in case metadata wasn't passed to addDraftFileFromToken
      const isDuplicate = currentDrafts.some((a) => a.name === payload.name && a.size === payload.size);
      if (isDuplicate) {
        return;
      }

      // Determine classification kind
      const isImage = payload.mimeType.startsWith("image/");
      const kind = isImage ? "image" : "text";

      const modelStore = useModelStore.getState();
      const currentModel = modelStore.models.find((m) => m.id === modelStore.selectedModel);
      if (isImage && currentModel && currentModel.supportsImages === false) {
        addToast(`"${currentModel.name}" does not support image inputs.`, "error");
        return;
      }

      const valResult = validateFile(
        {
          name: payload.name,
          size: payload.size,
          type: payload.mimeType,
        },
        currentDrafts.length,
      );

      if (!valResult.ok) {
        addToast(valResult.reason || "Invalid file", "error");
        return;
      }

      const attachment: Attachment = {
        id: generateId(),
        name: payload.name,
        mimeType: payload.mimeType,
        size: payload.size,
        kind,
        dataUrl: payload.dataUrl,
        textContent: payload.textContent,
      };

      set({ draftAttachments: [...currentDrafts, attachment] });
    } catch (err) {
      const errMsg = parseApiError(err).message;
      addToast(errMsg, "error");
    } finally {
      setTimeout(() => {
        processingTokens.delete(token);
      }, 5000);
    }
  },

  setGenerationState: (state, label, error) => {
    const generationLabel = error ? `${label ?? state}: ${error}` : (label ?? state);
    set({
      generationState: state,
      generationLabel,
      ...(get().activeId
        ? {
            generationByConversation: setConversationGeneration(get(), get().activeId!, state, generationLabel),
          }
        : {}),
    });
  },
}));

async function runNormal(
  convId: string,
  modelConfig: ModelConfig,
  temperature: number,
  set: (fn: (state: ChatState) => Partial<ChatState>) => void,
  get: () => ChatState,
) {
  const assistantMsg: Message = {
    id: generateId(),
    role: "assistant",
    content: "",
    timestamp: new Date(),
    isStreaming: true,
  };

  set((state) => {
    const nextContent = { ...state.activeStreamContent };
    delete nextContent[convId];
    const nextReasoning = { ...state.activeStreamReasoning };
    delete nextReasoning[convId];
    const nextStart = { ...state.activeStreamThinkingStart };
    delete nextStart[convId];
    const nextEnd = { ...state.activeStreamThinkingEnd };
    delete nextEnd[convId];
    const nextStreamStartTime = { ...state.activeStreamStartTime };
    delete nextStreamStartTime[convId];
    return {
      isStreaming: true,
      generationState: "loading" as GenerationState,
      generationLabel: "Loading",
      generationByConversation: setConversationGeneration(state, convId, "loading" as GenerationState, "Loading"),
      conversations: updateConversationMessages(state.conversations, convId, (msgs) => [...msgs, assistantMsg]),
      activeStreamContent: nextContent,
      activeStreamReasoning: nextReasoning,
      activeStreamThinkingStart: nextStart,
      activeStreamThinkingEnd: nextEnd,
      activeStreamStartTime: nextStreamStartTime,
    };
  });
  uiLoading("sendMessage", true);

  const streamId = generateId();
  const modelStore = useModelStore.getState();

  logInfo("chat", `Sending message to ${modelConfig.name}`, {
    details: `Model: ${modelConfig.modelId}, API: ${modelConfig.apiBase}, Stream ID: ${streamId}`,
  });

  let cleanupStream: (() => void) | null = null;

  try {
    cleanupStream = await modelStore.ensureStreamListeners(
      streamId,
      convId,
      ({ kind, content }) => {
        set((state) => {
          const nextActiveStreamThinkingStart = { ...state.activeStreamThinkingStart };
          const nextActiveStreamThinkingEnd = { ...state.activeStreamThinkingEnd };
          const nextActiveStreamStartTime = { ...state.activeStreamStartTime };
          nextActiveStreamStartTime[convId] ||= Date.now();

          const isReasoning = kind === "reasoning";
          if (isReasoning) {
            nextActiveStreamThinkingStart[convId] ||= Date.now();
          } else if (nextActiveStreamThinkingStart[convId] && !nextActiveStreamThinkingEnd[convId]) {
            nextActiveStreamThinkingEnd[convId] = Date.now();
          }
          const generationState = isReasoning ? ("thinking" as GenerationState) : ("responding" as GenerationState);
          const generationLabel = isReasoning ? "Thinking" : "Responding";

          return {
            generationState,
            generationLabel,
            generationByConversation: setConversationGeneration(state, convId, generationState, generationLabel),
            ...(isReasoning
              ? {
                  activeStreamReasoning: {
                    ...state.activeStreamReasoning,
                    [convId]: (state.activeStreamReasoning[convId] || "") + content,
                  },
                }
              : {
                  activeStreamContent: {
                    ...state.activeStreamContent,
                    [convId]: (state.activeStreamContent[convId] || "") + content,
                  },
                }),
            activeStreamThinkingStart: nextActiveStreamThinkingStart,
            activeStreamThinkingEnd: nextActiveStreamThinkingEnd,
            activeStreamStartTime: nextActiveStreamStartTime,
          };
        });
      },
      () => {
        logInfo("stream", `Stream completed`, {
          details: `Conversation: ${convId}`,
        });
        set((state) => {
          const streamContent = state.activeStreamContent[convId] || "";
          const streamReasoning = state.activeStreamReasoning[convId] || "";
          let thinkingDuration: number | undefined = undefined;
          const start = state.activeStreamThinkingStart?.[convId];
          if (start) {
            const end = state.activeStreamThinkingEnd?.[convId] || Date.now();
            thinkingDuration = elapsedSeconds(start, end);
          }

          const conversations = state.conversations.map((c) => {
            if (c.id !== convId) return c;
            const updated = [...c.messages];
            const lastAssistantIdx = [...updated].reverse().findIndex((m) => m.role === "assistant");
            if (lastAssistantIdx >= 0) {
              const idx = updated.length - 1 - lastAssistantIdx;
              const last = updated[idx];
              updated[idx] = {
                ...last,
                content: last.content + streamContent,
                reasoningContent: (last.reasoningContent || "") + streamReasoning || undefined,
                isStreaming: false,
                thinkingDuration: last.thinkingDuration ?? thinkingDuration,
              };
            }
            return { ...c, messages: updated };
          });
          const nextActiveStreamContent = { ...state.activeStreamContent };
          delete nextActiveStreamContent[convId];
          const nextActiveStreamReasoning = { ...state.activeStreamReasoning };
          delete nextActiveStreamReasoning[convId];

          const nextStart = { ...state.activeStreamThinkingStart };
          delete nextStart[convId];
          const nextEnd = { ...state.activeStreamThinkingEnd };
          delete nextEnd[convId];
          const nextStreamStartTime = { ...state.activeStreamStartTime };
          delete nextStreamStartTime[convId];

          return {
            conversations,
            activeStreamContent: nextActiveStreamContent,
            activeStreamReasoning: nextActiveStreamReasoning,
            activeStreamThinkingStart: nextStart,
            activeStreamThinkingEnd: nextEnd,
            activeStreamStartTime: nextStreamStartTime,
          };
        });
      },
    );

    // Cancellation can happen while the async listener setup is in flight. Do
    // not start a native stream after the conversation has already been
    // stopped; it would not have been included in the cancellation request and
    // could keep chat deletion paused until it eventually completes.
    const generation = get().generationByConversation[convId];
    if (!generation || !isGenerationActive(generation.state)) {
      return;
    }
    modelStore.setActiveStreamId(streamId, convId);

    const conv = get().conversations.find((c) => c.id === convId);
    const apiMessages = buildConversationContextMessages(conv?.messages ?? [], modelConfig);

    const systemPrompt =
      modelConfig.systemPromptOverride && modelConfig.systemPromptOverride.trim()
        ? modelConfig.systemPromptOverride
        : useModelStore.getState().systemPrompt;
    if (systemPrompt && systemPrompt.trim()) {
      apiMessages.unshift({ role: "system", content: systemPrompt });
    }

    const requestTemp = modelConfig.temperature !== undefined ? modelConfig.temperature : temperature;
    const assembledContext = assembleContext({ messages: apiMessages, model: modelConfig });
    const maxTokens = assembledContext.requestMaxOutputTokens;
    if (assembledContext.disclosure) {
      const disclosure = assembledContext.disclosure;
      const disclosureMessage: Message = {
        id: generateId(),
        role: "assistant",
        content: formatContextDisclosure(disclosure),
        timestamp: new Date(),
        isSystem: true,
        excludeFromModelContext: true,
        contextDisclosure: disclosure,
      };
      set((state) => ({
        conversations: updateConversationMessages(state.conversations, convId, (messages) => {
          const assistantIndex = messages.findIndex((message) => message.id === assistantMsg.id);
          if (assistantIndex < 0) return [...messages, disclosureMessage];
          return [...messages.slice(0, assistantIndex), disclosureMessage, ...messages.slice(assistantIndex)];
        }),
      }));
    }

    const useResponses = isResponsesEndpoint(modelConfig.apiBase);
    const rawResponse = await invoke<string>(useResponses ? "chat_stream_tools" : "chat_stream", {
      ...(useResponses ? { tools: "[]" } : {}),
      configId: modelConfig.id,
      expectedModel: { apiBase: modelConfig.apiBase, modelId: modelConfig.modelId, provider: modelConfig.provider },
      messages: assembledContext.messages,
      temperature: requestTemp,
      maxTokens,
      thinkingLevel: modelConfig.thinkingLevel ?? "auto",
      streamId,
    });

    if (useResponses) {
      const response = JSON.parse(rawResponse);
      const output = response.choices?.[0]?.message?.responses_output as Message["responsesOutput"];
      if (output) {
        set((state) => ({
          conversations: updateConversationMessages(state.conversations, convId, (messages) =>
            messages.map((message) =>
              message.id === assistantMsg.id ? { ...message, responsesOutput: output } : message,
            ),
          ),
        }));
      }
    }

    useModelStore.getState().removeActiveStreamId(streamId);

    const start = get().activeStreamThinkingStart?.[convId];
    let thinkingDuration: number | undefined = undefined;
    if (start) {
      const end = get().activeStreamThinkingEnd?.[convId] || Date.now();
      thinkingDuration = elapsedSeconds(start, end);
    }

    set((state) => {
      const updatedConvs = finalizeAssistantMessage(state.conversations, convId, thinkingDuration);
      const generationByConversation = setConversationGeneration(state, convId, "idle" as GenerationState, "");
      const stillStreaming = Object.values(generationByConversation).some((generation) =>
        isGenerationActive(generation.state),
      );
      const nextStart = { ...state.activeStreamThinkingStart };
      delete nextStart[convId];
      const nextEnd = { ...state.activeStreamThinkingEnd };
      delete nextEnd[convId];
      const nextStreamStartTime = { ...state.activeStreamStartTime };
      delete nextStreamStartTime[convId];

      return {
        conversations: updatedConvs,
        activeStreamThinkingStart: nextStart,
        activeStreamThinkingEnd: nextEnd,
        activeStreamStartTime: nextStreamStartTime,
        isStreaming: stillStreaming,
        generationState: stillStreaming ? state.generationState : ("idle" as GenerationState),
        generationLabel: stillStreaming ? state.generationLabel : "",
        generationByConversation,
      };
    });

    get().persistConversations();
  } catch (err) {
    const parsed = parseApiError(err);
    useModelStore.getState().removeActiveStreamId(streamId);
    set((state) => {
      const generationLabel = `Generation failed: ${parsed.message}`;
      return {
        conversations: setAssistantError(state.conversations, convId, err),
        isStreaming: Object.entries(state.generationByConversation).some(
          ([id, generation]) => id !== convId && isGenerationActive(generation.state),
        ),
        generationState: "error" as GenerationState,
        generationLabel,
        generationByConversation: setConversationGeneration(state, convId, "error" as GenerationState, generationLabel),
      };
    });
    uiToast(parsed.message, "error");
    logError("chat", "Failed to send message or stream response", {
      error: err,
      action: parsed.action,
      details: `Model: ${modelConfig?.name}, Category: ${parsed.category}, Retryable: ${parsed.retryable}${parsed.rawDetail ? `\nRaw: ${parsed.rawDetail}` : ""}`,
    });
  } finally {
    cleanupStream?.();
    uiLoading("sendMessage", false);
  }
}

function sendNormal(
  convId: string,
  modelConfig: ModelConfig,
  temperature: number,
  set: (fn: (state: ChatState) => Partial<ChatState>) => void,
  get: () => ChatState,
): Promise<void> {
  const run = enqueueConversationGeneration(convId, () => runNormal(convId, modelConfig, temperature, set, get));
  const conversationRuns = activeNormalRuns.get(convId) ?? new Set<Promise<void>>();
  conversationRuns.add(run);
  activeNormalRuns.set(convId, conversationRuns);
  const releaseRun = () => {
    const currentRuns = activeNormalRuns.get(convId);
    currentRuns?.delete(run);
    if (currentRuns?.size === 0) activeNormalRuns.delete(convId);
  };
  void run.then(releaseRun, releaseRun);
  return run;
}

async function waitForConversationNormalRuns(conversationIds: Iterable<string>): Promise<void> {
  const runs = [...conversationIds].flatMap((conversationId) => [...(activeNormalRuns.get(conversationId) ?? [])]);
  await Promise.allSettled(runs);
}

function generateConversationTitle(
  convId: string,
  userText: string,
  chatModelConfig: ModelConfig,
  titleConfig: TitleGenerationConfig,
  set: (fn: (state: ChatState) => Partial<ChatState>) => void,
  get: () => ChatState,
): void {
  const { models } = useModelStore.getState();

  let titleModelConfig: ModelConfig;
  if (titleConfig.modelId === "__same__") {
    titleModelConfig = chatModelConfig;
  } else {
    const found = models.find((m) => m.id === titleConfig.modelId);
    if (!found) {
      logError("model", "Title generation model not found, falling back to chat model", {
        action: `Go to Settings > Models and make sure the model "${titleConfig.modelId}" is configured and enabled.`,
      });
      titleModelConfig = chatModelConfig;
    } else {
      titleModelConfig = found;
    }
  }

  const systemPrompt = titleConfig.systemPrompt.replace(/\{\{userMessage\}\}/g, userText);

  invoke<string>("generate_title", {
    configId: titleModelConfig.id,
    userMessage: userText,
    systemPrompt,
  })
    .then((title) => {
      const trimmed = title.trim();
      if (trimmed) {
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === convId ? { ...c, title: c.id.startsWith("compare-") ? `${trimmed} (Compare)` : trimmed } : c,
          ),
        }));
        get().persistConversations();
      }
    })
    .catch((err) => {
      logError("chat", "Title generation failed, keeping fallback title", {
        error: err,
        action: "Check that the title generation model in Settings is reachable and your API key is valid.",
      });
    });
}
