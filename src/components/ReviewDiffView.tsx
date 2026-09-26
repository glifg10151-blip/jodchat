import { useEffect, useMemo, useState } from "react";
import { FileCode2, UnfoldVertical } from "lucide-react";
import type { DiffLine } from "../types";
import { parseDiffHunks, type DiffFile } from "../utils/gitDiff";
import { highlightCode } from "../utils/highlighter";
import { languageForFilename } from "../utils/lineDiff";
import { fileNameFromPath } from "./auxiliaryPanelUtils";

type ReviewRow = { kind: "gap"; count: number; oldStart: number; newStart: number } | { kind: "line"; line: DiffLine };
const PAGE_SIZE = 500;

export function ReviewDiffView({ file }: { file: DiffFile }) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [highlightResult, setHighlightResult] = useState<{
    rows: ReviewRow[];
    html: Map<number, string>;
  } | null>(null);
  const language = languageForFilename(file.path);
  const rows = useMemo(() => {
    const result: ReviewRow[] = [];
    let oldEnd = 1;
    let newEnd = 1;
    for (const hunk of parseDiffHunks(file.lines)) {
      const omitted = Math.min(hunk.oldStart - oldEnd, hunk.newStart - newEnd);
      if (omitted > 0) result.push({ kind: "gap", count: omitted, oldStart: oldEnd, newStart: newEnd });
      for (const line of hunk.lines) result.push({ kind: "line", line });
      oldEnd = hunk.oldStart + hunk.oldLines;
      newEnd = hunk.newStart + hunk.newLines;
    }
    return result;
  }, [file.lines]);
  const lineNumberWidth = useMemo(() => {
    const lastLine = rows.reduce((largest, row) => {
      if (row.kind === "gap") return largest;
      return Math.max(largest, row.line.oldNumber ?? 0, row.line.newNumber ?? 0);
    }, 0);
    return `${Math.max(5, String(lastLine).length + 1)}ch`;
  }, [rows]);
  const visibleRows = useMemo(() => rows.slice(0, visibleCount), [rows, visibleCount]);
  const highlighted = highlightResult?.rows === visibleRows ? highlightResult.html : null;

  useEffect(() => {
    if (language === "plaintext") return;
    let cancelled = false;
    const highlight = async () => {
      const html = new Map<number, string>();
      // Load the grammar once, then yield between small batches to keep large reviews responsive.
      await highlightCode("", language);
      for (let start = 0; start < visibleRows.length && !cancelled; start += 50) {
        await Promise.all(
          visibleRows.slice(start, start + 50).map(async (row, index) => {
            if (row.kind !== "line" || !row.line.content || row.line.content.length > 2000) return;
            const result = await highlightCode(row.line.content, language);
            if (result) html.set(start + index, result);
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (!cancelled) setHighlightResult({ rows: visibleRows, html });
    };
    void highlight();
    return () => {
      cancelled = true;
    };
  }, [visibleRows, language]);

  const filename = fileNameFromPath(file.path);
  const directory = file.path.slice(0, -filename.length);
  const binary = file.lines.some((line) => line === "GIT binary patch" || line.startsWith("Binary files "));
  const oldMode = file.lines.find((line) => line.startsWith("old mode "))?.slice(9);
  const newMode = file.lines.find((line) => line.startsWith("new mode "))?.slice(9);

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={`Diff for ${file.path}`}>
      <div className="flex min-h-10 shrink-0 items-center gap-2 border-b border-border/50 bg-surface/55 px-3 py-2 text-xs">
        <FileCode2 size={14} className="shrink-0 text-accent" aria-hidden="true" />
        <div className="min-w-0 flex-1 truncate" title={file.path}>
          <span className="text-text-muted">{directory}</span>
          <span className="font-medium text-text-primary">{filename}</span>
        </div>
        <span className="shrink-0 font-mono tabular-nums">
          <span className="text-emerald-700 dark:text-emerald-400">+{file.additions}</span>{" "}
          <span className="text-rose-600 dark:text-rose-400">−{file.deletions}</span>
        </span>
        <span className="shrink-0 rounded-sm border border-border/35 bg-hover/20 px-1.5 py-0.5 text-[10px] capitalize text-text-muted">
          {file.status}
        </span>
      </div>
      {file.status === "renamed" && (
        <p className="border-b border-border/40 px-3 py-2 text-xs break-all text-text-muted">
          Renamed from {file.oldPath}
        </p>
      )}
      {oldMode && newMode && (
        <p className="border-b border-border/40 px-3 py-2 text-xs text-text-muted">
          File permissions: {oldMode} → {newMode}
        </p>
      )}
      {/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- The scrollable code region needs keyboard focus for arrow/Page keys. */}
      <div
        className="min-h-0 flex-1 overflow-auto"
        tabIndex={0}
        role="region"
        aria-label={`Code changes in ${filename}`}
      >
        {/* eslint-enable jsx-a11y/no-noninteractive-tabindex */}
        {rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-xs text-text-muted">
            {binary
              ? "Binary file changed. No text preview available."
              : file.status === "renamed"
                ? "File renamed with no text changes."
                : oldMode
                  ? "No text changes."
                  : file.status === "added"
                    ? "Empty file added."
                    : file.status === "deleted"
                      ? "Empty file deleted."
                      : "No text diff available for this file."}
          </p>
        ) : (
          <div className="min-w-max font-mono text-xs leading-6" style={{ tabSize: 4 }}>
            {visibleRows.map((row, index) => {
              if (row.kind === "gap")
                return (
                  <div
                    key={index}
                    className="flex min-h-6 items-center gap-2 bg-hover/50 pr-3 pl-[3px] font-sans text-xs text-text-muted"
                  >
                    <span
                      className="shrink-0 pr-2 text-right font-mono text-[10px] tabular-nums text-text-muted"
                      style={{ minWidth: lineNumberWidth }}
                      aria-hidden="true"
                    >
                      {row.newStart}–{row.newStart + row.count - 1}
                    </span>
                    <span className="sr-only">
                      Old lines {row.oldStart} to {row.oldStart + row.count - 1}; new lines {row.newStart} to{" "}
                      {row.newStart + row.count - 1}.
                    </span>
                    <span className="flex items-center gap-1.5">
                      <UnfoldVertical size={13} aria-hidden="true" />
                      <span>
                        {row.count} unmodified {row.count === 1 ? "line" : "lines"}
                      </span>
                    </span>
                  </div>
                );
              const { line } = row;
              const added = line.type === "add";
              const deleted = line.type === "del";
              const html = highlighted?.get(index);
              return (
                <div
                  key={index}
                  className="review-diff-line flex min-h-6 text-text-primary"
                  data-change={line.type}
                >
                  <span
                    aria-hidden="true"
                    className={`review-diff-gutter sticky left-0 flex shrink-0 select-none ${added ? "text-emerald-700 dark:text-emerald-400" : deleted ? "text-rose-600 dark:text-rose-400" : "text-text-muted"}`}
                  >
                    <span className="pr-2 text-right tabular-nums" style={{ width: lineNumberWidth }}>
                      {deleted ? line.oldNumber : line.newNumber}
                    </span>
                  </span>
                  <span className="sr-only">
                    {added ? "Added" : deleted ? "Deleted" : "Unchanged"} line {line.newNumber ?? line.oldNumber}:{" "}
                  </span>
                  {html ? (
                    <code
                      className="review-diff-code block flex-1 whitespace-pre pr-3 pl-2"
                      dangerouslySetInnerHTML={{ __html: html }}
                    />
                  ) : (
                    <code className="review-diff-code block flex-1 whitespace-pre pr-3 pl-2">
                      {line.content || " "}
                    </code>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {visibleCount < rows.length && (
          <button
            type="button"
            onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
            className="w-full border-t border-border/40 px-4 py-3 text-xs text-accent hover:bg-hover"
          >
            Show more lines ({rows.length - visibleCount} remaining)
          </button>
        )}
        {file.lines.includes("\\ No newline at end of file") && (
          <p className="border-t border-border/30 px-4 py-2 text-[11px] text-text-muted">No newline at end of file</p>
        )}
      </div>
    </section>
  );
}
