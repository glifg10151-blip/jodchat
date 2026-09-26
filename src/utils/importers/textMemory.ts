import { generateId } from "../generateId";
import type { ParsedImportResult, ParsedMemoryItem } from "./types";

export function isTextMemory(content: string): boolean {
  return typeof content === "string" && content.trim().length > 0;
}

export function parseTextMemory(content: string, filename = "Imported Memory"): ParsedImportResult {
  const memories: ParsedMemoryItem[] = [];
  const lines = content.split("\n");

  // Try to parse markdown sections (# or ##) as individual memory items
  let currentTitle = filename.replace(/\.(md|txt|json)$/i, "");
  let currentSectionLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("# ") || line.startsWith("## ")) {
      if (currentSectionLines.length > 0) {
        const text = currentSectionLines.join("\n").trim();
        if (text) {
          memories.push({
            id: generateId(),
            title: currentTitle,
            content: text,
            source: "text_memory",
            timestamp: new Date(),
          });
        }
        currentSectionLines = [];
      }
      currentTitle = line.replace(/^#+\s*/, "").trim();
    } else {
      currentSectionLines.push(line);
    }
  }

  if (currentSectionLines.length > 0) {
    const text = currentSectionLines.join("\n").trim();
    if (text) {
      memories.push({
        id: generateId(),
        title: currentTitle,
        content: text,
        source: "text_memory",
        timestamp: new Date(),
      });
    }
  }

  return {
    source: "text_memory",
    detectedFormatName: "Markdown / Text Memory Notes",
    conversations: [],
    memories,
    systemPrompt: content.trim(),
    stats: {
      conversationCount: 0,
      messageCount: 0,
      memoryItemCount: memories.length,
    },
  };
}
