import { friendlyEndpointError } from "../utils/endpointError";
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { ConnectionStatus, SearchApiConfig, FetchApiConfig, SearchResult, UrlContent } from "../types";
import { saveSearchConfigs, saveFetchConfigs, saveSearchApiKeys } from "../utils/storage";
import { logError, logWarn, logInfo } from "../utils/logger";
import { parseApiError } from "../utils/parseApiError";
import { validateSearchConfig, validateFetchConfig } from "../utils/validation";
import { useUIStore } from "./useUIStore";
import { debounce } from "../utils/debounce";

const debouncedSaveSearchConfigs = debounce((configs: SearchApiConfig[]) => {
  saveSearchConfigs(configs);
}, 500);

const debouncedSaveSearchApiKeys = debounce((keys: Record<string, string>) => {
  saveSearchApiKeys(keys);
}, 500);

const debouncedSaveFetchConfigs = debounce((configs: FetchApiConfig[]) => {
  saveFetchConfigs(configs);
}, 500);

const debouncedLogSearchUpdate = debounce((name: string, fields: string[]) => {
  logInfo("search", `Search config updated: "${name}"`, {
    details: `Updated fields: ${fields.join(", ")}`,
  });
}, 500);

const CONNECTION_CHECK_INTERVAL_MS = 30 * 1000;
let connectionCheckInterval: ReturnType<typeof setInterval> | null = null;
let connectionCheckGeneration = 0;

interface SearchState {
  searchConfigs: SearchApiConfig[];
  activeSearchId: string | null;
  searchApiKeys: Record<string, string>;
  searchErrors: Record<string, string | undefined>;
  searchStatuses: Record<string, ConnectionStatus>;

  fetchConfigs: FetchApiConfig[];
  activeFetchId: string | null;
  fetchErrors: Record<string, string | undefined>;
  fetchStatuses: Record<string, ConnectionStatus>;

  addSearchConfig: () => void;
  updateSearchConfig: (id: string, updates: Partial<SearchApiConfig>) => void;
  deleteSearchConfig: (id: string) => void;
  setActiveSearchId: (id: string | null) => void;
  checkSearchConnections: (configIds?: string[]) => Promise<void>;
  startConnectionChecks: () => void;
  stopConnectionChecks: () => void;

  addFetchConfig: () => void;
  updateFetchConfig: (id: string, updates: Partial<FetchApiConfig>) => void;
  deleteFetchConfig: (id: string) => void;
  setActiveFetchId: (id: string | null) => void;
  checkFetchConnections: (configIds?: string[]) => Promise<void>;

  performSearch: (query: string, config: SearchApiConfig, apiKey: string) => Promise<SearchResult[]>;
  fetchUrlContent: (url: string, format?: string) => Promise<UrlContent>;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  searchConfigs: [],
  activeSearchId: null,
  searchApiKeys: {},
  searchErrors: {},
  searchStatuses: {},
  fetchConfigs: [],
  activeFetchId: null,
  fetchErrors: {},
  fetchStatuses: {},

  addSearchConfig: () => {
    const newConfig: SearchApiConfig = {
      id: "search-" + Date.now(),
      name: "New Search API",
      provider: "google",
      baseUrl: "https://www.googleapis.com/customsearch/v1",
      apiKey: "",
      cx: "",
      maxResults: 5,
      enabled: true,
    };
    const validation = validateSearchConfig(newConfig);
    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message ?? "Invalid search config";
      logWarn("search", `Search config validation failed: ${firstError}`, {
        action: "Fix the search provider configuration in Settings > Search.",
      });
      useUIStore.getState().addToast(`Validation: ${firstError}`, "error");
      return;
    }
    const { searchConfigs } = get();
    const updated = [...searchConfigs, newConfig];
    set((state) => ({
      searchConfigs: updated,
      activeSearchId: newConfig.id,
      searchStatuses: { ...state.searchStatuses, [newConfig.id]: "disconnected" },
    }));
    debouncedSaveSearchConfigs.cancel();
    saveSearchConfigs(updated.map(({ apiKey: _apiKey, ...rest }) => rest as SearchApiConfig));
    logInfo("search", `Search API added: "${newConfig.name}" (${newConfig.provider})`, {
      details: `Provider: ${newConfig.provider}, Base URL: ${newConfig.baseUrl}`,
    });
    useUIStore.getState().addToast("Search API added — configure its details", "info");
  },

  updateSearchConfig: (id, updates) => {
    const { searchConfigs, searchApiKeys, searchStatuses } = get();
    const updatedConfigs = searchConfigs.map((c) => (c.id === id ? { ...c, ...updates } : c));
    const enabledConfigs = updatedConfigs.filter((config) => config.enabled);
    const currentActiveId = get().activeSearchId;
    const activeSearchId = enabledConfigs.some((config) => config.id === currentActiveId)
      ? currentActiveId
      : (enabledConfigs[0]?.id ?? null);
    set({
      searchConfigs: updatedConfigs,
      activeSearchId,
      searchStatuses: { ...searchStatuses, [id]: "disconnected" },
    });

    if (updates.apiKey !== undefined) {
      const newKeys = { ...searchApiKeys, [id]: updates.apiKey! };
      set({ searchApiKeys: newKeys });
      debouncedSaveSearchApiKeys(newKeys);
    }

    const configsWithoutKeys = updatedConfigs.map(({ apiKey: _apiKey, ...rest }) => rest as SearchApiConfig);
    debouncedSaveSearchConfigs(configsWithoutKeys);

    const updatedConfig = updatedConfigs.find((c) => c.id === id);
    if (updatedConfig && Object.keys(updates).length > 0) {
      debouncedLogSearchUpdate(updatedConfig.name, Object.keys(updates));
    }
  },

  deleteSearchConfig: (id) => {
    const { searchConfigs, activeSearchId, searchApiKeys, searchStatuses } = get();
    const config = searchConfigs.find((c) => c.id === id);
    const updated = searchConfigs.filter((c) => c.id !== id);
    const newKeys = { ...searchApiKeys };
    delete newKeys[id];
    const newStatuses = { ...searchStatuses };
    delete newStatuses[id];
    set({
      searchConfigs: updated,
      activeSearchId: activeSearchId === id ? (updated.find((config) => config.enabled)?.id ?? null) : activeSearchId,
      searchApiKeys: newKeys,
      searchStatuses: newStatuses,
    });
    debouncedSaveSearchConfigs.cancel();
    debouncedSaveSearchApiKeys.cancel();
    saveSearchConfigs(updated.map(({ apiKey: _apiKey, ...rest }) => rest as SearchApiConfig));
    saveSearchApiKeys(newKeys);
    logInfo("search", `Search API deleted: "${config?.name ?? id}"`, {});
    useUIStore.getState().addToast("Search API deleted", "info");
  },

  setActiveSearchId: (id) =>
    set({ activeSearchId: id && get().searchConfigs.some((config) => config.id === id && config.enabled) ? id : null }),

  checkSearchConnections: async (configIds) => {
    const { searchConfigs, searchStatuses } = get();
    const generation = connectionCheckGeneration;
    const configs = searchConfigs.filter((config) => config.enabled && (!configIds || configIds.includes(config.id)));
    if (configs.length === 0) return;

    set({
      searchStatuses: {
        ...searchStatuses,
        ...Object.fromEntries(configs.map((config) => [config.id, "connecting" as const])),
      },
    });

    const results = await Promise.all(
      configs.map(async (config) => {
        try {
          await invoke<boolean>("check_web_endpoint", { endpointUrl: config.baseUrl });
          logInfo("search", `Connection check passed for "${config.name}"`, {
            details: `Provider: ${config.provider}, Base URL: ${config.baseUrl}`,
          });
          return { id: config.id, baseUrl: config.baseUrl, status: "connected" as const };
        } catch (error) {
          const parsed = parseApiError(error);
          logWarn("search", `Connection check failed for "${config.name}"`, {
            details: `Provider: ${config.provider}. ${parsed.message}`,
            action: "Check the provider URL and network access.",
          });
          return {
            id: config.id,
            baseUrl: config.baseUrl,
            status: "error" as const,
            error: friendlyEndpointError(error),
          };
        }
      }),
    );

    const currentConfigs = get().searchConfigs;
    set((state) => ({
      searchErrors: {
        ...state.searchErrors,
        ...Object.fromEntries(results.map((result) => [result.id, result.error])),
      },
      searchStatuses: {
        ...state.searchStatuses,
        ...Object.fromEntries(
          results.map((result) => [
            result.id,
            currentConfigs.some(
              (config) => config.id === result.id && config.enabled && config.baseUrl === result.baseUrl,
            ) && generation === connectionCheckGeneration
              ? result.status
              : ("disconnected" as const),
          ]),
        ),
      },
    }));
  },

  performSearch: async (query, config, _apiKey) => {
    const currentConfig = get().searchConfigs.find((candidate) => candidate.id === config.id);
    if (!currentConfig?.enabled) {
      logWarn("search", `Blocked search through disabled config: "${config.name}"`, {});
      throw new Error(`Search provider "${config.name}" is disabled or unavailable`);
    }
    try {
      logInfo("search", `Searching: "${query}"`, {
        details: `Provider: ${config.provider}, Config: "${config.name}"`,
      });
      const configPayload = { ...config, apiKey: undefined };
      const raw = await invoke<string>("web_search", {
        provider: config.provider,
        query,
        config: JSON.stringify(configPayload),
        configId: config.id,
      });
      const results = JSON.parse(raw) as SearchResult[];
      logInfo("search", `Search completed: "${query}"`, {
        details: `${results.length} result(s) from ${config.provider}`,
      });
      return results;
    } catch (err) {
      const parsed = parseApiError(err);
      logError("search", `Search failed for "${query}"`, {
        error: err,
        action: parsed.action,
        details: `Provider: ${config.provider}, Config: "${config.name}". ${parsed.message}`,
      });
      useUIStore.getState().addToast(parsed.message, "error");
      throw new Error(parsed.message);
    }
  },

  addFetchConfig: () => {
    const newConfig: FetchApiConfig = {
      id: "fetch-" + Date.now(),
      name: "New Fetch API",
      provider: "firecrawl",
      baseUrl: "https://api.firecrawl.dev/v1",
      apiKey: "",
      enabled: true,
    };
    const validation = validateFetchConfig(newConfig);
    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message ?? "Invalid fetch config";
      logWarn("search", `Fetch config validation failed: ${firstError}`, {
        action: "Fix the fetch provider configuration in Settings > Web Search.",
      });
      useUIStore.getState().addToast(`Validation: ${firstError}`, "error");
      return;
    }
    const { fetchConfigs } = get();
    const updated = [...fetchConfigs, newConfig];
    set((state) => ({
      fetchConfigs: updated,
      activeFetchId: newConfig.id,
      fetchStatuses: { ...state.fetchStatuses, [newConfig.id]: "disconnected" },
    }));
    debouncedSaveFetchConfigs.cancel();
    saveFetchConfigs(updated.map(({ apiKey: _apiKey, ...rest }) => rest as FetchApiConfig));
    logInfo("search", `Fetch API added: "${newConfig.name}" (${newConfig.provider})`, {});
    useUIStore.getState().addToast("Fetch API added — configure its details", "info");
  },

  updateFetchConfig: (id, updates) => {
    const { fetchConfigs, searchApiKeys, fetchStatuses } = get();
    const updatedConfigs = fetchConfigs.map((c) => (c.id === id ? { ...c, ...updates } : c));
    const enabledConfigs = updatedConfigs.filter((config) => config.enabled);
    const currentActiveId = get().activeFetchId;
    set({
      fetchConfigs: updatedConfigs,
      activeFetchId: enabledConfigs.some((config) => config.id === currentActiveId)
        ? currentActiveId
        : (enabledConfigs[0]?.id ?? null),
      fetchStatuses: { ...fetchStatuses, [id]: "disconnected" },
    });

    if (updates.apiKey !== undefined) {
      const newKeys = { ...searchApiKeys, [id]: updates.apiKey! };
      set({ searchApiKeys: newKeys });
      debouncedSaveSearchApiKeys(newKeys);
    }

    const configsWithoutKeys = updatedConfigs.map(({ apiKey: _apiKey, ...rest }) => rest as FetchApiConfig);
    debouncedSaveFetchConfigs(configsWithoutKeys);
  },

  deleteFetchConfig: (id) => {
    const { fetchConfigs, activeFetchId, searchApiKeys, fetchStatuses } = get();
    const config = fetchConfigs.find((c) => c.id === id);
    const updated = fetchConfigs.filter((c) => c.id !== id);
    const newKeys = { ...searchApiKeys };
    delete newKeys[id];
    const newStatuses = { ...fetchStatuses };
    delete newStatuses[id];
    set({
      fetchConfigs: updated,
      activeFetchId: activeFetchId === id ? (updated.find((config) => config.enabled)?.id ?? null) : activeFetchId,
      searchApiKeys: newKeys,
      fetchStatuses: newStatuses,
    });
    debouncedSaveFetchConfigs.cancel();
    debouncedSaveSearchApiKeys.cancel();
    saveFetchConfigs(updated.map(({ apiKey: _apiKey, ...rest }) => rest as FetchApiConfig));
    saveSearchApiKeys(newKeys);
    logInfo("search", `Fetch API deleted: "${config?.name ?? id}"`, {});
    useUIStore.getState().addToast("Fetch API deleted", "info");
  },

  setActiveFetchId: (id) =>
    set({ activeFetchId: id && get().fetchConfigs.some((config) => config.id === id && config.enabled) ? id : null }),

  checkFetchConnections: async (configIds) => {
    const { fetchConfigs, fetchStatuses } = get();
    const generation = connectionCheckGeneration;
    const configs = fetchConfigs.filter((config) => config.enabled && (!configIds || configIds.includes(config.id)));
    if (configs.length === 0) return;

    set({
      fetchStatuses: {
        ...fetchStatuses,
        ...Object.fromEntries(configs.map((config) => [config.id, "connecting" as const])),
      },
    });

    const results = await Promise.all(
      configs.map(async (config) => {
        try {
          await invoke<boolean>("check_web_endpoint", { endpointUrl: config.baseUrl });
          logInfo("search", `Connection check passed for "${config.name}"`, {
            details: `Provider: ${config.provider}, Base URL: ${config.baseUrl}`,
          });
          return { id: config.id, baseUrl: config.baseUrl, status: "connected" as const };
        } catch (error) {
          const parsed = parseApiError(error);
          logWarn("search", `Connection check failed for "${config.name}"`, {
            details: `Provider: ${config.provider}. ${parsed.message}`,
            action: "Check the provider URL and network access.",
          });
          return {
            id: config.id,
            baseUrl: config.baseUrl,
            status: "error" as const,
            error: friendlyEndpointError(error),
          };
        }
      }),
    );

    const currentConfigs = get().fetchConfigs;
    set((state) => ({
      fetchErrors: { ...state.fetchErrors, ...Object.fromEntries(results.map((result) => [result.id, result.error])) },
      fetchStatuses: {
        ...state.fetchStatuses,
        ...Object.fromEntries(
          results.map((result) => [
            result.id,
            currentConfigs.some(
              (config) => config.id === result.id && config.enabled && config.baseUrl === result.baseUrl,
            ) && generation === connectionCheckGeneration
              ? result.status
              : ("disconnected" as const),
          ]),
        ),
      },
    }));
  },

  startConnectionChecks: () => {
    if (connectionCheckInterval) return;
    const { disableBgActivity, offlineMode } = useUIStore.getState();
    if (disableBgActivity || offlineMode) return;

    connectionCheckInterval = setInterval(() => {
      const { disableBgActivity: backgroundDisabled, offlineMode: offline } = useUIStore.getState();
      if (backgroundDisabled || offline) return;
      void Promise.all([get().checkSearchConnections(), get().checkFetchConnections()]);
    }, CONNECTION_CHECK_INTERVAL_MS);
  },

  stopConnectionChecks: () => {
    connectionCheckGeneration += 1;
    if (connectionCheckInterval) {
      clearInterval(connectionCheckInterval);
      connectionCheckInterval = null;
    }
  },

  fetchUrlContent: async (url, format) => {
    try {
      logInfo("search", `Fetching URL: ${url}`, {
        details: format ? `Format: ${format}` : undefined,
      });

      const { fetchConfigs, activeFetchId } = get();

      const activeConfig = activeFetchId ? fetchConfigs.find((c) => c.id === activeFetchId && c.enabled) : null;

      let provider: string | undefined;
      let configPayload: string | undefined;
      let configId: string | undefined;

      if (activeConfig) {
        provider = activeConfig.provider;
        configId = activeConfig.id;
        configPayload = JSON.stringify({
          baseUrl: activeConfig.baseUrl,
        });
      }

      const raw = await invoke<string>("fetch_url_content", {
        url,
        provider,
        config: configPayload,
        configId,
        format,
      });

      const content = JSON.parse(raw) as UrlContent;
      if (content.status === "error") {
        logWarn("search", `Fetch URL returned error: ${url}`, {
          details: content.error || "Unknown error",
          action: "Check that the URL is valid and publicly accessible.",
        });
      } else {
        logInfo("search", `Fetched URL successfully: ${url}`, {
          details: `Title: ${content.title || "(none)"}`,
        });
      }
      return content;
    } catch (err) {
      const parsed = parseApiError(err);
      logError("search", `Fetch URL failed: ${url}`, {
        error: err,
        action: parsed.action,
        details: parsed.message,
      });
      return { url, title: "", content: `Error: ${parsed.message}`, status: "error", error: parsed.message };
    }
  },
}));
