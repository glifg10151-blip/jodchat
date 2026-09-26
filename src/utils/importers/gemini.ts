import type { Conversation, Message } from "../../types";
import { generateId } from "../generateId";
import type { ParsedImportResult, ParsedMemoryItem } from "./types";

interface GeminiTakeoutMessage {
  role?: string;
  author?: string;
  text?: string;
  content?: string | { parts?: string[] };
  timestamp?: string;
  time?: string;
}

interface GeminiTakeoutConversation {
  title?: string;
  create_time?: string;
  timestamp?: string;
  messages?: GeminiTakeoutMessage[];
  chunks?: GeminiTakeoutMessage[];
}

export function isGeminiExport(data: unknown): boolean {
  if (
    typeof data === "string" &&
    (data.includes("Google Takeout") || data.includes("Gemini") || data.includes("Bard"))
  ) {
    return true;
  }
  if (!Array.isArray(data)) {
    if (typeof data === "object" && data !== null) {
      const obj = data as Record<string, unknown>;
      return "conversations" in obj || "gemini" in obj || "bard" in obj;
    }
    return false;
  }
  if (data.length === 0) return false;
  const first = data[0];
  if (typeof first === "object" && first !== null) {
    const obj = first as Record<string, unknown>;
    if ("messages" in obj && Array.isArray(obj.messages)) {
      const firstMsg = obj.messages[0] as Record<string, unknown> | undefined;
      if (firstMsg && ("role" in firstMsg || "author" in firstMsg)) {
        const r = String(firstMsg.role || firstMsg.author || "").toLowerCase();
        return r === "model" || r === "gemini" || r === "bard" || r === "user";
      }
    }
  }
  return false;
}

export function parseGeminiExport(data: unknown): ParsedImportResult {
  const conversations: Conversation[] = [];
  const memories: ParsedMemoryItem[] = [];

  let rawList: GeminiTakeoutConversation[] = [];

  if (Array.isArray(data)) {
    rawList = data as GeminiTakeoutConversation[];
  } else if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.conversations)) {
      rawList = obj.conversations as GeminiTakeoutConversation[];
    } else if (Array.isArray(obj.messages)) {
      rawList = [obj as GeminiTakeoutConversation];
    }
  }

  for (const raw of rawList) {
    const rawMsgs = raw.messages || raw.chunks || [];
    if (!Array.isArray(rawMsgs) || rawMsgs.length === 0) continue;

    const messages: Message[] = [];

    for (const msg of rawMsgs) {
      const authorStr = String(msg.author || msg.role || "user").toLowerCase();
      const role: "user" | "assistant" =
        authorStr === "model" || authorStr === "gemini" || authorStr === "bard" || authorStr === "assistant"
          ? "assistant"
          : "user";

      let text = "";
      if (typeof msg.text === "string") {
        text = msg.text;
      } else if (typeof msg.content === "string") {
        text = msg.content;
      } else if (typeof msg.content === "object" && msg.content !== null && Array.isArray(msg.content.parts)) {
        text = msg.content.parts.join("\n\n");
      }

      if (!text.trim()) continue;

      const dateStr = msg.timestamp || msg.time || raw.create_time || raw.timestamp;
      const timestamp = dateStr ? new Date(dateStr) : new Date();

      messages.push({
        id: generateId(),
        role,
        content: text.trim(),
        timestamp,
      });
    }

    if (messages.length > 0) {
      const convDate = raw.create_time ? new Date(raw.create_time) : messages[0].timestamp;
      conversations.push({
        id: generateId(),
        title: raw.title?.trim() || messages[0].content.slice(0, 40) || "Imported Gemini Conversation",
        timestamp: convDate,
        messages,
        model: "google/gemini-1.5-pro",
      });
    }
  }

  return {
    source: "gemini",
    detectedFormatName: "Google Gemini / Takeout Export",
    conversations,
    memories,
    stats: {
      conversationCount: conversations.length,
      messageCount: conversations.reduce((acc, c) => acc + c.messages.length, 0),
      memoryItemCount: memories.length,
    },
  };
}
