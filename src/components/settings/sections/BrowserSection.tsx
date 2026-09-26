import { useRef, useEffect } from "react";
import { Loader2, Plus } from "lucide-react";
import { SearchApiCard } from "../components/SearchApiCard";
import { FetchApiCard } from "../components/FetchApiCard";
import { SettingsEmptyState, SettingsHeaderButton, SettingsSectionHeader } from "../components/SettingsPrimitives";
import { ConnectionStatus, SearchApiConfig, FetchApiConfig } from "../../../types";
import { useTranslation } from "../../../utils/i18n";

interface BrowserSectionProps {
  searchConfigs: SearchApiConfig[];
  updateSearchConfig: (id: string, updates: Partial<SearchApiConfig>) => void;
  deleteSearchConfig: (id: string) => void;
  addSearchConfig: () => void;
  searchApiKeys: Record<string, string>;
  searchStatuses: Record<string, ConnectionStatus>;
  checkSearchConnections: () => Promise<void>;

  fetchConfigs: FetchApiConfig[];
  updateFetchConfig: (id: string, updates: Partial<FetchApiConfig>) => void;
  deleteFetchConfig: (id: string) => void;
  addFetchConfig: () => void;
  fetchStatuses: Record<string, ConnectionStatus>;
  checkFetchConnections: () => Promise<void>;
}

export const BrowserSection = ({
  searchConfigs,
  updateSearchConfig,
  deleteSearchConfig,
  addSearchConfig,
  searchApiKeys,
  searchStatuses,
  checkSearchConnections,
  fetchConfigs,
  updateFetchConfig,
  deleteFetchConfig,
  addFetchConfig,
  fetchStatuses,
  checkFetchConnections,
}: BrowserSectionProps) => {
  const { t } = useTranslation();
  const prevSearchIdsRef = useRef<string[]>(searchConfigs.map((c) => c.id));
  const prevFetchIdsRef = useRef<string[]>(fetchConfigs.map((c) => c.id));
  const checkingSearchConnections = Object.values(searchStatuses).some((status) => status === "connecting");
  const checkingFetchConnections = Object.values(fetchStatuses).some((status) => status === "connecting");

  useEffect(() => {
    const currentIds = searchConfigs.map((c) => c.id);
    const prevIds = prevSearchIdsRef.current;
    const addedId = currentIds.find((id) => !prevIds.includes(id));
    if (addedId) {
      setTimeout(() => {
        const element = document.getElementById(`search-card-${addedId}`);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }, 100);
    }
    prevSearchIdsRef.current = currentIds;
  }, [searchConfigs]);

  useEffect(() => {
    const currentIds = fetchConfigs.map((c) => c.id);
    const prevIds = prevFetchIdsRef.current;
    const addedId = currentIds.find((id) => !prevIds.includes(id));
    if (addedId) {
      setTimeout(() => {
        const element = document.getElementById(`fetch-card-${addedId}`);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }, 100);
    }
    prevFetchIdsRef.current = currentIds;
  }, [fetchConfigs]);

  return (
    <div id="setting-browser-search" className="space-y-6">
      {/* Web Search Section */}
      <div className="space-y-4">
        <SettingsSectionHeader
          title={t("settings.search.title")}
          description={`${t("settings.search.subtitle")} ${t("settings.search.testRequestNotice")}`}
          actions={
            <div className="flex shrink-0 items-center gap-2">
              <SettingsHeaderButton
                onClick={() => void checkSearchConnections()}
                ariaLabel={t("settings.search.refreshConnections")}
                disabled={checkingSearchConnections || !searchConfigs.some((config) => config.enabled)}
              >
                {checkingSearchConnections && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                <span>{t("settings.search.testConnections")}</span>
              </SettingsHeaderButton>
              <SettingsHeaderButton onClick={addSearchConfig} ariaLabel={t("settings.search.addBtn")}>
                <Plus size={14} />
                <span>{t("settings.search.addBtn")}</span>
              </SettingsHeaderButton>
            </div>
          }
        />

        <div className="space-y-4">
          {searchConfigs.map((config: SearchApiConfig) => (
            <SearchApiCard
              key={config.id}
              id={`search-card-${config.id}`}
              config={config}
              onUpdate={updateSearchConfig}
              onDelete={deleteSearchConfig}
              hasStoredApiKey={Boolean(searchApiKeys[config.id])}
              connectionStatus={searchStatuses[config.id] ?? "disconnected"}
            />
          ))}
          {searchConfigs.length === 0 && (
            <SettingsEmptyState
              message={t("settings.search.noApis")}
              description={t("settings.search.noApisDesc")}
              actionLabel={t("settings.search.addFirst")}
              onAction={addSearchConfig}
            />
          )}
        </div>
      </div>

      {/* Web Fetching Section */}
      <div className="space-y-4 pt-6 border-t border-border/50">
        <SettingsSectionHeader
          title="Web Fetching APIs"
          description={`Configure APIs for fetching page contents directly. ${t("settings.search.testRequestNotice")}`}
          actions={
            <div className="flex shrink-0 items-center gap-2">
              <SettingsHeaderButton
                onClick={() => void checkFetchConnections()}
                ariaLabel={t("settings.search.refreshFetchConnections")}
                disabled={checkingFetchConnections || !fetchConfigs.some((config) => config.enabled)}
              >
                {checkingFetchConnections && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                <span>{t("settings.search.testConnections")}</span>
              </SettingsHeaderButton>
              <SettingsHeaderButton onClick={addFetchConfig} ariaLabel="Add Fetch API">
                <Plus size={14} />
                <span>Add Fetch API</span>
              </SettingsHeaderButton>
            </div>
          }
        />

        <div className="space-y-4">
          {fetchConfigs.map((config: FetchApiConfig) => (
            <FetchApiCard
              key={config.id}
              id={`fetch-card-${config.id}`}
              config={config}
              onUpdate={updateFetchConfig}
              onDelete={deleteFetchConfig}
              hasStoredApiKey={Boolean(searchApiKeys[config.id])}
              connectionStatus={fetchStatuses[config.id] ?? "disconnected"}
            />
          ))}
          {fetchConfigs.length === 0 && (
            <SettingsEmptyState
              message="No fetch APIs configured."
              description="Add a fetch API to configure web fetching."
              actionLabel="Add your first fetch API"
              onAction={addFetchConfig}
            />
          )}
        </div>
      </div>
    </div>
  );
};
