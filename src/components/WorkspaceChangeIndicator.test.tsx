import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useChatStore } from "../store/useChatStore";
import { useProjectStore } from "../store/useProjectStore";
import { useUIStore } from "../store/useUIStore";
import { WorkspaceChangeIndicator } from "./WorkspaceChangeIndicator";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

describe("WorkspaceChangeIndicator", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useUIStore.setState({
      isAuxPanelOpen: false,
      activeAuxTab: null,
      activeAuxConversationId: null,
      activeReviewFilePath: null,
    });
    useProjectStore.setState({ isProjectsEnabled: true });
    useChatStore.setState({ conversations: [], generationByConversation: {} });
  });

  it("shows live line counts for a newly created file and opens Review", async () => {
    const user = userEvent.setup();
    invokeMock.mockImplementation(async (command) => {
      if (command === "git_get_status") return { unstagedFiles: [".claude/", "src/new.ts"], stagedFiles: [] } as never;
      if (command === "git_diff_changes") {
        return `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,3 @@
+export const one = 1;
+export const two = 2;
+export const three = 3;` as never;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    useChatStore.setState({
      conversations: [
        {
          id: "live-chat",
          title: "Live chat",
          timestamp: new Date(),
          messages: [],
          model: "model-a",
          projectId: "project-a",
          pendingWorktree: {
            path: "/worktrees/live",
            branch: "sythoria-agent-live",
            commitScope: { projectId: "project-a", projectRoot: "/projects/a", modelId: "model-a" },
          },
        },
      ],
      generationByConversation: { "live-chat": { state: "responding", label: "Responding" } },
    });

    render(<WorkspaceChangeIndicator conversationId="live-chat" />);

    const indicator = await screen.findByRole("button", { name: /1 file changed, 3 additions and 0 deletions/i });
    expect(indicator).toHaveTextContent("+3");
    expect(indicator).toHaveTextContent("−0");

    await user.click(indicator);
    expect(useUIStore.getState().activeAuxTab).toBe("review");
    expect(useUIStore.getState().activeAuxConversationId).toBe("live-chat");
    expect(useUIStore.getState().isAuxPanelOpen).toBe(true);
  });

  it("stays hidden when an active project run has not changed any files", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "git_get_status") return { unstagedFiles: [], stagedFiles: [] } as never;
      if (command === "git_diff_changes") return "" as never;
      throw new Error(`Unexpected command: ${command}`);
    });
    useChatStore.setState({
      conversations: [
        {
          id: "unchanged-chat",
          title: "Unchanged chat",
          timestamp: new Date(),
          messages: [],
          model: "model-a",
          projectId: "project-a",
          pendingWorktree: {
            path: "/worktrees/unchanged",
            branch: "sythoria-agent-unchanged",
            commitScope: { projectId: "project-a", projectRoot: "/projects/a", modelId: "model-a" },
          },
        },
      ],
      generationByConversation: { "unchanged-chat": { state: "responding", label: "Responding" } },
    });

    const { unmount } = render(<WorkspaceChangeIndicator conversationId="unchanged-chat" />);

    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith("git_diff_changes", expect.anything()));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    unmount();
  });

  it("hides the compact indicator after published changes finish", () => {
    useChatStore.setState({
      conversations: [
        {
          id: "published-chat",
          title: "Published chat",
          timestamp: new Date(),
          messages: [],
          model: "model-a",
          projectId: "project-a",
          workspaceChanges: {
            projectId: "project-a",
            appliedAt: new Date(),
            files: [{ path: "src/App.tsx", additions: 4, deletions: 1 }],
          },
        },
      ],
    });

    render(<WorkspaceChangeIndicator conversationId="published-chat" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("does not keep the compact indicator visible for a completed recovery worktree", () => {
    useChatStore.setState({
      conversations: [
        {
          id: "recovery-chat",
          title: "Recovery chat",
          timestamp: new Date(),
          messages: [],
          model: "model-a",
          projectId: "project-a",
          pendingWorktree: { path: "/worktrees/recovery", branch: "sythoria-agent-recovery" },
        },
      ],
      generationByConversation: {},
    });

    render(<WorkspaceChangeIndicator conversationId="recovery-chat" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
