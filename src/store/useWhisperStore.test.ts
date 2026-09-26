import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  saveWhisperConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("../utils/storage", () => ({
  loadWhisperConfig: vi.fn().mockResolvedValue({ config: {}, legacyCloudApiKey: null }),
  removeLegacyWhisperConfig: vi.fn(),
  saveWhisperConfig: mocks.saveWhisperConfig,
}));

describe("useWhisperStore", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.invoke.mockReset();
    mocks.listen.mockReset().mockResolvedValue(vi.fn());
    mocks.saveWhisperConfig.mockClear();
  });

  it("initializes download state and encrypted credential presence from native storage", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "has_cloud_stt_api_key") return true;
      if (command === "check_downloaded_whisper_models") return ["ggml-tiny.en.bin"];
      throw new Error(`Unexpected command: ${command}`);
    });
    const { useWhisperStore } = await import("./useWhisperStore");

    await useWhisperStore.getState().init();

    expect(useWhisperStore.getState()).toMatchObject({
      cloudApiKeyConfigured: true,
      downloadedFiles: ["ggml-tiny.en.bin"],
    });
    expect(mocks.listen).toHaveBeenCalledWith("whisper-download-progress", expect.any(Function));
  });

  it("rolls back configured state when an encrypted credential write fails", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("keychain locked"));
    const { useWhisperStore } = await import("./useWhisperStore");
    useWhisperStore.setState({ cloudApiKey: "secret", cloudApiKeyConfigured: false });

    await expect(useWhisperStore.getState().ensureCloudApiKeySaved()).resolves.toBe(false);

    expect(useWhisperStore.getState().cloudApiKeyConfigured).toBe(false);
  });

  it("persists the LLM polish preference", async () => {
    const { useWhisperStore } = await import("./useWhisperStore");

    useWhisperStore.getState().setIsLlmPolishEnabled(false);

    expect(useWhisperStore.getState().isLlmPolishEnabled).toBe(false);
    expect(mocks.saveWhisperConfig).toHaveBeenCalledWith(expect.objectContaining({ isLlmPolishEnabled: false }));
  });
});
