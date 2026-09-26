import { describe, expect, it } from "vitest";
import { computeFileDiff, formatDiffHunkHeader, languageForFilename, simulateStringReplacement } from "./lineDiff";

describe("computeFileDiff", () => {
  it("returns no hunks for identical content", () => {
    const diff = computeFileDiff("a\nb\nc", "a\nb\nc");
    expect(diff).toEqual({ added: 0, deleted: 0, hunks: [], truncated: false });
  });

  it("returns no hunks for empty inputs", () => {
    expect(computeFileDiff("", "")).toEqual({ added: 0, deleted: 0, hunks: [], truncated: false });
  });

  it("treats a new file as pure additions in one hunk", () => {
    const diff = computeFileDiff("", "line1\nline2");
    expect(diff.added).toBe(2);
    expect(diff.deleted).toBe(0);
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0].lines).toEqual([
      { type: "add", newNumber: 1, content: "line1" },
      { type: "add", newNumber: 2, content: "line2" },
    ]);
  });

  it("treats an emptied file as pure deletions", () => {
    const diff = computeFileDiff("one\ntwo", "");
    expect(diff.added).toBe(0);
    expect(diff.deleted).toBe(2);
    expect(diff.hunks[0].lines.every((line) => line.type === "del")).toBe(true);
  });

  it("produces context around an edit with correct line numbers", () => {
    const oldContent = ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8", "l9", "l10"].join("\n");
    const newContent = oldContent.replace("l5", "changed");
    const diff = computeFileDiff(oldContent, newContent);

    expect(diff.added).toBe(1);
    expect(diff.deleted).toBe(1);
    expect(diff.hunks).toHaveLength(1);

    const hunk = diff.hunks[0];
    expect(hunk.lines.map((line) => line.type)).toEqual([
      "context",
      "context",
      "context",
      "del",
      "add",
      "context",
      "context",
      "context",
    ]);
    expect(hunk.lines[3]).toMatchObject({ type: "del", oldNumber: 5, content: "l5" });
    expect(hunk.lines[4]).toMatchObject({ type: "add", newNumber: 5, content: "changed" });
    expect(hunk.oldStart).toBe(2);
    expect(hunk.newStart).toBe(2);
  });

  it("splits distant changes into separate hunks", () => {
    const oldContent = Array.from({ length: 30 }, (_, i) => `line${i + 1}`).join("\n");
    const newContent = oldContent.replace("line2", "edited2").replace("line29", "edited29");
    const diff = computeFileDiff(oldContent, newContent);

    expect(diff.added).toBe(2);
    expect(diff.deleted).toBe(2);
    expect(diff.hunks).toHaveLength(2);
    expect(diff.hunks[0].lines.some((line) => line.content === "edited2")).toBe(true);
    expect(diff.hunks[1].lines.some((line) => line.content === "edited29")).toBe(true);
  });

  it("merges hunks whose context windows touch", () => {
    const oldContent = Array.from({ length: 12 }, (_, i) => `line${i + 1}`).join("\n");
    // Changes at lines 5 and 9 are 4 lines apart, so their 3-line contexts overlap.
    const newContent = oldContent.replace("line5", "a5").replace("line9", "a9");
    const diff = computeFileDiff(oldContent, newContent);
    expect(diff.hunks).toHaveLength(1);
    expect(diff.added).toBe(2);
    expect(diff.deleted).toBe(2);
  });

  it("keeps full counts when hunks are truncated", () => {
    const newContent = Array.from({ length: 2000 }, (_, i) => `new ${i}`).join("\n");
    const diff = computeFileDiff("", newContent);

    expect(diff.truncated).toBe(true);
    expect(diff.added).toBe(2000);
    expect(diff.deleted).toBe(0);
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0].lines).toHaveLength(1200);
    expect(diff.hunks[0].lines[0].content).toBe("new 0");
  });

  it("falls back to replace-all for very large rewrites while keeping counts", () => {
    const oldContent = Array.from({ length: 1200 }, (_, i) => `old ${i}`).join("\n");
    const newContent = Array.from({ length: 1200 }, (_, i) => `new ${i}`).join("\n");
    const diff = computeFileDiff(oldContent, newContent);

    expect(diff.added).toBe(1200);
    expect(diff.deleted).toBe(1200);
    expect(diff.hunks).toHaveLength(1);
    const types = new Set(diff.hunks[0].lines.map((line) => line.type));
    expect(types.has("context")).toBe(false);
  });

  it("handles CRLF line endings", () => {
    const diff = computeFileDiff("a\r\nb\r\nc", "a\r\nx\r\nc");
    expect(diff.added).toBe(1);
    expect(diff.deleted).toBe(1);
    expect(diff.hunks[0].lines.find((line) => line.type === "add")?.content).toBe("x");
  });

  it("numbers an insertion at the top of the file", () => {
    const diff = computeFileDiff("b\nc", "a\nb\nc");
    expect(diff.added).toBe(1);
    const add = diff.hunks[0].lines.find((line) => line.type === "add");
    expect(add).toMatchObject({ newNumber: 1 });
    expect(diff.hunks[0].oldStart).toBe(1);
  });
});

describe("simulateStringReplacement", () => {
  it("replaces the first occurrence by default", () => {
    expect(simulateStringReplacement("a b a", "a", "c", false)).toBe("c b a");
  });

  it("replaces every occurrence with replaceAll", () => {
    expect(simulateStringReplacement("a b a", "a", "c", true)).toBe("c b c");
  });

  it("returns content unchanged when old_string is missing", () => {
    expect(simulateStringReplacement("abc", "zzz", "c", false)).toBe("abc");
    expect(simulateStringReplacement("abc", "zzz", "c", true)).toBe("abc");
  });

  it("treats an empty old_string as a no-op", () => {
    expect(simulateStringReplacement("abc", "", "x", false)).toBe("abc");
  });

  it("keeps $ patterns in new_string literal", () => {
    expect(simulateStringReplacement("value = 1;", "1", "$&-ok", false)).toBe("value = $&-ok;");
  });
});

describe("formatDiffHunkHeader", () => {
  it("formats git-style hunk headers", () => {
    const diff = computeFileDiff("a\nb\nc", "a\nx\nc");
    // The hunk covers lines 1-3 (change on line 2 with clamped context).
    expect(formatDiffHunkHeader(diff.hunks[0])).toBe("@@ -1,3 +1,3 @@");
  });
});

describe("languageForFilename", () => {
  it("maps common extensions to highlight languages", () => {
    expect(languageForFilename("toolLoop.ts")).toBe("typescript");
    expect(languageForFilename("App.tsx")).toBe("tsx");
    expect(languageForFilename("lib.rs")).toBe("rust");
    expect(languageForFilename("style.css")).toBe("css");
    expect(languageForFilename("README.md")).toBe("markdown");
    expect(languageForFilename("Dockerfile")).toBe("dockerfile");
  });

  it("falls back to plaintext for unknown extensions", () => {
    expect(languageForFilename("archive.zst")).toBe("plaintext");
    expect(languageForFilename("Makefile")).toBe("plaintext");
  });
});
