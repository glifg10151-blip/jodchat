import { describe, expect, it } from "vitest";
import type { Message } from "../types";
import { estimateConversationTokens, estimateMessageTokens } from "./tokens";

describe("reasoning token estimates", () => {
  const assistantMessage: Message = {
    id: "assistant-1",
    role: "assistant",
    content: "Answer",
    reasoningContent: "r".repeat(400),
    timestamp: new Date(),
  };

  it("includes preserved reasoning in a message estimate", () => {
    expect(estimateMessageTokens(assistantMessage)).toBe(Math.ceil(("Answer".length + 400) / 4));
  });

  it("includes preserved reasoning in the conversation context estimate", () => {
    const estimate = estimateConversationTokens([assistantMessage], "");
    expect(estimate.messagesTokens).toBe(Math.ceil(("Answer".length + 400) / 4));
    expect(estimate.total).toBe(estimate.messagesTokens);
  });
});
