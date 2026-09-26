import { describe, expect, it } from "vitest";
import type { Conversation } from "../types";
import {
  collectConversationTreeIds,
  reduceConversationDeletion,
  type ConversationLifecycleState,
} from "./conversationLifecycle";

function conversation(id: string, parentId?: string, isSubagent = false): Conversation {
  return {
    id,
    parentId,
    isSubagent,
    title: id,
    timestamp: new Date("2026-08-09T00:00:00Z"),
    messages: [],
    model: "model",
  };
}

function lifecycleState(overrides: Partial<ConversationLifecycleState> = {}): ConversationLifecycleState {
  return {
    conversations: [],
    activeId: null,
    navigationHistory: [],
    navigationIndex: -1,
    compareIds: [],
    isCompareMode: false,
    generationByConversation: {},
    activeStreamContent: {},
    activeStreamReasoning: {},
    activeStreamThinkingStart: {},
    activeStreamThinkingEnd: {},
    activeStreamStartTime: {},
    isStreaming: false,
    generationState: "idle",
    generationLabel: "",
    ...overrides,
  };
}

describe("collectConversationTreeIds", () => {
  it("collects descendants even when children appear before their parents", () => {
    const conversations = [
      conversation("grandchild", "child", true),
      conversation("unrelated"),
      conversation("child", "root", true),
      conversation("root"),
    ];

    expect([...collectConversationTreeIds(conversations, ["root"])]).toEqual(
      expect.arrayContaining(["root", "child", "grandchild"]),
    );
    expect(collectConversationTreeIds(conversations, ["root"]).has("unrelated")).toBe(false);
  });
});

describe("reduceConversationDeletion", () => {
  it("removes lifecycle records and navigates to the latest surviving history entry", () => {
    const root = conversation("root");
    const child = conversation("child", root.id, true);
    const destination = conversation("destination");
    const result = reduceConversationDeletion(
      lifecycleState({
        conversations: [root, child, destination],
        activeId: root.id,
        navigationHistory: [destination.id, root.id],
        navigationIndex: 1,
        compareIds: [child.id],
        isCompareMode: true,
        generationByConversation: {
          [root.id]: { state: "responding", label: "Responding" },
          [destination.id]: { state: "searching", label: "Searching" },
        },
        activeStreamContent: { [root.id]: "partial", [destination.id]: "kept" },
        isStreaming: true,
        generationState: "responding",
        generationLabel: "Responding",
      }),
      new Set([root.id, child.id]),
    );

    expect(result.conversations).toEqual([destination]);
    expect(result.activeId).toBe(destination.id);
    expect(result.navigationHistory).toEqual([destination.id]);
    expect(result.navigationIndex).toBe(0);
    expect(result.compareIds).toEqual([]);
    expect(result.isCompareMode).toBe(false);
    expect(result.generationByConversation).toEqual({
      [destination.id]: { state: "searching", label: "Searching" },
    });
    expect(result.activeStreamContent).toEqual({ [destination.id]: "kept" });
    expect(result.isStreaming).toBe(true);
  });

  it("uses a valid preferred destination and resets global generation when no runs survive", () => {
    const removed = conversation("removed");
    const preferred = conversation("preferred");
    const result = reduceConversationDeletion(
      lifecycleState({
        conversations: [removed, preferred],
        activeId: removed.id,
        navigationHistory: [removed.id, "stale"],
        navigationIndex: 0,
        generationByConversation: { [removed.id]: { state: "responding", label: "Responding" } },
        isStreaming: true,
        generationState: "responding",
        generationLabel: "Responding",
      }),
      new Set([removed.id]),
      { preferredActiveId: preferred.id, appendPreferredToHistory: true },
    );

    expect(result.activeId).toBe(preferred.id);
    expect(result.navigationHistory).toEqual([preferred.id]);
    expect(result.navigationIndex).toBe(0);
    expect(result.isStreaming).toBe(false);
    expect(result.generationState).toBe("idle");
    expect(result.generationLabel).toBe("");
  });
});
