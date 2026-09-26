import type { Conversation, Message } from "../../types";
import { generateId } from "../generateId";
import type { ParsedImportResult, ParsedMemoryItem } from "./types";

export function isSythoriaExport(data: unknown): boolean {
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    if (obj.app === "Sythoria" || obj.source === "sythoria" || "sythoria_version" in obj) {
      return true;
    }
    if (Array.isArray(obj.conversations)) {
      const first = obj.conversations[0];
      if (first && typeof first === "object" && "messages" in first && "model" in first) {
        return true;
      }
    }
  }
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];
    return typeof first === "object" && first !== null && "messages" in first && "model" in first && "id" in first;
  }
  return false;
}

export function parseSythoriaExport(data: unknown): ParsedImportResult {
  const conversations: Conversation[] = [];
  const memories: ParsedMemoryItem[] = [];
  let systemPrompt: string | undefined;

  let rawConversations: Conversation[] = [];

  if (Array.isArray(data)) {
    rawConversations = data as Conversation[];
  } else if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.conversations)) {
      rawConversations = obj.conversations as Conversation[];
    }
    if (typeof obj.systemPrompt === "string") {
      systemPrompt = obj.systemPrompt;
      memories.push({
        id: generateId(),
        title: "Sythoria System Prompt",
        content: obj.systemPrompt,
        source: "sythoria",
        timestamp: new Date(),
      });
    }
    if (Array.isArray(obj.memories)) {
      for (const m of obj.memories) {
        if (m && typeof m === "object") {
          const mem = m as Record<string, unknown>;
          memories.push({
            id: generateId(),
            title: String(mem.title || "Memory"),
            content: String(mem.content || ""),
            source: "sythoria",
            timestamp: mem.timestamp ? new Date(String(mem.timestamp)) : new Date(),
          });
        }
      }
    }
  }

  for (const raw of rawConversations) {
    if (!raw || !Array.isArray(raw.messages)) continue;

    const messages: Message[] = raw.messages.map((m) => ({
      ...m,
      id: m.id || generateId(),
      timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
    }));

    conversations.push({
      ...raw,
      id: generateId(), // New ID to avoid collision with existing chats
      timestamp: raw.timestamp ? new Date(raw.timestamp) : new Date(),
      messages,
    });
  }

  return {
    source: "sythoria",
    detectedFormatName: "Sythoria Native Backup",
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
