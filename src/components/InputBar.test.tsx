import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InputBar from "./InputBar";
import type { ModelConfig, ModelStatuses, McpServerStatus } from "../types";
import { useChatStore } from "../store/useChatStore";
import { useModelStore } from "../store/useModelStore";
import { useProjectStore } from "../store/useProjectStore";
import { executeCommand } from "../services/commandDispatcher";

vi.mock("./WorkspaceChangeIndicator", () => ({
  WorkspaceChangeIndicator: () => <button aria-label="Live workspace changes">1 file changed</button>,
}));

const mockModels: ModelConfig[] = [
  {
    id: "model-1",
    name: "GPT-4o",
    apiBase: "https://api.openai.com/v1/chat/completions",
    apiKey: "sk-test",
    modelId: "gpt-4o",
    provider: "OpenAI",
  },
  {
    id: "model-2",
    name: "Llama 3",
    apiBase: "http://localhost:11434/v1/chat/completions",
    apiKey: "",
    modelId: "llama3.1",
    provider: "Ollama (Local)",
  },
];

const mockStatuses: ModelStatuses = {
  "model-1": "connected",
  "model-2": "disconnected",
};

const mockMcpServerStatuses: Record<string, McpServerStatus> = {};

const defaultMcpProps = {
  mcpServers: [],
  mcpServerStatuses: mockMcpServerStatuses,
};

describe("InputBar", () => {
  it("keeps the file-change indicator inside the composer dock above the editor", () => {
    useChatStore.setState({
      activeId: "changed-chat",
      conversations: [
        {
          id: "changed-chat",
          title: "Changed chat",
          timestamp: new Date(),
          messages: [],
          model: "model-1",
          projectId: "project-a",
        },
      ],
    });

    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        {...defaultMcpProps}
      />,
    );

    const indicator = screen.getByRole("button", { name: "Live workspace changes" });
    const editor = screen.getByRole("textbox", { name: "Message" });
    expect(indicator.closest(".chat-composer-dock")).toBe(editor.closest(".chat-composer-dock"));
    expect(indicator.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    useChatStore.setState({ activeId: null, conversations: [] });
  });

  it("renders the placeholder outside the editable DOM", () => {
    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        {...defaultMcpProps}
      />,
    );

    const editor = screen.getByLabelText("Message");
    const placeholder = screen.getByText("Ask for follow-up changes...");
    expect(editor).toBeInTheDocument();
    expect(placeholder).toHaveAttribute("aria-hidden", "true");
    expect(editor).not.toContainElement(placeholder);
    expect(editor).toHaveTextContent("");
  });

  it("removes WebKit filler nodes when an empty editor regains focus", () => {
    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        {...defaultMcpProps}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "Message" });
    const fillerLine = document.createElement("div");
    fillerLine.append(document.createElement("br"));
    editor.append(fillerLine);

    fireEvent.focus(editor);

    expect(editor).toBeEmptyDOMElement();
    expect(window.getSelection()?.anchorNode).toBe(editor);
    expect(window.getSelection()?.anchorOffset).toBe(0);
  });

  it("disables send when input is empty", () => {
    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        {...defaultMcpProps}
      />,
    );

    const sendBtn = screen.getByLabelText("Send message");
    expect(sendBtn).toBeDisabled();
  });

  it("calls the stop callback without forwarding the React click event", async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();

    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        isStreaming
        onStop={onStop}
        {...defaultMcpProps}
      />,
    );

    await user.click(screen.getByLabelText("Stop generating"));

    expect(onStop).toHaveBeenCalledOnce();
    expect(onStop).toHaveBeenCalledWith();
  });

  it("animates the project context row while generating", () => {
    act(() => {
      useProjectStore.setState({
        projects: [{ id: "project-a", name: "Project A", path: "/projects/a", permissions: "write" }],
        activeProjectId: "project-a",
        isProjectsEnabled: true,
      });
    });

    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        isStreaming
        onStop={vi.fn()}
        {...defaultMcpProps}
      />,
    );

    expect(document.querySelector(".chat-composer-project-row")).toHaveClass("animate-border-glow-light");
  });

  it("disables input when disabled prop is true", () => {
    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        disabled={true}
        modelStatuses={mockStatuses}
        {...defaultMcpProps}
      />,
    );

    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveAttribute("contenteditable", "false");
    expect(textarea).toHaveAttribute("aria-disabled", "true");
  });

  it("shows model selector with current model name", () => {
    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        {...defaultMcpProps}
      />,
    );

    expect(screen.getAllByText("GPT-4o").length).toBeGreaterThan(0);
  });

  it("uses shared compare input without a contradictory model selector", () => {
    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        isCompareMode
        {...defaultMcpProps}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "Message" });
    expect(screen.getByText("Ask all models...")).not.toBe(editor);
    expect(editor).toHaveTextContent("");
    expect(screen.queryByRole("button", { name: /response settings/i })).not.toBeInTheDocument();
  });

  it("organizes response settings into model and thinking sections", async () => {
    const user = userEvent.setup();
    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        {...defaultMcpProps}
      />,
    );

    await user.click(screen.getByRole("button", { name: /response settings/i }));

    expect(screen.getByRole("button", { name: /^model/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^thinking/i })).toBeInTheDocument();
  });

  it("updates the thinking level for a supported model", async () => {
    const user = userEvent.setup();
    const updateModel = vi.fn();
    const originalUpdateModel = useModelStore.getState().updateModel;
    act(() => useModelStore.setState({ updateModel }));

    const reasoningModel: ModelConfig = {
      ...mockModels[0],
      modelId: "gpt-5",
      thinkingLevel: "auto",
    };

    render(
      <InputBar
        models={[reasoningModel]}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        {...defaultMcpProps}
      />,
    );

    await user.click(screen.getByRole("button", { name: /response settings/i }));
    await user.click(screen.getByRole("button", { name: /^thinking/i }));
    await user.click(await screen.findByRole("button", { name: /^high/i }));

    expect(updateModel).toHaveBeenCalledWith("model-1", { thinkingLevel: "high" });
    act(() => useModelStore.setState({ updateModel: originalUpdateModel }));
  });

  it("calls onSend when Enter is pressed with content", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(
      <InputBar
        models={mockModels}
        onSend={onSend}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        {...defaultMcpProps}
      />,
    );

    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "Hello{Enter}");

    expect(onSend).toHaveBeenCalledWith("Hello", undefined, [], null);
  });

  it("tracks visual editor emptiness from the parsed draft", async () => {
    const user = userEvent.setup();
    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        {...defaultMcpProps}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "Message" });
    expect(editor).toHaveAttribute("data-editor-empty", "true");
    expect(screen.getByText("Ask for follow-up changes...")).toBeInTheDocument();

    await user.type(editor, "w");
    expect(editor).toHaveAttribute("data-editor-empty", "false");
    expect(screen.queryByText("Ask for follow-up changes...")).not.toBeInTheDocument();

    await user.keyboard("{Backspace}");
    expect(editor).toHaveAttribute("data-editor-empty", "true");
    expect(screen.getByText("Ask for follow-up changes...")).toBeInTheDocument();
  });

  it("treats WebKit filler markup as an empty draft", () => {
    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        {...defaultMcpProps}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "Message" });
    editor.innerHTML = "<div><br></div>";
    fireEvent.input(editor);

    expect(editor).toHaveAttribute("data-editor-empty", "true");
    expect(screen.getByText("Ask for follow-up changes...")).toBeInTheDocument();
    expect(screen.getByLabelText("Send message")).toBeDisabled();
  });

  it("keeps over-limit content in draft state so it cannot send a stale shorter value", () => {
    const onSend = vi.fn();
    render(
      <InputBar
        models={mockModels}
        onSend={onSend}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        {...defaultMcpProps}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "Message" });
    editor.textContent = "a".repeat(10_101);
    fireEvent.input(editor);

    expect(editor).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Send message")).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("turns large plain-text pastes into text file attachments", async () => {
    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        {...defaultMcpProps}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "Message" });
    const pastedText = "large paste\n".repeat(400);
    fireEvent.paste(editor, {
      clipboardData: {
        files: [],
        getData: (type: string) => (type === "text/plain" ? pastedText : ""),
      },
    });

    await waitFor(() => expect(screen.getByTitle("pasted-text.txt")).toBeInTheDocument());
    expect(editor).toHaveTextContent("");
    expect(useChatStore.getState().draftAttachments[0]).toMatchObject({
      name: "pasted-text.txt",
      kind: "text",
      textContent: pastedText,
    });

    act(() => useChatStore.getState().setDraftAttachments([]));
  });

  it("adds repeated MCP labels inline and sends only their server references", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue("accepted");
    const documentsServer = {
      id: "documents",
      name: "Documents",
      transport: "stdio" as const,
      command: "documents-mcp",
      enabled: true,
    };

    render(
      <InputBar
        models={mockModels}
        onSend={onSend}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        mcpServers={[documentsServer]}
        mcpServerStatuses={{ documents: "connected" }}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "Message" });
    await user.type(editor, "Open this using ");
    await user.click(screen.getByLabelText("Attach or search"));
    await user.click(screen.getByRole("menuitem", { name: /Documents/i }));
    await user.click(screen.getByLabelText("Attach or search"));
    await user.click(screen.getByRole("menuitem", { name: /Documents/i }));
    await user.type(editor, " please");

    const mentions = screen.getAllByRole("img", { name: "MCP tool: Documents" });
    expect(mentions).toHaveLength(2);
    expect(mentions[0]).toHaveClass("text-[0.9em]", "align-[-0.08em]");
    expect(mentions[0]).toHaveClass("leading-none");
    expect(mentions[0]).not.toHaveClass("leading-[inherit]", "py-px");
    expect(mentions[0].querySelector(".lucide-cpu")).toBeInTheDocument();
    expect(mentions[0].querySelector("button")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Send message"));

    expect(onSend).toHaveBeenCalledWith(
      "Open this using [MCP: Documents][MCP: Documents] please",
      undefined,
      ["documents", "documents"],
      null,
    );
    expect(editor).toHaveTextContent("");
  });

  it("captures an MCP label when it is inserted and sent in the same React batch", async () => {
    const onSend = vi.fn().mockResolvedValue("accepted");
    const documentsServer = {
      id: "documents",
      name: "Documents",
      transport: "stdio" as const,
      command: "documents-mcp",
      enabled: true,
    };

    render(
      <InputBar
        models={mockModels}
        onSend={onSend}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        mcpServers={[documentsServer]}
        mcpServerStatuses={{ documents: "connected" }}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "Message" });
    fireEvent.input(editor, { target: { textContent: "Check my unread email" } });
    fireEvent.click(screen.getByLabelText("Attach or search"));

    const mcpMenuItem = screen.getByRole("menuitem", { name: /Documents/i });
    const sendButton = screen.getByLabelText("Send message");
    await act(async () => {
      mcpMenuItem.click();
      sendButton.click();
    });

    expect(onSend).toHaveBeenCalledWith("Check my unread email[MCP: Documents]", undefined, ["documents"], null);
  });

  it("removes an inline MCP label with one Backspace and preserves the caret position", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(
      <InputBar
        models={mockModels}
        onSend={onSend}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        mcpServers={[
          { id: "computer", name: "Computer Use", transport: "stdio", command: "computer-mcp", enabled: true },
        ]}
        mcpServerStatuses={{ computer: "connected" }}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "Message" });
    await user.type(editor, "Open my browser using ");
    await user.click(screen.getByLabelText("Attach or search"));
    await user.click(screen.getByRole("menuitem", { name: /Computer Use/i }));
    expect(editor).toHaveTextContent("Open my browser using Computer Use");
    const mention = screen.getByRole("img", { name: "MCP tool: Computer Use" });
    const spacer = mention.nextSibling;
    expect(spacer).not.toBeNull();
    const range = document.createRange();
    range.setStartAfter(spacer!);
    range.collapse(true);
    editor.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(selection?.isCollapsed).toBe(true);
    expect(selection?.anchorNode).toBe(editor);
    expect(selection?.anchorOffset).toBe(Array.from(editor.childNodes).indexOf(spacer!) + 1);
    fireEvent.keyDown(editor, { key: "Backspace" });

    expect(screen.queryByRole("img", { name: "MCP tool: Computer Use" })).not.toBeInTheDocument();
    expect(editor).toHaveTextContent("Open my browser using ");
    expect(selection?.isCollapsed).toBe(true);
    expect(editor.contains(selection?.anchorNode ?? null)).toBe(true);
    await user.keyboard("the available tool");
    await user.keyboard("{Enter}");

    expect(onSend).toHaveBeenCalledWith("Open my browser using the available tool", undefined, [], null);
    expect(screen.queryByRole("img", { name: "MCP tool: Computer Use" })).not.toBeInTheDocument();
  });

  it("removes an inline MCP label with one forward Delete", async () => {
    const user = userEvent.setup();
    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        mcpServers={[
          { id: "computer", name: "Computer Use", transport: "stdio", command: "computer-mcp", enabled: true },
        ]}
        mcpServerStatuses={{ computer: "connected" }}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "Message" });
    await user.type(editor, "Use ");
    await user.click(screen.getByLabelText("Attach or search"));
    await user.click(screen.getByRole("menuitem", { name: /Computer Use/i }));
    const mention = screen.getByRole("img", { name: "MCP tool: Computer Use" });
    const range = document.createRange();
    range.setStartBefore(mention);
    range.collapse(true);
    editor.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.keyDown(editor, { key: "Delete" });

    expect(screen.queryByRole("img", { name: "MCP tool: Computer Use" })).not.toBeInTheDocument();
    expect(editor).toHaveTextContent("Use ");
    expect(selection?.isCollapsed).toBe(true);
    expect(editor.contains(selection?.anchorNode ?? null)).toBe(true);
    await user.keyboard("the tool");
    expect(editor).toHaveTextContent("Use the tool");
  });

  it.each([
    ["an empty editor", ""],
    ["existing text", "Hello"],
  ])("inserts exactly one line break after Shift+Enter with %s", async (_scenario, initialText) => {
    const onSend = vi.fn();
    render(
      <InputBar
        models={mockModels}
        onSend={onSend}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        {...defaultMcpProps}
      />,
    );

    const editor = screen.getByRole("textbox");
    const user = userEvent.setup();
    if (initialText) await user.type(editor, initialText);
    else editor.focus();

    const nativeInsertionWasPrevented = !fireEvent.keyDown(editor, { key: "Enter", shiftKey: true });
    const lineBreak = editor.querySelector("br");
    const caretAnchor = lineBreak?.nextSibling;

    expect(nativeInsertionWasPrevented).toBe(true);
    expect(editor.querySelectorAll("br")).toHaveLength(1);
    expect(caretAnchor?.textContent).toBe("\u200b");
    expect(editor).toHaveAttribute("data-editor-empty", "false");
    expect(window.getSelection()?.anchorNode).toBe(editor);
    expect(window.getSelection()?.anchorOffset).toBe(Array.from(editor.childNodes).indexOf(caretAnchor!));
    expect(onSend).not.toHaveBeenCalled();
    expect(editor.parentElement).toHaveClass("chat-prompt-editor-shell");
    expect(editor).toHaveClass("overflow-x-hidden", "overflow-y-auto", "whitespace-pre-wrap", "break-words");
  });

  it("reads native contenteditable line breaks as one logical newline", async () => {
    const onSend = vi.fn().mockResolvedValue("accepted");
    render(
      <InputBar
        models={mockModels}
        onSend={onSend}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        {...defaultMcpProps}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "Message" });
    editor.append("Hello", document.createElement("br"), "world");
    fireEvent.input(editor);
    await userEvent.setup().click(screen.getByLabelText("Send message"));

    expect(onSend).toHaveBeenCalledWith("Hello\nworld", undefined, [], null);
  });

  it("shows web search option in plus dropdown", () => {
    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        {...defaultMcpProps}
      />,
    );

    const plusButton = screen.getByLabelText("Attach or search");
    expect(plusButton).toBeInTheDocument();
  });

  it("adds a web search chip from the plus dropdown", async () => {
    const user = userEvent.setup();
    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        searchConfigId="search-1"
        {...defaultMcpProps}
      />,
    );

    const plusButton = screen.getByLabelText("Attach or search");
    await user.click(plusButton);

    const searchOption = screen.getByRole("menuitem", { name: /web search/i });
    expect(searchOption).toBeInTheDocument();
    expect(searchOption).not.toHaveAttribute("aria-checked");

    await user.click(searchOption);
    expect(await screen.findByRole("img", { name: "Web Search tool" })).toBeInTheDocument();
    expect(screen.queryByText("Web Search enabled")).not.toBeInTheDocument();

    await user.click(plusButton);
    const repeatedSearchOption = screen.getByRole("menuitem", { name: /web search/i });
    expect(repeatedSearchOption).not.toHaveAttribute("aria-checked");
    expect(repeatedSearchOption).not.toHaveClass("bg-active");
    await user.click(repeatedSearchOption);
    expect(screen.getAllByRole("img", { name: "Web Search tool" })).toHaveLength(2);
  });

  it("adds web search to the focused composer from the keyboard command", async () => {
    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        searchConfigId="search-1"
        {...defaultMcpProps}
      />,
    );
    screen.getByRole("textbox", { name: "Message" }).focus();

    expect(executeCommand("toggleSearch")).toBe(true);

    expect(await screen.findByRole("img", { name: "Web Search tool" })).toBeInTheDocument();
    expect(executeCommand("toggleSearch")).toBe(true);
    expect(screen.getAllByRole("img", { name: "Web Search tool" })).toHaveLength(2);
  });

  it("moves the web search chip into the submitted prompt", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue("accepted");
    render(
      <InputBar
        models={mockModels}
        onSend={onSend}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        searchConfigId="search-1"
        {...defaultMcpProps}
      />,
    );
    await user.click(screen.getByLabelText("Attach or search"));
    await user.click(screen.getByRole("menuitem", { name: /web search/i }));

    const editor = screen.getByRole("textbox", { name: "Message" });
    const searchBubble = await screen.findByRole("img", { name: "Web Search tool" });
    expect(editor).toContainElement(searchBubble);
    expect(searchBubble).toHaveClass("text-[0.9em]", "align-[-0.08em]", "leading-none");
    expect(searchBubble.querySelector(".lucide-search")).toBeInTheDocument();

    await user.type(editor, "Find the latest release{Enter}");
    expect(onSend).toHaveBeenCalledWith("[Web Search]Find the latest release", undefined, [], "search-1");
    expect(screen.queryByRole("img", { name: "Web Search tool" })).not.toBeInTheDocument();
    expect(editor).toHaveTextContent("");
  });

  it("removes only the adjacent web search chip with Backspace", async () => {
    const user = userEvent.setup();
    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        searchConfigId="search-1"
        {...defaultMcpProps}
      />,
    );
    await user.click(screen.getByLabelText("Attach or search"));
    await user.click(screen.getByRole("menuitem", { name: /web search/i }));
    await user.click(screen.getByLabelText("Attach or search"));
    await user.click(screen.getByRole("menuitem", { name: /web search/i }));

    const editor = screen.getByRole("textbox", { name: "Message" });
    const searchBubbles = screen.getAllByRole("img", { name: "Web Search tool" });
    expect(searchBubbles).toHaveLength(2);
    const searchBubble = searchBubbles[1];
    const spacer = searchBubble.nextSibling;
    expect(spacer).not.toBeNull();
    const range = document.createRange();
    range.setStartAfter(spacer!);
    range.collapse(true);
    editor.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.keyDown(editor, { key: "Backspace" });

    expect(screen.getAllByRole("img", { name: "Web Search tool" })).toHaveLength(1);
  });

  it("removes web search metadata when a native edit deletes its composer chip", async () => {
    const user = userEvent.setup();
    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        searchConfigId="search-1"
        {...defaultMcpProps}
      />,
    );
    await user.click(screen.getByLabelText("Attach or search"));
    await user.click(screen.getByRole("menuitem", { name: /web search/i }));

    const editor = screen.getByRole("textbox", { name: "Message" });
    const searchBubble = await screen.findByRole("img", { name: "Web Search tool" });
    searchBubble.remove();
    fireEvent.input(editor);

    expect(screen.queryByRole("img", { name: "Web Search tool" })).not.toBeInTheDocument();
  });

  it("keeps web search selection local to each composer", async () => {
    const user = userEvent.setup();
    render(
      <>
        <div aria-label="Main composer">
          <InputBar
            models={mockModels}
            onSend={vi.fn()}
            selectedModel="model-1"
            onModelChange={vi.fn()}
            modelStatuses={mockStatuses}
            searchConfigId="search-1"
            idPrefix="main"
            {...defaultMcpProps}
          />
        </div>
        <div aria-label="Side composer">
          <InputBar
            models={mockModels}
            onSend={vi.fn()}
            selectedModel="model-1"
            onModelChange={vi.fn()}
            modelStatuses={mockStatuses}
            searchConfigId="search-1"
            idPrefix="side"
            {...defaultMcpProps}
          />
        </div>
      </>,
    );

    const mainComposer = screen.getByLabelText("Main composer");
    const sideComposer = screen.getByLabelText("Side composer");
    await user.click(within(mainComposer).getByLabelText("Attach or search"));
    await user.click(within(mainComposer).getByRole("menuitem", { name: /web search/i }));

    expect(within(mainComposer).getByRole("img", { name: "Web Search tool" })).toBeInTheDocument();
    expect(within(sideComposer).queryByRole("img", { name: "Web Search tool" })).not.toBeInTheDocument();
  });

  it("renders image attachment and allows opening preview modal", async () => {
    const user = userEvent.setup();
    act(() => {
      useChatStore.getState().setDraftAttachments([
        {
          id: "attachment-1",
          name: "test-image.png",
          mimeType: "image/png",
          size: 1024,
          kind: "image",
          dataUrl:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        },
      ]);
    });

    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        {...defaultMcpProps}
      />,
    );

    // Verify thumbnail image is rendered
    const imgEl = screen.getByRole("button", { name: "Preview test-image.png" }).querySelector("img");
    expect(imgEl).toBeInTheDocument();
    expect(imgEl).toHaveAttribute("alt", "");
    expect(imgEl).toHaveAttribute("src", expect.stringContaining("data:image/png"));

    // Click on the attachment element to trigger preview modal
    const attachmentPill = screen.getByRole("button", { name: "Preview test-image.png" });
    await user.click(attachmentPill);

    // Verify ImagePreviewModal is open
    expect(screen.getByText("test-image.png")).toBeInTheDocument();

    // Close preview modal
    const closeBtn = screen.getByTitle("Close viewer (Esc)");
    await user.click(closeBtn);
    expect(screen.queryByTitle("Close viewer (Esc)")).not.toBeInTheDocument();

    // Clean up
    act(() => {
      useChatStore.getState().setDraftAttachments([]);
    });
  });

  it("allows project detachment while workspace publication is pending", async () => {
    const user = userEvent.setup();
    act(() => {
      useProjectStore.setState({
        projects: [{ id: "project-a", name: "Project A", path: "/projects/a", permissions: "write" }],
        activeProjectId: "project-a",
        isProjectsEnabled: true,
      });
      useChatStore.setState({
        activeId: "pending-chat",
        conversations: [
          {
            id: "pending-chat",
            title: "Pending chat",
            timestamp: new Date(),
            messages: [],
            model: "model-1",
            projectId: "project-a",
            pendingWorktree: { path: "/worktrees/a", branch: "sythoria-agent-a" },
          },
        ],
      });
    });

    render(
      <InputBar
        models={mockModels}
        onSend={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={mockStatuses}
        {...defaultMcpProps}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Project context" }));

    const detachButton = screen.getByRole("menuitem", { name: "Detach Project" });
    expect(detachButton).toBeEnabled();

    await user.click(detachButton);

    expect(useChatStore.getState().conversations[0].projectId).toBeUndefined();
    expect(useChatStore.getState().conversations[0].pendingWorktree).toEqual({
      path: "/worktrees/a",
      branch: "sythoria-agent-a",
    });
  });
});
