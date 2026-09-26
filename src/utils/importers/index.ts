import { isChatGptExport, parseChatGptExport } from "./chatgpt";
import { isClaudeExport, parseClaudeExport } from "./claude";
import { isGeminiExport, parseGeminiExport } from "./gemini";
import { isSythoriaExport, parseSythoriaExport } from "./sythoria";
import { parseTextMemory } from "./textMemory";
import type { ParsedImportResult } from "./types";

export * from "./types";
export * from "./chatgpt";
export * from "./claude";
export * from "./gemini";
export * from "./sythoria";
export * from "./textMemory";

export function parseImportData(rawContent: string, filename?: string): ParsedImportResult {
  const trimmed = rawContent.trim();

  // Attempt JSON parse
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      const data = JSON.parse(trimmed) as unknown;

      if (isSythoriaExport(data)) {
        return parseSythoriaExport(data);
      }
      if (isChatGptExport(data)) {
        return parseChatGptExport(data);
      }
      if (isClaudeExport(data)) {
        return parseClaudeExport(data);
      }
      if (isGeminiExport(data)) {
        return parseGeminiExport(data);
      }

      // Generic JSON structure with conversations or messages
      if (Array.isArray(data) && data.length > 0) {
        return parseChatGptExport(data);
      }
    } catch {
      // Fall through to text parsing if JSON parse fails
    }
  }

  // Check if string contains Gemini keywords
  if (isGeminiExport(trimmed)) {
    return parseGeminiExport(trimmed);
  }

  // Fallback to text/markdown memory parsing
  return parseTextMemory(trimmed, filename);
}
