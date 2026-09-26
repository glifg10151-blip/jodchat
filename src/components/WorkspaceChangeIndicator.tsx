import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion } from "motion/react";
import { ChevronRight, FilePenLine } from "lucide-react";
import { motionTransitions } from "../lib/motion-tokens";
import { useChatStore } from "../store/useChatStore";
import { useUIStore } from "../store/useUIStore";
import { isGenerationActive, type WorkspaceChangeFile } from "../types";
import { parseGitDiff } from "../utils/gitDiff";

function mergeWorkspaceFiles(diff: string, statusPaths: string[]): WorkspaceChangeFile[] {
  const files = new Map<string, WorkspaceChangeFile>();
  for (const file of parseGitDiff(diff)) {
    const previous = files.get(file.path);
    files.set(file.path, {
      path: file.path,
      additions: (previous?.additions ?? 0) + file.additions,
      deletions: (previous?.deletions ?? 0) + file.deletions,
    });
  }
  for (const path of statusPaths.filter((path) => !path.endsWith("/"))) {
    if (!files.has(path)) files.set(path, { path, additions: 0, deletions: 0 });
  }
  return [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function openWorkspaceReview(conversationId: string) {
  const ui = useUIStore.getState();
  ui.setActiveAuxConversationId(conversationId);
  ui.setActiveReviewFilePath(null);
  ui.setActiveAuxTab("review");
  ui.setAuxPanelOpen(true);
}

export function WorkspaceChangeIndicator({ conversationId }: { conversationId?: string }) {
  const conversation = useChatStore((state) =>
    state.conversations.find((candidate) => candidate.id === conversationId),
  );
  const isWorking = useChatStore((state) => {
    if (!conversationId) return false;
    return (
      isGenerationActive(state.generationByConversation[conversationId]?.state) ||
      state.conversations.some((candidate) => candidate.parentId === conversationId && candidate.status === "running")
    );
  });
  const pendingWorktree = conversation?.pendingWorktree;
  const recoveryProjectId = pendingWorktree?.commitScope?.projectId ?? conversation?.projectId;
  const [liveFiles, setLiveFiles] = useState<WorkspaceChangeFile[]>([]);

  useEffect(() => {
    let active = true;
    let pollTimer: number | undefined;

    if (!pendingWorktree || !isWorking) {
      setLiveFiles([]);
      return () => undefined;
    }
    if (!recoveryProjectId) {
      setLiveFiles([]);
      return () => undefined;
    }

    const load = async () => {
      try {
        const [status, diff] = await Promise.all([
          invoke<{ unstagedFiles: string[]; stagedFiles: string[] }>("git_get_status", {
            projectId: recoveryProjectId,
            worktreePath: pendingWorktree.path,
          }),
          invoke<string>("git_diff_changes", {
            projectId: recoveryProjectId,
            worktreePath: pendingWorktree.path,
            files: null,
            runToken: null,
          }),
        ]);
        if (!active) return;
        const files = mergeWorkspaceFiles(diff, [...status.unstagedFiles, ...status.stagedFiles]);
        setLiveFiles(files);
      } catch {
        // A transient status failure should not create a generic "changes ready"
        // indicator. Keep the last verified file list until polling succeeds.
      } finally {
        if (active && isWorking) pollTimer = window.setTimeout(() => void load(), 1000);
      }
    };

    void load();
    return () => {
      active = false;
      if (pollTimer !== undefined) window.clearTimeout(pollTimer);
    };
  }, [isWorking, pendingWorktree, recoveryProjectId]);

  if (!conversationId || !pendingWorktree || !isWorking) return null;

  const files = liveFiles;
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);
  const hasKnownFiles = files.length > 0;

  if (!hasKnownFiles) return null;

  const fileLabel = `${files.length} ${files.length === 1 ? "file" : "files"} changed`;

  return (
    <motion.div
      className="mb-2 flex w-full justify-center"
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={motionTransitions.content}
    >
      <button
        type="button"
        onClick={() => openWorkspaceReview(conversationId)}
        className="flex min-h-8 max-w-full items-center gap-2 rounded-full border border-border/70 bg-surface/85 px-3.5 py-1.5 text-xs font-medium text-text-secondary shadow-sm backdrop-blur-md transition-colors hover:border-text-muted hover:bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        aria-label={`${fileLabel}${hasKnownFiles ? `, ${additions} additions and ${deletions} deletions` : ""}. Open review.`}
      >
        <FilePenLine size={13} className="shrink-0" aria-hidden="true" />
        <span className="truncate" aria-live="polite">
          {fileLabel}
        </span>
        {hasKnownFiles && (
          <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px]">
            <span className="text-emerald-500">+{additions}</span>
            <span className="text-red-400">−{deletions}</span>
          </span>
        )}
        <ChevronRight size={13} className="shrink-0 opacity-70" aria-hidden="true" />
      </button>
    </motion.div>
  );
}
