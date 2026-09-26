import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  saveProjects: vi.fn().mockResolvedValue(undefined),
  deleteProjectChats: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../utils/generateId", () => ({ generateId: () => "project-1" }));
vi.mock("../utils/storage", () => ({
  loadProjects: vi.fn().mockResolvedValue([]),
  saveProjects: mocks.saveProjects,
  loadProjectsEnabled: vi.fn().mockResolvedValue(true),
  saveProjectsEnabled: vi.fn(),
  loadProjectsDefaultPermission: vi.fn().mockResolvedValue("read"),
  saveProjectsDefaultPermission: vi.fn(),
  loadLegacyProjects: vi.fn().mockResolvedValue([]),
  clearLegacyProjects: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./useChatStore", () => ({
  useChatStore: { getState: () => ({ deleteProjectChats: mocks.deleteProjectChats }) },
}));

import { useProjectStore } from "./useProjectStore";

describe("useProjectStore", () => {
  beforeEach(() => {
    mocks.invoke.mockReset().mockResolvedValue(undefined);
    mocks.saveProjects.mockReset().mockResolvedValue(undefined);
    mocks.deleteProjectChats.mockClear();
    useProjectStore.setState({
      projects: [],
      activeProjectId: null,
      isProjectsEnabled: false,
      defaultPermission: "read",
      activeWorktreePath: null,
      activeWorktreeBranch: null,
    });
  });

  it("persists project mutations and keeps worktree selection UI-only", async () => {
    const id = await useProjectStore.getState().addProject("One", "C:/one", "read");
    expect(mocks.saveProjects).toHaveBeenCalledTimes(1);
    await useProjectStore.getState().updateProject(id, { name: "Latest" });
    expect(mocks.saveProjects).toHaveBeenCalledTimes(2);
    await useProjectStore.getState().setWorktree("C:/worktrees/one", "sythoria-agent-a1b2c3d4");

    expect(useProjectStore.getState().projects[0].name).toBe("Latest");
    expect(useProjectStore.getState().activeWorktreePath).toBe("C:/worktrees/one");
    expect(mocks.invoke).not.toHaveBeenCalledWith("set_project_path_override", expect.anything());
  });

  it("uses the configured default permission when none is supplied", async () => {
    useProjectStore.setState({ defaultPermission: "write" });

    await useProjectStore.getState().addProject("One", "C:/one");

    expect(mocks.saveProjects).toHaveBeenCalledTimes(1);
    expect(useProjectStore.getState().projects[0].permissions).toBe("write");
  });

  it("does not resolve a project mutation before the native registry is updated", async () => {
    let resolveSave: (() => void) | undefined;
    mocks.saveProjects.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );

    const mutation = useProjectStore.getState().addProject("One", "C:/one", "write");
    let settled = false;
    void mutation.then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(useProjectStore.getState().projects).toHaveLength(1);

    resolveSave?.();
    await expect(mutation).resolves.toBe("project-1");
  });

  it("clears native selection and associated chats when deleting the active project", async () => {
    const id = await useProjectStore.getState().addProject("One", "C:/one", "read");
    useProjectStore.getState().setActiveProject(id);
    useProjectStore.getState().deleteProject(id);

    await vi.waitFor(() => expect(mocks.deleteProjectChats).toHaveBeenCalledWith(id));
    expect(mocks.invoke).toHaveBeenCalledWith("set_active_project", { projectId: null });
    expect(useProjectStore.getState().activeProjectId).toBeNull();
  });
});
