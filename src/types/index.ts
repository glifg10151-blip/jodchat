export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface UrlContent {
  url: string;
  title: string;
  content: string;
  status: string;
  error?: string;
}

export type AttachmentKind = "image" | "text";

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind;
  /** Images: `data:image/...;base64,...` — used for both preview and API image_url parts. */
  dataUrl?: string;
  /** Text files: decoded content injected into the prompt. */
  textContent?: string;
}

export interface ContextDisclosure {
  omittedMessages: number;
  condensedMessages: number;
  summarizedToolResults: number;
  originalTokens: number;
  assembledTokens: number;
}

export type DiffLineType = "add" | "del" | "context";

/** One rendered row of a file-edit diff; UI-only metadata attached to tool results. */
export interface DiffLine {
  type: DiffLineType;
  oldNumber?: number;
  newNumber?: number;
  content: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  /** Provider-supplied reasoning, kept separate from user-visible assistant text. */
  reasoningContent?: string;
  /** Complete Responses output items, including opaque reasoning, for stateless replay. */
  responsesOutput?: Record<string, unknown>[];
  timestamp: Date;
  isStreaming?: boolean;
  isSystem?: boolean;
  excludeFromModelContext?: boolean;
  contextDisclosure?: ContextDisclosure;
  toolCall?: { id: string; name: string; arguments: Record<string, string> };
  toolResult?: {
    id: string;
    name: string;
    content: string;
    images?: McpImageContent[];
    diffSummary?: {
      added: number;
      deleted: number;
      isNew?: boolean;
      filename?: string;
      /** Highlight language resolved from the filename for the inline diff view. */
      language?: string;
      /** True when diff hunks were capped and do not cover every change. */
      truncated?: boolean;
      /** True when the write/edit command failed; hunks describe the intended change only. */
      error?: boolean;
      /** Unified-diff hunks (with context) rendered by the file-edit diff view. */
      hunks?: DiffHunk[];
    };
    subagentIds?: string[];
  };
  sources?: { title: string; url: string }[];
  attachments?: Attachment[];
  /** MCP tool routing for this turn; content also preserves readable `[MCP: name]` labels. */
  mcpServerIds?: string[];
  /** Web-search provider captured for this turn; content also preserves a readable `[Web Search]` label. */
  searchConfigId?: string;
  thinkingDuration?: number;
  /** Total wall-clock time for a tool-assisted turn, stored on its final assistant message. */
  workingDuration?: number;
  /** Workspace files changed by the agent turn that produced this assistant message. */
  workspaceChanges?: WorkspaceChangeSet;
}

export interface PendingWorktree {
  path: string;
  branch: string;
  commitScope?: {
    projectId: string;
    projectRoot: string;
    modelId: string;
  };
}

export interface WorkspaceChangeFile {
  path: string;
  additions: number;
  deletions: number;
}

/** A run change set captured directly in the project workspace. */
export interface WorkspaceChangeSet {
  projectId: string;
  files: WorkspaceChangeFile[];
  appliedAt: Date;
  /** Opaque native token for safely reversing this exact patch. */
  undoToken?: string;
}

export interface Conversation {
  id: string;
  title: string;
  timestamp: Date;
  messages: Message[];
  model: string;
  projectId?: string;
  pendingWorktree?: PendingWorktree;
  /** Latest captured change set, retained for current Review/Undo compatibility. */
  workspaceChanges?: WorkspaceChangeSet;
  isPinned?: boolean;
  // Subagent fields
  parentId?: string;
  role?: string;
  isSubagent?: boolean;
  status?: "running" | "idle" | "error" | "completed" | "stopped";
  isTemporary?: boolean;
  recursionDepth?: number;
}

export type ProjectPermission = "read" | "write" | "full";

export interface Project {
  id: string;
  name: string;
  path: string;
  permissions: ProjectPermission;
  skipCommandConfirmations?: boolean;
  excludePatterns?: string[];
  systemPromptOverride?: string;
  isAutoCommitEnabled?: boolean;
  autoCommitMsgTemplate?: string;
}

export type ThinkingLevel = "auto" | "off" | "low" | "medium" | "high";

export interface ModelConfig {
  id: string;
  name: string;
  apiBase: string;
  apiKey: string;
  modelId: string;
  provider?: string;
  enabled?: boolean;
  supportsImages?: boolean;
  contextSize?: number;
  maxOutputTokens?: number;
  temperature?: number;
  /** Per-model reasoning preference. "auto" omits provider-specific controls. */
  thinkingLevel?: ThinkingLevel;
  systemPromptOverride?: string;
}

export type SearchProvider = "google" | "searxng" | "firecrawl" | "custom";

export interface SearchApiConfig {
  id: string;
  name: string;
  provider: SearchProvider;
  baseUrl: string;
  apiKey?: string;
  cx?: string;
  maxResults: number;
  enabled: boolean;
}

export type FetchProvider = "firecrawl" | "jina";

export interface FetchApiConfig {
  id: string;
  name: string;
  provider: FetchProvider;
  baseUrl?: string;
  apiKey?: string;
  enabled: boolean;
}

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export type GenerationState =
  "idle" | "loading" | "thinking" | "searching" | "fetching" | "responding" | "mcp_executing" | "error" | "cancelled";

export function isGenerationActive(state: GenerationState | null | undefined): boolean {
  return state !== undefined && state !== null && state !== "idle" && state !== "error" && state !== "cancelled";
}

export type McpTransport = "stdio" | "sse" | "streamable-http";

/**
 * MCP server configuration.
 *
 * For `stdio` transport:
 *   - `command` is the **program/executable only** (e.g. `npx`, `uvx`,
 *     `/usr/local/bin/python`). Do NOT include arguments here — put them in
 *     `args`. The UI validates that the executable resolves on PATH.
 *   - `args` is the **full ordered argument list** (e.g.
 *     `["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/project"]`).
 *     Each entry is passed to the process verbatim, so paths with spaces are
 *     safe as a single array element (no shell quoting needed).
 *
 * Legacy configs stored a full command line in `command`; those are migrated
 * to program + args on load by `migrateMcpConfigs`.
 */
export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  baseUrl?: string;
  apiKey?: string;
  enabled: boolean;
  trustLevel?: "trusted" | "untrusted";
  /** Bundled catalog plugin identity. Only configs matching the bundled preset keep this marker. */
  catalogPluginId?: string;
}

/** Result of probing whether a stdio command resolves to an executable. */
export interface ExecutableCheck {
  found: boolean;
  /** Resolved absolute path, if found. */
  path?: string;
  /** Best-effort `--version` output (first line), if available. */
  version?: string;
  /** Human-readable status suitable for showing inline in the UI. */
  message: string;
}

export interface McpTool {
  name: string;
  namespacedName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnlyHint?: boolean;
  serverId: string;
  serverName: string;
}

export interface McpImageContent {
  mimeType: string;
  data: string;
}

export interface McpToolResult {
  content: string;
  isError: boolean;
  images?: McpImageContent[];
}

export type McpServerStatus = "disconnected" | "connecting" | "connected" | "error";

export const DEFAULT_TITLE_SYSTEM_PROMPT =
  "Generate a concise, descriptive title (max 5 words) for a conversation that started with the following user message. Respond with only the title text, no quotes or explanations.\n\nUser message:\n{{userMessage}}";

export interface TitleGenerationConfig {
  enabled: boolean;
  modelId: string;
  systemPrompt: string;
}

export const STATUS_COLORS: Record<ConnectionStatus, string> = {
  disconnected: "bg-zinc-500",
  connecting: "bg-amber-400 animate-pulse",
  connected: "bg-emerald-500",
  error: "bg-red-500",
};

export const MCP_STATUS_COLORS: Record<McpServerStatus, string> = {
  disconnected: "bg-zinc-500",
  connecting: "bg-amber-400 animate-pulse",
  connected: "bg-emerald-500",
  error: "bg-red-500",
};

export const MCP_STATUS_LABELS: Record<McpServerStatus, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting\u2026",
  connected: "Connected",
  error: "Error",
};

export type ModelStatuses = Record<string, ConnectionStatus>;

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
}

export interface KnowledgeCollection {
  id: string;
  name: string;
  description?: string;
  embedding_provider: string;
  embedding_model: string;
  chunk_size: number;
  chunk_overlap: number;
  document_count: number;
  chunk_count: number;
  created_at: number;
  updated_at: number;
}

export interface KnowledgeDocument {
  id: string;
  collection_id: string;
  name: string;
  path?: string;
  mime_type: string;
  size: number;
  chunk_count: number;
  created_at: number;
}

export interface KnowledgeSearchResultChunk {
  chunk_id: string;
  document_id: string;
  document_name: string;
  collection_id: string;
  chunk_index: number;
  content: string;
  page_number?: number;
  similarity_score: number;
  rrf_score: number;
  metadata_json: string;
}

export interface RagStats {
  collection_count: number;
  document_count: number;
  chunk_count: number;
  db_size_bytes: number;
}

export type EmbeddingProviderType = "ollama" | "openai" | "gemini" | "custom" | "lexical_only";

export interface EmbeddingProviderConfig {
  type: EmbeddingProviderType;
  endpoint?: string;
  api_key?: string;
  model: string;
}
