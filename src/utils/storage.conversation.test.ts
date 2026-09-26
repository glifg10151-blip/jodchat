import { describe, expect, it } from "vitest";
import { ConversationSchema } from "./storage";

describe("ConversationSchema", () => {
  it("preserves stopped subagent state and recursion depth", () => {
    const result = ConversationSchema.safeParse({
      id: "subagent-1",
      title: "Security review",
      timestamp: "2026-07-16T12:00:00.000Z",
      messages: [],
      model: "model-1",
      parentId: "conversation-1",
      role: "security",
      isSubagent: true,
      status: "stopped",
      recursionDepth: 3,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.status).toBe("stopped");
    expect(result.data.recursionDepth).toBe(3);
  });

  it("rejects invalid recursion depths", () => {
    const result = ConversationSchema.safeParse({
      id: "subagent-1",
      title: "Security review",
      timestamp: new Date(),
      messages: [],
      model: "model-1",
      isSubagent: true,
      recursionDepth: -1,
    });

    expect(result.success).toBe(false);
  });

  it("preserves reasoning, tool metadata, and forward-compatible fields", () => {
    const result = ConversationSchema.safeParse({
      id: "conversation-1",
      title: "Storage round trip",
      timestamp: "2026-07-27T12:00:00.000Z",
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Done",
          reasoningContent: "Internal reasoning",
          responsesOutput: [{ type: "reasoning", id: "rs_1", summary: [], encrypted_content: "opaque" }],
          thinkingDuration: 4,
          workingDuration: 12,
          searchConfigId: "search-1",
          workspaceChanges: {
            projectId: "project-a",
            appliedAt: "2026-07-27T12:00:02.000Z",
            undoToken: "undo-turn-1",
            files: [{ path: "src/App.tsx", additions: 3, deletions: 1 }],
          },
          timestamp: "2026-07-27T12:00:01.000Z",
          futureMessageField: "preserve me",
          toolResult: {
            id: "tool-1",
            name: "project_edit",
            content: "updated",
            diffSummary: { added: 3, deleted: 1, filename: "src/App.tsx" },
            subagentIds: ["subagent-1"],
          },
        },
      ],
      model: "model-1",
      futureConversationField: true,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.messages[0].reasoningContent).toBe("Internal reasoning");
    expect(result.data.messages[0].responsesOutput).toEqual([
      { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "opaque" },
    ]);
    expect(result.data.messages[0].thinkingDuration).toBe(4);
    expect(result.data.messages[0].workingDuration).toBe(12);
    expect(result.data.messages[0].searchConfigId).toBe("search-1");
    expect(result.data.messages[0].workspaceChanges).toMatchObject({
      projectId: "project-a",
      undoToken: "undo-turn-1",
      files: [{ path: "src/App.tsx", additions: 3, deletions: 1 }],
    });
    expect(result.data.messages[0].workspaceChanges?.appliedAt).toEqual(new Date("2026-07-27T12:00:02.000Z"));
    expect(result.data.messages[0].toolResult?.diffSummary?.added).toBe(3);
    expect(result.data.messages[0].toolResult?.subagentIds).toEqual(["subagent-1"]);
    expect(result.data.messages[0].futureMessageField).toBe("preserve me");
    expect(result.data.futureConversationField).toBe(true);
  });

  it("preserves the captured commit scope for a pending worktree", () => {
    const result = ConversationSchema.safeParse({
      id: "conversation-1",
      title: "Pending changes",
      timestamp: new Date(),
      messages: [],
      model: "model-a",
      projectId: "project-a",
      pendingWorktree: {
        path: "/worktrees/run-a",
        branch: "sythoria-agent-a",
        commitScope: {
          projectId: "project-a",
          projectRoot: "/projects/a",
          modelId: "model-a",
        },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pendingWorktree?.commitScope).toEqual({
      projectId: "project-a",
      projectRoot: "/projects/a",
      modelId: "model-a",
    });
  });
});
