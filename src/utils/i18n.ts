import { useUIStore } from "../store/useUIStore";
import { en } from "./i18n/en";
import { es } from "./i18n/es";
import { fr } from "./i18n/fr";
import { de } from "./i18n/de";
import { zh } from "./i18n/zh";
import { ja } from "./i18n/ja";

export const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "zh", name: "Chinese (Simplified)", nativeName: "简体中文" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
] as const;

export type SupportedLanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

export const translations: Record<SupportedLanguageCode, Record<string, string>> = {
  en,
  es,
  fr,
  de,
  zh,
  ja,
};

export function useTranslation() {
  const language = (useUIStore((s) => s.language) || "en") as SupportedLanguageCode;

  const t = (key: string, replacements?: Record<string, string>): string => {
    const dict = translations[language] || translations["en"];
    let value = dict?.[key] ?? translations["en"]?.[key] ?? (replacements?.defaultValue || key);

    if (replacements) {
      Object.entries(replacements).forEach(([k, v]) => {
        if (k !== "defaultValue") {
          value = value.replace(new RegExp(`{${k}}`, "g"), String(v));
        }
      });
    }

    return value;
  };

  return {
    t,
    language,
    supportedLanguages: SUPPORTED_LANGUAGES,
  };
}
