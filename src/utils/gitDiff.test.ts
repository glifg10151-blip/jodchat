import { describe, expect, it } from "vitest";
import { parseDiffHunks, parseGitDiff } from "./gitDiff";

describe("graphical diff parsing", () => {
  it("keeps header-like source lines and excludes metadata and section markers", () => {
    const [file] = parseGitDiff(`diff --git a/test.txt b/test.txt
index 123..456 100644
--- a/test.txt
+++ b/test.txt
@@ -4,2 +4,2 @@
--- old source
+++ new source
 context

--- UNTRACKED CHANGE ---
`);
    expect(file).toMatchObject({ path: "test.txt", oldPath: "test.txt", additions: 1, deletions: 1 });
    expect(parseDiffHunks(file.lines)[0].lines).toEqual([
      { type: "del", content: "-- old source", oldNumber: 4 },
      { type: "add", content: "++ new source", newNumber: 4 },
      { type: "context", content: "context", oldNumber: 5, newNumber: 5 },
    ]);
  });

  it("resets actual line numbers across hunks and ignores newline notices", () => {
    const hunks = parseDiffHunks([
      "@@ -2 +2 @@",
      "-before",
      "+after",
      "\\ No newline at end of file",
      "@@ -80,0 +81,2 @@ a function",
      "+first",
      "+second",
      "",
      "--- STAGED CHANGES ---",
    ]);
    expect(hunks).toHaveLength(2);
    expect(hunks[1]).toMatchObject({ oldStart: 80, oldLines: 0, newStart: 81, newLines: 2 });
    expect(hunks[1].lines).toEqual([
      { type: "add", content: "first", newNumber: 81 },
      { type: "add", content: "second", newNumber: 82 },
    ]);
  });

  it("does not treat binary data as changed text", () => {
    const [file] = parseGitDiff(`diff --git a/image.png b/image.png
new file mode 100644
GIT binary patch
literal 10
+not-a-source-line
--- UNTRACKED CHANGE ---
`);
    expect(file).toMatchObject({ oldPath: "image.png", additions: 0, deletions: 0 });
    expect(parseDiffHunks(file.lines)).toEqual([]);
  });
});
