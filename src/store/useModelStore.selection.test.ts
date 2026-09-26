import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelConfig } from "../types";

const storageMocks = vi.hoisted(() => ({
  saveSelectedModel: vi.fn(),
  saveMaxToolSteps: vi.fn(),
  saveUnlimitedToolSteps: vi.fn(),
}));

vi.mock("../utils/storage", () => ({
  saveModelConfigs: vi.fn(),
  saveApiKeys: vi.fn(),
  saveTitleConfig: vi.fn(),
  saveSystemPrompt: vi.fn(),
  saveMaxToolSteps: storageMocks.saveMaxToolSteps,
  saveUnlimitedToolSteps: storageMocks.saveUnlimitedToolSteps,
  saveSelectedModel: storageMocks.saveSelectedModel,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { useModelStore } from "./useModelStore";

const models: ModelConfig[] = [
  {
    id: "model-1",
    name: "First model",
    apiBase: "https://example.com/v1",
    apiKey: "",
    modelId: "first-model",
    enabled: true,
  },
  {
    id: "model-2",
    name: "Selected model",
    apiBase: "https://example.com/v1",
    apiKey: "",
    modelId: "selected-model",
    enabled: true,
  },
];

describe("useModelStore model selection", () => {
  beforeEach(() => {
    storageMocks.saveSelectedModel.mockReset();
    storageMocks.saveMaxToolSteps.mockReset();
    storageMocks.saveUnlimitedToolSteps.mockReset();
    useModelStore.setState({
      models,
      selectedModel: "model-1",
      modelStatuses: {
        "model-1": "connected",
        "model-2": "connected",
      },
      unlimitedToolSteps: false,
    });
  });

  it("persists an enabled model selection", () => {
    useModelStore.getState().setSelectedModel("model-2");

    expect(useModelStore.getState().selectedModel).toBe("model-2");
    expect(storageMocks.saveSelectedModel).toHaveBeenCalledWith("model-2");
  });

  it("does not replace the selection with an unknown model", () => {
    useModelStore.getState().setSelectedModel("missing-model");

    expect(useModelStore.getState().selectedModel).toBe("model-1");
    expect(storageMocks.saveSelectedModel).not.toHaveBeenCalled();
  });

  it("moves and persists selection when the selected model is disabled", () => {
    useModelStore.getState().updateModel("model-1", { enabled: false });

    expect(useModelStore.getState().selectedModel).toBe("model-2");
    expect(storageMocks.saveSelectedModel).toHaveBeenCalledWith("model-2");
  });

  it("accepts custom tool step amounts within the supported range", () => {
    useModelStore.getState().setMaxToolSteps(100);

    expect(useModelStore.getState().maxToolSteps).toBe(100);
    expect(storageMocks.saveMaxToolSteps).toHaveBeenCalledWith(100);
  });

  it("clamps out-of-range tool step amounts to the supported range", () => {
    useModelStore.getState().setMaxToolSteps(5000);
    expect(useModelStore.getState().maxToolSteps).toBe(200);
    useModelStore.getState().setMaxToolSteps(0);
    expect(useModelStore.getState().maxToolSteps).toBe(1);
  });

  it("persists the unlimited tool steps toggle", () => {
    useModelStore.getState().setUnlimitedToolSteps(true);

    expect(useModelStore.getState().unlimitedToolSteps).toBe(true);
    expect(storageMocks.saveUnlimitedToolSteps).toHaveBeenCalledWith(true);
  });
});
