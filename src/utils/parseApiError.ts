const ERROR_MESSAGES: Record<string, string> = {
  400: "Bad request — the API received invalid parameters.",
  401: "Invalid API key — check your credentials in Settings.",
  403: "Access denied — your API key does not have permission for this model.",
  404: "Model not found — the model ID may be incorrect or deprecated.",
  429: "Rate limited — too many requests. Wait a moment and try again.",
  500: "Server error — the provider is having issues. Try again later.",
  502: "Bad gateway — the provider server is temporarily unreachable.",
  503: "Service unavailable — the provider is temporarily down.",
};

export type ErrorCategory = "network" | "auth" | "rate-limit" | "server" | "config" | "search" | "mcp" | "unknown";

export interface ParsedError {
  message: string;
  action: string;
  category: ErrorCategory;
  retryable: boolean;
  raw?: string;
  rawDetail?: string;
}

const ERROR_ACTIONS: Record<string, string> = {
  400: "Check that your model settings (like temperature or system prompt) are valid.",
  401: "Go to Settings > Model Providers and verify your API key is correct. Then click 'Check Connection'.",
  403: "Your API key might be restricted or you may not have access to this model. Check your provider dashboard.",
  404: "Verify the model ID in Settings > Model Providers. It may have been renamed or deprecated.",
  429: "Wait a minute and try again. If this keeps happening, check your provider's rate limits.",
  500: "The API provider is experiencing issues. Wait a few minutes and try again.",
  502: "The API provider's servers are temporarily down. Wait and try again, or switch to a different model.",
  503: "The service is temporarily unavailable. Wait a few minutes and retry.",
};

interface StructuredAppError {
  ApiError?: { status: number; message: string };
  ConfigIo?: string;
  AppPath?: string;
  RequestFailed?: string;
  StreamError?: string;
  ParseError?: string;
  AuthError?: string;
  SearchError?: string;
  UrlValidationError?: string;
  KeyNotFound?: string;
  McpError?: string;
}

export function parseApiError(err: unknown): ParsedError {
  const raw = extractRaw(err);

  const structured = tryParseStructuredError(raw);
  if (structured) return structured;

  if (err instanceof Error || typeof err === "string") {
    return userFriendlyMessage(raw);
  }

  return {
    message: "An unexpected error occurred. Please try again.",
    action: "If the problem persists, try reloading the app or checking your settings.",
    category: "unknown",
    retryable: false,
    raw,
  };
}

function extractRaw(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function tryParseStructuredError(raw: string): ParsedError | null {
  try {
    const parsed: StructuredAppError = JSON.parse(raw);
    if (parsed.ApiError) {
      const code = String(parsed.ApiError.status);
      const baseMsg = ERROR_MESSAGES[code];
      const customMsg = cleanApiMessage(parsed.ApiError.message);

      let message = baseMsg ? `${baseMsg}` : `API error ${code}`;
      if (customMsg) {
        message = `${message} (${customMsg})`;
      }

      return {
        message,
        action: ERROR_ACTIONS[code] ?? "Check your API settings and try again.",
        category: getCategoryFromCode(code),
        retryable: isRetryableCode(code),
        raw,
      };
    }
    if (parsed.UrlValidationError)
      return {
        message: `URL validation error: ${parsed.UrlValidationError}`,
        action: "Check that the URL is valid and points to a public website.",
        category: "search",
        retryable: false,
        raw,
      };
    if (parsed.KeyNotFound)
      return {
        message: parsed.KeyNotFound,
        action: "Go to Settings and re-enter or verify your API key.",
        category: "auth",
        retryable: false,
        raw,
      };
    if (parsed.AuthError)
      return {
        message: `Authentication error: ${parsed.AuthError}`,
        action: "Check your API key and make sure it's valid for this provider.",
        category: "auth",
        retryable: false,
        raw,
      };
    if (parsed.SearchError)
      return {
        message: `Search error: ${parsed.SearchError}`,
        action: "Check your search provider settings and API credentials.",
        category: "search",
        retryable: true,
        raw,
      };
    if (parsed.McpError) {
      return userFriendlyMcpError(parsed.McpError, raw);
    }
    if (parsed.ConfigIo) {
      const isUtf8Err =
        parsed.ConfigIo.toLowerCase().includes("utf-8") || parsed.ConfigIo.toLowerCase().includes("utf8");
      return {
        message: parsed.ConfigIo,
        action: isUtf8Err
          ? "Check that the file is a valid UTF-8 text document, or convert it to a supported format."
          : "Restart the app. If the issue persists, check file permissions or reinstall.",
        category: "config",
        retryable: false,
        raw,
      };
    }
    if (parsed.StreamError)
      return {
        message: "Stream error — the connection was interrupted.",
        action: "Check your internet connection and try sending the message again.",
        category: "network",
        retryable: true,
        raw,
      };
    if (parsed.ParseError)
      return {
        message: parsed.ParseError
          ? `Response parse error — the API returned unexpected data. (${parsed.ParseError})`
          : "Response parse error — the API returned unexpected data.",
        action: "The API response format might have changed. Check the model settings or try a different model.",
        category: "server",
        retryable: true,
        raw,
      };
    if (parsed.RequestFailed) return userFriendlyMessage(parsed.RequestFailed);
    if (parsed.AppPath)
      return {
        message: "App path error — try reinstalling.",
        action: "The app cannot access its data directory. Try reinstalling or checking permissions.",
        category: "config",
        retryable: false,
        raw,
      };
  } catch {
    // Not structured JSON, fall through.
  }
  return null;
}

function userFriendlyMessage(raw: string): ParsedError {
  const statusMatch = raw.match(/API error (\d{3})/);
  if (statusMatch) {
    const code = statusMatch[1];
    const baseMsg = ERROR_MESSAGES[code];
    const rest = raw.replace(/API error \d{3}:\s*/, "");
    const cleanedRest = cleanApiMessage(rest);

    let message = baseMsg ? `${baseMsg}` : `API error ${code}`;
    if (cleanedRest) {
      message = `${message} (${cleanedRest})`;
    }

    return {
      message,
      action: ERROR_ACTIONS[code] ?? "Check your API settings and try again.",
      category: getCategoryFromCode(code),
      retryable: isRetryableCode(code),
      raw,
    };
  }

  if (raw.includes("Failed to fetch") || raw.includes("NetworkError") || raw.includes("error sending request")) {
    return {
      message: "Network error — check your internet connection and API base URL.",
      action:
        "Verify your internet connection. If the issue persists, check the API base URL in Settings > Model Providers.",
      category: "network",
      retryable: true,
      raw,
    };
  }
  if (raw.includes("timeout") || raw.includes("Timed out")) {
    return {
      message: "Request timed out — the provider took too long to respond.",
      action: "The API server is slow or unresponsive. Wait a moment and try again, or switch models.",
      category: "network",
      retryable: true,
      raw,
    };
  }
  if (raw.includes("Invalid URL") || raw.includes("relative URL without a base")) {
    return {
      message: "Invalid API URL — check the base URL in Settings.",
      action:
        "Go to Settings > Model Providers and verify the API base URL format (e.g., https://api.openai.com/v1/chat/completions).",
      category: "config",
      retryable: false,
      raw,
    };
  }
  if (raw.toLowerCase().includes("mcp") || raw.includes("McpError")) {
    return userFriendlyMcpError(raw, raw);
  }

  return {
    message: raw.length > 200 ? raw.slice(0, 200) + "…" : raw,
    action: "Check your settings and try again. If the problem continues, try reloading the app.",
    category: "unknown",
    retryable: false,
    raw,
  };
}

function userFriendlyMcpError(mcpMessage: string, raw: string): ParsedError {
  const lower = mcpMessage.toLowerCase();

  if (
    lower.includes("auth required") ||
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("unauthorized")
  ) {
    return {
      message: "MCP connection failed: Authentication required.",
      action: "Go to Settings > MCP Servers and verify your API key or authentication credentials.",
      category: "mcp",
      retryable: false,
      raw,
      rawDetail: `MCP auth error: ${mcpMessage}`,
    };
  }
  if (
    lower.includes("failed to spawn") ||
    lower.includes("no such file or directory") ||
    lower.includes("command not found") ||
    lower.includes("binary not found") ||
    lower.includes("not recognized as an internal or external command") ||
    lower.includes("was not found on path") ||
    lower.includes("was not found") ||
    (lower.includes("could not start") && lower.includes("not found"))
  ) {
    const program = extractProgramName(mcpMessage);
    const installHint = installHintFor(program);
    return {
      message: `MCP process failed to start: the command${program ? ` "${program}"` : ""} was not found.`,
      action: `The Command field must be the program name only (e.g. "npx", not "npx -y ..."). ${installHint} You can also set the full path (e.g. /usr/local/bin/npx).`,
      category: "mcp",
      retryable: false,
      raw,
      rawDetail: `MCP spawn error: ${mcpMessage}`,
    };
  }
  if (lower.includes("permission denied") && lower.includes("could not start")) {
    const program = extractProgramName(mcpMessage);
    return {
      message: `MCP process failed to start: permission denied${program ? ` for "${program}"` : ""}.`,
      action: "Make the file executable (chmod +x) or choose a different path in the Command field.",
      category: "mcp",
      retryable: false,
      raw,
      rawDetail: `MCP permission error: ${mcpMessage}`,
    };
  }
  if (lower.includes("timed out") || lower.includes("timeout") || lower.includes("deadline has elapsed")) {
    return {
      message: "MCP connection timed out — the server did not respond in time.",
      action: "Check your internet connection or that the MCP server is active and accessible, then retry.",
      category: "mcp",
      retryable: true,
      raw,
      rawDetail: `MCP timeout: ${mcpMessage}`,
    };
  }
  if (
    lower.includes("handshake failed") ||
    lower.includes("transport") ||
    lower.includes("send message error") ||
    lower.includes("PeerPlugin") ||
    lower.includes("not supported")
  ) {
    const formatted = mcpMessage.toLowerCase().startsWith("mcp handshake failed")
      ? mcpMessage
      : `MCP handshake failed: ${mcpMessage}`;
    return {
      message: formatted,
      action:
        "Check that the MCP server is running correctly, its port/URL is reachable, and any command arguments are valid.",
      category: "mcp",
      retryable: true,
      raw,
      rawDetail: `MCP handshake/transport error: ${mcpMessage}`,
    };
  }
  if (lower.includes("connection refused") || lower.includes("connect refused")) {
    return {
      message: "MCP connection refused — the server is not accepting connections.",
      action: "Check that the MCP server is running and its port is correct.",
      category: "mcp",
      retryable: true,
      raw,
      rawDetail: `MCP connection refused: ${mcpMessage}`,
    };
  }
  return {
    message: mcpMessage.length > 200 ? mcpMessage.slice(0, 200) + "…" : mcpMessage,
    action: "Check your MCP server configuration, command, and environment variables in Settings > MCP Servers.",
    category: "mcp",
    retryable: true,
    raw,
    rawDetail: `MCP error: ${mcpMessage}`,
  };
}

function getCategoryFromCode(code: string): ErrorCategory {
  switch (code) {
    case "400":
    case "404":
      return "config";
    case "401":
    case "403":
      return "auth";
    case "429":
      return "rate-limit";
    case "500":
    case "502":
    case "503":
      return "server";
    default:
      return "unknown";
  }
}

function isRetryableCode(code: string): boolean {
  switch (code) {
    case "429":
    case "500":
    case "502":
    case "503":
      return true;
    case "400":
    case "401":
    case "403":
    case "404":
      return false;
    default:
      return false;
  }
}

/** Backward-compatible: returns just the user message string */
export function parseApiErrorMessage(err: unknown): string {
  return parseApiError(err).message;
}

/** Pulls the first quoted token out of an MCP spawn error like `Could not start "npx": ...`. */
function extractProgramName(msg: string): string | null {
  const match = msg.match(/["']([^"']+)["']/);
  if (match) {
    // Only keep the program name (first token), in case a full command leaked in.
    return match[1].split(/\s+/)[0];
  }
  return null;
}

/** Returns an install instruction keyed by the program name. */
function installHintFor(program: string | null): string {
  switch (program) {
    case "npx":
    case "node":
      return "Install Node.js (adds npx to PATH) from https://nodejs.org.";
    case "uvx":
    case "uv":
      return "Install Astral uv from https://docs.astral.sh/uv/.";
    case "python":
    case "python3":
      return "Install Python from https://www.python.org/downloads/.";
    case "pipx":
      return "Install pipx via `python -m pip install --user pipx`.";
    case "docker":
      return "Install Docker from https://docs.docker.com/get-docker/.";
    default:
      return "Install the runtime it belongs to.";
  }
}

/**
 * Extracts and cleans API error messages, particularly unpacking JSON error objects
 * commonly returned by LLM providers.
 */
function cleanApiMessage(msg: string): string {
  const prefix = "Request failed: ";
  const authPrefix = "Authentication failed: ";
  const titlePrefix = "Title generation failed: ";

  let body = msg;
  let currentPrefix = "";

  if (msg.startsWith(prefix)) {
    body = msg.slice(prefix.length);
    currentPrefix = prefix;
  } else if (msg.startsWith(authPrefix)) {
    body = msg.slice(authPrefix.length);
    currentPrefix = authPrefix;
  } else if (msg.startsWith(titlePrefix)) {
    body = msg.slice(titlePrefix.length);
    currentPrefix = titlePrefix;
  }

  body = body.trim();
  if (!body) return msg;

  try {
    const parsed = JSON.parse(body);
    // Handle OpenAI/Gemini/etc: parsed.error.message
    if (parsed.error && typeof parsed.error === "object" && typeof parsed.error.message === "string") {
      return `${currentPrefix}${parsed.error.message}`;
    }
    // Handle Ollama/generic: parsed.message
    if (typeof parsed.message === "string") {
      return `${currentPrefix}${parsed.message}`;
    }
    // Handle FastAPI/generic: parsed.detail
    if (typeof parsed.detail === "string") {
      return `${currentPrefix}${parsed.detail}`;
    }
    // Handle FastAPI list of errors: parsed.detail[0].msg
    if (Array.isArray(parsed.detail) && parsed.detail[0] && typeof parsed.detail[0].msg === "string") {
      return `${currentPrefix}${parsed.detail[0].msg}`;
    }
  } catch {
    // Not valid JSON, return original msg
  }

  return msg;
}
