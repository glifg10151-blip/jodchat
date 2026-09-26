import { useMcpStore } from "../../../store/useMcpStore";
import { endpointFieldError } from "../../../utils/endpointError";
import { EndpointError } from "./EndpointError";
import { memo, useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useUIStore } from "../../../store/useUIStore";
import { useTranslation } from "../../../utils/i18n";
import {
  Trash2,
  ChevronDown,
  AlertCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  PlugZap,
  Plug,
  X,
  Plus,
  ShieldAlert,
} from "lucide-react";
import {
  McpServerConfig,
  McpServerStatus,
  ExecutableCheck,
  McpTransport,
  MCP_STATUS_COLORS,
  MCP_STATUS_LABELS,
} from "../../../types";
import { MCP_TRANSPORT_PRESETS, MCP_SERVER_PRESETS, McpServerPreset } from "../../../config/mcpPresets";
import { springs, motionTokens, motionTransitions } from "../../../lib/motion-tokens";
import { EnvVarsEditor } from "./EnvVarsEditor";
import { Switch } from "../../ui/Switch";
import { Select } from "../../ui/Select";

interface McpServerCardProps {
  id?: string;
  config: McpServerConfig;
  status: McpServerStatus;
  tools: { name: string; description: string }[];
  envVars: Record<string, string>;
  onUpdate: (id: string, updates: Partial<McpServerConfig>) => void;
  onDelete: (id: string) => void;
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
  onSetEnvVars: (id: string, vars: Record<string, string>) => void;
  onCheckCommand: (command: string) => Promise<ExecutableCheck>;
  onApplyPreset: (preset: McpServerPreset, currentConfig: McpServerConfig) => void;
  showKey: boolean;
  onToggleKey: (id: string) => void;
}

export const McpServerCard = memo(function McpServerCard({
  id,
  config,
  status,
  tools,
  envVars,
  onUpdate,
  onDelete,
  onConnect,
  onDisconnect,
  onSetEnvVars,
  onCheckCommand,
  onApplyPreset,
  showKey,
  onToggleKey,
}: McpServerCardProps) {
  const { t } = useTranslation();
  const connectionError = useMcpStore((s) => s.serverErrors[config.id]);
  const endpointError = endpointFieldError(config.baseUrl || "", status, connectionError);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const disableBgActivity = useUIStore((s) => s.disableBgActivity);
  const [exeCheck, setExeCheck] = useState<ExecutableCheck | null>(null);
  const [exeChecking, setExeChecking] = useState(false);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commandValue = config.command || "";
  const args = config.args ?? [];

  useEffect(() => {
    if (config.transport !== "stdio") return;
    const trimmed = commandValue.trim();

    if (checkTimer.current) clearTimeout(checkTimer.current);

    if (!trimmed) {
      setExeCheck(null);
      setExeChecking(false);
      return;
    }

    setExeChecking(true);
    checkTimer.current = setTimeout(async () => {
      const result = await onCheckCommand(trimmed);
      setExeCheck(result);
      setExeChecking(false);
    }, 450);

    return () => {
      if (checkTimer.current) clearTimeout(checkTimer.current);
    };
  }, [commandValue, config.transport, onCheckCommand]);

  const updateArg = (index: number, value: string) => {
    const next = [...args];
    next[index] = value;
    onUpdate(config.id, { args: next });
  };
  const addArg = () => {
    onUpdate(config.id, { args: [...args, ""] });
  };
  const removeArg = (index: number) => {
    const next = args.filter((_, i) => i !== index);
    onUpdate(config.id, { args: next });
  };
  const commitArgAndAdvance = (index: number, value: string) => {
    updateArg(index, value);
    if (index === args.length - 1 && value.trim()) addArg();
  };

  const commandHasSpace = commandValue.trim().includes(" ");
  const isTrusted = config.trustLevel === "trusted";
  const isVerifiedPlugin = Boolean(config.catalogPluginId);

  const handleTrustChange = (trusted: boolean) => {
    if (!trusted) {
      onUpdate(config.id, { trustLevel: "untrusted" });
      return;
    }

    const confirmed = window.confirm(
      t("settings.mcp.trustConfirm", {
        name: config.name,
      }),
    );
    if (confirmed) {
      onUpdate(config.id, { trustLevel: "trusted" });
    }
  };

  return (
    <motion.div
      id={id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTransitions.content}
      className={`bg-surface border rounded-xl p-4 space-y-3 shadow-sm relative group ${config.enabled ? "border-border" : "border-border opacity-60"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">{t("settings.mcp.enabled")}</p>
          <p className="text-xs text-text-muted mt-0.5">{t("settings.mcp.enabledDesc")}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Switch
            checked={config.enabled}
            onChange={(checked) => onUpdate(config.id, { enabled: checked })}
            ariaLabel={`Enable MCP server ${config.name}`}
          />
          <motion.button
            onClick={() => onDelete(config.id)}
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            transition={springs.snappy}
            className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label={t("settings.mcp.deleteTooltip", {
              defaultValue: `Delete MCP server ${config.name}`,
              name: config.name,
            })}
          >
            <Trash2 size={16} />
          </motion.button>
        </div>
      </div>

      {!disableBgActivity && (
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-2 h-2 rounded-full ${MCP_STATUS_COLORS[status]}`} aria-label={`Status: ${status}`} />
          <span className="text-[11px] text-text-muted capitalize">{MCP_STATUS_LABELS[status]}</span>
          {status === "connected" && <span className="text-[10px] text-text-muted ml-1">({tools.length} tools)</span>}
        </div>
      )}

      {isVerifiedPlugin ? (
        <div
          className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300"
          role="status"
        >
          <CheckCircle2 size={15} className="shrink-0" aria-hidden="true" />
          <span>{t("settings.mcp.verifiedPlugin")}</span>
        </div>
      ) : (
        <div
          className={`rounded-lg border p-3 ${
            isTrusted ? "border-amber-500/40 bg-amber-500/10" : "border-border bg-input/40"
          }`}
        >
          <Switch
            checked={isTrusted}
            onChange={handleTrustChange}
            label={t("settings.mcp.trust")}
            description={t("settings.mcp.trustDesc")}
            ariaLabel={`Trust MCP server ${config.name}`}
          />
          {isTrusted && (
            <div
              className="mt-3 pt-3 border-t border-amber-500/20 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300"
              role="status"
            >
              <ShieldAlert size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
              <span>{t("settings.mcp.trustedWarning")}</span>
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        {config.transport === "stdio" && (
          <div className="space-y-1">
            <label
              className="text-xs font-medium text-text-muted flex items-center gap-1.5"
              htmlFor={`mcp-template-${config.id}-trigger`}
            >
              {t("settings.mcp.template")}
            </label>
            <Select
              id={`mcp-template-${config.id}`}
              value=""
              onChange={(presetId) => {
                const preset = MCP_SERVER_PRESETS.find((candidate) => candidate.id === presetId);
                if (preset) onApplyPreset(preset, config);
              }}
              options={[
                { value: "", label: t("settings.mcp.chooseTemplate") },
                ...MCP_SERVER_PRESETS.map((preset) => ({
                  value: preset.id,
                  label: preset.name,
                  description: preset.description,
                })),
              ]}
              aria-label="Apply MCP server template"
            />
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted" htmlFor={`mcp-name-${config.id}`}>
              {t("settings.mcp.name")}
            </label>
            <input
              id={`mcp-name-${config.id}`}
              type="text"
              value={config.name}
              onChange={(e) => onUpdate(config.id, { name: e.target.value })}
              placeholder="e.g. Filesystem"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              className="w-full h-10 px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted" htmlFor={`mcp-transport-${config.id}-trigger`}>
              {t("settings.mcp.transport")}
            </label>
            <Select
              id={`mcp-transport-${config.id}`}
              value={config.transport}
              onChange={(value) => {
                const transport = value as McpTransport;
                const preset = MCP_TRANSPORT_PRESETS.find((candidate) => candidate.transport === transport);
                if (preset) {
                  onUpdate(config.id, {
                    transport,
                    name: config.name === "New MCP Server" ? preset.label : config.name,
                  });
                } else {
                  onUpdate(config.id, { transport });
                }
              }}
              options={MCP_TRANSPORT_PRESETS.map((preset) => ({
                value: preset.transport,
                label: preset.label,
              }))}
              aria-label="MCP transport type"
            />
          </div>
        </div>

        {config.transport === "stdio" && (
          <>
            <div className="space-y-1">
              <label
                className="text-xs font-medium text-text-muted flex items-center gap-1"
                htmlFor={`mcp-command-${config.id}`}
              >
                {t("settings.mcp.command")}
                <span className="text-text-muted/50 font-normal">{t("settings.mcp.commandDesc")}</span>
              </label>
              <input
                id={`mcp-command-${config.id}`}
                aria-invalid={status === "error" && !!connectionError}
                aria-describedby={status === "error" && connectionError ? `command-error-${config.id}` : undefined}
                type="text"
                value={commandValue}
                onChange={(e) => onUpdate(config.id, { command: e.target.value })}
                placeholder="e.g. npx"
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
                className={`w-full h-10 px-3 py-2 rounded-lg border bg-input text-sm text-text-primary placeholder-text-muted font-mono text-xs focus:outline-none transition-colors ${
                  commandHasSpace
                    ? "border-yellow-500/50 focus:border-yellow-500"
                    : "border-input-border focus:border-accent/50"
                }`}
              />
              {commandHasSpace && (
                <p className="flex items-center gap-1 text-[11px] text-yellow-500 mt-0.5" role="alert">
                  <AlertCircle size={11} />
                  {t("settings.mcp.validation.spaces")}
                </p>
              )}
              <EndpointError
                id={`command-error-${config.id}`}
                message={status === "error" ? connectionError : undefined}
              />
              {exeChecking && (
                <p className="flex items-center gap-1 text-[11px] text-text-muted mt-0.5">
                  <Loader2 size={11} className="animate-spin" />
                  {t("settings.mcp.validation.checking")}
                </p>
              )}
              {!exeChecking && exeCheck && (
                <p
                  className={`flex items-start gap-1 text-[11px] mt-0.5 ${exeCheck.found ? "text-green-600 dark:text-green-500" : "text-red-600 dark:text-red-400"}`}
                  role="status"
                >
                  {exeCheck.found ? (
                    <CheckCircle2 size={11} className="mt-0.5 shrink-0" />
                  ) : (
                    <XCircle size={11} className="mt-0.5 shrink-0" />
                  )}
                  <span className="break-words">{exeCheck.message}</span>
                </p>
              )}
            </div>

            <div className="space-y-1">
              <label
                className="text-xs font-medium text-text-muted flex items-center gap-1"
                htmlFor={`mcp-args-${config.id}`}
              >
                {t("settings.mcp.args")}
                <span className="text-text-muted/50 font-normal">
                  {t("settings.mcp.argsDesc", { defaultValue: "(one per chip — paths with spaces are safe)" })}
                </span>
              </label>
              <div
                id={`mcp-args-${config.id}`}
                className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-input-border bg-input px-2 py-1.5"
              >
                {args.map((arg, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-0.5 rounded-md border bg-surface pl-2 pr-0.5 py-0.5 ${
                      arg.startsWith("<") && arg.endsWith(">") ? "border-accent/50" : "border-input-border"
                    }`}
                  >
                    <input
                      type="text"
                      value={arg}
                      onChange={(e) => updateArg(i, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitArgAndAdvance(i, (e.target as HTMLInputElement).value);
                        }
                        if (e.key === "Backspace" && arg === "" && args.length > 1) {
                          e.preventDefault();
                          removeArg(i);
                        }
                      }}
                      placeholder="<value>"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck="false"
                      className="w-auto min-w-[60px] max-w-[260px] bg-transparent text-xs text-text-primary placeholder-text-muted/40 font-mono focus:outline-none"
                      aria-label={`Argument ${i + 1}`}
                      size={Math.max(arg.length, 6)}
                    />
                    <button
                      onClick={() => removeArg(i)}
                      className="p-0.5 rounded text-text-muted/50 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                      aria-label={`Remove argument ${i + 1}`}
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={addArg}
                  className="flex items-center gap-0.5 px-2 py-0.5 rounded-md border border-dashed border-input-border text-text-muted hover:text-accent hover:border-accent/50 text-[11px] transition-colors"
                  aria-label="Add argument"
                >
                  <Plus size={11} />
                  {t("settings.mcp.addArg")}
                </button>
              </div>
              {args.some((a) => a.startsWith("<") && a.endsWith(">")) && (
                <p className="flex items-center gap-1 text-[11px] text-accent/70 mt-0.5">
                  <AlertCircle size={11} />
                  {t("settings.mcp.placeholdersWarning", {
                    defaultValue: "Replace the highlighted placeholders (e.g. <PATH>) with real values.",
                  })}
                </p>
              )}
            </div>

            <EnvVarsEditor envVars={envVars} onChange={(vars) => onSetEnvVars(config.id, vars)} />
          </>
        )}

        {(config.transport === "sse" || config.transport === "streamable-http") && (
          <>
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted" htmlFor={`mcp-base-${config.id}`}>
                {t("settings.mcp.baseUrl", { defaultValue: "Base URL" })}
              </label>
              <input
                id={`mcp-base-${config.id}`}
                type="url"
                aria-invalid={!!endpointError}
                aria-describedby={endpointError ? `endpoint-error-${config.id}` : undefined}
                value={config.baseUrl || ""}
                onChange={(e) => onUpdate(config.id, { baseUrl: e.target.value })}
                placeholder={
                  config.transport === "sse" ? "e.g. http://localhost:3001/sse" : "e.g. http://localhost:3001/mcp"
                }
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
                className="w-full h-10 px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted font-mono text-xs focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors"
              />
              <EndpointError id={`endpoint-error-${config.id}`} message={endpointError} />
              <p className="text-[11px] text-text-muted/60 mt-0.5">
                {config.transport === "sse"
                  ? "SSE endpoint URL (usually ends with /sse)"
                  : "Streamable HTTP endpoint URL (usually ends with /mcp)"}
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted" htmlFor={`mcp-key-${config.id}`}>
                {t("settings.mcp.apiKeyOptional", { defaultValue: "API Key (optional)" })}
              </label>
              <div className="relative">
                <input
                  id={`mcp-key-${config.id}`}
                  type={showKey ? "text" : "password"}
                  value={config.apiKey || ""}
                  onChange={(e) => onUpdate(config.id, { apiKey: e.target.value })}
                  placeholder="Bearer token or API key"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                  className="w-full h-10 px-3 py-2 pr-9 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors"
                />
                <button
                  onClick={() => onToggleKey(config.id)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors p-1"
                  aria-label={
                    showKey
                      ? t("settings.mcp.hideApiKey", { defaultValue: "Hide API key" })
                      : t("settings.mcp.showApiKey", { defaultValue: "Show API key" })
                  }
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <EnvVarsEditor envVars={envVars} onChange={(vars) => onSetEnvVars(config.id, vars)} />
          </>
        )}

        <div>
          <div className="flex items-center gap-2 pt-2 flex-wrap">
            {status === "connected" ? (
              <motion.button
                onClick={() => onDisconnect(config.id)}
                whileHover={{ scale: motionTokens.scale.pop }}
                whileTap={{ scale: motionTokens.scale.press }}
                transition={springs.snappy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-500/10 border border-border text-xs transition-colors min-h-[36px]"
                aria-label={t("settings.mcp.disconnectAria", { defaultValue: "Disconnect MCP server" })}
              >
                <PlugZap size={14} />
                {t("settings.mcp.disconnect", { defaultValue: "Disconnect" })}
              </motion.button>
            ) : (
              <motion.button
                onClick={() => onConnect(config.id)}
                disabled={
                  status === "connecting" ||
                  (config.transport === "stdio" && !config.command?.trim()) ||
                  ((config.transport === "sse" || config.transport === "streamable-http") && !config.baseUrl?.trim())
                }
                whileHover={status === "connecting" ? undefined : { scale: motionTokens.scale.pop }}
                whileTap={status === "connecting" ? undefined : { scale: motionTokens.scale.press }}
                transition={springs.snappy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-accent hover:bg-accent/10 border border-accent/30 text-xs font-medium transition-colors min-h-[36px] disabled:opacity-50"
                aria-label={t("settings.mcp.connectAria", { defaultValue: "Connect MCP server" })}
              >
                {status === "connecting" ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
                {status === "connecting"
                  ? t("settings.mcp.connecting", { defaultValue: "Connecting\u2026" })
                  : t("settings.mcp.connect", { defaultValue: "Connect" })}
              </motion.button>
            )}

            {config.transport === "stdio" && !config.command?.trim() && (
              <p className="flex items-center gap-1 text-[11px] text-yellow-500">
                <AlertCircle size={11} />
                {t("settings.mcp.commandRequired", { defaultValue: "Command is required to connect" })}
              </p>
            )}
            {(config.transport === "sse" || config.transport === "streamable-http") && !config.baseUrl?.trim() && (
              <p className="flex items-center gap-1 text-[11px] text-yellow-500">
                <AlertCircle size={11} />
                {t("settings.mcp.baseUrlRequired", { defaultValue: "Base URL is required to connect" })}
              </p>
            )}

            {tools.length > 0 && (
              <motion.button
                onClick={() => setToolsExpanded(!toolsExpanded)}
                whileHover={{ scale: motionTokens.scale.pop }}
                whileTap={{ scale: motionTokens.scale.press }}
                transition={springs.snappy}
                className="text-text-muted hover:text-text-secondary text-xs flex items-center gap-1"
                aria-label={toolsExpanded ? t("settings.mcp.hideTools") : t("settings.mcp.showTools")}
              >
                <ChevronDown size={12} className={`transition-transform ${toolsExpanded ? "rotate-180" : ""}`} />
                {t("settings.mcp.tools", { count: String(tools.length) })}
              </motion.button>
            )}
          </div>

          <AnimatePresence>
            {toolsExpanded && tools.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={motionTransitions.content}
                className="overflow-hidden"
              >
                <div className="mt-3 p-2 rounded-lg bg-input border border-input-border max-h-48 overflow-y-auto">
                  {tools.map((tool, i) => (
                    <div key={i} className="py-1.5 border-b border-border/30 last:border-0">
                      <p className="text-xs font-medium text-text-primary font-mono">{tool.name}</p>
                      {tool.description && (
                        <p className="text-[11px] text-text-muted mt-0.5 line-clamp-2">{tool.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
});
