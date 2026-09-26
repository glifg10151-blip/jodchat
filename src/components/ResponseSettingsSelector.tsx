import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import type { ModelConfig, ModelStatuses } from "../types";
import { STATUS_COLORS } from "../types";
import { useModelStore } from "../store/useModelStore";
import { useUIStore } from "../store/useUIStore";
import { motionTokens, motionTransitions } from "../lib/motion-tokens";
import { getThinkingLabel, getThinkingLevel, supportsThinkingControl, THINKING_LEVELS } from "../utils/thinking";
import { useTranslation } from "../utils/i18n";

const STATUS_LABELS: Record<string, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting\u2026",
  connected: "Connected",
  error: "Connection error",
};

const STATUS_KEYS: Record<string, string> = {
  disconnected: "status.disconnected",
  connecting: "status.connecting",
  connected: "status.connected",
  error: "status.error",
};

interface ResponseSettingsSelectorProps {
  models: ModelConfig[];
  selectedModel: string;
  onModelChange: (modelId: string) => void;
  modelStatuses: ModelStatuses;
  placement?: "above" | "below";
  buttonId?: string;
  triggerClassName?: string;
}

export function ResponseSettingsSelector({
  models,
  selectedModel,
  onModelChange,
  modelStatuses,
  placement = "above",
  buttonId,
  triggerClassName = "max-w-[190px]",
}: ResponseSettingsSelectorProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [panel, setPanel] = useState<"root" | "models" | "thinking">("root");
  const [submenuSide, setSubmenuSide] = useState<"left" | "right">("right");
  const [collapsedWidth, setCollapsedWidth] = useState<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const triggerMeasureRef = useRef<HTMLDivElement>(null);
  const updateModel = useModelStore((state) => state.updateModel);
  const disableBgActivity = useUIStore((state) => state.disableBgActivity);

  const enabledModels = models.filter((model) => model.enabled !== false);
  const currentModel =
    models.find((model) => model.id === selectedModel && model.enabled !== false) ?? enabledModels[0] ?? models[0];
  const currentStatus = modelStatuses[selectedModel] ?? "disconnected";
  const thinkingLevel = getThinkingLevel(currentModel);
  const thinkingLabel = getThinkingLabel(currentModel);
  const thinkingSupported = supportsThinkingControl(currentModel);
  const opensAbove = placement === "above";

  useLayoutEffect(() => {
    const measuredWidth = triggerMeasureRef.current?.getBoundingClientRect().width;
    if (measuredWidth) setCollapsedWidth(measuredWidth);
  }, [currentModel?.name, disableBgActivity, thinkingLabel, thinkingSupported, triggerClassName]);

  const openSubmenu = (nextPanel: "models" | "thinking", moveFocus = false) => {
    const mainPanel = panelRef.current;
    if (mainPanel) {
      const mainBounds = mainPanel.getBoundingClientRect();
      setSubmenuSide(window.innerWidth - mainBounds.right >= mainBounds.width ? "right" : "left");
    }
    setPanel(nextPanel);
    if (moveFocus) {
      requestAnimationFrame(() => {
        panelRef.current
          ?.querySelector<HTMLButtonElement>(`[data-selector-panel="${nextPanel}"] button:not(:disabled)`)
          ?.focus();
      });
    }
  };

  const closeSubmenu = (trigger: "models" | "thinking") => {
    setPanel("root");
    requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLButtonElement>(`[data-selector-trigger="${trigger}"]`)?.focus();
    });
  };

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setPanel("root");
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLButtonElement>('[data-selector-panel="root"] button:not(:disabled)')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  return (
    <div ref={dropdownRef} className="relative z-20 shrink-0">
      <motion.button
        ref={triggerRef}
        id={buttonId}
        type="button"
        onClick={() => {
          setIsOpen((open) => !open);
          setPanel("root");
        }}
        initial={false}
        animate={{ width: isOpen ? "11.5rem" : (collapsedWidth ?? "auto") }}
        transition={motionTransitions.popoverEnter}
        className={`flex min-h-8 items-center justify-center gap-1.5 overflow-hidden rounded-xl px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-hover hover:text-text-primary ${triggerClassName}`}
        aria-label={`Response settings: ${currentModel?.name ?? "no model"}, thinking ${thinkingLabel}`}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        {!disableBgActivity && (
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_COLORS[currentStatus]}`}
            title={t(STATUS_KEYS[currentStatus]) || STATUS_LABELS[currentStatus] || currentStatus}
            aria-hidden="true"
          />
        )}
        <span className="min-w-0 truncate">{currentModel?.name || "No Model Configured"}</span>
        <span className="inline-flex shrink-0 items-center gap-1 text-text-secondary">
          {thinkingSupported ? thinkingLabel : "Auto"}
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </motion.button>

      <div
        ref={triggerMeasureRef}
        className={`pointer-events-none invisible absolute left-0 top-0 flex min-h-8 w-max items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium ${triggerClassName}`}
        aria-hidden="true"
      >
        {!disableBgActivity && <span className="h-1.5 w-1.5 shrink-0 rounded-full" />}
        <span>{currentModel?.name || "No Model Configured"}</span>
        <span className="shrink-0">{thinkingSupported ? thinkingLabel : "Auto"}</span>
        <ChevronDown size={14} className="shrink-0" />
      </div>

      <AnimatePresence mode="sync">
        {isOpen && (
          <motion.div
            ref={panelRef}
            className={`popup-surface absolute right-0 z-50 w-[min(11.5rem,calc(100vw-2rem))] rounded-xl border border-border p-1.5 font-normal ${
              opensAbove ? "bottom-full mb-2" : "top-full mt-2"
            }`}
            style={{ boxShadow: "var(--shadow-xl)" }}
            role="dialog"
            aria-label="Model and thinking settings"
            initial={{ opacity: 0, y: opensAbove ? 8 : -8, scale: motionTokens.scale.subtle }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{
              opacity: 0,
              y: opensAbove ? 8 : -8,
              scale: motionTokens.scale.subtle,
              transition: motionTransitions.popoverExit,
            }}
            transition={motionTransitions.popoverEnter}
            onMouseLeave={() => setPanel("root")}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              if (panel !== "root") {
                setPanel("root");
              } else {
                setIsOpen(false);
                requestAnimationFrame(() => triggerRef.current?.focus());
              }
            }}
          >
            <div data-selector-panel="root">
              <button
                type="button"
                data-selector-trigger="models"
                onMouseEnter={() => openSubmenu("models")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => openSubmenu("models", event.detail === 0)}
                className={`group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                  panel === "models" ? "bg-active" : "hover:bg-hover"
                }`}
                aria-expanded={panel === "models"}
              >
                <span className="shrink-0 text-xs font-medium text-text-primary">Model</span>
                <span className="min-w-0 flex-1 truncate text-right text-xs text-text-muted">
                  {currentModel?.name || "No model configured"}
                </span>
                <ChevronRight
                  size={14}
                  className={`shrink-0 text-text-muted transition-transform ${
                    panel === "models" && submenuSide === "left"
                      ? "-translate-x-0.5 rotate-180"
                      : "group-hover:translate-x-0.5"
                  }`}
                  aria-hidden="true"
                />
              </button>
              <button
                type="button"
                data-selector-trigger="thinking"
                onMouseEnter={() => openSubmenu("thinking")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => openSubmenu("thinking", event.detail === 0)}
                className={`group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                  panel === "thinking" ? "bg-active" : "hover:bg-hover"
                }`}
                aria-expanded={panel === "thinking"}
              >
                <span className="shrink-0 text-xs font-medium text-text-primary">Thinking</span>
                <span className="min-w-0 flex-1 truncate text-right text-xs text-text-muted">
                  {thinkingSupported ? thinkingLabel : "Not available"}
                </span>
                <ChevronRight
                  size={14}
                  className={`shrink-0 text-text-muted transition-transform ${
                    panel === "thinking" && submenuSide === "left"
                      ? "-translate-x-0.5 rotate-180"
                      : "group-hover:translate-x-0.5"
                  }`}
                  aria-hidden="true"
                />
              </button>
            </div>

            <AnimatePresence mode="sync" initial={false}>
              {panel === "models" && (
                <motion.div
                  key="selector-models"
                  data-selector-panel="models"
                  className={`popup-surface absolute z-50 w-[min(11.5rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border p-1.5 ${
                    submenuSide === "right" ? "left-full -ml-px" : "right-full -mr-px"
                  } ${opensAbove ? "bottom-0" : "top-0"}`}
                  style={{
                    boxShadow: "var(--shadow-xl)",
                    transformOrigin: submenuSide === "right" ? "left center" : "right center",
                  }}
                  role="group"
                  aria-label="Model options"
                  initial={{
                    opacity: 0,
                    x: submenuSide === "right" ? -motionTokens.distance.sm : motionTokens.distance.sm,
                    scale: motionTokens.scale.subtle,
                  }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{
                    opacity: 0,
                    x: submenuSide === "right" ? -motionTokens.distance.sm : motionTokens.distance.sm,
                    scale: motionTokens.scale.subtle,
                    transition: motionTransitions.popoverExit,
                  }}
                  transition={motionTransitions.popoverEnter}
                >
                  <div className="max-h-72 space-y-0.5 overflow-y-auto overscroll-contain pr-0.5">
                    {enabledModels.length === 0 ? (
                      <div className="px-3 py-5 text-center text-xs text-text-muted">
                        No models configured. Go to Settings &gt; Models to add one.
                      </div>
                    ) : (
                      enabledModels.map((model) => {
                        const status = modelStatuses[model.id] ?? "disconnected";
                        const isSelected = selectedModel === model.id;
                        return (
                          <button
                            key={model.id}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              onModelChange(model.id);
                              closeSubmenu("models");
                            }}
                            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                              isSelected
                                ? "bg-active text-text-primary"
                                : "text-text-secondary hover:bg-hover hover:text-text-primary"
                            }`}
                            aria-pressed={isSelected}
                          >
                            {!disableBgActivity && (
                              <span
                                className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_COLORS[status]}`}
                                title={t(STATUS_KEYS[status]) || STATUS_LABELS[status] || status}
                                aria-hidden="true"
                              />
                            )}
                            <span className="min-w-0 flex-1 truncate text-xs font-medium" title={model.modelId}>
                              {model.name}
                            </span>
                            {isSelected && <Check size={14} className="shrink-0" aria-hidden="true" />}
                          </button>
                        );
                      })
                    )}
                  </div>
                </motion.div>
              )}

              {panel === "thinking" && (
                <motion.div
                  key="selector-thinking"
                  data-selector-panel="thinking"
                  className={`popup-surface absolute z-50 w-[min(11.5rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border p-1.5 ${
                    submenuSide === "right" ? "left-full -ml-px" : "right-full -mr-px"
                  } ${opensAbove ? "bottom-0" : "top-0"}`}
                  style={{
                    boxShadow: "var(--shadow-xl)",
                    transformOrigin: submenuSide === "right" ? "left center" : "right center",
                  }}
                  role="group"
                  aria-label="Thinking options"
                  initial={{
                    opacity: 0,
                    x: submenuSide === "right" ? -motionTokens.distance.sm : motionTokens.distance.sm,
                    scale: motionTokens.scale.subtle,
                  }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{
                    opacity: 0,
                    x: submenuSide === "right" ? -motionTokens.distance.sm : motionTokens.distance.sm,
                    scale: motionTokens.scale.subtle,
                    transition: motionTransitions.popoverExit,
                  }}
                  transition={motionTransitions.popoverEnter}
                >
                  <div className="space-y-0.5">
                    {THINKING_LEVELS.map((option) => {
                      const isSelected = thinkingLevel === option.value;
                      const isDisabled = option.value !== "auto" && !thinkingSupported;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          disabled={isDisabled}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            if (!currentModel) return;
                            updateModel(currentModel.id, { thinkingLevel: option.value });
                            closeSubmenu("thinking");
                          }}
                          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                            isSelected
                              ? "bg-active text-text-primary"
                              : "text-text-secondary hover:bg-hover hover:text-text-primary"
                          } disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent`}
                          aria-pressed={isSelected}
                          title={isDisabled ? "This model does not expose adjustable thinking." : undefined}
                        >
                          <span className="min-w-0 flex-1 text-xs font-medium">{option.label}</span>
                          {isSelected && <Check size={14} className="shrink-0" aria-hidden="true" />}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
