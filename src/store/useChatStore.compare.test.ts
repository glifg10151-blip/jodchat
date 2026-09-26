import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { Conversation } from "../types";
import { useChatStore } from "./useChatStore";
import { useGitStore } from "./useGitStore";
import { useMcpStore } from "./useMcpStore";
import { useModelStore } from "./useModelStore";
import { useProjectStore } from "./useProjectStore";
import { useUIStore } from "./useUIStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const primaryConversation: Conversation = {
  id: "primary-chat",
  title: "Existing chat",
  timestamp: new Date("2026-07-18T20:00:00Z"),
  messages: [
    {
      id: "message-1",
      role: "user",
      content: "Existing prompt",
      timestamp: new Date("2026-07-18T20:00:00Z"),
    },
  ],
  model: "model-1",
};

const comparisonConversation: Conversation = {
  ...primaryConversation,
  id: "compare-existing",
  title: "Existing chat (Compare)",
  model: "model-2",
};

describe("compare mode chat transitions", () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: [primaryConversation, comparisonConversation],
      activeId: primaryConversation.id,
      compareIds: [comparisonConversation.id],
      isCompareMode: true,
      navigationHistory: [primaryConversation.id],
      navigationIndex: 0,
    });
  });

  it("starts a new chat outside compare mode and removes stale comparison state", async () => {
    const newId = useChatStore.getState().newChat();
    await vi.waitFor(() => {
      expect(
        useChatStore.getState().conversations.some((conversation) => conversation.id === comparisonConversation.id),
      ).toBe(false);
    });
    const state = useChatStore.getState();

    expect(state.activeId).toBe(newId);
    expect(state.isCompareMode).toBe(false);
    expect(state.compareIds).toEqual([]);
  });

  it("starts a temporary chat outside compare mode and removes stale comparison state", async () => {
    const newId = useChatStore.getState().newTemporaryChat();
    await vi.waitFor(() => {
      expect(
        useChatStore.getState().conversations.some((conversation) => conversation.id === comparisonConversation.id),
      ).toBe(false);
    });
    const state = useChatStore.getState();

    expect(state.activeId).toBe(newId);
    expect(state.conversations.find((conversation) => conversation.id === newId)?.isTemporary).toBe(true);
    expect(state.isCompareMode).toBe(false);
    expect(state.compareIds).toEqual([]);
  });

  it("replaces an active temporary chat with a regular new chat", async () => {
    const temporaryId = useChatStore.getState().newTemporaryChat();
    await vi.waitFor(() => expect(useChatStore.getState().activeId).toBe(temporaryId));

    const regularId = useChatStore.getState().newChat();
    await vi.waitFor(() => expect(useChatStore.getState().activeId).toBe(regularId));

    const state = useChatStore.getState();
    expect(state.conversations.some((conversation) => conversation.id === temporaryId)).toBe(false);
    expect(state.conversations.find((conversation) => conversation.id === regularId)?.isTemporary).not.toBe(true);
  });

  it("creates a temporary side chat without replacing the active conversation", () => {
    const sideChatId = useChatStore.getState().newSideChat();
    const state = useChatStore.getState();

    expect(sideChatId).toBeTruthy();
    expect(state.activeId).toBe(primaryConversation.id);
    expect(state.conversations.find((conversation) => conversation.id === sideChatId)?.isTemporary).toBe(true);
    expect(state.conversations.find((conversation) => conversation.id === sideChatId)?.title).toBe("Side chat");
    useChatStore.setState({ isCompareMode: false, compareIds: [] });
  });
});

describe("subagent cancellation", () => {
  it("stops the selected subagent and all of its descendants", async () => {
    const cancelConversationStream = vi.fn();
    const resolveSelectedConfirmation = vi.fn();
    const resolveUnrelatedConfirmation = vi.fn();
    const originalCancelConversationStream = useModelStore.getState().cancelConversationStream;
    useModelStore.setState({ cancelConversationStream });

    const subagent = {
      ...primaryConversation,
      id: "subagent-1",
      parentId: primaryConversation.id,
      isSubagent: true,
      status: "running" as const,
      messages: [
        {
          ...primaryConversation.messages[0],
          id: "subagent-message",
          role: "assistant" as const,
          content: "",
          isStreaming: true,
        },
      ],
    };
    const childSubagent = {
      ...subagent,
      id: "subagent-2",
      parentId: subagent.id,
      messages: [{ ...subagent.messages[0], id: "child-message" }],
    };
    const unrelatedSubagent = {
      ...subagent,
      id: "subagent-unrelated",
      parentId: primaryConversation.id,
      messages: [{ ...subagent.messages[0], id: "unrelated-message" }],
    };

    useChatStore.setState({
      conversations: [primaryConversation, subagent, childSubagent, unrelatedSubagent],
      activeId: primaryConversation.id,
      isStreaming: true,
      generationState: "loading",
      generationLabel: "Running agents",
      generationByConversation: {
        [subagent.id]: { state: "responding", label: "Responding" },
        [childSubagent.id]: { state: "searching", label: "Searching" },
        [unrelatedSubagent.id]: { state: "responding", label: "Responding" },
      },
    });
    useUIStore.setState({
      pendingToolConfirmations: [
        {
          id: "selected-confirmation",
          conversationId: childSubagent.id,
          toolName: "project_write",
          arguments: {},
          resolve: resolveSelectedConfirmation,
        },
        {
          id: "unrelated-confirmation",
          conversationId: unrelatedSubagent.id,
          toolName: "project_write",
          arguments: {},
          resolve: resolveUnrelatedConfirmation,
        },
      ],
    });

    try {
      await useChatStore.getState().stopStreaming(subagent.id);

      const state = useChatStore.getState();
      expect(cancelConversationStream).toHaveBeenCalledTimes(2);
      expect(cancelConversationStream).toHaveBeenCalledWith(subagent.id);
      expect(cancelConversationStream).toHaveBeenCalledWith(childSubagent.id);
      expect(state.conversations.find((conversation) => conversation.id === subagent.id)?.status).toBe("stopped");
      expect(state.conversations.find((conversation) => conversation.id === childSubagent.id)?.status).toBe("stopped");
      expect(state.conversations.find((conversation) => conversation.id === unrelatedSubagent.id)?.status).toBe(
        "running",
      );
      expect(state.conversations.find((conversation) => conversation.id === subagent.id)?.messages[0]).toMatchObject({
        content: "Cancelled agent execution.",
        isStreaming: false,
      });
      expect(
        state.conversations.find((conversation) => conversation.id === childSubagent.id)?.messages[0],
      ).toMatchObject({
        content: "Cancelled agent execution.",
        isStreaming: false,
      });
      expect(state.generationByConversation[subagent.id]).toEqual({ state: "cancelled", label: "Cancelled" });
      expect(state.generationByConversation[childSubagent.id]).toEqual({ state: "cancelled", label: "Cancelled" });
      expect(state.generationByConversation[unrelatedSubagent.id]).toBeDefined();
      expect(resolveSelectedConfirmation).toHaveBeenCalledWith(false);
      expect(resolveUnrelatedConfirmation).not.toHaveBeenCalled();
      expect(useUIStore.getState().pendingToolConfirmations).toHaveLength(1);
      expect(useUIStore.getState().pendingToolConfirmations[0].id).toBe("unrelated-confirmation");
    } finally {
      useModelStore.setState({ cancelConversationStream: originalCancelConversationStream });
      useUIStore.setState({ pendingToolConfirmations: [] });
    }
  });
});

describe("transactional chat deletion", () => {
  it("does not start a stream that was cancelled while its listener was being prepared", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalEnsureStreamListeners = useModelStore.getState().ensureStreamListeners;
    const originalCancelConversationStream = useModelStore.getState().cancelConversationStream;
    const originalCancelConversationToolCalls = useMcpStore.getState().cancelConversationToolCalls;
    let finishListenerSetup!: (cleanup: () => void) => void;
    const listenerSetup = new Promise<() => void>((resolve) => {
      finishListenerSetup = resolve;
    });
    const conversation = { ...primaryConversation, id: "cancel-during-stream-setup", messages: [] };

    useModelStore.setState({
      models: [
        {
          id: "model-1",
          name: "Model",
          apiBase: "https://example.com/v1/chat/completions",
          apiKey: "test-key",
          modelId: "test-model",
        },
      ],
      selectedModel: "model-1",
      ensureStreamListeners: vi.fn().mockReturnValue(listenerSetup),
      cancelConversationStream: vi.fn().mockResolvedValue(true),
    });
    useMcpStore.setState({ cancelConversationToolCalls: vi.fn().mockResolvedValue(true) });
    useProjectStore.setState({ isProjectsEnabled: false, activeProjectId: null, projects: [] });
    useUIStore.setState({ hasStarted: false, pendingToolConfirmations: [] });
    useChatStore.setState({
      conversations: [conversation],
      activeId: conversation.id,
      isStreaming: false,
      generationState: "idle",
      generationLabel: "",
      generationByConversation: {},
    });
    invokeMock.mockResolvedValue(undefined);

    try {
      expect(await useChatStore.getState().sendMessage("Cancel this response")).toBe("accepted");
      await vi.waitFor(() => expect(useModelStore.getState().ensureStreamListeners).toHaveBeenCalledTimes(1));

      const deletion = useChatStore.getState().deleteChat(conversation.id);
      finishListenerSetup(vi.fn());

      await expect(deletion).resolves.toBe(true);
      expect(invokeMock).not.toHaveBeenCalledWith("chat_stream", expect.anything());
      expect(useChatStore.getState().conversations).toEqual([]);
    } finally {
      useModelStore.setState({
        ensureStreamListeners: originalEnsureStreamListeners,
        cancelConversationStream: originalCancelConversationStream,
        models: [],
        selectedModel: "",
      });
      useMcpStore.setState({ cancelConversationToolCalls: originalCancelConversationToolCalls });
      invokeMock.mockReset();
    }
  });

  it("cancels descendants, discards every worktree, then removes and persists the conversation tree", async () => {
    const invokeMock = vi.mocked(invoke);
    const events: string[] = [];
    const cancelConversationStream = vi.fn(async (conversationId: string) => {
      events.push(`stream:${conversationId}`);
      return true;
    });
    const cancelConversationToolCalls = vi.fn(async (conversationIds: string[]) => {
      events.push(`mcp:${[...conversationIds].sort().join(",")}`);
      return true;
    });
    const originalCancelConversationStream = useModelStore.getState().cancelConversationStream;
    const originalCancelConversationToolCalls = useMcpStore.getState().cancelConversationToolCalls;
    useModelStore.setState({ cancelConversationStream });
    useMcpStore.setState({ cancelConversationToolCalls });
    useUIStore.setState({ hasStarted: true });

    const destination = { ...primaryConversation, id: "destination" };
    const root = {
      ...primaryConversation,
      id: "delete-root",
      projectId: "project-a",
      pendingWorktree: { path: "/worktrees/root", branch: "agent-root" },
    };
    const child = {
      ...primaryConversation,
      id: "delete-child",
      parentId: root.id,
      isSubagent: true,
      status: "running" as const,
      projectId: "project-a",
      pendingWorktree: { path: "/worktrees/child", branch: "agent-child" },
    };
    const grandchild = {
      ...child,
      id: "delete-grandchild",
      parentId: child.id,
      pendingWorktree: undefined,
    };
    const resolveConfirmation = vi.fn();
    useChatStore.setState({
      conversations: [root, child, grandchild, destination],
      activeId: root.id,
      navigationHistory: [destination.id, root.id],
      navigationIndex: 1,
      generationByConversation: {
        [root.id]: { state: "responding", label: "Responding" },
        [child.id]: { state: "mcp_executing", label: "Using tool" },
      },
      isStreaming: true,
    });
    useUIStore.setState({
      pendingToolConfirmations: [
        {
          id: "delete-confirmation",
          conversationId: child.id,
          toolName: "project_write",
          arguments: {},
          resolve: resolveConfirmation,
        },
      ],
    });
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "git_worktree_discard") {
        events.push(`discard:${String((args as { worktreePath: string }).worktreePath)}`);
        return undefined;
      }
      if (command === "save_encrypted_conversations") {
        events.push("persist");
        expect(useChatStore.getState().conversations.map((conversation) => conversation.id)).toEqual([destination.id]);
        return undefined;
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    try {
      const deleted = await useChatStore.getState().deleteChat(root.id);

      expect(deleted).toBe(true);
      expect(resolveConfirmation).toHaveBeenCalledWith(false);
      expect(cancelConversationStream).toHaveBeenCalledTimes(3);
      expect(cancelConversationToolCalls).toHaveBeenCalledWith([root.id, child.id, grandchild.id]);
      expect(events).toContain("discard:/worktrees/root");
      expect(events).toContain("discard:/worktrees/child");
      expect(events.at(-1)).toBe("persist");
      expect(useChatStore.getState().activeId).toBe(destination.id);
      expect(useChatStore.getState().navigationHistory).toEqual([destination.id]);
    } finally {
      useModelStore.setState({ cancelConversationStream: originalCancelConversationStream });
      useMcpStore.setState({ cancelConversationToolCalls: originalCancelConversationToolCalls });
      useUIStore.setState({ hasStarted: false, pendingToolConfirmations: [] });
      invokeMock.mockReset();
    }
  });

  it("keeps recovery records when any worktree discard fails", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalCancelConversationStream = useModelStore.getState().cancelConversationStream;
    const originalCancelConversationToolCalls = useMcpStore.getState().cancelConversationToolCalls;
    useModelStore.setState({ cancelConversationStream: vi.fn().mockResolvedValue(undefined) });
    useMcpStore.setState({ cancelConversationToolCalls: vi.fn().mockResolvedValue(undefined) });
    useUIStore.setState({ hasStarted: false });

    const root = {
      ...primaryConversation,
      id: "failed-delete-root",
      projectId: "project-a",
      pendingWorktree: { path: "/worktrees/success", branch: "agent-success" },
    };
    const child = {
      ...root,
      id: "failed-delete-child",
      parentId: root.id,
      pendingWorktree: { path: "/worktrees/failure", branch: "agent-failure" },
    };
    useChatStore.setState({ conversations: [root, child], activeId: root.id });
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "git_worktree_discard") {
        if ((args as { worktreePath: string }).worktreePath === "/worktrees/failure") {
          throw new Error("worktree busy");
        }
        return undefined;
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    try {
      const deleted = await useChatStore.getState().deleteChat(root.id);

      expect(deleted).toBe(false);
      expect(useChatStore.getState().conversations.map((conversation) => conversation.id)).toEqual([root.id, child.id]);
      expect(
        useChatStore.getState().conversations.find((conversation) => conversation.id === root.id)?.pendingWorktree,
      ).toBeUndefined();
      expect(
        useChatStore.getState().conversations.find((conversation) => conversation.id === child.id)?.pendingWorktree,
      ).toEqual(child.pendingWorktree);
    } finally {
      useModelStore.setState({ cancelConversationStream: originalCancelConversationStream });
      useMcpStore.setState({ cancelConversationToolCalls: originalCancelConversationToolCalls });
      invokeMock.mockReset();
    }
  });

  it("does not discard worktrees when an active tool call cannot be stopped safely", async () => {
    const invokeMock = vi.mocked(invoke);
    const originalCancelConversationStream = useModelStore.getState().cancelConversationStream;
    const originalCancelConversationToolCalls = useMcpStore.getState().cancelConversationToolCalls;
    useModelStore.setState({ cancelConversationStream: vi.fn().mockResolvedValue(true) });
    useMcpStore.setState({ cancelConversationToolCalls: vi.fn().mockResolvedValue(false) });
    useUIStore.setState({ hasStarted: false });

    const conversation = {
      ...primaryConversation,
      id: "unsafe-delete",
      projectId: "project-a",
      pendingWorktree: { path: "/worktrees/still-active", branch: "agent-active" },
    };
    useChatStore.setState({ conversations: [conversation], activeId: conversation.id });

    try {
      const deleted = await useChatStore.getState().deleteChat(conversation.id);

      expect(deleted).toBe(false);
      expect(useChatStore.getState().conversations[0].pendingWorktree).toEqual(conversation.pendingWorktree);
      expect(invokeMock).not.toHaveBeenCalledWith("git_worktree_discard", expect.anything());
    } finally {
      useModelStore.setState({ cancelConversationStream: originalCancelConversationStream });
      useMcpStore.setState({ cancelConversationToolCalls: originalCancelConversationToolCalls });
      invokeMock.mockReset();
    }
  });

  it("fully deletes a non-empty temporary chat and its descendants when switching away", async () => {
    const originalCancelConversationStream = useModelStore.getState().cancelConversationStream;
    const originalCancelConversationToolCalls = useMcpStore.getState().cancelConversationToolCalls;
    useModelStore.setState({ cancelConversationStream: vi.fn().mockResolvedValue(undefined) });
    useMcpStore.setState({ cancelConversationToolCalls: vi.fn().mockResolvedValue(undefined) });
    useUIStore.setState({ hasStarted: false });

    const temporary = { ...primaryConversation, id: "temp-full-delete", isTemporary: true };
    const child = {
      ...primaryConversation,
      id: "temp-child",
      parentId: temporary.id,
      isSubagent: true,
      status: "completed" as const,
    };
    const destination = { ...primaryConversation, id: "kept-chat" };
    useChatStore.setState({
      conversations: [temporary, child, destination],
      activeId: temporary.id,
      navigationHistory: [temporary.id],
      navigationIndex: 0,
      isCompareMode: false,
      compareIds: [],
    });

    try {
      const switched = await useChatStore.getState().setActiveId(destination.id);

      expect(switched).toBe(true);
      expect(useChatStore.getState().activeId).toBe(destination.id);
      expect(useChatStore.getState().conversations.map((conversation) => conversation.id)).toEqual([destination.id]);
      expect(useChatStore.getState().navigationHistory).toEqual([destination.id]);
    } finally {
      useModelStore.setState({ cancelConversationStream: originalCancelConversationStream });
      useMcpStore.setState({ cancelConversationToolCalls: originalCancelConversationToolCalls });
    }
  });
});

describe("worktree publishing", () => {
  it("publishes one shared worktree against its captured project after project selection changes", async () => {
    const invokeMock = vi.mocked(invoke);
    const autoCommitIfNeeded = vi.fn().mockResolvedValue(undefined);
    const originalAutoCommit = useGitStore.getState().autoCommitIfNeeded;
    invokeMock.mockImplementation(async (command) => {
      if (command === "git_worktree_apply") {
        return {
          changedPaths: ["src/ai.ts", "src/new.ts"],
          undoToken: "4aee927d-7e79-4fa3-a4df-a352c1941c71",
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    useGitStore.setState({ autoCommitIfNeeded });
    useProjectStore.setState({
      projects: [
        {
          id: "project-a",
          name: "Project A",
          path: "/projects/a",
          permissions: "write",
        },
      ],
      activeProjectId: "project-a",
      activeWorktreePath: "/worktrees/run-a",
      activeWorktreeBranch: "sythoria-agent-a",
    });
    useUIStore.setState({ hasStarted: false });
    useChatStore.setState({
      conversations: [
        {
          ...primaryConversation,
          projectId: "project-b",
          pendingWorktree: {
            path: "/worktrees/run-a",
            branch: "sythoria-agent-a",
            commitScope: {
              projectId: "project-a",
              projectRoot: "/projects/a",
              modelId: "model-a",
            },
          },
        },
        {
          ...comparisonConversation,
          id: "shared-subagent",
          parentId: primaryConversation.id,
          isSubagent: true,
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
        },
      ],
      activeId: primaryConversation.id,
    });

    try {
      await useChatStore.getState().publishPendingWorktree(primaryConversation.id);

      expect(autoCommitIfNeeded).toHaveBeenCalledWith({
        projectId: "project-a",
        projectRoot: "/projects/a",
        modelId: "model-a",
        files: ["src/ai.ts", "src/new.ts"],
      });
      expect(useChatStore.getState().conversations.every((conversation) => !conversation.pendingWorktree)).toBe(true);
      expect(useChatStore.getState().conversations[0].workspaceChanges).toMatchObject({
        projectId: "project-a",
        undoToken: "4aee927d-7e79-4fa3-a4df-a352c1941c71",
        files: [
          { path: "src/ai.ts", additions: 0, deletions: 0 },
          { path: "src/new.ts", additions: 0, deletions: 0 },
        ],
      });
    } finally {
      useGitStore.setState({ autoCommitIfNeeded: originalAutoCommit });
      invokeMock.mockReset();
    }
  });

  it("allows project detachment while background worktree publication is pending", () => {
    useChatStore.setState({
      conversations: [
        {
          ...primaryConversation,
          projectId: "project-a",
          pendingWorktree: { path: "/worktrees/run-a", branch: "sythoria-agent-a" },
        },
      ],
      activeId: primaryConversation.id,
    });

    useChatStore.getState().setConversationProject(primaryConversation.id, undefined);

    expect(useChatStore.getState().conversations[0].projectId).toBeUndefined();
    expect(useChatStore.getState().conversations[0].pendingWorktree).toEqual({
      path: "/worktrees/run-a",
      branch: "sythoria-agent-a",
    });
  });

  it("leaves compare mode and switches chats while a comparison worktree is publishing", async () => {
    const pendingComparison = {
      ...comparisonConversation,
      pendingWorktree: { path: "/worktrees/compare", branch: "sythoria-agent-compare" },
    };
    const destination = { ...primaryConversation, id: "destination-chat" };
    useChatStore.setState({
      conversations: [primaryConversation, pendingComparison, destination],
      activeId: primaryConversation.id,
      compareIds: [pendingComparison.id],
      isCompareMode: true,
    });

    const compareModeChanged = useChatStore.getState().setIsCompareMode(false);
    const switched = await useChatStore.getState().setActiveId(destination.id);

    const state = useChatStore.getState();
    expect(compareModeChanged).toBe(true);
    expect(switched).toBe(true);
    expect(state.activeId).toBe(destination.id);
    expect(state.isCompareMode).toBe(false);
    expect(state.compareIds).toEqual([]);
    expect(state.conversations.some((conversation) => conversation.id === pendingComparison.id)).toBe(true);
  });

  it("switches away from a generating project chat while its worktree is active", async () => {
    const generating = {
      ...primaryConversation,
      id: "generating-project-chat",
      projectId: "project-a",
      pendingWorktree: {
        path: "/worktrees/active-run",
        branch: "sythoria-agent-active",
        commitScope: {
          projectId: "project-a",
          projectRoot: "/projects/a",
          modelId: "model-a",
        },
      },
    };
    const destination = { ...primaryConversation, id: "background-destination" };
    useChatStore.setState({
      conversations: [generating, destination],
      activeId: generating.id,
      generationByConversation: {
        [generating.id]: { state: "mcp_executing", label: "Editing files" },
      },
      navigationHistory: [generating.id],
      navigationIndex: 0,
      compareIds: [],
      isCompareMode: false,
    });

    const switched = await useChatStore.getState().setActiveId(destination.id);

    expect(switched).toBe(true);
    expect(useChatStore.getState().activeId).toBe(destination.id);
    expect(useChatStore.getState().generationByConversation[generating.id]).toEqual({
      state: "mcp_executing",
      label: "Editing files",
    });
    expect(useChatStore.getState().conversations[0].pendingWorktree).toEqual(generating.pendingWorktree);
  });

  it("can discard a legacy detached worktree using its captured project scope", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockImplementation(async (command) => {
      if (command === "git_worktree_discard") return undefined;
      throw new Error(`Unexpected command: ${command}`);
    });
    useChatStore.setState({
      conversations: [
        {
          ...primaryConversation,
          projectId: undefined,
          pendingWorktree: {
            path: "/worktrees/legacy",
            branch: "sythoria-agent-legacy",
            commitScope: {
              projectId: "project-a",
              projectRoot: "/projects/a",
              modelId: "model-a",
            },
          },
        },
      ],
      activeId: primaryConversation.id,
    });

    await useChatStore.getState().discardPendingWorktree(primaryConversation.id);

    expect(invokeMock).toHaveBeenCalledWith("git_worktree_discard", {
      projectId: "project-a",
      worktreePath: "/worktrees/legacy",
      branchName: "sythoria-agent-legacy",
    });
    expect(useChatStore.getState().conversations[0].pendingWorktree).toBeUndefined();
  });

  it("does not prune an empty conversation that owns the only worktree recovery record", () => {
    const pendingEmptyConversation = {
      ...primaryConversation,
      id: "pending-empty-chat",
      messages: [],
      pendingWorktree: { path: "/worktrees/empty", branch: "sythoria-agent-empty" },
    };
    useChatStore.setState({
      conversations: [pendingEmptyConversation, { ...primaryConversation, id: "active-chat" }],
      activeId: "active-chat",
      isCompareMode: false,
      compareIds: [],
    });

    useChatStore.getState().cleanupEmptyConversations();

    expect(
      useChatStore.getState().conversations.some((conversation) => conversation.id === pendingEmptyConversation.id),
    ).toBe(true);
  });
});
