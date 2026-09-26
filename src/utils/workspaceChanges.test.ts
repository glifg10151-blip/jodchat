import { describe, expect, it } from "vitest";
import type { Message, WorkspaceChangeSet } from "../types";
import { attachWorkspaceChangesToLatestAssistant, removeWorkspaceChangesByUndoToken } from "./workspaceChanges";

const changes: WorkspaceChangeSet = {
  projectId: "project-a",
  appliedAt: new Date("2026-08-30T12:00:00Z"),
  undoToken: "undo-turn-1",
  files: [{ path: "src/App.tsx", additions: 2, deletions: 1 }],
};

describe("workspace change message metadata", () => {
  it("attaches a captured patch to the latest visible assistant response", () => {
    const messages: Message[] = [
      { id: "assistant-1", role: "assistant", content: "Earlier", timestamp: new Date() },
      {
        id: "disclosure",
        role: "assistant",
        content: "Context condensed",
        timestamp: new Date(),
        isSystem: true,
      },
      { id: "assistant-2", role: "assistant", content: "Done", timestamp: new Date() },
    ];

    const updated = attachWorkspaceChangesToLatestAssistant(messages, changes);

    expect(updated[0].workspaceChanges).toBeUndefined();
    expect(updated[1].workspaceChanges).toBeUndefined();
    expect(updated[2].workspaceChanges).toBe(changes);
  });

  it("removes only the successfully undone patch", () => {
    const otherChanges = { ...changes, undoToken: "undo-turn-2" };
    const messages: Message[] = [
      {
        id: "assistant-1",
        role: "assistant",
        content: "First",
        timestamp: new Date(),
        workspaceChanges: changes,
      },
      {
        id: "assistant-2",
        role: "assistant",
        content: "Second",
        timestamp: new Date(),
        workspaceChanges: otherChanges,
      },
    ];

    const updated = removeWorkspaceChangesByUndoToken(messages, "undo-turn-1");

    expect(updated[0].workspaceChanges).toBeUndefined();
    expect(updated[1].workspaceChanges).toBe(otherChanges);
  });
});
