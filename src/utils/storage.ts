import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";
import type { Conversation, TitleGenerationConfig, ModelConfig, Project, ProjectPermission } from "../types";
import { DEFAULT_TITLE_SYSTEM_PROMPT } from "../types";
import { logError, logInfo, logWarn } from "./logger";
import { ThemeConfig, DEFAULT_THEME_CONFIG } from "../config/themePresets";
import { DEFAULT_MAX_TOOL_STEPS, MAX_TOOL_STEPS_LIMIT, MIN_TOOL_STEPS } from "../config/constants";
import { verifiedCatalogPluginForConfig } from "../config/pluginsCatalog";

const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  permissions: z.enum(["read", "write", "full"]),
  skipCommandConfirmations: z.boolean().optional(),
  excludePatterns: z.array(z.string()).optional(),
  systemPromptOverride: z.string().optional(),
  isAutoCommitEnabled: z.boolean().optional(),
  autoCommitMsgTemplate: z.string().optional(),
});

export const ProjectsArraySchema = z.array(ProjectSchema);

const ToolCallSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()),
  })
  .passthrough();

const McpImageContentSchema = z
  .object({
    mimeType: z.string(),
    data: z.string(),
  })
  .passthrough();

const DiffLineSchema = z
  .object({
    type: z.enum(["add", "del", "context"]),
    oldNumber: z.number().optional(),
    newNumber: z.number().optional(),
    content: z.string(),
  })
  .passthrough();

const DiffHunkSchema = z
  .object({
    oldStart: z.number(),
    oldLines: z.number(),
    newStart: z.number(),
    newLines: z.number(),
    lines: z.array(DiffLineSchema),
  })
  .passthrough();

const ToolCallResultSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    content: z.string(),
    images: z.array(McpImageContentSchema).optional(),
    diffSummary: z
      .object({
        added: z.number(),
        deleted: z.number(),
        isNew: z.boolean().optional(),
        filename: z.string().optional(),
        language: z.string().optional(),
        truncated: z.boolean().optional(),
        error: z.boolean().optional(),
        hunks: z.array(DiffHunkSchema).optional(),
      })
      .passthrough()
      .optional(),
    subagentIds: z.array(z.string()).optional(),
  })
  .passthrough();

const SourceSchema = z
  .object({
    title: z.string(),
    url: z.string(),
  })
  .passthrough();

const AttachmentSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    mimeType: z.string(),
    size: z.number(),
    kind: z.enum(["image", "text"]),
    dataUrl: z.string().optional(),
    textContent: z.string().optional(),
  })
  .passthrough();

const WorkspaceChangeSetSchema = z
  .object({
    projectId: z.string(),
    files: z.array(
      z.object({
        path: z.string(),
        additions: z.number().int().nonnegative(),
        deletions: z.number().int().nonnegative(),
      }),
    ),
    appliedAt: z.coerce.date(),
    undoToken: z.string().optional(),
  })
  .passthrough();

const MessageSchema = z
  .object({
    id: z.string(),
    role: z.enum(["user", "assistant", "tool"]),
    content: z.string(),
    reasoningContent: z.string().optional(),
    responsesOutput: z.array(z.record(z.string(), z.unknown())).optional(),
    timestamp: z.coerce.date(),
    isStreaming: z.boolean().optional(),
    isSystem: z.boolean().optional(),
    excludeFromModelContext: z.boolean().optional(),
    contextDisclosure: z
      .object({
        omittedMessages: z.number().int().nonnegative(),
        condensedMessages: z.number().int().nonnegative(),
        summarizedToolResults: z.number().int().nonnegative(),
        originalTokens: z.number().int().nonnegative(),
        assembledTokens: z.number().int().nonnegative(),
      })
      .optional(),
    toolCall: ToolCallSchema.optional(),
    toolResult: ToolCallResultSchema.optional(),
    sources: z.array(SourceSchema).optional(),
    attachments: z.array(AttachmentSchema).optional(),
    mcpServerIds: z.array(z.string()).optional(),
    searchConfigId: z.string().optional(),
    thinkingDuration: z.number().nonnegative().optional(),
    workingDuration: z.number().nonnegative().optional(),
    workspaceChanges: WorkspaceChangeSetSchema.optional(),
  })
  .passthrough();

export const ConversationSchema = z
  .object({
    id: z.string(),
    title: z.string().default("Untitled"),
    timestamp: z.coerce.date(),
    messages: z.array(MessageSchema),
    model: z.string().default(""),
    projectId: z.string().optional(),
    isPinned: z.boolean().optional(),
    parentId: z.string().optional(),
    role: z.string().optional(),
    isSubagent: z.boolean().optional(),
    status: z.enum(["running", "idle", "error", "completed", "stopped"]).optional(),
    isTemporary: z.boolean().optional(),
    recursionDepth: z.number().int().nonnegative().optional(),
    pendingWorktree: z
      .object({
        path: z.string(),
        branch: z.string(),
        commitScope: z
          .object({
            projectId: z.string(),
            projectRoot: z.string(),
            modelId: z.string(),
          })
          .optional(),
      })
      .passthrough()
      .optional(),
    workspaceChanges: WorkspaceChangeSetSchema.optional(),
  })
  .passthrough();

const CustomThemeConfigSchema = z.object({
  preset: z.string(),
  background: z.string(),
  foreground: z.string(),
  accent: z.string(),
});

const ThemeConfigSchema = z.object({
  mode: z.enum(["light", "dark", "system"]),
  lightTheme: CustomThemeConfigSchema,
  darkTheme: CustomThemeConfigSchema,
  translucentSidebar: z.boolean().default(true),
});

export const DownloadedThemesSchema = z.object({
  light: z.record(z.string(), CustomThemeConfigSchema),
  dark: z.record(z.string(), CustomThemeConfigSchema),
});

export type DownloadedThemes = z.infer<typeof DownloadedThemesSchema>;

const ThemeSchema = z.union([z.enum(["light", "dark", "system"]), ThemeConfigSchema]);

const ApiKeysSchema = z.record(z.string(), z.string());

const ModelConfigSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    apiBase: z.string(),
    apiKey: z.string().default(""),
    modelId: z.string(),
    provider: z.string().optional(),
    enabled: z.boolean().optional(),
    supportsImages: z.boolean().optional(),
    contextSize: z.number().positive().optional(),
    maxOutputTokens: z.number().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
    thinkingLevel: z.enum(["auto", "off", "low", "medium", "high"]).optional(),
    systemPromptOverride: z.string().optional(),
  })
  .passthrough();

const ModelConfigsArraySchema = z.array(ModelConfigSchema);

const SearchConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.enum(["google", "searxng", "firecrawl", "custom"]),
  baseUrl: z.string(),
  apiKey: z.string().optional(),
  cx: z.string().optional(),
  maxResults: z.number(),
  enabled: z.boolean(),
});

const SearchConfigsArraySchema = z.array(SearchConfigSchema);

const FetchConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.enum(["firecrawl", "jina"]),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  enabled: z.boolean(),
});

const FetchConfigsArraySchema = z.array(FetchConfigSchema);

const KeybindActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  defaultCombo: z.string(),
  currentCombo: z.string(),
});

export const KeybindsSchema = z.record(z.string(), KeybindActionSchema);
export type KeybindsData = z.infer<typeof KeybindsSchema>;

const CONVERSATIONS_KEY = "sythoria-conversations";
export const PROJECTS_KEY = "sythoria-projects";
const PROJECTS_ENABLED_KEY = "sythoria-projects-enabled";
const PROJECTS_DEFAULT_PERMISSION_KEY = "sythoria-projects-default-permission";
const THEME_KEY = "sythoria-theme";
const API_KEYS_KEY = "sythoria-api-keys";
const SEARCH_CONFIGS_KEY = "sythoria-search-configs";
const FETCH_CONFIGS_KEY = "sythoria-fetch-configs";
const SEARCH_API_KEYS_KEY = "sythoria-search-api-keys";
const TITLE_CONFIG_KEY = "sythoria-title-config";
const MCP_CONFIGS_KEY = "sythoria-mcp-configs";
const MCP_ENABLED_SERVERS_KEY = "sythoria-enabled-mcp-chat-servers";
const GIT_CONFIG_KEY = "sythoria-git-config";
const APPSHOT_CONFIG_KEY = "sythoria-appshots-config";
const HAS_STARTED_KEY = "sythoria-has-started";
const ANIMATIONS_DISABLED_KEY = "sythoria-animations-disabled";
const DOWNLOADED_THEMES_KEY = "sythoria-downloaded-themes";
const KEYBINDS_KEY = "sythoria-keybinds";
const ZOOM_LEVEL_KEY = "sythoria-zoom-level";
const ALWAYS_ON_TOP_KEY = "sythoria-always-on-top";
const CLOSE_TO_TRAY_KEY = "sythoria-close-to-tray";
const LAUNCH_ON_STARTUP_KEY = "sythoria-launch-on-startup";
const SEND_MESSAGE_SHORTCUT_KEY = "sythoria-send-message-shortcut";
const CLEAR_INPUT_ON_ESCAPE_KEY = "sythoria-clear-input-on-escape";
const BASE_TEXT_SIZE_KEY = "sythoria-base-text-size";
const AUTO_UPDATE_CHECKING_KEY = "sythoria-auto-update-checking";
const SYSTEM_PROMPT_KEY = "sythoria-system-prompt";
const AUTO_GENERATE_MEMORY_KEY = "sythoria-auto-generate-memory";
const SHOW_CONTEXT_WINDOW_KEY = "sythoria-show-context-window";
const CONTEXT_TOKENIZATION_MODE_KEY = "sythoria-context-tokenization-mode";
const MAX_TOOL_STEPS_KEY = "sythoria-max-tool-steps";
const UNLIMITED_TOOL_STEPS_KEY = "sythoria-unlimited-tool-steps";
const SELECTED_MODEL_KEY = "sythoria-selected-model";
const LOGGING_ENABLED_KEY = "sythoria-is-logging-enabled";
const DISABLE_BG_ACTIVITY_KEY = "sythoria-disable-bg-activity";
const LANGUAGE_KEY = "sythoria-language";
const SKIP_LINK_WARNING_KEY = "sythoria-skip-link-warning";
const WHISPER_CONFIG_KEY = "sythoria-whisper-config";
const SIDEBAR_WIDTH_KEY = "sythoria-sidebar-width";
const AUX_PANEL_WIDTH_KEY = "sythoria-aux-panel-width";
const AUX_SUMMARY_PINNED_KEY = "sythoria-aux-summary-pinned";

interface PreferenceMutation {
  sets: Record<string, unknown>;
  deletes: string[];
  clear: boolean;
}

class EncryptedPreferenceStore {
  private data: Record<string, unknown>;
  private pendingSets = new Map<string, unknown>();
  private pendingDeletes = new Set<string>();
  private clearPending = false;
  private savePromise: Promise<void> | null = null;
  private suspended = false;

  constructor(data: Record<string, unknown>) {
    this.data = data;
  }

  async get<T>(key: string): Promise<T | null> {
    return (this.data[key] as T | undefined) ?? null;
  }

  async set(key: string, value: unknown): Promise<void> {
    if (this.suspended) return;
    this.data[key] = value;
    this.pendingDeletes.delete(key);
    this.pendingSets.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    if (this.suspended) return false;
    const existed = Object.prototype.hasOwnProperty.call(this.data, key);
    delete this.data[key];
    this.pendingSets.delete(key);
    this.pendingDeletes.add(key);
    return existed;
  }

  clear(): void {
    if (this.suspended) return;
    this.data = {};
    this.pendingSets.clear();
    this.pendingDeletes.clear();
    this.clearPending = true;
  }

  async save(): Promise<void> {
    if (this.suspended) return;
    if (!this.savePromise) {
      this.savePromise = Promise.resolve()
        .then(async () => {
          while (this.clearPending || this.pendingSets.size > 0 || this.pendingDeletes.size > 0) {
            const mutation: PreferenceMutation = {
              sets: Object.fromEntries(this.pendingSets),
              deletes: [...this.pendingDeletes],
              clear: this.clearPending,
            };
            this.pendingSets.clear();
            this.pendingDeletes.clear();
            this.clearPending = false;
            try {
              await invoke("mutate_encrypted_preferences", {
                sets: mutation.sets,
                deletes: mutation.deletes,
                clear: mutation.clear,
              });
            } catch (error) {
              if (mutation.clear) this.clearPending = true;
              for (const key of mutation.deletes) {
                if (!this.pendingSets.has(key)) this.pendingDeletes.add(key);
              }
              for (const [key, value] of Object.entries(mutation.sets)) {
                if (!this.pendingSets.has(key) && !this.pendingDeletes.has(key)) {
                  this.pendingSets.set(key, value);
                }
              }
              throw error;
            }
          }
        })
        .finally(() => {
          this.savePromise = null;
        });
    }
    await this.savePromise;
  }

  async suspend(): Promise<void> {
    this.suspended = true;
    this.pendingSets.clear();
    this.pendingDeletes.clear();
    this.clearPending = false;
    if (this.savePromise) await this.savePromise.catch(() => undefined);
  }

  resume(): void {
    this.suspended = false;
  }
}

let storeInstance: EncryptedPreferenceStore | null = null;
let storePromise: Promise<EncryptedPreferenceStore> | null = null;
let persistenceSuspendedForRecovery = false;

const LEGACY_BOOLEAN_KEYS = new Set([
  ALWAYS_ON_TOP_KEY,
  CLOSE_TO_TRAY_KEY,
  LAUNCH_ON_STARTUP_KEY,
  CLEAR_INPUT_ON_ESCAPE_KEY,
  AUTO_UPDATE_CHECKING_KEY,
  SHOW_CONTEXT_WINDOW_KEY,
  LOGGING_ENABLED_KEY,
  DISABLE_BG_ACTIVITY_KEY,
  SKIP_LINK_WARNING_KEY,
  ANIMATIONS_DISABLED_KEY,
  HAS_STARTED_KEY,
  PROJECTS_ENABLED_KEY,
  AUX_SUMMARY_PINNED_KEY,
  UNLIMITED_TOOL_STEPS_KEY,
]);
const LEGACY_NUMBER_KEYS = new Set([ZOOM_LEVEL_KEY, MAX_TOOL_STEPS_KEY, SIDEBAR_WIDTH_KEY, AUX_PANEL_WIDTH_KEY]);
const LEGACY_JSON_KEYS = new Set([THEME_KEY, DOWNLOADED_THEMES_KEY, KEYBINDS_KEY]);
const LEGACY_PREFERENCE_KEYS = [
  THEME_KEY,
  DOWNLOADED_THEMES_KEY,
  KEYBINDS_KEY,
  ZOOM_LEVEL_KEY,
  ALWAYS_ON_TOP_KEY,
  CLOSE_TO_TRAY_KEY,
  LAUNCH_ON_STARTUP_KEY,
  SEND_MESSAGE_SHORTCUT_KEY,
  CLEAR_INPUT_ON_ESCAPE_KEY,
  BASE_TEXT_SIZE_KEY,
  AUTO_UPDATE_CHECKING_KEY,
  SYSTEM_PROMPT_KEY,
  AUTO_GENERATE_MEMORY_KEY,
  SHOW_CONTEXT_WINDOW_KEY,
  CONTEXT_TOKENIZATION_MODE_KEY,
  MAX_TOOL_STEPS_KEY,
  UNLIMITED_TOOL_STEPS_KEY,
  SELECTED_MODEL_KEY,
  LOGGING_ENABLED_KEY,
  DISABLE_BG_ACTIVITY_KEY,
  LANGUAGE_KEY,
  SKIP_LINK_WARNING_KEY,
  ANIMATIONS_DISABLED_KEY,
  HAS_STARTED_KEY,
  PROJECTS_ENABLED_KEY,
  PROJECTS_DEFAULT_PERMISSION_KEY,
  SIDEBAR_WIDTH_KEY,
  AUX_PANEL_WIDTH_KEY,
  AUX_SUMMARY_PINNED_KEY,
];

function parseLegacyPreference(key: string, raw: string): unknown {
  if (LEGACY_BOOLEAN_KEYS.has(key)) return raw === "true";
  if (LEGACY_NUMBER_KEYS.has(key)) {
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  }
  if (LEGACY_JSON_KEYS.has(key) && (raw.startsWith("{") || raw.startsWith("["))) {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return raw;
}

async function migrateLegacyLocalStorage(store: EncryptedPreferenceStore): Promise<void> {
  if (typeof localStorage === "undefined") return;
  const migrated: string[] = [];
  for (const key of LEGACY_PREFERENCE_KEYS) {
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    if ((await store.get(key)) !== null) {
      localStorage.removeItem(key);
      continue;
    }
    const parsed = parseLegacyPreference(key, raw);
    if (parsed === undefined) {
      localStorage.removeItem(key);
      logWarn("storage", `Removed invalid legacy browser preference '${key}'`);
      continue;
    }
    await store.set(key, parsed);
    migrated.push(key);
  }
  if (migrated.length === 0) return;
  await store.save();
  migrated.forEach((key) => localStorage.removeItem(key));
  logInfo("storage", "Migrated legacy browser preferences to encrypted storage");
}

async function getStore(): Promise<EncryptedPreferenceStore> {
  if (storeInstance) return storeInstance;
  if (!storePromise) {
    storePromise = invoke<Record<string, unknown>>("load_encrypted_preferences")
      .then(async (data) => {
        const store = new EncryptedPreferenceStore(data);
        await migrateLegacyLocalStorage(store);
        if (persistenceSuspendedForRecovery) await store.suspend();
        storeInstance = store;
        return store;
      })
      .catch((error) => {
        storePromise = null;
        throw error;
      });
  }
  return storePromise;
}

export async function suspendPreferencePersistenceForWipe(): Promise<void> {
  if (storeInstance) await storeInstance.suspend();
}

export async function verifyEncryptedPreferences(): Promise<void> {
  await getStore();
}

export async function suspendPersistenceForRecovery(): Promise<void> {
  persistenceSuspendedForRecovery = true;
  pendingConversationSave = null;
  pendingProjectSave = null;
  pendingNetworkSettings = null;
  if (storeInstance) await storeInstance.suspend();
  await Promise.allSettled(
    [conversationSavePromise, projectSavePromise, networkSettingsSavePromise].filter(
      (promise): promise is Promise<void> => promise !== null,
    ),
  );
}

export function resumePreferencePersistenceAfterFailedWipe(): void {
  storeInstance?.resume();
}

export function resetPreferenceCacheAfterWipe(): void {
  storeInstance = null;
  storePromise = null;
}

export interface StoredWhisperConfig {
  isVoiceEnabled: boolean;
  selectedModelId: string;
  customModelPath: string | null;
  language: string;
  sttProvider: "local" | "cloud";
  cloudApiUrl: string;
  cloudModel: string;
  isLlmPolishEnabled: boolean;
  refinementModelId: string | null;
}

const StoredWhisperConfigSchema = z.object({
  isVoiceEnabled: z.boolean().optional(),
  selectedModelId: z.string().optional(),
  customModelPath: z.string().nullable().optional(),
  language: z.string().optional(),
  sttProvider: z.enum(["local", "cloud"]).optional(),
  cloudApiUrl: z.string().optional(),
  cloudModel: z.string().optional(),
  isLlmPolishEnabled: z.boolean().optional(),
  refinementModelId: z.string().nullable().optional(),
});

export async function loadWhisperConfig(): Promise<{
  config: Partial<StoredWhisperConfig>;
  legacyCloudApiKey: string;
}> {
  const store = await getStore();
  const encrypted = StoredWhisperConfigSchema.safeParse(await store.get(WHISPER_CONFIG_KEY));
  let legacyCloudApiKey = "";
  let legacyConfig: Partial<StoredWhisperConfig> = {};

  if (typeof localStorage !== "undefined") {
    const localData = localStorage.getItem(WHISPER_CONFIG_KEY);
    if (localData) {
      try {
        const parsed: unknown = JSON.parse(localData);
        if (parsed && typeof parsed === "object" && "cloudApiKey" in parsed) {
          const value = (parsed as { cloudApiKey?: unknown }).cloudApiKey;
          if (typeof value === "string") legacyCloudApiKey = value;
        }
        const validated = StoredWhisperConfigSchema.safeParse(parsed);
        if (validated.success) legacyConfig = validated.data;
      } catch (error) {
        logWarn("storage", "Legacy speech configuration could not be parsed", {
          details: String(error),
        });
      }
    }
  }

  return {
    config: encrypted.success ? encrypted.data : legacyConfig,
    legacyCloudApiKey,
  };
}

export async function saveWhisperConfig(config: StoredWhisperConfig): Promise<void> {
  const validated = StoredWhisperConfigSchema.parse(config);
  const store = await getStore();
  await store.set(WHISPER_CONFIG_KEY, validated);
  await store.save();
}

export function removeLegacyWhisperConfig(): void {
  if (typeof localStorage !== "undefined") localStorage.removeItem(WHISPER_CONFIG_KEY);
}

export interface UiLayoutSettings {
  sidebarWidth: number;
  auxPanelWidth: number;
}

export async function loadUiLayoutSettings(): Promise<Partial<UiLayoutSettings>> {
  const store = await getStore();
  const sidebarWidth = await store.get(SIDEBAR_WIDTH_KEY);
  const auxPanelWidth = await store.get(AUX_PANEL_WIDTH_KEY);
  return {
    ...(typeof sidebarWidth === "number" ? { sidebarWidth } : {}),
    ...(typeof auxPanelWidth === "number" ? { auxPanelWidth } : {}),
  };
}

export async function saveUiLayoutSettings(settings: Partial<UiLayoutSettings>): Promise<void> {
  const store = await getStore();
  if (settings.sidebarWidth !== undefined) await store.set(SIDEBAR_WIDTH_KEY, settings.sidebarWidth);
  if (settings.auxPanelWidth !== undefined) await store.set(AUX_PANEL_WIDTH_KEY, settings.auxPanelWidth);
  await store.save();
}

let preservedInvalidConversations: unknown[] = [];

function parseConversations(raw: unknown): Conversation[] {
  if (!Array.isArray(raw)) {
    logWarn("storage", "Stored conversations failed validation: expected array", {
      action: "The stored data was left untouched and will not be overwritten.",
    });
    return [];
  }
  const valid: Conversation[] = [];
  const invalid: unknown[] = [];
  for (const item of raw) {
    const result = ConversationSchema.safeParse(item);
    if (result.success) {
      valid.push(result.data as Conversation);
    } else {
      invalid.push(item);
      logWarn("storage", "Skipping invalid conversation", {
        details: result.error.message,
        action: "One conversation could not be displayed, but its encrypted record will be preserved.",
      });
    }
  }
  preservedInvalidConversations = invalid;
  return valid;
}

export async function loadConversations(): Promise<Conversation[]> {
  try {
    const encrypted = await invoke<unknown>("load_encrypted_conversations");
    if (encrypted !== null) {
      const conversations = parseConversations(encrypted);
      try {
        const store = await getStore();
        if (await store.delete(CONVERSATIONS_KEY)) await store.save();
        localStorage.removeItem(CONVERSATIONS_KEY);
      } catch (cleanupError) {
        logWarn("storage", "Could not remove a legacy plaintext conversation copy", {
          details: String(cleanupError),
        });
      }
      return conversations;
    }

    // One-time migration from the legacy plaintext plugin store.
    const store = await getStore();
    const raw = await store.get<unknown>(CONVERSATIONS_KEY);
    if (Array.isArray(raw)) {
      const conversations = parseConversations(raw);
      await invoke("save_encrypted_conversations", { conversations: raw });
      await store.delete(CONVERSATIONS_KEY);
      await store.save();
      localStorage.removeItem(CONVERSATIONS_KEY);
      logInfo("storage", "Migrated conversations to encrypted storage");
      return conversations;
    }

    const fallback = localStorage.getItem(CONVERSATIONS_KEY);
    if (fallback) {
      const parsed: unknown = JSON.parse(fallback);
      if (!Array.isArray(parsed)) {
        throw new Error("Legacy conversations must be an array");
      }
      const conversations = parseConversations(parsed);
      await invoke("save_encrypted_conversations", { conversations: parsed });
      localStorage.removeItem(CONVERSATIONS_KEY);
      logInfo("storage", "Migrated localStorage conversations to encrypted storage");
      return conversations;
    }
  } catch (e) {
    logError("storage", "Failed to load or migrate encrypted conversations", {
      error: e,
      action: "The existing data was left untouched. Check OS credential-vault access, then restart the app.",
    });
    throw e;
  }
  return [];
}

let pendingConversationSave: unknown[] | null = null;
let conversationSavePromise: Promise<void> | null = null;
let conversationsAreBeingCleared = false;

export async function suspendConversationPersistenceForWipe(): Promise<void> {
  conversationsAreBeingCleared = true;
  pendingConversationSave = null;
  if (conversationSavePromise) {
    await conversationSavePromise.catch(() => undefined);
  }
}

export function resumeConversationPersistenceAfterFailedWipe(): void {
  conversationsAreBeingCleared = false;
}

export async function saveConversations(conversations: Conversation[]): Promise<void> {
  if (conversationsAreBeingCleared || persistenceSuspendedForRecovery) return;
  pendingConversationSave = [...conversations, ...preservedInvalidConversations];
  if (!conversationSavePromise) {
    conversationSavePromise = Promise.resolve()
      .then(async () => {
        while (pendingConversationSave) {
          const payload = pendingConversationSave;
          pendingConversationSave = null;
          await invoke("save_encrypted_conversations", { conversations: payload });
        }
      })
      .catch((error) => {
        logError("storage", "Failed to save encrypted conversations", {
          error,
          action: "Check OS credential-vault access and available disk space. The previous snapshot remains intact.",
        });
        throw error;
      })
      .finally(() => {
        conversationSavePromise = null;
      });
  }

  try {
    await conversationSavePromise;
  } catch (error) {
    if (pendingConversationSave) {
      // A later call will retry the newest complete snapshot.
      conversationSavePromise = null;
    }
    throw error;
  }
}

export async function loadProjects(): Promise<Project[]> {
  try {
    const projects = await invoke<unknown>("load_projects");
    return ProjectsArraySchema.parse(projects);
  } catch (e) {
    logError("storage", "Failed to load projects", { error: e });
    throw e;
  }
}

let pendingProjectSave: Project[] | null = null;
let projectSavePromise: Promise<void> | null = null;

function startProjectSaveDrain(): Promise<void> {
  const drain = Promise.resolve()
    .then(async () => {
      while (pendingProjectSave) {
        const payload = pendingProjectSave;
        pendingProjectSave = null;
        await invoke("save_projects", { projects: payload });
      }
    })
    .catch((error) => {
      logError("storage", "Failed to save projects", { error });
      throw error;
    })
    .finally(() => {
      if (projectSavePromise === drain) projectSavePromise = null;
    });
  projectSavePromise = drain;
  return drain;
}

export async function saveProjects(projects: Project[]): Promise<void> {
  if (persistenceSuspendedForRecovery) return;
  pendingProjectSave = ProjectsArraySchema.parse(projects).map((project) => ({
    ...project,
    excludePatterns: project.excludePatterns ? [...project.excludePatterns] : undefined,
  }));

  // Re-check after each drain. A save can arrive after the drain observes an
  // empty queue but before its finally handler clears projectSavePromise.
  while (pendingProjectSave || projectSavePromise) {
    const activeSave = projectSavePromise ?? startProjectSaveDrain();
    await activeSave;
  }
}

export async function loadTheme(): Promise<ThemeConfig> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(THEME_KEY);
    const result = ThemeSchema.safeParse(raw);
    if (result.success) {
      const data = result.data;
      if (typeof data === "string") {
        return {
          ...DEFAULT_THEME_CONFIG,
          mode: data as "light" | "dark" | "system",
        };
      }
      const loaded: ThemeConfig = { ...data };
      if (loaded.lightTheme?.preset === "Sythoria Light") {
        loaded.lightTheme = { ...DEFAULT_THEME_CONFIG.lightTheme };
      }
      if (loaded.darkTheme?.preset === "Sythoria Dark") {
        loaded.darkTheme = { ...DEFAULT_THEME_CONFIG.darkTheme };
      }
      return loaded;
    }
  } catch (e) {
    logError("storage", "Failed to load theme from encrypted storage", {
      error: e,
      action: "Using system theme preference as fallback.",
    });
  }
  return DEFAULT_THEME_CONFIG;
}

export async function saveTheme(theme: ThemeConfig): Promise<void> {
  try {
    const store = await getStore();
    await store.set(THEME_KEY, theme);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save theme to encrypted storage", {
      error: e,
      action: "Theme may not persist across sessions. Try restarting the app.",
    });
  }
}

export async function loadDownloadedThemes(): Promise<DownloadedThemes> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(DOWNLOADED_THEMES_KEY);
    const result = DownloadedThemesSchema.safeParse(raw);
    if (result.success) return result.data;
  } catch (e) {
    logError("storage", "Failed to load downloaded themes from app store", { error: e });
  }
  return { light: {}, dark: {} };
}

export async function saveDownloadedThemes(themes: DownloadedThemes): Promise<void> {
  try {
    const store = await getStore();
    await store.set(DOWNLOADED_THEMES_KEY, themes);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save downloaded themes to app store", { error: e });
  }
}

export async function loadKeybinds(): Promise<KeybindsData | null> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(KEYBINDS_KEY);
    const result = KeybindsSchema.safeParse(raw);
    if (result.success) return result.data;
  } catch (e) {
    logError("storage", "Failed to load keybinds from app store", { error: e });
  }
  return null;
}

export async function saveKeybinds(keybinds: KeybindsData): Promise<void> {
  try {
    const store = await getStore();
    await store.set(KEYBINDS_KEY, keybinds);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save keybinds to app store", { error: e });
  }
}

export async function loadZoomLevel(): Promise<number> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(ZOOM_LEVEL_KEY);
    if (typeof raw === "number") return raw;
  } catch (e) {
    logError("storage", "Failed to load zoom level from app store", { error: e });
  }
  return 1.0;
}

export async function saveZoomLevel(level: number): Promise<void> {
  try {
    const store = await getStore();
    await store.set(ZOOM_LEVEL_KEY, level);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save zoom level to app store", { error: e });
  }
}

export function applyZoom(level: number) {
  if (typeof document === "undefined") return;
  (document.body.style as CSSStyleDeclaration & { zoom?: string }).zoom = level.toString();
}

export async function loadApiKeys(options: { critical?: boolean } = {}): Promise<Record<string, string>> {
  try {
    const raw = await invoke<unknown>("load_api_keys");
    const result = ApiKeysSchema.safeParse(raw);
    if (!result.success) throw result.error;
    if (Object.keys(result.data).length > 0) return result.data;
  } catch (e) {
    logError("storage", "Failed to load encrypted API keys", {
      error: e,
      action:
        "Check that the app can access its root key in the OS credential vault. You may need to re-enter your API keys in Settings > Model Providers.",
    });
    if (options.critical) throw e;
  }

  try {
    const store = await getStore();
    const legacyRaw = await store.get<unknown>(API_KEYS_KEY);
    const legacy = ApiKeysSchema.safeParse(legacyRaw);
    if (legacy.success && Object.keys(legacy.data).length > 0) {
      if (!(await saveApiKeys(legacy.data))) {
        return legacy.data;
      }
      await store.delete(API_KEYS_KEY);
      await store.save();
      return legacy.data;
    }
    if (legacyRaw) {
      if (!legacy.success)
        logWarn("storage", "Stored API keys failed validation, resetting", {
          details: legacy.error?.message,
          action: "API keys were corrupted. Please re-enter them in Settings > Model Providers.",
        });
      await store.delete(API_KEYS_KEY);
    }
  } catch (e) {
    logError("storage", "Failed to migrate legacy API keys", {
      error: e,
      action: "Could not migrate old API keys from store. Re-enter them in Settings > Model Providers.",
    });
    if (options.critical) throw e;
  }
  return {};
}

export async function saveApiKeys(keys: Record<string, string>): Promise<boolean> {
  if (persistenceSuspendedForRecovery) return false;
  try {
    await invoke("save_api_keys_cmd", { keys });
    return true;
  } catch (e) {
    logError("storage", "Failed to save encrypted API keys", {
      error: e,
      action: "API keys may not persist. Try re-entering them in Settings > Model Providers.",
    });
    return false;
  }
}

export async function loadSearchConfigs(): Promise<import("../types").SearchApiConfig[] | null> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(SEARCH_CONFIGS_KEY);
    if (raw) {
      const result = SearchConfigsArraySchema.safeParse(raw);
      if (result.success) return result.data as import("../types").SearchApiConfig[];
      logWarn("storage", "Stored search configs failed validation", {
        details: result.error?.message,
        action: "Search provider configs were corrupted. Please re-configure them in Settings > Web Search.",
      });
    }
  } catch (e) {
    logError("storage", "Failed to load search configs from app store", {
      error: e,
      action: "Search configuration could not be loaded. Re-configure in Settings > Web Search.",
    });
  }
  return null;
}

export async function saveSearchConfigs(configs: import("../types").SearchApiConfig[]): Promise<void> {
  try {
    const store = await getStore();
    const stripped = configs.map(({ apiKey: _apiKey, ...config }) => config);
    await store.set(SEARCH_CONFIGS_KEY, stripped);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save search configs to app store", {
      error: e,
      action: "Search configuration may not persist. Try re-entering in Settings > Web Search.",
    });
  }
}

export async function loadFetchConfigs(): Promise<import("../types").FetchApiConfig[] | null> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(FETCH_CONFIGS_KEY);
    if (raw) {
      const result = FetchConfigsArraySchema.safeParse(raw);
      if (result.success) return result.data as import("../types").FetchApiConfig[];
      logWarn("storage", "Stored fetch configs failed validation", {
        details: result.error?.message,
        action: "Fetch provider configs were corrupted. Please re-configure them in Settings > Web Search.",
      });
    }
  } catch (e) {
    logError("storage", "Failed to load fetch configs from app store", {
      error: e,
      action: "Fetch configuration could not be loaded. Re-configure in Settings > Web Search.",
    });
  }
  return null;
}

export async function saveFetchConfigs(configs: import("../types").FetchApiConfig[]): Promise<void> {
  try {
    const store = await getStore();
    const stripped = configs.map(({ apiKey: _apiKey, ...config }) => config);
    await store.set(FETCH_CONFIGS_KEY, stripped);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save fetch configs to app store", {
      error: e,
      action: "Fetch configuration may not persist. Try re-entering in Settings > Web Search.",
    });
  }
}

export async function clearConversations(): Promise<void> {
  if (persistenceSuspendedForRecovery) return;
  conversationsAreBeingCleared = true;
  try {
    pendingConversationSave = null;
    if (conversationSavePromise) {
      await conversationSavePromise.catch(() => undefined);
    }
    await invoke("clear_encrypted_conversations");
    const store = await getStore();
    await store.delete(CONVERSATIONS_KEY);
    await store.save();
    preservedInvalidConversations = [];
  } catch (e) {
    logError("storage", "Failed to clear encrypted conversations", {
      error: e,
      action: "Some conversations may still be stored. Retry after checking credential-vault and disk access.",
    });
    throw e;
  } finally {
    conversationsAreBeingCleared = false;
  }
  localStorage.removeItem(CONVERSATIONS_KEY);
}

export async function loadSearchApiKeys(): Promise<Record<string, string>> {
  try {
    const raw = await invoke<unknown>("load_search_api_keys");
    const result = ApiKeysSchema.safeParse(raw);
    if (result.success && Object.keys(result.data).length > 0) return result.data;
  } catch (e) {
    logError("storage", "Failed to load encrypted search API keys", {
      error: e,
      action: "Re-enter your search API keys in Settings > Web Search.",
    });
  }

  try {
    const store = await getStore();
    const legacyRaw = await store.get<unknown>(SEARCH_API_KEYS_KEY);
    const legacy = ApiKeysSchema.safeParse(legacyRaw);
    if (legacy.success && Object.keys(legacy.data).length > 0) {
      if (!(await saveSearchApiKeys(legacy.data))) {
        return legacy.data;
      }
      await store.delete(SEARCH_API_KEYS_KEY);
      await store.save();
      return legacy.data;
    }
    if (legacyRaw) {
      if (!legacy.success)
        logWarn("storage", "Stored search API keys failed validation, resetting", {
          details: legacy.error?.message,
          action: "Search API keys were corrupted. Please re-enter them in Settings > Web Search.",
        });
      await store.delete(SEARCH_API_KEYS_KEY);
    }
  } catch (e) {
    logError("storage", "Failed to migrate legacy search API keys", {
      error: e,
      action: "Could not migrate old search API keys. Re-enter them in Settings > Web Search.",
    });
  }
  return {};
}

export async function saveSearchApiKeys(keys: Record<string, string>): Promise<boolean> {
  if (persistenceSuspendedForRecovery) return false;
  try {
    await invoke("save_search_api_keys_cmd", { keys });
    return true;
  } catch (e) {
    logError("storage", "Failed to save encrypted search API keys", {
      error: e,
      action: "Search API keys may not persist. Re-enter them in Settings > Web Search.",
    });
    return false;
  }
}

const TitleConfigSchema = z.object({
  enabled: z.boolean().default(true),
  modelId: z.string().default("__same__"),
  systemPrompt: z.string().default(DEFAULT_TITLE_SYSTEM_PROMPT),
});

const DEFAULT_TITLE_CONFIG: TitleGenerationConfig = {
  enabled: true,
  modelId: "__same__",
  systemPrompt: DEFAULT_TITLE_SYSTEM_PROMPT,
};

export async function loadTitleConfig(): Promise<TitleGenerationConfig> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(TITLE_CONFIG_KEY);
    if (raw) {
      const result = TitleConfigSchema.safeParse(raw);
      if (result.success) return { ...DEFAULT_TITLE_CONFIG, ...result.data };
      logWarn("storage", "Stored title config failed validation, resetting", {
        details: result.error?.message,
        action: "Title generation settings were reset to defaults. Re-configure in Settings.",
      });
    }
  } catch (e) {
    logError("storage", "Failed to load title config from app store", {
      error: e,
      action: "Using default title generation settings.",
    });
  }
  return { ...DEFAULT_TITLE_CONFIG };
}

export async function saveTitleConfig(config: TitleGenerationConfig): Promise<void> {
  try {
    const store = await getStore();
    await store.set(TITLE_CONFIG_KEY, config);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save title config to app store", {
      error: e,
      action: "Title generation settings may not persist.",
    });
  }
}

export async function loadHasStarted(): Promise<boolean> {
  try {
    const store = await getStore();
    const raw = await store.get<boolean>(HAS_STARTED_KEY);
    if (raw === true) return true;
  } catch (e) {
    logError("storage", "Failed to load hasStarted from store", { error: e });
  }
  return false;
}

export async function saveHasStarted(started: boolean): Promise<void> {
  try {
    const store = await getStore();
    await store.set(HAS_STARTED_KEY, started);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save hasStarted to store", { error: e });
  }
}

export async function loadAnimationsDisabled(): Promise<boolean> {
  try {
    const store = await getStore();
    const raw = await store.get<boolean>(ANIMATIONS_DISABLED_KEY);
    if (raw === true) return true;
  } catch (e) {
    logError("storage", "Failed to load animationsDisabled from store", { error: e });
  }
  return false;
}

export async function saveAnimationsDisabled(disabled: boolean): Promise<void> {
  try {
    const store = await getStore();
    await store.set(ANIMATIONS_DISABLED_KEY, disabled);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save animationsDisabled to store", { error: e });
  }
}

export async function loadSkipExternalLinkWarning(): Promise<boolean> {
  try {
    const store = await getStore();
    const raw = await store.get<boolean>(SKIP_LINK_WARNING_KEY);
    if (raw === true) return true;
  } catch (e) {
    logError("storage", "Failed to load skipExternalLinkWarning from store", { error: e });
  }
  return false;
}

export async function saveSkipExternalLinkWarning(skip: boolean): Promise<void> {
  try {
    const store = await getStore();
    await store.set(SKIP_LINK_WARNING_KEY, skip);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save skipExternalLinkWarning to store", { error: e });
  }
}

export interface GitConfig {
  repoPath: string;
  isAutoCommitEnabled: boolean;
  isAiCommitMsgEnabled: boolean;
  isPreCommitEnabled: boolean;
  overrideIdentity: boolean;
  gitName: string;
  gitEmail: string;
}

const GitConfigSchema = z.object({
  repoPath: z.string().default(""),
  isAutoCommitEnabled: z.boolean().default(false),
  isAiCommitMsgEnabled: z.boolean().default(true),
  isPreCommitEnabled: z.boolean().default(true),
  overrideIdentity: z.boolean().default(false),
  gitName: z.string().default("Sythoria AI"),
  gitEmail: z.string().default("assistant@sythoria.local"),
});

export interface AppshotConfig {
  enabled: boolean;
  captureFolder: string;
  imageFormat: "png" | "jpeg";
  imageQuality: number;
  autoCleanEnabled: boolean;
  autoCleanType: "count" | "size" | "age";
  autoCleanValue: number;
  saveToGallery: boolean;
}

const AppshotConfigSchema = z.object({
  enabled: z.boolean().default(true),
  captureFolder: z.string().default(""),
  imageFormat: z.enum(["png", "jpeg"]).default("png"),
  imageQuality: z.number().int().min(10).max(100).default(85),
  autoCleanEnabled: z.boolean().default(true),
  autoCleanType: z.enum(["count", "size", "age"]).default("count"),
  autoCleanValue: z.number().int().min(1).max(1_000_000).default(50),
  saveToGallery: z.boolean().default(false),
});

export const McpServerConfigSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    transport: z.enum(["stdio", "sse", "streamable-http"]),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    baseUrl: z.string().optional(),
    apiKey: z.string().optional(),
    enabled: z.boolean(),
    trustLevel: z.enum(["trusted", "untrusted"]).default("untrusted"),
    catalogPluginId: z.string().optional(),
  })
  .passthrough();

const McpConfigsArraySchema = z.array(McpServerConfigSchema);
let mcpConfigWritesBlockedBySecretMigration = false;

/**
 * Migrates legacy stdio MCP configs to the program-only `command` + `args[]`
 * format. Older versions stored the entire command line in `command` (e.g.
 * `"npx -y @modelcontextprotocol/server-filesystem"`); the new contract keeps
 * the executable in `command` and every argument in `args`.
 *
 * Idempotent: configs whose `command` is already a single token are returned
 * unchanged. Only stdio configs with a multi-token `command` are rewritten.
 */
export function migrateMcpConfigs(configs: import("../types").McpServerConfig[]): import("../types").McpServerConfig[] {
  const commandMigrated = configs.map((c) => {
    if (c.transport !== "stdio") return c;
    const raw = (c.command ?? "").trim();
    if (!raw) return c;

    // Single token — already in the new format (or a bare executable name).
    const tokens = raw.split(/\s+/);
    if (tokens.length <= 1) return c;

    const [program, ...commandArgs] = tokens;
    const existingArgs = c.args ?? [];
    // Merge the args extracted from the command line with any explicitly-set
    // args. Drop duplicate `-y`/`--yes` that the old npx heuristic auto-added.
    const merged = [...commandArgs, ...existingArgs];
    const dedupedYes = dedupAutoYes(merged);

    return { ...c, command: program, args: dedupedYes };
  });

  return commandMigrated.map((config) => {
    const verifiedPlugin = verifiedCatalogPluginForConfig(config);
    if (verifiedPlugin) {
      return {
        ...config,
        catalogPluginId: verifiedPlugin.id,
        trustLevel: "trusted" as const,
      };
    }
    if (!config.catalogPluginId) return config;
    const customConfig = { ...config };
    delete customConfig.catalogPluginId;
    return { ...customConfig, trustLevel: "untrusted" as const };
  });
}

/** Keeps the first `-y`/`--yes` and drops subsequent duplicates. */
function dedupAutoYes(args: string[]): string[] {
  let seenYes = false;
  return args.filter((a) => {
    if (a === "-y" || a === "--yes") {
      if (seenYes) return false;
      seenYes = true;
    }
    return true;
  });
}

export async function loadMcpConfigs(): Promise<import("../types").McpServerConfig[] | null> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(MCP_CONFIGS_KEY);
    if (raw) {
      const result = McpConfigsArraySchema.safeParse(raw);
      if (result.success) {
        let migrated = migrateMcpConfigs(result.data as import("../types").McpServerConfig[]);

        // Migrate any plaintext apiKeys found in the config file to native encrypted storage.
        const configsWithApiKeys = migrated.filter((c) => c.apiKey && c.apiKey.trim() !== "");
        if (configsWithApiKeys.length > 0) {
          logInfo(
            "storage",
            `Migrating ${configsWithApiKeys.length} plaintext MCP API key(s) to encrypted storage`,
            {},
          );
          const currentKeys = await loadMcpApiKeys();
          const updatedKeys = { ...currentKeys };
          for (const c of configsWithApiKeys) {
            updatedKeys[c.id] = c.apiKey!;
          }
          if (!(await saveMcpApiKeys(updatedKeys))) {
            mcpConfigWritesBlockedBySecretMigration = true;
            return migrated;
          }
          mcpConfigWritesBlockedBySecretMigration = false;

          // Strip apiKey from the stored configs
          migrated = migrated.map(({ apiKey: _apiKey, ...rest }) => rest as import("../types").McpServerConfig);
          await store.set(MCP_CONFIGS_KEY, migrated);
          await store.save();
        } else if (JSON.stringify(migrated) !== JSON.stringify(result.data)) {
          // Persist the migrated form so subsequent loads are clean.
          // Strip API keys to be safe
          const stripped = migrated.map(({ apiKey: _apiKey, ...rest }) => rest as import("../types").McpServerConfig);
          await store.set(MCP_CONFIGS_KEY, stripped);
          await store.save();
          migrated = stripped;
          logInfo("storage", "Migrated MCP config format and catalog verification", {
            details: `${migrated.length} server(s) processed`,
          });
        }
        return migrated;
      }
      logWarn("storage", "Stored MCP configs failed validation", {
        details: result.error?.message,
        action: "MCP server configs were corrupted. Re-configure in Settings > MCP Servers.",
      });
    }
  } catch (e) {
    logError("storage", "Failed to load MCP configs from app store", {
      error: e,
      action: "MCP server configuration could not be loaded. Re-configure in Settings > MCP Servers.",
    });
  }
  return null;
}

export async function saveMcpConfigs(configs: import("../types").McpServerConfig[]): Promise<void> {
  if (mcpConfigWritesBlockedBySecretMigration) {
    logWarn("storage", "MCP config save skipped because plaintext-key migration is incomplete", {
      action: "Restore OS credential-vault access and restart before changing MCP server settings.",
    });
    return;
  }
  try {
    const store = await getStore();
    // Strip apiKey from all configs before saving to disk
    const stripped = configs.map(({ apiKey: _apiKey, ...rest }) => rest as import("../types").McpServerConfig);
    await store.set(MCP_CONFIGS_KEY, stripped);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save MCP configs to app store", {
      error: e,
      action: "MCP server config may not persist. Re-configure in Settings > MCP Servers.",
    });
  }
}

export async function loadMcpApiKeys(): Promise<Record<string, string>> {
  try {
    const raw = await invoke<unknown>("load_mcp_api_keys");
    const result = ApiKeysSchema.safeParse(raw);
    if (result.success && Object.keys(result.data).length > 0) return result.data;
  } catch (e) {
    logError("storage", "Failed to load encrypted MCP API keys", {
      error: e,
      action: "Re-enter your MCP API keys in Settings > MCP Servers.",
    });
  }
  return {};
}

export async function saveMcpApiKeys(keys: Record<string, string>): Promise<boolean> {
  if (persistenceSuspendedForRecovery) return false;
  try {
    await invoke("save_mcp_api_keys_cmd", { keys });
    return true;
  } catch (e) {
    logError("storage", "Failed to save encrypted MCP API keys", {
      error: e,
      action: "MCP API keys may not persist. Re-enter them in Settings > MCP Servers.",
    });
    return false;
  }
}

export async function loadMcpEnvSecrets(): Promise<Record<string, Record<string, string>>> {
  try {
    const raw = await invoke<unknown>("load_mcp_env_secrets");
    const result = z.record(z.string(), z.record(z.string(), z.string())).safeParse(raw);
    if (result.success && Object.keys(result.data).length > 0) return result.data;
  } catch (e) {
    logError("storage", "Failed to load encrypted MCP environment secrets", {
      error: e,
      action: "MCP environment secrets could not be loaded. Re-enter them in Settings > MCP Servers.",
    });
  }
  return {};
}

export async function saveMcpEnvSecrets(secrets: Record<string, Record<string, string>>): Promise<void> {
  if (persistenceSuspendedForRecovery) return;
  try {
    await invoke("save_mcp_env_secrets_cmd", { secrets });
  } catch (e) {
    logError("storage", "Failed to save encrypted MCP environment secrets", {
      error: e,
      action: "MCP environment secrets may not persist. Re-enter them in Settings > MCP Servers.",
    });
  }
}

export async function loadModelConfigs(): Promise<ModelConfig[] | null> {
  try {
    const raw = await invoke<string>("load_config");
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      const result = ModelConfigsArraySchema.safeParse(parsed);
      if (result.success && result.data.length > 0) {
        return result.data as ModelConfig[];
      }
      if (!result.success) {
        logWarn("storage", "Stored model configuration failed validation", {
          details: result.error.message,
          action: "The configuration file was preserved. Correct it or restore a known-good copy.",
        });
        throw result.error;
      }
    }
  } catch (e) {
    logError("storage", "Failed to load config from system", {
      error: e,
      action: "Model configuration could not be loaded. Re-configure in Settings > Model Providers.",
    });
    throw e;
  }
  return null;
}

export async function saveModelConfigs(configs: ModelConfig[]) {
  if (persistenceSuspendedForRecovery) return;
  try {
    const stripped = configs.map(({ apiKey: _apiKey, ...config }) => config);
    await invoke("save_config", { config: JSON.stringify(stripped) });
  } catch (e) {
    logError("storage", "Failed to save config to system", {
      error: e,
      action: "Model configuration may not persist. Re-enter in Settings > Model Providers.",
    });
  }
}

export async function loadSelectedModel(): Promise<string> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(SELECTED_MODEL_KEY);
    if (typeof raw === "string") return raw;
  } catch (e) {
    logError("storage", "Failed to load selected model", { error: e });
  }
  return "";
}

export async function saveSelectedModel(modelId: string): Promise<void> {
  try {
    const store = await getStore();
    await store.set(SELECTED_MODEL_KEY, modelId);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save selected model", { error: e });
  }
}

export async function loadAlwaysOnTop(): Promise<boolean> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(ALWAYS_ON_TOP_KEY);
    if (typeof raw === "boolean") return raw;
  } catch (e) {
    logError("storage", "Failed to load always on top setting", { error: e });
  }
  return false;
}

export async function saveAlwaysOnTop(value: boolean): Promise<void> {
  try {
    const store = await getStore();
    await store.set(ALWAYS_ON_TOP_KEY, value);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save always on top setting", { error: e });
  }
}

export async function loadCloseToTray(): Promise<boolean> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(CLOSE_TO_TRAY_KEY);
    if (typeof raw === "boolean") return raw;
  } catch (e) {
    logError("storage", "Failed to load close to tray setting", { error: e });
  }
  return false;
}

export async function saveCloseToTray(value: boolean): Promise<void> {
  try {
    const store = await getStore();
    await store.set(CLOSE_TO_TRAY_KEY, value);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save close to tray setting", { error: e });
  }
}

export async function loadLaunchOnStartup(): Promise<boolean> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(LAUNCH_ON_STARTUP_KEY);
    if (typeof raw === "boolean") return raw;
  } catch (e) {
    logError("storage", "Failed to load launch on startup setting", { error: e });
  }
  return false;
}

export async function saveLaunchOnStartup(value: boolean): Promise<void> {
  try {
    const store = await getStore();
    await store.set(LAUNCH_ON_STARTUP_KEY, value);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save launch on startup setting", { error: e });
  }
}

export async function loadSendMessageShortcut(): Promise<"enter" | "ctrl-enter"> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(SEND_MESSAGE_SHORTCUT_KEY);
    if (raw === "enter" || raw === "ctrl-enter") return raw;
  } catch (e) {
    logError("storage", "Failed to load send message shortcut setting", { error: e });
  }
  return "enter";
}

export async function saveSendMessageShortcut(value: "enter" | "ctrl-enter"): Promise<void> {
  try {
    const store = await getStore();
    await store.set(SEND_MESSAGE_SHORTCUT_KEY, value);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save send message shortcut setting", { error: e });
  }
}

export async function loadClearInputOnEscape(): Promise<boolean> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(CLEAR_INPUT_ON_ESCAPE_KEY);
    if (typeof raw === "boolean") return raw;
  } catch (e) {
    logError("storage", "Failed to load clear input on escape setting", { error: e });
  }
  return false;
}

export async function saveClearInputOnEscape(value: boolean): Promise<void> {
  try {
    const store = await getStore();
    await store.set(CLEAR_INPUT_ON_ESCAPE_KEY, value);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save clear input on escape setting", { error: e });
  }
}

export async function loadBaseTextSize(): Promise<"small" | "medium" | "large" | "xlarge"> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(BASE_TEXT_SIZE_KEY);
    if (raw === "small" || raw === "medium" || raw === "large" || raw === "xlarge") return raw;
  } catch (e) {
    logError("storage", "Failed to load base text size setting", { error: e });
  }
  return "medium";
}

export async function saveBaseTextSize(value: "small" | "medium" | "large" | "xlarge"): Promise<void> {
  try {
    const store = await getStore();
    await store.set(BASE_TEXT_SIZE_KEY, value);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save base text size setting", { error: e });
  }
}

export async function loadLanguage(): Promise<string> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(LANGUAGE_KEY);
    if (typeof raw === "string") return raw;
  } catch (e) {
    logError("storage", "Failed to load language setting", { error: e });
  }
  return "en";
}

export async function saveLanguage(value: string): Promise<void> {
  try {
    const store = await getStore();
    await store.set(LANGUAGE_KEY, value);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save language setting", { error: e });
  }
}

export async function loadAutoUpdateChecking(): Promise<boolean> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(AUTO_UPDATE_CHECKING_KEY);
    if (typeof raw === "boolean") return raw;
  } catch (e) {
    logError("storage", "Failed to load auto update checking setting", { error: e });
  }
  return true;
}

export async function saveAutoUpdateChecking(value: boolean): Promise<void> {
  try {
    const store = await getStore();
    await store.set(AUTO_UPDATE_CHECKING_KEY, value);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save auto update checking setting", { error: e });
  }
}

export async function loadSystemPrompt(): Promise<string> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(SYSTEM_PROMPT_KEY);
    if (typeof raw === "string") return raw;
  } catch (e) {
    logError("storage", "Failed to load system prompt", { error: e });
  }
  return "";
}

export async function saveSystemPrompt(value: string): Promise<void> {
  try {
    const store = await getStore();
    await store.set(SYSTEM_PROMPT_KEY, value);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save system prompt", { error: e });
  }
}

export async function loadAutoGenerateMemory(): Promise<boolean> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(AUTO_GENERATE_MEMORY_KEY);
    if (typeof raw === "boolean") return raw;
  } catch (e) {
    logError("storage", "Failed to load auto generate memory setting", { error: e });
  }
  return false;
}

export async function saveAutoGenerateMemory(value: boolean): Promise<void> {
  try {
    const store = await getStore();
    await store.set(AUTO_GENERATE_MEMORY_KEY, value);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save auto generate memory setting", { error: e });
  }
}

export async function loadShowContextWindow(): Promise<boolean> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(SHOW_CONTEXT_WINDOW_KEY);
    if (typeof raw === "boolean") return raw;
  } catch (e) {
    logError("storage", "Failed to load show context window setting", { error: e });
  }
  return false;
}

export async function saveShowContextWindow(value: boolean): Promise<void> {
  try {
    const store = await getStore();
    await store.set(SHOW_CONTEXT_WINDOW_KEY, value);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save show context window setting", { error: e });
  }
}

export type ContextTokenizationMode = "local" | "endpoint";

export async function loadContextTokenizationMode(): Promise<ContextTokenizationMode> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(CONTEXT_TOKENIZATION_MODE_KEY);
    if (raw === "local" || raw === "endpoint") return raw;
  } catch (e) {
    logError("storage", "Failed to load context tokenization mode", { error: e });
  }
  return "local";
}

export async function saveContextTokenizationMode(value: ContextTokenizationMode): Promise<void> {
  try {
    const store = await getStore();
    await store.set(CONTEXT_TOKENIZATION_MODE_KEY, value);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save context tokenization mode", { error: e });
  }
}

export async function loadMaxToolSteps(): Promise<number> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(MAX_TOOL_STEPS_KEY);
    if (typeof raw === "number") {
      return Math.min(MAX_TOOL_STEPS_LIMIT, Math.max(MIN_TOOL_STEPS, Math.round(raw)));
    }
  } catch (e) {
    logError("storage", "Failed to load max tool steps setting", { error: e });
  }
  return DEFAULT_MAX_TOOL_STEPS;
}

export async function saveMaxToolSteps(value: number): Promise<void> {
  try {
    const store = await getStore();
    await store.set(MAX_TOOL_STEPS_KEY, value);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save max tool steps setting", { error: e });
  }
}

export async function loadUnlimitedToolSteps(): Promise<boolean> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(UNLIMITED_TOOL_STEPS_KEY);
    if (typeof raw === "boolean") return raw;
  } catch (e) {
    logError("storage", "Failed to load unlimited tool steps setting", { error: e });
  }
  return false;
}

export async function saveUnlimitedToolSteps(value: boolean): Promise<void> {
  try {
    const store = await getStore();
    await store.set(UNLIMITED_TOOL_STEPS_KEY, value);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save unlimited tool steps setting", { error: e });
  }
}

const DEFAULT_GIT_CONFIG: GitConfig = {
  repoPath: "",
  isAutoCommitEnabled: false,
  isAiCommitMsgEnabled: true,
  isPreCommitEnabled: true,
  overrideIdentity: false,
  gitName: "Sythoria AI",
  gitEmail: "assistant@sythoria.local",
};

export async function loadGitConfig(): Promise<GitConfig> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(GIT_CONFIG_KEY);
    if (raw) {
      const result = GitConfigSchema.safeParse(raw);
      if (result.success) return { ...DEFAULT_GIT_CONFIG, ...result.data };
      logWarn("storage", "Stored Git config failed validation, resetting", {
        details: result.error?.message,
        action: "Git configuration was reset to defaults. Re-configure in Settings > Git.",
      });
    }
  } catch (e) {
    logError("storage", "Failed to load Git config from app store", {
      error: e,
      action: "Using default Git settings.",
    });
  }
  return { ...DEFAULT_GIT_CONFIG };
}

export async function saveGitConfig(config: GitConfig): Promise<void> {
  try {
    const store = await getStore();
    await store.set(GIT_CONFIG_KEY, config);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save Git config to app store", {
      error: e,
      action: "Git configuration settings may not persist.",
    });
  }
}

export const DEFAULT_APPSHOT_CONFIG: AppshotConfig = {
  enabled: true,
  captureFolder: "",
  imageFormat: "png",
  imageQuality: 85,
  autoCleanEnabled: true,
  autoCleanType: "count",
  autoCleanValue: 50,
  saveToGallery: false,
};

export async function loadAppshotConfig(): Promise<AppshotConfig> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(APPSHOT_CONFIG_KEY);
    if (raw) {
      const result = AppshotConfigSchema.safeParse(raw);
      if (result.success) return { ...DEFAULT_APPSHOT_CONFIG, ...result.data } as AppshotConfig;
      logWarn("storage", "Stored Appshots config failed validation, resetting", {
        details: result.error?.message,
        action: "Appshots configuration was reset to defaults. Re-configure in Settings > Appshots.",
      });
    }
  } catch (e) {
    logError("storage", "Failed to load Appshots config from app store", {
      error: e,
      action: "Using default Appshots settings.",
    });
  }
  return { ...DEFAULT_APPSHOT_CONFIG };
}

export async function saveAppshotConfig(config: AppshotConfig): Promise<void> {
  try {
    const store = await getStore();
    await store.set(APPSHOT_CONFIG_KEY, config);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save Appshots config to app store", {
      error: e,
      action: "Appshots configuration settings may not persist.",
    });
    throw e;
  }
}

export async function loadProjectsEnabled(): Promise<boolean> {
  try {
    const store = await getStore();
    const val = await store.get<boolean>(PROJECTS_ENABLED_KEY);
    return val ?? false; // default disabled
  } catch (e) {
    logError("storage", "Failed to load projects enabled status", { error: e });
    return false;
  }
}

export async function saveProjectsEnabled(enabled: boolean): Promise<void> {
  try {
    const store = await getStore();
    await store.set(PROJECTS_ENABLED_KEY, enabled);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save projects enabled status", { error: e });
  }
}

export async function loadProjectsDefaultPermission(): Promise<ProjectPermission> {
  try {
    const store = await getStore();
    const val = await store.get<string>(PROJECTS_DEFAULT_PERMISSION_KEY);
    if (val === "read" || val === "write" || val === "full") {
      return val as ProjectPermission;
    }
  } catch (e) {
    logError("storage", "Failed to load projects default permission", { error: e });
  }
  return "read"; // default read
}

export async function saveProjectsDefaultPermission(perm: ProjectPermission): Promise<void> {
  try {
    const store = await getStore();
    await store.set(PROJECTS_DEFAULT_PERMISSION_KEY, perm);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save projects default permission", { error: e });
  }
}

export async function loadEnabledMcpServers(): Promise<string[]> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(MCP_ENABLED_SERVERS_KEY);
    if (Array.isArray(raw)) {
      return raw.filter((item): item is string => typeof item === "string");
    }
  } catch (e) {
    logError("storage", "Failed to load enabled MCP servers from app store", { error: e });
  }
  return [];
}

export async function saveEnabledMcpServers(enabledIds: string[]): Promise<void> {
  try {
    const store = await getStore();
    await store.set(MCP_ENABLED_SERVERS_KEY, enabledIds);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save enabled MCP servers to app store", { error: e });
  }
}

export async function loadIsLoggingEnabled(): Promise<boolean> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(LOGGING_ENABLED_KEY);
    if (typeof raw === "boolean") return raw;
  } catch (e) {
    logError("storage", "Failed to load logging enabled setting", { error: e });
  }
  return true;
}

export async function saveIsLoggingEnabled(value: boolean): Promise<void> {
  try {
    const store = await getStore();
    await store.set(LOGGING_ENABLED_KEY, value);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save logging enabled setting", { error: e });
  }
}

export async function loadDisableBgActivity(): Promise<boolean> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(DISABLE_BG_ACTIVITY_KEY);
    if (typeof raw === "boolean") return raw;
  } catch (e) {
    logError("storage", "Failed to load disable bg activity setting", { error: e });
  }
  return false;
}

export async function saveDisableBgActivity(value: boolean): Promise<void> {
  try {
    const store = await getStore();
    await store.set(DISABLE_BG_ACTIVITY_KEY, value);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save disable bg activity setting", { error: e });
  }
}

// These are the defaults shown in Privacy settings. The native endpoint policy
// enforces the corresponding protections independently, so restoring this list
// never weakens the baseline even if a user later edits it.
export const DEFAULT_BLOCKED_HOSTS = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.azure.com",
  "100.100.100.200",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "169.254.0.0/16",
  "100.64.0.0/10",
  "fc00::/7",
  "fe80::/10",
];

export interface NetworkSettings {
  blockedHosts: string[];
  allowedLocalEndpoints: string[];
  offlineMode: boolean;
}

const NetworkSettingsSchema = z.object({
  blocked_hosts: z.array(z.string()),
  allowed_local_endpoints: z.array(z.string()).default([]),
  offline_mode: z.boolean().default(false),
});

export async function loadNetworkSettings(): Promise<NetworkSettings> {
  try {
    const raw = await invoke<string>("load_network_config");
    const legacyKeys = ["sythoria-strict-ssl", "sythoria-blocked-hosts", "sythoria-offline-mode"];
    const store = await getStore();
    let settings: NetworkSettings;

    if (raw) {
      const rawConfig: unknown = JSON.parse(raw);
      const parsed = NetworkSettingsSchema.parse(rawConfig);
      settings = {
        blockedHosts: parsed.blocked_hosts,
        allowedLocalEndpoints: parsed.allowed_local_endpoints,
        offlineMode: parsed.offline_mode,
      };
      const hadLegacyTlsOverride = typeof rawConfig === "object" && rawConfig !== null && "strict_ssl" in rawConfig;
      if (hadLegacyTlsOverride) {
        await saveNetworkSettings(settings);
      }
    } else {
      const legacyBlockedHosts = await store.get<unknown>(legacyKeys[1]);
      const legacyOfflineMode = await store.get<unknown>(legacyKeys[2]);
      let localBlockedHosts: unknown;
      try {
        const stored = localStorage.getItem(legacyKeys[1]);
        localBlockedHosts = stored ? JSON.parse(stored) : undefined;
      } catch {
        localBlockedHosts = undefined;
      }

      settings = {
        blockedHosts: Array.isArray(legacyBlockedHosts)
          ? legacyBlockedHosts.filter((host): host is string => typeof host === "string")
          : Array.isArray(localBlockedHosts)
            ? localBlockedHosts.filter((host): host is string => typeof host === "string")
            : DEFAULT_BLOCKED_HOSTS,
        allowedLocalEndpoints: [],
        offlineMode:
          typeof legacyOfflineMode === "boolean" ? legacyOfflineMode : localStorage.getItem(legacyKeys[2]) === "true",
      };
      await saveNetworkSettings(settings);
      logInfo("storage", "Migrated network policy to encrypted storage");
    }

    const removed = await Promise.all(legacyKeys.map((key) => store.delete(key)));
    if (removed.some(Boolean)) await store.save();
    legacyKeys.forEach((key) => localStorage.removeItem(key));
    return settings;
  } catch (error) {
    logError("storage", "The encrypted network policy could not be authenticated; network access is disabled", {
      error,
      action: "Review and save Privacy settings to replace the damaged policy.",
    });
    return {
      blockedHosts: DEFAULT_BLOCKED_HOSTS,
      allowedLocalEndpoints: [],
      offlineMode: true,
    };
  }
}

let pendingNetworkSettings: NetworkSettings | null = null;
let networkSettingsSavePromise: Promise<void> | null = null;

export async function saveNetworkSettings(settings: NetworkSettings): Promise<void> {
  if (persistenceSuspendedForRecovery) return;
  pendingNetworkSettings = settings;
  if (!networkSettingsSavePromise) {
    networkSettingsSavePromise = Promise.resolve()
      .then(async () => {
        while (pendingNetworkSettings) {
          const next = pendingNetworkSettings;
          pendingNetworkSettings = null;
          await invoke("save_network_config", {
            config: JSON.stringify({
              blocked_hosts: next.blockedHosts,
              allowed_local_endpoints: next.allowedLocalEndpoints,
              offline_mode: next.offlineMode,
            }),
          });
        }
      })
      .finally(() => {
        networkSettingsSavePromise = null;
      });
  }
  await networkSettingsSavePromise;
}

export async function loadLegacyProjects(): Promise<Project[] | null> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(PROJECTS_KEY);
    if (raw && Array.isArray(raw)) {
      return raw as Project[];
    }
  } catch (e) {
    logError("storage", "Failed to load legacy projects from app store", { error: e });
  }
  return null;
}

export async function clearLegacyProjects(): Promise<void> {
  try {
    const store = await getStore();
    await store.delete(PROJECTS_KEY);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to clear legacy projects from app store", { error: e });
  }
}
