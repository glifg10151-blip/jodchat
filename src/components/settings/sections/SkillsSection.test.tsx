import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("../../../utils/logger", () => ({
  logError: vi.fn(),
}));

import { useSkillStore } from "../../../store/useSkillStore";
import { SkillsSection } from "./SkillsSection";

describe("SkillsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      }),
    );
    useSkillStore.setState({
      skills: [
        {
          id: "example",
          name: "Example",
          description: "Example skill",
        },
      ],
      skillContents: {},
      loading: false,
      lastLoadedAt: Date.now(),
    });
  });

  it("reads full content only when the user opens a skill", async () => {
    mocks.invoke.mockResolvedValue('---\r\nname: "Example"\r\ndescription: "Example skill"\r\n---\r\nLazy-loaded body');

    render(<SkillsSection scrollParent={null} />);

    expect(mocks.invoke).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Edit Skill: Example" }));

    expect(mocks.invoke).toHaveBeenCalledWith("read_skill", { id: "example" });
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Markdown Content" })).toHaveValue("Lazy-loaded body"),
    );
  });
});
