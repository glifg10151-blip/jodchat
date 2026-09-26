import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const defaultConfig = {
    enabled: true,
    captureFolder: "",
    imageFormat: "png" as const,
    imageQuality: 85,
    autoCleanEnabled: true,
    autoCleanType: "count" as const,
    autoCleanValue: 50,
    saveToGallery: false,
  };
  return {
    defaultConfig,
    invoke: vi.fn(),
    loadAppshotConfig: vi.fn(),
    saveAppshotConfig: vi.fn(),
    addToast: vi.fn(),
    setView: vi.fn(),
    addDraftFileFromToken: vi.fn(),
    chatState: {
      draftAttachments: [] as Array<{ id: string }>,
    },
    modelState: {
      selectedModel: "vision-model",
      models: [{ id: "vision-model", name: "Vision", supportsImages: true }],
    },
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("../utils/storage", () => ({
  DEFAULT_APPSHOT_CONFIG: mocks.defaultConfig,
  loadAppshotConfig: mocks.loadAppshotConfig,
  saveAppshotConfig: mocks.saveAppshotConfig,
}));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("./useChatStore", () => ({
  useChatStore: {
    getState: () => ({
      ...mocks.chatState,
      addDraftFileFromToken: mocks.addDraftFileFromToken,
    }),
  },
}));

vi.mock("./useModelStore", () => ({
  useModelStore: {
    getState: () => mocks.modelState,
  },
}));

vi.mock("./useUIStore", () => ({
  useUIStore: {
    getState: () => ({ addToast: mocks.addToast, setView: mocks.setView }),
  },
}));

import { useAppshotStore } from "./useAppshotStore";

const captureResult = {
  path: "C:\\cache\\appshot.png",
  token: "capture-token",
  name: "appshot.png",
  size: 1024,
  width: 1280,
  height: 720,
  isEphemeral: true,
};

describe("useAppshotStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chatState.draftAttachments = [];
    mocks.modelState.selectedModel = "vision-model";
    mocks.modelState.models = [{ id: "vision-model", name: "Vision", supportsImages: true }];
    mocks.loadAppshotConfig.mockResolvedValue({ ...mocks.defaultConfig });
    mocks.saveAppshotConfig.mockResolvedValue(undefined);
    mocks.addDraftFileFromToken.mockImplementation(async () => {
      mocks.chatState.draftAttachments = [...mocks.chatState.draftAttachments, { id: "attached" }];
    });
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "has_screen_capture_permission") return true;
      if (command === "list_appshots") return [];
      if (command === "run_appshots_clean") return 0;
      if (command === "clear_appshots") return 0;
      if (command === "capture_screen") return captureResult;
      return true;
    });
    useAppshotStore.setState({
      config: { ...mocks.defaultConfig },
      recentAppshots: [],
      isCapturing: false,
      loading: false,
      initialized: false,
      error: null,
      hasPermission: true,
      isRequestingPermission: false,
    });
  });

  it("loads persisted settings and applies retention during startup", async () => {
    const persisted = {
      ...mocks.defaultConfig,
      saveToGallery: true,
    };
    mocks.loadAppshotConfig.mockResolvedValue(persisted);

    await useAppshotStore.getState().init();

    expect(useAppshotStore.getState().config).toEqual(persisted);
    expect(useAppshotStore.getState().initialized).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith("run_appshots_clean", {
      cleanType: "count",
      cleanValue: 50,
      customFolder: null,
    });
  });

  it("rejects a concurrent capture before invoking the backend twice", async () => {
    let finishCapture: ((value: typeof captureResult) => void) | undefined;
    const pendingCapture = new Promise<typeof captureResult>((resolve) => {
      finishCapture = resolve;
    });
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "has_screen_capture_permission") return true;
      if (command === "capture_screen") return pendingCapture;
      if (command === "list_appshots") return [];
      return 0;
    });

    const first = useAppshotStore.getState().triggerCapture();
    await vi.waitFor(() => expect(useAppshotStore.getState().isCapturing).toBe(true));
    await expect(useAppshotStore.getState().triggerCapture()).rejects.toThrow("already in progress");
    finishCapture?.(captureResult);
    await first;

    expect(mocks.invoke.mock.calls.filter(([command]) => command === "capture_screen")).toHaveLength(1);
    expect(useAppshotStore.getState().isCapturing).toBe(false);
  });

  it("preflights image support before capturing", async () => {
    mocks.modelState.models = [{ id: "vision-model", name: "Text only", supportsImages: false }];
    useAppshotStore.setState({ initialized: true });

    await useAppshotStore.getState().captureAndAttachToChat();

    expect(mocks.invoke).not.toHaveBeenCalledWith("capture_screen", expect.anything());
    expect(mocks.addToast).toHaveBeenCalledWith('"Text only" does not support image inputs.', "error");
  });

  it("uses an ephemeral, size-bounded capture for chat attachment by default", async () => {
    useAppshotStore.setState({ initialized: true });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await useAppshotStore.getState().captureAndAttachToChat();

    expect(mocks.invoke).toHaveBeenCalledWith("capture_screen", {
      options: expect.objectContaining({
        persistToGallery: false,
        customFolder: null,
        maxOutputBytes: 10 * 1024 * 1024,
      }),
    });
    expect(mocks.invoke).toHaveBeenCalledWith("capture_screen", {
      options: expect.not.objectContaining({ delaySeconds: expect.anything(), hideWindow: expect.anything() }),
    });
    expect(mocks.addDraftFileFromToken).toHaveBeenCalledWith("capture-token", "appshot.png", 1024);
    expect(mocks.invoke).not.toHaveBeenCalledWith("run_appshots_clean", expect.anything());
    expect(mocks.addToast).toHaveBeenCalledWith("Appshot added to the chat draft", "success");
  });

  it("runs retention only after a persistent capture has been attached", async () => {
    useAppshotStore.setState({
      initialized: true,
      config: { ...mocks.defaultConfig, saveToGallery: true },
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await useAppshotStore.getState().captureAndAttachToChat();

    const attachOrder = mocks.addDraftFileFromToken.mock.invocationCallOrder[0];
    const cleanupCall = mocks.invoke.mock.calls.findIndex(([command]) => command === "run_appshots_clean");
    const cleanupOrder = mocks.invoke.mock.invocationCallOrder[cleanupCall];
    expect(attachOrder).toBeLessThan(cleanupOrder);
  });

  it("captures globally without confirmation and reveals the chat afterward", async () => {
    useAppshotStore.setState({ initialized: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    await useAppshotStore.getState().captureAndAttachToChat({
      skipConfirmation: true,
      revealChat: true,
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.addDraftFileFromToken).toHaveBeenCalledWith("capture-token", "appshot.png", 1024);
    expect(mocks.setView).toHaveBeenCalledWith("chat");
    expect(mocks.invoke).toHaveBeenCalledWith("reveal_main_window");
  });

  it("clears the gallery with one backend operation", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "clear_appshots") return 3;
      if (command === "list_appshots") return [];
      return true;
    });

    await useAppshotStore.getState().clearAll({ skipConfirmation: true });

    expect(mocks.invoke).toHaveBeenCalledWith("clear_appshots", { customFolder: null });
    expect(mocks.invoke).not.toHaveBeenCalledWith("delete_appshot", expect.anything());
  });
});
