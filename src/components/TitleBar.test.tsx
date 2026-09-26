import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  checkForUpdates: vi.fn().mockResolvedValue(undefined),
  getVersion: vi.fn().mockResolvedValue("0.4.1"),
  newChat: vi.fn(),
  setView: vi.fn(),
  setActiveSection: vi.fn(),
  toggleCommandPalette: vi.fn(),
  toggleMaximize: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: mocks.getVersion,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: mocks.toggleMaximize,
    close: vi.fn(),
  }),
}));

vi.mock("../store/useKeybindStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../store/useKeybindStore")>();
  return {
    ...actual,
    useKeybindStore: () => ({
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      zoomReset: vi.fn(),
    }),
  };
});

vi.mock("../store/useChatStore", () => ({
  useChatStore: {
    getState: () => ({ newChat: mocks.newChat }),
  },
}));

vi.mock("../store/useUIStore", () => ({
  useUIStore: {
    getState: () => ({
      checkForUpdates: mocks.checkForUpdates,
      setView: mocks.setView,
      setActiveSection: mocks.setActiveSection,
      toggleCommandPalette: mocks.toggleCommandPalette,
    }),
  },
}));

import { TitleBar } from "./TitleBar";

describe("TitleBar application menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getVersion.mockResolvedValue("0.4.1");
  });

  it("shows the runtime app version and runs the real updater check", async () => {
    const user = userEvent.setup();
    render(<TitleBar />);

    await user.click(screen.getByRole("menuitem", { name: "Sythoria" }));

    expect(await screen.findByText("Version 0.4.1")).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "Check for Updates" }));

    expect(mocks.getVersion).toHaveBeenCalledOnce();
    expect(mocks.checkForUpdates).toHaveBeenCalledWith(false);
  });

  it("creates a real conversation from the File menu", async () => {
    const user = userEvent.setup();
    render(<TitleBar />);

    await user.click(screen.getByRole("menuitem", { name: "File" }));
    await user.click(screen.getByRole("menuitem", { name: /^New Conversation/ }));

    expect(mocks.newChat).toHaveBeenCalledOnce();
  });

  it("supports arrow-key navigation between top-level menus", async () => {
    const user = userEvent.setup();
    render(<TitleBar />);

    const sythoria = screen.getByRole("menuitem", { name: "Sythoria" });
    sythoria.focus();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("menuitem", { name: "File" })).toHaveFocus();
  });

  it("toggles window maximize when double-clicking on the title bar", async () => {
    const user = userEvent.setup();
    const { container } = render(<TitleBar />);

    const titlebar = container.querySelector("[data-tauri-drag-region]");
    expect(titlebar).not.toBeNull();

    await user.dblClick(titlebar!);

    expect(mocks.toggleMaximize).toHaveBeenCalledOnce();
  });
});
