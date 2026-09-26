import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { AppshotConfig, DEFAULT_APPSHOT_CONFIG, loadAppshotConfig, saveAppshotConfig } from "../utils/storage";
import { logInfo, logError } from "../utils/logger";
import { useChatStore } from "./useChatStore";
import { useModelStore } from "./useModelStore";
import { useUIStore } from "./useUIStore";
import { MAX_ATTACHMENTS, MAX_FILE_SIZE_BYTES } from "../config/constants";
import { parseApiError } from "../utils/parseApiError";

export interface AppshotFile {
  path: string;
  name: string;
  size: number;
  timestamp: string;
}

export interface AppshotCaptureResult {
  path: string;
  token: string;
  name: string;
  size: number;
  width: number;
  height: number;
  isEphemeral: boolean;
}

interface CaptureOverrides {
  persistToGallery?: boolean;
  maxOutputBytes?: number;
}

interface ClearOptions {
  skipConfirmation?: boolean;
}

interface CaptureAndAttachOptions {
  skipConfirmation?: boolean;
  revealChat?: boolean;
}

interface AppshotStore {
  config: AppshotConfig;
  recentAppshots: AppshotFile[];
  isCapturing: boolean;
  loading: boolean;
  initialized: boolean;
  error: string | null;
  hasPermission: boolean | null;
  isRequestingPermission: boolean;

  init: () => Promise<void>;
  updateConfig: (updates: Partial<AppshotConfig>) => Promise<void>;
  checkPermission: () => Promise<boolean>;
  requestPermission: () => Promise<boolean>;
  openPermissionSettings: () => Promise<void>;
  triggerCapture: (overrides?: CaptureOverrides) => Promise<AppshotCaptureResult>;
  runCleanup: () => Promise<number>;
  loadRecentAppshots: () => Promise<void>;
  deleteAppshot: (path: string) => Promise<void>;
  clearAll: (options?: ClearOptions) => Promise<void>;
  captureAndAttachToChat: (options?: CaptureAndAttachOptions) => Promise<void>;
}

let initializationPromise: Promise<void> | null = null;

function errorMessage(error: unknown): string {
  return parseApiError(error).message;
}

export const useAppshotStore = create<AppshotStore>((set, get) => ({
  config: { ...DEFAULT_APPSHOT_CONFIG },
  recentAppshots: [],
  isCapturing: false,
  loading: false,
  initialized: false,
  error: null,
  hasPermission: null,
  isRequestingPermission: false,

  init: async () => {
    if (get().initialized) return;
    if (initializationPromise) return initializationPromise;

    initializationPromise = (async () => {
      set({ loading: true, error: null });
      try {
        const config = await loadAppshotConfig();
        set({ config });
        await Promise.all([get().checkPermission(), get().loadRecentAppshots()]);
        if (config.autoCleanEnabled) {
          await get().runCleanup();
          await get().loadRecentAppshots();
        }
        set({ initialized: true });
      } catch (error) {
        const message = errorMessage(error);
        logError("appshots", "Failed to initialize Appshots store", { error });
        set({ error: message });
      } finally {
        set({ loading: false });
        initializationPromise = null;
      }
    })();

    return initializationPromise;
  },

  checkPermission: async () => {
    try {
      const hasPermission = await invoke<boolean>("has_screen_capture_permission");
      set({ hasPermission });
      return hasPermission;
    } catch (error) {
      logError("appshots", "Failed to check screen capture permission", { error });
      set({ hasPermission: false });
      return false;
    }
  },

  requestPermission: async () => {
    if (get().isRequestingPermission) return false;

    set({ isRequestingPermission: true });
    try {
      const granted = await invoke<boolean>("request_screen_capture_permission");
      set({ hasPermission: granted });
      return granted;
    } catch (error) {
      logError("appshots", "Failed to request screen capture permission", { error });
      set({ hasPermission: false });
      throw error;
    } finally {
      set({ isRequestingPermission: false });
    }
  },

  openPermissionSettings: async () => {
    await invoke("open_screen_capture_settings");
  },

  updateConfig: async (updates) => {
    const previousConfig = get().config;
    const newConfig = { ...previousConfig, ...updates };
    set({ config: newConfig, error: null });
    try {
      await saveAppshotConfig(newConfig);
      logInfo("appshots", "Updated Appshots configuration");
      if (Object.prototype.hasOwnProperty.call(updates, "captureFolder")) {
        await get().loadRecentAppshots();
      }
    } catch (error) {
      set({ config: previousConfig, error: errorMessage(error) });
      throw error;
    }
  },

  triggerCapture: async (overrides = {}) => {
    if (get().isCapturing) {
      throw new Error("Another Appshot capture is already in progress");
    }
    set({ isCapturing: true, error: null });
    try {
      const hasPermission = await get().checkPermission();
      if (!hasPermission) {
        const message = "Screen capture permission is required. Enable it in your system privacy settings.";
        set({ error: message });
        throw new Error(message);
      }

      const config = get().config;
      const persistToGallery = overrides.persistToGallery ?? config.saveToGallery;
      const result = await invoke<AppshotCaptureResult>("capture_screen", {
        options: {
          format: config.imageFormat,
          quality: config.imageQuality,
          customFolder: persistToGallery ? config.captureFolder || null : null,
          persistToGallery,
          maxOutputBytes: overrides.maxOutputBytes ?? null,
        },
      });
      logInfo("appshots", `Captured ${result.name} (${result.width}x${result.height})`);
      if (persistToGallery) {
        await get().loadRecentAppshots();
      }
      return result;
    } catch (error) {
      const message = errorMessage(error);
      if (!message.toLowerCase().includes("cancel")) {
        logError("appshots", "Screen capture failed", { error });
      }
      set({ error: message });
      throw error;
    } finally {
      set({ isCapturing: false });
    }
  },

  runCleanup: async () => {
    const { autoCleanEnabled, autoCleanType, autoCleanValue, captureFolder } = get().config;
    if (!autoCleanEnabled) return 0;
    try {
      const deleted = await invoke<number>("run_appshots_clean", {
        cleanType: autoCleanType,
        cleanValue: autoCleanValue,
        customFolder: captureFolder || null,
      });
      if (deleted > 0) {
        logInfo("appshots", `Appshot retention removed ${deleted} old capture(s)`);
      }
      return deleted;
    } catch (error) {
      logError("appshots", "Appshot retention cleanup failed", { error });
      return 0;
    }
  },

  loadRecentAppshots: async () => {
    const { captureFolder } = get().config;
    try {
      const recentAppshots = await invoke<AppshotFile[]>("list_appshots", {
        customFolder: captureFolder || null,
      });
      set({ recentAppshots });
    } catch (error) {
      logError("appshots", "Failed to load the Appshot gallery", { error });
      set({ recentAppshots: [] });
    }
  },

  deleteAppshot: async (path) => {
    try {
      const customFolder = get().config.captureFolder || null;
      await invoke("delete_appshot", { path, customFolder });
      logInfo("appshots", "Deleted an Appshot from the gallery");
      await get().loadRecentAppshots();
    } catch (error) {
      const message = errorMessage(error);
      logError("appshots", "Failed to delete an Appshot", { error });
      useUIStore.getState().addToast(message, "error");
    }
  },

  clearAll: async (options = {}) => {
    if (!options.skipConfirmation) {
      const confirmed = window.confirm("Delete every Appshot in the current gallery folder?");
      if (!confirmed) return;
    }

    set({ loading: true });
    try {
      const customFolder = get().config.captureFolder || null;
      const deleted = await invoke<number>("clear_appshots", { customFolder });
      logInfo("appshots", `Cleared ${deleted} Appshot(s) from the gallery`);
      await get().loadRecentAppshots();
    } catch (error) {
      const message = errorMessage(error);
      logError("appshots", "Failed to clear the Appshot gallery", { error });
      useUIStore.getState().addToast(message, "error");
    } finally {
      set({ loading: false });
    }
  },

  captureAndAttachToChat: async (options = {}) => {
    const ui = useUIStore.getState();
    try {
      await get().init();
      const { config } = get();
      if (!config.enabled) {
        ui.addToast("Appshots is disabled. Enable it in Settings > Appshots.", "info");
        return;
      }

      const chatStore = useChatStore.getState();
      if (chatStore.draftAttachments.length >= MAX_ATTACHMENTS) {
        ui.addToast(`Maximum of ${MAX_ATTACHMENTS} attachments reached`, "info");
        return;
      }
      const modelStore = useModelStore.getState();
      const selectedModel = modelStore.models.find((model) => model.id === modelStore.selectedModel);
      if (selectedModel?.supportsImages === false) {
        ui.addToast(`"${selectedModel.name}" does not support image inputs.`, "error");
        return;
      }

      if (!options.skipConfirmation) {
        const confirmed = window.confirm("Capture the frontmost application and add it to the chat draft?");
        if (!confirmed) return;
      }
      const beforeCount = useChatStore.getState().draftAttachments.length;
      const capture = await get().triggerCapture({
        persistToGallery: config.saveToGallery,
        maxOutputBytes: MAX_FILE_SIZE_BYTES,
      });
      await useChatStore.getState().addDraftFileFromToken(capture.token, capture.name, capture.size);
      const afterCount = useChatStore.getState().draftAttachments.length;
      if (afterCount <= beforeCount) {
        throw new Error("The Appshot was captured but could not be added to the chat draft");
      }

      if (config.saveToGallery) {
        await get().runCleanup();
        await get().loadRecentAppshots();
      }
      ui.addToast("Appshot added to the chat draft", "success");
    } catch (error) {
      const message = errorMessage(error);
      if (!message.toLowerCase().includes("cancel")) {
        logError("appshots", "Failed to capture and attach an Appshot", { error });
        ui.addToast(`Capture failed: ${message}`, "error");
      }
    } finally {
      if (options.revealChat) {
        ui.setView("chat");
        try {
          await invoke("reveal_main_window");
        } catch (error) {
          logError("appshots", "Failed to reveal the chat after Appshot capture", { error });
        }
      }

      setTimeout(() => {
        if (typeof document !== "undefined") {
          document.getElementById("chat-input")?.focus();
        }
      }, 50);
    }
  },
}));
