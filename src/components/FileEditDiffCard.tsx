import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Copy } from "lucide-react";
import { motion } from "motion/react";
import type { DiffHunk, DiffLine } from "../types";
import { highlightCode } from "../utils/highlighter";
import { motionTokens, springs } from "../lib/motion-tokens";
import { formatDiffHunkHeader } from "../utils/lineDiff";

const MAX_HIGHLIGHT_LINES = 1500;

interface FileEditDiffCardProps {
  filename: string;
  added: number;
  deleted: number;
  hunks: DiffHunk[];
  language: string;
  truncated?: boolean;
  /** True when the write/edit command failed; the diff describes the intended change only. */
  failed?: boolean;
}

function DiffRow({ line, html }: { line: DiffLine; html: string | null }) {
  const isAdd = line.type === "add";
  const isDel = line.type === "del";
  const lineNumber = isAdd ? line.newNumber : isDel ? line.oldNumber : (line.newNumber ?? line.oldNumber);

  return (
    <div
      className={`flex min-w-max items-start ${
        isAdd
          ? "border-l-2 border-emerald-500/70 bg-emerald-500/[0.12]"
          : isDel
            ? "border-l-2 border-rose-500/70 bg-rose-500/[0.12]"
            : "border-l-2 border-transparent"
      }`}
    >
      <span className="w-12 shrink-0 select-none pr-2.5 text-right leading-5 text-text-muted/60 tabular-nums">
        {lineNumber ?? ""}
      </span>
      {html ? (
        <span className="flex-1 pr-4 leading-5 whitespace-pre" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <span className="flex-1 pr-4 leading-5 whitespace-pre">{line.content || " "}</span>
      )}
    </div>
  );
}

export function FileEditDiffCard({
  filename,
  added,
  deleted,
  hunks,
  language,
  truncated,
  failed,
}: FileEditDiffCardProps) {
  const [copied, setCopied] = useState(false);
  const [highlightResult, setHighlightResult] = useState<{ lines: DiffLine[]; map: Map<number, string> } | null>(null);

  const flatLines = useMemo(() => hunks.flatMap((hunk) => hunk.lines), [hunks]);

  const hunkOffsets = useMemo(() => {
    const offsets: number[] = [];
    let offset = 0;
    for (const hunk of hunks) {
      offsets.push(offset);
      offset += hunk.lines.length;
    }
    return offsets;
  }, [hunks]);

  // Ignore highlights computed for a previous set of lines while a new pass is running.
  const highlighted = highlightResult?.lines === flatLines ? highlightResult.map : null;

  useEffect(() => {
    if (language === "plaintext" || flatLines.length === 0 || flatLines.length > MAX_HIGHLIGHT_LINES) return;

    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        flatLines.map((line) => (line.content ? highlightCode(line.content, language) : Promise.resolve(null))),
      );
      if (cancelled) return;
      const map = new Map<number, string>();
      results.forEach((html, index) => {
        if (html) map.set(index, html);
      });
      setHighlightResult({ lines: flatLines, map });
    })();
    return () => {
      cancelled = true;
    };
  }, [flatLines, language]);

  const diffText = useMemo(() => {
    const parts: string[] = [];
    for (const hunk of hunks) {
      parts.push(formatDiffHunkHeader(hunk));
      for (const line of hunk.lines) {
        parts.push(`${line.type === "add" ? "+" : line.type === "del" ? "-" : " "}${line.content}`);
      }
    }
    return parts.join("\n");
  }, [hunks]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(diffText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available */
    }
  }, [diffText]);

  return (
    <div className="code-block group relative overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-1.5 select-none">
        <span className="flex min-w-0 items-center gap-2">
          {failed && <AlertTriangle size={12} className="shrink-0 text-amber-500" aria-label="Write failed" />}
          <span className={`truncate font-mono text-xs ${failed ? "text-text-muted" : "text-text-primary"}`}>
            {filename}
          </span>
          <span className="shrink-0 font-mono text-xs">
            <span className="font-medium text-emerald-600 dark:text-emerald-500">+{added}</span>{" "}
            <span className="font-medium text-rose-500 dark:text-rose-400">-{deleted}</span>
          </span>
          {truncated && <span className="shrink-0 text-[10px] text-text-muted">…</span>}
        </span>
        <motion.button
          type="button"
          onClick={handleCopy}
          className="flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-text-muted transition-colors hover:bg-hover hover:text-text-secondary"
          aria-label={copied ? "Copied" : "Copy diff"}
          whileHover={{ scale: motionTokens.scale.pop }}
          whileTap={{ scale: motionTokens.scale.press }}
          transition={springs.snappy}
        >
          {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
        </motion.button>
      </div>
      <div className="max-h-[420px] overflow-auto py-1 font-mono text-xs">
        {hunks.map((hunk, hunkIndex) => (
          <div key={hunkIndex}>
            {hunkIndex > 0 && <div className="my-1 h-2 border-y border-border/20 bg-input/30" />}
            {hunk.lines.map((line, lineIndex) => (
              <DiffRow
                key={`${hunkIndex}-${lineIndex}`}
                line={line}
                html={highlighted?.get(hunkOffsets[hunkIndex] + lineIndex) ?? null}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
