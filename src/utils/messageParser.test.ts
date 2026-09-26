import { describe, expect, it } from "vitest";
import { parseReasoning } from "./messageParser";

describe("parseReasoning", () => {
  it("keeps provider reasoning separate from visible content", () => {
    expect(parseReasoning("I will check the weather.", "assistant", "Need current data.")).toEqual({
      reasoningContent: "Need current data.",
      displayContent: "I will check the weather.",
      hasOpenReasoning: true,
    });
  });

  it("does not interpret literal tags in new visible content", () => {
    expect(parseReasoning("<thinking>example markup</thinking>", "assistant", "")).toEqual({
      reasoningContent: "",
      displayContent: "<thinking>example markup</thinking>",
      hasOpenReasoning: false,
    });
  });

  it("still reads synthetic tags from messages persisted by older versions", () => {
    expect(parseReasoning("<reasoning>legacy analysis</reasoning>Legacy answer", "assistant")).toEqual({
      reasoningContent: "legacy analysis",
      displayContent: "Legacy answer",
      hasOpenReasoning: true,
    });
  });
});
