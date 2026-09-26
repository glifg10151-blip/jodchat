import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { ShieldCheck, ShieldAlert, FileText, Trash2, Camera, Network } from "lucide-react";
import { Switch } from "../../ui/Switch";
import { Select } from "../../ui/Select";
import { ConfirmModal } from "../../ui/Modal";
import { useUIStore } from "../../../store/useUIStore";
import { useAppshotStore } from "../../../store/useAppshotStore";
import { useChatStore } from "../../../store/useChatStore";
import { clearLogs } from "../../../utils/logger";
import {
  DEFAULT_BLOCKED_HOSTS,
  resumeConversationPersistenceAfterFailedWipe,
  suspendConversationPersistenceForWipe,
  suspendPreferencePersistenceForWipe,
  resumePreferencePersistenceAfterFailedWipe,
  resetPreferenceCacheAfterWipe,
} from "../../../utils/storage";
import { invoke } from "@tauri-apps/api/core";
import { springs, motionTokens } from "../../../lib/motion-tokens";
import { useTranslation } from "../../../utils/i18n";
import { SettingsPanel, SettingsSectionHeader, SettingsToggle } from "../components/SettingsPrimitives";
import { useShallow } from "zustand/react/shallow";

export function PrivacySection() {
  const { t } = useTranslation();
  const isLoggingEnabled = useUIStore((s) => s.isLoggingEnabled);
  const setIsLoggingEnabled = useUIStore((s) => s.setIsLoggingEnabled);
  const logBuffer = useUIStore((s) => s.logBuffer);
  const addToast = useUIStore((s) => s.addToast);

  const disableBgActivity = useUIStore((s) => s.disableBgActivity);
  const setDisableBgActivity = useUIStore((s) => s.setDisableBgActivity);
  const blockedHosts = useUIStore((s) => s.blockedHosts);
  const setBlockedHosts = useUIStore((s) => s.setBlockedHosts);
  const allowedLocalEndpoints = useUIStore((s) => s.allowedLocalEndpoints);
  const setAllowedLocalEndpoints = useUIStore((s) => s.setAllowedLocalEndpoints);
  const offlineMode = useUIStore((s) => s.offlineMode);
  const setOfflineMode = useUIStore((s) => s.setOfflineMode);

  const [blockedHostsText, setBlockedHostsText] = useState(() => blockedHosts.join("\n"));
  const [allowedLocalEndpointsText, setAllowedLocalEndpointsText] = useState(() => allowedLocalEndpoints.join("\n"));

  useEffect(() => {
    if (document.activeElement?.tagName !== "TEXTAREA") {
      const handle = requestAnimationFrame(() => {
        setBlockedHostsText(blockedHosts.join("\n"));
      });
      return () => cancelAnimationFrame(handle);
    }
  }, [blockedHosts]);

  useEffect(() => {
    if (document.activeElement?.tagName !== "TEXTAREA") {
      const handle = requestAnimationFrame(() => {
        setAllowedLocalEndpointsText(allowedLocalEndpoints.join("\n"));
      });
      return () => cancelAnimationFrame(handle);
    }
  }, [allowedLocalEndpoints]);

  const handleBlockedHostsChange = (val: string) => {
    setBlockedHostsText(val);
    const list = val
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (JSON.stringify(list) !== JSON.stringify(blockedHosts)) {
      setBlockedHosts(list);
    }
  };

  const handleAllowedLocalEndpointsChange = (val: string) => {
    setAllowedLocalEndpointsText(val);
    const list = val
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean);
    if (JSON.stringify(list) !== JSON.stringify(allowedLocalEndpoints)) {
      setAllowedLocalEndpoints(list);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === " ") {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const val = target.value;
      const newVal = val.substring(0, start) + "\n" + val.substring(end);

      setBlockedHostsText(newVal);
      const list = newVal
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (JSON.stringify(list) !== JSON.stringify(blockedHosts)) {
        setBlockedHosts(list);
      }

      setTimeout(() => {
        target.selectionStart = target.selectionEnd = start + 1;
      }, 0);
    }
  };

  const {
    appshotConfig,
    recentAppshots,
    initAppshot,
    updateAppshotConfig,
    clearAllAppshots,
    hasAppshotPermission,
    isRequestingAppshotPermission,
    checkAppshotPermission,
    requestAppshotPermission,
    openAppshotPermissionSettings,
  } = useAppshotStore(
    useShallow((state) => ({
      appshotConfig: state.config,
      recentAppshots: state.recentAppshots,
      initAppshot: state.init,
      updateAppshotConfig: state.updateConfig,
      clearAllAppshots: state.clearAll,
      hasAppshotPermission: state.hasPermission,
      isRequestingAppshotPermission: state.isRequestingPermission,
      checkAppshotPermission: state.checkPermission,
      requestAppshotPermission: state.requestPermission,
      openAppshotPermissionSettings: state.openPermissionSettings,
    })),
  );

  const [isConfirmWipe1Open, setIsConfirmWipe1Open] = useState(false);
  const [isConfirmWipe2Open, setIsConfirmWipe2Open] = useState(false);

  useEffect(() => {
    initAppshot();
  }, [initAppshot]);

  useEffect(() => {
    const refreshPermission = () => {
      void checkAppshotPermission();
    };
    window.addEventListener("focus", refreshPermission);
    return () => window.removeEventListener("focus", refreshPermission);
  }, [checkAppshotPermission]);

  const handleAppshotPermissionAction = async () => {
    try {
      const granted = await requestAppshotPermission();
      addToast(
        t(granted ? "settings.privacy.permGranted" : "settings.privacy.permissionRequested"),
        granted ? "success" : "info",
      );
    } catch (permissionError) {
      addToast(
        t("settings.privacy.permissionActionFailed", {
          error: permissionError instanceof Error ? permissionError.message : String(permissionError),
        }),
        "error",
      );
    }
  };

  const handleOpenAppshotPermissionSettings = async () => {
    try {
      await openAppshotPermissionSettings();
      addToast(t("settings.privacy.settingsOpened"), "info");
    } catch (permissionError) {
      addToast(
        t("settings.privacy.permissionActionFailed", {
          error: permissionError instanceof Error ? permissionError.message : String(permissionError),
        }),
        "error",
      );
    }
  };

  const handleClearLogs = () => {
    clearLogs();
    addToast(t("settings.privacy.clearLogsSuccess"), "success");
  };

  const handleWipeData = async () => {
    setIsConfirmWipe2Open(false);
    const failures: string[] = [];
    let persistentWipeSucceeded = false;
    useChatStore.getState().stopStreaming();
    await suspendConversationPersistenceForWipe();
    await suspendPreferencePersistenceForWipe();

    // Appshots may include a user-selected folder, so they remain a separate
    // operation. A failure here must not prevent credentials and chats from
    // being wiped.
    try {
      await invoke("wipe_appshot_data", {
        customFolder: appshotConfig.captureFolder || null,
      });
    } catch (error) {
      console.error("Failed to wipe Appshots:", error);
      failures.push(error instanceof Error ? error.message : String(error));
    }

    // Rust owns the ordered legacy-vault -> encrypted data -> root-key wipe.
    // so secret indices cannot disappear before their credentials are removed.
    try {
      await invoke("wipe_config_files");
      persistentWipeSucceeded = true;
    } catch (error) {
      console.error("Failed to wipe persistent app data:", error);
      failures.push(error instanceof Error ? error.message : String(error));
    }

    if (persistentWipeSucceeded) {
      resetPreferenceCacheAfterWipe();
      localStorage.clear();
      clearLogs();
      useUIStore.setState({ hasStarted: false, animationsDisabled: false });
      document.documentElement.classList.remove("animations-disabled");
      if (failures.length === 0) {
        window.location.reload();
      } else {
        addToast(`${t("settings.privacy.wipeDataFailed")} ${failures.join("; ")}`, "error");
        window.setTimeout(() => window.location.reload(), 1500);
      }
      return;
    }

    resumeConversationPersistenceAfterFailedWipe();
    resumePreferencePersistenceAfterFailedWipe();
    addToast(`${t("settings.privacy.wipeDataFailed")} ${failures.join("; ")}`, "error");
  };

  return (
    <div id="setting-privacy-network" className="space-y-6">
      <SettingsSectionHeader title={t("settings.privacy.title")} description={t("settings.privacy.subtitle")} />

      {/* 1. Credential encryption and local storage status */}
      <SettingsPanel>
        <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider">
          {t("settings.privacy.dataSecurity")}
        </h4>
        <p className="text-xs text-text-secondary leading-relaxed">{t("settings.privacy.dataSecurityDesc")}</p>
        <div className="flex items-start gap-3 p-3 bg-emerald-500/10 dark:bg-emerald-500/5 border border-emerald-500/20 rounded-lg text-emerald-700 dark:text-emerald-400 text-xs">
          <ShieldCheck size={18} className="shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold block mb-0.5">{t("settings.privacy.keychainTitle")}</span>
            <span className="opacity-90">{t("settings.privacy.keychainDesc")}</span>
          </div>
        </div>
      </SettingsPanel>

      {/* 2. Event Logging Control */}
      <SettingsPanel>
        <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider">
          {t("settings.privacy.loggingTitle")}
        </h4>
        <div className="space-y-4 pt-1">
          <Switch
            checked={isLoggingEnabled}
            onChange={setIsLoggingEnabled}
            label={t("settings.privacy.enableLogging")}
            description={t("settings.privacy.enableLoggingDesc")}
          />
          <div className="h-px bg-border/50" />
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-1">
            <div>
              <span className="text-sm font-medium text-text-primary block">{t("settings.privacy.wipeLogTitle")}</span>
              <span className="text-xs text-text-muted">
                {t("settings.privacy.wipeLogDesc", { count: String(logBuffer.length) })}
              </span>
            </div>
            <motion.button
              type="button"
              onClick={handleClearLogs}
              whileHover={{ scale: motionTokens.scale.pop }}
              whileTap={{ scale: motionTokens.scale.press }}
              transition={springs.snappy}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-input hover:bg-hover border border-border text-text-primary text-sm font-medium transition-colors shadow-sm min-h-[40px] shrink-0"
            >
              <FileText size={16} />
              <span>{t("settings.privacy.clearLogsBtn")}</span>
            </motion.button>
          </div>
        </div>
      </SettingsPanel>

      {/* 3. Appshot Privacy Settings */}
      <SettingsPanel>
        <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider">
          {t("settings.privacy.screenTitle")}
        </h4>
        <div className="space-y-4 pt-1">
          <Switch
            checked={appshotConfig.enabled && hasAppshotPermission === true}
            onChange={(val) => updateAppshotConfig({ enabled: val })}
            disabled={hasAppshotPermission !== true}
            label={t("settings.privacy.enableScreen")}
            description={t("settings.privacy.enableScreenDesc")}
          />

          {hasAppshotPermission === false && (
            <div className="bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 rounded-xl p-4 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
              <div className="flex items-start gap-2.5">
                <ShieldAlert size={18} className="shrink-0 mt-0.5 text-amber-500" />
                <div>
                  <span className="font-semibold block mb-0.5 text-sm text-amber-700 dark:text-amber-300">
                    {t("settings.privacy.screenPermRequired")}
                  </span>
                  <span className="opacity-90 leading-relaxed block">{t("settings.privacy.screenPermDesc")}</span>
                  <span className="opacity-75 leading-relaxed block mt-1.5 font-medium">
                    {t("settings.privacy.screenPermNote")}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-2 self-stretch sm:self-center">
                <motion.button
                  whileHover={{ scale: motionTokens.scale.pop }}
                  whileTap={{ scale: motionTokens.scale.press }}
                  transition={springs.snappy}
                  className="rounded-lg bg-amber-500 px-4 py-2 text-center font-medium text-white shadow-sm transition-colors hover:bg-amber-600"
                  onClick={handleAppshotPermissionAction}
                  disabled={isRequestingAppshotPermission}
                >
                  {isRequestingAppshotPermission
                    ? t("settings.privacy.checkingPermission")
                    : t("settings.privacy.grantPermissionBtn")}
                </motion.button>
                <button
                  type="button"
                  className="px-3 py-1 text-center font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-300"
                  onClick={handleOpenAppshotPermissionSettings}
                >
                  {t("settings.privacy.openSettingsBtn")}
                </button>
              </div>
            </div>
          )}

          <div className="h-px bg-border/50" />

          <SettingsToggle
            checked={appshotConfig.autoCleanEnabled}
            onChange={(autoCleanEnabled) => updateAppshotConfig({ autoCleanEnabled })}
            label={t("settings.privacy.pruneScreen")}
            description={t("settings.privacy.pruneScreenDesc")}
            contentClassName="grid grid-cols-1 gap-4 sm:grid-cols-2"
          >
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-text-muted">{t("settings.privacy.pruningRule")}</label>
              <Select
                value={appshotConfig.autoCleanType}
                onChange={(value) => updateAppshotConfig({ autoCleanType: value as "count" | "size" | "age" })}
                options={[
                  { value: "count", label: t("settings.privacy.keepMaxCount") },
                  { value: "size", label: t("settings.privacy.limitFolderSize") },
                  { value: "age", label: t("settings.privacy.limitFileAge") },
                ]}
                aria-label={t("settings.privacy.pruningRule")}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-text-muted">{t("settings.privacy.limitValue")}</label>
              <input
                type="number"
                min="1"
                value={appshotConfig.autoCleanValue}
                onChange={(e) => updateAppshotConfig({ autoCleanValue: parseInt(e.target.value, 10) || 1 })}
                className="w-full h-10 px-3 py-1.5 rounded-lg border border-input-border bg-input text-sm text-text-primary focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors"
              />
            </div>
          </SettingsToggle>

          <div className="h-px bg-border/50" />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-1">
            <div>
              <span className="text-sm font-medium text-text-primary block">
                {t("settings.privacy.wipeGalleryTitle")}
              </span>
              <span className="text-xs text-text-muted">
                {t("settings.privacy.wipeGalleryDesc", { count: String(recentAppshots.length) })}
              </span>
            </div>
            <motion.button
              type="button"
              onClick={() => clearAllAppshots()}
              disabled={recentAppshots.length === 0}
              whileHover={recentAppshots.length > 0 ? { scale: motionTokens.scale.pop } : undefined}
              whileTap={recentAppshots.length > 0 ? { scale: motionTokens.scale.press } : undefined}
              transition={springs.snappy}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-red-500/20 text-red-500 hover:bg-red-500/5 text-sm font-medium transition-colors shadow-sm min-h-[40px] disabled:opacity-40 disabled:cursor-not-allowed shrink-0 font-medium"
            >
              <Camera size={16} />
              <span>{t("settings.privacy.clearGalleryBtn")}</span>
            </motion.button>
          </div>
        </div>
      </SettingsPanel>

      {/* Network Settings */}
      <SettingsPanel>
        <div className="flex items-center gap-2">
          <Network size={16} className="text-text-muted" />
          <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider">
            {t("settings.privacy.networkTitle")}
          </h4>
        </div>
        <div className="space-y-4 pt-1">
          <Switch
            checked={disableBgActivity}
            onChange={setDisableBgActivity}
            label={t("settings.privacy.disableBg")}
            description={t("settings.privacy.disableBgDesc")}
          />
          <div className="h-px bg-border/50" />
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-text-primary block">{t("settings.privacy.blockedHosts")}</span>
              <button
                type="button"
                onClick={() => handleBlockedHostsChange(DEFAULT_BLOCKED_HOSTS.join("\n"))}
                className="text-xs text-accent hover:text-accent-hover font-semibold transition-colors flex items-center gap-1 cursor-pointer select-none"
              >
                {t("settings.privacy.resetBlockedHostsBtn") || "Reset to Defaults"}
              </button>
            </div>
            <span className="text-xs text-text-muted block">{t("settings.privacy.blockedHostsDesc")}</span>
            <textarea
              value={blockedHostsText}
              onChange={(e) => handleBlockedHostsChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("settings.privacy.blockedHostsPlaceholder")}
              rows={4}
              className="w-full px-3 py-2 mt-1 rounded-lg border border-input-border bg-input text-sm text-text-primary focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors font-mono"
            />
          </div>
          <div className="h-px bg-border/50" />
          <div className="space-y-1">
            <span className="text-sm font-medium text-text-primary block">
              {t("settings.privacy.allowedLocalEndpoints")}
            </span>
            <span className="text-xs text-text-muted block">{t("settings.privacy.allowedLocalEndpointsDesc")}</span>
            <textarea
              value={allowedLocalEndpointsText}
              onChange={(event) => handleAllowedLocalEndpointsChange(event.target.value)}
              placeholder={t("settings.privacy.allowedLocalEndpointsPlaceholder")}
              rows={3}
              className="w-full px-3 py-2 mt-1 rounded-lg border border-input-border bg-input text-sm text-text-primary focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors font-mono"
            />
          </div>
          <div className="h-px bg-border/50" />
          <Switch
            checked={offlineMode}
            onChange={setOfflineMode}
            label={t("settings.privacy.offlineMode")}
            description={t("settings.privacy.offlineModeDesc")}
          />
        </div>
      </SettingsPanel>

      {/* 4. Data destruct */}
      <SettingsPanel className="border-red-500/20 dark:border-red-500/10">
        <h4 className="text-xs font-medium text-red-500 uppercase tracking-wider">
          {t("settings.privacy.dangerZone")}
        </h4>
        <div className="space-y-4 pt-1">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-1">
            <div>
              <span className="text-sm font-medium text-text-primary block">{t("settings.privacy.wipeAllData")}</span>
              <span className="text-xs text-text-muted">{t("settings.privacy.wipeAllDataDesc")}</span>
            </div>
            <motion.button
              type="button"
              onClick={() => setIsConfirmWipe1Open(true)}
              whileHover={{ scale: motionTokens.scale.pop }}
              whileTap={{ scale: motionTokens.scale.press }}
              transition={springs.snappy}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-600 dark:text-red-400 text-sm font-medium transition-colors shadow-sm min-h-[40px] shrink-0 font-medium"
            >
              <Trash2 size={16} />
              <span>{t("settings.privacy.wipeDataBtn")}</span>
            </motion.button>
          </div>
        </div>
      </SettingsPanel>

      {/* Double Confirmation Modals */}
      <ConfirmModal
        isOpen={isConfirmWipe1Open}
        title={t("settings.privacy.confirmResetTitle")}
        message={t("settings.privacy.confirmResetMessage")}
        confirmText={t("settings.privacy.proceed")}
        cancelText={t("common.cancel")}
        onConfirm={() => {
          setIsConfirmWipe1Open(false);
          setIsConfirmWipe2Open(true);
        }}
        onCancel={() => setIsConfirmWipe1Open(false)}
        variant="danger"
      />

      <ConfirmModal
        isOpen={isConfirmWipe2Open}
        title={t("settings.privacy.finalWarningTitle")}
        message={t("settings.privacy.finalWarningMessage")}
        confirmText={t("settings.privacy.eraseAllData")}
        cancelText={t("settings.privacy.keepData")}
        onConfirm={handleWipeData}
        onCancel={() => setIsConfirmWipe2Open(false)}
        variant="danger"
      />
    </div>
  );
}
