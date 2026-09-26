import type { DiffHunk, DiffLine, DiffLineType } from "../types";

export type { DiffHunk, DiffLine, DiffLineType };

export interface FileDiff {
  added: number;
  deleted: number;
  hunks: DiffHunk[];
  truncated: boolean;
}

const CONTEXT_LINES = 3;
const MAX_DIFF_LINES = 1200;
const MAX_LCS_CELLS = 1_000_000;

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "json",
  py: "python",
  pyi: "python",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  cs: "csharp",
  sql: "sql",
  yml: "yaml",
  yaml: "yaml",
  md: "markdown",
  markdown: "markdown",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  vue: "xml",
  css: "css",
  scss: "css",
  less: "css",
  sh: "shell",
  bash: "bash",
  zsh: "shell",
  rb: "ruby",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  kts: "kotlin",
  scala: "scala",
  lua: "lua",
  pl: "perl",
  pm: "perl",
  r: "r",
  dart: "dart",
  toml: "toml",
  graphql: "graphql",
  gql: "graphql",
  svelte: "svelte",
  dockerfile: "dockerfile",
};

export function languageForFilename(filename: string): string {
  const ext = filename.includes(".") ? (filename.split(".").pop() || "").toLowerCase() : filename.toLowerCase();
  return EXTENSION_LANGUAGE_MAP[ext] || "plaintext";
}

/**
 * Applies an old_string -> new_string replacement the way native `project_edit` does,
 * so the intended diff can be previewed even when the edit command fails.
 */
export function simulateStringReplacement(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): string {
  if (!oldString) return content;
  if (replaceAll) return content.split(oldString).join(newString);
  const index = content.indexOf(oldString);
  if (index === -1) return content;
  return content.slice(0, index) + newString + content.slice(index + oldString.length);
}

export function computeFileDiff(oldContent: string, newContent: string): FileDiff {
  const oldLines = oldContent ? oldContent.split(/\r?\n/) : [];
  const newLines = newContent ? newContent.split(/\r?\n/) : [];

  let start = 0;
  let endOld = oldLines.length - 1;
  let endNew = newLines.length - 1;

  while (start <= endOld && start <= endNew && oldLines[start] === newLines[start]) {
    start++;
  }
  while (endOld >= start && endNew >= start && oldLines[endOld] === newLines[endNew]) {
    endOld--;
    endNew--;
  }

  const ops: DiffLine[] = [];
  let added = 0;
  let deleted = 0;

  const pushContext = (lineNumber: number, content: string) => {
    ops.push({ type: "context", oldNumber: lineNumber, newNumber: lineNumber, content });
  };
  const pushAdd = (lineNumber: number, content: string) => {
    ops.push({ type: "add", newNumber: lineNumber, content });
    added++;
  };
  const pushDel = (lineNumber: number, content: string) => {
    ops.push({ type: "del", oldNumber: lineNumber, content });
    deleted++;
  };

  for (let i = 0; i < start; i++) {
    pushContext(i + 1, oldLines[i]);
  }

  const N = endOld - start + 1;
  const M = endNew - start + 1;

  if (N > 0 || M > 0) {
    if (N <= 0) {
      for (let j = 0; j < M; j++) pushAdd(start + j + 1, newLines[start + j]);
    } else if (M <= 0) {
      for (let i = 0; i < N; i++) pushDel(start + i + 1, oldLines[start + i]);
    } else if (N * M > MAX_LCS_CELLS) {
      for (let i = 0; i < N; i++) pushDel(start + i + 1, oldLines[start + i]);
      for (let j = 0; j < M; j++) pushAdd(start + j + 1, newLines[start + j]);
    } else {
      const width = M + 1;
      const dp = new Uint32Array((N + 1) * width);
      for (let i = 1; i <= N; i++) {
        const oldLine = oldLines[start + i - 1];
        for (let j = 1; j <= M; j++) {
          dp[i * width + j] =
            oldLine === newLines[start + j - 1]
              ? dp[(i - 1) * width + j - 1] + 1
              : Math.max(dp[(i - 1) * width + j], dp[i * width + j - 1]);
        }
      }

      const middle: DiffLine[] = [];
      let i = N;
      let j = M;
      while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldLines[start + i - 1] === newLines[start + j - 1]) {
          middle.push({ type: "context", oldNumber: start + i, newNumber: start + j, content: oldLines[start + i - 1] });
          i--;
          j--;
        } else if (j > 0 && (i === 0 || dp[i * width + j - 1] >= dp[(i - 1) * width + j])) {
          middle.push({ type: "add", newNumber: start + j, content: newLines[start + j - 1] });
          added++;
          j--;
        } else {
          middle.push({ type: "del", oldNumber: start + i, content: oldLines[start + i - 1] });
          deleted++;
          i--;
        }
      }
      middle.reverse();
      ops.push(...middle);
    }
  }

  for (let i = endOld + 1; i < oldLines.length; i++) {
    pushContext(i + 1, oldLines[i]);
  }

  const { hunks, truncated } = buildHunks(ops);
  return { added, deleted, hunks, truncated };
}

function buildHunks(ops: DiffLine[]): { hunks: DiffHunk[]; truncated: boolean } {
  const changeIndexes: number[] = [];
  for (let idx = 0; idx < ops.length; idx++) {
    if (ops[idx].type !== "context") changeIndexes.push(idx);
  }
  if (changeIndexes.length === 0) return { hunks: [], truncated: false };

  const windows: Array<[number, number]> = [];
  for (const changeIdx of changeIndexes) {
    const windowStart = Math.max(0, changeIdx - CONTEXT_LINES);
    const windowEnd = Math.min(ops.length - 1, changeIdx + CONTEXT_LINES);
    const last = windows[windows.length - 1];
    if (last && windowStart <= last[1] + 1) {
      last[1] = Math.max(last[1], windowEnd);
    } else {
      windows.push([windowStart, windowEnd]);
    }
  }

  const hunks: DiffHunk[] = [];
  let truncated = false;
  let usedLines = 0;

  for (const [windowStart, windowEnd] of windows) {
    if (usedLines >= MAX_DIFF_LINES) {
      truncated = true;
      break;
    }
    let lines = ops.slice(windowStart, windowEnd + 1);
    if (usedLines + lines.length > MAX_DIFF_LINES) {
      lines = lines.slice(0, MAX_DIFF_LINES - usedLines);
      truncated = true;
    }
    usedLines += lines.length;

    let oldStart = 0;
    let newStart = 0;
    for (const line of lines) {
      if (line.type !== "add") {
        oldStart = line.oldNumber ?? 0;
        break;
      }
    }
    for (const line of lines) {
      if (line.type !== "del") {
        newStart = line.newNumber ?? 0;
        break;
      }
    }
    const oldLines = lines.filter((line) => line.type !== "add").length;
    const newLineCount = lines.filter((line) => line.type !== "del").length;

    hunks.push({ oldStart, oldLines: oldLines, newStart, newLines: newLineCount, lines });
  }

  return { hunks, truncated };
}

export function formatDiffHunkHeader(hunk: DiffHunk): string {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
}
