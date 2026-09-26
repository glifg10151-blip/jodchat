import { useRef, useEffect } from "react";
import { Plus } from "lucide-react";
import { McpServerCard } from "../components/McpServerCard";
import { SettingsEmptyState, SettingsHeaderButton, SettingsSectionHeader } from "../components/SettingsPrimitives";
import { McpServerConfig, McpServerStatus, McpTool, ExecutableCheck } from "../../../types";
import { McpServerPreset } from "../../../config/mcpPresets";
import { useTranslation } from "../../../utils/i18n";

interface McpSectionProps {
  mcpConfigs: McpServerConfig[];
  serverStatuses: Record<string, McpServerStatus>;
  availableTools: McpTool[];
  envSecrets: Record<string, Record<string, string>>;
  updateMcpConfig: (id: string, updates: Partial<McpServerConfig>) => void;
  deleteMcpConfig: (id: string) => void;
  connectServer: (id: string) => void;
  disconnectServer: (id: string) => void;
  setEnvSecrets: (id: string, secrets: Record<string, string>) => void;
  checkCommand: (command: string) => Promise<ExecutableCheck>;
  handleApplyPreset: (preset: McpServerPreset, currentConfig: McpServerConfig) => void;
  showMcpKeys: Record<string, boolean>;
  toggleMcpKeyVisibility: (id: string) => void;
  addMcpConfig: () => void;
}

export const McpSection = ({
  mcpConfigs,
  serverStatuses,
  availableTools,
  envSecrets,
  updateMcpConfig,
  deleteMcpConfig,
  connectServer,
  disconnectServer,
  setEnvSecrets,
  checkCommand,
  handleApplyPreset,
  showMcpKeys,
  toggleMcpKeyVisibility,
  addMcpConfig,
}: McpSectionProps) => {
  const { t } = useTranslation();
  const prevIdsRef = useRef<string[]>(mcpConfigs.map((c) => c.id));

  useEffect(() => {
    const currentIds = mcpConfigs.map((c) => c.id);
    const prevIds = prevIdsRef.current;
    const addedId = currentIds.find((id) => !prevIds.includes(id));
    if (addedId) {
      setTimeout(() => {
        const element = document.getElementById(`mcp-card-${addedId}`);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }, 100);
    }
    prevIdsRef.current = currentIds;
  }, [mcpConfigs]);

  return (
    <div id="setting-mcp-servers" className="space-y-6">
      <SettingsSectionHeader
        title={t("settings.mcp.title")}
        description={t("settings.mcp.subtitle")}
        actions={
          <SettingsHeaderButton onClick={addMcpConfig} ariaLabel={t("settings.mcp.addBtn")}>
            <Plus size={14} />
            <span>{t("settings.mcp.addBtn")}</span>
          </SettingsHeaderButton>
        }
      />

      <div className="space-y-4">
        {mcpConfigs.map((mcpConfig: McpServerConfig) => (
          <McpServerCard
            key={mcpConfig.id}
            id={`mcp-card-${mcpConfig.id}`}
            config={mcpConfig}
            status={serverStatuses[mcpConfig.id] ?? "disconnected"}
            tools={availableTools
              .filter((t) => t.serverId === mcpConfig.id)
              .map((t) => ({ name: t.name, description: t.description }))}
            envVars={envSecrets[mcpConfig.id] ?? {}}
            onUpdate={updateMcpConfig}
            onDelete={deleteMcpConfig}
            onConnect={connectServer}
            onDisconnect={disconnectServer}
            onSetEnvVars={setEnvSecrets}
            onCheckCommand={checkCommand}
            onApplyPreset={handleApplyPreset}
            showKey={!!showMcpKeys[mcpConfig.id]}
            onToggleKey={toggleMcpKeyVisibility}
          />
        ))}
        {mcpConfigs.length === 0 && (
          <SettingsEmptyState
            message={t("settings.mcp.noServers")}
            description={t("settings.mcp.noServersDesc")}
            actionLabel={t("settings.mcp.addFirst")}
            onAction={addMcpConfig}
          />
        )}
      </div>
    </div>
  );
};
