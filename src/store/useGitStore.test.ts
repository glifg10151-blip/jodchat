import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useProjectStore } from "./useProjectStore";
import { useGitStore } from "./useGitStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);
const projectA = {
  id: "project-a",
  name: "Project A",
  path: "/projects/a",
  permissions: "write" as const,
  isAutoCommitEnabled: true,
};
const projectB = {
  id: "project-b",
  name: "Project B",
  path: "/projects/b",
  permissions: "full" as const,
};

beforeEach(() => {
  invokeMock.mockReset();
  useProjectStore.setState({
    projects: [projectA, projectB],
    activeProjectId: projectB.id,
  });
  useGitStore.setState((state) => ({
    config: {
      ...state.config,
      isAutoCommitEnabled: false,
      isAiCommitMsgEnabled: false,
      isPreCommitEnabled: true,
      overrideIdentity: false,
    },
    loading: false,
    error: null,
  }));
});

describe("scoped auto-commit", () => {
  it("commits only captured AI paths for the captured project", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "git_diff_changes") return "diff --git a/src/a.ts b/src/a.ts";
      if (command === "git_create_commit") return "created commit";
      throw new Error(`Unexpected command: ${command}`);
    });

    await useGitStore.getState().autoCommitIfNeeded({
      projectId: projectA.id,
      projectRoot: projectA.path,
      modelId: "model-a",
      files: ["src/z.ts", "src/a.ts", "src/a.ts"],
    });

    const files = ["src/a.ts", "src/z.ts"];
    expect(invokeMock).toHaveBeenCalledWith("git_diff_changes", {
      projectId: projectA.id,
      worktreePath: null,
      files,
    });
    expect(invokeMock).toHaveBeenCalledWith("git_create_commit", {
      projectId: projectA.id,
      message: "Auto-commit by Sythoria AI",
      files,
      authorName: null,
      authorEmail: null,
      bypassHooks: false,
      worktreePath: null,
    });
  });

  it("serializes auto-commits targeting the same repository", async () => {
    let releaseFirstDiff!: () => void;
    const firstDiff = new Promise<void>((resolve) => {
      releaseFirstDiff = resolve;
    });
    let diffCalls = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "git_diff_changes") {
        diffCalls += 1;
        if (diffCalls === 1) await firstDiff;
        return "diff --git a/file.ts b/file.ts";
      }
      if (command === "git_create_commit") return "created commit";
      throw new Error(`Unexpected command: ${command}`);
    });

    const first = useGitStore.getState().autoCommitIfNeeded({
      projectId: projectA.id,
      projectRoot: projectA.path,
      modelId: "model-a",
      files: ["first.ts"],
    });
    const second = useGitStore.getState().autoCommitIfNeeded({
      projectId: projectA.id,
      projectRoot: projectA.path,
      modelId: "model-a",
      files: ["second.ts"],
    });

    await vi.waitFor(() => expect(diffCalls).toBe(1));
    releaseFirstDiff();
    await Promise.all([first, second]);

    expect(diffCalls).toBe(2);
  });

  it("does not report an approved apply as failed when auto-commit preparation fails", async () => {
    invokeMock.mockRejectedValueOnce(new Error("diff unavailable"));

    await expect(
      useGitStore.getState().autoCommitIfNeeded({
        projectId: projectA.id,
        projectRoot: projectA.path,
        modelId: "model-a",
        files: ["src/a.ts"],
      }),
    ).resolves.toBeUndefined();
  });
});
