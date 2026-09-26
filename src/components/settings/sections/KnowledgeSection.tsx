import { useState, useEffect, type ChangeEvent } from "react";
import { Database, Plus, Trash2, FileText, HardDrive } from "lucide-react";
import { useKnowledgeStore } from "../../../store/useKnowledgeStore";
import { SettingsPanel, SettingsSectionHeader, SettingsHeaderButton } from "../components/SettingsPrimitives";
import { Select, type SelectOption } from "../../ui/Select";
import { useTranslation } from "../../../utils/i18n";
import type { EmbeddingProviderType } from "../../../types";

const EMBEDDING_OPTIONS: SelectOption[] = [
  {
    value: "ollama",
    label: "Ollama (Local / Offline)",
    description: "Runs locally via your Ollama instance",
  },
  {
    value: "openai",
    label: "OpenAI (text-embedding-3-small)",
    description: "High-performance vector embeddings via OpenAI API",
  },
  {
    value: "gemini",
    label: "Google Gemini (text-embedding-004)",
    description: "Google Gemini vector embedding endpoint",
  },
  {
    value: "custom",
    label: "Custom Endpoint",
    description: "OpenAI-compatible /v1/embeddings endpoint",
  },
  {
    value: "lexical_only",
    label: "Lexical BM25 (Zero-Embedding)",
    description: "Fast full-text SQLite FTS5 index without embedding models",
  },
];

export function KnowledgeSection() {
  const { t } = useTranslation();
  const {
    collections,
    stats,
    defaultEmbeddingConfig,
    loadCollections,
    loadStats,
    createCollection,
    deleteCollection,
    setDefaultEmbeddingConfig,
    clearAll,
  } = useKnowledgeStore();

  const [newColName, setNewColName] = useState("");
  const [newColDesc, setNewColDesc] = useState("");
  const [newColProvider] = useState<EmbeddingProviderType>("ollama");
  const [newColModel] = useState("nomic-embed-text");
  const [isCreating, setIsCreating] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  useEffect(() => {
    void loadCollections();
    void loadStats();
  }, [loadCollections, loadStats]);

  const handleCreate = async () => {
    if (!newColName.trim()) return;
    setIsCreating(true);
    await createCollection(newColName.trim(), newColDesc.trim(), newColProvider, newColModel);
    setNewColName("");
    setNewColDesc("");
    setIsCreating(false);
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div className="space-y-6">
      {/* Overview & Configuration */}
      <SettingsPanel>
        <SettingsSectionHeader
          title={t("settings.knowledge.title") || "Knowledge & RAG"}
          description={
            t("settings.knowledge.subtitle") ||
            "Local document indexing with hybrid vector embeddings and SQLite FTS5 lexical search."
          }
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 my-4">
          <div className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-hover/20">
            <Database className="w-5 h-5 text-accent" />
            <div>
              <div className="text-xs text-text-muted">{t("settings.knowledge.collections") || "Collections"}</div>
              <div className="text-lg font-semibold">{stats?.collection_count ?? collections.length}</div>
            </div>
          </div>
          <div className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-hover/20">
            <FileText className="w-5 h-5 text-accent" />
            <div>
              <div className="text-xs text-text-muted">{t("settings.knowledge.documents") || "Documents"}</div>
              <div className="text-lg font-semibold">{stats?.document_count ?? 0}</div>
            </div>
          </div>
          <div className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-hover/20">
            <HardDrive className="w-5 h-5 text-accent" />
            <div>
              <div className="text-xs text-text-muted">{t("settings.knowledge.storage") || "Database Size"}</div>
              <div className="text-lg font-semibold">{formatBytes(stats?.db_size_bytes ?? 0)}</div>
            </div>
          </div>
        </div>

        <div className="space-y-4 pt-2">
          <div>
            <label className="text-xs font-medium text-text-muted block mb-1.5">
              {t("settings.knowledge.provider") || "Default Embedding Provider"}
            </label>
            <Select
              value={defaultEmbeddingConfig.type}
              options={EMBEDDING_OPTIONS}
              onChange={(value) => {
                const type = value as EmbeddingProviderType;
                setDefaultEmbeddingConfig({
                  ...defaultEmbeddingConfig,
                  type,
                  model:
                    type === "ollama"
                      ? "nomic-embed-text"
                      : type === "openai"
                        ? "text-embedding-3-small"
                        : "text-embedding-004",
                });
              }}
            />
          </div>

          {defaultEmbeddingConfig.type === "ollama" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label htmlFor="ollama-endpoint" className="text-xs font-medium text-text-muted block mb-1">
                  Ollama Endpoint
                </label>
                <input
                  id="ollama-endpoint"
                  type="text"
                  value={defaultEmbeddingConfig.endpoint || "http://localhost:11434"}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setDefaultEmbeddingConfig({ ...defaultEmbeddingConfig, endpoint: e.target.value })
                  }
                  placeholder="http://localhost:11434"
                  className="w-full bg-input border border-border text-text-primary rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label htmlFor="ollama-embedding-model" className="text-xs font-medium text-text-muted block mb-1">
                  Embedding Model
                </label>
                <input
                  id="ollama-embedding-model"
                  type="text"
                  value={defaultEmbeddingConfig.model}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setDefaultEmbeddingConfig({ ...defaultEmbeddingConfig, model: e.target.value })
                  }
                  placeholder="nomic-embed-text"
                  className="w-full bg-input border border-border text-text-primary rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent"
                />
              </div>
            </div>
          )}

          {defaultEmbeddingConfig.type === "openai" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label htmlFor="openai-embedding-key" className="text-xs font-medium text-text-muted block mb-1">
                  OpenAI API Key
                </label>
                <input
                  id="openai-embedding-key"
                  type="password"
                  value={defaultEmbeddingConfig.api_key || ""}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setDefaultEmbeddingConfig({ ...defaultEmbeddingConfig, api_key: e.target.value })
                  }
                  placeholder="sk-..."
                  className="w-full bg-input border border-border text-text-primary rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label htmlFor="openai-embedding-model" className="text-xs font-medium text-text-muted block mb-1">
                  Model Name
                </label>
                <input
                  id="openai-embedding-model"
                  type="text"
                  value={defaultEmbeddingConfig.model}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setDefaultEmbeddingConfig({ ...defaultEmbeddingConfig, model: e.target.value })
                  }
                  placeholder="text-embedding-3-small"
                  className="w-full bg-input border border-border text-text-primary rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent"
                />
              </div>
            </div>
          )}

          {defaultEmbeddingConfig.type === "gemini" && (
            <div>
              <label htmlFor="gemini-embedding-key" className="text-xs font-medium text-text-muted block mb-1">
                Gemini API Key
              </label>
              <input
                id="gemini-embedding-key"
                type="password"
                value={defaultEmbeddingConfig.api_key || ""}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setDefaultEmbeddingConfig({ ...defaultEmbeddingConfig, api_key: e.target.value })
                }
                placeholder="AIza..."
                className="w-full bg-input border border-border text-text-primary rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent"
              />
            </div>
          )}
        </div>
      </SettingsPanel>

      {/* Create Collection Card */}
      <SettingsPanel>
        <SettingsSectionHeader
          title={t("settings.knowledge.createTitle") || "Create Collection"}
          description={
            t("settings.knowledge.createSubtitle") || "Organize documents into dedicated topic or project indexes."
          }
        />

        <div className="space-y-3 pt-2">
          <div>
            <label className="text-xs font-medium text-text-muted mb-1 block">
              {t("settings.knowledge.nameLabel") || "Collection Name"}
            </label>
            <input
              type="text"
              value={newColName}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNewColName(e.target.value)}
              placeholder={t("settings.knowledge.namePlaceholder") || "e.g. API Documentation, Research Papers, Notes"}
              className="w-full bg-input border border-border text-text-primary rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-text-muted mb-1 block">
              {t("settings.knowledge.descLabel") || "Description (Optional)"}
            </label>
            <input
              type="text"
              value={newColDesc}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNewColDesc(e.target.value)}
              placeholder={t("settings.knowledge.descPlaceholder") || "Brief summary of documents in this collection"}
              className="w-full bg-input border border-border text-text-primary rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex justify-end pt-2">
            <SettingsHeaderButton onClick={handleCreate} disabled={isCreating || !newColName.trim()}>
              <Plus className="w-4 h-4 mr-1" />
              {isCreating
                ? t("settings.knowledge.creatingBtn") || "Creating..."
                : t("settings.knowledge.createBtn") || "Create Collection"}
            </SettingsHeaderButton>
          </div>
        </div>
      </SettingsPanel>

      {/* Existing Collections List */}
      <SettingsPanel>
        <SettingsSectionHeader
          title={t("settings.knowledge.manageTitle") || "Collections"}
          description={t("settings.knowledge.manageSubtitle") || "View and manage indexed document collections."}
        />

        {collections.length === 0 ? (
          <div className="text-center py-6 text-text-muted text-sm border border-dashed border-border rounded-xl">
            {t("settings.knowledge.empty") || "No collections created yet."}
          </div>
        ) : (
          <div className="space-y-2.5 pt-2">
            {collections.map((col) => (
              <div
                key={col.id}
                className="flex items-center justify-between p-4 rounded-xl border border-border bg-input/40"
              >
                <div>
                  <div className="font-medium text-sm text-text-primary">{col.name}</div>
                  {col.description && <div className="text-xs text-text-muted mt-0.5">{col.description}</div>}
                  <div className="flex items-center gap-3 text-xs text-text-muted/80 mt-2">
                    <span>{col.document_count} documents</span>
                    <span>•</span>
                    <span>{col.chunk_count} chunks</span>
                    <span>•</span>
                    <span>
                      {col.embedding_provider} ({col.embedding_model})
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => deleteCollection(col.id)}
                  className="p-2 text-text-muted hover:text-red-500 rounded-lg hover:bg-red-500/10 transition-colors"
                  title="Delete Collection"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </SettingsPanel>

      {/* Database Maintenance */}
      <SettingsPanel>
        <SettingsSectionHeader
          title={t("settings.knowledge.maintenanceTitle") || "Database Maintenance"}
          description={t("settings.knowledge.maintenanceSubtitle") || "Reset and compact local SQLite vector storage."}
        />

        <div className="flex items-center justify-between pt-2">
          <div>
            <div className="font-medium text-sm text-text-primary">
              {t("settings.knowledge.clearAllTitle") || "Clear All Knowledge Data"}
            </div>
            <div className="text-xs text-text-muted mt-0.5">
              {t("settings.knowledge.clearAllDesc") ||
                "Permanently deletes all collections, document indexes, and vector embeddings."}
            </div>
          </div>
          {showClearConfirm ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-3 py-1.5 border border-border rounded-lg text-xs text-text-muted hover:bg-hover"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void clearAll();
                  setShowClearConfirm(false);
                }}
                className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs hover:bg-red-600 font-medium"
              >
                {t("settings.knowledge.confirmClearBtn") || "Confirm Delete All"}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowClearConfirm(true)}
              className="px-3 py-1.5 text-red-400 border border-red-500/30 rounded-lg text-xs hover:bg-red-500/10 font-medium"
            >
              {t("settings.knowledge.clearBtn") || "Clear Storage"}
            </button>
          )}
        </div>
      </SettingsPanel>
    </div>
  );
}
