import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("../utils/logger", () => ({
  logError: mocks.logError,
}));

import { useSkillStore } from "./useSkillStore";

const skillSummary = {
  id: "example",
  name: "Example",
  description: "Example skill",
};

describe("useSkillStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSkillStore.setState({
      skills: [],
      skillContents: {},
      loading: false,
      lastLoadedAt: null,
    });
  });

  it("deduplicates concurrent skill-list requests", async () => {
    let resolveList: ((skills: (typeof skillSummary)[]) => void) | undefined;
    const pendingList = new Promise<(typeof skillSummary)[]>((resolve) => {
      resolveList = resolve;
    });
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "list_skills") return pendingList;
      return Promise.resolve(undefined);
    });

    const firstLoad = useSkillStore.getState().loadSkills();
    const secondLoad = useSkillStore.getState().loadSkills();

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(useSkillStore.getState().loading).toBe(true);

    resolveList?.([skillSummary]);
    await Promise.all([firstLoad, secondLoad]);

    expect(useSkillStore.getState().skills).toEqual([skillSummary]);
    expect(useSkillStore.getState().loading).toBe(false);
  });

  it("uses the cached list during the freshness window", async () => {
    mocks.invoke.mockResolvedValue([skillSummary]);

    await useSkillStore.getState().loadSkills();
    await useSkillStore.getState().loadSkills();

    expect(mocks.invoke).toHaveBeenCalledOnce();
  });

  it("allows a retry after a failed list request", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("disk unavailable")).mockResolvedValueOnce([skillSummary]);

    await useSkillStore.getState().loadSkills();
    await useSkillStore.getState().loadSkills();

    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.logError).toHaveBeenCalledOnce();
    expect(useSkillStore.getState().skills).toEqual([skillSummary]);
  });

  it("loads full skill content lazily and caches it by ID", async () => {
    const content = "---\nname: Example\ndescription: Example skill\n---\nBody";
    mocks.invoke.mockResolvedValue(content);

    await expect(useSkillStore.getState().readSkill("example")).resolves.toBe(content);
    await expect(useSkillStore.getState().readSkill("example")).resolves.toBe(content);

    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(mocks.invoke).toHaveBeenCalledWith("read_skill", { id: "example" });
  });

  it("forces a metadata refresh and invalidates cached content after an update", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "list_skills") return Promise.resolve([skillSummary]);
      if (command === "read_skill") return Promise.resolve("Old content");
      return Promise.resolve(undefined);
    });

    await useSkillStore.getState().loadSkills();
    await useSkillStore.getState().readSkill("example");
    await useSkillStore.getState().updateSkill("example", "Updated", "Updated skill", "New content");

    expect(mocks.invoke.mock.calls.filter(([command]) => command === "list_skills")).toHaveLength(2);
    expect(useSkillStore.getState().skillContents).not.toHaveProperty("example");
  });
});
