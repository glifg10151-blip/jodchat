import { invoke } from "@tauri-apps/api/core";
import { ChevronRight, File, Folder, FolderOpen, Loader2, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import { motionTokens, motionTransitions } from "../lib/motion-tokens";
import type { DiffFile } from "../utils/gitDiff";

interface TreeEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

function entriesForDirectory(parent: string, names: string[], changedFiles: DiffFile[]): TreeEntry[] {
  const entries = new Map<string, TreeEntry>();
  const add = (name: string, isDirectory: boolean) => {
    const path = parent ? `${parent}/${name}` : name;
    entries.set(path, { name, path, isDirectory });
  };
  for (const item of names) add(item.replace(/\/$/, ""), item.endsWith("/"));
  for (const file of changedFiles) {
    const remainder = parent ? file.path.startsWith(`${parent}/`) && file.path.slice(parent.length + 1) : file.path;
    if (!remainder) continue;
    const separator = remainder.indexOf("/");
    add(separator < 0 ? remainder : remainder.slice(0, separator), separator >= 0);
  }
  return [...entries.values()].sort((left, right) =>
    left.isDirectory !== right.isDirectory ? (left.isDirectory ? -1 : 1) : left.name.localeCompare(right.name),
  );
}

function ancestors(path: string): string[] {
  const pieces = path.split("/");
  return pieces.slice(1).map((_, index) => pieces.slice(0, index + 1).join("/"));
}

const statusStyles: Record<DiffFile["status"], { label: string; className: string; short: string }> = {
  added: { label: "Added", className: "border-emerald-500/70 text-emerald-600 dark:text-emerald-400", short: "+" },
  modified: { label: "Modified", className: "border-amber-500/70 text-amber-600 dark:text-amber-400", short: "M" },
  deleted: { label: "Deleted", className: "border-rose-500/70 text-rose-600 dark:text-rose-400", short: "−" },
  renamed: { label: "Renamed", className: "border-sky-500/70 text-sky-600 dark:text-sky-400", short: "R" },
};

function ChangeBadge({ status }: { status: DiffFile["status"] }) {
  const style = statusStyles[status];
  return (
    <span
      aria-hidden="true"
      title={style.label}
      className={`ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded border font-mono text-[10px] font-semibold leading-none ${style.className}`}
    >
      {style.short}
    </span>
  );
}

function TreeRow({
  entry,
  depth,
  projectId,
  runToken,
  worktreePath,
  changedFiles,
  statusByPath,
  changedDirectories,
  selectedPath,
  expanded,
  onToggle,
  onSelect,
}: {
  entry: TreeEntry;
  depth: number;
  projectId: string;
  runToken: string;
  worktreePath?: string;
  changedFiles: DiffFile[];
  statusByPath: Map<string, DiffFile["status"]>;
  changedDirectories: Set<string>;
  selectedPath: string | null;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  const [names, setNames] = useState<string[] | null>(null);
  const [error, setError] = useState(false);
  const descriptionId = useId();
  const isOpen = entry.isDirectory && expanded.has(entry.path);
  const status = statusByPath.get(entry.path);
  const hasChangedFiles = entry.isDirectory && changedDirectories.has(entry.path);

  useEffect(() => {
    if (!isOpen || !runToken || names || error) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await invoke<string[]>("project_list_dir", {
          projectId,
          runToken,
          path: entry.path,
          worktreePath: worktreePath || null,
        });
        if (!cancelled) setNames(result || []);
      } catch {
        if (!cancelled) {
          // A deleted folder is still represented by changed paths from the diff.
          setNames([]);
          setError(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry.path, error, isOpen, names, projectId, runToken, worktreePath]);

  const children = useMemo(
    () => entriesForDirectory(entry.path, names || [], changedFiles),
    [entry.path, names, changedFiles],
  );
  return (
    <>
      <button
        type="button"
        onClick={() => (entry.isDirectory ? onToggle(entry.path) : onSelect(entry.path))}
        aria-label={`${entry.isDirectory ? "Folder" : "File"} ${entry.path}`}
        aria-expanded={entry.isDirectory ? isOpen : undefined}
        aria-current={!entry.isDirectory && selectedPath === entry.path ? "true" : undefined}
        aria-describedby={status || hasChangedFiles ? descriptionId : undefined}
        title={`${entry.path}${status ? ` · ${statusStyles[status].label}` : hasChangedFiles ? " · Contains changed files" : ""}`}
        className={`mx-1 flex min-h-8 w-[calc(100%_-_0.5rem)] items-center gap-1.5 rounded-md px-2 text-left text-xs transition-colors hover:bg-hover/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${selectedPath === entry.path ? "bg-hover/70 text-text-primary" : "text-text-secondary"}`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {entry.isDirectory ? (
          isOpen && names === null && !error ? (
            <Loader2 size={12} className="shrink-0 animate-spin" aria-hidden="true" />
          ) : (
            <motion.span
              className="flex shrink-0"
              animate={{ rotate: isOpen ? 90 : 0 }}
              transition={motionTransitions.hover}
            >
              <ChevronRight size={12} aria-hidden="true" />
            </motion.span>
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {entry.isDirectory ? (
          isOpen ? (
            <FolderOpen size={13} className="shrink-0 text-accent" />
          ) : (
            <Folder size={13} className="shrink-0" />
          )
        ) : (
          <File size={13} className="shrink-0" />
        )}
        <span className="truncate">{entry.name}</span>
        {(status || hasChangedFiles) && (
          <span id={descriptionId} className="sr-only">
            {status ? `${statusStyles[status].label} file` : "Contains changed files"}
          </span>
        )}
        {hasChangedFiles && (
          <span aria-hidden="true" className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-accent/80" />
        )}
        {!entry.isDirectory && status && <ChangeBadge status={status} />}
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="children"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={motionTransitions.hover}
            className="overflow-hidden"
          >
            {error && children.length === 0 && (
              <p className="px-3 py-1 text-xs text-rose-500" role="alert">
                Couldn’t load {entry.path}
              </p>
            )}
            {children.map((child) => (
              <TreeRow
                key={child.path}
                entry={child}
                depth={depth + 1}
                projectId={projectId}
                runToken={runToken}
                worktreePath={worktreePath}
                changedFiles={changedFiles}
                statusByPath={statusByPath}
                changedDirectories={changedDirectories}
                selectedPath={selectedPath}
                expanded={expanded}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export function ReviewWorkspaceTree({
  projectId,
  conversationId,
  worktreePath,
  worktreeBranch,
  changedFiles,
  selectedPath,
  onSelect,
  visible,
  width,
  resizing = false,
}: {
  projectId: string;
  conversationId: string | null;
  worktreePath?: string;
  worktreeBranch?: string;
  changedFiles: DiffFile[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  visible: boolean;
  width: number;
  resizing?: boolean;
}) {
  const [runToken, setRunToken] = useState<string | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchPaths, setSearchPaths] = useState<string[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchDescriptionId = useId();
  const isSearching = !!query.trim();
  const scope = conversationId || `review-tree:${projectId}`;

  useEffect(() => {
    let cancelled = false;
    let acquiredToken: string | null = null;
    queueMicrotask(() => {
      setRunToken(null);
      setNames([]);
      setSearchPaths(null);
      setError(null);
      setSearchError(null);
    });
    void invoke<string>("project_browse_begin", {
      projectId,
      conversationId: scope,
      worktreePath: worktreePath || null,
      branch: worktreePath ? worktreeBranch || null : null,
    })
      .then(async (token) => {
        acquiredToken = token;
        if (cancelled) return;
        const rootNames = await invoke<string[]>("project_list_dir", {
          projectId,
          runToken: token,
          path: ".",
          worktreePath: worktreePath || null,
        });
        if (!cancelled) {
          setRunToken(token);
          setNames(rootNames);
        }
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
      if (acquiredToken) void invoke("project_run_end", { runToken: acquiredToken, conversationId: scope });
    };
  }, [projectId, scope, worktreeBranch, worktreePath]);

  useEffect(() => {
    if (!runToken || !isSearching || searchPaths || searchError) return;
    let cancelled = false;
    void (async () => {
      try {
        const paths = await invoke<string[]>("project_glob", {
          projectId,
          runToken,
          path: ".",
          pattern: "**/*",
          worktreePath: worktreePath || null,
        });
        if (!cancelled) setSearchPaths(paths || []);
      } catch (reason) {
        if (!cancelled) setSearchError(reason instanceof Error ? reason.message : String(reason));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSearching, projectId, runToken, searchError, searchPaths, worktreePath]);

  useEffect(() => {
    if (!selectedPath) return;
    const paths = ancestors(selectedPath);
    queueMicrotask(() => setExpanded((current) => new Set([...current, ...paths])));
  }, [selectedPath]);

  const entries = useMemo(() => entriesForDirectory("", names, changedFiles), [names, changedFiles]);
  const { statusByPath, changedDirectories } = useMemo(() => {
    const statusByPath = new Map<string, DiffFile["status"]>();
    const changedDirectories = new Set<string>();
    for (const file of changedFiles) {
      statusByPath.set(file.path, file.status);
      for (const directory of ancestors(file.path)) changedDirectories.add(directory);
    }
    return { statusByPath, changedDirectories };
  }, [changedFiles]);
  const searchMatches = useMemo(() => {
    if (!query.trim()) return [];
    const lower = query.trim().toLowerCase();
    return [...new Set([...(searchPaths || []), ...changedFiles.map((file) => file.path)])]
      .filter((path) => path.toLowerCase().includes(lower))
      .sort((left, right) => left.localeCompare(right));
  }, [changedFiles, query, searchPaths]);
  const toggle = (path: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <aside
      className={`w-full shrink-0 overflow-y-auto bg-chat/20 transition-[max-height,width,opacity] md:max-h-none ${
        visible
          ? "max-h-44 border-t border-border/30 opacity-100 md:w-[var(--review-file-list-width)] md:border-t-0"
          : "max-h-0 opacity-0 md:w-0"
      }`}
      aria-label="Workspace files"
      aria-hidden={!visible}
      inert={!visible}
      style={
        {
          "--review-file-list-width": `${width}px`,
          transitionDuration: resizing ? "0s" : `${motionTokens.duration.hover}s`,
        } as CSSProperties
      }
    >
      <div className="sticky top-0 z-10 border-b border-border/30 bg-chat px-3 py-2">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">Workspace files</p>
        <div className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-input/40 px-2 py-1.5 focus-within:border-accent/60">
          <Search size={12} className="shrink-0 text-text-muted" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search workspace files"
            placeholder="Filter files…"
            className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear file search"
              className="text-text-muted hover:text-text-primary"
            >
              <X size={12} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="px-3 py-2 text-xs text-rose-500" role="alert">
          Couldn’t load workspace files: {error}
        </p>
      )}
      {!runToken && !error && <p className="px-3 py-2 text-xs text-text-muted">Loading files…</p>}
      {query.trim() && searchError && (
        <p className="px-3 py-2 text-xs text-rose-500" role="alert">
          Search failed: {searchError}
        </p>
      )}
      {query.trim() && runToken && !searchPaths && !searchError && (
        <p className="px-3 py-2 text-xs text-text-muted">Searching files…</p>
      )}
      {query.trim() && searchPaths && !searchError && (
        <>
          <p className="px-3 py-1 text-[10px] text-text-muted">
            {searchMatches.length} {searchMatches.length === 1 ? "match" : "matches"}
            {searchMatches.length > 200 ? " · first 200 shown" : ""}
          </p>
          {searchMatches.slice(0, 200).map((path, index) => (
            <button
              key={path}
              type="button"
              onClick={() => onSelect(path)}
              aria-label={`File ${path}`}
              aria-current={selectedPath === path ? "true" : undefined}
              aria-describedby={statusByPath.has(path) ? `${searchDescriptionId}-${index}` : undefined}
              title={`${path}${statusByPath.has(path) ? ` · ${statusStyles[statusByPath.get(path)!].label}` : ""}`}
              className={`mx-1 flex min-h-8 w-[calc(100%_-_0.5rem)] items-center gap-1.5 rounded-md px-2 text-left text-xs transition-colors hover:bg-hover/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${selectedPath === path ? "bg-hover/70 text-text-primary" : "text-text-secondary"}`}
            >
              <File size={13} className="shrink-0" aria-hidden="true" />
              <span className="truncate">{path}</span>
              {statusByPath.has(path) && (
                <span id={`${searchDescriptionId}-${index}`} className="sr-only">
                  {statusStyles[statusByPath.get(path)!].label} file
                </span>
              )}
              {statusByPath.has(path) && <ChangeBadge status={statusByPath.get(path)!} />}
            </button>
          ))}
        </>
      )}
      {!query.trim() &&
        (runToken || changedFiles.length > 0) &&
        entries.map((entry) => (
          <TreeRow
            key={entry.path}
            entry={entry}
            depth={0}
            projectId={projectId}
            runToken={runToken || ""}
            worktreePath={worktreePath}
            changedFiles={changedFiles}
            statusByPath={statusByPath}
            changedDirectories={changedDirectories}
            selectedPath={selectedPath}
            expanded={expanded}
            onToggle={toggle}
            onSelect={onSelect}
          />
        ))}
    </aside>
  );
}
