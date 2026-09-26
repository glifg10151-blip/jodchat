import type { DiffHunk } from "../types";

export interface DiffFile {
  path: string;
  oldPath: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  lines: string[];
}

function cleanDiffPath(value: string): string {
  const path = value.trim().split("\t")[0];
  if (path === "/dev/null") return path;
  return path.replace(/^[ab]\//, "");
}

/** Read only the declared hunk body, never Git headers or section markers. */
export function parseDiffHunks(lines: string[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldNumber = 0;
  let newNumber = 0;
  for (const line of lines) {
    const header = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (header) {
      current = {
        oldStart: Number(header[1]),
        oldLines: Number(header[2] ?? 1),
        newStart: Number(header[3]),
        newLines: Number(header[4] ?? 1),
        lines: [],
      };
      oldNumber = current.oldStart;
      newNumber = current.newStart;
      hunks.push(current);
      continue;
    }
    if (!current || line.startsWith("\\ No newline")) continue;
    const oldRemaining = oldNumber < current.oldStart + current.oldLines;
    const newRemaining = newNumber < current.newStart + current.newLines;
    if (line.startsWith("+") && newRemaining) {
      current.lines.push({ type: "add", content: line.slice(1), newNumber: newNumber++ });
    } else if (line.startsWith("-") && oldRemaining) {
      current.lines.push({ type: "del", content: line.slice(1), oldNumber: oldNumber++ });
    } else if (line.startsWith(" ") && oldRemaining && newRemaining) {
      current.lines.push({ type: "context", content: line.slice(1), oldNumber: oldNumber++, newNumber: newNumber++ });
    } else {
      current = null;
    }
  }
  return hunks;
}

export function parseGitDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let inHunk = false;

  for (const line of diff.split("\n")) {
    if (/^--- (?:UNSTAGED CHANGES|STAGED CHANGES|UNTRACKED CHANGE) ---$/.test(line) && !inHunk) {
      current = null;
      continue;
    }
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      current = {
        oldPath: match?.[1] ?? "",
        path: match?.[2] ?? "Unknown file",
        status: "modified",
        additions: 0,
        deletions: 0,
        lines: [line],
      };
      files.push(current);
      inHunk = false;
      continue;
    }

    if (!current) continue;
    current.lines.push(line);
    if (line.startsWith("@@ ")) inHunk = true;
    if (inHunk) continue;

    if (line.startsWith("new file mode")) current.status = "added";
    if (line.startsWith("deleted file mode")) current.status = "deleted";
    if (line.startsWith("rename from ")) {
      current.status = "renamed";
      current.oldPath = line.slice("rename from ".length);
    }
    if (line.startsWith("rename to ")) current.path = line.slice("rename to ".length);
    if (line.startsWith("+++ ")) {
      const path = cleanDiffPath(line.slice(4));
      if (path !== "/dev/null") current.path = path;
    }
    if (line.startsWith("--- ")) {
      const path = cleanDiffPath(line.slice(4));
      if (path !== "/dev/null") current.oldPath = path;
    }
  }

  for (const file of files) {
    for (const hunk of parseDiffHunks(file.lines)) {
      for (const line of hunk.lines) {
        if (line.type === "add") file.additions += 1;
        if (line.type === "del") file.deletions += 1;
      }
    }
  }

  return files;
}
