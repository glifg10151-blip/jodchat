import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  KeyRound,
  Languages,
  LoaderCircle,
  Monitor,
  Moon,
  Palette,
  Sun,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { PROVIDER_PRESETS } from "../config/providerPresets";
import type { ThemeConfig } from "../config/themePresets";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { getMotionMode, motionTransitions, springs, motionTokens } from "../lib/motion-tokens";
import { useModelStore } from "../store/useModelStore";
import { useUIStore } from "../store/useUIStore";
import type { ModelConfig } from "../types";
import { generateId } from "../utils/generateId";
import { formatModelName } from "../utils/formatModelName";
import { SUPPORTED_LANGUAGES, type SupportedLanguageCode, useTranslation } from "../utils/i18n";
import { isApiKeyOptionalForProvider, validateApiKey, validateApiUrl } from "../utils/validation";
import { Select } from "./ui/Select";

interface StartScreenProps {
  onStart: () => void;
}

type OnboardingStage = "intro" | "language" | "theme" | "model" | "leaving";
type ThemeMode = ThemeConfig["mode"];

const WELCOME_DRAW_DURATION_SECONDS = 2.65;
const DRAW_TO_MENU_DELAY_MS = 260;
const INTRO_TRANSITION_FALLBACK_MS = 4200;
const REDUCED_INTRO_DWELL_MS = 1600;
const EXIT_DURATION_MS = 320;
const ONBOARDING_STEPS = 3;

function WelcomeIntro({
  animateDrawing,
  onDrawingComplete,
}: {
  animateDrawing: boolean;
  onDrawingComplete: () => void;
}) {
  const clipId = `welcome-ink-${useId().replace(/:/g, "")}`;

  return (
    <motion.section
      key="welcome-intro"
      className="relative z-10 flex w-full max-w-4xl flex-col items-center px-6 text-center"
      aria-label="Welcome to Sythoria"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={animateDrawing ? { opacity: 0, scale: 0.985, filter: "blur(8px)" } : { opacity: 0 }}
      transition={motionTransitions.expressive}
    >
      <span className="sr-only">Welcome</span>
      <svg viewBox="0 0 780 210" className="w-full max-w-[860px] overflow-visible text-text-primary" aria-hidden="true">
        <defs>
          <clipPath id={clipId}>
            <motion.rect
              x="18"
              y="0"
              height="210"
              rx="18"
              initial={{ width: animateDrawing ? 0 : 744 }}
              animate={{ width: 744 }}
              transition={
                animateDrawing
                  ? {
                      duration: WELCOME_DRAW_DURATION_SECONDS,
                      delay: 0.12,
                      ease: motionTokens.easing.smooth,
                    }
                  : { duration: 0 }
              }
              onAnimationComplete={animateDrawing ? onDrawingComplete : undefined}
            />
          </clipPath>
        </defs>
        <text
          x="390"
          y="145"
          textAnchor="middle"
          fill="currentColor"
          clipPath={`url(#${clipId})`}
          style={{
            fontFamily: '"Segoe Script", "Snell Roundhand", "Bradley Hand", "Brush Script MT", cursive',
            fontSize: "128px",
            fontWeight: 700,
            letterSpacing: "-5px",
          }}
        >
          Welcome
        </text>
      </svg>
      <motion.div
        className="-mt-5 flex items-center gap-2 text-[11px] font-semibold tracking-[0.32em] text-text-muted uppercase"
        initial={animateDrawing ? { opacity: 0, y: 6 } : { opacity: 1, y: 0 }}
        animate={{ opacity: 1, y: 0 }}
        transition={animateDrawing ? { ...motionTransitions.content, delay: 2.35 } : { duration: 0 }}
        aria-hidden="true"
      >
        <span className="h-px w-7 bg-border" />
        Sythoria
        <span className="h-px w-7 bg-border" />
      </motion.div>
    </motion.section>
  );
}

function StepBadge({ step }: { step: number }) {
  const { t } = useTranslation();
  return (
    <div
      className="absolute right-5 top-5 rounded-full border border-border bg-input/70 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-text-muted"
      aria-label={t("onboarding.step", { current: String(step), total: String(ONBOARDING_STEPS) })}
    >
      {step} / {ONBOARDING_STEPS}
    </div>
  );
}

function LanguageDialog({ onContinue }: { onContinue: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const languageButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedLanguageButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const { t, language } = useTranslation();
  const setLanguage = useUIStore((state) => state.setLanguage);
  const selectedLanguage = SUPPORTED_LANGUAGES.some((item) => item.code === language)
    ? (language as SupportedLanguageCode)
    : "en";

  useDialogFocus({
    isOpen: true,
    onClose: () => undefined,
    containerRef: dialogRef,
    initialFocusRef: selectedLanguageButtonRef,
    closeOnEscape: false,
  });

  const selectLanguage = (code: SupportedLanguageCode) => {
    setLanguage(code);
  };

  const handleLanguageKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"].includes(event.key)) return;

    event.preventDefault();
    let nextIndex = index;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = (index + 1) % SUPPORTED_LANGUAGES.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex = (index - 1 + SUPPORTED_LANGUAGES.length) % SUPPORTED_LANGUAGES.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = SUPPORTED_LANGUAGES.length - 1;
    }

    const nextLanguage = SUPPORTED_LANGUAGES[nextIndex];
    selectLanguage(nextLanguage.code);
    requestAnimationFrame(() => languageButtonRefs.current[nextIndex]?.focus());
  };

  return (
    <motion.section
      key="language-dialog"
      className="relative z-10 w-full max-w-xl px-4"
      initial={{ opacity: 0, y: motionTokens.distance.lg, scale: motionTokens.scale.subtle }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -motionTokens.distance.sm, scale: motionTokens.scale.subtle }}
      transition={motionTransitions.modalEnter}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="relative overflow-hidden rounded-[28px] border border-border bg-surface/95 p-5 shadow-2xl backdrop-blur-xl sm:p-7"
      >
        <div className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-text-primary/30 to-transparent" />
        <StepBadge step={1} />

        <header className="mb-6 flex items-start gap-4 pr-12">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-active text-text-primary shadow-sm">
            <Languages size={23} strokeWidth={1.8} aria-hidden="true" />
          </div>
          <div className="min-w-0 pt-0.5">
            <p className="mb-1 text-[10px] font-semibold tracking-[0.22em] text-text-muted uppercase">Sythoria</p>
            <h1 id={titleId} className="text-2xl font-semibold tracking-tight text-text-primary">
              {t("onboarding.chooseLanguage")}
            </h1>
            <p id={descriptionId} className="mt-1.5 text-sm leading-5 text-text-secondary">
              {t("onboarding.chooseLanguageDesc")}
            </p>
          </div>
        </header>

        <div
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
          role="radiogroup"
          aria-label={t("onboarding.languageLabel")}
        >
          {SUPPORTED_LANGUAGES.map((item, index) => {
            const isSelected = item.code === selectedLanguage;
            return (
              <motion.button
                key={item.code}
                ref={(element) => {
                  languageButtonRefs.current[index] = element;
                  if (isSelected) selectedLanguageButtonRef.current = element;
                }}
                type="button"
                role="radio"
                aria-checked={isSelected}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => selectLanguage(item.code)}
                onKeyDown={(event) => handleLanguageKeyDown(event, index)}
                className={`group flex min-h-16 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${
                  isSelected
                    ? "border-accent bg-accent-soft text-text-primary"
                    : "border-border bg-input/50 text-text-secondary hover:border-text-muted/40 hover:bg-hover hover:text-text-primary"
                }`}
                whileHover={{ scale: motionTokens.scale.pop }}
                whileTap={{ scale: motionTokens.scale.press }}
                transition={springs.snappy}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-semibold uppercase transition-colors ${
                    isSelected ? "bg-accent text-accent-foreground" : "bg-active text-text-secondary"
                  }`}
                  aria-hidden="true"
                >
                  {item.code}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-current">{item.nativeName}</span>
                  <span className="mt-0.5 block truncate text-xs text-text-muted">{item.name}</span>
                </span>
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-opacity ${
                    isSelected ? "bg-accent text-accent-foreground opacity-100" : "opacity-0"
                  }`}
                  aria-hidden="true"
                >
                  <Check size={12} strokeWidth={3} />
                </span>
              </motion.button>
            );
          })}
        </div>

        <motion.button
          type="button"
          onClick={onContinue}
          className="mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground shadow-md transition-colors hover:bg-accent-hover"
          whileHover={{ scale: motionTokens.scale.pop }}
          whileTap={{ scale: motionTokens.scale.press }}
          transition={springs.snappy}
        >
          {t("onboarding.continue")}
          <ArrowRight size={17} aria-hidden="true" />
        </motion.button>
      </div>
    </motion.section>
  );
}

function ThemeDialog({ onBack, onContinue }: { onBack: () => void; onContinue: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const themeButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedThemeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const { t } = useTranslation();
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);

  useDialogFocus({
    isOpen: true,
    onClose: () => undefined,
    containerRef: dialogRef,
    initialFocusRef: selectedThemeButtonRef,
    closeOnEscape: false,
  });

  const themeOptions: Array<{
    mode: ThemeMode;
    label: string;
    description: string;
    icon: typeof Monitor;
    background: string;
    panel: string;
    foreground: string;
    accent: string;
  }> = [
    {
      mode: "system",
      label: t("onboarding.themeSystem"),
      description: t("onboarding.themeSystemDesc"),
      icon: Monitor,
      background: "linear-gradient(110deg, #f5f5f4 0 50%, #18181b 50% 100%)",
      panel: "rgba(127, 127, 127, 0.22)",
      foreground: "#a1a1aa",
      accent: "#3b82f6",
    },
    {
      mode: "light",
      label: t("onboarding.themeLight"),
      description: t("onboarding.themeLightDesc"),
      icon: Sun,
      background: "#f8fafc",
      panel: "#e2e8f0",
      foreground: "#334155",
      accent: "#2563eb",
    },
    {
      mode: "dark",
      label: t("onboarding.themeDark"),
      description: t("onboarding.themeDarkDesc"),
      icon: Moon,
      background: "#18181b",
      panel: "#27272a",
      foreground: "#d4d4d8",
      accent: "#60a5fa",
    },
  ];

  const selectTheme = (mode: ThemeMode) => {
    setTheme({ ...theme, mode });
  };

  const handleThemeKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();

    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % themeOptions.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + themeOptions.length) % themeOptions.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = themeOptions.length - 1;

    selectTheme(themeOptions[nextIndex].mode);
    requestAnimationFrame(() => themeButtonRefs.current[nextIndex]?.focus());
  };

  return (
    <motion.section
      key="theme-dialog"
      className="relative z-10 w-full max-w-2xl px-4"
      initial={{ opacity: 0, y: motionTokens.distance.lg, scale: motionTokens.scale.subtle }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -motionTokens.distance.sm, scale: motionTokens.scale.subtle }}
      transition={motionTransitions.modalEnter}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="relative overflow-hidden rounded-[28px] border border-border bg-surface/95 p-5 shadow-2xl backdrop-blur-xl sm:p-7"
      >
        <div className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-text-primary/30 to-transparent" />
        <StepBadge step={2} />

        <header className="mb-6 flex items-start gap-4 pr-12">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-active text-text-primary shadow-sm">
            <Palette size={23} strokeWidth={1.8} aria-hidden="true" />
          </div>
          <div className="min-w-0 pt-0.5">
            <p className="mb-1 text-[10px] font-semibold tracking-[0.22em] text-text-muted uppercase">Sythoria</p>
            <h1 id={titleId} className="text-2xl font-semibold tracking-tight text-text-primary">
              {t("onboarding.chooseTheme")}
            </h1>
            <p id={descriptionId} className="mt-1.5 text-sm leading-5 text-text-secondary">
              {t("onboarding.chooseThemeDesc")}
            </p>
          </div>
        </header>

        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          role="radiogroup"
          aria-label={t("onboarding.themeLabel")}
        >
          {themeOptions.map((option, index) => {
            const isSelected = theme.mode === option.mode;
            const Icon = option.icon;
            return (
              <motion.button
                key={option.mode}
                ref={(element) => {
                  themeButtonRefs.current[index] = element;
                  if (isSelected) selectedThemeButtonRef.current = element;
                }}
                type="button"
                role="radio"
                aria-checked={isSelected}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => selectTheme(option.mode)}
                onKeyDown={(event) => handleThemeKeyDown(event, index)}
                className={`relative rounded-2xl border p-3 text-left transition-colors ${
                  isSelected
                    ? "border-accent bg-accent-soft"
                    : "border-border bg-input/40 hover:border-text-muted/40 hover:bg-hover"
                }`}
                whileHover={{ scale: motionTokens.scale.pop }}
                whileTap={{ scale: motionTokens.scale.press }}
                transition={springs.snappy}
              >
                <div
                  className="mb-3 flex h-24 overflow-hidden rounded-xl border border-black/10 shadow-inner"
                  style={{ background: option.background }}
                  aria-hidden="true"
                >
                  <div className="w-[28%] border-r border-black/10 p-2" style={{ backgroundColor: option.panel }}>
                    <div className="mb-2 h-2 w-5 rounded-full" style={{ backgroundColor: option.accent }} />
                    <div className="mb-1.5 h-1.5 w-full rounded-full bg-current opacity-25" />
                    <div className="h-1.5 w-2/3 rounded-full bg-current opacity-15" />
                  </div>
                  <div className="flex flex-1 flex-col justify-end gap-2 p-2.5" style={{ color: option.foreground }}>
                    <div className="ml-auto h-5 w-2/3 rounded-lg" style={{ backgroundColor: option.panel }} />
                    <div className="h-2 w-3/4 rounded-full bg-current opacity-25" />
                    <div className="h-2 w-1/2 rounded-full bg-current opacity-15" />
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <span
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                      isSelected ? "bg-accent text-accent-foreground" : "bg-active text-text-secondary"
                    }`}
                  >
                    <Icon size={14} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-text-primary">{option.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-4 text-text-muted">{option.description}</span>
                  </span>
                  {isSelected && <Check size={15} className="mt-1 shrink-0 text-text-primary" aria-hidden="true" />}
                </div>
              </motion.button>
            );
          })}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <motion.button
            type="button"
            onClick={onBack}
            className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-input/60 px-5 py-3 text-sm font-semibold text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            transition={springs.snappy}
          >
            <ArrowLeft size={17} aria-hidden="true" />
            {t("onboarding.back")}
          </motion.button>
          <motion.button
            type="button"
            onClick={onContinue}
            className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground shadow-md transition-colors hover:bg-accent-hover"
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            transition={springs.snappy}
          >
            {t("onboarding.continue")}
            <ArrowRight size={17} aria-hidden="true" />
          </motion.button>
        </div>
      </div>
    </motion.section>
  );
}

function ModelSetupDialog({ onBack, onComplete }: { onBack: () => void; onComplete: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const endpointErrorId = useId();
  const { t } = useTranslation();
  const models = useModelStore((state) => state.models);
  const updateModels = useModelStore((state) => state.updateModels);
  const persistApiKeys = useModelStore((state) => state.persistApiKeys);
  const [providerId, setProviderId] = useState<string>(PROVIDER_PRESETS[0].providerId);
  const [apiBase, setApiBase] = useState<string>(PROVIDER_PRESETS[0].apiBase);
  const [modelId, setModelId] = useState<string>(PROVIDER_PRESETS[0].defaultModel);
  const [apiKey, setApiKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useDialogFocus({
    isOpen: true,
    onClose: () => undefined,
    containerRef: dialogRef,
    closeOnEscape: false,
  });

  const selectedProvider = PROVIDER_PRESETS.find((preset) => preset.providerId === providerId);
  const endpointValidation = validateApiUrl(apiBase);
  const keyValidation = validateApiKey(apiKey, providerId);
  const isApiKeyOptional = isApiKeyOptionalForProvider(providerId);
  const canSubmit = endpointValidation.valid && modelId.trim().length > 0 && keyValidation.valid && !isSaving;

  const handleProviderChange = (nextProviderId: string) => {
    const preset = PROVIDER_PRESETS.find((candidate) => candidate.providerId === nextProviderId);
    setProviderId(nextProviderId);
    if (!preset) return;
    setApiBase(preset.apiBase);
    setModelId(preset.defaultModel);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSaving(true);

    const newModel: ModelConfig = {
      id: `model-${generateId()}`,
      name: formatModelName(modelId) || selectedProvider?.label || "Custom Model",
      provider: providerId,
      apiBase: apiBase.trim(),
      apiKey: apiKey.trim(),
      modelId: modelId.trim(),
      enabled: true,
    };

    updateModels([...models, newModel]);
    await persistApiKeys();
    onComplete();
  };

  return (
    <motion.section
      key="model-dialog"
      className="relative z-10 w-full max-w-2xl px-4"
      initial={{ opacity: 0, y: motionTokens.distance.lg, scale: motionTokens.scale.subtle }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -motionTokens.distance.sm, scale: motionTokens.scale.subtle }}
      transition={motionTransitions.modalEnter}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="relative overflow-hidden rounded-[28px] border border-border bg-surface/95 p-5 shadow-2xl backdrop-blur-xl sm:p-7"
      >
        <div className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-text-primary/30 to-transparent" />
        <StepBadge step={3} />

        <header className="mb-6 flex items-start gap-4 pr-12">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-active text-text-primary shadow-sm">
            <KeyRound size={22} strokeWidth={1.8} aria-hidden="true" />
          </div>
          <div className="min-w-0 pt-0.5">
            <p className="mb-1 text-[10px] font-semibold tracking-[0.22em] text-text-muted uppercase">Sythoria</p>
            <h1 id={titleId} className="text-2xl font-semibold tracking-tight text-text-primary">
              {t("onboarding.setupModel")}
            </h1>
            <p id={descriptionId} className="mt-1.5 text-sm leading-5 text-text-secondary">
              {t("onboarding.setupModelDesc")}
            </p>
          </div>
        </header>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-text-secondary" htmlFor="onboarding-provider-trigger">
                {t("settings.models.preset")}
              </label>
              <Select
                id="onboarding-provider"
                value={providerId}
                onChange={handleProviderChange}
                options={PROVIDER_PRESETS.map((preset) => ({ value: preset.providerId, label: preset.label }))}
                aria-label={t("settings.models.preset")}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-text-secondary" htmlFor="onboarding-model-id">
                {t("settings.models.modelId")}
              </label>
              <input
                id="onboarding-model-id"
                type="text"
                value={modelId}
                onChange={(event) => setModelId(event.target.value)}
                placeholder="gpt-5.6-sol"
                autoComplete="off"
                spellCheck="false"
                aria-invalid={modelId.trim().length === 0}
                className="h-10 w-full rounded-lg border border-input-border bg-input px-3 py-2 font-mono text-xs text-text-primary placeholder-text-muted transition-colors focus:border-accent focus:outline-none"
              />
            </div>
          </div>

          <div className="mt-4 space-y-1.5">
            <label className="text-xs font-semibold text-text-secondary" htmlFor="onboarding-api-base">
              {t("settings.models.apiBase")}
            </label>
            <input
              id="onboarding-api-base"
              type="url"
              value={apiBase}
              onChange={(event) => setApiBase(event.target.value)}
              placeholder="https://api.example.com/v1/chat/completions"
              autoComplete="off"
              spellCheck="false"
              aria-invalid={!endpointValidation.valid}
              aria-describedby={!endpointValidation.valid ? endpointErrorId : undefined}
              className={`h-10 w-full rounded-lg border bg-input px-3 py-2 font-mono text-xs text-text-primary placeholder-text-muted transition-colors focus:outline-none ${
                endpointValidation.valid
                  ? "border-input-border focus:border-accent"
                  : "border-red-500/50 focus:border-red-500"
              }`}
            />
            {!endpointValidation.valid && apiBase.length > 0 && (
              <p id={endpointErrorId} role="alert" className="text-[11px] text-red-500">
                {t("onboarding.endpointInvalid")}
              </p>
            )}
          </div>

          <div className="mt-4 space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs font-semibold text-text-secondary" htmlFor="onboarding-api-key">
                {isApiKeyOptional ? t("settings.models.apiKeyOptional") : t("settings.models.apiKey")}
              </label>
              <span className="text-[10px] text-text-muted">{t("onboarding.encryptedKey")}</span>
            </div>
            <input
              id="onboarding-api-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={isApiKeyOptional ? t("settings.models.apiKeyOptional") : t("settings.models.apiKey")}
              autoComplete="off"
              spellCheck="false"
              aria-invalid={!keyValidation.valid}
              className="h-10 w-full rounded-lg border border-input-border bg-input px-3 py-2 text-sm text-text-primary placeholder-text-muted transition-colors focus:border-accent focus:outline-none"
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <motion.button
              type="button"
              onClick={onBack}
              className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-input/60 px-5 py-3 text-sm font-semibold text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
              whileHover={{ scale: motionTokens.scale.pop }}
              whileTap={{ scale: motionTokens.scale.press }}
              transition={springs.snappy}
            >
              <ArrowLeft size={17} aria-hidden="true" />
              {t("onboarding.back")}
            </motion.button>
            <button
              type="button"
              onClick={onComplete}
              className="min-h-12 px-2 text-sm font-medium text-text-muted transition-colors hover:text-text-primary"
            >
              {t("onboarding.setupLater")}
            </button>
            <motion.button
              type="submit"
              disabled={!canSubmit}
              className="ml-auto flex min-h-12 min-w-40 items-center justify-center gap-2 rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground shadow-md transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
              whileHover={canSubmit ? { scale: motionTokens.scale.pop } : undefined}
              whileTap={canSubmit ? { scale: motionTokens.scale.press } : undefined}
              transition={springs.snappy}
            >
              {isSaving ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : null}
              {t("onboarding.finish")}
              {!isSaving ? <ArrowRight size={17} aria-hidden="true" /> : null}
            </motion.button>
          </div>
        </form>
      </div>
    </motion.section>
  );
}

export default function StartScreen({ onStart }: StartScreenProps) {
  const motionMode = getMotionMode();
  const sequenceMotion = motionMode !== "off";
  const fullInterfaceMotion = motionMode === "full";
  const showIntro = sequenceMotion;
  const [stage, setStage] = useState<OnboardingStage>(showIntro ? "intro" : "language");
  const introTransitionTimerRef = useRef<number | null>(null);
  const exitTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!showIntro) return;
    const introTimer = window.setTimeout(
      () => setStage("language"),
      fullInterfaceMotion ? INTRO_TRANSITION_FALLBACK_MS : REDUCED_INTRO_DWELL_MS,
    );
    return () => window.clearTimeout(introTimer);
  }, [fullInterfaceMotion, showIntro]);

  useEffect(
    () => () => {
      if (introTransitionTimerRef.current !== null) window.clearTimeout(introTransitionTimerRef.current);
      if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
    },
    [],
  );

  const handleDrawingComplete = () => {
    if (!fullInterfaceMotion || introTransitionTimerRef.current !== null) return;
    introTransitionTimerRef.current = window.setTimeout(() => {
      introTransitionTimerRef.current = null;
      setStage("language");
    }, DRAW_TO_MENU_DELAY_MS);
  };

  const handleComplete = () => {
    if (!fullInterfaceMotion) {
      onStart();
      return;
    }

    setStage("leaving");
    exitTimerRef.current = window.setTimeout(onStart, EXIT_DURATION_MS);
  };

  return (
    <main className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-chat">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute left-1/2 top-1/2 h-[min(76vw,760px)] w-[min(76vw,760px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-soft opacity-60 blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-surface/30 to-transparent" />
        <div className="absolute bottom-0 left-1/2 h-px w-2/3 -translate-x-1/2 bg-gradient-to-r from-transparent via-border to-transparent" />
      </div>

      <AnimatePresence mode="wait">
        {stage === "intro" && (
          <WelcomeIntro animateDrawing={fullInterfaceMotion} onDrawingComplete={handleDrawingComplete} />
        )}
        {stage === "language" && <LanguageDialog onContinue={() => setStage("theme")} />}
        {stage === "theme" && <ThemeDialog onBack={() => setStage("language")} onContinue={() => setStage("model")} />}
        {stage === "model" && <ModelSetupDialog onBack={() => setStage("theme")} onComplete={handleComplete} />}
      </AnimatePresence>
    </main>
  );
}
