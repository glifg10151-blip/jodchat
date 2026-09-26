import { useModelStore } from "../../../store/useModelStore";
import { endpointFieldError } from "../../../utils/endpointError";
import { EndpointError } from "./EndpointError";
import { memo, useState } from "react";
import { motion } from "motion/react";
import { Trash2, ChevronDown, AlertCircle, Sparkles } from "lucide-react";
import { ModelConfig } from "../../../types";
import { PROVIDER_PRESETS } from "../../../config/providerPresets";
import { springs, motionTokens, motionTransitions } from "../../../lib/motion-tokens";
import { isApiKeyOptionalForProvider, validateApiUrl, validateApiKey } from "../../../utils/validation";
import { formatModelName } from "../../../utils/formatModelName";
import { Switch } from "../../ui/Switch";
import { Select } from "../../ui/Select";
import { useUIStore } from "../../../store/useUIStore";
import { useTranslation } from "../../../utils/i18n";

const STATUS_KEYS: Record<string, string> = {
  disconnected: "status.disconnected",
  connecting: "status.connecting",
  connected: "status.connected",
  error: "status.error",
};

const PROVIDER_OPTIONS = PROVIDER_PRESETS.map((preset) => ({
  value: preset.providerId,
  label: preset.label,
}));

const STORED_SECRET_PLACEHOLDER = "••••••••••••";

interface ModelCardProps {
  id?: string;
  model: ModelConfig;
  onUpdate: (id: string, updates: Partial<ModelConfig>) => void;
  onDelete: (id: string) => void;
  connectionStatus: string;
}

export const ModelCard = memo(function ModelCard({ id, model, onUpdate, onDelete, connectionStatus }: ModelCardProps) {
  const { t } = useTranslation();
  const connectionError = useModelStore((s) => s.modelErrors[model.id]);
  const endpointError = endpointFieldError(model.apiBase, connectionStatus, connectionError);
  const urlValidation = validateApiUrl(model.apiBase);
  const keyValidation = validateApiKey(model.apiKey, model.provider);
  const isApiKeyOptional = isApiKeyOptionalForProvider(model.provider);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isSparkleAnimating, setIsSparkleAnimating] = useState(false);
  const disableBgActivity = useUIStore((s) => s.disableBgActivity);
  const hasStoredApiKey = model.apiKey === STORED_SECRET_PLACEHOLDER;

  const handleAutoGenerateName = () => {
    if (!model.modelId) return;
    const generated = formatModelName(model.modelId);
    if (generated) {
      onUpdate(model.id, { name: generated });
    }
    setIsSparkleAnimating(true);
    setTimeout(() => setIsSparkleAnimating(false), 500);
  };

  return (
    <motion.div
      id={id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTransitions.content}
      className={`bg-surface border rounded-xl p-4 space-y-3 shadow-sm relative group ${model.enabled !== false ? "border-border" : "border-border opacity-60"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">{t("settings.models.enabled")}</p>
          <p className="text-xs text-text-muted mt-0.5">{t("settings.models.enabledDesc")}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Switch
            checked={model.enabled !== false}
            onChange={(checked) => onUpdate(model.id, { enabled: checked })}
            ariaLabel={`Enable model ${model.name}`}
          />
          <motion.button
            onClick={() => onDelete(model.id)}
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            transition={springs.snappy}
            className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label={`Delete model ${model.name}`}
          >
            <Trash2 size={16} />
          </motion.button>
        </div>
      </div>

      <div className="space-y-3">
        {!disableBgActivity && (
          <div className="flex items-center gap-2 mb-2">
            <div
              className={`w-2 h-2 rounded-full ${
                connectionStatus === "connected"
                  ? "bg-green-500"
                  : connectionStatus === "connecting"
                    ? "bg-yellow-400 animate-pulse"
                    : connectionStatus === "error"
                      ? "bg-red-500"
                      : "bg-gray-400"
              }`}
              aria-label={`Status: ${connectionStatus}`}
            />
            <span className="text-[11px] text-text-muted capitalize">
              {t(STATUS_KEYS[connectionStatus]) || connectionStatus}
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted" htmlFor={`model-name-${model.id}`}>
              {t("settings.models.name")}
            </label>
            <div className="relative">
              <input
                id={`model-name-${model.id}`}
                type="text"
                value={model.name}
                onChange={(e) => onUpdate(model.id, { name: e.target.value })}
                onBlur={() => {
                  if (!model.name.trim() && model.modelId) {
                    const generated = formatModelName(model.modelId);
                    if (generated) onUpdate(model.id, { name: generated });
                  }
                }}
                placeholder={formatModelName(model.modelId) || "e.g. My Llama 3"}
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
                className="w-full h-10 px-3 py-2 pr-9 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors"
              />
              {model.modelId && (
                <motion.button
                  type="button"
                  onClick={handleAutoGenerateName}
                  whileHover={{ scale: motionTokens.scale.pop }}
                  whileTap={{ scale: motionTokens.scale.press }}
                  transition={springs.snappy}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-text-muted hover:text-accent hover:bg-accent/10 transition-colors flex items-center justify-center cursor-pointer"
                  title={t("settings.models.generateNameTooltip")}
                  aria-label={t("settings.models.generateNameTooltip")}
                >
                  <motion.div
                    animate={
                      isSparkleAnimating
                        ? {
                            rotate: [0, -25, 25, -15, 15, 0],
                            scale: [1, 1.35, 0.9, 1.2, 1],
                          }
                        : { rotate: 0, scale: 1 }
                    }
                    transition={{ duration: 0.5, ease: "easeInOut" }}
                    className="flex items-center justify-center"
                  >
                    <Sparkles size={15} />
                  </motion.div>
                </motion.button>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted" htmlFor={`model-provider-${model.id}-trigger`}>
              {t("settings.models.preset")}
            </label>
            <Select
              id={`model-provider-${model.id}`}
              value={model.provider || "custom"}
              options={PROVIDER_OPTIONS}
              onChange={(providerId) => {
                const preset = PROVIDER_PRESETS.find((candidate) => candidate.providerId === providerId);
                if (preset) {
                  const newModelId = preset.defaultModel || model.modelId;
                  const newName = formatModelName(newModelId) || preset.label;
                  onUpdate(model.id, {
                    provider: preset.providerId,
                    apiBase: preset.apiBase || model.apiBase,
                    modelId: newModelId,
                    name: newName,
                  });
                } else {
                  onUpdate(model.id, { provider: providerId });
                }
              }}
              aria-label={t("settings.models.preset")}
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-text-muted" htmlFor={`model-api-${model.id}`}>
            {t("settings.models.apiBase")}
          </label>
          <input
            id={`model-api-${model.id}`}
            type="url"
            aria-invalid={!!endpointError}
            aria-describedby={endpointError ? `endpoint-error-${model.id}` : undefined}
            value={model.apiBase}
            onChange={(e) => onUpdate(model.id, { apiBase: e.target.value })}
            placeholder="https://api.openai.com/v1/chat/completions"
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
            className={`w-full h-10 px-3 py-2 rounded-lg border bg-input text-sm text-text-primary placeholder-text-muted font-mono text-xs focus:outline-none transition-colors ${
              !urlValidation.valid
                ? "border-red-500/50 focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
                : "border-input-border focus:border-accent focus:ring-2 focus:ring-accent/20"
            }`}
          />
          <EndpointError id={`endpoint-error-${model.id}`} message={endpointError} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted" htmlFor={`model-id-${model.id}`}>
              {t("settings.models.modelId")}
            </label>
            <input
              id={`model-id-${model.id}`}
              type="text"
              value={model.modelId}
              onChange={(e) => {
                const newModelId = e.target.value;
                const prevGenerated = formatModelName(model.modelId);
                const currentName = model.name;
                const isCurrentNameDerivedOrEmpty =
                  !currentName ||
                  !currentName.trim() ||
                  currentName === "New Model" ||
                  currentName === prevGenerated ||
                  PROVIDER_PRESETS.some((preset) => preset.label === currentName || preset.providerId === currentName);

                const nextGenerated = formatModelName(newModelId);

                if (isCurrentNameDerivedOrEmpty && nextGenerated) {
                  onUpdate(model.id, { modelId: newModelId, name: nextGenerated });
                } else {
                  onUpdate(model.id, { modelId: newModelId });
                }
              }}
              placeholder="e.g. gpt-5.6-sol or meta/llama-3.3-70b-instruct"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              className="w-full h-10 px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted font-mono text-xs focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-text-muted" htmlFor={`model-key-${model.id}`}>
                {t("settings.models.apiKey")}
              </label>
              {hasStoredApiKey && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-600 dark:text-green-400">
                  <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                  {t("settings.models.apiKeyAdded")}
                </span>
              )}
            </div>
            <input
              id={`model-key-${model.id}`}
              type="password"
              value={hasStoredApiKey ? "" : model.apiKey}
              onChange={(e) => onUpdate(model.id, { apiKey: e.target.value })}
              placeholder={
                hasStoredApiKey
                  ? t("settings.models.apiKeyReplace")
                  : isApiKeyOptional
                    ? t("settings.models.apiKeyOptional") || "API Key (optional)"
                    : t("settings.models.apiKey")
              }
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              aria-invalid={!keyValidation.valid}
              aria-describedby={!keyValidation.valid ? `key-warning-${model.id}` : undefined}
              className={`w-full h-10 px-3 py-2 rounded-lg border bg-input text-sm text-text-primary placeholder-text-muted focus:outline-none transition-colors ${
                !keyValidation.valid
                  ? "border-yellow-500/50 focus:border-yellow-500 focus:ring-2 focus:ring-yellow-500/20"
                  : "border-input-border focus:border-accent focus:ring-2 focus:ring-accent/20"
              }`}
            />
            {!keyValidation.valid && (
              <p
                id={`key-warning-${model.id}`}
                className="flex items-center gap-1 text-[11px] text-yellow-500 mt-0.5"
                role="alert"
              >
                <AlertCircle size={11} />
                {keyValidation.warning}
              </p>
            )}
          </div>
        </div>

        <div className="border-t border-border/40 pt-3">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary hover:text-text-primary transition-colors cursor-pointer select-none"
          >
            <ChevronDown size={14} className={`transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
            <span>{t("settings.models.advanced")}</span>
          </button>

          {showAdvanced && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              transition={motionTransitions.content}
              className="mt-3 space-y-4 border-t border-border/40 pt-3"
            >
              {/* Image Support Toggle */}
              <Switch
                checked={model.supportsImages !== false}
                onChange={(checked) => onUpdate(model.id, { supportsImages: checked })}
                label={t("settings.models.supportsImages") || "Supports Image Inputs"}
                ariaLabel={`Allow image inputs for model ${model.name}`}
                description={t("settings.models.supportsImagesDesc") || "Allow sending images/files to this model"}
              />

              {/* Context Size & Max Output Size */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-text-muted" htmlFor={`model-context-${model.id}`}>
                    {t("settings.models.contextSize")}
                  </label>
                  <input
                    id={`model-context-${model.id}`}
                    type="number"
                    value={model.contextSize ?? ""}
                    onChange={(e) => {
                      const val = e.target.value ? parseInt(e.target.value) : undefined;
                      onUpdate(model.id, { contextSize: val });
                    }}
                    placeholder="e.g. 128000"
                    className="w-full h-10 px-3 py-1.5 rounded-lg border border-input-border bg-input text-xs text-text-primary placeholder-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-text-muted" htmlFor={`model-max-output-${model.id}`}>
                    {t("settings.models.maxOutput")}
                  </label>
                  <input
                    id={`model-max-output-${model.id}`}
                    type="number"
                    value={model.maxOutputTokens ?? ""}
                    onChange={(e) => {
                      const val = e.target.value ? parseInt(e.target.value) : undefined;
                      onUpdate(model.id, { maxOutputTokens: val });
                    }}
                    placeholder="e.g. 4096"
                    className="w-full h-10 px-3 py-1.5 rounded-lg border border-input-border bg-input text-xs text-text-primary placeholder-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors"
                  />
                </div>
              </div>

              {/* Temperature override */}
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="text-[11px] font-medium text-text-muted" htmlFor={`model-temp-${model.id}`}>
                    {t("settings.models.tempOverride")}
                  </label>
                  <span className="text-[10px] font-mono text-text-muted">
                    {model.temperature !== undefined
                      ? model.temperature.toFixed(2)
                      : t("settings.models.defaultTemp", { temp: "0.70" })}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    id={`model-temp-${model.id}`}
                    type="range"
                    min="0"
                    max="2"
                    step="0.05"
                    value={model.temperature ?? 0.7}
                    onChange={(e) => onUpdate(model.id, { temperature: parseFloat(e.target.value) })}
                    className="flex-1 h-1 bg-border rounded-lg appearance-none cursor-pointer accent-accent"
                  />
                  {model.temperature !== undefined && (
                    <button
                      type="button"
                      onClick={() => onUpdate(model.id, { temperature: undefined })}
                      className="text-[10px] text-accent hover:underline shrink-0"
                    >
                      {t("common.reset")}
                    </button>
                  )}
                </div>
              </div>

              {/* System Prompt Override */}
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-text-muted" htmlFor={`model-prompt-${model.id}`}>
                  {t("settings.models.sysPromptOverride")}
                </label>
                <textarea
                  id={`model-prompt-${model.id}`}
                  rows={3}
                  value={model.systemPromptOverride ?? ""}
                  onChange={(e) => onUpdate(model.id, { systemPromptOverride: e.target.value || undefined })}
                  placeholder={
                    t("settings.models.sysPromptPlaceholder") || "Leave blank to use the default system prompt"
                  }
                  className="w-full px-3 py-1.5 rounded-lg border border-input-border bg-input text-xs text-text-primary placeholder-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors resize-y font-sans leading-relaxed"
                />
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  );
});
