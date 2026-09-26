import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "../store/useChatStore";
import { useProjectStore } from "../store/useProjectStore";
import { useUIStore } from "../store/useUIStore";
import { AuxiliaryPanel, TerminalPane } from "./AuxiliaryPanel";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => vi.fn()),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    loadAddon = vi.fn();
    open = vi.fn();
    write = vi.fn();
    focus = vi.fn();
    dispose = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
  },
}));

const invokeMock = vi.mocked(invoke);
const originalResizeObserver = globalThis.ResizeObserver;

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("TerminalPane", () => {
  beforeEach(() => {
    invokeMock.mockResolvedValue(undefined as never);
    globalThis.ResizeObserver = ResizeObserverMock;
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    invokeMock.mockReset();
  });

  it("starts the default shell directly and stops it on unmount", async () => {
    const { unmount } = render(<TerminalPane projectId="project-1" projectPath="C:\\workspace" />);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("terminal_start", expect.any(Object)));
    expect(invokeMock).not.toHaveBeenCalledWith("project_bash", expect.any(Object));

    expect(() => unmount()).not.toThrow();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("terminal_stop", expect.any(Object)));
  });
});

describe("workspace panel", () => {
  beforeEach(() => {
    globalThis.ResizeObserver = ResizeObserverMock;
    invokeMock.mockImplementation(async (command) => {
      if (command === "project_browse_begin") return "browser-run-token" as never;
      if (command === "git_get_status") {
        return {
          isRepo: true,
          path: "C:\\workspace",
          branch: "main",
          isDirty: true,
          stagedFiles: [],
          unstagedFiles: ["src/App.tsx"],
          ahead: 0,
          behind: 0,
        } as never;
      }
      if (command === "git_diff_changes") {
        return `diff --git a/src/App.tsx b/src/App.tsx
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -1 +1 @@
-old
+new` as never;
      }
      return [] as never;
    });

    useUIStore.setState({
      isAuxPanelOpen: true,
      activeAuxTab: null,
      openAuxTabs: [],
      activeAuxConversationId: null,
      activeReviewFilePath: null,
      sideChatConversationId: null,
      backgroundTasks: [
        {
          id: "task-1",
          title: "npm run typecheck",
          convId: "conversation-1",
          status: "running",
          timestamp: new Date(),
        },
      ],
    });
    useProjectStore.setState({
      activeProjectId: "project-1",
      activeWorktreePath: null,
      activeWorktreeBranch: null,
      projects: [{ id: "project-1", name: "Sythoria", path: "C:\\workspace", permissions: "full" }],
    });
    useChatStore.setState({
      activeId: "conversation-1",
      conversations: [
        {
          id: "conversation-1",
          title: "Workspace task",
          timestamp: new Date(),
          model: "test-model",
          projectId: "project-1",
          messages: [
            {
              id: "message-1",
              role: "user",
              content: "Review this source",
              timestamp: new Date(),
              sources: [{ title: "Reference", url: "https://example.com" }],
            },
          ],
        },
      ],
    });
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    invokeMock.mockReset();
  });

  it("renders the Codex-style launcher and opens a full panel view", async () => {
    render(<AuxiliaryPanel />);

    expect(screen.getByRole("navigation", { name: "Workspace panel launcher" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Review/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Terminal/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Browser/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Files/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Side chat/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Review/ }));
    expect(await screen.findByText("1 file changed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close Review" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Diff for src/App.tsx" })).toBeInTheDocument();
    expect(screen.getByText("old", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("new", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText(/diff --git/)).not.toBeInTheDocument();
    expect(screen.queryByText(/@@ -1/)).not.toBeInTheDocument();
  });

  it("reviews every uncommitted file instead of filtering to the latest agent change set", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "git_get_status") {
        return {
          isRepo: true,
          path: "C:\\workspace",
          branch: "main",
          isDirty: true,
          stagedFiles: [],
          unstagedFiles: ["src/App.tsx", "src/older-change.ts"],
          ahead: 0,
          behind: 0,
        } as never;
      }
      if (command === "git_diff_changes") {
        return `diff --git a/src/App.tsx b/src/App.tsx
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -1 +1 @@
-old
+new
diff --git a/src/older-change.ts b/src/older-change.ts
--- a/src/older-change.ts
+++ b/src/older-change.ts
@@ -1 +1 @@
-before
+after` as never;
      }
      return [] as never;
    });
    useChatStore.setState((state) => ({
      conversations: state.conversations.map((conversation) => ({
        ...conversation,
        workspaceChanges: {
          projectId: "project-1",
          appliedAt: new Date(),
          files: [{ path: "src/App.tsx", additions: 1, deletions: 1 }],
        },
      })),
    }));

    render(<AuxiliaryPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Review/ }));

    expect(await screen.findByText("2 files changed")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "File src/older-change.ts" })).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("git_diff_changes", {
      projectId: "project-1",
      worktreePath: null,
      files: null,
      runToken: null,
    });
  });

  it("browses unchanged workspace files in a collapsible tree", async () => {
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "project_browse_begin") return "browser-run-token" as never;
      if (command === "project_list_dir")
        return (
          (args as { path?: string } | undefined)?.path === "." ? ["src/", "README.md"] : ["App.tsx", "helper.ts"]
        ) as never;
      if (command === "project_read") return "export const helper = true;" as never;
      if (command === "git_get_status") {
        return {
          isRepo: true,
          path: "C:\\workspace",
          branch: "main",
          isDirty: true,
          stagedFiles: [],
          unstagedFiles: ["src/App.tsx"],
          ahead: 0,
          behind: 0,
        } as never;
      }
      if (command === "git_diff_changes") {
        return "diff --git a/src/App.tsx b/src/App.tsx\n--- a/src/App.tsx\n+++ b/src/App.tsx\n@@ -1 +1 @@\n-old\n+new" as never;
      }
      return [] as never;
    });

    render(<AuxiliaryPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Review/ }));
    const folder = await screen.findByRole("button", { name: "Folder src" });
    expect(folder).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByRole("button", { name: "File src/helper.ts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "File README.md" })).toBeInTheDocument();
    fireEvent.click(folder);
    expect(folder).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(screen.queryByRole("button", { name: "File src/helper.ts" })).not.toBeInTheDocument());
    fireEvent.click(folder);
    fireEvent.click(await screen.findByRole("button", { name: "File src/helper.ts" }));
    expect(await screen.findByText("export const helper = true;")).toBeInTheDocument();
  });

  it("finds files in folders that have not been opened", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "project_browse_begin") return "browser-run-token" as never;
      if (command === "project_list_dir") return ["src/", "docs/"] as never;
      if (command === "project_glob") return ["docs/review-guide.md", "src/App.tsx"] as never;
      if (command === "project_read") return "Review guide text" as never;
      if (command === "git_get_status") {
        return {
          isRepo: true,
          path: "C:\\workspace",
          branch: "main",
          isDirty: true,
          stagedFiles: [],
          unstagedFiles: ["src/App.tsx"],
          ahead: 0,
          behind: 0,
        } as never;
      }
      if (command === "git_diff_changes") {
        return "diff --git a/src/App.tsx b/src/App.tsx\n--- a/src/App.tsx\n+++ b/src/App.tsx\n@@ -1 +1 @@\n-old\n+new" as never;
      }
      return [] as never;
    });

    render(<AuxiliaryPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Review/ }));
    fireEvent.change(await screen.findByRole("searchbox", { name: "Search workspace files" }), {
      target: { value: "review-guide" },
    });
    expect(await screen.findByRole("button", { name: "File docs/review-guide.md" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "File src/App.tsx" })).not.toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("project_glob", {
      projectId: "project-1",
      runToken: "browser-run-token",
      path: ".",
      pattern: "**/*",
      worktreePath: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "File docs/review-guide.md" }));
    expect(await screen.findByText("Review guide text")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear file search" }));
    expect(screen.getByRole("button", { name: "Folder docs" })).toBeInTheDocument();
  });

  it("hides and restores the file list without resetting the review", async () => {
    const { container } = render(<AuxiliaryPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Review/ }));
    expect(await screen.findByRole("region", { name: "Diff for src/App.tsx" })).toBeInTheDocument();
    const search = screen.getByRole("searchbox", { name: "Search workspace files" });
    fireEvent.change(search, { target: { value: "App" } });
    expect(await screen.findByText("1 match")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide file list" }));
    expect(container.querySelector('aside[aria-label="Workspace files"]')).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("region", { name: "Diff for src/App.tsx" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show file list" }));
    expect(container.querySelector('aside[aria-label="Workspace files"]')).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByRole("searchbox", { name: "Search workspace files" })).toHaveValue("App");
  });

  it("resizes the file list with pointer and keyboard input", async () => {
    render(<AuxiliaryPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Review/ }));
    const separator = await screen.findByRole("separator", { name: "Resize file list" });
    const content = separator.parentElement!;
    vi.spyOn(content, "getBoundingClientRect").mockReturnValue({
      x: 300,
      y: 0,
      width: 700,
      height: 600,
      top: 0,
      right: 1000,
      bottom: 600,
      left: 300,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(separator, { button: 0, clientX: 720 });
    fireEvent.pointerMove(window, { clientX: 650 });
    expect(separator).toHaveAttribute("aria-valuenow", "350");
    fireEvent.pointerUp(window);
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(separator).toHaveAttribute("aria-valuenow", "370");
    fireEvent.keyDown(separator, { key: "End" });
    expect(separator).toHaveAttribute("aria-valuenow", "480");
  });

  it("marks changed files and their parent folders with distinct statuses", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "project_browse_begin") return "browser-run-token" as never;
      if (command === "project_list_dir") return ["src/"] as never;
      if (command === "git_get_status") {
        return {
          isRepo: true,
          path: "C:\\workspace",
          branch: "main",
          isDirty: true,
          stagedFiles: [],
          unstagedFiles: ["src/added.ts", "src/modified.ts", "src/deleted.ts", "src/new.ts"],
          ahead: 0,
          behind: 0,
        } as never;
      }
      if (command === "git_diff_changes") {
        return `diff --git a/src/added.ts b/src/added.ts
new file mode 100644
--- /dev/null
+++ b/src/added.ts
@@ -0,0 +1 @@
+new
diff --git a/src/modified.ts b/src/modified.ts
--- a/src/modified.ts
+++ b/src/modified.ts
@@ -1 +1 @@
-old
+new
diff --git a/src/deleted.ts b/src/deleted.ts
deleted file mode 100644
--- a/src/deleted.ts
+++ /dev/null
@@ -1 +0,0 @@
-old
diff --git a/src/old.ts b/src/new.ts
rename from src/old.ts
rename to src/new.ts` as never;
      }
      return [] as never;
    });

    render(<AuxiliaryPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Review/ }));
    expect(await screen.findByRole("button", { name: "Folder src" })).toHaveAccessibleDescription(
      "Contains changed files",
    );
    expect(await screen.findByRole("button", { name: "File src/added.ts" })).toHaveAccessibleDescription("Added file");
    expect(screen.getByRole("button", { name: "File src/modified.ts" })).toHaveAccessibleDescription("Modified file");
    expect(screen.getByRole("button", { name: "File src/deleted.ts" })).toHaveAccessibleDescription("Deleted file");
    expect(screen.getByRole("button", { name: "File src/new.ts" })).toHaveAccessibleDescription("Renamed file");
  });

  it("opens Review with the file selected from the changed-files summary", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "git_get_status") {
        return {
          isRepo: true,
          path: "C:\\workspace",
          branch: "main",
          isDirty: true,
          stagedFiles: [],
          unstagedFiles: ["src/App.tsx", "src/selected.ts"],
          ahead: 0,
          behind: 0,
        } as never;
      }
      if (command === "git_diff_changes") {
        return `diff --git a/src/App.tsx b/src/App.tsx
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -1 +1 @@
-first old
+first new
diff --git a/src/selected.ts b/src/selected.ts
--- a/src/selected.ts
+++ b/src/selected.ts
@@ -1 +1 @@
-selected old
+selected new` as never;
      }
      return [] as never;
    });
    useUIStore.setState({
      activeAuxTab: "review",
      openAuxTabs: ["review"],
      activeAuxConversationId: "conversation-1",
      activeReviewFilePath: "src/selected.ts",
    });

    render(<AuxiliaryPanel />);

    expect(await screen.findByText("selected new")).toBeInTheDocument();
    expect(screen.queryByText("first new")).not.toBeInTheDocument();
  });

  it("does not render an untracked directory marker as a diff file", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "git_get_status") {
        return {
          isRepo: true,
          path: "C:\\workspace",
          branch: "main",
          isDirty: true,
          stagedFiles: [],
          unstagedFiles: [".claude/", ".claude/settings.json"],
          ahead: 0,
          behind: 0,
        } as never;
      }
      if (command === "git_diff_changes") {
        return `diff --git a/.claude/settings.json b/.claude/settings.json
new file mode 100644
--- /dev/null
+++ b/.claude/settings.json
@@ -0,0 +1 @@
+{"permissions": []}` as never;
      }
      return [] as never;
    });

    render(<AuxiliaryPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Review/ }));

    expect(await screen.findByText("1 file changed")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "File .claude/settings.json" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ".claude/" })).not.toBeInTheDocument();
  });

  it("opens a temporary side chat and supports the launcher shortcuts", async () => {
    render(<AuxiliaryPanel />);

    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    expect(useUIStore.getState().activeAuxTab).toBe("files");

    fireEvent.click(await screen.findByRole("button", { name: "Close Files" }));
    fireEvent.click(await screen.findByRole("button", { name: /Side chat/ }));
    await vi.waitFor(() => expect(useUIStore.getState().sideChatConversationId).toBeTruthy());
    expect(useUIStore.getState().activeAuxTab).toBe("chat");
    expect(useUIStore.getState().isAuxPanelOpen).toBe(true);
    expect(
      useChatStore
        .getState()
        .conversations.find((conversation) => conversation.id === useUIStore.getState().sideChatConversationId)
        ?.isTemporary,
    ).toBe(true);
  });

  it("adds a workspace tab without replacing the existing tab", async () => {
    render(<AuxiliaryPanel />);

    fireEvent.click(screen.getByRole("button", { name: /Review/ }));
    expect(await screen.findByRole("tab", { name: "Review" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("button", { name: "Add workspace tab" }));
    fireEvent.click(screen.getByRole("button", { name: /Files/ }));

    expect(screen.getByRole("tab", { name: "Review" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
    expect(useUIStore.getState().openAuxTabs).toEqual(["review", "files"]);
  });

  it("keeps the shell session alive while another workspace tab is active", async () => {
    const { unmount } = render(<AuxiliaryPanel />);

    fireEvent.click(screen.getByRole("button", { name: /Terminal/ }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("terminal_start", expect.any(Object)));

    fireEvent.click(screen.getByRole("button", { name: "Add workspace tab" }));
    fireEvent.click(screen.getByRole("button", { name: /Files/ }));

    expect(screen.getByRole("tabpanel", { name: "Terminal", hidden: true })).toHaveClass("invisible");
    expect(invokeMock).not.toHaveBeenCalledWith("terminal_stop", expect.any(Object));

    unmount();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("terminal_stop", expect.any(Object)));
  });
});
