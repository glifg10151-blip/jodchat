import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { AnimatePresence, motion } from "motion/react";
import ReactMarkdown from "react-markdown";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  File,
  FileText,
  Folder,
  FolderOpen,
  Globe2,
  GitBranch,
  ExternalLink,
  Loader2,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  TerminalSquare,
  Trash2,
  X,
  Database,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { motionTokens, motionTransitions } from "../lib/motion-tokens";
import { useChatStore } from "../store/useChatStore";
import { GitStatus } from "../store/useGitStore";
import { useMcpStore } from "../store/useMcpStore";
import { useModelStore } from "../store/useModelStore";
import { useProjectStore } from "../store/useProjectStore";
import { useSearchStore } from "../store/useSearchStore";
import { AuxiliaryTab, useUIStore } from "../store/useUIStore";
import { isGenerationActive, type UrlContent } from "../types";
import { useShallow } from "zustand/react/shallow";
import { openExternalUrl } from "../utils/externalUrl";
import { formatShortcut } from "../utils/shortcutDisplay";
import ChatArea from "./ChatArea";
import InputBar from "./InputBar";
import { ReviewDiffView } from "./ReviewDiffView";
import { ReviewWorkspaceTree } from "./ReviewWorkspaceTree";
import { AuxiliaryKnowledgeTab } from "./AuxiliaryKnowledgeTab";
import { DiffFile, fileNameFromPath, joinProjectPath, languageFromPath, parseGitDiff } from "./auxiliaryPanelUtils";

interface FileTreeEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

const panelLaunchItems: Array<{
  id: AuxiliaryTab;
  label: string;
  icon: typeof ClipboardCheck;
  shortcut?: string;
}> = [
  { id: "review", label: "Review", icon: ClipboardCheck, shortcut: "Ctrl+Shift+G" },
  { id: "knowledge", label: "Knowledge", icon: Database },
  { id: "terminals", label: "Terminal", icon: TerminalSquare },
  { id: "artifacts", label: "Browser", icon: Globe2, shortcut: "Ctrl+T" },
  { id: "files", label: "Files", icon: FolderOpen, shortcut: "Ctrl+P" },
  { id: "chat", label: "Side chat", icon: MessageSquare, shortcut: "Ctrl+Alt+S" },
];

const panelTitles: Record<AuxiliaryTab, { label: string; icon: typeof ClipboardCheck }> = {
  review: { label: "Review", icon: ClipboardCheck },
  knowledge: { label: "Knowledge", icon: Database },
  terminals: { label: "Terminal", icon: TerminalSquare },
  artifacts: { label: "Browser", icon: Globe2 },
  files: { label: "Files", icon: FolderOpen },
  activity: { label: "Activity", icon: Activity },
  chat: { label: "Side chat", icon: MessageSquare },
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Something went wrong.";
}

function EmptyState({ icon: Icon, title, detail }: { icon: typeof ClipboardCheck; title: string; detail: string }) {
  return (
    <div className="m-auto flex max-w-[300px] flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-border/50 bg-hover/40 text-text-muted">
        <Icon size={18} />
      </div>
      <p className="text-sm font-medium text-text-primary">{title}</p>
      <p className="mt-1.5 text-xs leading-5 text-text-muted">{detail}</p>
    </div>
  );
}

function PanelSpinner({ label }: { label: string }) {
  return (
    <div className="m-auto flex items-center gap-2 text-xs text-text-muted">
      <Loader2 size={14} className="animate-spin text-accent" />
      {label}
    </div>
  );
}

function ReviewFilePreview({
  projectId,
  conversationId,
  path,
  worktreePath,
  worktreeBranch,
}: {
  projectId: string;
  conversationId: string | null;
  path: string;
  worktreePath?: string;
  worktreeBranch?: string;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const scope = conversationId || `review:${projectId}`;
    void (async () => {
      let token: string | undefined;
      try {
        token = await invoke<string>("project_browse_begin", {
          projectId,
          conversationId: scope,
          worktreePath: worktreePath || null,
          branch: worktreePath ? worktreeBranch || null : null,
        });
        if (cancelled) return;
        const text = await invoke<string>("project_read", {
          projectId,
          runToken: token,
          path,
          offset: 1,
          limit: 2000,
          worktreePath: worktreePath || null,
        });
        if (!cancelled) setContent(text);
      } catch (nextError) {
        if (!cancelled) setError(errorMessage(nextError));
      } finally {
        if (token) await invoke("project_run_end", { runToken: token, conversationId: scope }).catch(() => {});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, conversationId, path, worktreePath, worktreeBranch]);
  return (
    <section className="min-h-0 flex-1 overflow-auto p-4" aria-label={`Review ${path}`}>
      <h3 className="mb-3 break-all font-mono text-xs">{path}</h3>
      {error ? (
        <p role="alert" className="text-sm text-text-muted">
          Unable to open this file: {error}
        </p>
      ) : content === null ? (
        <PanelSpinner label="Loading file…" />
      ) : (
        <>
          <p className="mb-3 text-xs text-text-muted">File preview · first 2,000 lines</p>
          <pre className="whitespace-pre-wrap break-words font-mono text-xs">{content}</pre>
        </>
      )}
    </section>
  );
}

function ReviewPane({
  projectId,
  worktreePath,
  worktreeBranch,
  conversationId,
}: {
  projectId: string | null;
  worktreePath?: string;
  worktreeBranch?: string;
  conversationId: string | null;
}) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [files, setFiles] = useState<DiffFile[]>([]);
  const selectedPath = useUIStore((state) => state.activeReviewFilePath);
  const setSelectedPath = useUIStore((state) => state.setActiveReviewFilePath);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<"publish" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileListVisible, setFileListVisible] = useState(true);
  const [fileListWidth, setFileListWidth] = useState(280);
  const [fileListResizing, setFileListResizing] = useState(false);
  const reviewContentRef = useRef<HTMLDivElement>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const publishPendingWorktree = useChatStore((s) => s.publishPendingWorktree);
  const discardPendingWorktree = useChatStore((s) => s.discardPendingWorktree);
  const isConversationWorking = useChatStore((state) => {
    if (!conversationId) return false;
    return (
      isGenerationActive(state.generationByConversation[conversationId]?.state) ||
      state.conversations.some(
        (conversation) => conversation.parentId === conversationId && conversation.status === "running",
      )
    );
  });

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const [nextStatus, diff] = await Promise.all([
        invoke<GitStatus>("git_get_status", { projectId, worktreePath: worktreePath || null }),
        invoke<string>("git_diff_changes", {
          projectId,
          worktreePath: worktreePath || null,
          files: null,
          runToken: null,
        }),
      ]);
      const parsed = parseGitDiff(diff);
      const parsedPaths = new Set(parsed.flatMap((file) => [file.path, file.oldPath]));
      const statusOnlyFiles = [...new Set([...nextStatus.stagedFiles, ...nextStatus.unstagedFiles])]
        .filter((path) => !path.endsWith("/"))
        .filter((path) => !parsedPaths.has(path))
        .map<DiffFile>((path) => ({
          path,
          oldPath: path,
          status: "modified",
          additions: 0,
          deletions: 0,
          lines: [`diff --git a/${path} b/${path}`, "Diff preview is unavailable for this untracked or binary file."],
        }));
      parsed.push(...statusOnlyFiles);
      setStatus(nextStatus);
      setFiles(parsed);
      const requestedPath = useUIStore.getState().activeReviewFilePath;
      setSelectedPath(requestedPath || parsed[0]?.path || null);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }, [projectId, setSelectedPath, worktreePath]);

  useEffect(() => {
    queueMicrotask(() => void refresh());
  }, [refresh]);

  const selectedFile = selectedPath ? files.find((file) => file.path === selectedPath) : files[0];
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);
  const clampFileListWidth = useCallback((width: number) => {
    const containerWidth = reviewContentRef.current?.getBoundingClientRect().width || 900;
    return Math.max(180, Math.min(width, Math.min(560, containerWidth - 220)));
  }, []);

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  const startFileListResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizeCleanupRef.current?.();
    setFileListResizing(true);
    const onMove = (moveEvent: PointerEvent) => {
      const right = reviewContentRef.current?.getBoundingClientRect().right;
      if (right !== undefined) setFileListWidth(clampFileListWidth(right - moveEvent.clientX));
    };
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      resizeCleanupRef.current = null;
      setFileListResizing(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    resizeCleanupRef.current = stop;
  };

  const resizeFileListWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    if (event.key === "Home") setFileListWidth(clampFileListWidth(180));
    else if (event.key === "End") setFileListWidth(clampFileListWidth(560));
    else setFileListWidth((current) => clampFileListWidth(current + (event.key === "ArrowLeft" ? 20 : -20)));
  };

  const resolveWorktree = async (action: "publish" | "discard") => {
    if (!conversationId) return;
    setActionLoading(action);
    try {
      if (action === "publish") await publishPendingWorktree(conversationId);
      else await discardPendingWorktree(conversationId);
      setFiles([]);
      setStatus(null);
    } finally {
      setActionLoading(null);
    }
  };

  if (!projectId) {
    return (
      <EmptyState
        icon={Folder}
        title="No project selected"
        detail="Choose a project from the left sidebar to review workspace changes."
      />
    );
  }
  if (loading && !status) return <PanelSpinner label="Loading workspace changes…" />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border/30 bg-surface/20 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium text-text-primary">
              <GitBranch size={13} className="text-text-muted" />
              <span className="truncate">{status?.branch || "Workspace changes"}</span>
              {worktreePath && (
                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent">
                  Isolated
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-text-muted">
              {files.length} {files.length === 1 ? "file" : "files"} changed
              <span className="ml-2 text-emerald-500">+{additions}</span>
              <span className="ml-1.5 text-red-400">−{deletions}</span>
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setFileListVisible((current) => !current)}
              aria-label={fileListVisible ? "Hide file list" : "Show file list"}
              title={fileListVisible ? "Hide file list" : "Show file list"}
              className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
            >
              {fileListVisible ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
            </button>
            <button
              onClick={() => void refresh()}
              disabled={loading}
              className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
              title="Refresh changes"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
        {worktreePath &&
          conversationId &&
          (isConversationWorking ? (
            <p className="mt-3 text-[11px] text-text-muted" role="status">
              Live agent changes are isolated until the run finishes.
            </p>
          ) : (
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => void resolveWorktree("discard")}
                disabled={!!actionLoading}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
              >
                {actionLoading === "discard" ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                Discard
              </button>
              <button
                onClick={() => void resolveWorktree("publish")}
                disabled={!!actionLoading}
                className="flex flex-[1.4] items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent-active disabled:opacity-50"
              >
                {actionLoading === "publish" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                Publish changes
              </button>
            </div>
          ))}
      </div>

      <div ref={reviewContentRef} className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-chat/45">
          {selectedPath && !selectedFile ? (
            <ReviewFilePreview
              key={`${projectId}:${selectedPath}:${worktreePath || ""}`}
              projectId={projectId}
              conversationId={conversationId}
              path={selectedPath}
              worktreePath={worktreePath}
              worktreeBranch={worktreeBranch}
            />
          ) : error ? (
            <EmptyState icon={AlertCircle} title="Couldn’t load changes" detail={error} />
          ) : selectedFile ? (
            <ReviewDiffView key={selectedFile.path} file={selectedFile} />
          ) : (
            <EmptyState
              icon={ShieldCheck}
              title="Workspace is clean"
              detail="There are no staged or unstaged changes to review."
            />
          )}
        </div>
        {/* The keyboard focusable separator follows the ARIA window splitter pattern. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div
          role="separator"
          aria-label="Resize file list"
          aria-orientation="vertical"
          aria-valuemin={180}
          aria-valuemax={560}
          aria-valuenow={fileListWidth}
          aria-hidden={!fileListVisible}
          tabIndex={fileListVisible ? 0 : -1}
          onPointerDown={fileListVisible ? startFileListResize : undefined}
          onKeyDown={fileListVisible ? resizeFileListWithKeyboard : undefined}
          className={`relative hidden shrink-0 cursor-col-resize focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus before:absolute before:inset-y-0 before:-left-1 before:w-3 after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-border/35 after:transition-[opacity,background-color] hover:after:bg-accent/55 focus-visible:after:bg-accent/70 md:block ${
            fileListVisible ? "w-px after:opacity-100" : "w-0 pointer-events-none after:opacity-0"
          }`}
          style={{ transition: `width ${motionTokens.duration.hover}s` }}
        />
        <ReviewWorkspaceTree
          projectId={projectId}
          conversationId={conversationId}
          worktreePath={worktreePath}
          worktreeBranch={worktreeBranch}
          changedFiles={files}
          selectedPath={selectedPath}
          onSelect={setSelectedPath}
          visible={fileListVisible}
          width={fileListWidth}
          resizing={fileListResizing}
        />
      </div>
    </div>
  );
}

function FileTreeRow({
  entry,
  depth,
  projectId,
  runToken,
  worktreePath,
  expanded,
  onToggle,
  onSelect,
  selectedPath,
}: {
  entry: FileTreeEntry;
  depth: number;
  projectId: string;
  runToken: string;
  worktreePath?: string;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  selectedPath: string | null;
}) {
  const [children, setChildren] = useState<FileTreeEntry[] | null>(null);
  const isOpen = expanded.has(entry.path);
  const loading = entry.isDirectory && isOpen && children === null;

  useEffect(() => {
    if (!entry.isDirectory || !isOpen || children) return;
    invoke<string[]>("project_list_dir", {
      projectId,
      runToken,
      path: entry.path,
      worktreePath: worktreePath || null,
    })
      .then((items) =>
        setChildren(
          items.map((name) => ({
            name: name.replace(/\/$/, ""),
            path: joinProjectPath(entry.path, name.replace(/\/$/, "")),
            isDirectory: name.endsWith("/"),
          })),
        ),
      )
      .catch(() => setChildren([]));
  }, [children, entry.isDirectory, entry.path, isOpen, projectId, runToken, worktreePath]);

  return (
    <>
      <button
        onClick={() => (entry.isDirectory ? onToggle(entry.path) : onSelect(entry.path))}
        className={`flex w-full items-center gap-1.5 py-1 pr-2 text-left text-xs transition-colors hover:bg-hover/70 ${selectedPath === entry.path ? "bg-accent/10 text-text-primary" : "text-text-secondary"}`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {entry.isDirectory ? (
          loading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <motion.span
              className="flex shrink-0"
              animate={{ rotate: isOpen ? 90 : 0 }}
              transition={motionTransitions.hover}
            >
              <ChevronRight size={12} />
            </motion.span>
          )
        ) : (
          <span className="w-3" />
        )}
        {entry.isDirectory ? (
          isOpen ? (
            <FolderOpen size={13} className="shrink-0 text-accent" />
          ) : (
            <Folder size={13} className="shrink-0 text-text-muted" />
          )
        ) : (
          <File size={13} className="shrink-0 text-text-muted" />
        )}
        <span className="truncate">{entry.name}</span>
      </button>
      <AnimatePresence initial={false}>
        {entry.isDirectory && isOpen && (
          <motion.div
            key="children"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={motionTransitions.hover}
            className="overflow-hidden"
          >
            {children?.map((child) => (
              <FileTreeRow
                key={child.path}
                entry={child}
                depth={depth + 1}
                projectId={projectId}
                runToken={runToken}
                worktreePath={worktreePath}
                expanded={expanded}
                onToggle={onToggle}
                onSelect={onSelect}
                selectedPath={selectedPath}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function FilesPane({
  projectId,
  conversationId,
  worktreePath,
  worktreeBranch,
}: {
  projectId: string | null;
  conversationId: string | null;
  worktreePath?: string;
  worktreeBranch?: string;
}) {
  const [entries, setEntries] = useState<FileTreeEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runToken, setRunToken] = useState<string | null>(null);
  const browserConversationId = conversationId || (projectId ? `auxiliary-files:${projectId}` : null);

  useEffect(() => {
    if (!projectId || !browserConversationId) {
      queueMicrotask(() => setRunToken(null));
      return;
    }

    let cancelled = false;
    let acquiredToken: string | null = null;
    queueMicrotask(() => {
      setRunToken(null);
      setEntries([]);
      setError(null);
    });

    void invoke<string>("project_browse_begin", {
      projectId,
      conversationId: browserConversationId,
      worktreePath: worktreePath || null,
      branch: worktreePath ? worktreeBranch || null : null,
    })
      .then((token) => {
        acquiredToken = token;
        if (cancelled) {
          void invoke("project_run_end", {
            runToken: token,
            conversationId: browserConversationId,
          });
        } else {
          setRunToken(token);
        }
      })
      .catch((nextError) => {
        if (!cancelled) setError(errorMessage(nextError));
      });

    return () => {
      cancelled = true;
      if (acquiredToken) {
        void invoke("project_run_end", {
          runToken: acquiredToken,
          conversationId: browserConversationId,
        });
      }
    };
  }, [browserConversationId, projectId, worktreeBranch, worktreePath]);

  const loadRoot = useCallback(async () => {
    if (!projectId || !runToken) return;
    setLoading(true);
    setError(null);
    try {
      const items = await invoke<string[]>("project_list_dir", {
        projectId,
        runToken,
        path: ".",
        worktreePath: worktreePath || null,
      });
      setEntries(
        items.map((name) => ({
          name: name.replace(/\/$/, ""),
          path: name.replace(/\/$/, ""),
          isDirectory: name.endsWith("/"),
        })),
      );
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }, [projectId, runToken, worktreePath]);

  useEffect(() => {
    queueMicrotask(() => {
      setExpanded(new Set());
      setSelectedPath(null);
      setContent("");
      void loadRoot();
    });
  }, [loadRoot]);

  const selectFile = async (path: string) => {
    if (!projectId || !runToken) return;
    setSelectedPath(path);
    setContent("");
    setLoading(true);
    try {
      setContent(
        await invoke<string>("project_read", {
          projectId,
          runToken,
          path,
          offset: 1,
          limit: 2000,
          worktreePath: worktreePath || null,
        }),
      );
    } catch (nextError) {
      setContent(`Unable to open this file.\n\n${errorMessage(nextError)}`);
    } finally {
      setLoading(false);
    }
  };

  if (!projectId)
    return (
      <EmptyState
        icon={Folder}
        title="No project selected"
        detail="Choose a project to browse its files in this panel."
      />
    );
  const filteredEntries = entries.filter((entry) => !query || entry.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/40 px-4 text-xs text-text-muted">
        <span className="font-mono">/</span>
        <span className="truncate">{selectedPath || "Workspace"}</span>
        <button
          onClick={() => void loadRoot()}
          className="ml-auto rounded-md p-1.5 text-text-muted hover:bg-hover hover:text-text-primary"
          title="Refresh files"
        >
          <RefreshCw size={13} />
        </button>
      </div>
      {error ? (
        <EmptyState icon={AlertCircle} title="Couldn’t browse project" detail={error} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="order-2 flex max-h-[42%] min-h-0 w-full shrink-0 flex-col border-t border-border/40 md:max-h-none md:w-[30%] md:min-w-[220px] md:border-l md:border-t-0">
            <div className="flex shrink-0 items-center gap-2 p-2">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/50 bg-input/40 px-2.5 py-1.5 focus-within:border-accent/60">
                <Search size={12} className="text-text-muted" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter files…"
                  className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted"
                />
                {query && (
                  <button onClick={() => setQuery("")} className="text-text-muted hover:text-text-primary">
                    <X size={11} />
                  </button>
                )}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {loading && entries.length === 0 ? (
                <PanelSpinner label="Loading files…" />
              ) : (
                runToken &&
                filteredEntries.map((entry) => (
                  <FileTreeRow
                    key={entry.path}
                    entry={entry}
                    depth={0}
                    projectId={projectId}
                    runToken={runToken}
                    worktreePath={worktreePath}
                    expanded={expanded}
                    onToggle={(path) =>
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (next.has(path)) next.delete(path);
                        else next.add(path);
                        return next;
                      })
                    }
                    onSelect={(path) => void selectFile(path)}
                    selectedPath={selectedPath}
                  />
                ))
              )}
            </div>
          </div>
          <div className="order-1 flex min-h-0 min-w-0 flex-1 flex-col bg-chat/40">
            {selectedPath ? (
              <>
                <div className="flex shrink-0 items-center justify-between border-b border-border/40 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText size={12} className="text-text-muted" />
                    <span className="truncate font-mono text-[11px] text-text-primary">
                      {fileNameFromPath(selectedPath)}
                    </span>
                  </div>
                  <span className="text-[9px] font-medium uppercase tracking-wider text-text-muted">
                    {languageFromPath(selectedPath)}
                  </span>
                </div>
                <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] leading-5 text-text-secondary selection:bg-accent/30">
                  <code>{loading && !content ? "Loading…" : content}</code>
                </pre>
              </>
            ) : (
              <EmptyState
                icon={FileText}
                title="Open a file"
                detail="Select a file from the project tree to inspect its contents."
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function TerminalPane({
  projectId,
  projectPath,
  worktreePath,
}: {
  projectId: string | null;
  projectPath?: string;
  worktreePath?: string;
}) {
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cwd = worktreePath || projectPath;

  useEffect(() => {
    if (!projectId || !cwd || !terminalContainerRef.current) return;

    const sessionId = crypto.randomUUID();
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily:
        '"MesloLGS NF", "JetBrainsMono Nerd Font Mono", "Hack Nerd Font Mono", "SFMono-Regular", "Cascadia Code", "Liberation Mono", "Sythoria Nerd Symbols", monospace',
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 10_000,
      screenReaderMode: true,
      theme: {
        background: "#0b0d10",
        foreground: "#d1d5db",
        cursor: "#e5e7eb",
        selectionBackground: "#2563eb66",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalContainerRef.current);

    let disposed = false;
    let started = false;
    let writeQueue = Promise.resolve();
    let unlistenOutput: UnlistenFn | undefined;
    let unlistenExit: UnlistenFn | undefined;
    const fit = () => {
      if (disposed) return;
      try {
        fitAddon.fit();
        if (started) {
          void invoke("terminal_resize", { sessionId, cols: terminal.cols, rows: terminal.rows }).catch(() => {});
        }
      } catch {
        // The panel can briefly have zero dimensions while its tab animates in.
      }
    };
    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(terminalContainerRef.current);
    requestAnimationFrame(fit);

    const inputDisposable = terminal.onData((data) => {
      if (!started) return;
      writeQueue = writeQueue.then(() => invoke<void>("terminal_write", { sessionId, data })).catch(() => {});
    });

    const start = async () => {
      try {
        [unlistenOutput, unlistenExit] = await Promise.all([
          listen<{ sessionId: string; data: number[] }>("terminal-output", (event) => {
            if (event.payload.sessionId === sessionId) terminal.write(new Uint8Array(event.payload.data));
          }),
          listen<{ sessionId: string; exitCode: number; signal?: string }>("terminal-exit", (event) => {
            if (event.payload.sessionId !== sessionId) return;
            started = false;
            const reason = event.payload.signal ? `signal ${event.payload.signal}` : `code ${event.payload.exitCode}`;
            terminal.write(`\r\n\x1b[90m[Shell exited with ${reason}]\x1b[0m\r\n`);
          }),
        ]);
        if (disposed) {
          unlistenOutput?.();
          unlistenExit?.();
          return;
        }
        await invoke("terminal_start", {
          sessionId,
          projectId,
          worktreePath: worktreePath || null,
          cols: terminal.cols,
          rows: terminal.rows,
        });
        if (disposed) {
          await invoke("terminal_stop", { sessionId }).catch(() => {});
          return;
        }
        started = true;
        setError(null);
        fit();
        terminal.focus();
      } catch (nextError) {
        if (!disposed) setError(errorMessage(nextError));
      }
    };
    void start();

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      inputDisposable.dispose();
      unlistenOutput?.();
      unlistenExit?.();
      if (started) {
        void writeQueue.then(() => invoke("terminal_stop", { sessionId })).catch(() => {});
      }
      terminal.dispose();
    };
  }, [cwd, projectId, worktreePath]);

  if (!projectId || !cwd)
    return (
      <EmptyState
        icon={TerminalSquare}
        title="No project terminal"
        detail="Select a project to run commands in its workspace."
      />
    );

  return (
    <div className="relative h-full min-h-0 bg-[#0b0d10]">
      <div ref={terminalContainerRef} aria-label="Project terminal" className="h-full min-h-0 p-2" />
      {error && (
        <div
          role="alert"
          className="absolute inset-x-3 top-3 rounded-md border border-red-500/30 bg-red-950/95 p-3 text-xs text-red-200"
        >
          {error}
        </div>
      )}
    </div>
  );
}

function ActivityPane({ activeId }: { activeId: string | null }) {
  const conversations = useChatStore((s) => s.conversations);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const setActiveSubagentId = useUIStore((s) => s.setActiveSubagentId);
  const tasks = useUIStore((s) => s.backgroundTasks);
  const clearTasks = useUIStore((s) => s.clearTasks);
  const subagents = conversations.filter(
    (conversation) => conversation.isSubagent && conversation.parentId === activeId,
  );

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Agents</h3>
        <span className="text-[10px] text-text-muted">{subagents.length}</span>
      </div>
      <div className="space-y-2">
        {subagents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/50 px-4 py-6 text-center text-xs text-text-muted">
            No subagents in this task.
          </div>
        ) : (
          subagents.map((agent) => (
            <div
              key={agent.id}
              onClick={() => setActiveSubagentId(agent.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setActiveSubagentId(agent.id);
                }
              }}
              role="button"
              tabIndex={0}
              className="flex w-full items-center gap-3 rounded-xl border border-border/40 bg-surface/40 p-3 text-left transition-colors hover:bg-hover/60"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <Bot size={15} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-text-primary">{agent.role || agent.title}</p>
                <p className="mt-0.5 text-[10px] capitalize text-text-muted">{agent.status || "idle"}</p>
              </div>
              {agent.status === "running" ? (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    stopStreaming(agent.id);
                  }}
                  className="rounded p-1.5 text-red-400 hover:bg-red-500/10"
                  title="Stop agent"
                >
                  <Square size={11} />
                </button>
              ) : agent.status === "error" ? (
                <AlertCircle size={14} className="text-red-400" />
              ) : (
                <CheckCircle2 size={14} className="text-emerald-500" />
              )}
            </div>
          ))
        )}
      </div>
      <div className="mb-3 mt-6 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Task history</h3>
        {tasks.length > 0 && (
          <button onClick={clearTasks} className="text-[10px] text-text-muted hover:text-text-primary">
            Clear
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {tasks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/50 px-4 py-6 text-center text-xs text-text-muted">
            No background activity yet.
          </div>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className="flex items-center gap-2.5 rounded-lg border border-border/30 px-3 py-2.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${task.status === "running" ? "animate-pulse bg-accent" : task.status === "error" ? "bg-red-500" : "bg-emerald-500"}`}
              />
              <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">{task.title}</span>
              <span className="text-[9px] capitalize text-text-muted">{task.status}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ArtifactPane() {
  const artifact = useUIStore((s) => s.activeArtifact);
  const setArtifact = useUIStore((s) => s.setActiveArtifact);
  const [allowNetwork, setAllowNetwork] = useState(false);
  if (!artifact)
    return (
      <EmptyState
        icon={Sparkles}
        title="Nothing to preview"
        detail="HTML, SVG, and generated artifacts can be opened here without leaving the task."
      />
    );
  const csp = allowNetwork
    ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: http: https:; connect-src http: https: ws: wss:;"
    : "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:;";
  const srcDoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><style>body{margin:0;padding:16px;font-family:system-ui;background:#fff;color:#111}</style></head><body>${artifact.content}</body></html>`;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
        <span className="truncate text-xs font-medium text-text-primary">{artifact.title}</span>
        <div className="flex items-center gap-2">
          {artifact.type !== "mermaid" && (
            <label className="flex items-center gap-1.5 text-[10px] text-text-muted">
              <input
                type="checkbox"
                checked={allowNetwork}
                onChange={(event) => setAllowNetwork(event.target.checked)}
                className="accent-accent"
              />
              Network
            </label>
          )}
          <button
            onClick={() => setArtifact(null)}
            className="rounded p-1 text-text-muted hover:bg-hover hover:text-text-primary"
          >
            <X size={12} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 bg-[#111318] p-2">
        {artifact.type === "html" || artifact.type === "svg" ? (
          <iframe
            title={artifact.title}
            srcDoc={srcDoc}
            sandbox="allow-scripts"
            className="h-full w-full rounded-lg border-0 bg-white"
          />
        ) : (
          <pre className="h-full overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 p-3 font-mono text-xs text-gray-300">
            {artifact.content}
          </pre>
        )}
      </div>
    </div>
  );
}

function normalizeBrowserUrl(value: string): string | null {
  const input = value.trim();
  if (!input) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function BrowserPane() {
  const artifact = useUIStore((state) => state.activeArtifact);
  const fetchUrlContent = useSearchStore((state) => state.fetchUrlContent);
  const [draftUrl, setDraftUrl] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [page, setPage] = useState<UrlContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentUrl = historyIndex >= 0 ? history[historyIndex] : "";

  const fetchPage = useCallback(
    async (url: string) => {
      setLoading(true);
      setError(null);
      try {
        const nextPage = await fetchUrlContent(url, "markdown");
        setPage(nextPage);
        if (nextPage.status === "error") setError(nextPage.error || "This page could not be loaded.");
      } catch (nextError) {
        setPage(null);
        setError(errorMessage(nextError));
      } finally {
        setLoading(false);
      }
    },
    [fetchUrlContent],
  );

  const navigate = useCallback(
    (value: string) => {
      const url = normalizeBrowserUrl(value);
      if (!url) {
        setError("Enter a valid HTTP or HTTPS URL.");
        return;
      }
      const nextHistory = [...history.slice(0, historyIndex + 1), url];
      setHistory(nextHistory);
      setHistoryIndex(nextHistory.length - 1);
      setDraftUrl(url);
      void fetchPage(url);
    },
    [fetchPage, history, historyIndex],
  );

  const moveHistory = (nextIndex: number) => {
    const url = history[nextIndex];
    if (!url) return;
    setHistoryIndex(nextIndex);
    setDraftUrl(url);
    void fetchPage(url);
  };

  if (artifact) return <ArtifactPane />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          navigate(draftUrl);
        }}
        className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border/40 px-3"
      >
        <button
          type="button"
          onClick={() => moveHistory(historyIndex - 1)}
          disabled={historyIndex <= 0}
          className="rounded-md p-1.5 text-text-muted hover:bg-hover hover:text-text-primary disabled:opacity-30"
          aria-label="Back"
        >
          <ArrowLeft size={14} />
        </button>
        <button
          type="button"
          onClick={() => moveHistory(historyIndex + 1)}
          disabled={historyIndex < 0 || historyIndex >= history.length - 1}
          className="rounded-md p-1.5 text-text-muted hover:bg-hover hover:text-text-primary disabled:opacity-30"
          aria-label="Forward"
        >
          <ArrowRight size={14} />
        </button>
        <button
          type="button"
          onClick={() => currentUrl && void fetchPage(currentUrl)}
          disabled={!currentUrl || loading}
          className="rounded-md p-1.5 text-text-muted hover:bg-hover hover:text-text-primary disabled:opacity-30"
          aria-label="Reload"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
        <div className="mx-1 flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/50 bg-input/40 px-2.5 py-1.5 focus-within:border-accent/60">
          <Globe2 size={12} className="shrink-0 text-text-muted" />
          <input
            value={draftUrl}
            onChange={(event) => setDraftUrl(event.target.value)}
            placeholder="Enter a URL"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted"
          />
        </div>
        <button
          type="submit"
          className="rounded-md p-1.5 text-text-muted hover:bg-hover hover:text-text-primary"
          aria-label="Open URL"
        >
          <ArrowRight size={14} />
        </button>
        <button
          type="button"
          disabled={!currentUrl}
          onClick={() => currentUrl && void openExternalUrl(currentUrl, { confirmInsecure: true })}
          className="rounded-md p-1.5 text-text-muted hover:bg-hover hover:text-text-primary disabled:opacity-30"
          aria-label="Open in system browser"
          title="Open in system browser"
        >
          <ExternalLink size={13} />
        </button>
      </form>
      <div className="relative min-h-0 flex-1 overflow-auto">
        {loading && !page ? (
          <PanelSpinner label="Loading page…" />
        ) : !currentUrl ? (
          <EmptyState icon={Globe2} title="Start browsing" detail="Enter a URL to open a page." />
        ) : error ? (
          <EmptyState icon={AlertCircle} title="Couldn’t open page" detail={error} />
        ) : page ? (
          <article className="markdown-body mx-auto w-full max-w-4xl px-6 py-8 text-sm text-text-primary">
            {page.title && <h1>{page.title}</h1>}
            <ReactMarkdown
              components={{
                a: ({ href, children }) => (
                  <a
                    href={href}
                    onClick={(event) => {
                      event.preventDefault();
                      if (!href) return;
                      try {
                        navigate(new URL(href, currentUrl).href);
                      } catch {
                        setError("This link is not a valid web address.");
                      }
                    }}
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {page.content}
            </ReactMarkdown>
          </article>
        ) : null}
      </div>
    </div>
  );
}

function SideChatPane({ conversationId }: { conversationId: string | null }) {
  const conversation = useChatStore((state) =>
    state.conversations.find((candidate) => candidate.id === conversationId),
  );
  const sendMessage = useChatStore((state) => state.sendMessage);
  const retryLastMessage = useChatStore((state) => state.retryLastMessage);
  const stopStreaming = useChatStore((state) => state.stopStreaming);
  const generation = useChatStore((state) =>
    conversationId ? state.generationByConversation[conversationId] : undefined,
  );
  const { models, selectedModel, modelStatuses } = useModelStore(
    useShallow((state) => ({
      models: state.models,
      selectedModel: state.selectedModel,
      modelStatuses: state.modelStatuses,
    })),
  );
  const { activeSearchId } = useSearchStore(
    useShallow((state) => ({
      activeSearchId: state.activeSearchId,
    })),
  );
  const { mcpConfigs, serverStatuses } = useMcpStore(
    useShallow((state) => ({
      mcpConfigs: state.mcpConfigs,
      serverStatuses: state.serverStatuses,
    })),
  );
  const isStreaming = isGenerationActive(generation?.state);
  const messages = conversation?.messages || [];

  const setConversationModel = (modelId: string) => {
    if (!conversationId || isStreaming) return;
    useChatStore.setState((state) => ({
      conversations: state.conversations.map((item) =>
        item.id === conversationId ? { ...item, model: modelId } : item,
      ),
    }));
  };

  if (!conversationId || !conversation) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="Side chat unavailable"
        detail="Close and reopen the Side chat tab to start a new temporary conversation."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1">
        {messages.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="Side chat"
            detail="This conversation is temporary and disappears when you close the app."
          />
        ) : (
          <ChatArea
            messages={messages}
            conversationId={conversationId}
            onRetry={(messageId) => void retryLastMessage(conversationId, messageId)}
          />
        )}
      </div>
      <InputBar
        models={models}
        onSend={(message, attachments, mcpServerIds, searchConfigId) =>
          sendMessage(message, attachments, conversationId, mcpServerIds, searchConfigId)
        }
        selectedModel={conversation.model || selectedModel}
        onModelChange={setConversationModel}
        disabled={models.length === 0}
        modelStatuses={modelStatuses}
        searchConfigId={activeSearchId}
        mcpServers={mcpConfigs}
        mcpServerStatuses={serverStatuses}
        isStreaming={isStreaming}
        onStop={() => void stopStreaming(conversationId)}
        centered={false}
        conversationId={conversationId}
        idPrefix="side-chat"
        isolatedAttachments
      />
    </div>
  );
}

export function AuxiliaryPanel() {
  const activeTab = useUIStore((s) => s.activeAuxTab);
  const openTabs = useUIStore((s) => s.openAuxTabs);
  const setActiveTab = useUIStore((s) => s.setActiveAuxTab);
  const closeTab = useUIStore((s) => s.closeAuxTab);
  const setOpen = useUIStore((s) => s.setAuxPanelOpen);
  const activeArtifact = useUIStore((s) => s.activeArtifact);
  const activeAuxConversationId = useUIStore((s) => s.activeAuxConversationId);
  const sideChatConversationId = useUIStore((s) => s.sideChatConversationId);
  const setSideChatConversationId = useUIStore((s) => s.setSideChatConversationId);
  const currentActiveId = useChatStore((s) => s.activeId);
  const newSideChat = useChatStore((s) => s.newSideChat);
  const sideChatExists = useChatStore((s) =>
    s.conversations.some((conversation) => conversation.id === sideChatConversationId),
  );
  const activeConversation = useChatStore(
    (s) =>
      s.conversations.find((conversation) => conversation.id === activeAuxConversationId) ??
      s.conversations.find((conversation) => conversation.id === s.activeId),
  );
  const activeId = activeConversation?.id ?? currentActiveId;
  const { activeProjectId, projects, activeWorktreePath, activeWorktreeBranch } = useProjectStore(
    useShallow((state) => ({
      activeProjectId: state.activeProjectId,
      projects: state.projects,
      activeWorktreePath: state.activeWorktreePath,
      activeWorktreeBranch: state.activeWorktreeBranch,
    })),
  );
  const projectId =
    activeConversation?.pendingWorktree?.commitScope?.projectId || activeConversation?.projectId || activeProjectId;
  const project = projects.find((item) => item.id === projectId);
  const worktreePath = activeConversation?.pendingWorktree?.path || activeWorktreePath || undefined;
  const worktreeBranch = activeConversation?.pendingWorktree?.branch || activeWorktreeBranch || undefined;
  const displayedTabs = activeTab && !openTabs.includes(activeTab) ? [...openTabs, activeTab] : openTabs;

  useEffect(() => {
    if (activeTab !== "chat" || (sideChatConversationId && sideChatExists)) return;
    const conversationId = newSideChat();
    if (conversationId) setSideChatConversationId(conversationId);
  }, [activeTab, newSideChat, setSideChatConversationId, sideChatConversationId, sideChatExists]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (activeTab) setActiveTab(null);
        else setOpen(false);
        return;
      }

      const commandKey = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (commandKey && event.shiftKey && key === "g") {
        event.preventDefault();
        setActiveTab("review");
      } else if (commandKey && !event.shiftKey && !event.altKey && key === "t") {
        event.preventDefault();
        setActiveTab("artifacts");
      } else if (commandKey && !event.shiftKey && !event.altKey && key === "p") {
        event.preventDefault();
        setActiveTab("files");
      } else if (commandKey && event.altKey && key === "s") {
        event.preventDefault();
        setActiveTab("chat");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTab, setActiveTab, setOpen]);

  const openPanel = (id: AuxiliaryTab) => setActiveTab(id);

  return (
    <section className="flex h-full min-h-0 flex-col bg-chat" aria-label="Workspace panel">
      {displayedTabs.length > 0 && (
        <header className="flex h-10 shrink-0 items-center gap-1 border-b border-border/40 px-2">
          <div
            className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto"
            role="tablist"
            aria-label="Workspace tabs"
          >
            {displayedTabs.map((tab) => {
              const panel = panelTitles[tab];
              const PanelIcon = panel.icon;
              const isActive = activeTab === tab;

              return (
                <div
                  key={tab}
                  className={`flex h-7 shrink-0 items-center rounded-xl pl-0.5 pr-1 transition-colors ${
                    isActive ? "bg-hover/80" : "hover:bg-hover/40"
                  }`}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveTab(tab)}
                    className={`flex h-full items-center gap-1.5 rounded-lg px-1.5 text-[11px] font-normal transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus ${
                      isActive ? "text-text-primary" : "text-text-muted hover:text-text-secondary"
                    }`}
                  >
                    <PanelIcon size={13} className="shrink-0" />
                    <span>{panel.label}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => closeTab(tab)}
                    className="shrink-0 rounded-lg p-1 text-text-muted transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
                    aria-label={`Close ${panel.label}`}
                    title={`Close ${panel.label}`}
                  >
                    <X size={11} />
                  </button>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setActiveTab(null)}
            className="shrink-0 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
            aria-label="Add workspace tab"
            title="Add workspace tab"
          >
            <Plus size={13} />
          </button>
        </header>
      )}
      <div className="relative min-h-0 flex-1">
        {openTabs.includes("terminals") && (
          <div
            role="tabpanel"
            aria-label="Terminal"
            className={`absolute inset-0 ${activeTab === "terminals" ? "visible" : "invisible"}`}
          >
            <TerminalPane projectId={projectId} projectPath={project?.path} worktreePath={worktreePath} />
          </div>
        )}
        <AnimatePresence mode="wait" initial={false}>
          {activeTab === null ? (
            <motion.div
              key="workspace-launcher"
              className="absolute inset-0 flex items-center justify-center px-6 pb-[8vh]"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4, transition: motionTransitions.popoverExit }}
              transition={motionTransitions.popoverEnter}
            >
              <nav className="w-full max-w-[540px] space-y-1" aria-label="Workspace panel launcher">
                {panelLaunchItems.map(({ id, label, icon: Icon, shortcut }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => openPanel(id)}
                    className="group flex min-h-10 w-full items-center gap-2.5 rounded-lg border border-transparent bg-surface/55 px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:border-border/60 hover:bg-hover hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    <Icon
                      size={13}
                      className="shrink-0 text-text-muted transition-colors group-hover:text-text-secondary"
                    />
                    <span className="min-w-0 flex-1">{label}</span>
                    {id === "artifacts" && activeArtifact && (
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-accent"
                        aria-hidden="true"
                        title="Preview available"
                      />
                    )}
                    {shortcut && (
                      <kbd
                        aria-hidden="true"
                        className="rounded-full bg-chat/60 px-1.5 py-0.5 font-sans text-[10px] text-text-muted"
                      >
                        {formatShortcut(shortcut)}
                      </kbd>
                    )}
                  </button>
                ))}
              </nav>
            </motion.div>
          ) : activeTab !== "terminals" ? (
            <motion.div
              key={activeTab}
              className="absolute inset-0 flex min-h-0 flex-col"
              initial={{ opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6, transition: motionTransitions.popoverExit }}
              transition={motionTransitions.popoverEnter}
            >
              <div className="relative min-h-0 flex-1 overflow-hidden">
                {activeTab === "review" && (
                  <ReviewPane
                    projectId={projectId}
                    worktreePath={worktreePath}
                    worktreeBranch={worktreeBranch}
                    conversationId={activeId}
                  />
                )}
                {activeTab === "files" && (
                  <FilesPane
                    projectId={projectId}
                    conversationId={activeId}
                    worktreePath={worktreePath}
                    worktreeBranch={worktreeBranch}
                  />
                )}
                {activeTab === "activity" && <ActivityPane activeId={activeId} />}
                {activeTab === "artifacts" && <BrowserPane />}
                {activeTab === "chat" && <SideChatPane conversationId={sideChatConversationId} />}
                {activeTab === "knowledge" && <AuxiliaryKnowledgeTab />}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </section>
  );
}
