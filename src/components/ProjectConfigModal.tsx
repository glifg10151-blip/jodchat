import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { Folder, FolderPlus, ShieldAlert, Info, Sliders, Terminal, GitBranch } from "lucide-react";
import { useProjectStore } from "../store/useProjectStore";
import { useUIStore } from "../store/useUIStore";
import { useGitStore } from "../store/useGitStore";
import { Modal } from "./ui/Modal";
import { Switch } from "./ui/Switch";
import type { ProjectPermission } from "../types";
import { useTranslation } from "../utils/i18n";
import { useShallow } from "zustand/react/shallow";

interface FormProps {
  id: string | null;
  mode: "create" | "edit";
  onClose: () => void;
}

function ProjectForm({ id, mode, onClose }: FormProps) {
  const { t } = useTranslation();
  const addToast = useUIStore((s) => s.addToast);
  const { projects, defaultPermission, addProject, updateProject, setActiveProject } = useProjectStore(
    useShallow((state) => ({
      projects: state.projects,
      defaultPermission: state.defaultPermission,
      addProject: state.addProject,
      updateProject: state.updateProject,
      setActiveProject: state.setActiveProject,
    })),
  );
  const gitConfig = useGitStore((s) => s.config);
  const projectToEdit = id ? projects.find((p) => p.id === id) : null;

  // Initialize form state directly on mount
  const [name, setName] = useState(projectToEdit ? projectToEdit.name : "");
  const [path, setPath] = useState(projectToEdit ? projectToEdit.path : "");
  const [permissions, setPermissions] = useState<ProjectPermission>(
    projectToEdit ? projectToEdit.permissions : defaultPermission,
  );
  const [creationMode, setCreationMode] = useState<"documents" | "custom">(mode === "edit" ? "custom" : "documents");
  const [excludePatterns, setExcludePatterns] = useState(
    projectToEdit?.excludePatterns?.join(", ") ?? "node_modules, .git, dist, build, target",
  );
  const [systemPromptOverride, setSystemPromptOverride] = useState(projectToEdit?.systemPromptOverride ?? "");
  const [skipCommandConfirmations, setSkipCommandConfirmations] = useState(
    projectToEdit?.skipCommandConfirmations ?? false,
  );
  const [isAutoCommitEnabled, setIsAutoCommitEnabled] = useState(
    projectToEdit ? (projectToEdit.isAutoCommitEnabled ?? false) : gitConfig.isAutoCommitEnabled,
  );
  const [autoCommitMsgTemplate, setAutoCommitMsgTemplate] = useState(projectToEdit?.autoCommitMsgTemplate ?? "");
  const [activeTab, setActiveTab] = useState<"general" | "ai" | "git">("general");
  const [saving, setSaving] = useState(false);

  const handleBrowseFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("projectForm.selectDirectory"),
      });
      if (selected && typeof selected === "string") {
        setPath(selected);
        if (!name) {
          const folderName = selected.split(/[\\/]/).pop() || t("projectForm.newProject");
          setName(folderName);
        }
      }
    } catch (e) {
      console.error("Failed to open directory dialog:", e);
      addToast(t("projectForm.selectFolderError"), "error");
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      addToast(t("projectForm.nameRequired"), "error");
      return;
    }
    if (creationMode === "custom" && !path.trim()) {
      addToast(t("projectForm.pathRequired"), "error");
      return;
    }

    setSaving(true);
    try {
      const parsedExcludes = excludePatterns
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      const configData = {
        skipCommandConfirmations,
        excludePatterns: parsedExcludes,
        systemPromptOverride: systemPromptOverride.trim() || undefined,
        isAutoCommitEnabled,
        autoCommitMsgTemplate: autoCommitMsgTemplate.trim() || undefined,
      };

      if (mode === "create") {
        let finalPath = path;
        if (creationMode === "documents") {
          finalPath = await invoke<string>("create_project_dir", { name: name.trim() });
        }

        const newId = await addProject(name.trim(), finalPath, permissions, configData);
        setActiveProject(newId);
        addToast(t("projectForm.added", { name }), "success");
      } else if (mode === "edit" && id) {
        await updateProject(id, {
          name: name.trim(),
          path,
          permissions,
          ...configData,
        });
        addToast(t("projectForm.updated", { name }), "success");
      }
      onClose();
    } catch (err) {
      console.error(err);
      addToast(typeof err === "string" ? err : t("projectForm.saveError"), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-4">
      {/* Tab Headers */}
      <div className="flex border-b border-border/50 mb-4 p-0.5 bg-active/40 rounded-lg">
        <button
          type="button"
          onClick={() => setActiveTab("general")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
            activeTab === "general"
              ? "bg-surface text-text-primary shadow-sm"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          <Sliders size={13} />
          <span>{t("projectForm.general")}</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("ai")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
            activeTab === "ai"
              ? "bg-surface text-text-primary shadow-sm"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          <Terminal size={13} />
          <span>{t("projectForm.aiContext")}</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("git")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
            activeTab === "git"
              ? "bg-surface text-text-primary shadow-sm"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          <GitBranch size={13} />
          <span>{t("projectForm.gitSettings")}</span>
        </button>
      </div>

      {/* Tab 1: General Settings */}
      {activeTab === "general" && (
        <div className="space-y-4">
          {/* Creation Mode Tabs (Create mode only) */}
          {mode === "create" && (
            <div className="space-y-1.5" role="group" aria-labelledby="project-location-type-label">
              <div
                id="project-location-type-label"
                className="text-xs font-semibold text-text-muted uppercase tracking-wider"
              >
                {t("projectForm.locationType")}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCreationMode("documents")}
                  className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border text-center transition-[color,background-color,border-color,box-shadow,transform] ${
                    creationMode === "documents"
                      ? "border-accent bg-accent-soft/20 text-text-primary"
                      : "border-border bg-surface hover:bg-hover text-text-secondary"
                  }`}
                >
                  <FolderPlus size={16} className={creationMode === "documents" ? "text-accent" : "text-text-muted"} />
                  <span className="text-xs font-semibold">{t("projectForm.newInDocuments")}</span>
                  <span className="text-[10px] text-text-muted">{t("projectForm.autoCreateFolder")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCreationMode("custom")}
                  className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border text-center transition-[color,background-color,border-color,box-shadow,transform] ${
                    creationMode === "custom"
                      ? "border-accent bg-accent-soft/20 text-text-primary"
                      : "border-border bg-surface hover:bg-hover text-text-secondary"
                  }`}
                >
                  <Folder size={16} className={creationMode === "custom" ? "text-accent" : "text-text-muted"} />
                  <span className="text-xs font-semibold">{t("projectForm.selectLocalPath")}</span>
                  <span className="text-[10px] text-text-muted">{t("projectForm.chooseFolder")}</span>
                </button>
              </div>
            </div>
          )}

          {/* Name Input */}
          <div className="space-y-1">
            <label htmlFor="project-name" className="text-xs font-semibold text-text-secondary">
              {t("projectForm.projectName")}
            </label>
            <input
              id="project-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. sythoria-desktop"
              className="w-full px-3 py-2 text-sm rounded-lg bg-input border border-input-border text-text-primary focus:outline-none focus:border-accent"
              required
            />
          </div>

          {/* Path Selection */}
          {creationMode === "custom" && (
            <div className="space-y-1">
              <label htmlFor="project-folder-path" className="text-xs font-semibold text-text-secondary">
                {t("projectForm.folderPath")}
              </label>
              <div className="flex gap-2">
                <input
                  id="project-folder-path"
                  type="text"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="/Users/username/Projects/my-app"
                  className="flex-1 px-3 py-2 text-sm rounded-lg bg-input border border-input-border text-text-primary focus:outline-none focus:border-accent"
                  required={creationMode === "custom"}
                />
                <button
                  type="button"
                  onClick={handleBrowseFolder}
                  className="px-3 py-2 text-xs font-semibold rounded-lg bg-hover border border-border text-text-primary hover:bg-active transition-colors"
                >
                  {t("projectForm.browse")}
                </button>
              </div>
            </div>
          )}

          {creationMode === "documents" && mode === "create" && (
            <div className="p-2.5 bg-active/40 border border-border/50 rounded-xl flex items-start gap-2 text-xs text-text-muted">
              <Info size={14} className="shrink-0 mt-0.5 text-accent" />
              <span>
                {t("projectForm.documentsPrefix")} <strong>{t("projectForm.documents")}</strong>{" "}
                <code className="text-accent-hover font-mono break-all">
                  Documents/{name ? name.replace(/[^a-zA-Z0-9\-_ ]/g, "_").trim() : "[ProjectName]"}
                </code>
              </span>
            </div>
          )}

          {/* Permissions */}
          <div className="space-y-1.5" role="group" aria-labelledby="project-permission-label">
            <div
              id="project-permission-label"
              className="text-xs font-semibold text-text-muted uppercase tracking-wider block"
            >
              {t("projectForm.permissionLevel")}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPermissions("read")}
                className={`py-2 px-3 rounded-lg border text-center transition-[color,background-color,border-color,box-shadow,transform] flex flex-col items-center gap-1 ${
                  permissions === "read"
                    ? "border-accent bg-accent-soft/20 text-accent font-medium"
                    : "border-border bg-surface text-text-secondary hover:bg-hover"
                }`}
              >
                <span className="text-xs">{t("settings.projects.readOnly")}</span>
                <span className="text-[9px] opacity-75">{t("settings.projects.readOnlyDesc")}</span>
              </button>
              <button
                type="button"
                onClick={() => setPermissions("write")}
                className={`py-2 px-3 rounded-lg border text-center transition-[color,background-color,border-color,box-shadow,transform] flex flex-col items-center gap-1 ${
                  permissions === "write"
                    ? "border-amber-500 bg-amber-500/10 text-amber-500 font-medium"
                    : "border-border bg-surface text-text-secondary hover:bg-hover"
                }`}
              >
                <span className="text-xs">{t("settings.projects.readWrite")}</span>
                <span className="text-[9px] opacity-75">{t("settings.projects.readWriteDesc")}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const confirmed = window.confirm(t("projectForm.fullShellConfirm"));
                  if (confirmed) setPermissions("full");
                }}
                className={`py-2 px-3 rounded-lg border text-center transition-[color,background-color,border-color,box-shadow,transform] flex flex-col items-center gap-1 ${
                  permissions === "full"
                    ? "border-red-500 bg-red-500/10 text-red-500 font-medium"
                    : "border-border bg-surface text-text-secondary hover:bg-hover"
                }`}
              >
                <span className="text-xs">{t("settings.projects.fullShell")}</span>
                <span className="text-[9px] opacity-75">{t("settings.projects.fullShellDesc")}</span>
              </button>
            </div>

            {permissions === "full" && (
              <div className="space-y-2.5">
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-2.5 text-xs text-red-600 dark:text-red-400">
                  <ShieldAlert size={16} className="shrink-0 mt-0.5 text-red-500" aria-hidden="true" />
                  <div>
                    <span className="font-semibold block mb-0.5">{t("settings.projects.warningTitle")}</span>
                    {t("settings.projects.warningDesc")}
                  </div>
                </div>
                <div className="p-3 bg-active/20 rounded-xl border border-border/40">
                  <Switch
                    checked={skipCommandConfirmations}
                    onChange={setSkipCommandConfirmations}
                    label={t("projectForm.skipCommandConfirmations")}
                    description={t("projectForm.skipCommandConfirmationsDesc")}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: AI & Context Settings */}
      {activeTab === "ai" && (
        <div className="space-y-4">
          {/* Custom System Prompt */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label htmlFor="project-system-prompt" className="text-xs font-semibold text-text-secondary">
                {t("projectForm.promptOverride")}
              </label>
              <span className="text-[10px] text-text-muted">{t("projectForm.promptOverrideDesc")}</span>
            </div>
            <textarea
              id="project-system-prompt"
              value={systemPromptOverride}
              onChange={(e) => setSystemPromptOverride(e.target.value)}
              placeholder={t("projectForm.promptPlaceholder")}
              rows={4}
              className="w-full px-3 py-2 text-xs rounded-lg bg-input border border-input-border text-text-primary focus:outline-none focus:border-accent resize-none font-sans"
            />
          </div>

          {/* Exclude Patterns */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label htmlFor="project-exclude-patterns" className="text-xs font-semibold text-text-secondary">
                {t("projectForm.excludePatterns")}
              </label>
              <span className="text-[10px] text-text-muted">{t("projectForm.excludePatternsDesc")}</span>
            </div>
            <input
              id="project-exclude-patterns"
              type="text"
              value={excludePatterns}
              onChange={(e) => setExcludePatterns(e.target.value)}
              placeholder="node_modules, .git, dist, build, target, *.log"
              className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-input border border-input-border text-text-primary focus:outline-none focus:border-accent"
            />
            <p className="text-[10px] text-text-muted mt-0.5">{t("projectForm.excludeHelp")}</p>
          </div>
        </div>
      )}

      {/* Tab 3: Git Settings */}
      {activeTab === "git" && (
        <div className="space-y-4">
          {/* Enable Git Auto commit */}
          <div className="p-3 bg-active/20 rounded-xl border border-border/40">
            <Switch
              checked={isAutoCommitEnabled}
              onChange={setIsAutoCommitEnabled}
              label={t("projectForm.autoCommit")}
              description={t("projectForm.autoCommitDesc")}
            />
          </div>

          {/* Git Auto Commit Message Prompt Template */}
          {isAutoCommitEnabled && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label htmlFor="project-commit-instructions" className="text-xs font-semibold text-text-secondary">
                  {t("projectForm.commitInstructions")}
                </label>
                <span className="text-[10px] text-text-muted">{t("projectForm.commitInstructionsDesc")}</span>
              </div>
              <textarea
                id="project-commit-instructions"
                value={autoCommitMsgTemplate}
                onChange={(e) => setAutoCommitMsgTemplate(e.target.value)}
                placeholder={t("projectForm.commitPlaceholder")}
                rows={4}
                className="w-full px-3 py-2 text-xs rounded-lg bg-input border border-input-border text-text-primary focus:outline-none focus:border-accent resize-none font-sans"
              />
            </div>
          )}

          <div className="p-2.5 bg-active/40 border border-border/50 rounded-xl flex items-start gap-2 text-xs text-text-muted">
            <Info size={14} className="shrink-0 mt-0.5 text-accent" />
            <span>{t("projectForm.gitHelp")}</span>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2.5 justify-end pt-3 border-t border-border/30">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="px-4 py-2 text-xs font-semibold rounded-lg text-text-secondary hover:bg-hover transition-colors min-h-[36px]"
        >
          {t("projectForm.cancel")}
        </button>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-xs font-semibold rounded-lg bg-accent text-accent-foreground hover:bg-accent-hover transition-colors min-h-[36px] flex items-center justify-center gap-1.5"
        >
          {saving ? (
            <>
              <span className="w-3.5 h-3.5 border-2 border-accent-foreground/30 border-t-accent-foreground rounded-full animate-spin" />
              <span>{t("projectForm.saving")}</span>
            </>
          ) : (
            <span>{mode === "create" ? t("projectForm.createProject") : t("projectForm.saveChanges")}</span>
          )}
        </button>
      </div>
    </form>
  );
}

export default function ProjectConfigModal() {
  const { t } = useTranslation();
  const isOpen = useUIStore((s) => s.showProjectConfigModal);
  const mode = useUIStore((s) => s.projectConfigModalMode);
  const id = useUIStore((s) => s.projectConfigModalId);
  const close = useUIStore((s) => s.closeProjectConfigModal);

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={mode === "create" ? t("projectForm.addWorkspace") : t("projectForm.workspaceSettings")}
    >
      <ProjectForm key={isOpen ? `${id || "create"}-${mode}` : "closed"} id={id} mode={mode} onClose={close} />
    </Modal>
  );
}
