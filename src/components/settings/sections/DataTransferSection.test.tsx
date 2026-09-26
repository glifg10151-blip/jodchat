import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataTransferSection } from "./DataTransferSection";

const mockAddToast = vi.fn();
const mockImportConversations = vi.fn();
const mockSetSystemPrompt = vi.fn();

const mockUIState = {
  addToast: mockAddToast,
  animationsDisabled: false,
};

vi.mock("../../../store/useUIStore", () => {
  const useUIStoreMock = (selector: (state: typeof mockUIState) => unknown) => selector(mockUIState);
  useUIStoreMock.getState = () => mockUIState;
  return { useUIStore: useUIStoreMock };
});

vi.mock("../../../store/useChatStore", () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      conversations: [
        {
          id: "conv-1",
          title: "My Chat",
          messages: [{ id: "m1", role: "user", content: "Hello" }],
        },
      ],
      importConversations: mockImportConversations,
    }),
}));

vi.mock("../../../store/useModelStore", () => ({
  useModelStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      systemPrompt: "My custom instructions",
      setSystemPrompt: mockSetSystemPrompt,
    }),
}));

vi.mock("../../../store/useKnowledgeStore", () => ({
  useKnowledgeStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      createCollection: vi.fn(),
      indexText: vi.fn(),
    }),
}));

describe("DataTransferSection component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Import and Export sections properly", () => {
    render(<DataTransferSection />);

    expect(screen.getByText("Import Data & Memory")).toBeInTheDocument();
    expect(screen.getByText("Export Data & Chat History")).toBeInTheDocument();
    expect(screen.getByText("Export Conversations")).toBeInTheDocument();
    expect(screen.getByText("Export Memory")).toBeInTheDocument();
  });

  it("switches to paste tab and inspects pasted text", async () => {
    const user = userEvent.setup();
    render(<DataTransferSection />);

    const pasteTabBtn = screen.getByRole("button", { name: "Paste Text or Notes" });
    await user.click(pasteTabBtn);

    const textarea = screen.getByPlaceholderText(/Paste ChatGPT Memory/i);
    expect(textarea).toBeInTheDocument();

    await user.type(textarea, "# User Coding Preferences\n- Prefers TypeScript");

    const inspectBtn = screen.getByRole("button", { name: "Inspect & Preview" });
    await user.click(inspectBtn);

    expect(await screen.findByText(/Markdown \/ Text Memory Notes/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Complete Import" })).toBeInTheDocument();
  });
});
