import { describe, expect, it } from "vitest";
import { isGenerationActive, type GenerationState } from ".";

describe("isGenerationActive", () => {
  it.each<GenerationState>(["loading", "thinking", "searching", "fetching", "responding", "mcp_executing"])(
    "treats %s as active",
    (state) => {
      expect(isGenerationActive(state)).toBe(true);
    },
  );

  it.each<GenerationState>(["idle", "error", "cancelled"])("treats %s as terminal", (state) => {
    expect(isGenerationActive(state)).toBe(false);
  });
});
