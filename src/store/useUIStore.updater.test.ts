import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
  close: vi.fn(),
  downloadAndInstall: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn(() => ({})) }));
vi.mock("../utils/storage", () => ({
  loadHasStarted: vi.fn(),
  saveHasStarted: vi.fn(),
  saveTheme: vi.fn(),
  saveAnimationsDisabled: vi.fn(),
  loadDownloadedThemes: vi.fn(),
  saveDownloadedThemes: vi.fn(),
  saveAlwaysOnTop: vi.fn(),
  saveCloseToTray: vi.fn(),
  saveLaunchOnStartup: vi.fn(),
  saveSendMessageShortcut: vi.fn(),
  saveClearInputOnEscape: vi.fn(),
  saveBaseTextSize: vi.fn(),
  saveAutoUpdateChecking: vi.fn(),
  saveShowContextWindow: vi.fn(),
  saveIsLoggingEnabled: vi.fn(),
  saveDisableBgActivity: vi.fn(),
  saveNetworkSettings: vi.fn().mockResolvedValue(undefined),
  saveLanguage: vi.fn(),
  loadSkipExternalLinkWarning: vi.fn(),
  saveSkipExternalLinkWarning: vi.fn(),
  saveUiLayoutSettings: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./useModelStore", () => ({
  useModelStore: {
    getState: () => ({ stopHealthCheck: vi.fn(), startHealthCheck: vi.fn(), checkModelConnections: vi.fn() }),
    setState: vi.fn(),
  },
}));
vi.mock("./useProjectStore", () => ({ useProjectStore: { getState: () => ({}) } }));

describe("useUIStore updater state machine", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.check.mockReset();
    mocks.relaunch.mockReset().mockResolvedValue(undefined);
    mocks.close.mockReset().mockResolvedValue(undefined);
    mocks.downloadAndInstall.mockReset();
  });

  it("checks, downloads, reports progress, and relaunches", async () => {
    mocks.downloadAndInstall.mockImplementation(async (onEvent: (event: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 40 } });
      onEvent({ event: "Finished", data: {} });
    });
    mocks.check.mockResolvedValue({
      currentVersion: "0.4.0",
      version: "0.4.1",
      body: "Security fixes",
      close: mocks.close,
      downloadAndInstall: mocks.downloadAndInstall,
    });
    const { useUIStore } = await import("./useUIStore");

    await useUIStore.getState().checkForUpdates(false);
    expect(useUIStore.getState()).toMatchObject({
      isCheckingUpdates: false,
      showUpdateModal: true,
      updateInfo: { currentVersion: "0.4.0", latestVersion: "0.4.1" },
    });

    await useUIStore.getState().installUpdate();
    expect(useUIStore.getState()).toMatchObject({ isInstallingUpdate: false, updateDownloadProgress: 100 });
    expect(mocks.relaunch).toHaveBeenCalledOnce();
  });

  it("does not contact the updater while offline", async () => {
    const { useUIStore } = await import("./useUIStore");
    useUIStore.setState({ offlineMode: true });

    await useUIStore.getState().checkForUpdates(false);

    expect(mocks.check).not.toHaveBeenCalled();
    expect(useUIStore.getState().toasts.at(-1)?.message).toBe("Updates are unavailable while Offline Mode is enabled.");
  });
});
