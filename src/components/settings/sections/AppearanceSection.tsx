import { useCallback, useMemo } from "react";
import { Switch } from "../../ui/Switch";
import { Select } from "../../ui/Select";
import { ColorPickerInput } from "../components/ColorPickerInput";
import { LIGHT_PRESETS, DARK_PRESETS, CustomThemeConfig, ThemeConfig } from "../../../config/themePresets";
import { useUIStore } from "../../../store/useUIStore";
import { useTranslation } from "../../../utils/i18n";
import { SettingsPanel, SettingsSectionHeader } from "../components/SettingsPrimitives";

interface AppearanceSectionProps {
  theme: ThemeConfig;
  setTheme: (theme: ThemeConfig) => void;
  animationsDisabled: boolean;
  setAnimationsDisabled: (disabled: boolean) => void;
}

const getSelectedPreset = (colors: CustomThemeConfig, presets: Record<string, CustomThemeConfig>): string => {
  if (!colors) return "Custom";
  const match = Object.entries(presets).find(([_, preset]) => {
    return (
      preset.background.toLowerCase() === colors.background.toLowerCase() &&
      preset.foreground.toLowerCase() === colors.foreground.toLowerCase() &&
      preset.accent.toLowerCase() === colors.accent.toLowerCase()
    );
  });
  return match ? match[0] : "Custom";
};

export const AppearanceSection = ({
  theme,
  setTheme,
  animationsDisabled,
  setAnimationsDisabled,
}: AppearanceSectionProps) => {
  const { t } = useTranslation();
  const downloadedThemes = useUIStore((s) => s.downloadedThemes);
  const mergedLightPresets = useMemo(() => ({ ...LIGHT_PRESETS, ...downloadedThemes.light }), [downloadedThemes.light]);
  const mergedDarkPresets = useMemo(() => ({ ...DARK_PRESETS, ...downloadedThemes.dark }), [downloadedThemes.dark]);

  const modeOptions = useMemo(
    () => [
      { value: "light", label: t("settings.appearance.light") },
      { value: "dark", label: t("settings.appearance.dark") },
      { value: "system", label: t("settings.appearance.system") },
    ],
    [t],
  );

  const lightPresetOptions = useMemo(() => {
    const options = Object.keys(mergedLightPresets).map((pName) => ({
      value: pName,
      label: pName,
    }));
    if (getSelectedPreset(theme.lightTheme, mergedLightPresets) === "Custom") {
      options.push({ value: "Custom", label: "Custom" });
    }
    return options;
  }, [mergedLightPresets, theme.lightTheme]);

  const darkPresetOptions = useMemo(() => {
    const options = Object.keys(mergedDarkPresets).map((pName) => ({
      value: pName,
      label: pName,
    }));
    if (getSelectedPreset(theme.darkTheme, mergedDarkPresets) === "Custom") {
      options.push({ value: "Custom", label: "Custom" });
    }
    return options;
  }, [mergedDarkPresets, theme.darkTheme]);

  const handlePresetChange = useCallback(
    (themeType: "light" | "dark", presetName: string) => {
      if (presetName === "Custom") return;
      const presets = themeType === "light" ? mergedLightPresets : mergedDarkPresets;
      const presetColors = presets[presetName];
      if (!presetColors) return;

      const newTheme = {
        ...theme,
        [themeType === "light" ? "lightTheme" : "darkTheme"]: {
          ...presetColors,
        },
      };
      setTheme(newTheme);
    },
    [theme, setTheme, mergedLightPresets, mergedDarkPresets],
  );

  const handleColorChange = useCallback(
    (themeType: "light" | "dark", colorKey: "background" | "foreground" | "accent", colorValue: string) => {
      const targetTheme = themeType === "light" ? theme.lightTheme : theme.darkTheme;
      const updatedThemeColors = {
        ...targetTheme,
        [colorKey]: colorValue,
      };

      const presets = themeType === "light" ? mergedLightPresets : mergedDarkPresets;
      const matchedPreset = Object.entries(presets).find(([_, p]) => {
        return (
          p.background.toLowerCase() === updatedThemeColors.background.toLowerCase() &&
          p.foreground.toLowerCase() === updatedThemeColors.foreground.toLowerCase() &&
          p.accent.toLowerCase() === updatedThemeColors.accent.toLowerCase()
        );
      });

      updatedThemeColors.preset = matchedPreset ? matchedPreset[0] : "Custom";

      const newTheme = {
        ...theme,
        [themeType === "light" ? "lightTheme" : "darkTheme"]: updatedThemeColors,
      };
      setTheme(newTheme);
    },
    [theme, setTheme, mergedLightPresets, mergedDarkPresets],
  );

  return (
    <>
      <SettingsSectionHeader title={t("section.appearance")} description={t("settings.appearance.subtitle")} />
      <SettingsPanel>
        <div id="setting-appearance-theme-mode" className="flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-text-primary block">{t("section.appearance")}</span>
            <span className="text-xs text-text-muted">{t("settings.appearance.selectMode")}</span>
          </div>
          <Select
            value={theme.mode}
            onChange={(val) => {
              const mode = val as "light" | "dark" | "system";
              setTheme({
                ...theme,
                mode,
              });
            }}
            options={modeOptions}
            className="w-[150px]"
            aria-label={t("settings.appearance.modeLabel")}
          />
        </div>

        <div id="setting-appearance-animations">
          <Switch
            checked={!animationsDisabled}
            onChange={(checked) => setAnimationsDisabled(!checked)}
            label={t("settings.appearance.animations")}
            description={t("settings.appearance.animationsDesc")}
          />
        </div>

        <div id="setting-appearance-translucent-sidebar">
          <Switch
            checked={theme.translucentSidebar ?? true}
            onChange={(translucentSidebar) => setTheme({ ...theme, translucentSidebar })}
            label={t("settings.appearance.translucentSidebar")}
            description={t("settings.appearance.translucentSidebarDesc")}
          />
        </div>
      </SettingsPanel>
      <SettingsPanel spacing="sm">
        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
          {t("settings.appearance.lightTheme")}
        </h4>

        <div className="flex items-center justify-between py-2 border-b border-border/50">
          <span className="text-sm font-medium text-text-primary">{t("settings.appearance.preset")}</span>
          <Select
            value={getSelectedPreset(theme.lightTheme, mergedLightPresets)}
            onChange={(val) => handlePresetChange("light", val)}
            options={lightPresetOptions}
            className="w-[150px]"
            aria-label={t("settings.appearance.preset")}
          />
        </div>

        <ColorPickerInput
          label={t("settings.appearance.background")}
          value={theme.lightTheme.background}
          onChange={(val) => handleColorChange("light", "background", val)}
        />

        <ColorPickerInput
          label={t("settings.appearance.foreground")}
          value={theme.lightTheme.foreground}
          onChange={(val) => handleColorChange("light", "foreground", val)}
        />

        <ColorPickerInput
          label={t("settings.appearance.accent")}
          value={theme.lightTheme.accent}
          onChange={(val) => handleColorChange("light", "accent", val)}
        />
      </SettingsPanel>
      <SettingsPanel spacing="sm">
        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
          {t("settings.appearance.darkTheme")}
        </h4>

        <div className="flex items-center justify-between py-2 border-b border-border/50">
          <span className="text-sm font-medium text-text-primary">{t("settings.appearance.preset")}</span>
          <Select
            value={getSelectedPreset(theme.darkTheme, mergedDarkPresets)}
            onChange={(val) => handlePresetChange("dark", val)}
            options={darkPresetOptions}
            className="w-[150px]"
            aria-label={t("settings.appearance.preset")}
          />
        </div>

        <ColorPickerInput
          label={t("settings.appearance.background")}
          value={theme.darkTheme.background}
          onChange={(val) => handleColorChange("dark", "background", val)}
        />

        <ColorPickerInput
          label={t("settings.appearance.foreground")}
          value={theme.darkTheme.foreground}
          onChange={(val) => handleColorChange("dark", "foreground", val)}
        />

        <ColorPickerInput
          label={t("settings.appearance.accent")}
          value={theme.darkTheme.accent}
          onChange={(val) => handleColorChange("dark", "accent", val)}
        />
      </SettingsPanel>
    </>
  );
};
