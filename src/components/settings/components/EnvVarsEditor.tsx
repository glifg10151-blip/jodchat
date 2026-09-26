import { memo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, Variable, Eye, EyeOff, X, Plus } from "lucide-react";
import { motionTransitions } from "../../../lib/motion-tokens";
import { useTranslation } from "../../../utils/i18n";

interface EnvVarsEditorProps {
  envVars: Record<string, string>;
  onChange: (vars: Record<string, string>) => void;
}

export const EnvVarsEditor = memo(function EnvVarsEditor({ envVars, onChange }: EnvVarsEditorProps) {
  const { t } = useTranslation();
  const [envExpanded, setEnvExpanded] = useState(false);
  const [newEnvKey, setNewEnvKey] = useState("");
  const [newEnvValue, setNewEnvValue] = useState("");
  const [showEnvValues, setShowEnvValues] = useState<Record<string, boolean>>({});

  const addEnvVar = () => {
    const key = newEnvKey.trim();
    if (!key) return;
    onChange({ ...envVars, [key]: newEnvValue });
    setNewEnvKey("");
    setNewEnvValue("");
  };

  const removeEnvVar = (key: string) => {
    const updated = { ...envVars };
    delete updated[key];
    onChange(updated);
  };

  const updateEnvValue = (key: string, value: string) => {
    onChange({ ...envVars, [key]: value });
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setEnvExpanded(!envExpanded)}
        className="flex items-center gap-1.5 text-xs font-medium text-text-muted hover:text-text-secondary transition-colors"
        aria-expanded={envExpanded}
        aria-label={t("settings.mcp.toggleEnvVars", { defaultValue: "Toggle environment variables" })}
      >
        <Variable size={12} />
        {t("settings.mcp.envVars")}
        {Object.keys(envVars).length > 0 && (
          <span className="px-1.5 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-medium">
            {Object.keys(envVars).length}
          </span>
        )}
        <ChevronDown size={12} className={`transition-transform ${envExpanded ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence>
        {envExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={motionTransitions.content}
            className="overflow-hidden"
          >
            <div className="mt-1.5 p-2.5 rounded-lg bg-input border border-input-border space-y-2">
              {Object.entries(envVars).map(([key, value]) => (
                <div key={key} className="flex items-center gap-1.5">
                  <span className="text-xs font-mono font-medium text-text-primary bg-surface px-2 py-1 rounded border border-border min-w-[80px] truncate">
                    {key}
                  </span>
                  <div className="flex-1 relative">
                    <input
                      type={showEnvValues[key] ? "text" : "password"}
                      value={value}
                      onChange={(e) => updateEnvValue(key, e.target.value)}
                      className="w-full px-2.5 py-1 rounded border border-input-border bg-surface text-xs text-text-primary font-mono focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors"
                      aria-label={`Value for ${key}`}
                    />
                    <button
                      onClick={() => setShowEnvValues((prev) => ({ ...prev, [key]: !prev[key] }))}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-muted/50 hover:text-text-muted transition-colors"
                      aria-label={
                        showEnvValues[key]
                          ? t("settings.mcp.hideValue", { defaultValue: "Hide value" })
                          : t("settings.mcp.showValue", { defaultValue: "Show value" })
                      }
                    >
                      {showEnvValues[key] ? <EyeOff size={11} /> : <Eye size={11} />}
                    </button>
                  </div>
                  <button
                    onClick={() => removeEnvVar(key)}
                    className="p-1 rounded text-text-muted/50 hover:text-red-500 hover:bg-red-500/10 transition-colors shrink-0"
                    aria-label={`Remove ${key}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}

              <div className="flex items-center gap-1.5 pt-1 border-t border-border/30">
                <input
                  type="text"
                  value={newEnvKey}
                  onChange={(e) => setNewEnvKey(e.target.value)}
                  placeholder={t("settings.mcp.envKeyPlaceholder", { defaultValue: "KEY" })}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                  className="flex-1 min-w-[80px] px-2.5 py-1 rounded border border-input-border bg-surface text-xs text-text-primary placeholder-text-muted/40 font-mono focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors"
                  aria-label={t("settings.mcp.envKeyAria", { defaultValue: "New env var key" })}
                />
                <input
                  type="text"
                  value={newEnvValue}
                  onChange={(e) => setNewEnvValue(e.target.value)}
                  placeholder={t("settings.mcp.envVal", { defaultValue: "value" })}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                  className="flex-[2] px-2.5 py-1 rounded border border-input-border bg-surface text-xs text-text-primary placeholder-text-muted/40 font-mono focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors"
                  aria-label={t("settings.mcp.envValAria", { defaultValue: "New env var value" })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addEnvVar();
                  }}
                />
                <button
                  onClick={addEnvVar}
                  disabled={!newEnvKey.trim()}
                  className="p-1 rounded text-accent hover:bg-accent/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                  aria-label={t("settings.mcp.addEnv")}
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
