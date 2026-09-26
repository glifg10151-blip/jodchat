import { create } from "zustand";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  loadHasStarted,
  saveHasStarted,
  saveTheme,
  saveAnimationsDisabled,
  loadDownloadedThemes,
  saveDownloadedThemes,
  DownloadedThemes,
  saveAlwaysOnTop,
  saveCloseToTray,
  saveLaunchOnStartup,
  saveSendMessageShortcut,
  saveClearInputOnEscape,
  saveBaseTextSize,
  saveAutoUpdateChecking,
  saveShowContextWindow,
  saveContextTokenizationMode,
  type ContextTokenizationMode,
  saveIsLoggingEnabled,
  saveDisableBgActivity,
  saveNetworkSettings,
  saveLanguage,
  loadSkipExternalLinkWarning,
  saveSkipExternalLinkWarning,
  saveUiLayoutSettings,
} from "../utils/storage";
import React from "react";
import type { Toast } from "../components/ui/Toast";
import type { LogEntry, LogSource } from "../types/log";
import {
  ThemeConfig,
  DEFAULT_THEME_CONFIG,
  applyTheme,
  CustomThemeConfig,
  LIGHT_PRESETS,
  DARK_PRESETS,
} from "../config/themePresets";
import {
  DEFAULT_AUX_PANEL_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_AUX_PANEL_WIDTH,
  MIN_AUX_PANEL_WIDTH,
} from "../config/constants";
import { useModelStore } from "./useModelStore";
import { useProjectStore } from "./useProjectStore";
export type { ThemeConfig, CustomThemeConfig };

export type LoadingKey = "init" | "sendMessage" | "checkConnection" | "saveConfig" | "toolExecution" | "mcpConnect";

export interface ToolConfirmation {
  id: string;
  conversationId?: string;
  toolName: string;
  arguments: Record<string, unknown>;
  resolve: (approved: boolean) => void;
  schema?: Record<string, unknown>;
  destination?: string;
}

export type AuxiliaryTab = "review" | "files" | "terminals" | "activity" | "artifacts" | "chat" | "knowledge";

interface UIState {
  view: "chat" | "settings";
  theme: ThemeConfig;
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  hasStarted: boolean;
  isLaunchReady: boolean;
  isConfigLoaded: boolean;
  startupRecovery: { message: string; detail: string } | null;
  loading: Record<LoadingKey, boolean>;
  toasts: Toast[];
  showRenameModal: boolean;
  renameId: string | null;
  renameCurrentTitle: string;
  activeSection: string;
  logBuffer: LogEntry[];
  logFilterSource: LogSource | "all";
  logFilterLevel: "all" | "info" | "warn" | "error";
  animationsDisabled: boolean;
  downloadedThemes: DownloadedThemes;
  alwaysOnTop: boolean;
  closeToTray: boolean;
  launchOnStartup: boolean;
  sendMessageShortcut: "enter" | "ctrl-enter";
  clearInputOnEscape: boolean;
  baseTextSize: "small" | "medium" | "large" | "xlarge";
  autoUpdateChecking: boolean;
  isLoggingEnabled: boolean;
  isDraggingFile: boolean;
  showContextWindow: boolean;
  contextTokenizationMode: ContextTokenizationMode;
  showProjectConfigModal: boolean;
  projectConfigModalMode: "create" | "edit";
  projectConfigModalId: string | null;
  disableBgActivity: boolean;
  blockedHosts: string[];
  allowedLocalEndpoints: string[];
  offlineMode: boolean;
  language: string;
  skipExternalLinkWarning: boolean;
  showLinkWarningModal: boolean;
  pendingLinkUrl: string | null;
  showCommandPalette: boolean;
  showSpotlight: boolean;
  activeSubagentId: string | null;

  setActiveSubagentId: (id: string | null) => void;
  setView: (view: "chat" | "settings") => void;
  setTheme: (theme: ThemeConfig) => void;
  setActiveSection: (section: string) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setHasStarted: (started: boolean) => void;
  initHasStarted: () => Promise<void>;
  setLaunchReady: (ready: boolean) => void;
  setConfigLoaded: (loaded: boolean) => void;
  setStartupRecovery: (recovery: { message: string; detail: string } | null) => void;
  setLoading: (key: LoadingKey, value: boolean) => void;
  addToast: (message: React.ReactNode, variant?: Toast["variant"]) => void;
  dismissToast: (id: string) => void;
  openRenameModal: (id: string, currentTitle: string) => void;
  closeRenameModal: () => void;
  setLogBuffer: (logs: LogEntry[]) => void;
  setLogFilterSource: (source: LogSource | "all") => void;
  setLogFilterLevel: (level: "all" | "info" | "warn" | "error") => void;
  setAnimationsDisabled: (disabled: boolean) => void;
  downloadTheme: (type: "light" | "dark", name: string, config: CustomThemeConfig) => void;
  deleteTheme: (type: "light" | "dark", name: string) => void;
  initDownloadedThemes: () => Promise<void>;
  setAlwaysOnTop: (value: boolean) => void;
  setCloseToTray: (value: boolean) => void;
  setLaunchOnStartup: (value: boolean) => void;
  setSendMessageShortcut: (value: "enter" | "ctrl-enter") => void;
  setClearInputOnEscape: (value: boolean) => void;
  setBaseTextSize: (value: "small" | "medium" | "large" | "xlarge") => void;
  setAutoUpdateChecking: (value: boolean) => void;
  setIsLoggingEnabled: (value: boolean) => void;
  setIsDraggingFile: (dragging: boolean) => void;
  setShowContextWindow: (value: boolean) => void;
  setContextTokenizationMode: (value: ContextTokenizationMode) => void;
  setDisableBgActivity: (value: boolean) => void;
  setBlockedHosts: (value: string[]) => void;
  setAllowedLocalEndpoints: (value: string[]) => void;
  setOfflineMode: (value: boolean) => void;
  setLanguage: (value: string) => void;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  auxPanelWidth: number;
  setAuxPanelWidth: (width: number) => void;
  activeArtifact: { title: string; content: string; type: "html" | "svg" | "mermaid" } | null;
  setActiveArtifact: (artifact: { title: string; content: string; type: "html" | "svg" | "mermaid" } | null) => void;
  openProjectConfigModal: (mode: "create" | "edit", id?: string | null) => void;
  closeProjectConfigModal: () => void;
  pendingToolConfirmations: ToolConfirmation[];
  addPendingToolConfirmation: (conf: ToolConfirmation) => void;
  respondToToolConfirmation: (id: string, approved: boolean) => void;
  isCheckingUpdates: boolean;
  isInstallingUpdate: boolean;
  updateDownloadProgress: number | null;
  updateError: string | null;
  updateInfo: { latestVersion: string; currentVersion: string; releaseNotes?: string } | null;
  showUpdateModal: boolean;
  setShowUpdateModal: (show: boolean) => void;
  checkForUpdates: (silent?: boolean) => Promise<void>;
  installUpdate: () => Promise<void>;
  setSkipExternalLinkWarning: (skip: boolean) => void;
  setShowCommandPalette: (show: boolean) => void;
  toggleCommandPalette: () => void;
  setShowSpotlight: (show: boolean) => void;
  setShowLinkWarningModal: (show: boolean, url?: string | null) => void;
  initSkipExternalLinkWarning: () => Promise<void>;

  isAuxPanelOpen: boolean;
  isAuxPanelExpanded: boolean;
  activeAuxTab: AuxiliaryTab | null;
  openAuxTabs: AuxiliaryTab[];
  activeAuxConversationId: string | null;
  activeReviewFilePath: string | null;
  sideChatConversationId: string | null;
  backgroundTasks: Array<{
    id: string;
    title: string;
    convId: string;
    status: "running" | "completed" | "error";
    timestamp: Date;
  }>;
  setAuxPanelOpen: (open: boolean) => void;
  setAuxPanelExpanded: (expanded: boolean) => void;
  setActiveAuxTab: (tab: AuxiliaryTab | null) => void;
  closeAuxTab: (tab: AuxiliaryTab) => void;
  setActiveAuxConversationId: (conversationId: string | null) => void;
  setActiveReviewFilePath: (path: string | null) => void;
  setSideChatConversationId: (conversationId: string | null) => void;
  addTask: (id: string, title: string, convId: string) => void;
  completeTask: (id: string, status?: "completed" | "error") => void;
  clearTasks: () => void;
}

const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 480;

const initialSidebarWidth = DEFAULT_SIDEBAR_WIDTH;
let pendingUpdate: Update | null = null;

function persistUiLayout(settings: Parameters<typeof saveUiLayoutSettings>[0]): void {
  void saveUiLayoutSettings(settings).catch((error) => {
    console.error("Failed to save encrypted panel layout:", error);
  });
}

let toastCounter = 0;

export const useUIStore = create<UIState>((set, get) => ({
  view: "chat",
  theme: DEFAULT_THEME_CONFIG,
  sidebarOpen: false,
  sidebarCollapsed: false,
  hasStarted: false,
  isLaunchReady: false,
  isConfigLoaded: false,
  startupRecovery: null,
  loading: {
    init: true,
    sendMessage: false,
    checkConnection: false,
    saveConfig: false,
    toolExecution: false,
    mcpConnect: false,
  },
  toasts: [],
  showRenameModal: false,
  renameId: null,
  renameCurrentTitle: "",
  activeSection: "general",
  logBuffer: [],
  logFilterSource: "all",
  logFilterLevel: "all",
  animationsDisabled: false,
  downloadedThemes: { light: {}, dark: {} },
  alwaysOnTop: false,
  closeToTray: false,
  launchOnStartup: false,
  sendMessageShortcut: "enter",
  clearInputOnEscape: false,
  baseTextSize: "medium",
  autoUpdateChecking: true,
  isLoggingEnabled: true,
  isDraggingFile: false,
  showContextWindow: false,
  contextTokenizationMode: "local",
  showProjectConfigModal: false,
  projectConfigModalMode: "create",
  projectConfigModalId: null,
  disableBgActivity: false,
  blockedHosts: [],
  allowedLocalEndpoints: [],
  offlineMode: false,
  language: "en",
  sidebarWidth: initialSidebarWidth,
  auxPanelWidth: DEFAULT_AUX_PANEL_WIDTH,
  activeArtifact: null,
  pendingToolConfirmations: [],
  isCheckingUpdates: false,
  isInstallingUpdate: false,
  updateDownloadProgress: null,
  updateError: null,
  updateInfo: null,
  showUpdateModal: false,
  skipExternalLinkWarning: false,
  showLinkWarningModal: false,
  pendingLinkUrl: null,
  showCommandPalette: false,
  showSpotlight: false,
  activeSubagentId: null,
  isAuxPanelOpen: false,
  isAuxPanelExpanded: false,
  activeAuxTab: null,
  openAuxTabs: [],
  activeAuxConversationId: null,
  activeReviewFilePath: null,
  sideChatConversationId: null,
  backgroundTasks: [],

  setActiveSubagentId: (activeSubagentId) => {
    const isProjectsEnabled = useProjectStore.getState().isProjectsEnabled;
    set({ activeSubagentId: isProjectsEnabled ? activeSubagentId : null });
    if (isProjectsEnabled && activeSubagentId) {
      get().setActiveAuxTab("activity");
      set({ isAuxPanelOpen: true });
    }
  },
  setSidebarWidth: (sidebarWidth) => {
    const normalizedWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, sidebarWidth));
    persistUiLayout({ sidebarWidth: normalizedWidth });
    set({ sidebarWidth: normalizedWidth });
  },
  setAuxPanelWidth: (auxPanelWidth) => {
    const normalizedWidth = Math.max(MIN_AUX_PANEL_WIDTH, Math.min(MAX_AUX_PANEL_WIDTH, auxPanelWidth));
    persistUiLayout({ auxPanelWidth: normalizedWidth });
    set({ auxPanelWidth: normalizedWidth });
  },
  setActiveArtifact: (activeArtifact) => {
    const isProjectsEnabled = useProjectStore.getState().isProjectsEnabled;
    set({ activeArtifact: isProjectsEnabled ? activeArtifact : null });
    if (isProjectsEnabled && activeArtifact) {
      get().setActiveAuxTab("artifacts");
      set({ isAuxPanelOpen: true });
    }
  },
  setAuxPanelOpen: (isAuxPanelOpen) =>
    set((state) => {
      if (isAuxPanelOpen && !useProjectStore.getState().isProjectsEnabled) {
        return {
          isAuxPanelOpen: false,
          isAuxPanelExpanded: false,
          activeAuxConversationId: null,
          activeReviewFilePath: null,
        };
      }
      return {
        isAuxPanelOpen,
        isAuxPanelExpanded: isAuxPanelOpen ? state.isAuxPanelExpanded : false,
        activeAuxConversationId: isAuxPanelOpen ? state.activeAuxConversationId : null,
        activeReviewFilePath: isAuxPanelOpen ? state.activeReviewFilePath : null,
      };
    }),
  setAuxPanelExpanded: (isAuxPanelExpanded) => set({ isAuxPanelExpanded }),
  setActiveAuxTab: (activeAuxTab) =>
    set((state) => ({
      activeAuxTab,
      openAuxTabs:
        activeAuxTab && !state.openAuxTabs.includes(activeAuxTab)
          ? [...state.openAuxTabs, activeAuxTab]
          : state.openAuxTabs,
    })),
  closeAuxTab: (tab) =>
    set((state) => {
      const tabIndex = state.openAuxTabs.indexOf(tab);
      const openAuxTabs = state.openAuxTabs.filter((openTab) => openTab !== tab);

      if (state.activeAuxTab !== tab) {
        return { openAuxTabs, ...(tab === "review" ? { activeReviewFilePath: null } : {}) };
      }

      return {
        openAuxTabs,
        activeAuxTab: openAuxTabs[Math.min(Math.max(tabIndex, 0), openAuxTabs.length - 1)] ?? null,
        ...(tab === "review" ? { activeReviewFilePath: null } : {}),
      };
    }),
  setActiveAuxConversationId: (activeAuxConversationId) =>
    set((state) => ({
      activeAuxConversationId,
      activeReviewFilePath:
        state.activeAuxConversationId === activeAuxConversationId ? state.activeReviewFilePath : null,
    })),
  setActiveReviewFilePath: (activeReviewFilePath) => set({ activeReviewFilePath }),
  setSideChatConversationId: (sideChatConversationId) => set({ sideChatConversationId }),
  addTask: (id, title, convId) =>
    set((s) => ({
      backgroundTasks: [
        { id, title, convId, status: "running", timestamp: new Date() },
        ...s.backgroundTasks.filter((t) => t.id !== id),
      ],
    })),
  completeTask: (id, status = "completed") =>
    set((s) => ({
      backgroundTasks: s.backgroundTasks.map((t) => (t.id === id ? { ...t, status } : t)),
    })),
  clearTasks: () => set({ backgroundTasks: [] }),

  setView: (view) => set({ view }),
  setIsDraggingFile: (isDraggingFile) => set({ isDraggingFile }),
  setTheme: (theme) => {
    set({ theme });
    applyTheme(theme);
    saveTheme(theme);
  },
  setActiveSection: (activeSection) => set({ activeSection }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setHasStarted: (started) => {
    set({ hasStarted: started });
    saveHasStarted(started);
  },
  initHasStarted: async () => {
    const stored = await loadHasStarted();
    if (stored) set({ hasStarted: true });
  },
  setLaunchReady: (ready) => set({ isLaunchReady: ready }),
  setConfigLoaded: (loaded) => set({ isConfigLoaded: loaded }),
  setStartupRecovery: (startupRecovery) => set({ startupRecovery }),
  setLoading: (key, value) => set((s) => ({ loading: { ...s.loading, [key]: value } })),
  addToast: (message, variant = "info") => {
    const id = `toast-${++toastCounter}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, variant }] }));
  },
  dismissToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
  openRenameModal: (id, currentTitle) => {
    set({ renameId: id, renameCurrentTitle: currentTitle, showRenameModal: true });
  },
  closeRenameModal: () => {
    set({ showRenameModal: false, renameId: null, renameCurrentTitle: "" });
  },
  openProjectConfigModal: (mode, id = null) => {
    set({ showProjectConfigModal: true, projectConfigModalMode: mode, projectConfigModalId: id });
  },
  closeProjectConfigModal: () => {
    set({ showProjectConfigModal: false, projectConfigModalId: null });
  },
  addPendingToolConfirmation: (conf) =>
    set((s) => ({
      pendingToolConfirmations: [...s.pendingToolConfirmations, conf],
    })),
  respondToToolConfirmation: (id, approved) =>
    set((s) => {
      const conf = s.pendingToolConfirmations.find((c) => c.id === id);
      if (conf) {
        conf.resolve(approved);
      }
      return {
        pendingToolConfirmations: s.pendingToolConfirmations.filter((c) => c.id !== id),
      };
    }),
  setLogBuffer: (logs) => set({ logBuffer: logs }),
  setLogFilterSource: (source) => set({ logFilterSource: source }),
  setLogFilterLevel: (level) => set({ logFilterLevel: level }),
  setAnimationsDisabled: (disabled) => {
    set({ animationsDisabled: disabled });
    document.documentElement.classList.toggle("animations-disabled", disabled);
    saveAnimationsDisabled(disabled);
  },
  downloadTheme: (type, name, config) => {
    set((s) => {
      const updated = {
        ...s.downloadedThemes,
        [type]: {
          ...s.downloadedThemes[type],
          [name]: config,
        },
      };
      saveDownloadedThemes(updated);
      return { downloadedThemes: updated };
    });
  },
  deleteTheme: (type, name) => {
    set((s) => {
      const updatedThemes = { ...s.downloadedThemes[type] };
      delete updatedThemes[name];

      const updated = {
        ...s.downloadedThemes,
        [type]: updatedThemes,
      };
      saveDownloadedThemes(updated);

      // If currently active, reset to default theme preset
      const currentTheme = s.theme;
      const isCurrentlyApplied =
        (type === "light" && currentTheme.lightTheme.preset === name) ||
        (type === "dark" && currentTheme.darkTheme.preset === name);

      if (isCurrentlyApplied) {
        const defaultPreset = type === "light" ? LIGHT_PRESETS["Default Light"] : DARK_PRESETS["Default Dark"];
        const newTheme = {
          ...currentTheme,
          [type === "light" ? "lightTheme" : "darkTheme"]: {
            ...defaultPreset,
          },
        };
        applyTheme(newTheme);
        saveTheme(newTheme);
        return { downloadedThemes: updated, theme: newTheme };
      }

      return { downloadedThemes: updated };
    });
  },
  initDownloadedThemes: async () => {
    const stored = await loadDownloadedThemes();
    set({ downloadedThemes: stored });
  },
  setAlwaysOnTop: (value) => {
    set({ alwaysOnTop: value });
    try {
      getCurrentWindow()
        .setAlwaysOnTop(value)
        .catch((e) => {
          console.warn("Could not set always-on-top (promise rejected):", e);
        });
    } catch (e) {
      console.warn("Could not set always-on-top:", e);
    }
    saveAlwaysOnTop(value);
  },
  setCloseToTray: (value) => {
    set({ closeToTray: value });
    void saveCloseToTray(value);
    import("@tauri-apps/api/core")
      .then(({ invoke }) => {
        invoke("set_close_to_tray_runtime", { enabled: value }).catch((e) => {
          console.warn("Could not update close-to-tray runtime state:", e);
        });
      })
      .catch((e) => {
        console.warn("Could not import tauri api for tray update:", e);
      });
  },
  setLaunchOnStartup: async (value) => {
    set({ launchOnStartup: value });
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_autostart_enabled", { enabled: value });
    } catch (e) {
      console.warn("Could not set launch on startup:", e);
    }
    saveLaunchOnStartup(value);
  },
  setSendMessageShortcut: (value) => {
    set({ sendMessageShortcut: value });
    saveSendMessageShortcut(value);
  },
  setClearInputOnEscape: (value) => {
    set({ clearInputOnEscape: value });
    saveClearInputOnEscape(value);
  },
  setBaseTextSize: (value) => {
    set({ baseTextSize: value });
    saveBaseTextSize(value);
  },
  setAutoUpdateChecking: (value) => {
    set({ autoUpdateChecking: value });
    saveAutoUpdateChecking(value);
  },
  setLanguage: (value) => {
    set({ language: value });
    saveLanguage(value);
    if (typeof document !== "undefined") {
      document.documentElement.lang = value;
    }
  },
  setIsLoggingEnabled: (value) => {
    set({ isLoggingEnabled: value });
    saveIsLoggingEnabled(value);
  },
  setShowContextWindow: (value) => {
    set({ showContextWindow: value });
    saveShowContextWindow(value);
  },
  setContextTokenizationMode: (value) => {
    set({ contextTokenizationMode: value });
    saveContextTokenizationMode(value);
  },
  setDisableBgActivity: (value) => {
    set({ disableBgActivity: value });
    saveDisableBgActivity(value);
    if (value) {
      useModelStore.getState().stopHealthCheck();
      useModelStore.setState({ modelStatuses: {} });
      void import("./useSearchStore").then(({ useSearchStore }) => {
        useSearchStore.getState().stopConnectionChecks();
        useSearchStore.setState({ searchStatuses: {}, fetchStatuses: {} });
      });
    } else {
      useModelStore.getState().startHealthCheck();
      useModelStore.getState().checkModelConnections();
      if (!get().offlineMode) {
        void import("./useSearchStore").then(({ useSearchStore }) => {
          if (get().disableBgActivity || get().offlineMode) return;
          useSearchStore.getState().startConnectionChecks();
          void Promise.all([
            useSearchStore.getState().checkSearchConnections(),
            useSearchStore.getState().checkFetchConnections(),
          ]);
        });
      }
    }
  },
  setBlockedHosts: (value) => {
    const previous = get().blockedHosts;
    const { allowedLocalEndpoints, offlineMode } = get();
    set({ blockedHosts: value });
    void saveNetworkSettings({ blockedHosts: value, allowedLocalEndpoints, offlineMode }).catch((error) => {
      if (get().blockedHosts === value) set({ blockedHosts: previous });
      console.error("Failed to save blocked hosts:", error);
      get().addToast("Blocked hosts were not saved; the previous list was restored.", "error");
    });
  },
  setAllowedLocalEndpoints: (value) => {
    const previous = get().allowedLocalEndpoints;
    const { blockedHosts, offlineMode } = get();
    set({ allowedLocalEndpoints: value });
    void saveNetworkSettings({ blockedHosts, allowedLocalEndpoints: value, offlineMode }).catch((error) => {
      if (get().allowedLocalEndpoints === value) set({ allowedLocalEndpoints: previous });
      console.error("Failed to save local endpoint grants:", error);
      get().addToast("Local endpoint grants were not saved; the previous list was restored.", "error");
    });
  },
  setOfflineMode: (value) => {
    const previous = get().offlineMode;
    const { blockedHosts, allowedLocalEndpoints } = get();
    set({ offlineMode: value });
    if (value) {
      useModelStore.getState().stopHealthCheck();
      useModelStore.setState({ modelStatuses: {} });
      void import("./useSearchStore").then(({ useSearchStore }) => {
        useSearchStore.getState().stopConnectionChecks();
        useSearchStore.setState({ searchStatuses: {}, fetchStatuses: {} });
      });
      import("./useMcpStore")
        .then(async ({ useMcpStore }) => {
          const mcpState = useMcpStore.getState();
          const connectedIds = Object.entries(mcpState.serverStatuses)
            .filter(([, status]) => status === "connected" || status === "connecting")
            .map(([id]) => id);
          await Promise.all(connectedIds.map((id) => mcpState.disconnectServer(id)));
        })
        .catch((error) => console.error("Failed to disconnect MCP servers for Offline Mode:", error));
    } else if (!useUIStore.getState().disableBgActivity) {
      useModelStore.getState().startHealthCheck();
      void useModelStore.getState().checkModelConnections();
      void import("./useSearchStore").then(({ useSearchStore }) => {
        if (get().disableBgActivity || get().offlineMode) return;
        useSearchStore.getState().startConnectionChecks();
        void Promise.all([
          useSearchStore.getState().checkSearchConnections(),
          useSearchStore.getState().checkFetchConnections(),
        ]);
      });
    }
    void saveNetworkSettings({ blockedHosts, allowedLocalEndpoints, offlineMode: value }).catch((error) => {
      if (get().offlineMode === value) set({ offlineMode: previous });
      console.error("Failed to save Offline Mode:", error);
      get().addToast("Offline Mode was not saved; the previous setting was restored.", "error");
      if (!previous && !get().disableBgActivity) {
        useModelStore.getState().startHealthCheck();
        void useModelStore.getState().checkModelConnections();
        void import("./useSearchStore").then(({ useSearchStore }) => {
          if (get().disableBgActivity || get().offlineMode) return;
          useSearchStore.getState().startConnectionChecks();
          void Promise.all([
            useSearchStore.getState().checkSearchConnections(),
            useSearchStore.getState().checkFetchConnections(),
          ]);
        });
      }
    });
  },
  checkForUpdates: async (silent = false) => {
    const { addToast, offlineMode } = useUIStore.getState();
    if (get().isCheckingUpdates || get().isInstallingUpdate) return;
    if (offlineMode) {
      if (!silent) addToast("Updates are unavailable while Offline Mode is enabled.", "info");
      return;
    }

    set({ isCheckingUpdates: true, updateError: null });
    try {
      if (pendingUpdate) {
        await pendingUpdate.close();
        pendingUpdate = null;
      }

      const update = await check({ timeout: 10_000 });
      if (update) {
        pendingUpdate = update;
        set({
          updateInfo: {
            currentVersion: update.currentVersion,
            latestVersion: update.version,
            releaseNotes: update.body,
          },
          showUpdateModal: true,
        });
      } else {
        set({ updateInfo: null, showUpdateModal: false });
        if (!silent) addToast("You are on the latest version of Sythoria", "success");
      }
    } catch (error) {
      console.error("Failed to check for updates:", error);
      if (!silent) {
        addToast(`Failed to check for updates: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    } finally {
      set({ isCheckingUpdates: false });
    }
  },
  installUpdate: async () => {
    const { addToast } = useUIStore.getState();
    if (get().isInstallingUpdate) return;
    if (!pendingUpdate) {
      addToast("The update is no longer available. Check for updates again.", "error");
      set({ showUpdateModal: false, updateInfo: null });
      return;
    }

    set({ isInstallingUpdate: true, updateDownloadProgress: 0, updateError: null });
    let downloadedBytes = 0;
    let totalBytes: number | undefined;

    try {
      await pendingUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") {
          totalBytes = event.data.contentLength;
          set({ updateDownloadProgress: totalBytes ? 0 : null });
        } else if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          if (totalBytes) {
            set({ updateDownloadProgress: Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) });
          }
        } else {
          set({ updateDownloadProgress: 100 });
        }
      });

      await relaunch();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Failed to install update:", error);
      set({ updateError: message });
      addToast(`Failed to install update: ${message}`, "error");
    } finally {
      set({ isInstallingUpdate: false });
    }
  },
  setShowUpdateModal: (show) => {
    if (!show && !get().isInstallingUpdate) {
      if (pendingUpdate) void pendingUpdate.close();
      pendingUpdate = null;
      set({
        showUpdateModal: false,
        updateInfo: null,
        updateDownloadProgress: null,
        updateError: null,
      });
      return;
    }
    set({ showUpdateModal: show });
  },
  setSkipExternalLinkWarning: (skip) => {
    saveSkipExternalLinkWarning(skip);
    set({ skipExternalLinkWarning: skip });
  },
  setShowCommandPalette: (show) => set({ showCommandPalette: show }),
  toggleCommandPalette: () => set((state) => ({ showCommandPalette: !state.showCommandPalette })),
  setShowSpotlight: (show) => set({ showSpotlight: show }),
  setShowLinkWarningModal: (show, url = null) => {
    set({ showLinkWarningModal: show, pendingLinkUrl: show ? url : null });
  },
  initSkipExternalLinkWarning: async () => {
    const skip = await loadSkipExternalLinkWarning();
    set({ skipExternalLinkWarning: skip });
  },
}));

if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaQuery.addEventListener("change", () => {
    const currentTheme = useUIStore.getState().theme;
    if (currentTheme && currentTheme.mode === "system") {
      applyTheme(currentTheme);
    }
  });
}
