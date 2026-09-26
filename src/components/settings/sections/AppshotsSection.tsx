import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, useReducedMotion } from "motion/react";
import { Image, Trash2, Camera, AlertCircle, Copy, Check, ChevronRight } from "lucide-react";
import { Switch } from "../../ui/Switch";
import {
  SettingsDisclosure,
  SettingsSectionHeader,
  SettingsToggle,
  SettingsTogglePanel,
} from "../components/SettingsPrimitives";
import { Select } from "../../ui/Select";
import { Spinner } from "../../ui/Spinner";
import { springs, motionTokens, motionTransitions } from "../../../lib/motion-tokens";
import { useAppshotStore } from "../../../store/useAppshotStore";
import { useKeybindStore } from "../../../store/useKeybindStore";
import { useUIStore } from "../../../store/useUIStore";
import { useTranslation } from "../../../utils/i18n";
import { getShortcutDisplayParts } from "../../../utils/shortcutDisplay";
import { useShallow } from "zustand/react/shallow";

export function AppshotsSection() {
  const { t } = useTranslation();
  const prefersReducedMotion = useReducedMotion();
  const {
    config,
    recentAppshots,
    isCapturing,
    loading,
    error,
    init,
    updateConfig,
    triggerCapture,
    deleteAppshot,
    clearAll,
    hasPermission,
    isRequestingPermission,
    checkPermission,
    requestPermission,
    openPermissionSettings,
  } = useAppshotStore(
    useShallow((state) => ({
      config: state.config,
      recentAppshots: state.recentAppshots,
      isCapturing: state.isCapturing,
      loading: state.loading,
      error: state.error,
      init: state.init,
      updateConfig: state.updateConfig,
      triggerCapture: state.triggerCapture,
      deleteAppshot: state.deleteAppshot,
      clearAll: state.clearAll,
      hasPermission: state.hasPermission,
      isRequestingPermission: state.isRequestingPermission,
      checkPermission: state.checkPermission,
      requestPermission: state.requestPermission,
      openPermissionSettings: state.openPermissionSettings,
    })),
  );
  const addToast = useUIStore((s) => s.addToast);
  const setActiveSection = useUIStore((s) => s.setActiveSection);
  const captureShortcut = useKeybindStore((s) => s.keybinds.captureAppshot.currentCombo);
  const [inputFolder, setInputFolder] = useState(config.captureFolder);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [prevFolder, setPrevFolder] = useState(config.captureFolder);

  if (config.captureFolder !== prevFolder) {
    setPrevFolder(config.captureFolder);
    setInputFolder(config.captureFolder);
  }

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    const refreshPermission = () => {
      void checkPermission();
    };
    window.addEventListener("focus", refreshPermission);
    return () => window.removeEventListener("focus", refreshPermission);
  }, [checkPermission]);

  const handlePermissionAction = async () => {
    try {
      const granted = await requestPermission();
      addToast(
        t(granted ? "settings.appshots.permGranted" : "settings.appshots.permissionRequested"),
        granted ? "success" : "info",
      );
    } catch (permissionError) {
      addToast(
        t("settings.appshots.permissionActionFailed", {
          error: permissionError instanceof Error ? permissionError.message : String(permissionError),
        }),
        "error",
      );
    }
  };

  const handleOpenPermissionSettings = async () => {
    try {
      await openPermissionSettings();
      addToast(t("settings.appshots.settingsOpened"), "info");
    } catch (permissionError) {
      addToast(
        t("settings.appshots.permissionActionFailed", {
          error: permissionError instanceof Error ? permissionError.message : String(permissionError),
        }),
        "error",
      );
    }
  };

  const handleTestCapture = async () => {
    try {
      addToast(t("settings.appshots.testingStatus"), "info");
      const result = await triggerCapture({ persistToGallery: true });
      await invoke("release_file_token", { token: result.token });
      addToast(t("settings.appshots.testSuccess", { path: result.path.slice(-40) }), "success");
    } catch (e: unknown) {
      addToast(t("settings.appshots.testFailed", { error: e instanceof Error ? e.message : String(e) }), "error");
    }
  };

  const handleCopyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    setCopiedPath(path);
    addToast(t("settings.appshots.pathCopied"), "info");
    setTimeout(() => setCopiedPath(null), 2000);
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div id="setting-appshots-config" className="space-y-6">
      <SettingsSectionHeader
        title={t("settings.appshots.title")}
        description={t("settings.appshots.subtitle")}
        actions={
          <Switch
            checked={config.enabled && hasPermission === true}
            onChange={(val) => updateConfig({ enabled: val })}
            ariaLabel={t("settings.appshots.title")}
            disabled={hasPermission !== true}
          />
        }
      />

      {hasPermission === false && (
        <div className="bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 rounded-xl p-4 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
          <div className="flex items-start gap-2.5">
            <AlertCircle size={18} className="shrink-0 mt-0.5 text-amber-500" />
            <div>
              <span className="font-semibold block mb-0.5 text-sm">{t("settings.appshots.screenPermRequired")}</span>
              <span className="opacity-90 leading-relaxed block max-w-md">{t("settings.appshots.screenPermDesc")}</span>
              <span className="opacity-75 leading-relaxed block max-w-md mt-1.5 font-medium">
                {t("settings.appshots.screenPermNote")}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2 self-stretch sm:self-center">
            <motion.button
              whileHover={{ scale: motionTokens.scale.pop }}
              whileTap={{ scale: motionTokens.scale.press }}
              transition={springs.snappy}
              className="rounded-lg bg-amber-500 px-4 py-2 text-center font-medium text-white shadow-sm transition-colors hover:bg-amber-600"
              onClick={handlePermissionAction}
              disabled={isRequestingPermission}
            >
              {isRequestingPermission
                ? t("settings.appshots.checkingPermission")
                : t("settings.appshots.grantPermissionBtn")}
            </motion.button>
            <button
              type="button"
              className="px-3 py-1 text-center font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-300"
              onClick={handleOpenPermissionSettings}
            >
              {t("settings.appshots.openSettingsBtn")}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl p-3 text-xs flex items-start gap-2.5 shadow-sm">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold block mb-0.5">{t("settings.appshots.engineError")}</span>
            <span className="opacity-90">{error}</span>
          </div>
        </div>
      )}

      <SettingsDisclosure open={config.enabled && hasPermission === true}>
        <div className="space-y-5">
          <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
            <h4 className="border-b border-border/60 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
              {t("settings.appshots.capturePrefs")}
            </h4>

            <div className="px-4">
              <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2.5">
                  <div>
                    <span className="text-sm font-medium text-text-primary">{t("settings.appshots.shortcut")}</span>
                    <span className="mt-0.5 block text-xs text-text-muted">{t("settings.appshots.shortcutDesc")}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveSection("keybinds")}
                  aria-label={t("settings.appshots.shortcutDesc")}
                  className="flex w-fit items-center gap-1 rounded-lg border border-border bg-input/40 py-1 pl-1 pr-2 text-text-secondary transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                >
                  {getShortcutDisplayParts(captureShortcut).map((key) => (
                    <kbd
                      key={key}
                      className="rounded-md border border-border bg-surface px-2 py-1 font-mono text-[11px] font-semibold shadow-sm"
                    >
                      {key}
                    </kbd>
                  ))}
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              </div>

              <div className="flex flex-col gap-3 border-t border-border/60 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <span className="text-sm font-medium text-text-primary">{t("settings.appshots.encoderFormat")}</span>
                  <span className="mt-0.5 block text-xs text-text-muted">
                    {t("settings.appshots.encoderFormatDesc")}
                  </span>
                </div>
                <div
                  className="flex gap-1 rounded-lg border border-border/50 bg-input/40 p-1"
                  role="group"
                  aria-label={t("settings.appshots.encoderFormat")}
                >
                  {(["png", "jpeg"] as const).map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => updateConfig({ imageFormat: fmt })}
                      aria-pressed={config.imageFormat === fmt}
                      className={`relative isolate min-h-8 w-14 rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-wider transition-colors ${
                        config.imageFormat === fmt ? "text-accent" : "text-text-muted hover:text-text-primary"
                      }`}
                    >
                      {config.imageFormat === fmt && (
                        <motion.span
                          layoutId="appshot-image-format-indicator"
                          initial={false}
                          transition={prefersReducedMotion ? { duration: 0 } : springs.snappy}
                          className="absolute inset-0 z-0 rounded-md border border-border/50 bg-surface shadow-sm"
                        />
                      )}
                      <span className="relative z-10">{fmt}</span>
                    </button>
                  ))}
                </div>
              </div>

              <motion.div
                initial={false}
                animate={{
                  gridTemplateRows: config.imageFormat === "jpeg" ? "1fr" : "0fr",
                  opacity: config.imageFormat === "jpeg" ? 1 : 0,
                }}
                transition={prefersReducedMotion ? { duration: 0 } : motionTransitions.content}
                aria-hidden={config.imageFormat !== "jpeg"}
                className="grid"
              >
                <div className="min-h-0 overflow-hidden">
                  <div className="flex flex-col gap-3 border-t border-border/60 py-4 sm:flex-row sm:items-center">
                    <div className="min-w-32">
                      <span className="text-sm font-medium text-text-primary">
                        {t("settings.appshots.jpegQuality")}
                      </span>
                      <span className="mt-0.5 block text-xs text-text-muted">{config.imageQuality}%</span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="100"
                      value={config.imageQuality}
                      disabled={config.imageFormat !== "jpeg"}
                      aria-label={t("settings.appshots.jpegQuality")}
                      onChange={(e) => updateConfig({ imageQuality: parseInt(e.target.value, 10) })}
                      className="w-full accent-accent bg-input rounded-lg appearance-none h-1.5"
                    />
                  </div>
                </div>
              </motion.div>
            </div>
          </section>

          <SettingsTogglePanel
            checked={config.saveToGallery}
            onChange={(saveToGallery) => updateConfig({ saveToGallery })}
            label={t("settings.appshots.galleryStorage")}
            description={t("settings.appshots.saveToGalleryDesc")}
            contentClassName="space-y-5"
          >
            <div className="space-y-2">
              <span className="text-sm font-medium text-text-primary">{t("settings.appshots.saveLocation")}</span>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inputFolder}
                  readOnly
                  aria-label={t("settings.appshots.saveLocation")}
                  className="flex-1 cursor-default rounded-lg border border-border bg-input/40 px-3 py-1.5 text-sm text-text-secondary focus:border-border focus:outline-none"
                  placeholder="Default (Sythoria app data folder)"
                />
                <motion.button
                  whileHover={{ scale: motionTokens.scale.pop }}
                  whileTap={{ scale: motionTokens.scale.press }}
                  transition={springs.snappy}
                  className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover"
                  onClick={async () => {
                    try {
                      const selected = await invoke<string | null>("select_appshot_folder");
                      if (selected) {
                        setInputFolder(selected);
                        await updateConfig({ captureFolder: selected });
                        addToast(
                          t("settings.appshots.pathUpdated", {
                            defaultValue: "Appshots capture folder path updated",
                          }),
                          "success",
                        );
                      }
                    } catch (e: unknown) {
                      addToast(e instanceof Error ? e.message : String(e), "error");
                    }
                  }}
                >
                  {t("settings.appshots.browseBtn")}
                </motion.button>
                {inputFolder && (
                  <motion.button
                    whileHover={{ scale: motionTokens.scale.pop }}
                    whileTap={{ scale: motionTokens.scale.press }}
                    transition={springs.snappy}
                    className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-500 shadow-sm transition-colors hover:bg-red-500/20"
                    onClick={async () => {
                      setInputFolder("");
                      await updateConfig({ captureFolder: "" });
                      addToast(
                        t("settings.appshots.resetFolderSuccess", {
                          defaultValue: "Reset to default secure app data folder",
                        }),
                        "success",
                      );
                    }}
                  >
                    {t("settings.appshots.clearBtn")}
                  </motion.button>
                )}
              </div>
              <p className="text-[10px] text-text-muted">{t("settings.appshots.saveLocationDesc")}</p>
            </div>

            <div className="border-t border-border/60 pt-4">
              <SettingsToggle
                checked={config.autoCleanEnabled}
                onChange={(autoCleanEnabled) => updateConfig({ autoCleanEnabled })}
                label={t("settings.appshots.autoClean")}
                description={t("settings.appshots.autoCleanDesc")}
                contentClassName="grid grid-cols-1 gap-4 sm:grid-cols-2"
              >
                <div className="space-y-1.5">
                  <label className="text-[10px] font-medium text-text-muted">{t("settings.appshots.cleanType")}</label>
                  <Select
                    value={config.autoCleanType}
                    onChange={(value) => updateConfig({ autoCleanType: value as "count" | "size" | "age" })}
                    options={[
                      { value: "count", label: t("settings.appshots.cleanTypeCount") },
                      { value: "size", label: t("settings.appshots.cleanTypeSize") },
                      { value: "age", label: t("settings.appshots.cleanTypeAge") },
                    ]}
                    aria-label={t("settings.appshots.cleanType")}
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="appshot-clean-value" className="text-[10px] font-medium text-text-muted">
                    {t("settings.appshots.cleanValue")}
                  </label>
                  <input
                    id="appshot-clean-value"
                    type="number"
                    min="1"
                    value={config.autoCleanValue}
                    onChange={(e) => updateConfig({ autoCleanValue: parseInt(e.target.value, 10) || 1 })}
                    className="w-full h-10 rounded-lg border border-input-border bg-input px-3 py-1.5 text-sm text-text-primary transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                  />
                </div>
              </SettingsToggle>
            </div>

            <div className="border-t border-border/60 pt-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h5 className="text-sm font-medium text-text-primary">{t("settings.appshots.galleryTitle")}</h5>
                  <p className="mt-0.5 text-xs text-text-muted">{t("settings.appshots.galleryDesc")}</p>
                </div>
                <div className="flex gap-2">
                  <motion.button
                    whileHover={{ scale: motionTokens.scale.pop }}
                    whileTap={{ scale: motionTokens.scale.press }}
                    transition={springs.snappy}
                    onClick={handleTestCapture}
                    disabled={isCapturing}
                    className="flex min-h-[32px] items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground shadow-sm disabled:opacity-60"
                  >
                    {isCapturing ? <Spinner size="sm" /> : <Camera size={13} />}
                    <span>
                      {isCapturing ? t("settings.appshots.testingStatus") : t("settings.appshots.testCaptureBtn")}
                    </span>
                  </motion.button>
                  {recentAppshots.length > 0 && (
                    <motion.button
                      whileHover={{ scale: motionTokens.scale.pop }}
                      whileTap={{ scale: motionTokens.scale.press }}
                      transition={springs.snappy}
                      onClick={() => clearAll()}
                      disabled={loading}
                      className="flex min-h-[32px] items-center gap-1 rounded-lg border border-red-500/20 px-3 py-1.5 text-xs font-semibold text-red-500 transition-colors hover:bg-red-500/5"
                    >
                      <Trash2 size={13} />
                      <span>{t("settings.appshots.clearGalleryBtn") || t("settings.appshots.clearBtn")}</span>
                    </motion.button>
                  )}
                </div>
              </div>

              {recentAppshots.length === 0 ? (
                <div className="mt-4 border border-dashed border-border/60 rounded-xl p-6 text-center space-y-2">
                  <Image size={22} className="mx-auto text-text-muted opacity-40" />
                  <span className="text-xs text-text-muted block">{t("settings.appshots.noShots")}</span>
                </div>
              ) : (
                <div className="mt-4 space-y-2 max-h-[320px] overflow-y-auto pr-1">
                  {recentAppshots.map((shot) => (
                    <div
                      key={shot.path}
                      className="flex items-center justify-between gap-4 rounded-lg border border-border/40 bg-input/40 p-2.5 transition-colors hover:bg-input/60"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-accent/20 bg-accent/10 shadow-inner">
                          <Image size={15} className="text-accent" />
                        </div>
                        <div className="min-w-0">
                          <span className="block max-w-[240px] truncate text-xs font-medium text-text-primary sm:max-w-[360px]">
                            {shot.name}
                          </span>
                          <span className="flex gap-2 text-[10px] text-text-muted">
                            <span>{shot.timestamp}</span>
                            <span>•</span>
                            <span>{formatSize(shot.size)}</span>
                          </span>
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <motion.button
                          type="button"
                          onClick={() => handleCopyPath(shot.path)}
                          whileHover={{ scale: motionTokens.scale.pop }}
                          whileTap={{ scale: motionTokens.scale.press }}
                          transition={springs.snappy}
                          className="rounded-lg border border-border bg-surface p-1.5 text-text-secondary shadow-sm transition-colors hover:bg-hover hover:text-text-primary"
                          title={t("settings.appshots.copyPathTooltip")}
                        >
                          {copiedPath === shot.path ? (
                            <Check size={13} className="text-emerald-500" />
                          ) : (
                            <Copy size={13} />
                          )}
                        </motion.button>
                        <motion.button
                          type="button"
                          onClick={() => deleteAppshot(shot.path)}
                          whileHover={{ scale: motionTokens.scale.pop }}
                          whileTap={{ scale: motionTokens.scale.press }}
                          transition={springs.snappy}
                          className="rounded-lg border border-border bg-surface p-1.5 text-red-500/80 shadow-sm transition-colors hover:bg-hover hover:text-red-500"
                          title={t("settings.appshots.deleteImageTooltip")}
                        >
                          <Trash2 size={13} />
                        </motion.button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </SettingsTogglePanel>
        </div>
      </SettingsDisclosure>
    </div>
  );
}
