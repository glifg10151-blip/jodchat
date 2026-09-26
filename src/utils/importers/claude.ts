import type { Conversation, Message } from "../../types";
import { generateId } from "../generateId";
import type { ParsedImportResult, ParsedMemoryItem } from "./types";

interface ClaudeChatMessage {
  uuid?: string;
  sender: "human" | "assistant" | string;
  text?: string;
  created_at?: string;
  updated_at?: string;
  attachments?: Array<{
    file_name?: string;
    file_type?: string;
    file_size?: number;
    extracted_content?: string;
  }>;
}

interface ClaudeConversation {
  uuid?: string;
  name?: string;
  created_at?: string;
  updated_at?: string;
  chat_messages?: ClaudeChatMessage[];
}

interface ClaudeProject {
  uuid?: string;
  name?: string;
  description?: string;
  prompt_template?: string;
  docs?: Array<{
    file_name?: string;
    content?: string;
  }>;
}

export function isClaudeExport(data: unknown): boolean {
  if (!Array.isArray(data)) {
    if (typeof data === "object" && data !== null) {
      const obj = data as Record<string, unknown>;
      return "chat_messages" in obj || "prompt_template" in obj;
    }
    return false;
  }
  if (data.length === 0) return false;
  const first = data[0];
  return (
    typeof first === "object" &&
    first !== null &&
    ("chat_messages" in first || "prompt_template" in first || "sender" in first)
  );
}

export function parseClaudeExport(data: unknown): ParsedImportResult {
  const conversations: Conversation[] = [];
  const memories: ParsedMemoryItem[] = [];
  let systemPrompt: string | undefined;

  const rawList: unknown[] = Array.isArray(data) ? data : [data];

  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;

    // Case 1: Claude Project / Prompt Template / Project Docs
    if ("prompt_template" in obj || "docs" in obj) {
      const project = obj as ClaudeProject;
      if (project.prompt_template) {
        systemPrompt = (systemPrompt ? systemPrompt + "\n\n" : "") + project.prompt_template;
        memories.push({
          id: generateId(),
          title: project.name || "Claude Project Prompt",
          content: project.prompt_template,
          source: "claude",
          timestamp: new Date(),
        });
      }
      if (project.docs && Array.isArray(project.docs)) {
        for (const doc of project.docs) {
          if (doc.content) {
            memories.push({
              id: generateId(),
              title: doc.file_name || project.name || "Claude Project Document",
              content: doc.content,
              source: "claude",
              timestamp: new Date(),
            });
          }
        }
      }
      continue;
    }

    // Case 2: Claude Conversation with chat_messages
    if ("chat_messages" in obj && Array.isArray(obj.chat_messages)) {
      const conv = obj as ClaudeConversation;
      const messages: Message[] = [];

      for (const msg of conv.chat_messages || []) {
        const sender = msg.sender?.toLowerCase() || "human";
        const role: "user" | "assistant" = sender === "assistant" ? "assistant" : "user";
        const text = msg.text || "";

        if (!text.trim() && (!msg.attachments || msg.attachments.length === 0)) continue;

        let fullContent = text;
        if (msg.attachments && msg.attachments.length > 0) {
          for (const att of msg.attachments) {
            if (att.extracted_content) {
              fullContent += `\n\n[Attachment: ${att.file_name || "file"}]\n${att.extracted_content}`;
            }
          }
        }

        const timestamp = msg.created_at ? new Date(msg.created_at) : new Date();

        messages.push({
          id: generateId(),
          role,
          content: fullContent.trim(),
          timestamp,
        });
      }

      if (messages.length > 0) {
        const convDate = conv.created_at ? new Date(conv.created_at) : messages[0].timestamp;
        conversations.push({
          id: generateId(),
          title: conv.name?.trim() || messages[0].content.slice(0, 40) || "Imported Claude Conversation",
          timestamp: convDate,
          messages,
          model: "anthropic/claude-3-5-sonnet",
        });
      }
    }
  }

  return {
    source: "claude",
    detectedFormatName: "Anthropic Claude Export",
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
