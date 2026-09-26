import { useState, useEffect, useRef } from "react";
import { Plus, Trash2, Pencil, Save, X, LoaderCircle } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { ConfirmModal } from "../../ui/Modal";
import { SettingsEmptyState, SettingsHeaderButton, SettingsSectionHeader } from "../components/SettingsPrimitives";
import { useSkillStore } from "../../../store/useSkillStore";
import { SkillInfo } from "../../../types";
import { useTranslation } from "../../../utils/i18n";
import { motion } from "motion/react";
import { springs, motionTokens } from "../../../lib/motion-tokens";

const VIRTUALIZED_SKILL_THRESHOLD = 100;

interface SkillsSectionProps {
  scrollParent: HTMLDivElement | null;
}

interface SkillListItemProps {
  skill: SkillInfo;
  index: number;
  total: number;
  loadingSkillId: string | null;
  editLabel: string;
  deleteLabel: string;
  virtualized?: boolean;
  onEdit: (skill: SkillInfo) => void;
  onDelete: (id: string) => void;
}

function stripFrontmatter(content: string): string {
  return content.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
}

function SkillListItem({
  skill,
  index,
  total,
  loadingSkillId,
  editLabel,
  deleteLabel,
  virtualized = false,
  onEdit,
  onDelete,
}: SkillListItemProps) {
  return (
    <div role="listitem" aria-posinset={index + 1} aria-setsize={total} className={virtualized ? "pb-4" : undefined}>
      <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-card/50 hover:bg-hover transition-colors group">
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-text-primary">{skill.name}</span>
            <span className="text-xs text-text-muted font-mono px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/5">
              {skill.id}
            </span>
          </div>
          <span className="text-sm text-text-muted truncate mt-0.5">{skill.description}</span>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity shrink-0">
          <motion.button
            onClick={() => onEdit(skill)}
            disabled={loadingSkillId !== null}
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            transition={springs.snappy}
            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center disabled:opacity-50"
            title={editLabel}
            aria-label={`${editLabel}: ${skill.name}`}
          >
            {loadingSkillId === skill.id ? (
              <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
            ) : (
              <Pencil size={15} aria-hidden="true" />
            )}
          </motion.button>
          <motion.button
            onClick={() => onDelete(skill.id)}
            disabled={loadingSkillId !== null}
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            transition={springs.snappy}
            className="p-1.5 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center disabled:opacity-50"
            title={deleteLabel}
            aria-label={`${deleteLabel}: ${skill.name}`}
          >
            <Trash2 size={15} aria-hidden="true" />
          </motion.button>
        </div>
      </div>
    </div>
  );
}

export function SkillsSection({ scrollParent }: SkillsSectionProps) {
  const { t } = useTranslation();
  const skills = useSkillStore((s) => s.skills);
  const loadSkills = useSkillStore((s) => s.loadSkills);
  const readSkill = useSkillStore((s) => s.readSkill);
  const createSkill = useSkillStore((s) => s.createSkill);
  const updateSkill = useSkillStore((s) => s.updateSkill);
  const deleteSkill = useSkillStore((s) => s.deleteSkill);
  const loading = useSkillStore((s) => s.loading);

  const [editingSkill, setEditingSkill] = useState<SkillInfo | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Form state
  const [formId, setFormId] = useState("");
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formContent, setFormContent] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [skillToDelete, setSkillToDelete] = useState<string | null>(null);
  const [loadingSkillId, setLoadingSkillId] = useState<string | null>(null);
  const listScrollTopRef = useRef(0);
  const editRequestRef = useRef(0);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const scrollSettingsTo = (top: number) => {
    requestAnimationFrame(() => scrollParent?.scrollTo({ top }));
  };

  const handleEdit = async (skill: SkillInfo) => {
    const requestId = ++editRequestRef.current;
    setLoadingSkillId(skill.id);
    setErrorMsg("");

    try {
      const content = await readSkill(skill.id);
      if (editRequestRef.current !== requestId) return;

      listScrollTopRef.current = scrollParent?.scrollTop ?? 0;
      setEditingSkill(skill);
      setIsCreating(false);
      setFormId(skill.id);
      setFormName(skill.name);
      setFormDesc(skill.description);
      setFormContent(stripFrontmatter(content));
      scrollSettingsTo(0);
    } catch (e) {
      if (editRequestRef.current === requestId) {
        setErrorMsg(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (editRequestRef.current === requestId) {
        setLoadingSkillId(null);
      }
    }
  };

  const handleCreateNew = () => {
    editRequestRef.current += 1;
    listScrollTopRef.current = scrollParent?.scrollTop ?? 0;
    setLoadingSkillId(null);
    setIsCreating(true);
    setEditingSkill(null);
    setFormId("");
    setFormName("");
    setFormDesc("");
    setFormContent("");
    setErrorMsg("");
    scrollSettingsTo(0);
  };

  const handleCancel = () => {
    editRequestRef.current += 1;
    setIsCreating(false);
    setEditingSkill(null);
    setLoadingSkillId(null);
    setErrorMsg("");
    scrollSettingsTo(listScrollTopRef.current);
  };

  const handleSave = async () => {
    if (!formId.trim()) {
      setErrorMsg(t("settings.skills.errIdRequired") || "ID (Folder Name) is required.");
      return;
    }
    if (!formName.trim()) {
      setErrorMsg(t("settings.skills.errNameRequired") || "Skill Name is required.");
      return;
    }

    try {
      if (isCreating) {
        await createSkill(formId, formName, formDesc, formContent);
      } else if (editingSkill) {
        // If ID changed during edit, we would need a rename function in backend.
        // For simplicity, we disable ID editing when updating.
        await updateSkill(formId, formName, formDesc, formContent);
      }
      handleCancel();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSkill(id);
      if (editingSkill?.id === id) {
        handleCancel();
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSkillToDelete(null);
    }
  };

  if (isCreating || editingSkill) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-text-primary mb-1">
            {isCreating
              ? t("settings.skills.createNew") || "Create New Skill"
              : t("settings.skills.edit") || "Edit Skill"}
          </h2>
          <p className="text-sm text-text-muted">
            {t("settings.skills.description") ||
              "Skills are markdown files containing instructions that agents can read to learn how to do specific tasks."}
          </p>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-sm">{errorMsg}</div>
        )}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="skill-id" className="text-sm font-medium text-text-secondary">
              {t("settings.skills.idLabel") || "Folder Name (ID)"}
            </label>
            <input
              id="skill-id"
              type="text"
              value={formId}
              onChange={(e) => setFormId(e.target.value)}
              disabled={!isCreating}
              placeholder={t("settings.skills.idPlaceholder") || "e.g. react-best-practices"}
              className="w-full h-10 px-3 py-2 bg-input border border-input-border rounded-lg text-text-primary focus:outline-none focus:border-accent transition-colors disabled:opacity-50"
            />
            {isCreating && (
              <p className="text-xs text-text-muted">
                {t("settings.skills.idHelper") || "This will be the folder name in ~/.agents/skills/"}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="skill-name" className="text-sm font-medium text-text-secondary">
              {t("settings.skills.nameLabel") || "Skill Name"}
            </label>
            <input
              id="skill-name"
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder={t("settings.skills.namePlaceholder") || "e.g. React Best Practices"}
              className="w-full h-10 px-3 py-2 bg-input border border-input-border rounded-lg text-text-primary focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="skill-description" className="text-sm font-medium text-text-secondary">
              {t("settings.skills.descLabel") || "Description"}
            </label>
            <input
              id="skill-description"
              type="text"
              value={formDesc}
              onChange={(e) => setFormDesc(e.target.value)}
              placeholder={t("settings.skills.descPlaceholder") || "Short description of what the skill teaches"}
              className="w-full h-10 px-3 py-2 bg-input border border-input-border rounded-lg text-text-primary focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="skill-content" className="text-sm font-medium text-text-secondary">
              {t("settings.skills.contentLabel") || "Markdown Content"}
            </label>
            <textarea
              id="skill-content"
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
              placeholder={t("settings.skills.contentPlaceholder") || "Write the instructions here..."}
              className="w-full h-64 px-3 py-2 bg-input border border-input-border rounded-lg text-text-primary focus:outline-none focus:border-accent transition-colors resize-y font-mono text-sm"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-4">
          <motion.button
            onClick={handleSave}
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            transition={springs.snappy}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-accent-foreground rounded-lg hover:bg-accent-hover transition-colors font-medium min-h-[40px]"
          >
            <Save size={16} />
            {t("settings.skills.save") || "Save Skill"}
          </motion.button>
          <motion.button
            onClick={handleCancel}
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            transition={springs.snappy}
            className="flex items-center gap-2 px-4 py-2 bg-transparent text-text-secondary hover:text-text-primary hover:bg-hover rounded-lg transition-colors font-medium min-h-[40px] border border-border"
          >
            <X size={16} />
            {t("settings.skills.cancel") || "Cancel"}
          </motion.button>
        </div>
      </div>
    );
  }

  return (
    <>
      <SettingsSectionHeader
        compact
        title={t("settings.skills.title") || "Agent Skills"}
        description={
          t("settings.skills.subtitle") ||
          "Manage custom skills that provide instructions and context to your AI agents."
        }
        actions={
          <SettingsHeaderButton onClick={handleCreateNew} ariaLabel={t("settings.skills.newSkill") || "New Skill"}>
            <Plus size={14} />
            <span>{t("settings.skills.newSkill") || "New Skill"}</span>
          </SettingsHeaderButton>
        }
      />

      <div className="space-y-4">
        {errorMsg && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-sm">{errorMsg}</div>
        )}

        {loading && skills.length === 0 ? (
          <div className="text-sm text-text-muted">{t("settings.skills.loading") || "Loading skills..."}</div>
        ) : skills.length === 0 ? (
          <SettingsEmptyState
            message={t("settings.skills.noSkills") || "No skills found"}
            description={
              t("settings.skills.noSkillsDesc") ||
              "Create a skill to provide specialized instructions, examples, and knowledge to your AI agents."
            }
          />
        ) : skills.length >= VIRTUALIZED_SKILL_THRESHOLD && !scrollParent ? (
          <div className="text-sm text-text-muted">{t("settings.skills.loading") || "Loading skills..."}</div>
        ) : skills.length >= VIRTUALIZED_SKILL_THRESHOLD && scrollParent ? (
          <Virtuoso
            customScrollParent={scrollParent}
            data={skills}
            computeItemKey={(_, skill) => skill.id}
            defaultItemHeight={92}
            increaseViewportBy={{ top: 200, bottom: 300 }}
            role="list"
            aria-label={t("settings.skills.title") || "Agent Skills"}
            itemContent={(index, skill) => (
              <SkillListItem
                skill={skill}
                index={index}
                total={skills.length}
                loadingSkillId={loadingSkillId}
                editLabel={t("settings.skills.edit") || "Edit Skill"}
                deleteLabel={t("common.delete") || "Delete"}
                virtualized
                onEdit={(selectedSkill) => void handleEdit(selectedSkill)}
                onDelete={setSkillToDelete}
              />
            )}
          />
        ) : (
          <div className="space-y-4" role="list" aria-label={t("settings.skills.title") || "Agent Skills"}>
            {skills.map((skill, index) => (
              <SkillListItem
                key={skill.id}
                skill={skill}
                index={index}
                total={skills.length}
                loadingSkillId={loadingSkillId}
                editLabel={t("settings.skills.edit") || "Edit Skill"}
                deleteLabel={t("common.delete") || "Delete"}
                onEdit={(selectedSkill) => void handleEdit(selectedSkill)}
                onDelete={setSkillToDelete}
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={!!skillToDelete}
        onCancel={() => setSkillToDelete(null)}
        onConfirm={() => skillToDelete && handleDelete(skillToDelete)}
        title={t("settings.skills.deleteTitle", { defaultValue: "Delete Skill" })}
        message={
          t("settings.skills.deleteConfirm", {
            defaultValue: "Are you sure you want to delete this skill? This action cannot be undone.",
          }) + (skillToDelete ? `\n\nSkill ID: ${skillToDelete}` : "")
        }
        confirmText={t("common.delete", { defaultValue: "Delete" })}
        variant="danger"
      />
    </>
  );
}
