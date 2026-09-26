import { useRef, useEffect, useState } from "react";
import { motion } from "motion/react";
import { Plus, Loader2 } from "lucide-react";
import { ModelCard } from "../components/ModelCard";
import { SettingsEmptyState, SettingsHeaderButton, SettingsSectionHeader } from "../components/SettingsPrimitives";
import { ConfirmModal } from "../../ui/Modal";
import { springs, motionTokens } from "../../../lib/motion-tokens";
import { ModelConfig, ConnectionStatus } from "../../../types";
import { useTranslation } from "../../../utils/i18n";

interface ModelsSectionProps {
  models: ModelConfig[];
  modelStatuses: Record<string, ConnectionStatus>;
  updateModel: (id: string, updates: Partial<ModelConfig>) => void;
  deleteModel: (id: string) => void;
  addModel: () => void;
  handleRefreshConnections: () => void;
  loadingCheckConnection: boolean;
}

export const ModelsSection = ({
  models,
  modelStatuses,
  updateModel,
  deleteModel,
  addModel,
  handleRefreshConnections,
  loadingCheckConnection,
}: ModelsSectionProps) => {
  const { t } = useTranslation();
  const [modelToDelete, setModelToDelete] = useState<ModelConfig | null>(null);
  const prevIdsRef = useRef<string[]>(models.map((m) => m.id));

  useEffect(() => {
    const currentIds = models.map((m) => m.id);
    const prevIds = prevIdsRef.current;
    const addedId = currentIds.find((id) => !prevIds.includes(id));
    if (addedId) {
      setTimeout(() => {
        const element = document.getElementById(`model-card-${addedId}`);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }, 100);
    }
    prevIdsRef.current = currentIds;
  }, [models]);

  return (
    <div id="setting-models-providers" className="space-y-6">
      <SettingsSectionHeader
        title={t("settings.models.title")}
        description={t("settings.models.subtitle")}
        actions={
          <div className="flex items-center gap-2">
            <motion.button
              onClick={handleRefreshConnections}
              disabled={loadingCheckConnection}
              whileHover={{ scale: motionTokens.scale.pop }}
              whileTap={{ scale: motionTokens.scale.press }}
              transition={springs.snappy}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-hover border border-border text-xs transition-colors min-h-[44px]"
              aria-label="Refresh connection status"
            >
              {loadingCheckConnection ? <Loader2 size={14} className="animate-spin" /> : null}
              {t("settings.models.refresh")}
            </motion.button>
            <SettingsHeaderButton onClick={addModel} ariaLabel="Add provider">
              <Plus size={14} />
              <span>{t("settings.models.addProvider")}</span>
            </SettingsHeaderButton>
          </div>
        }
      />

      <div className="space-y-4">
        {models.map((model: ModelConfig) => (
          <ModelCard
            key={model.id}
            id={`model-card-${model.id}`}
            model={model}
            onUpdate={updateModel}
            onDelete={() => setModelToDelete(model)}
            connectionStatus={modelStatuses[model.id] ?? "disconnected"}
          />
        ))}
        {models.length === 0 && (
          <SettingsEmptyState
            message={t("settings.models.noProviders")}
            actionLabel={t("settings.models.addProvider")}
            onAction={addModel}
          />
        )}
      </div>

      <ConfirmModal
        isOpen={!!modelToDelete}
        title={t("settings.models.deleteTitle")}
        message={t("settings.models.deleteMessage", { name: modelToDelete?.name || "" })}
        confirmText={t("common.delete")}
        cancelText={t("common.cancel")}
        onConfirm={() => {
          if (modelToDelete) {
            deleteModel(modelToDelete.id);
            setModelToDelete(null);
          }
        }}
        onCancel={() => setModelToDelete(null)}
        variant="danger"
      />
    </div>
  );
};
