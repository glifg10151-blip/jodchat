import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../types";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

const project = (name: string): Project => ({
  id: name.toLowerCase(),
  name,
  path: `C:/projects/${name}`,
  permissions: "read",
  skipCommandConfirmations: true,
  excludePatterns: ["node_modules/**"],
});

describe("project persistence", () => {
  beforeEach(() => {
    vi.resetModules();
    invokeMock.mockReset();
  });

  it("serializes writes and persists the latest rapid update", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    invokeMock.mockImplementationOnce(() => firstWrite).mockResolvedValue(undefined);
    const { saveProjects } = await import("./storage");

    const first = saveProjects([project("First")]);
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    const second = saveProjects([project("Second")]);
    const latest = saveProjects([project("Latest")]);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    releaseFirst?.();
    await Promise.all([first, second, latest]);

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "save_projects", {
      projects: [expect.objectContaining({ name: "First" })],
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "save_projects", {
      projects: [expect.objectContaining({ name: "Latest", skipCommandConfirmations: true })],
    });
  });

  it("snapshots nested exclude patterns before the async write", async () => {
    invokeMock.mockResolvedValue(undefined);
    const { saveProjects } = await import("./storage");
    const value = project("Snapshot");

    const saving = saveProjects([value]);
    value.excludePatterns?.push("dist/**");
    await saving;

    expect(invokeMock).toHaveBeenCalledWith("save_projects", {
      projects: [expect.objectContaining({ excludePatterns: ["node_modules/**"] })],
    });
  });
});
