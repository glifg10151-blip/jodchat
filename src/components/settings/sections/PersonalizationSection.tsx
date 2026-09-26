import { Select } from "../../ui/Select";
import { useTranslation } from "../../../utils/i18n";
import { DEFAULT_TITLE_SYSTEM_PROMPT, TitleGenerationConfig, ModelConfig } from "../../../types";
import { useModelStore } from "../../../store/useModelStore";
import { SettingsPanel, SettingsSectionHeader, SettingsTogglePanel } from "../components/SettingsPrimitives";

interface PersonalizationSectionProps {
  titleConfig: TitleGenerationConfig;
  setTitleConfig: (updates: Partial<TitleGenerationConfig>) => void;
  enabledModels: ModelConfig[];
}

export const PersonalizationSection = ({ titleConfig, setTitleConfig, enabledModels }: PersonalizationSectionProps) => {
  const { t } = useTranslation();
  const systemPrompt = useModelStore((s) => s.systemPrompt);
  const setSystemPrompt = useModelStore((s) => s.setSystemPrompt);
  const autoGenerateMemory = useModelStore((s) => s.autoGenerateMemory);
  const setAutoGenerateMemory = useModelStore((s) => s.setAutoGenerateMemory);

  return (
    <>
      <SettingsSectionHeader title={t("settings.prompts.title")} description={t("settings.prompts.subtitle")} />
      <SettingsTogglePanel
        id="setting-personalization-title"
        checked={titleConfig.enabled}
        onChange={(checked) => setTitleConfig({ enabled: checked })}
        label={t("settings.prompts.aiTitleGen")}
        description={t("settings.prompts.aiTitleGenDesc")}
        contentClassName="space-y-4"
      >
        <div className="space-y-2">
          <label htmlFor="title-model-select-trigger" className="text-sm font-medium text-text-primary block">
            {t("settings.prompts.titleModel")}
          </label>
          <p className="text-xs text-text-muted mb-2">{t("settings.prompts.titleModelDesc")}</p>
          <Select
            id="title-model-select"
            value={titleConfig.modelId}
            onChange={(modelId) => setTitleConfig({ modelId })}
            options={[
              {
                value: "__same__",
                label: t("settings.prompts.sameModel"),
                description: t("settings.prompts.sameModelDesc"),
              },
              ...enabledModels.map((model) => ({
                value: model.id,
                label: model.name,
                description: model.modelId,
              })),
            ]}
            aria-label="Title generation models"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="title-system-prompt" className="text-sm font-medium text-text-primary block">
            {t("settings.prompts.systemPrompt")}
          </label>
          <p className="text-xs text-text-muted mb-2">{t("settings.prompts.titlePromptDesc")}</p>
          <textarea
            id="title-system-prompt"
            value={titleConfig.systemPrompt}
            onChange={(e) => setTitleConfig({ systemPrompt: e.target.value })}
            rows={4}
            placeholder={DEFAULT_TITLE_SYSTEM_PROMPT}
            className="w-full px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors resize-y min-h-[80px]"
          />
          {titleConfig.systemPrompt !== DEFAULT_TITLE_SYSTEM_PROMPT && (
            <button
              onClick={() => setTitleConfig({ systemPrompt: DEFAULT_TITLE_SYSTEM_PROMPT })}
              className="text-xs text-accent hover:text-accent-hover transition-colors"
            >
              {t("settings.prompts.resetBtn")}
            </button>
          )}
        </div>
      </SettingsTogglePanel>

      <SettingsSectionHeader
        compact
        title={t("settings.prompts.memoryTitle") || "Adaptive Chat Memory"}
        description={
          t("settings.prompts.memorySubtitle") || "Automatically learn and retain context across conversations."
        }
      />
      <SettingsTogglePanel
        id="setting-personalization-auto-memory"
        checked={autoGenerateMemory}
        onChange={(checked) => setAutoGenerateMemory(checked)}
        label={t("settings.prompts.autoMemoryLabel") || "Generate Memory from Chats"}
        description={
          t("settings.prompts.autoMemoryDesc") ||
          "Extract key facts, personal preferences, and background context from completed conversations to enrich your persistent profile memory."
        }
      />

      <SettingsSectionHeader
        compact
        title={t("settings.prompts.behaviorTitle")}
        description={t("settings.prompts.behaviorSubtitle")}
      />
      <SettingsPanel id="setting-personalization-system">
        <div className="space-y-2">
          <label htmlFor="global-system-prompt" className="text-sm font-medium text-text-primary block">
            {t("settings.prompts.globalPrompt")}
          </label>
          <p className="text-xs text-text-muted mb-2">{t("settings.prompts.globalPromptDesc")}</p>
          <textarea
            id="global-system-prompt"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={4}
            placeholder={t("settings.prompts.globalPlaceholder")}
            className="w-full px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors resize-y min-h-[80px]"
          />
          {systemPrompt !== "" && (
            <button
              onClick={() => setSystemPrompt("")}
              className="text-xs text-accent hover:text-accent-hover transition-colors"
            >
              {t("settings.prompts.resetBtn")}
            </button>
          )}
        </div>
      </SettingsPanel>
    </>
  );
};
