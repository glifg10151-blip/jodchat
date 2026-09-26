import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addProject: vi.fn(),
  addToast: vi.fn(),
  close: vi.fn(),
  invoke: vi.fn(),
  setActiveProject: vi.fn(),
  updateProject: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

vi.mock("../store/useProjectStore", () => ({
  useProjectStore: (selector: (state: unknown) => unknown) =>
    selector({
      projects: [],
      defaultPermission: "write",
      addProject: mocks.addProject,
      updateProject: mocks.updateProject,
      setActiveProject: mocks.setActiveProject,
    }),
}));

vi.mock("../store/useUIStore", () => ({
  useUIStore: (selector: (state: unknown) => unknown) =>
    selector({
      addToast: mocks.addToast,
      closeProjectConfigModal: mocks.close,
      language: "en",
      projectConfigModalId: null,
      projectConfigModalMode: "create",
      showProjectConfigModal: true,
    }),
}));

vi.mock("../store/useGitStore", () => ({
  useGitStore: (selector: (state: unknown) => unknown) => selector({ config: { isAutoCommitEnabled: false } }),
}));

vi.mock("./ui/Modal", () => ({
  Modal: ({ children, isOpen, title }: { children: React.ReactNode; isOpen: boolean; title: string }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
}));

import ProjectConfigModal from "./ProjectConfigModal";

describe("ProjectConfigModal", () => {
  beforeEach(() => {
    mocks.addProject.mockReset().mockResolvedValue("project-1");
    mocks.addToast.mockReset();
    mocks.close.mockReset();
    mocks.invoke.mockReset().mockImplementation((command: string) => {
      if (command === "create_project_dir") return Promise.resolve("/Documents/Notes");
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });
    mocks.setActiveProject.mockReset();
    mocks.updateProject.mockReset();
  });

  it("creates a writable non-Git project in Documents", async () => {
    const user = userEvent.setup();
    render(<ProjectConfigModal />);

    await user.type(screen.getByLabelText("Project Name"), "Notes");
    await user.click(screen.getByRole("button", { name: "Create Project" }));

    await waitFor(() => {
      expect(mocks.addProject).toHaveBeenCalledWith(
        "Notes",
        "/Documents/Notes",
        "write",
        expect.objectContaining({ isAutoCommitEnabled: false }),
      );
    });
    expect(mocks.invoke).toHaveBeenCalledWith("create_project_dir", { name: "Notes" });
    expect(mocks.invoke).not.toHaveBeenCalledWith("git_detect_repo", expect.anything());
    expect(mocks.setActiveProject).toHaveBeenCalledWith("project-1");
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
