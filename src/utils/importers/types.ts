import type { Conversation } from "../../types";

export type ImportSourceType = "chatgpt" | "claude" | "gemini" | "sythoria" | "text_memory" | "unknown";

export interface ParsedMemoryItem {
  id: string;
  title: string;
  content: string;
  source: ImportSourceType;
  timestamp?: Date;
}

export interface ParsedImportResult {
  source: ImportSourceType;
  detectedFormatName: string;
  conversations: Conversation[];
  memories: ParsedMemoryItem[];
  systemPrompt?: string;
  stats: {
    conversationCount: number;
    messageCount: number;
    memoryItemCount: number;
  };
}
