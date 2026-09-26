import { useEffect, useState } from "react";
import { useWhisperStore } from "../../../store/useWhisperStore";
import { WHISPER_PRESETS } from "../../../config/whisperPresets";
import { invoke } from "@tauri-apps/api/core";
import {
  Download,
  Trash2,
  Check,
  FileCheck,
  Info,
  Loader2,
  Globe,
  X,
  Cloud,
  Cpu,
  Settings2,
  Sparkles,
} from "lucide-react";
import { Select } from "../../ui/Select";
import { useTranslation } from "../../../utils/i18n";
import {
  SettingsDisclosure,
  SettingsSectionHeader,
  SettingsToggle,
  SettingsTogglePanel,
} from "../components/SettingsPrimitives";
import { useModelStore } from "../../../store/useModelStore";
import { useShallow } from "zustand/react/shallow";

export function WhisperSection() {
  const { t } = useTranslation();
  const {
    isVoiceEnabled,
    selectedModelId,
    customModelPath,
    language,
    downloadedFiles,
    isDownloading,
    downloadProgress,
    downloadingModelId,
    toggleVoiceEnabled,
    selectModel,
    setCustomModelPath,
    setLanguage,
    downloadModel,
    cancelDownload,
    deleteModel,
    init,
    sttProvider,
    cloudApiKey,
    cloudApiKeyConfigured,
    cloudApiUrl,
    cloudModel,
    isLlmPolishEnabled,
    refinementModelId,
    setSttProvider,
    setCloudApiKey,
    setCloudApiUrl,
    setCloudModel,
    setIsLlmPolishEnabled,
    setRefinementModelId,
  } = useWhisperStore(
    useShallow((state) => ({
      isVoiceEnabled: state.isVoiceEnabled,
      selectedModelId: state.selectedModelId,
      customModelPath: state.customModelPath,
      language: state.language,
      downloadedFiles: state.downloadedFiles,
      isDownloading: state.isDownloading,
      downloadProgress: state.downloadProgress,
      downloadingModelId: state.downloadingModelId,
      toggleVoiceEnabled: state.toggleVoiceEnabled,
      selectModel: state.selectModel,
      setCustomModelPath: state.setCustomModelPath,
      setLanguage: state.setLanguage,
      downloadModel: state.downloadModel,
      cancelDownload: state.cancelDownload,
      deleteModel: state.deleteModel,
      init: state.init,
      sttProvider: state.sttProvider,
      cloudApiKey: state.cloudApiKey,
      cloudApiKeyConfigured: state.cloudApiKeyConfigured,
      cloudApiUrl: state.cloudApiUrl,
      cloudModel: state.cloudModel,
      isLlmPolishEnabled: state.isLlmPolishEnabled,
      refinementModelId: state.refinementModelId,
      setSttProvider: state.setSttProvider,
      setCloudApiKey: state.setCloudApiKey,
      setCloudApiUrl: state.setCloudApiUrl,
      setCloudModel: state.setCloudModel,
      setIsLlmPolishEnabled: state.setIsLlmPolishEnabled,
      setRefinementModelId: state.setRefinementModelId,
    })),
  );

  const models = useModelStore((s) => s.models);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    init();
  }, [init]);

  const handlePickLocal = async () => {
    try {
      const selected = await invoke<string | null>("import_custom_whisper_model");
      if (selected) {
        setCustomModelPath(selected);
      }
    } catch {
      setErrorMsg(t("settings.voice.pickerError"));
    }
  };

  const activeModelPath = () => {
    if (selectedModelId === "custom" && customModelPath) {
      return `Unverified custom model: ${customModelPath}`;
    }
    const preset = WHISPER_PRESETS.find((p) => p.id === selectedModelId);
    if (preset) {
      const isDownloaded = downloadedFiles.includes(preset.fileName);
      if (isDownloaded) {
        return `whisper_models/${preset.fileName}`;
      }
    }
    return t("settings.voice.statusNotLoaded");
  };

  return (
    <div id="setting-whisper-voice" className="space-y-6">
      <SettingsSectionHeader title={t("settings.voice.title")} description={t("settings.voice.subtitle")} />

      <SettingsTogglePanel
        checked={isVoiceEnabled}
        onChange={toggleVoiceEnabled}
        label={t("settings.voice.enable")}
        description={t("settings.voice.enableDesc")}
        contentClassName="space-y-4"
      >
        <div className="flex flex-col gap-1.5">
          <div
            id="voice-stt-engine-label"
            className="text-xs font-semibold text-text-secondary flex items-center gap-1.5"
          >
            <Settings2 size={13} />
            <span>Speech-to-Text Engine</span>
          </div>
          <div
            className="flex bg-surface border border-border/85 rounded-lg p-1 gap-1"
            role="group"
            aria-labelledby="voice-stt-engine-label"
          >
            <button
              onClick={() => setSttProvider("cloud")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-xs font-medium transition-colors ${
                sttProvider === "cloud"
                  ? "bg-accent text-accent-foreground"
                  : "text-text-secondary hover:bg-hover hover:text-text-primary"
              }`}
            >
              <Cloud size={14} />
              <span>Cloud API (Fast)</span>
            </button>
            <button
              onClick={() => setSttProvider("local")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-xs font-medium transition-colors ${
                sttProvider === "local"
                  ? "bg-accent text-accent-foreground"
                  : "text-text-secondary hover:bg-hover hover:text-text-primary"
              }`}
            >
              <Cpu size={14} />
              <span>Local CPU</span>
            </button>
          </div>
        </div>

        {sttProvider === "cloud" && (
          <div className="bg-surface border border-border/60 rounded-xl p-3 space-y-3 mt-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="voice-cloud-api-url" className="text-xs font-semibold text-text-secondary">
                OpenAI-Compatible API URL
              </label>
              <input
                id="voice-cloud-api-url"
                type="text"
                value={cloudApiUrl}
                onChange={(e) => setCloudApiUrl(e.target.value)}
                placeholder="https://api.groq.com/openai/v1/audio/transcriptions"
                className="w-full h-10 text-xs bg-input border border-input-border rounded-lg p-2 text-text-primary outline-none focus:border-accent"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="voice-cloud-api-key" className="text-xs font-semibold text-text-secondary">
                API Key
              </label>
              <input
                id="voice-cloud-api-key"
                type="password"
                value={cloudApiKey}
                onChange={(e) => setCloudApiKey(e.target.value)}
                placeholder={cloudApiKeyConfigured ? "Stored securely — enter a new key to replace" : "gsk_..."}
                className="w-full h-10 text-xs bg-input border border-input-border rounded-lg p-2 text-text-primary outline-none focus:border-accent"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="voice-cloud-model" className="text-xs font-semibold text-text-secondary">
                STT Model ID
              </label>
              <input
                id="voice-cloud-model"
                type="text"
                value={cloudModel}
                onChange={(e) => setCloudModel(e.target.value)}
                placeholder="whisper-large-v3"
                className="w-full h-10 text-xs bg-input border border-input-border rounded-lg p-2 text-text-primary outline-none focus:border-accent"
              />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="voice-language-trigger"
            className="text-xs font-semibold text-text-secondary flex items-center gap-1.5"
          >
            <Globe size={13} />
            <span>{t("settings.voice.language")}</span>
          </label>
          <Select
            id="voice-language"
            value={language}
            onChange={setLanguage}
            options={[
              { value: "en", label: t("settings.voice.langEn", { defaultValue: "English (default)" }) },
              { value: "es", label: t("settings.voice.langEs", { defaultValue: "Spanish" }) },
              { value: "fr", label: t("settings.voice.langFr", { defaultValue: "French" }) },
              { value: "de", label: t("settings.voice.langDe", { defaultValue: "German" }) },
              { value: "it", label: t("settings.voice.langIt", { defaultValue: "Italian" }) },
              { value: "ja", label: t("settings.voice.langJa", { defaultValue: "Japanese" }) },
              { value: "zh", label: t("settings.voice.langZh", { defaultValue: "Chinese" }) },
              { value: "auto", label: t("settings.voice.languageAuto") },
            ]}
            size="compact"
            aria-label={t("settings.voice.language")}
          />
        </div>

        <SettingsToggle
          checked={isLlmPolishEnabled}
          onChange={setIsLlmPolishEnabled}
          label={t("settings.voice.llmPolish")}
          description={t("settings.voice.llmPolishDesc")}
        >
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="voice-refinement-model-trigger"
              className="text-xs font-semibold text-text-secondary flex items-center gap-1.5"
            >
              <Sparkles size={13} />
              <span>{t("settings.voice.refinementModel")}</span>
            </label>
            <Select
              id="voice-refinement-model"
              value={refinementModelId || ""}
              onChange={(value) => setRefinementModelId(value || null)}
              options={[
                { value: "", label: t("settings.voice.activeChatModel") },
                ...models
                  .filter((model) => model.enabled !== false)
                  .map((model) => ({ value: model.id, label: model.name })),
              ]}
              size="compact"
              aria-label={t("settings.voice.refinementModel")}
            />
          </div>
        </SettingsToggle>
      </SettingsTogglePanel>

      <SettingsDisclosure open={isVoiceEnabled && sttProvider === "local"}>
        <div className="space-y-6">
          {/* Active Model Status */}
          <div className="bg-surface-elevated border border-border/60 rounded-xl p-4">
            <h4 className="text-xs font-semibold text-text-secondary mb-2 uppercase tracking-wider">
              {t("settings.voice.activeConfig", { defaultValue: "Active Configuration" })}
            </h4>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-border/30">
                <span className="text-text-muted">
                  {t("settings.voice.selectedMode", { defaultValue: "Selected Mode:" })}
                </span>
                <span className="font-medium text-text-primary">
                  {selectedModelId === "custom"
                    ? t("settings.voice.customLocalFile", { defaultValue: "Custom Local File" })
                    : (() => {
                        const preset = WHISPER_PRESETS.find((p) => p.id === selectedModelId);
                        if (!preset) return t("settings.voice.none", { defaultValue: "None" });
                        const isDownloaded = downloadedFiles.includes(preset.fileName);
                        return isDownloaded ? preset.name : `${preset.name} (${t("settings.voice.notDownloaded")})`;
                      })()}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-text-muted">
                  {t("settings.voice.modelPath", { defaultValue: "Model Path:" })}
                </span>
                <span
                  className={`font-mono truncate max-w-[320px] ${
                    activeModelPath() === t("settings.voice.statusNotLoaded")
                      ? "text-red-500 font-medium"
                      : "text-text-muted"
                  }`}
                  title={activeModelPath()}
                >
                  {activeModelPath()}
                </span>
              </div>
            </div>
          </div>

          {/* Model Management Lists */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                {t("settings.voice.availableModels", { defaultValue: "Available Models" })}
              </h4>
              <button
                onClick={handlePickLocal}
                className="text-xs text-accent hover:underline flex items-center gap-1 font-medium bg-transparent border-0 cursor-pointer"
              >
                <FileCheck size={13} />
                <span>{t("settings.voice.customPath")}</span>
              </button>
            </div>

            <div className="space-y-2">
              {WHISPER_PRESETS.map((model) => {
                const isDownloaded = downloadedFiles.includes(model.fileName);
                const isSelected = selectedModelId === model.id;
                const isThisDownloading = downloadingModelId === model.id;

                return (
                  <div
                    key={model.id}
                    className={`flex items-center justify-between p-3.5 bg-surface border rounded-xl transition-[color,background-color,border-color,box-shadow,opacity,transform] ${
                      isSelected ? "border-accent/40 bg-accent-soft/10" : "border-border/60 hover:bg-hover/30"
                    }`}
                  >
                    <div className="space-y-1 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-text-primary">{model.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 font-medium rounded-full bg-surface-elevated border border-border/80 text-text-muted">
                          {model.size}
                        </span>
                      </div>
                      <p className="text-xs text-text-muted leading-relaxed">{model.description}</p>
                    </div>

                    <div className="shrink-0 flex items-center gap-2">
                      {isThisDownloading ? (
                        <div className="flex items-center gap-2">
                          <div className="flex flex-col items-end gap-1.5">
                            <div className="flex items-center gap-1.5 text-xs text-accent font-medium">
                              <Loader2 size={13} className="animate-spin" />
                              <span>{t("settings.voice.downloading", { progress: String(downloadProgress) })}</span>
                            </div>
                            <div className="w-24 bg-chat h-1.5 rounded-full overflow-hidden flex justify-start">
                              <div className="bg-accent h-full" style={{ width: `${downloadProgress}%` }} />
                            </div>
                          </div>
                          <button
                            onClick={() => cancelDownload()}
                            className="p-1.5 rounded-lg border border-border text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                            title={t("settings.voice.cancelBtn")}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : isDownloaded ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => selectModel(model.id)}
                            disabled={isSelected}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-[color,background-color,border-color,box-shadow,opacity,transform] ${
                              isSelected
                                ? "bg-active text-text-primary border border-accent/30"
                                : "bg-surface border border-border hover:bg-hover hover:text-text-primary cursor-pointer"
                            }`}
                          >
                            {isSelected && <Check size={12} className="text-accent" />}
                            <span>
                              {isSelected
                                ? t("settings.marketplace.active")
                                : t("settings.voice.selectBtn", { defaultValue: "Select" })}
                            </span>
                          </button>
                          <button
                            onClick={() => {
                              if (
                                window.confirm(
                                  t("settings.voice.deleteConfirm", {
                                    name: model.name,
                                    defaultValue: `Delete ${model.name}? You will need to redownload it to use it again.`,
                                  }),
                                )
                              ) {
                                deleteModel(model.fileName);
                              }
                            }}
                            className="p-2 rounded-lg border border-border text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                            title={t("settings.voice.deleteBtn")}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => downloadModel(model.id)}
                          disabled={isDownloading}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent text-accent-foreground hover:bg-accent-hover transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                          <Download size={13} />
                          <span>{t("settings.voice.downloadBtn")}</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </SettingsDisclosure>

      {errorMsg && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-xs text-red-500 flex items-start gap-2">
          <Info size={14} className="shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  );
}
