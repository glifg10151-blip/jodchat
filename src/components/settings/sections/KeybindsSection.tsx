import { useEffect } from "react";
import { useKeybindStore, KeybindAction } from "../../../store/useKeybindStore";
import { RotateCcw, Keyboard, Edit3, X } from "lucide-react";
import { motion } from "motion/react";
import { springs, motionTokens } from "../../../lib/motion-tokens";
import { useTranslation } from "../../../utils/i18n";
import { getShortcutDisplayParts } from "../../../utils/shortcutDisplay";

export const KeybindsSection = () => {
  const { t } = useTranslation();
  const keybinds = useKeybindStore((s) => s.keybinds);
  const isRecording = useKeybindStore((s) => s.isRecording);
  const validationError = useKeybindStore((s) => s.validationError);
  const setKeycombo = useKeybindStore((s) => s.setKeycombo);
  const resetKeycombo = useKeybindStore((s) => s.resetKeycombo);
  const resetAllKeybinds = useKeybindStore((s) => s.resetAllKeybinds);
  const startRecording = useKeybindStore((s) => s.startRecording);
  const stopRecording = useKeybindStore((s) => s.stopRecording);

  // Group keybinds by category
  const categories: Record<KeybindAction["category"], KeybindAction[]> = {
    Recommended: [],
    Navigation: [],
    Conversation: [],
    Layout: [],
  };

  Object.values(keybinds).forEach((action) => {
    categories[action.category].push(action);
  });

  // Capture phase listener to record custom combinations
  useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Escape key cancels the recording process
      if (e.key === "Escape") {
        stopRecording();
        return;
      }

      const key = e.key;

      // Ignore single modifier key taps
      if (["Control", "Shift", "Alt", "Meta"].includes(key)) {
        return;
      }

      const mods = [];
      if (e.ctrlKey || e.metaKey) mods.push("Ctrl");
      if (e.altKey) mods.push("Alt");
      if (e.shiftKey) mods.push("Shift");

      let keyName = key.toUpperCase();
      if (key === " ") keyName = "Space";
      else if (key === "ArrowUp") keyName = "ArrowUp";
      else if (key === "ArrowDown") keyName = "ArrowDown";
      else if (key === "ArrowLeft") keyName = "ArrowLeft";
      else if (key === "ArrowRight") keyName = "ArrowRight";

      const newCombo = [...mods, keyName].join("+");
      const result = setKeycombo(isRecording, newCombo);
      if (result.ok) stopRecording();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isRecording, setKeycombo, stopRecording]);

  const renderCombo = (combo: string) => {
    return (
      <div className="flex items-center gap-1">
        {getShortcutDisplayParts(combo).map((part, idx) => (
          <span key={idx} className="inline-flex items-center">
            {idx > 0 && <span className="text-text-muted mx-0.5 text-[10px]">+</span>}
            <kbd className="px-2 py-1 text-[10px] font-mono font-bold bg-hover border border-border/70 text-text-primary rounded-md shadow-sm">
              {part}
            </kbd>
          </span>
        ))}
      </div>
    );
  };

  return (
    <div id="setting-keybinds-shortcuts" className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-text-primary mb-1">
            {t("settings.keybinds.title")}
          </h3>
          <p className="text-xs text-text-muted">{t("settings.keybinds.subtitle")}</p>
          {validationError && (
            <p className="mt-1 text-xs text-danger" role="alert">
              {validationError}
            </p>
          )}
        </div>
        <motion.button
          onClick={resetAllKeybinds}
          whileHover={{ scale: motionTokens.scale.pop }}
          whileTap={{ scale: motionTokens.scale.press }}
          transition={springs.snappy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-hover text-xs font-medium text-text-secondary hover:text-text-primary transition-colors shadow-sm"
        >
          <RotateCcw size={14} />
          <span>{t("settings.keybinds.resetAll")}</span>
        </motion.button>
      </div>

      <div className="space-y-6 pb-8">
        {(Object.keys(categories) as KeybindAction["category"][]).map((catName) => {
          const list = categories[catName];
          if (list.length === 0) return null;

          return (
            <div key={catName} className="space-y-3">
              <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider pl-1">
                {t(`settings.keybinds.category.${catName}`)}
              </h4>

              <div className="bg-surface border border-border rounded-xl divide-y divide-border/40 shadow-sm overflow-hidden">
                {list.map((action) => {
                  const recording = isRecording === action.id;
                  const isModified = action.currentCombo !== action.defaultCombo;

                  return (
                    <div
                      key={action.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-4"
                    >
                      {/* Action Info */}
                      <div className="space-y-1 flex-1 min-w-0">
                        <span className="text-sm font-medium text-text-primary block">
                          {t(`settings.keybinds.action.${action.id}.label`) || action.label}
                        </span>
                        <span className="text-xs text-text-muted block leading-relaxed">
                          {t(`settings.keybinds.action.${action.id}.desc`) || action.description}
                        </span>
                      </div>

                      {/* Combination & Edit buttons */}
                      <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                        {recording ? (
                          <div className="flex items-center gap-2 text-accent font-semibold text-xs bg-accent-soft px-3 py-1.5 rounded-lg border border-accent/20 animate-pulse">
                            <Keyboard size={14} className="shrink-0" />
                            <span>{t("settings.keybinds.pressCombo")}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                stopRecording();
                              }}
                              className="text-text-muted hover:text-text-primary ml-1"
                              aria-label={t("settings.keybinds.cancelRecording")}
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <>
                            {renderCombo(action.currentCombo)}

                            <motion.button
                              onClick={() => startRecording(action.id)}
                              whileHover={{ scale: motionTokens.scale.pop }}
                              whileTap={{ scale: motionTokens.scale.press }}
                              transition={springs.snappy}
                              className="p-1.5 rounded-lg border border-border bg-surface hover:bg-hover text-text-secondary hover:text-text-primary transition-colors shadow-sm"
                              title={t("settings.keybinds.editTooltip")}
                            >
                              <Edit3 size={14} />
                            </motion.button>

                            {isModified && (
                              <motion.button
                                onClick={() => resetKeycombo(action.id)}
                                whileHover={{ scale: motionTokens.scale.pop }}
                                whileTap={{ scale: motionTokens.scale.press }}
                                transition={springs.snappy}
                                className="p-1.5 rounded-lg border border-border bg-surface hover:bg-hover text-text-secondary hover:text-text-primary transition-colors shadow-sm"
                                title={t("settings.keybinds.resetTooltip")}
                              >
                                <RotateCcw size={14} />
                              </motion.button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
