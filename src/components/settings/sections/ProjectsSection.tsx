import { ShieldAlert } from "lucide-react";
import { useProjectStore } from "../../../store/useProjectStore";
import { useGitStore } from "../../../store/useGitStore";
import type { ProjectPermission } from "../../../types";
import { useTranslation } from "../../../utils/i18n";
import { SettingsSectionHeader, SettingsTogglePanel } from "../components/SettingsPrimitives";
import { useShallow } from "zustand/react/shallow";

export function ProjectsSection() {
  const { t } = useTranslation();
  const { isProjectsEnabled, defaultPermission, setIsProjectsEnabled, setDefaultPermission } = useProjectStore(
    useShallow((state) => ({
      isProjectsEnabled: state.isProjectsEnabled,
      defaultPermission: state.defaultPermission,
      setIsProjectsEnabled: state.setIsProjectsEnabled,
      setDefaultPermission: state.setDefaultPermission,
    })),
  );
  const { gitConfig, updateGitConfig } = useGitStore(
    useShallow((state) => ({ gitConfig: state.config, updateGitConfig: state.updateConfig })),
  );

  const handleToggleDefaultPermission = (perm: ProjectPermission) => {
    if (perm === "full") {
      const confirmed = window.confirm(
        t("settings.projects.fullShellWarningConfirm", {
          defaultValue:
            "WARNING: Setting the global default to Full Shell gives the AI complete access to run arbitrary shell commands on your system for all new projects. Continue?",
        }),
      );
      if (!confirmed) return;
    }
    setDefaultPermission(perm);
  };

  return (
    <div id="setting-projects-config" className="space-y-6">
      <SettingsSectionHeader title={t("settings.projects.title")} description={t("settings.projects.subtitle")} />

      <SettingsTogglePanel
        checked={isProjectsEnabled}
        onChange={setIsProjectsEnabled}
        label={t("settings.projects.enable")}
        description={t("settings.projects.enableDesc")}
        contentClassName="space-y-4"
      >
        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider block">
          {t("settings.projects.globalPermission")}
        </h4>
        <p className="text-xs text-text-muted">{t("settings.projects.globalPermissionDesc")}</p>
        <div className="grid grid-cols-3 gap-2 pt-1">
          <button
            type="button"
            onClick={() => handleToggleDefaultPermission("read")}
            className={`py-2 px-3 rounded-lg border text-center transition-[color,background-color,border-color,box-shadow,transform] flex flex-col items-center gap-1 ${
              defaultPermission === "read"
                ? "border-accent bg-accent-soft/20 text-accent font-medium"
                : "border-border bg-surface text-text-secondary hover:bg-hover"
            }`}
          >
            <span className="text-xs">{t("settings.projects.readOnly")}</span>
            <span className="text-[9px] opacity-75">{t("settings.projects.readOnlyDesc")}</span>
          </button>
          <button
            type="button"
            onClick={() => handleToggleDefaultPermission("write")}
            className={`py-2 px-3 rounded-lg border text-center transition-[color,background-color,border-color,box-shadow,transform] flex flex-col items-center gap-1 ${
              defaultPermission === "write"
                ? "border-amber-500 bg-amber-500/10 text-amber-500 font-medium"
                : "border-border bg-surface text-text-secondary hover:bg-hover"
            }`}
          >
            <span className="text-xs">{t("settings.projects.readWrite")}</span>
            <span className="text-[9px] opacity-75">{t("settings.projects.readWriteDesc")}</span>
          </button>
          <button
            type="button"
            onClick={() => handleToggleDefaultPermission("full")}
            className={`py-2 px-3 rounded-lg border text-center transition-[color,background-color,border-color,box-shadow,transform] flex flex-col items-center gap-1 ${
              defaultPermission === "full"
                ? "border-red-500 bg-red-500/10 text-red-500 font-medium"
                : "border-border bg-surface text-text-secondary hover:bg-hover"
            }`}
          >
            <span className="text-xs">{t("settings.projects.fullShell")}</span>
            <span className="text-[9px] opacity-75">{t("settings.projects.fullShellDesc")}</span>
          </button>
        </div>

        {defaultPermission === "full" && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-2.5 text-xs text-red-600 dark:text-red-400">
            <ShieldAlert size={16} className="shrink-0 mt-0.5 text-red-500" />
            <div>
              <span className="font-semibold block mb-0.5">{t("settings.projects.warningTitle")}</span>
              {t("settings.projects.warningDesc")}
            </div>
          </div>
        )}
      </SettingsTogglePanel>

      <SettingsTogglePanel
        checked={gitConfig.overrideIdentity}
        onChange={(overrideIdentity) => updateGitConfig({ overrideIdentity })}
        label={t("settings.projects.identityTitle")}
        description={t("settings.projects.overrideIdentityDesc")}
        contentClassName="grid grid-cols-1 gap-4 sm:grid-cols-2"
      >
        <div className="space-y-1.5">
          <label className="text-[10px] font-medium text-text-muted">{t("settings.projects.authorName")}</label>
          <input
            type="text"
            value={gitConfig.gitName}
            onChange={(e) => updateGitConfig({ gitName: e.target.value })}
            className="w-full h-10 px-3 py-1.5 rounded-lg border border-input-border bg-input text-sm text-text-primary focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-medium text-text-muted">{t("settings.projects.authorEmail")}</label>
          <input
            type="email"
            value={gitConfig.gitEmail}
            onChange={(e) => updateGitConfig({ gitEmail: e.target.value })}
            className="w-full h-10 px-3 py-1.5 rounded-lg border border-input-border bg-input text-sm text-text-primary focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors"
          />
        </div>
      </SettingsTogglePanel>
    </div>
  );
}
