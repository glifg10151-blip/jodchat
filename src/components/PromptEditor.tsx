import { memo, useCallback, useEffect, useImperativeHandle, useRef, type KeyboardEvent, type Ref } from "react";
import type { McpServerConfig } from "../types";
import { WEB_SEARCH_MENTION } from "../utils/toolMentions";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const EDITOR_SPACER = "\u200b";

export interface PromptDraft {
  text: string;
  plainText: string;
  mcpServerIds: string[];
  hasWebSearchMention: boolean;
}

export interface PromptEditorHandle {
  focus: () => void;
  insertMcpMention: (server: McpServerConfig) => boolean;
  insertWebSearchMention: () => boolean;
  clearDraft: () => void;
  readDraft: () => PromptDraft;
  replaceText: (text: string) => void;
  saveSelection: () => void;
}

export type PromptDraftChangeOrigin = "user" | "programmatic";

interface PromptEditorProps {
  editorHandleRef: Ref<PromptEditorHandle>;
  id: string;
  labelledBy: string;
  describedBy: string;
  placeholder: string;
  disabled?: boolean;
  invalid: boolean;
  isEmpty: boolean;
  maxHeight: number;
  className: string;
  webSearchLabel: string;
  onDraftChange: (draft: PromptDraft, origin: PromptDraftChangeOrigin) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onPasteText?: (text: string) => boolean;
}

type DeletionDirection = "backward" | "forward";

function createMcpIconElement(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("lucide", "lucide-cpu", "size-[1em]", "shrink-0");

  for (const pathValue of [
    "M12 20v2",
    "M12 2v2",
    "M17 20v2",
    "M17 2v2",
    "M2 12h2",
    "M2 17h2",
    "M2 7h2",
    "M20 12h2",
    "M20 17h2",
    "M20 7h2",
    "M7 20v2",
    "M7 2v2",
  ]) {
    const path = document.createElementNS(SVG_NAMESPACE, "path");
    path.setAttribute("d", pathValue);
    svg.append(path);
  }

  for (const [x, y, width, height, radius] of [
    ["4", "4", "16", "16", "2"],
    ["8", "8", "8", "8", "1"],
  ]) {
    const rect = document.createElementNS(SVG_NAMESPACE, "rect");
    rect.setAttribute("x", x);
    rect.setAttribute("y", y);
    rect.setAttribute("width", width);
    rect.setAttribute("height", height);
    rect.setAttribute("rx", radius);
    svg.append(rect);
  }

  return svg;
}

function createSearchIconElement(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("lucide", "lucide-search", "size-[1em]", "shrink-0");

  const circle = document.createElementNS(SVG_NAMESPACE, "circle");
  circle.setAttribute("cx", "11");
  circle.setAttribute("cy", "11");
  circle.setAttribute("r", "8");

  const path = document.createElementNS(SVG_NAMESPACE, "path");
  path.setAttribute("d", "m21 21-4.3-4.3");
  svg.append(circle, path);
  return svg;
}

function isToolMention(node: Node | null): boolean {
  return node instanceof HTMLElement && (Boolean(node.dataset.mcpServerId) || node.dataset.webSearchMention === "true");
}

function isEmptyMcpSpacer(node: Node): boolean {
  return node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").replaceAll(EDITOR_SPACER, "") === "";
}

function deepestNode(node: Node, direction: DeletionDirection): Node {
  let current = node;
  while (!isToolMention(current)) {
    const child = direction === "backward" ? current.lastChild : current.firstChild;
    if (!child) break;
    current = child;
  }
  return current;
}

function nextNodeOutside(node: Node, root: HTMLElement, direction: DeletionDirection): Node | null {
  let current: Node | null = node;
  while (current && current !== root) {
    const sibling = direction === "backward" ? current.previousSibling : current.nextSibling;
    if (sibling) return deepestNode(sibling, direction);
    current = current.parentNode;
  }
  return null;
}

function readPlainText(node: Node, editor: HTMLElement): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replaceAll(EDITOR_SPACER, "");
  if (!(node instanceof HTMLElement) || isToolMention(node)) return "";
  if (node.tagName === "BR") return "\n";

  const content = Array.from(node.childNodes, (child) => readPlainText(child, editor)).join("");
  const isBlock = node !== editor && (node.tagName === "DIV" || node.tagName === "P");
  return isBlock && !content.endsWith("\n") ? `${content}\n` : content;
}

function collectPreservedMentions(editor: HTMLElement): { offset: number; element: HTMLElement }[] {
  const mentions: { offset: number; element: HTMLElement }[] = [];
  let offset = 0;

  const visit = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").replaceAll(EDITOR_SPACER, "");
      offset += text.length;
      return text;
    }
    if (!(node instanceof HTMLElement)) return "";
    if (isToolMention(node)) {
      mentions.push({ offset, element: node.cloneNode(true) as HTMLElement });
      return "";
    }
    if (node.tagName === "BR") {
      offset += 1;
      return "\n";
    }

    const content = Array.from(node.childNodes, visit).join("");
    const isBlock = node !== editor && (node.tagName === "DIV" || node.tagName === "P");
    if (isBlock && !content.endsWith("\n")) offset += 1;
    return isBlock && !content.endsWith("\n") ? `${content}\n` : content;
  };

  visit(editor);
  return mentions;
}

/** Finds a tool mention only when it is the next logical character at the caret. */
function findAdjacentToolMention(editor: HTMLElement, range: Range, direction: DeletionDirection): HTMLElement | null {
  const container = range.startContainer;
  const offset = range.startOffset;
  let candidate: Node | null = null;

  if (container.nodeType === Node.TEXT_NODE) {
    const text = container.textContent ?? "";
    const textAtCaret = direction === "backward" ? text.slice(0, offset) : text.slice(offset);
    if (textAtCaret.replaceAll(EDITOR_SPACER, "") !== "") return null;
    candidate = nextNodeOutside(container, editor, direction);
  } else if (container.nodeType === Node.ELEMENT_NODE) {
    const childIndex = direction === "backward" ? offset - 1 : offset;
    const child = container.childNodes[childIndex];
    candidate = child ? deepestNode(child, direction) : nextNodeOutside(container, editor, direction);
  }

  while (candidate) {
    if (isToolMention(candidate)) return candidate as HTMLElement;
    if (!isEmptyMcpSpacer(candidate)) return null;
    candidate = nextNodeOutside(candidate, editor, direction);
  }
  return null;
}

export const PromptEditor = memo(function PromptEditor({
  editorHandleRef,
  id,
  labelledBy,
  describedBy,
  placeholder,
  disabled,
  invalid,
  isEmpty,
  maxHeight,
  className,
  webSearchLabel,
  onDraftChange,
  onKeyDown,
  onPasteText,
}: PromptEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<Range | null>(null);
  const deletionSuppressionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNativeMentionDeletionRef = useRef(false);

  const readDraft = useCallback((): PromptDraft => {
    const editor = editorRef.current;
    if (!editor) return { text: "", plainText: "", mcpServerIds: [], hasWebSearchMention: false };

    const mcpServerIds: string[] = [];
    let hasWebSearchMention = false;
    const readNode = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
      if (!(node instanceof HTMLElement)) return "";

      const serverId = node.dataset.mcpServerId;
      if (serverId) {
        mcpServerIds.push(serverId);
        const serverName = node.dataset.mcpServerName || node.textContent?.trim() || serverId;
        return `[MCP: ${serverName}]`;
      }
      if (node.dataset.webSearchMention === "true") {
        hasWebSearchMention = true;
        return WEB_SEARCH_MENTION;
      }
      if (node.tagName === "BR") return "\n";

      const content = Array.from(node.childNodes, readNode).join("");
      const isBlock = node !== editor && (node.tagName === "DIV" || node.tagName === "P");
      return isBlock && !content.endsWith("\n") ? `${content}\n` : content;
    };

    return {
      // A trailing native <br> is a browser caret filler, while our own caret
      // anchor follows a real line break. Remove the filler before stripping
      // editor-only anchors so the two cases stay distinguishable.
      text: readNode(editor).replace(/\n$/, "").replaceAll(EDITOR_SPACER, ""),
      plainText: readPlainText(editor, editor).replace(/\n$/, ""),
      mcpServerIds,
      hasWebSearchMention,
    };
  }, []);

  const syncDraft = useCallback(
    (origin: PromptDraftChangeOrigin = "user") => {
      onDraftChange(readDraft(), origin);
    },
    [onDraftChange, readDraft],
  );

  const saveSelection = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) selectionRef.current = range.cloneRange();
  }, []);

  const normalizeEmptyEditor = useCallback(() => {
    const editor = editorRef.current;
    if (!editor?.hasChildNodes()) return;

    const draft = readDraft();
    if (draft.hasWebSearchMention || draft.text || draft.mcpServerIds.length > 0) return;

    editor.replaceChildren();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    selectionRef.current = range.cloneRange();
  }, [readDraft]);

  const placeCaret = useCallback((node: Node, position: "before" | "after") => {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    if (position === "before") range.setStartBefore(node);
    else range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    selectionRef.current = range.cloneRange();
  }, []);

  const insertLineBreak = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection) return;

    const selectedRange = selection.rangeCount ? selection.getRangeAt(0) : null;
    const hasEditorSelection = Boolean(selectedRange && editor.contains(selectedRange.commonAncestorContainer));
    const range = hasEditorSelection ? selectedRange!.cloneRange() : document.createRange();
    if (!hasEditorSelection) {
      range.selectNodeContents(editor);
      range.collapse(false);
    }

    range.deleteContents();
    const lineBreak = document.createElement("br");
    const caretAnchor = document.createTextNode(EDITOR_SPACER);
    const fragment = document.createDocumentFragment();
    fragment.append(lineBreak, caretAnchor);
    range.insertNode(fragment);

    // The anchor gives the new empty line a paint box. Keeping the caret before
    // it means Backspace removes the line break immediately, not the anchor.
    placeCaret(caretAnchor, "before");
    syncDraft();
  }, [placeCaret, syncDraft]);

  const removeToolMention = useCallback(
    (mention: HTMLElement) => {
      const parent = mention.parentNode;
      if (!parent) return;
      const mentionIndex = Array.from(parent.childNodes).indexOf(mention);
      const nextSibling = mention.nextSibling;
      mention.remove();

      if (
        nextSibling?.nodeType === Node.TEXT_NODE &&
        (nextSibling.textContent === "" || nextSibling.textContent?.startsWith(EDITOR_SPACER))
      ) {
        const remainingText = nextSibling.textContent?.slice(1) ?? "";
        if (remainingText) nextSibling.textContent = remainingText;
        else nextSibling.remove();
      }

      editorRef.current?.focus();
      const range = document.createRange();
      const nodeAtMentionPosition = parent.childNodes[mentionIndex];
      if (nodeAtMentionPosition?.nodeType === Node.TEXT_NODE) range.setStart(nodeAtMentionPosition, 0);
      else range.setStart(parent, Math.min(mentionIndex, parent.childNodes.length));
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      selectionRef.current = range.cloneRange();
      syncDraft();
    },
    [syncDraft],
  );

  const deleteAdjacentToolMention = useCallback(
    (direction: DeletionDirection) => {
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (!editor || !selection?.isCollapsed || !selection.rangeCount) return false;

      const range = selection.getRangeAt(0);
      if (!editor.contains(range.commonAncestorContainer)) return false;
      const mention = findAdjacentToolMention(editor, range, direction);
      if (!mention) return false;

      removeToolMention(mention);
      return true;
    },
    [removeToolMention],
  );

  const createWebSearchMention = useCallback(() => {
    const mention = document.createElement("span");
    mention.dataset.webSearchMention = "true";
    mention.contentEditable = "false";
    mention.className =
      "inline-reference inline-text-reference max-w-[14rem] select-none";
    mention.setAttribute("role", "img");
    mention.setAttribute("aria-label", `${webSearchLabel} tool`);
    mention.setAttribute("title", webSearchLabel);

    const label = document.createElement("span");
    label.textContent = webSearchLabel;
    label.className = "truncate";
    mention.append(createSearchIconElement(), label);
    return mention;
  }, [webSearchLabel]);

  const insertWebSearchMention = useCallback((): boolean => {
    const editor = editorRef.current;
    if (!editor || disabled) return false;

    const mention = createWebSearchMention();
    const spacer = document.createTextNode(EDITOR_SPACER);
    const selection = window.getSelection();
    const currentRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const savedRange = selectionRef.current;
    const range =
      currentRange && editor.contains(currentRange.commonAncestorContainer)
        ? currentRange.cloneRange()
        : savedRange && editor.contains(savedRange.commonAncestorContainer)
          ? savedRange.cloneRange()
          : null;

    if (range) {
      range.deleteContents();
      range.insertNode(spacer);
      range.insertNode(mention);
    } else {
      editor.append(mention, spacer);
    }

    editor.focus();
    placeCaret(spacer, "after");
    syncDraft();
    return true;
  }, [createWebSearchMention, disabled, placeCaret, syncDraft]);

  const insertMcpMention = useCallback(
    (server: McpServerConfig) => {
      const editor = editorRef.current;
      if (!editor || disabled) return false;

      const mention = document.createElement("span");
      mention.dataset.mcpServerId = server.id;
      mention.dataset.mcpServerName = server.name;
      mention.dataset.mcpMentionId = crypto.randomUUID();
      mention.contentEditable = "false";
      mention.className =
        "inline-reference inline-text-reference max-w-[14rem] select-none";
      mention.setAttribute("role", "img");
      mention.setAttribute("aria-label", `MCP tool: ${server.name}`);

      const label = document.createElement("span");
      label.textContent = server.name;
      label.className = "truncate";
      mention.append(createMcpIconElement(), label);

      const spacer = document.createTextNode(EDITOR_SPACER);
      const selection = window.getSelection();
      const currentRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const savedRange = selectionRef.current;
      const range =
        currentRange && editor.contains(currentRange.commonAncestorContainer)
          ? currentRange.cloneRange()
          : savedRange && editor.contains(savedRange.commonAncestorContainer)
            ? savedRange.cloneRange()
            : null;

      if (range) {
        range.deleteContents();
        range.insertNode(spacer);
        range.insertNode(mention);
      } else {
        editor.append(mention, spacer);
      }

      editor.focus();
      placeCaret(spacer, "after");
      syncDraft();
      return true;
    },
    [disabled, placeCaret, syncDraft],
  );

  const replaceText = useCallback(
    (text: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      const preservedMentions = collectPreservedMentions(editor);
      editor.replaceChildren();
      let cursor = 0;
      for (const preserved of preservedMentions) {
        const mentionOffset = Math.min(preserved.offset, text.length);
        if (mentionOffset > cursor) editor.append(document.createTextNode(text.slice(cursor, mentionOffset)));
        editor.append(preserved.element, document.createTextNode(EDITOR_SPACER));
        cursor = mentionOffset;
      }
      if (cursor < text.length) editor.append(document.createTextNode(text.slice(cursor)));
      selectionRef.current = null;
      syncDraft("programmatic");
    },
    [syncDraft],
  );

  const clearDraft = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.replaceChildren();
    selectionRef.current = null;
    syncDraft("programmatic");
  }, [syncDraft]);

  useImperativeHandle(
    editorHandleRef,
    () => ({
      focus: () => editorRef.current?.focus(),
      insertMcpMention,
      insertWebSearchMention,
      clearDraft,
      readDraft,
      replaceText,
      saveSelection,
    }),
    [clearDraft, insertMcpMention, insertWebSearchMention, readDraft, replaceText, saveSelection],
  );

  useEffect(
    () => () => {
      if (deletionSuppressionTimerRef.current) clearTimeout(deletionSuppressionTimerRef.current);
    },
    [],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!event.nativeEvent.isComposing && (event.key === "Backspace" || event.key === "Delete")) {
        const direction = event.key === "Backspace" ? "backward" : "forward";
        if (deleteAdjacentToolMention(direction)) {
          event.preventDefault();
          suppressNativeMentionDeletionRef.current = true;
          if (deletionSuppressionTimerRef.current) clearTimeout(deletionSuppressionTimerRef.current);
          deletionSuppressionTimerRef.current = setTimeout(() => {
            suppressNativeMentionDeletionRef.current = false;
            deletionSuppressionTimerRef.current = null;
          }, 0);
          return;
        }
      }

      onKeyDown(event);

      if (!event.defaultPrevented && !event.nativeEvent.isComposing && event.key === "Enter") {
        event.preventDefault();
        insertLineBreak();
      }
    },
    [deleteAdjacentToolMention, insertLineBreak, onKeyDown],
  );

  return (
    <div
      className={`chat-prompt-editor-shell relative order-first mb-1 basis-full min-w-0 text-text-primary ${className}`}
    >
      {isEmpty && (
        <span className="pointer-events-none absolute inset-x-0 top-0 text-text-muted" aria-hidden="true">
          {placeholder}
        </span>
      )}
      <div
        id={id}
        ref={editorRef}
        contentEditable={!disabled}
        tabIndex={disabled ? -1 : 0}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        aria-disabled={disabled || undefined}
        data-editor-empty={isEmpty}
        onInput={() => syncDraft()}
        onBeforeInput={(event) => {
          const inputType = (event.nativeEvent as InputEvent).inputType;
          if (typeof inputType !== "string" || !inputType.startsWith("delete")) return;
          if (suppressNativeMentionDeletionRef.current) {
            event.preventDefault();
            return;
          }

          const direction = inputType.includes("Backward")
            ? "backward"
            : inputType.includes("Forward")
              ? "forward"
              : null;
          if (direction && deleteAdjacentToolMention(direction)) event.preventDefault();
        }}
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
        onFocus={normalizeEmptyEditor}
        onBlur={saveSelection}
        onPaste={(event) => {
          if (Array.from(event.clipboardData.files).some((file) => file.type.startsWith("image/"))) return;
          event.preventDefault();

          const pastedText = event.clipboardData.getData("text/plain");
          if (onPasteText?.(pastedText)) return;

          const editor = editorRef.current;
          const selection = window.getSelection();
          if (!editor || !selection) return;
          const selectedRange = selection.rangeCount ? selection.getRangeAt(0) : null;
          const hasEditorSelection = Boolean(selectedRange && editor.contains(selectedRange.commonAncestorContainer));
          const range = hasEditorSelection ? selectedRange! : document.createRange();
          if (!hasEditorSelection) {
            range.selectNodeContents(editor);
            range.collapse(false);
          }

          range.deleteContents();
          const textNode = document.createTextNode(pastedText);
          range.insertNode(textNode);
          placeCaret(textNode, "after");
          syncDraft();
        }}
        onKeyDown={handleKeyDown}
        style={{ maxHeight }}
        className="chat-prompt-editor relative min-h-5 min-w-0 overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words bg-transparent outline-none"
      />
    </div>
  );
});
