import { act, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { PromptEditor, type PromptEditorHandle } from "./PromptEditor";

describe("PromptEditor structured replacements", () => {
  it("preserves MCP and web-search mentions while replacing dictated text", () => {
    const editorHandleRef = createRef<PromptEditorHandle>();
    render(
      <PromptEditor
        editorHandleRef={editorHandleRef}
        id="prompt"
        labelledBy="prompt-label"
        describedBy="prompt-description"
        placeholder="Message"
        invalid={false}
        isEmpty={false}
        maxHeight={200}
        className=""
        webSearchLabel="Web Search"
        onDraftChange={vi.fn()}
        onKeyDown={vi.fn()}
      />,
    );

    act(() => editorHandleRef.current?.replaceText("Plan"));
    act(() => editorHandleRef.current?.insertWebSearchMention());
    act(() => editorHandleRef.current?.insertWebSearchMention());
    act(() => {
      editorHandleRef.current?.insertMcpMention({
        id: "documents",
        name: "Documents",
        transport: "stdio",
        command: "documents-mcp",
        enabled: true,
      });
    });
    act(() => editorHandleRef.current?.replaceText("Plan follow-up"));

    expect(screen.getAllByRole("img", { name: "Web Search tool" })).toHaveLength(2);
    expect(screen.getByRole("img", { name: "MCP tool: Documents" })).toBeInTheDocument();
    const draft = editorHandleRef.current?.readDraft();
    expect(draft?.plainText).toBe("Plan follow-up");
    expect(draft?.mcpServerIds).toEqual(["documents"]);
    expect(draft?.hasWebSearchMention).toBe(true);
    expect(draft?.text.match(/\[MCP: Documents\]/g)).toHaveLength(1);
    expect(draft?.text.match(/\[Web Search\]/g)).toHaveLength(2);
  });
});
