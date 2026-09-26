import { describe, it, expect, vi, beforeEach } from "vitest";
import { useKeybindStore } from "./useKeybindStore";

vi.mock("../utils/storage", () => {
  return {
    loadKeybinds: vi.fn(),
    saveKeybinds: vi.fn(),
    loadZoomLevel: vi.fn().mockResolvedValue(1.0),
    saveZoomLevel: vi.fn(),
    applyZoom: vi.fn(),
    loadHasStarted: vi.fn().mockResolvedValue(false),
    saveHasStarted: vi.fn(),
    saveTheme: vi.fn(),
    saveAnimationsDisabled: vi.fn(),
    loadDownloadedThemes: vi.fn().mockResolvedValue({ light: {}, dark: {} }),
    saveDownloadedThemes: vi.fn(),
    saveAlwaysOnTop: vi.fn(),
    saveCloseToTray: vi.fn(),
    saveLaunchOnStartup: vi.fn(),
    saveSendMessageShortcut: vi.fn(),
    saveClearInputOnEscape: vi.fn(),
    saveBaseTextSize: vi.fn(),
    saveAutoUpdateChecking: vi.fn(),
  };
});

describe("useKeybindStore - Zoom Actions", () => {
  beforeEach(() => {
    // Reset Zustand stores
    useKeybindStore.setState({ zoomLevel: 1.0 });
    vi.clearAllMocks();
  });

  it("should set zoom level", () => {
    useKeybindStore.getState().setZoomLevel(1.25);
    expect(useKeybindStore.getState().zoomLevel).toBe(1.25);
  });

  it("should clamp zoom level between 0.5 and 2.0", () => {
    useKeybindStore.getState().setZoomLevel(3.0);
    expect(useKeybindStore.getState().zoomLevel).toBe(2.0);

    useKeybindStore.getState().setZoomLevel(0.2);
    expect(useKeybindStore.getState().zoomLevel).toBe(0.5);
  });

  it("should zoom in, incrementing by 0.1", () => {
    useKeybindStore.getState().setZoomLevel(1.0);
    useKeybindStore.getState().zoomIn();
    expect(useKeybindStore.getState().zoomLevel).toBe(1.1);
  });

  it("should zoom out, decrementing by 0.1", () => {
    useKeybindStore.getState().setZoomLevel(1.0);
    useKeybindStore.getState().zoomOut();
    expect(useKeybindStore.getState().zoomLevel).toBe(0.9);
  });

  it("should reset zoom to 1.0", () => {
    useKeybindStore.getState().setZoomLevel(1.5);
    useKeybindStore.getState().zoomReset();
    expect(useKeybindStore.getState().zoomLevel).toBe(1.0);
  });
});
