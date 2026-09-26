import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { loadGitConfig, saveGitConfig, GitConfig } from "../utils/storage";
import { logInfo, logError } from "../utils/logger";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface GitStatus {
  isRepo: boolean;
  path: string;
  branch: string;
  isDirty: boolean;
  stagedFiles: string[];
  unstagedFiles: string[];
  ahead: number;
  behind: number;
}

export interface AutoCommitScope {
  projectId: string;
  projectRoot: string;
  modelId: string;
  files: string[];
}

const repositoryCommitQueues = new Map<string, Promise<void>>();

function serializeRepositoryCommit(repositoryPath: string, operation: () => Promise<void>): Promise<void> {
  const previous = repositoryCommitQueues.get(repositoryPath) ?? Promise.resolve();
  const queued = previous
    .catch(() => undefined)
    .then(operation)
    .finally(() => {
      if (repositoryCommitQueues.get(repositoryPath) === queued) {
        repositoryCommitQueues.delete(repositoryPath);
      }
    });
  repositoryCommitQueues.set(repositoryPath, queued);
  return queued;
}

interface GitStore {
  config: GitConfig;
  status: GitStatus | null;
  loading: boolean;
  error: string | null;

  init: () => Promise<void>;
  updateConfig: (updates: Partial<GitConfig>) => Promise<void>;
  verifyPath: (path: string) => Promise<boolean>;
  commitChanges: (message: string, files?: string[]) => Promise<string>;
  undoLastCommit: () => Promise<void>;
  checkoutBranch: (branch: string) => Promise<void>;
  getDiff: () => Promise<string>;
  autoCommitIfNeeded: (scope: AutoCommitScope) => Promise<void>;
}

export const useGitStore = create<GitStore>((set, get) => ({
  config: {
    repoPath: "",
    isAutoCommitEnabled: false,
    isAiCommitMsgEnabled: true,
    isPreCommitEnabled: true,
    overrideIdentity: false,
    gitName: "Sythoria AI",
    gitEmail: "assistant@sythoria.local",
  },
  status: null,
  loading: false,
  error: null,

  init: async () => {
    set({ loading: true, error: null });
    try {
      const config = await loadGitConfig();
      set({ config, loading: false });
      if (config.repoPath) {
        await get().verifyPath(config.repoPath);
      }
    } catch (e: unknown) {
      logError("git", "Failed to initialize Git store", { error: e });
      set({ error: errorMessage(e), loading: false });
    }
  },

  updateConfig: async (updates) => {
    const newConfig = { ...get().config, ...updates };
    set({ config: newConfig });
    await saveGitConfig(newConfig);
    logInfo("git", "Updated Git config settings", { details: JSON.stringify(updates) });
  },

  verifyPath: async (path) => {
    set({ loading: true, error: null });
    try {
      // 1. Detect if it is a repo
      const detected = await invoke<string | null>("git_detect_repo", { startPath: path });
      if (!detected) {
        set({
          status: {
            isRepo: false,
            path,
            branch: "",
            isDirty: false,
            stagedFiles: [],
            unstagedFiles: [],
            ahead: 0,
            behind: 0,
          },
          loading: false,
        });
        return false;
      }

      // 2. Fetch repo status
      const { useProjectStore } = await import("./useProjectStore");
      const projectId = useProjectStore.getState().activeProjectId;
      if (!projectId) {
        throw new Error("No active project configured");
      }
      const status = await invoke<GitStatus>("git_get_status", { projectId });
      set({ status, loading: false });

      // Auto save path if changed and validated
      if (detected !== get().config.repoPath) {
        await get().updateConfig({ repoPath: detected });
      }

      return true;
    } catch (e: unknown) {
      logError("git", `Failed to verify repository path: ${path}`, { error: e });
      set({ error: errorMessage(e), loading: false });
      return false;
    }
  },

  commitChanges: async (message, files) => {
    set({ loading: true, error: null });
    const { repoPath, overrideIdentity, gitName, gitEmail, isPreCommitEnabled } = get().config;
    const { useProjectStore } = await import("./useProjectStore");
    const projectId = useProjectStore.getState().activeProjectId;
    if (!projectId) {
      const err = "No active project configured";
      set({ error: err, loading: false });
      throw new Error(err);
    }
    try {
      const result = await invoke<string>("git_create_commit", {
        projectId,
        message,
        files: files || null,
        authorName: overrideIdentity ? gitName : null,
        authorEmail: overrideIdentity ? gitEmail : null,
        bypassHooks: !isPreCommitEnabled,
        worktreePath: null,
      });
      logInfo("git", `Created Git commit for project: ${projectId}`, { details: result });
      await get().verifyPath(repoPath);
      return result;
    } catch (e: unknown) {
      logError("git", `Failed to commit changes for project: ${projectId}`, { error: e });
      set({ error: errorMessage(e), loading: false });
      throw e;
    }
  },

  undoLastCommit: async () => {
    set({ loading: true, error: null });
    const { repoPath } = get().config;
    const { useProjectStore } = await import("./useProjectStore");
    const projectId = useProjectStore.getState().activeProjectId;
    if (!projectId) return;
    try {
      await invoke("git_undo_last_commit", { projectId });
      logInfo("git", `Soft reset last commit for project: ${projectId}`);
      await get().verifyPath(repoPath);
    } catch (e: unknown) {
      logError("git", `Failed to undo last commit for project: ${projectId}`, { error: e });
      set({ error: errorMessage(e), loading: false });
    }
  },

  checkoutBranch: async (branch) => {
    set({ loading: true, error: null });
    const { repoPath } = get().config;
    const { useProjectStore } = await import("./useProjectStore");
    const projectId = useProjectStore.getState().activeProjectId;
    if (!projectId) return;
    try {
      await invoke("git_checkout_branch", { projectId, branch });
      logInfo("git", `Checked out branch ${branch} for project: ${projectId}`);
      await get().verifyPath(repoPath);
    } catch (e: unknown) {
      logError("git", `Failed to checkout branch ${branch} for project: ${projectId}`, { error: e });
      set({ error: errorMessage(e), loading: false });
    }
  },

  getDiff: async () => {
    const { useProjectStore } = await import("./useProjectStore");
    const projectId = useProjectStore.getState().activeProjectId;
    if (!projectId) return "";
    try {
      return await invoke<string>("git_diff_changes", { projectId, worktreePath: null, files: null });
    } catch (e: unknown) {
      logError("git", "Failed to retrieve diff from repository", { error: e });
      return "";
    }
  },

  autoCommitIfNeeded: async (scope) => {
    const files = [...new Set(scope.files.filter(Boolean))].sort();
    if (files.length === 0) return;

    try {
      await serializeRepositoryCommit(scope.projectRoot, async () => {
        const state = get();
        const { useProjectStore } = await import("./useProjectStore");
        const project = useProjectStore.getState().projects.find((candidate) => candidate.id === scope.projectId);
        if (!project || project.path !== scope.projectRoot) {
          logError("git", `Skipped auto-commit because project scope changed: ${scope.projectId}`);
          return;
        }

        const isAutoCommitEnabled = project.isAutoCommitEnabled ?? state.config.isAutoCommitEnabled;
        if (!isAutoCommitEnabled) return;

        const diff = await invoke<string>("git_diff_changes", {
          projectId: scope.projectId,
          worktreePath: null,
          files,
        });
        if (!diff.trim()) return;

        let message = "Auto-commit by Sythoria AI";
        if (state.config.isAiCommitMsgEnabled) {
          const { useModelStore } = await import("./useModelStore");
          const modelConfig = useModelStore.getState().models.find((model) => model.id === scope.modelId);
          if (modelConfig) {
            const systemPrompt =
              project.autoCommitMsgTemplate?.trim() ||
              "You are a git commit message generator. Based on the following diff, write a concise, conventional commit message. Do not include any other text or explanation, just the commit message itself.";
            try {
              message = (
                await invoke<string>("chat_completion", {
                  configId: modelConfig.id,
                  messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: diff.slice(0, 5000) },
                  ],
                  temperature: 0.3,
                  maxTokens: 100,
                })
              ).trim();
            } catch (error) {
              logError("git", "Failed to generate AI commit message, falling back to default", { error });
            }
          }
        }

        try {
          await invoke<string>("git_create_commit", {
            projectId: scope.projectId,
            message,
            files,
            authorName: state.config.overrideIdentity ? state.config.gitName : null,
            authorEmail: state.config.overrideIdentity ? state.config.gitEmail : null,
            bypassHooks: !state.config.isPreCommitEnabled,
            worktreePath: null,
          });
          logInfo("git", `Auto-committed AI paths for project: ${scope.projectId}`, { details: files.join(", ") });
          const { useUIStore } = await import("./useUIStore");
          useUIStore.getState().addToast(`Auto-committed: ${message}`, "success");
        } catch (error) {
          logError("git", `Failed to auto-commit AI paths for project: ${scope.projectId}`, { error });
        }
      });
    } catch (error) {
      logError("git", `Failed to prepare auto-commit for project: ${scope.projectId}`, { error });
    }
  },
}));
