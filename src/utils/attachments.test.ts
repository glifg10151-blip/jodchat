import { describe, it, expect } from "vitest";
import {
  isImageFile,
  isTextFile,
  classifyFile,
  validateFile,
  formatFileSize,
  buildUserApiContent,
} from "./attachments";
import { MAX_FILE_SIZE_BYTES, MAX_ATTACHMENTS } from "../config/constants";
import type { Attachment } from "../types";

describe("attachments utility helpers", () => {
  describe("isImageFile", () => {
    it("classifies png, jpeg, gif, webp as images", () => {
      expect(isImageFile({ name: "test.png", type: "image/png" })).toBe(true);
      expect(isImageFile({ name: "test.jpg", type: "image/jpeg" })).toBe(true);
      expect(isImageFile({ name: "test.webp", type: "" })).toBe(true);
      expect(isImageFile({ name: "test.txt", type: "text/plain" })).toBe(false);
    });
  });

  describe("isTextFile", () => {
    it("classifies text files and code files as text", () => {
      expect(isTextFile({ name: "doc.txt", type: "text/plain" })).toBe(true);
      expect(isTextFile({ name: "data.json", type: "application/json" })).toBe(true);
      expect(isTextFile({ name: "script.js", type: "" })).toBe(true);
      expect(isTextFile({ name: "photo.png", type: "image/png" })).toBe(false);
    });
  });

  describe("classifyFile", () => {
    it("correctly identifies kind of file", () => {
      expect(classifyFile({ name: "test.png", type: "image/png" })).toBe("image");
      expect(classifyFile({ name: "doc.txt", type: "text/plain" })).toBe("text");
      expect(classifyFile({ name: "bin.exe", type: "application/octet-stream" })).toBeNull();
    });
  });

  describe("validateFile", () => {
    it("allows valid files", () => {
      const file = new File(["hello"], "hello.txt", { type: "text/plain" });
      expect(validateFile(file, 0)).toEqual({ ok: true });
    });

    it("rejects unsupported file types", () => {
      const file = new File(["binary content"], "binary.exe", { type: "application/octet-stream" });
      expect(validateFile(file, 0).ok).toBe(false);
      expect(validateFile(file, 0).reason).toContain("unsupported file type");
    });

    it("rejects empty files", () => {
      const file = new File([], "empty.txt", { type: "text/plain" });
      expect(validateFile(file, 0).ok).toBe(false);
      expect(validateFile(file, 0).reason).toContain("file is empty");
    });

    it("rejects files exceeding size limit", () => {
      const file = {
        name: "huge.txt",
        type: "text/plain",
        size: MAX_FILE_SIZE_BYTES + 1,
      } as File;
      expect(validateFile(file, 0).ok).toBe(false);
      expect(validateFile(file, 0).reason).toContain("exceeds the");
    });

    it("rejects when attachments count limit reached", () => {
      const file = new File(["hello"], "hello.txt", { type: "text/plain" });
      expect(validateFile(file, MAX_ATTACHMENTS).ok).toBe(false);
      expect(validateFile(file, MAX_ATTACHMENTS).reason).toContain("Cannot attach more than");
    });
  });

  describe("formatFileSize", () => {
    it("formats bytes, KB, MB correctly", () => {
      expect(formatFileSize(500)).toBe("500 B");
      expect(formatFileSize(1024)).toBe("1.0 KB");
      expect(formatFileSize(1024 * 1024 * 2.5)).toBe("2.5 MB");
    });
  });

  describe("buildUserApiContent", () => {
    it("returns plain string when no attachments", () => {
      expect(buildUserApiContent("Hello")).toBe("Hello");
      expect(buildUserApiContent("Hello", [])).toBe("Hello");
    });

    it("returns multipart array with injected text and image parts", () => {
      const attachments: Attachment[] = [
        {
          id: "1",
          name: "data.txt",
          mimeType: "text/plain",
          size: 12,
          kind: "text",
          textContent: "hello world",
        },
        {
          id: "2",
          name: "image.png",
          mimeType: "image/png",
          size: 1024,
          kind: "image",
          dataUrl: "data:image/png;base64,abc",
        },
      ];

      const result = buildUserApiContent("My prompt", attachments);
      expect(Array.isArray(result)).toBe(true);
      const parts = result as Array<Record<string, unknown>>;

      expect(parts).toHaveLength(2);
      expect(parts[0].type).toBe("text");
      expect(parts[0].text as string).toContain("My prompt");
      expect(parts[0].text as string).toContain("Attached file: data.txt");
      expect(parts[0].text as string).toContain("```txt\nhello world\n```");

      expect(parts[1].type).toBe("image_url");
      expect((parts[1].image_url as Record<string, string>).url).toBe("data:image/png;base64,abc");
    });
  });
});
