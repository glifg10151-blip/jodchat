import { friendlyEndpointError } from "../utils/endpointError";
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { McpServerConfig, McpTool, McpToolResult, McpServerStatus, ExecutableCheck } from "../types";
import { generateId } from "../utils/generateId";
import { saveMcpConfigs, saveMcpEnvSecrets, saveEnabledMcpServers, saveMcpApiKeys } from "../utils/storage";
import { logError, logWarn, logInfo } from "../utils/logger";
import { summarizeToolArguments } from "../utils/redaction";
import { parseApiError } from "../utils/parseApiError";
import { validateMcpServerConfig } from "../utils/validation";
import type { McpServerPreset } from "../config/mcpPresets";
import { verifiedCatalogPluginForConfig } from "../config/pluginsCatalog";
import { useUIStore } from "./useUIStore";
import { debounce } from "../utils/debounce";

const debouncedSaveMcpConfigs = debounce((configs: McpServerConfig[]) => {
  saveMcpConfigs(configs);
}, 500);

const debouncedSaveMcpEnvSecrets = debounce((secrets: Record<string, Record<string, string>>) => {
  saveMcpEnvSecrets(secrets);
}, 500);

const debouncedSaveMcpApiKeys = debounce((keys: Record<string, string>) => {
  saveMcpApiKeys(keys);
}, 500);

const debouncedLogConfigUpdate = debounce((name: string, fields: string[]) => {
  logInfo("mcp", `MCP server config updated: "${name}"`, {
    details: `Updated fields: ${fields.join(", ")}`,
  });
}, 500);

const debouncedLogEnvUpdate = debounce((name: string) => {
  logInfo("mcp", `MCP env secrets updated for server: "${name}"`, {});
}, 500);

const activeToolCallIdsByConversation = new Map<string, Set<string>>();
const staleConnectionRecoveryByServer = new Map<string, Promise<boolean>>();

function isStaleNativeConnectionError(error: unknown): boolean {
  const parsed = parseApiError(error);
  const detail = [parsed.raw, parsed.rawDetail, parsed.message].filter(Boolean).join(" ").toLowerCase();
  return (
    detail.includes("mcp server") &&
    (detail.includes("is not connected") ||
      detail.includes("not found or not connected") ||
      detail.includes("connection is stale"))
  );
}

function trackToolCall(conversationId: string, requestId: string): void {
  const activeIds = activeToolCallIdsByConversation.get(conversationId) ?? new Set<string>();
  activeIds.add(requestId);
  activeToolCallIdsByConversation.set(conversationId, activeIds);
}

function releaseToolCall(conversationId: string, requestId: string): void {
  const activeIds = activeToolCallIdsByConversation.get(conversationId);
  if (!activeIds) return;
  activeIds.delete(requestId);
  if (activeIds.size === 0) {
    activeToolCallIdsByConversation.delete(conversationId);
  }
}

function encodeNamespacePart(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface McpState {
  mcpConfigs: McpServerConfig[];
  envSecrets: Record<string, Record<string, string>>;
  mcpApiKeys: Record<string, string>;
  serverErrors: Record<string, string | undefined>;
  serverStatuses: Record<string, McpServerStatus>;
  availableTools: McpTool[];
  /** @deprecated Composer drafts now carry inline MCP references. */
  selectedServerIds: Set<string>;
  /** Servers explicitly enabled for native MCP execution and startup reconnect. */
  enabledServerIds: Set<string>;
  connectionGenerations: Record<string, number>;

  addMcpConfig: () => void;
  addMcpConfigFromPreset: (preset: McpServerPreset) => void;
  addMcpConfigWithSecrets: (
    preset: McpServerPreset,
    secrets: Record<string, string>,
    options?: { notify?: boolean; catalogPluginId?: string },
  ) => Promise<boolean>;
  updateMcpConfig: (id: string, updates: Partial<McpServerConfig>) => Promise<void>;
  deleteMcpConfig: (id: string) => Promise<void>;
  connectServer: (id: string, options?: { notify?: boolean }) => Promise<void>;
  disconnectServer: (id: string) => Promise<void>;
  connectAllEnabled: () => Promise<void>;
  callTool: (
    serverId: string,
    toolName: string,
    args: Record<string, string>,
    conversationId?: string,
  ) => Promise<McpToolResult>;
  cancelConversationToolCalls: (conversationIds: string[]) => Promise<boolean>;
  toggleServerSelected: (serverId: string, selected: boolean) => Promise<void>;
  toggleServerEnabled: (serverId: string, enabled: boolean) => Promise<void>;
  getEnabledTools: () => McpTool[];
  getToolsForServers: (serverIds: readonly string[]) => McpTool[];
  setEnvSecrets: (serverId: string, secrets: Record<string, string>) => void;
  checkCommand: (command: string) => Promise<ExecutableCheck>;
}

export const useMcpStore = create<McpState>((set, get) => ({
  mcpConfigs: [],
  envSecrets: {},
  mcpApiKeys: {},
  serverErrors: {},
  serverStatuses: {},
  availableTools: [],
  selectedServerIds: new Set(),
  enabledServerIds: new Set(),
  connectionGenerations: {},

  addMcpConfig: () => {
    const newConfig: McpServerConfig = {
      id: generateId(),
      name: "New MCP Server",
      transport: "stdio",
      command: "",
      args: [],
      enabled: true,
      trustLevel: "untrusted",
    };
    const validation = validateMcpServerConfig(newConfig);
    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message ?? "Invalid MCP config";
      logWarn("mcp", `MCP config validation failed: ${firstError}`, {
        action: "Fix the MCP server configuration in Settings > MCP Servers.",
      });
      useUIStore.getState().addToast(`Validation: ${firstError}`, "error");
      return;
    }
    const { mcpConfigs } = get();
    const updated = [...mcpConfigs, newConfig];
    set({
      mcpConfigs: updated,
      serverStatuses: { ...get().serverStatuses, [newConfig.id]: "disconnected" },
    });
    debouncedSaveMcpConfigs.cancel();
    saveMcpConfigs(updated);
    logInfo("mcp", `MCP server added: "${newConfig.name}"`, {
      details: `Transport: ${newConfig.transport}, Command: ${newConfig.command || "(not set)"}`,
    });
    useUIStore.getState().addToast("MCP server added — configure its details", "info");
  },

  addMcpConfigFromPreset: (preset) => {
    const newConfig: McpServerConfig = {
      id: generateId(),
      name: preset.name,
      transport: "stdio",
      command: preset.command,
      args: [...preset.args],
      enabled: true,
      trustLevel: "untrusted",
    };
    const validation = validateMcpServerConfig(newConfig);
    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message ?? "Invalid MCP config";
      logWarn("mcp", `MCP preset "${preset.name}" failed validation`, {
        action: firstError,
      });
      useUIStore.getState().addToast(`Validation: ${firstError}`, "error");
      return;
    }
    const { mcpConfigs, envSecrets } = get();
    const updated = [...mcpConfigs, newConfig];

    // Pre-seed env keys (with empty values) so the user sees them to fill in.
    let updatedEnvSecrets = envSecrets;
    if (preset.envKeys && preset.envKeys.length > 0) {
      const seed = Object.fromEntries(preset.envKeys.map((k) => [k, ""]));
      updatedEnvSecrets = { ...envSecrets, [newConfig.id]: seed };
    }

    set({
      mcpConfigs: updated,
      envSecrets: updatedEnvSecrets,
      serverStatuses: { ...get().serverStatuses, [newConfig.id]: "disconnected" },
    });
    debouncedSaveMcpConfigs.cancel();
    debouncedSaveMcpEnvSecrets.cancel();
    saveMcpConfigs(updated);
    saveMcpEnvSecrets(updatedEnvSecrets);
    const needsEnv = preset.envKeys?.length ?? 0;
    logInfo("mcp", `MCP server added from "${preset.name}" preset`, {
      details: `Command: ${newConfig.command}, Args: ${newConfig.args?.join(" ") ?? "(none)"}`,
    });
    useUIStore
      .getState()
      .addToast(
        needsEnv > 0
          ? `Added ${preset.name} — fill in ${needsEnv} env var${needsEnv > 1 ? "s" : ""}`
          : `Added ${preset.name} preset`,
        "info",
      );
  },

  addMcpConfigWithSecrets: async (preset, secrets, options) => {
    const { mcpConfigs, envSecrets, connectServer } = get();
    const existing = mcpConfigs.find((c) => c.name === preset.name);
    const targetId = existing?.id || generateId();

    // Interpolate any `<KEY>` placeholders in args with values from secrets
    const interpolatedArgs = (preset.args || []).map((arg) => {
      let resolved = arg;
      for (const [key, value] of Object.entries(secrets)) {
        if (!value) continue;
        const placeholder = `<${key}>`;
        if (resolved.includes(placeholder)) {
          resolved = resolved.replaceAll(placeholder, value);
        }
      }
      return resolved;
    });

    const candidateConfig: McpServerConfig = {
      id: targetId,
      name: preset.name,
      transport: "stdio",
      command: preset.command,
      args: interpolatedArgs,
      enabled: true,
      trustLevel: "untrusted",
      ...(options?.catalogPluginId ? { catalogPluginId: options.catalogPluginId } : {}),
    };
    const verifiedPlugin = verifiedCatalogPluginForConfig(candidateConfig);
    let newConfig: McpServerConfig;
    if (verifiedPlugin && verifiedPlugin.id === options?.catalogPluginId) {
      newConfig = { ...candidateConfig, catalogPluginId: verifiedPlugin.id, trustLevel: "trusted" };
    } else {
      const customConfig = { ...candidateConfig };
      delete customConfig.catalogPluginId;
      newConfig = customConfig;
    }

    const updatedConfigs = existing
      ? mcpConfigs.map((c) => (c.id === targetId ? newConfig : c))
      : [...mcpConfigs, newConfig];

    const updatedEnvSecrets = { ...envSecrets, [targetId]: secrets };
    const nextEnabled = new Set(get().enabledServerIds);
    nextEnabled.add(targetId);

    set({
      mcpConfigs: updatedConfigs,
      envSecrets: updatedEnvSecrets,
      enabledServerIds: nextEnabled,
      serverStatuses: { ...get().serverStatuses, [targetId]: "connecting" },
    });

    debouncedSaveMcpConfigs.cancel();
    debouncedSaveMcpEnvSecrets.cancel();
    await Promise.all([
      saveMcpConfigs(updatedConfigs),
      saveMcpEnvSecrets(updatedEnvSecrets),
      saveEnabledMcpServers(Array.from(nextEnabled)),
    ]);

    await connectServer(targetId, options);

    // If initial connection failed, remove from enabledServerIds so it doesn't fail on every app restart
    if (get().serverStatuses[targetId] === "error") {
      const rollbackEnabled = new Set(get().enabledServerIds);
      rollbackEnabled.delete(targetId);
      set({ enabledServerIds: rollbackEnabled });
      await saveEnabledMcpServers(Array.from(rollbackEnabled));
      return false;
    }
    return true;
  },

  updateMcpConfig: async (id, updates) => {
    const { mcpConfigs, mcpApiKeys } = get();
    set({
      serverErrors: { ...get().serverErrors, [id]: undefined },
      ...(get().serverStatuses[id] === "error"
        ? { serverStatuses: { ...get().serverStatuses, [id]: "disconnected" as const } }
        : {}),
    });
    const previousConfig = mcpConfigs.find((config) => config.id === id);
    const updatedConfigs = mcpConfigs.map((config) => {
      if (config.id !== id) return config;
      const candidate = { ...config, ...updates };
      const explicitlyRevoked = updates.trustLevel === "untrusted";
      const remainsVerified = candidate.catalogPluginId && verifiedCatalogPluginForConfig(candidate);
      if (!config.catalogPluginId || (!explicitlyRevoked && remainsVerified)) return candidate;

      const customConfig = { ...candidate };
      delete customConfig.catalogPluginId;
      return { ...customConfig, trustLevel: "untrusted" as const };
    });
    const isBeingDisabled = updates.enabled === false;
    const updatedConfig = updatedConfigs.find((config) => config.id === id);
    const trustChanged = previousConfig?.trustLevel !== updatedConfig?.trustLevel;

    if (isBeingDisabled) {
      const nextEnabled = new Set(get().enabledServerIds);
      nextEnabled.delete(id);
      const nextSelected = new Set(get().selectedServerIds);
      nextSelected.delete(id);
      set({
        mcpConfigs: updatedConfigs,
        selectedServerIds: nextSelected,
        enabledServerIds: nextEnabled,
        availableTools: get().availableTools.filter((tool) => tool.serverId !== id),
        serverStatuses: { ...get().serverStatuses, [id]: "disconnected" },
        connectionGenerations: {
          ...get().connectionGenerations,
          [id]: (get().connectionGenerations[id] ?? 0) + 1,
        },
      });
      await invoke("mcp_set_server_enabled", { serverId: id, enabled: false });
      await Promise.all([saveMcpConfigs(updatedConfigs), saveEnabledMcpServers(Array.from(nextEnabled))]);
      await invoke("mcp_stop_server", { serverId: id });
    } else {
      set({ mcpConfigs: updatedConfigs });
    }

    if (updates.apiKey !== undefined) {
      const newKeys = { ...mcpApiKeys, [id]: updates.apiKey };
      set({ mcpApiKeys: newKeys });
      debouncedSaveMcpApiKeys(newKeys);
    }

    if (trustChanged) {
      // Trust revocation is a security boundary: persist it immediately so a
      // quick shutdown cannot restore the previous trusted state on restart.
      debouncedSaveMcpConfigs.cancel();
      await saveMcpConfigs(updatedConfigs);
      if (trustChanged && !isBeingDisabled && get().serverStatuses[id] === "connected") {
        await get().disconnectServer(id);
      }
    } else if (!isBeingDisabled) {
      debouncedSaveMcpConfigs(updatedConfigs);
    }
    if (updatedConfig && Object.keys(updates).length > 0) {
      debouncedLogConfigUpdate(updatedConfig.name, Object.keys(updates));
    }
  },

  deleteMcpConfig: async (id) => {
    const { mcpConfigs, serverStatuses, envSecrets, availableTools, mcpApiKeys } = get();
    const config = mcpConfigs.find((c) => c.id === id);
    const updated = mcpConfigs.filter((c) => c.id !== id);
    const newStatuses = { ...serverStatuses };
    delete newStatuses[id];
    const newEnvSecrets = { ...envSecrets };
    delete newEnvSecrets[id];
    const updatedTools = availableTools.filter((t) => t.serverId !== id);
    const nextEnabled = new Set(get().enabledServerIds);
    nextEnabled.delete(id);
    const nextSelected = new Set(get().selectedServerIds);
    nextSelected.delete(id);

    const newKeys = { ...mcpApiKeys };
    delete newKeys[id];

    set({
      mcpConfigs: updated,
      serverStatuses: newStatuses,
      envSecrets: newEnvSecrets,
      availableTools: updatedTools,
      selectedServerIds: nextSelected,
      enabledServerIds: nextEnabled,
      mcpApiKeys: newKeys,
      connectionGenerations: {
        ...get().connectionGenerations,
        [id]: (get().connectionGenerations[id] ?? 0) + 1,
      },
    });
    debouncedSaveMcpConfigs.cancel();
    debouncedSaveMcpEnvSecrets.cancel();
    debouncedSaveMcpApiKeys.cancel();
    await invoke("mcp_set_server_enabled", { serverId: id, enabled: false });
    await Promise.all([
      saveMcpConfigs(updated),
      saveMcpEnvSecrets(newEnvSecrets),
      saveMcpApiKeys(newKeys),
      saveEnabledMcpServers(Array.from(nextEnabled)),
    ]);
    await invoke("mcp_stop_server", { serverId: id });
    logInfo("mcp", `MCP server deleted: "${config?.name ?? id}"`, {});
    useUIStore.getState().addToast("MCP server deleted", "info");
  },

  connectServer: async (id, options) => {
    const { mcpConfigs } = get();
    const config = mcpConfigs.find((c) => c.id === id);
    if (!config || !config.enabled) return;

    const connectionGeneration = (get().connectionGenerations[id] ?? 0) + 1;

    set({
      serverStatuses: { ...get().serverStatuses, [id]: "connecting" },
      connectionGenerations: { ...get().connectionGenerations, [id]: connectionGeneration },
    });
    logInfo("mcp", `Connecting to MCP server: "${config.name}"`, {
      details: `Transport: ${config.transport}, Command: ${config.command || config.baseUrl || "(none)"}`,
    });

    try {
      const configPayload = { ...config, apiKey: undefined };

      const raw = await invoke<string>("mcp_start_server", {
        config: JSON.stringify(configPayload),
        explicitlyEnabled: get().enabledServerIds.has(id),
      });

      const currentState = get();
      const currentConfig = currentState.mcpConfigs.find((candidate) => candidate.id === id);
      if (currentState.connectionGenerations[id] !== connectionGeneration || !currentConfig?.enabled) {
        await invoke("mcp_stop_server", { serverId: id });
        return;
      }

      const tools: {
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
        readOnlyHint?: boolean;
      }[] = JSON.parse(raw);

      const serverNamespace = `mcp_${encodeNamespacePart(config.id)}`;
      const mcpTools: McpTool[] = tools.map((t) => ({
        name: t.name,
        namespacedName: `${serverNamespace}__${t.name}`,
        description: t.description,
        inputSchema: t.inputSchema,
        readOnlyHint: t.readOnlyHint,
        serverId: id,
        serverName: config.name,
      }));

      const { availableTools } = get();
      const otherTools = availableTools.filter((t) => t.serverId !== id);
      set({
        serverStatuses: { ...get().serverStatuses, [id]: "connected" },
        availableTools: [...otherTools, ...mcpTools],
      });

      logInfo("mcp", `Connected to MCP server: "${config.name}"`, {
        details: `${mcpTools.length} tool(s) available: ${mcpTools.map((t) => t.name).join(", ") || "(none)"}`,
      });
      if (options?.notify !== false)
        useUIStore.getState().addToast(`Connected to ${config.name} (${mcpTools.length} tools)`, "success");
    } catch (err) {
      if (get().connectionGenerations[id] !== connectionGeneration || !get().mcpConfigs.some((c) => c.id === id)) {
        return;
      }
      const parsed = parseApiError(err);
      logError("mcp", `MCP server connect failed: "${config.name}"`, {
        error: err,
        action: `Check the server command/path and environment variables for "${config.name}" in Settings > MCP Servers. ${parsed.action}`,
        details: `Transport: ${config.transport}, Command: ${config.command || config.baseUrl || "(none)"}. ${parsed.message}${parsed.rawDetail ? `\nRaw: ${parsed.rawDetail}` : ""}`,
      });
      set({
        serverStatuses: { ...get().serverStatuses, [id]: "error" },
        serverErrors: { ...get().serverErrors, [id]: friendlyEndpointError(err, config.transport === "stdio") },
      });
      if (options?.notify !== false) useUIStore.getState().addToast(parsed.message, "error");
    }
  },

  disconnectServer: async (id) => {
    const { mcpConfigs } = get();
    const config = mcpConfigs.find((c) => c.id === id);
    set({
      serverStatuses: { ...get().serverStatuses, [id]: "disconnected" },
      availableTools: get().availableTools.filter((tool) => tool.serverId !== id),
      connectionGenerations: {
        ...get().connectionGenerations,
        [id]: (get().connectionGenerations[id] ?? 0) + 1,
      },
    });
    try {
      await invoke("mcp_stop_server", { serverId: id });
      logInfo("mcp", `Disconnected from MCP server: "${config?.name ?? id}"`, {});
    } catch (err) {
      logError("mcp", `MCP server disconnect error: "${config?.name ?? id}"`, {
        error: err,
        action: "The server process may have already exited. If tools are stuck, try restarting the app.",
      });
    }
  },

  connectAllEnabled: async () => {
    const { mcpConfigs, enabledServerIds } = get();
    const enabledServers = mcpConfigs.filter((c) => c.enabled && enabledServerIds.has(c.id));
    if (enabledServers.length > 0) {
      logInfo("mcp", `Auto-connecting ${enabledServers.length} enabled MCP server(s)`, {
        details: enabledServers.map((s) => s.name).join(", "),
      });
    }
    for (const server of enabledServers) {
      await get().connectServer(server.id);
    }
  },

  callTool: async (serverId, toolName, args, conversationId) => {
    const { mcpConfigs, enabledServerIds, serverStatuses } = get();
    const config = mcpConfigs.find((c) => c.id === serverId);
    if (!config?.enabled || !enabledServerIds.has(serverId) || serverStatuses[serverId] !== "connected") {
      return { content: "Error: MCP server is disabled or disconnected", isError: true };
    }
    const requestId = conversationId ? `mcp-${generateId()}-${Date.now()}` : undefined;
    if (conversationId && requestId) {
      trackToolCall(conversationId, requestId);
    }
    try {
      logInfo("mcp", `Calling MCP tool: ${toolName}`, {
        details: `Server: "${config?.name ?? serverId}", ${summarizeToolArguments(args)}`,
      });
      const serializedArguments = JSON.stringify(args);
      const invokeTool = async (): Promise<string> => {
        const approvalCapability = await invoke<string | null>("mcp_request_tool_approval", {
          serverId,
          toolName,
          arguments: serializedArguments,
          conversationId: conversationId ?? null,
        });
        return invoke<string>("mcp_call_tool", {
          serverId,
          toolName,
          arguments: serializedArguments,
          conversationId: conversationId ?? null,
          approvalCapability,
          ...(requestId ? { requestId } : {}),
        });
      };

      let raw: string;
      try {
        raw = await invokeTool();
      } catch (error) {
        if (!isStaleNativeConnectionError(error)) throw error;

        let recovery = staleConnectionRecoveryByServer.get(serverId);
        if (!recovery) {
          const currentState = get();
          const recoveryIsStillAuthorized =
            currentState.serverStatuses[serverId] === "connected" &&
            currentState.enabledServerIds.has(serverId) &&
            currentState.mcpConfigs.some((candidate) => candidate.id === serverId && candidate.enabled);
          if (!recoveryIsStillAuthorized) throw error;

          recovery = (async () => {
            logWarn("mcp", `MCP server connection became stale: "${config.name}"`, {
              action: "Reconnecting automatically before retrying the tool call.",
            });
            await get().connectServer(serverId);
            return get().serverStatuses[serverId] === "connected";
          })();
          staleConnectionRecoveryByServer.set(serverId, recovery);
          void recovery.finally(() => {
            if (staleConnectionRecoveryByServer.get(serverId) === recovery) {
              staleConnectionRecoveryByServer.delete(serverId);
            }
          });
        }

        if (!(await recovery)) throw error;
        raw = await invokeTool();
      }
      const result = JSON.parse(raw) as McpToolResult;
      if (result.isError) {
        logWarn("mcp", `MCP tool returned error: ${toolName}`, {
          details: `Server: "${config?.name ?? serverId}", Error: ${result.content.slice(0, 200)}`,
          action: "Check the tool arguments and that the MCP server is running correctly.",
        });
      }
      return result;
    } catch (err) {
      const parsed = parseApiError(err);
      logError("mcp", `MCP tool call failed: ${toolName}`, {
        error: err,
        action: `Make sure the MCP server "${config?.name ?? serverId}" is still running. ${parsed.action}`,
        details: parsed.message,
      });
      return { content: `Error: ${parsed.message}`, isError: true };
    } finally {
      if (conversationId && requestId) {
        releaseToolCall(conversationId, requestId);
      }
    }
  },

  cancelConversationToolCalls: async (conversationIds) => {
    const requestIds = [
      ...new Set(
        conversationIds.flatMap((conversationId) => [...(activeToolCallIdsByConversation.get(conversationId) ?? [])]),
      ),
    ];
    if (requestIds.length === 0) return true;

    const cancellationResults = await Promise.all(
      requestIds.map(async (requestId) => {
        try {
          await invoke("mcp_cancel_tool_call", { requestId });
          return true;
        } catch (error) {
          logError("mcp", "Failed to cancel MCP tool call", { error, details: `Request: ${requestId}` });
          return false;
        }
      }),
    );

    const deadline = Date.now() + 1_500;
    while (
      Date.now() < deadline &&
      conversationIds.some((conversationId) => activeToolCallIdsByConversation.has(conversationId))
    ) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 20));
    }
    const remainingCalls = conversationIds.reduce(
      (count, conversationId) => count + (activeToolCallIdsByConversation.get(conversationId)?.size ?? 0),
      0,
    );
    if (remainingCalls > 0) {
      logWarn("mcp", "MCP cancellation exceeded the bounded shutdown window", {
        details: `${remainingCalls} tool call(s) still settling`,
      });
    }
    return cancellationResults.every(Boolean) && remainingCalls === 0;
  },

  toggleServerSelected: async (serverId, selected) => {
    const { mcpConfigs, enabledServerIds } = get();
    const config = mcpConfigs.find((candidate) => candidate.id === serverId);
    if (selected && !config?.enabled) {
      useUIStore.getState().addToast("Enable this MCP server in Settings before selecting its tools", "error");
      return;
    }

    const nextSelected = new Set(get().selectedServerIds);
    if (!selected) {
      nextSelected.delete(serverId);
      // Chat selection only controls which tools reach the model. It must not
      // stop a server the user explicitly connected or enabled elsewhere.
      set({ selectedServerIds: nextSelected });
      return;
    }

    nextSelected.add(serverId);
    if (enabledServerIds.has(serverId)) {
      set({ selectedServerIds: nextSelected });
      if (get().serverStatuses[serverId] !== "connected") {
        await get().connectServer(serverId);
      }
      return;
    }

    const nextEnabled = new Set(enabledServerIds);
    nextEnabled.add(serverId);
    set({ selectedServerIds: nextSelected, enabledServerIds: nextEnabled });
    try {
      await invoke("mcp_set_server_enabled", { serverId, enabled: true });
      await saveEnabledMcpServers(Array.from(nextEnabled));
      if (get().serverStatuses[serverId] !== "connected") {
        await get().connectServer(serverId);
      }
    } catch (error) {
      const rollbackSelected = new Set(get().selectedServerIds);
      rollbackSelected.delete(serverId);
      const rollbackEnabled = new Set(get().enabledServerIds);
      rollbackEnabled.delete(serverId);
      set({ selectedServerIds: rollbackSelected, enabledServerIds: rollbackEnabled });
      logError("mcp", `Failed to enable MCP server for chat: "${config?.name ?? serverId}"`, { error });
      useUIStore.getState().addToast("Could not enable MCP server for this chat", "error");
    }
  },

  toggleServerEnabled: async (serverId, enabled) => {
    const { enabledServerIds, mcpConfigs } = get();
    const config = mcpConfigs.find((candidate) => candidate.id === serverId);
    if (enabled && !config?.enabled) {
      useUIStore.getState().addToast("Enable this MCP server in Settings before selecting its tools", "error");
      return;
    }
    const next = new Set(enabledServerIds);
    if (enabled) {
      next.add(serverId);
    } else {
      next.delete(serverId);
    }
    if (!enabled) {
      const nextSelected = new Set(get().selectedServerIds);
      nextSelected.delete(serverId);
      set({
        selectedServerIds: nextSelected,
        enabledServerIds: next,
        availableTools: get().availableTools.filter((tool) => tool.serverId !== serverId),
        serverStatuses: { ...get().serverStatuses, [serverId]: "disconnected" },
        connectionGenerations: {
          ...get().connectionGenerations,
          [serverId]: (get().connectionGenerations[serverId] ?? 0) + 1,
        },
      });
      await invoke("mcp_set_server_enabled", { serverId, enabled: false });
      await saveEnabledMcpServers(Array.from(next));
      await invoke("mcp_stop_server", { serverId });
      return;
    }

    set({ enabledServerIds: next });
    await invoke("mcp_set_server_enabled", { serverId, enabled: true });
    await saveEnabledMcpServers(Array.from(next));
    if (get().serverStatuses[serverId] !== "connected") {
      await get().connectServer(serverId);
    }
  },

  getEnabledTools: () => {
    const { availableTools, selectedServerIds, enabledServerIds, mcpConfigs, serverStatuses } = get();
    return availableTools.filter(
      (tool) =>
        selectedServerIds.has(tool.serverId) &&
        enabledServerIds.has(tool.serverId) &&
        serverStatuses[tool.serverId] === "connected" &&
        mcpConfigs.some((config) => config.id === tool.serverId && config.enabled),
    );
  },

  getToolsForServers: (serverIds) => {
    const requestedServerIds = new Set(serverIds);
    const { availableTools, enabledServerIds, mcpConfigs, serverStatuses } = get();
    return availableTools.filter(
      (tool) =>
        requestedServerIds.has(tool.serverId) &&
        enabledServerIds.has(tool.serverId) &&
        serverStatuses[tool.serverId] === "connected" &&
        mcpConfigs.some((config) => config.id === tool.serverId && config.enabled),
    );
  },

  setEnvSecrets: (serverId, secrets) => {
    const { envSecrets } = get();
    const updated = { ...envSecrets, [serverId]: secrets };
    set({ envSecrets: updated });
    debouncedSaveMcpEnvSecrets(updated);
    const config = get().mcpConfigs.find((c) => c.id === serverId);
    const serverName = config?.name ?? serverId;
    debouncedLogEnvUpdate(serverName);
  },

  checkCommand: async (command) => {
    const trimmed = command.trim();
    if (!trimmed) {
      return { found: false, message: "Enter a command to check" };
    }
    try {
      const raw = await invoke<string>("mcp_check_command", { command: trimmed });
      return JSON.parse(raw) as ExecutableCheck;
    } catch (err) {
      const parsed = parseApiError(err);
      logWarn("mcp", `Executable check failed for "${trimmed}"`, {
        details: parsed.message,
      });
      return { found: false, message: parsed.message };
    }
  },
}));
