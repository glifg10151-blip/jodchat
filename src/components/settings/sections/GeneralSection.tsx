import { motion } from "motion/react";
import { Switch } from "../../ui/Switch";
import { Select } from "../../ui/Select";
import { Spinner } from "../../ui/Spinner";
import { useUIStore } from "../../../store/useUIStore";
import { springs, motionTokens } from "../../../lib/motion-tokens";
import { useTranslation } from "../../../utils/i18n";
import { useAppVersion } from "../../../hooks/useAppVersion";
import { SettingsPanel, SettingsSectionHeader } from "../components/SettingsPrimitives";

export function GeneralSection() {
  const { t, language: selectedLang, supportedLanguages } = useTranslation();

  const alwaysOnTop = useUIStore((s) => s.alwaysOnTop);
  const setAlwaysOnTop = useUIStore((s) => s.setAlwaysOnTop);
  const closeToTray = useUIStore((s) => s.closeToTray);
  const setCloseToTray = useUIStore((s) => s.setCloseToTray);
  const launchOnStartup = useUIStore((s) => s.launchOnStartup);
  const setLaunchOnStartup = useUIStore((s) => s.setLaunchOnStartup);

  const sendMessageShortcut = useUIStore((s) => s.sendMessageShortcut);
  const setSendMessageShortcut = useUIStore((s) => s.setSendMessageShortcut);
  const clearInputOnEscape = useUIStore((s) => s.clearInputOnEscape);
  const setClearInputOnEscape = useUIStore((s) => s.setClearInputOnEscape);
  const baseTextSize = useUIStore((s) => s.baseTextSize);
  const setBaseTextSize = useUIStore((s) => s.setBaseTextSize);
  const showContextWindow = useUIStore((s) => s.showContextWindow);
  const setShowContextWindow = useUIStore((s) => s.setShowContextWindow);
  const contextTokenizationMode = useUIStore((s) => s.contextTokenizationMode);
  const setContextTokenizationMode = useUIStore((s) => s.setContextTokenizationMode);

  const autoUpdateChecking = useUIStore((s) => s.autoUpdateChecking);
  const setAutoUpdateChecking = useUIStore((s) => s.setAutoUpdateChecking);
  const isCheckingUpdates = useUIStore((s) => s.isCheckingUpdates);
  const checkForUpdates = useUIStore((s) => s.checkForUpdates);

  const setLanguage = useUIStore((s) => s.setLanguage);

  const appVersion = useAppVersion();

  const textSizes = [
    { value: "small", label: t("general.textSizeSmall") },
    { value: "medium", label: t("general.textSizeMedium") },
    { value: "large", label: t("general.textSizeLarge") },
    { value: "xlarge", label: t("general.textSizeXLarge") },
  ] as const;

  const handleCheckUpdates = () => {
    checkForUpdates(false);
  };

  return (
    <>
      <SettingsSectionHeader title={t("general.title")} description={t("general.subtitle")} />

      {/* Language Section */}
      <SettingsPanel id="setting-general-language">
        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">{t("general.language")}</h4>
        <div className="space-y-2 pt-1">
          <label htmlFor="language-select-trigger" className="text-sm font-medium text-text-primary block">
            {t("general.language")}
          </label>
          <p className="text-xs text-text-muted mb-2">{t("general.languageDesc")}</p>
          <Select
            id="language-select"
            value={selectedLang}
            onChange={setLanguage}
            options={supportedLanguages.map((lang) => ({
              value: lang.code,
              label: lang.nativeName,
              description: lang.name,
            }))}
            aria-label="Language options"
          />
        </div>
      </SettingsPanel>

      {/* Window Behavior Section */}
      <SettingsPanel>
        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
          {t("general.windowBehavior")}
        </h4>
        <div className="space-y-4 pt-1">
          <div id="setting-general-always-on-top">
            <Switch
              checked={alwaysOnTop}
              onChange={setAlwaysOnTop}
              label={t("general.alwaysOnTop")}
              description={t("general.alwaysOnTopDesc")}
            />
          </div>
          <div id="setting-general-close-to-tray">
            <Switch
              checked={closeToTray}
              onChange={setCloseToTray}
              label={t("general.minimizeToTray")}
              description={t("general.minimizeToTrayDesc")}
            />
          </div>
          <div id="setting-general-launch-startup">
            <Switch
              checked={launchOnStartup}
              onChange={setLaunchOnStartup}
              label={t("general.launchOnStartup")}
              description={t("general.launchOnStartupDesc")}
            />
          </div>
        </div>
      </SettingsPanel>

      {/* Chat & Composition Section */}
      <SettingsPanel>
        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
          {t("general.chatComposition")}
        </h4>
        <div className="space-y-4 pt-1">
          {/* Send Message Shortcut Dropdown */}
          <div id="setting-general-shortcut" className="space-y-2">
            <label htmlFor="shortcut-select-trigger" className="text-sm font-medium text-text-primary block">
              {t("general.sendShortcut")}
            </label>
            <p className="text-xs text-text-muted mb-2">{t("general.sendShortcutDesc")}</p>
            <Select
              id="shortcut-select"
              value={sendMessageShortcut}
              onChange={(value) => setSendMessageShortcut(value as "enter" | "ctrl-enter")}
              options={[
                { value: "enter", label: t("general.shortcutEnter") },
                { value: "ctrl-enter", label: t("general.shortcutCtrlEnter") },
              ]}
              aria-label="Send message shortcut options"
            />
          </div>

          {/* Clear Input on Escape Switch */}
          <div id="setting-general-clear-escape">
            <Switch
              checked={clearInputOnEscape}
              onChange={setClearInputOnEscape}
              label={t("general.clearEscape")}
              description={t("general.clearEscapeDesc")}
            />
          </div>

          {/* Show Context Window Switch */}
          <div id="setting-general-context-window">
            <Switch
              checked={showContextWindow}
              onChange={setShowContextWindow}
              label={t("general.contextIndicator")}
              description={t("general.contextIndicatorDesc")}
            />
            <div className="mt-3 ml-0 sm:ml-11 space-y-2">
              <label
                htmlFor="context-tokenization-mode-trigger"
                className="text-sm font-medium text-text-primary block"
              >
                {t("general.contextCalculation")}
              </label>
              <p className="text-xs text-text-muted">{t("general.contextCalculationDesc")}</p>
              <Select
                id="context-tokenization-mode"
                value={contextTokenizationMode}
                onChange={(value) => setContextTokenizationMode(value as "local" | "endpoint")}
                options={[
                  {
                    value: "local",
                    label: t("general.contextCalculationLocal"),
                    description: t("general.contextCalculationLocalDesc"),
                  },
                  {
                    value: "endpoint",
                    label: t("general.contextCalculationEndpoint"),
                    description: t("general.contextCalculationEndpointDesc"),
                  },
                ]}
                aria-label={t("general.contextCalculation")}
              />
            </div>
          </div>

          {/* Base Text Size Segmented Pill Selector */}
          <div id="setting-general-text-size" className="space-y-2">
            <span className="text-sm font-medium text-text-primary block">{t("general.textSize")}</span>
            <p className="text-xs text-text-muted">{t("general.textSizeDesc")}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 bg-surface/30 border border-border/40 p-1 rounded-xl shadow-sm w-full">
              {textSizes.map((size) => {
                const isActive = baseTextSize === size.value;
                return (
                  <button
                    key={size.value}
                    type="button"
                    onClick={() => setBaseTextSize(size.value)}
                    className={`relative py-1.5 px-2 text-xs font-medium transition-colors min-h-[36px] flex items-center justify-center rounded-lg ${
                      isActive ? "text-accent-foreground font-semibold" : "text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="activeTextSize"
                        className="absolute inset-0 bg-accent rounded-lg"
                        style={{ zIndex: 0 }}
                        transition={springs.snappy}
                      />
                    )}
                    <span className="relative z-10">{size.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </SettingsPanel>

      {/* Updates & Info Section */}
      <SettingsPanel>
        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">{t("general.updatesInfo")}</h4>
        <div className="space-y-4 pt-1">
          <Switch
            checked={autoUpdateChecking}
            onChange={setAutoUpdateChecking}
            label={t("general.autoUpdate")}
            description={t("general.autoUpdateDesc")}
          />

          <div className="h-px bg-border/50" />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-text-primary">{t("general.currentVersion")}</span>
              <span className="px-2 py-0.5 rounded bg-input border border-border/60 text-xs font-mono text-text-secondary">
                {appVersion ? `v${appVersion}` : "—"}
              </span>
            </div>
            <motion.button
              type="button"
              onClick={handleCheckUpdates}
              disabled={isCheckingUpdates}
              whileHover={!isCheckingUpdates ? { scale: motionTokens.scale.pop } : undefined}
              whileTap={!isCheckingUpdates ? { scale: motionTokens.scale.press } : undefined}
              transition={springs.snappy}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-input hover:bg-hover border border-border text-text-primary text-sm font-medium transition-colors shadow-sm min-h-[40px] disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {isCheckingUpdates ? (
                <>
                  <Spinner size="sm" className="text-text-primary" />
                  <span>{t("general.checking")}</span>
                </>
              ) : (
                <span>{t("general.checkUpdates")}</span>
              )}
            </motion.button>
          </div>
        </div>
      </SettingsPanel>
    </>
  );
}
