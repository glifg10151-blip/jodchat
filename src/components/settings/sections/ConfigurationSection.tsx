import { useCallback, useRef, useEffect } from "react";
import { useTranslation } from "../../../utils/i18n";
import { Select } from "../../ui/Select";
import { Switch } from "../../ui/Switch";
import {
  MIN_TEMPERATURE,
  MAX_TEMPERATURE,
  TEMPERATURE_STEP,
  MIN_TOOL_STEPS,
  MAX_TOOL_STEPS_LIMIT,
} from "../../../config/constants";
import { SearchApiConfig } from "../../../types";
import { SettingsPanel, SettingsSectionHeader } from "../components/SettingsPrimitives";

interface ConfigurationSectionProps {
  searchConfigs: SearchApiConfig[];
  activeSearchId: string | null;
  setActiveSearchId: (id: string) => void;
  fetchConfigs: import("../../../types").FetchApiConfig[];
  activeFetchId: string | null;
  setActiveFetchId: (id: string) => void;
  temperature: number;
  setTemperature: (temp: number) => void;
  addToast: (msg: string, variant: "info" | "success" | "error") => void;
  maxToolSteps: number;
  setMaxToolSteps: (steps: number) => void;
  unlimitedToolSteps: boolean;
  setUnlimitedToolSteps: (enabled: boolean) => void;
}

export const ConfigurationSection = ({
  searchConfigs,
  activeSearchId,
  setActiveSearchId,
  fetchConfigs,
  activeFetchId,
  setActiveFetchId,
  temperature,
  setTemperature,
  addToast,
  maxToolSteps,
  setMaxToolSteps,
  unlimitedToolSteps,
  setUnlimitedToolSteps,
}: ConfigurationSectionProps) => {
  const { t } = useTranslation();
  const tempToastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxStepsToastRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enabledSearchConfigs = searchConfigs.filter((c) => c.enabled);
  const enabledFetchConfigs = fetchConfigs.filter((c) => c.enabled);

  const handleTemperatureChange = useCallback(
    (value: string) => {
      const tempVal = parseFloat(value);
      setTemperature(tempVal);
      if (tempToastRef.current) clearTimeout(tempToastRef.current);
      tempToastRef.current = setTimeout(() => {
        addToast(t("settings.chat.tempToast", { temp: tempVal.toFixed(1) }), "info");
      }, 800);
    },
    [setTemperature, addToast, t],
  );

  const handleMaxToolStepsChange = useCallback(
    (value: string) => {
      const steps = parseInt(value, 10);
      if (!Number.isFinite(steps)) return;
      setMaxToolSteps(steps);
      if (maxStepsToastRef.current) clearTimeout(maxStepsToastRef.current);
      maxStepsToastRef.current = setTimeout(() => {
        addToast(t("settings.chat.maxStepsToast", { steps: String(steps) }), "info");
      }, 800);
    },
    [setMaxToolSteps, addToast, t],
  );

  const handleUnlimitedToolStepsChange = useCallback(
    (checked: boolean) => {
      setUnlimitedToolSteps(checked);
      addToast(
        checked
          ? t("settings.chat.unlimitedToast", { defaultValue: "Tool step limit disabled" })
          : t("settings.chat.maxStepsToast", { steps: String(maxToolSteps) }),
        "info",
      );
    },
    [setUnlimitedToolSteps, addToast, t, maxToolSteps],
  );

  useEffect(() => {
    return () => {
      if (tempToastRef.current) clearTimeout(tempToastRef.current);
      if (maxStepsToastRef.current) clearTimeout(maxStepsToastRef.current);
    };
  }, []);

  const tempPercent = ((temperature - MIN_TEMPERATURE) / (MAX_TEMPERATURE - MIN_TEMPERATURE)) * 100;
  const stepsPercent = ((maxToolSteps - MIN_TOOL_STEPS) / (MAX_TOOL_STEPS_LIMIT - MIN_TOOL_STEPS)) * 100;

  return (
    <>
      <SettingsSectionHeader title={t("settings.chat.title")} description={t("settings.chat.subtitle")} />
      <SettingsPanel>
        <div className="space-y-2">
          <label htmlFor="default-search-provider-trigger" className="text-sm font-medium text-text-primary block">
            {t("settings.chat.defaultSearch")}
          </label>
          <p className="text-xs text-text-muted mb-2">{t("settings.chat.defaultSearchDesc")}</p>
          <Select
            id="default-search-provider"
            value={activeSearchId ?? ""}
            onChange={setActiveSearchId}
            options={enabledSearchConfigs.map((config) => ({
              value: config.id,
              label: config.name,
              description: config.provider,
            }))}
            disabled={enabledSearchConfigs.length === 0}
            placeholder={
              enabledSearchConfigs.length === 0 ? t("settings.chat.noEnabledSearch") : t("settings.chat.selectSearch")
            }
            aria-label="Available search providers"
          />
        </div>

        <div className="space-y-2 pt-2">
          <label htmlFor="default-fetch-provider-trigger" className="text-sm font-medium text-text-primary block">
            Default Fetch Provider
          </label>
          <p className="text-xs text-text-muted mb-2">
            Select the default provider used when fetching web page contents directly.
          </p>
          <Select
            id="default-fetch-provider"
            value={activeFetchId ?? ""}
            onChange={setActiveFetchId}
            options={enabledFetchConfigs.map((config) => ({
              value: config.id,
              label: config.name,
              description: config.provider,
            }))}
            disabled={enabledFetchConfigs.length === 0}
            placeholder={enabledFetchConfigs.length === 0 ? "No enabled fetch APIs" : "Select fetch provider"}
            aria-label="Available fetch providers"
          />
        </div>

        <div id="setting-configuration-temperature" className="space-y-3 pt-2 border-t border-border/50">
          <div className="flex items-center justify-between">
            <label htmlFor="temperature-slider" className="text-sm font-medium text-text-primary">
              {t("settings.chat.temperature")}
            </label>
            <span className="text-xs text-text-muted bg-input border border-input-border rounded px-2 py-0.5 font-mono">
              {temperature.toFixed(1)}
            </span>
          </div>
          <p className="text-xs text-text-muted">{t("settings.chat.temperatureDesc")}</p>
          <div className="flex items-center gap-4">
            <span className="text-xs text-text-muted whitespace-nowrap">{MIN_TEMPERATURE.toFixed(1)}</span>
            <div className="relative flex-1 h-1.5 bg-input-border rounded-full">
              <div
                className="absolute h-full bg-accent rounded-full transition-[width]"
                style={{ width: `${tempPercent}%` }}
              />
              <input
                id="temperature-slider"
                type="range"
                min={MIN_TEMPERATURE}
                max={MAX_TEMPERATURE}
                step={TEMPERATURE_STEP}
                value={temperature}
                onChange={(e) => handleTemperatureChange(e.target.value)}
                className="peer absolute inset-0 w-full h-full opacity-0 cursor-pointer focus:outline-none"
                aria-label="Temperature"
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-accent rounded-full border-2 border-white shadow-sm pointer-events-none transition-[left,transform,background-color,box-shadow] peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
                style={{ left: `calc(${tempPercent}% - 6px)` }}
                aria-hidden="true"
              />
            </div>
            <span className="text-xs text-text-muted whitespace-nowrap">{MAX_TEMPERATURE.toFixed(1)}</span>
          </div>
          <div className="flex justify-between text-[10px] text-text-muted pt-1">
            <span>{t("settings.chat.tempPrecise", { defaultValue: "Precise" })}</span>
            <span>{t("settings.chat.tempBalanced", { defaultValue: "Balanced" })}</span>
            <span>{t("settings.chat.tempCreative", { defaultValue: "Creative" })}</span>
          </div>
        </div>

        <div id="setting-configuration-max-steps" className="space-y-3 pt-4 border-t border-border/50">
          <div className="flex items-center justify-between">
            <label htmlFor="max-tool-steps-slider" className="text-sm font-medium text-text-primary">
              {t("settings.chat.maxToolSteps")}
            </label>
            <input
              id="max-tool-steps-input"
              type="number"
              min={MIN_TOOL_STEPS}
              max={MAX_TOOL_STEPS_LIMIT}
              step={1}
              value={maxToolSteps}
              disabled={unlimitedToolSteps}
              onChange={(e) => handleMaxToolStepsChange(e.target.value)}
              className="w-20 text-xs text-text-muted bg-input border border-input-border rounded px-2 py-0.5 font-mono text-right disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent"
              aria-label={t("settings.chat.maxToolSteps")}
            />
          </div>
          <p className="text-xs text-text-muted">{t("settings.chat.maxToolStepsDesc")}</p>
          <div className={`flex items-center gap-4 ${unlimitedToolSteps ? "opacity-50 pointer-events-none" : ""}`}>
            <span className="text-xs text-text-muted whitespace-nowrap">{MIN_TOOL_STEPS}</span>
            <div className="relative flex-1 h-1.5 bg-input-border rounded-full">
              <div
                className="absolute h-full bg-accent rounded-full transition-[width]"
                style={{ width: `${stepsPercent}%` }}
              />
              <input
                id="max-tool-steps-slider"
                type="range"
                min={MIN_TOOL_STEPS}
                max={MAX_TOOL_STEPS_LIMIT}
                step={1}
                value={maxToolSteps}
                onChange={(e) => handleMaxToolStepsChange(e.target.value)}
                disabled={unlimitedToolSteps}
                className="peer absolute inset-0 w-full h-full opacity-0 cursor-pointer focus:outline-none"
                aria-label="Maximum Tool Steps"
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-accent rounded-full border-2 border-white shadow-sm pointer-events-none transition-[left,transform,background-color,box-shadow] peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
                style={{ left: `calc(${stepsPercent}% - 6px)` }}
                aria-hidden="true"
              />
            </div>
            <span className="text-xs text-text-muted whitespace-nowrap">{MAX_TOOL_STEPS_LIMIT}</span>
          </div>
          <div className="pt-3 border-t border-border/50">
            <Switch
              checked={unlimitedToolSteps}
              onChange={handleUnlimitedToolStepsChange}
              label={t("settings.chat.unlimitedToolSteps")}
              description={t("settings.chat.unlimitedToolStepsDesc")}
              ariaLabel={t("settings.chat.unlimitedToolSteps")}
            />
          </div>
        </div>
      </SettingsPanel>
    </>
  );
};
