export type LogLevel = "info" | "warn" | "error";

export type LogSource =
  "general" | "chat" | "model" | "search" | "mcp" | "storage" | "stream" | "git" | "appshots" | "skills";

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  source: LogSource;
  message: string;
  details?: string;
  action?: string;
}
