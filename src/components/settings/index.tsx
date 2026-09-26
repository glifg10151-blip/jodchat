import { useState, useCallback } from "react";
import { motion } from "motion/react";
import { Plus } from "lucide-react";
import { useModelStore } from "../../store/useModelStore";
import { useSearchStore } from "../../store/useSearchStore";
import { useMcpStore } from "../../store/useMcpStore";
import { useUIStore } from "../../store/useUIStore";
import { useChatStore } from "../../store/useChatStore";
import { McpServerConfig } from "../../types";
import { McpServerPreset } from "../../config/mcpPresets";
import { springs, motionTokens, motionTransitions } from "../../lib/motion-tokens";

import { GeneralSection } from "./sections/GeneralSection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { MarketplaceSection } from "./sections/MarketplaceSection";
import { ConfigurationSection } from "./sections/ConfigurationSection";
import { PersonalizationSection } from "./sections/PersonalizationSection";
import { ModelsSection } from "./sections/ModelsSection";
import { BrowserSection } from "./sections/BrowserSection";
import { McpSection } from "./sections/McpSection";
import { LogsSection } from "./sections/LogsSection";
import { KeybindsSection } from "./sections/KeybindsSection";
import { ProjectsSection } from "./sections/ProjectsSection";
import { AppshotsSection } from "./sections/AppshotsSection";
import { PrivacySection } from "./sections/PrivacySection";
import { WhisperSection } from "./sections/WhisperSection";
import { SkillsSection } from "./sections/SkillsSection";
import { KnowledgeSection } from "./sections/KnowledgeSection";
import { DataTransferSection } from "./sections/DataTransferSection";
import { PluginsSection } from "./sections/PluginsSection";
import { SectionId } from "./types";
import { useTranslation } from "../../utils/i18n";

export default function Settings() {
  const isMac = typeof window !== "undefined" && window.navigator.userAgent.includes("Mac");
  const models = useModelStore((s) => s.models);
  const temperature = useModelStore((s) => s.temperature);
  const maxToolSteps = useModelStore((s) => s.maxToolSteps);
  const unlimitedToolSteps = useModelStore((s) => s.unlimitedToolSteps);
  const modelStatuses = useModelStore((s) => s.modelStatuses);
  const titleConfig = useModelStore((s) => s.titleConfig);
  const setTemperature = useModelStore((s) => s.setTemperature);
  const setMaxToolSteps = useModelStore((s) => s.setMaxToolSteps);
  const setUnlimitedToolSteps = useModelStore((s) => s.setUnlimitedToolSteps);
  const updateModel = useModelStore((s) => s.updateModel);
  const deleteModel = useModelStore((s) => s.deleteModel);
  const addModel = useModelStore((s) => s.addModel);
  const checkModelConnections = useModelStore((s) => s.checkModelConnections);
  const setTitleConfig = useModelStore((s) => s.setTitleConfig);

  const searchConfigs = useSearchStore((s) => s.searchConfigs);
  const activeSearchId = useSearchStore((s) => s.activeSearchId);
  const setActiveSearchId = useSearchStore((s) => s.setActiveSearchId);
  const updateSearchConfig = useSearchStore((s) => s.updateSearchConfig);
  const deleteSearchConfig = useSearchStore((s) => s.deleteSearchConfig);
  const addSearchConfig = useSearchStore((s) => s.addSearchConfig);
  const searchApiKeys = useSearchStore((s) => s.searchApiKeys);
  const searchStatuses = useSearchStore((s) => s.searchStatuses);
  const checkSearchConnections = useSearchStore((s) => s.checkSearchConnections);

  const fetchConfigs = useSearchStore((s) => s.fetchConfigs);
  const activeFetchId = useSearchStore((s) => s.activeFetchId);
  const setActiveFetchId = useSearchStore((s) => s.setActiveFetchId);
  const updateFetchConfig = useSearchStore((s) => s.updateFetchConfig);
  const deleteFetchConfig = useSearchStore((s) => s.deleteFetchConfig);
  const addFetchConfig = useSearchStore((s) => s.addFetchConfig);
  const fetchStatuses = useSearchStore((s) => s.fetchStatuses);
  const checkFetchConnections = useSearchStore((s) => s.checkFetchConnections);

  const mcpConfigs = useMcpStore((s) => s.mcpConfigs);
  const serverStatuses = useMcpStore((s) => s.serverStatuses);
  const availableTools = useMcpStore((s) => s.availableTools);
  const envSecrets = useMcpStore((s) => s.envSecrets);
  const addMcpConfig = useMcpStore((s) => s.addMcpConfig);
  const updateMcpConfig = useMcpStore((s) => s.updateMcpConfig);
  const deleteMcpConfig = useMcpStore((s) => s.deleteMcpConfig);
  const toggleServerEnabled = useMcpStore((s) => s.toggleServerEnabled);
  const setEnvSecrets = useMcpStore((s) => s.setEnvSecrets);
  const checkCommand = useMcpStore((s) => s.checkCommand);

  const theme = useUIStore((s) => s.theme);
  const animationsDisabled = useUIStore((s) => s.animationsDisabled);
  const loading = useUIStore((s) => s.loading);
  const setTheme = useUIStore((s) => s.setTheme);
  const setAnimationsDisabled = useUIStore((s) => s.setAnimationsDisabled);
  const setView = useUIStore((s) => s.setView);
  const addToast = useUIStore((s) => s.addToast);
  const activeSection = useUIStore((s) => s.activeSection) as SectionId;
  const { t } = useTranslation();

  const logBuffer = useUIStore((s) => s.logBuffer);
  const logFilterSource = useUIStore((s) => s.logFilterSource);
  const logFilterLevel = useUIStore((s) => s.logFilterLevel);
  const setLogFilterSource = useUIStore((s) => s.setLogFilterSource);
  const setLogFilterLevel = useUIStore((s) => s.setLogFilterLevel);

  const newChat = useChatStore((s) => s.newChat);

  const [showMcpKeys, setShowMcpKeys] = useState<Record<string, boolean>>({});
  const [scrollParent, setScrollParent] = useState<HTMLDivElement | null>(null);

  const toggleMcpKeyVisibility = (id: string) => {
    setShowMcpKeys((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleApplyPreset = useCallback(
    (preset: McpServerPreset, currentConfig: McpServerConfig) => {
      const isPristine =
        (currentConfig.command ?? "").trim() === "" &&
        (currentConfig.args ?? []).length === 0 &&
        currentConfig.name === "New MCP Server";
      if (!isPristine) {
        const ok = window.confirm(
          `Apply the "${preset.name}" template? This will replace the current command, arguments, and environment variables.`,
        );
        if (!ok) return;
      }
      updateMcpConfig(currentConfig.id, {
        name: preset.name,
        transport: "stdio",
        command: preset.command,
        args: [...preset.args],
      });
      if (preset.envKeys && preset.envKeys.length > 0) {
        const existing = envSecrets[currentConfig.id] ?? {};
        const merged = { ...existing };
        for (const k of preset.envKeys) {
          if (!(k in merged)) merged[k] = "";
        }
        setEnvSecrets(currentConfig.id, merged);
      }
      useUIStore.getState().addToast(`Applied "${preset.name}" template`, "info");
    },
    [envSecrets, updateMcpConfig, setEnvSecrets],
  );

  const handleCreateChat = () => {
    const id = newChat();
    setView("chat");
    return id;
  };

  const handleRefreshConnections = () => {
    checkModelConnections(undefined, true);
  };

  return (
    <main className="minimal-focus flex-1 flex flex-col min-w-0 overflow-hidden" aria-label="Settings">
      <header
        className="shrink-0 flex items-center justify-end px-4 py-4 md:px-6 h-14"
        data-tauri-drag-region={isMac ? true : undefined}
      >
        <motion.button
          onClick={handleCreateChat}
          whileHover={{ scale: motionTokens.scale.pop }}
          whileTap={{ scale: motionTokens.scale.press }}
          transition={springs.snappy}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent text-accent-foreground hover:bg-accent-hover border border-accent text-sm font-medium transition-colors"
          aria-label={t("common.newChat")}
        >
          <Plus size={16} />
          <span>{t("common.newChat")}</span>
        </motion.button>
      </header>

      <div className="flex-1 flex min-w-0 overflow-hidden">
        <div ref={setScrollParent} className="flex-1 min-h-0 overflow-y-scroll">
          <motion.div
            key={activeSection}
            className="max-w-2xl mx-auto px-4 md:px-8 py-8 space-y-6"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={motionTransitions.content}
          >
            {activeSection === "general" && <GeneralSection />}

            {activeSection === "appearance" && (
              <AppearanceSection
                theme={theme}
                setTheme={setTheme}
                animationsDisabled={animationsDisabled}
                setAnimationsDisabled={setAnimationsDisabled}
              />
            )}

            {activeSection === "privacy" && <PrivacySection />}

            {activeSection === "marketplace" && <MarketplaceSection />}

            {activeSection === "keybinds" && <KeybindsSection />}

            {activeSection === "appshots" && <AppshotsSection />}

            {activeSection === "configuration" && (
              <ConfigurationSection
                searchConfigs={searchConfigs}
                activeSearchId={activeSearchId}
                setActiveSearchId={setActiveSearchId}
                fetchConfigs={fetchConfigs}
                activeFetchId={activeFetchId}
                setActiveFetchId={setActiveFetchId}
                temperature={temperature}
                setTemperature={setTemperature}
                addToast={addToast}
                maxToolSteps={maxToolSteps}
                setMaxToolSteps={setMaxToolSteps}
                unlimitedToolSteps={unlimitedToolSteps}
                setUnlimitedToolSteps={setUnlimitedToolSteps}
              />
            )}

            {activeSection === "personalization" && (
              <PersonalizationSection
                titleConfig={titleConfig}
                setTitleConfig={setTitleConfig}
                enabledModels={models.filter((m) => m.enabled !== false)}
              />
            )}

            {activeSection === "models" && (
              <ModelsSection
                models={models}
                modelStatuses={modelStatuses}
                updateModel={updateModel}
                deleteModel={deleteModel}
                addModel={addModel}
                handleRefreshConnections={handleRefreshConnections}
                loadingCheckConnection={loading.checkConnection}
              />
            )}

            {activeSection === "projects" && <ProjectsSection />}

            {activeSection === "browser" && (
              <BrowserSection
                searchConfigs={searchConfigs}
                updateSearchConfig={updateSearchConfig}
                deleteSearchConfig={deleteSearchConfig}
                addSearchConfig={addSearchConfig}
                searchApiKeys={searchApiKeys}
                searchStatuses={searchStatuses}
                checkSearchConnections={checkSearchConnections}
                fetchConfigs={fetchConfigs}
                updateFetchConfig={updateFetchConfig}
                deleteFetchConfig={deleteFetchConfig}
                addFetchConfig={addFetchConfig}
                fetchStatuses={fetchStatuses}
                checkFetchConnections={checkFetchConnections}
              />
            )}

            {activeSection === "plugins" && <PluginsSection />}

            {activeSection === "mcp" && (
              <McpSection
                mcpConfigs={mcpConfigs}
                serverStatuses={serverStatuses}
                availableTools={availableTools}
                envSecrets={envSecrets}
                updateMcpConfig={updateMcpConfig}
                deleteMcpConfig={deleteMcpConfig}
                connectServer={(id) => void toggleServerEnabled(id, true)}
                disconnectServer={(id) => void toggleServerEnabled(id, false)}
                setEnvSecrets={setEnvSecrets}
                checkCommand={checkCommand}
                handleApplyPreset={handleApplyPreset}
                showMcpKeys={showMcpKeys}
                toggleMcpKeyVisibility={toggleMcpKeyVisibility}
                addMcpConfig={addMcpConfig}
              />
            )}

            {activeSection === "logs" && (
              <LogsSection
                logBuffer={logBuffer}
                logFilterSource={logFilterSource}
                logFilterLevel={logFilterLevel}
                setLogFilterSource={setLogFilterSource}
                setLogFilterLevel={setLogFilterLevel}
              />
            )}

            {activeSection === "whisper" && <WhisperSection />}

            {activeSection === "skills" && <SkillsSection scrollParent={scrollParent} />}

            {activeSection === "knowledge" && <KnowledgeSection />}
            {activeSection === "data_transfer" && <DataTransferSection />}
          </motion.div>
        </div>
      </div>
    </main>
  );
}
