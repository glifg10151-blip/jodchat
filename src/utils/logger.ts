import type { LogEntry, LogSource, LogLevel } from "../types/log";
import { useUIStore } from "../store/useUIStore";

const MAX_LOGS = 500;
let logBuffer: LogEntry[] = [];
let tauriLogAvailable = false;
let syncScheduled = false;
let rafId = 0;

checkTauriLog();

async function checkTauriLog(): Promise<boolean> {
  if (tauriLogAvailable) return true;
  try {
    await import("@tauri-apps/plugin-log");
    tauriLogAvailable = true;
  } catch {
    tauriLogAvailable = false;
  }
  return tauriLogAvailable;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function syncToStore(buffer: LogEntry[]) {
  try {
    useUIStore.getState().setLogBuffer([...buffer]);
  } catch {
    // UI store not ready yet
  }
}

function scheduleSync() {
  if (syncScheduled) return;
  syncScheduled = true;
  rafId = requestAnimationFrame(() => {
    syncScheduled = false;
    syncToStore(logBuffer);
  });
}

function pushLog(entry: LogEntry) {
  try {
    const isEnabled = useUIStore.getState().isLoggingEnabled;
    if (isEnabled === false) return;
  } catch {
    // UI store not ready yet
  }
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOGS) {
    logBuffer = logBuffer.slice(-MAX_LOGS);
  }
  scheduleSync();
}

export function getLogBuffer(): LogEntry[] {
  return [...logBuffer];
}

export function clearLogs() {
  logBuffer = [];
  if (syncScheduled) {
    syncScheduled = false;
    cancelAnimationFrame(rafId);
  }
  syncToStore([]);
}

export function logInfo(source: LogSource, message: string, options?: { details?: string }) {
  const entry: LogEntry = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    level: "info",
    source,
    message,
    details: options?.details,
  };
  const tauriMsg = options?.details ? `[${source}] ${message} | ${options.details}` : `[${source}] ${message}`;
  console.info(tauriMsg);
  writeToTauri("info", tauriMsg).catch(() => {});
  pushLog(entry);
}

export function logWarn(source: LogSource, message: string, options?: { details?: string; action?: string }) {
  const entry: LogEntry = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    level: "warn",
    source,
    message,
    details: options?.details,
    action: options?.action,
  };
  let tauriMsg = `[${source}] ${message}`;
  if (options?.details) tauriMsg += ` | ${options.details}`;
  if (options?.action) tauriMsg += ` | Fix: ${options.action}`;
  console.warn(tauriMsg);
  writeToTauri("warn", tauriMsg).catch(() => {});
  pushLog(entry);
}

export function logError(
  source: LogSource,
  message: string,
  options?: { error?: unknown; details?: string; action?: string },
) {
  let errorStr = "";
  let errorChain = "";
  if (options?.error !== undefined && options?.error !== null) {
    if (options.error instanceof Error) {
      errorStr = options.error.message;
      errorChain = options.error.stack || options.error.message;
      let cause: unknown = (options.error as Error & { cause?: unknown }).cause;
      while (cause instanceof Error) {
        errorChain += `\n  Caused by: ${cause.message}`;
        cause = (cause as Error & { cause?: unknown }).cause;
      }
    } else if (typeof options.error === "string") {
      errorStr = options.error;
      errorChain = options.error;
    } else {
      try {
        errorStr = JSON.stringify(options.error);
        errorChain = errorStr;
      } catch {
        errorStr = String(options.error);
        errorChain = errorStr;
      }
    }
  }

  let detailStr = options?.details || "";
  if (errorStr) {
    if (detailStr) {
      detailStr = `${detailStr} | Error: ${errorStr}`;
    } else {
      detailStr = errorStr;
    }
  }
  if (errorChain && errorChain !== errorStr) {
    detailStr = detailStr ? `${detailStr}\nFull error chain: ${errorChain}` : `Full error chain: ${errorChain}`;
  }

  const entry: LogEntry = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    level: "error",
    source,
    message,
    details: detailStr || undefined,
    action: options?.action,
  };
  let tauriMsg = `[${source}] ${message}`;
  if (detailStr) tauriMsg += ` | ${detailStr.replace(/\n/g, " | ")}`;
  if (options?.action) tauriMsg += ` | Fix: ${options.action}`;
  console.error(tauriMsg);
  writeToTauri("error", tauriMsg).catch(() => {});
  pushLog(entry);
}

async function writeToTauri(level: LogLevel, message: string) {
  if (!tauriLogAvailable) return;
  try {
    const isEnabled = useUIStore.getState().isLoggingEnabled;
    if (isEnabled === false) return;
  } catch {
    // ignore
  }
  try {
    const tauriLog = await import("@tauri-apps/plugin-log");
    switch (level) {
      case "info":
        await tauriLog.info(message);
        break;
      case "warn":
        await tauriLog.warn(message);
        break;
      case "error":
        await tauriLog.error(message);
        break;
    }
  } catch {
    // Tauri log plugin not available
  }
}
