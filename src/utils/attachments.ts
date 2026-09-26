import type { Attachment, AttachmentKind } from "../types";
import { MAX_ATTACHMENTS, MAX_FILE_SIZE_BYTES } from "../config/constants";
import { generateId } from "./generateId";

const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-yaml",
  "application/x-sh",
]);

/** Extensions treated as text/code when the MIME type is missing or generic. */
const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "csv",
  "xml",
  "yaml",
  "yml",
  "js",
  "jsx",
  "ts",
  "tsx",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "c",
  "h",
  "cpp",
  "hpp",
  "cs",
  "php",
  "swift",
  "kt",
  "scala",
  "sh",
  "bash",
  "zsh",
  "sql",
  "html",
  "css",
  "scss",
  "toml",
  "ini",
  "cfg",
  "log",
  "env",
]);

function getExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

export function isImageFile(file: { name: string; type: string }): boolean {
  if (IMAGE_MIME_TYPES.has(file.type.toLowerCase())) return true;
  return IMAGE_EXTENSIONS.has(getExtension(file.name));
}

export function isTextFile(file: { name: string; type: string }): boolean {
  const type = file.type.toLowerCase();
  if (TEXT_MIME_PREFIXES.some((prefix) => type.startsWith(prefix))) return true;
  if (TEXT_MIME_TYPES.has(type)) return true;
  return TEXT_EXTENSIONS.has(getExtension(file.name));
}

export function classifyFile(file: { name: string; type: string }): AttachmentKind | null {
  if (isImageFile(file)) return "image";
  if (isTextFile(file)) return "text";
  return null;
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export function validateFile(file: { name: string; size: number; type: string }, currentCount = 0): ValidationResult {
  const kind = classifyFile(file);
  if (!kind) {
    return { ok: false, reason: `"${file.name}" — unsupported file type` };
  }
  if (file.size === 0) {
    return { ok: false, reason: `"${file.name}" — file is empty` };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      reason: `"${file.name}" — ${formatFileSize(file.size)} exceeds the ${formatFileSize(MAX_FILE_SIZE_BYTES)} limit`,
    };
  }
  if (currentCount >= MAX_ATTACHMENTS) {
    return { ok: false, reason: `Cannot attach more than ${MAX_ATTACHMENTS} files` };
  }
  return { ok: true };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

export async function readFileAsAttachment(file: File): Promise<Attachment> {
  const kind = classifyFile(file);
  if (!kind) {
    throw new Error(`Unsupported file: ${file.name}`);
  }
  const base: Attachment = {
    id: generateId(),
    name: file.name,
    mimeType: file.type || (kind === "image" ? "image/png" : "text/plain"),
    size: file.size,
    kind,
  };
  if (kind === "image") {
    base.dataUrl = await readFileAsDataURL(file);
  } else {
    base.textContent = await readFileAsText(file);
  }
  return base;
}

/**
 * Builds the `content` field for an OpenAI-compatible chat message.
 *
 * - No attachments → the original text string (most efficient, works everywhere).
 * - With attachments → a multipart content array: one text part (the user's text
 *   plus injected fenced blocks for each text file) followed by one image_url
 *   part per image attachment. Mirrors the shape already used in `toolLoop.ts`
 *   for MCP image results.
 *
 * Assistant/tool messages always pass through as plain strings.
 */
export function buildUserApiContent(
  content: string,
  attachments?: Attachment[],
): string | Array<Record<string, unknown>> {
  if (!attachments || attachments.length === 0) return content;

  const parts: Array<Record<string, unknown>> = [];

  const textAttachments = attachments.filter((a) => a.kind === "text" && a.textContent);
  const imageAttachments = attachments.filter((a) => a.kind === "image" && a.dataUrl);

  let text = content;
  if (textAttachments.length > 0) {
    const blocks = textAttachments.map((a) => {
      const lang = inferFenceLang(a.name);
      const header = `--- Attached file: ${a.name} (${formatFileSize(a.size)}) ---`;
      const fence = `\`\`\`${lang}\n${a.textContent}\n\`\`\``;
      return `${header}\n${fence}`;
    });
    text = `${content}\n\n${blocks.join("\n\n")}`.trim();
  }

  // Always emit a text part so models without vision still receive the prompt.
  if (text.length > 0) {
    parts.push({ type: "text", text });
  }

  for (const img of imageAttachments) {
    parts.push({ type: "image_url", image_url: { url: img.dataUrl } });
  }

  // Defensive fallback: if somehow all attachments were empty, return the raw text.
  return parts.length > 0 ? parts : content;
}

function inferFenceLang(name: string): string {
  const ext = getExtension(name);
  return TEXT_EXTENSIONS.has(ext) ? ext : "text";
}
