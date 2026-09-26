import type { Conversation, Message } from "../../types";
import { generateId } from "../generateId";
import type { ParsedImportResult, ParsedMemoryItem } from "./types";

interface ChatGptMessageNode {
  id: string;
  parent: string | null;
  children: string[];
  message?: {
    id: string;
    author: {
      role: "user" | "assistant" | "system" | "tool" | string;
    };
    create_time: number | null;
    content?: {
      content_type?: string;
      parts?: unknown[];
      text?: string;
    };
  } | null;
}

interface ChatGptConversation {
  id?: string;
  title?: string;
  create_time?: number;
  update_time?: number;
  mapping?: Record<string, ChatGptMessageNode>;
  current_node?: string;
}

export function isChatGptExport(data: unknown): boolean {
  if (!Array.isArray(data)) {
    if (typeof data === "object" && data !== null) {
      const obj = data as Record<string, unknown>;
      if ("mapping" in obj || "custom_instructions" in obj || "user_instructions" in obj) {
        return true;
      }
    }
    return false;
  }
  if (data.length === 0) return false;
  const first = data[0];
  return typeof first === "object" && first !== null && ("mapping" in first || "current_node" in first);
}

function extractTextFromParts(parts: unknown[] | undefined, fallbackText?: string): string {
  if (parts && Array.isArray(parts)) {
    return parts
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part === "object" && part !== null) {
          const p = part as Record<string, unknown>;
          if (typeof p.text === "string") return p.text;
          return JSON.stringify(part);
        }
        return String(part ?? "");
      })
      .filter(Boolean)
      .join("\n\n");
  }
  return fallbackText || "";
}

function reconstructLinearThread(
  mapping: Record<string, ChatGptMessageNode>,
  currentNodeId?: string,
): ChatGptMessageNode[] {
  // If current_node is provided, backtrack to root
  if (currentNodeId && mapping[currentNodeId]) {
    const thread: ChatGptMessageNode[] = [];
    let curr: string | null = currentNodeId;
    while (curr && mapping[curr]) {
      const node: ChatGptMessageNode = mapping[curr];
      thread.unshift(node);
      curr = node.parent;
    }
    return thread;
  }

  // Fallback: Breadth-first / topological traversal from root nodes (nodes with parent === null)
  const roots = Object.values(mapping).filter((n) => !n.parent || !mapping[n.parent]);
  const ordered: ChatGptMessageNode[] = [];
  const visited = new Set<string>();

  const traverse = (nodeId: string): void => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node: ChatGptMessageNode | undefined = mapping[nodeId];
    if (node) {
      ordered.push(node);
      for (const childId of node.children || []) {
        traverse(childId);
      }
    }
  };

  for (const root of roots) {
    traverse(root.id);
  }

  return ordered.length > 0 ? ordered : Object.values(mapping);
}

export function parseChatGptExport(data: unknown): ParsedImportResult {
  const conversations: Conversation[] = [];
  const memories: ParsedMemoryItem[] = [];
  let systemPrompt: string | undefined;

  const rawConversations: ChatGptConversation[] = Array.isArray(data)
    ? (data as ChatGptConversation[])
    : typeof data === "object" && data !== null && "mapping" in data
      ? [data as ChatGptConversation]
      : [];

  // Check for custom instructions object
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    const instructions =
      (typeof obj.custom_instructions === "string" ? obj.custom_instructions : "") ||
      (typeof obj.user_instructions === "string" ? obj.user_instructions : "") ||
      (typeof obj.about_user === "string" ? obj.about_user : "");
    if (instructions) {
      systemPrompt = instructions;
      memories.push({
        id: generateId(),
        title: "ChatGPT Custom Instructions",
        content: instructions,
        source: "chatgpt",
        timestamp: new Date(),
      });
    }
  }

  for (const raw of rawConversations) {
    if (!raw.mapping) continue;

    const linearNodes = reconstructLinearThread(raw.mapping, raw.current_node);
    const messages: Message[] = [];

    for (const node of linearNodes) {
      const msg = node.message;
      if (!msg) continue;

      const roleStr = msg.author?.role?.toLowerCase() || "user";
      if (roleStr === "system") {
        const sysText = extractTextFromParts(msg.content?.parts, msg.content?.text);
        if (sysText && !systemPrompt) {
          systemPrompt = sysText;
        }
        continue;
      }

      const role: "user" | "assistant" = roleStr === "assistant" ? "assistant" : "user";
      const content = extractTextFromParts(msg.content?.parts, msg.content?.text);
      if (!content.trim()) continue;

      const timestamp = msg.create_time ? new Date(msg.create_time * 1000) : new Date();

      messages.push({
        id: generateId(),
        role,
        content: content.trim(),
        timestamp,
      });
    }

    if (messages.length > 0) {
      const convDate = raw.create_time ? new Date(raw.create_time * 1000) : messages[0].timestamp;
      conversations.push({
        id: generateId(),
        title: raw.title?.trim() || messages[0].content.slice(0, 40) || "Imported ChatGPT Conversation",
        timestamp: convDate,
        messages,
        model: "openai/gpt-4o",
      });
    }
  }

  return {
    source: "chatgpt",
    detectedFormatName: "OpenAI ChatGPT Export",
    conversations,
    memories,
    systemPrompt,
    stats: {
      conversationCount: conversations.length,
      messageCount: conversations.reduce((acc, c) => acc + c.messages.length, 0),
      memoryItemCount: memories.length,
    },
  };
}
