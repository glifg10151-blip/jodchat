import { describe, expect, it } from "vitest";
import type { ModelConfig } from "../types";
import { getThinkingLabel, supportsThinkingControl } from "./thinking";

function model(provider: string, modelId: string): ModelConfig {
  return { id: modelId, name: modelId, provider, modelId, apiBase: "https://example.com", apiKey: "" };
}

describe("thinking controls", () => {
  it("recognizes supported provider and model combinations", () => {
    expect(supportsThinkingControl(model("openai", "gpt-5"))).toBe(true);
    expect(supportsThinkingControl(model("gemini", "gemini-2.5-pro"))).toBe(true);
    expect(supportsThinkingControl(model("anthropic", "claude-opus-4-8"))).toBe(true);
    expect(supportsThinkingControl(model("ollama", "gpt-oss:20b"))).toBe(true);
    expect(supportsThinkingControl(model("openrouter", "anthropic/claude-opus-4.8"))).toBe(true);
  });

  it("does not claim support for non-reasoning or custom endpoints", () => {
    expect(supportsThinkingControl(model("openai", "gpt-4o"))).toBe(false);
    expect(supportsThinkingControl(model("custom", "private-model"))).toBe(false);
  });

  it("uses Auto when a saved preference is absent", () => {
    expect(getThinkingLabel(model("openai", "gpt-5"))).toBe("Auto");
  });
});
