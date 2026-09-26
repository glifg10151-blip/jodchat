# AGENTS.md

Sythoria — Desktop AI chat app. Tauri v2 (Rust) + React 19 (TypeScript). Connects to OpenAI-compatible Chat Completions and Responses APIs & Anthropic with SSE streaming, WebSocket, and agentic tool loop (web search + MCP + URL fetch + Project Workspaces).

## Commands

| Command                      | Purpose                              |
| ---------------------------- | ------------------------------------ |
| `npm run tauri dev`          | Dev (Vite + Tauri window, port 1420) |
| `npm run tauri build`        | Production build                     |
| `npm run dev`                | Frontend only                        |
| `npm run build`              | `tsc && vite build`                  |
| `npm run test`               | Vitest (jsdom)                       |
| `npm run test:watch`         | Vitest watch                         |
| `npm run lint`               | ESLint                               |
| `npm run typecheck`          | `tsc --noEmit`                       |
| `npm run format:check`       | Prettier check                       |
| `cd src-tauri && cargo test` | Rust tests                           |

Pre-commit: Husky + lint-staged (`eslint --fix` + `prettier --write`).

## Release Workflow

- Use `npm run release:patch`, `npm run release:minor`, or `npm run release:major` to bump every application version together.
- Keep the version bump and release-specific fixes in one dedicated commit named `chore(release): Release <version>`.
- Create an annotated `v<version>` tag on that release commit so the release history stays linear and easy to audit.

## Directory Structure

```
src/
  main.tsx              # Entry: theme init, ErrorBoundary > App
  App.tsx               # Wires app stores to components, compare mode & tool confirmation
  index.css             # Tailwind v4 @theme, CSS vars, animations, markdown styles, motion tokens
  types/index.ts        # Core types (Message, Conversation, Project, configs) + helpers
  types/log.ts          # LogEntry, LogLevel, LogSource
  store/
    useChatStore.ts     # Conversations, streaming, generation state, compare/pin/workspace changes, attachments
    useModelStore.ts    # Models, temperature, API keys, health checks, active stream listener Map
    useSearchStore.ts   # Search configs, search toggle
    useMcpStore.ts      # MCP server configs, available tools, masked env-secret state, server statuses
    useUIStore.ts       # View, theme, layout, toasts, logs, tasks, tool confirmations, native app updates
    useProjectStore.ts  # Project configuration, active project, and legacy recovery-worktree selection
    useKeybindStore.ts  # Customizable keyboard shortcuts and viewport zoom level mapping
    useAppshotStore.ts  # Appshots screen-capture configuration, permissions, and gallery
    useGitStore.ts      # Git repo detection, commits, AI commit messages, auto-commit
    useWhisperStore.ts  # Whisper voice recording controls, preset downloads, and model management
    useSkillStore.ts    # Installed Agent Skill metadata, lazy document cache, CRUD, and refresh deduplication
    conversationLifecycle.ts # Pure conversation-tree discovery and post-deletion navigation/state reducer
    helpers.ts          # Cross-store action helpers
    index.ts            # Centralized store exports
  services/
    toolLoop.ts         # Agentic tool loop: search_query + fetch_url + MCP + project workspace tools (limit 25)
    contextAssembler.ts # Provider-aware budgets, tool summaries, sliding history, and condensation disclosure
    conversationRunContext.ts # Immutable per-run model, project, tool, attachment, and commit scope
  config/
    constants.ts        # MAX_INPUT_LENGTH, DEFAULT_TEMPERATURE, ID_LENGTH, etc.
    providerPresets.ts  # OpenAI (Chat Completions and Responses), Gemini, Ollama, NVIDIA NIM, OpenRouter, Anthropic, Custom
    searchPresets.ts    # Google, SearXNG, Firecrawl, Custom
    mcpPresets.ts       # MCP transport presets (stdio, sse, streamable-http)
    themePresets.ts     # UI theme settings and default styles
    marketplaceThemes.ts# VS Code themed stylesheets and Marketplace listings
    whisperPresets.ts   # Whisper preset metadata shown by the frontend
  hooks/
    useScrollPosition.ts
    useScrollTracking.ts
    useDebounce.ts
    useAttachments.ts   # File validation, MIME mapping, and size check utilities
    use-safe-motion.ts  # useSafeMotion, useSafeScale, useSafeSlideX (respects prefers-reduced-motion)
  utils/
    storage.ts          # Encrypted Rust storage bridge, masked secret state, Zod validation, and legacy migrations
    i18n/                 # Modular BCP 47 locales: en.ts, es.ts, fr.ts, de.ts, zh.ts, ja.ts
    i18n.ts               # Consolidates locales and exports type-safe useTranslation() hook
    validation.ts       # Zod schemas, URL validation, API key validation, MCP config validation
    generateId.ts       # crypto.randomUUID().slice(0, 8)
    parseApiError.ts    # AppError JSON -> user messages with category, retryability, suggested actions
    logger.ts           # Structured logging: logInfo, logWarn, logError (syncs to UI store, Tauri plugin-log)
    attachments.ts      # Base64 serialization, input parsing, attachment metadata generation
    messageParser.ts    # Utility parsing text messages
    highlighter.ts      # Code syntax highlighting
    tokens.ts           # Token estimation/calculation helpers
    lineDiff.ts         # Bounded line diff/hunk generation and file-language detection
  lib/
    motion-tokens.ts    # Animation tokens, springs, and motion config (reduced motion / low-end detection)
  components/
    Sidebar.tsx         # Collapsible conversation list, search, date grouping, project selector
    ChatArea.tsx        # Messages, markdown, streaming, native skill/tool disclosures, completed edit summaries, comparison columns, and inline tool diffs
    FileEditDiffCard.tsx # Bounded syntax-highlighted intended/actual file-write diffs and failure state
    ReviewDiffView.tsx   # Graphical workspace review: file headers, syntax-highlighted numbered hunks, subtle omitted-context rows, and progressive large-diff rendering
    ReviewWorkspaceTree.tsx # Read-only workspace tree, file search, change markers, and animated folder expansion
    InputBar.tsx        # Composer orchestration, live changed-files indicator, model selector, tools, attachments, send/stop
    PromptEditor.tsx    # Contenteditable draft parsing, normalized text newlines, caret selection, inline MCP labels
    Settings.tsx        # Entry component displaying sidebar settings sections
    settings/           # Modular settings panels (Appearance, Keybinds, Whisper, Projects, Mcp, General, logs, etc.)
    StartScreen.tsx     # Onboarding with motion entrance animations
    ScrollToBottomButton.tsx
    # ImagePreviewModal portals to document.body above app chrome to escape composer/message stacking contexts.
    ui/                 # Modal, Spinner, Switch, Toast, ErrorBoundary, MotionButton, DragOverlay, ImagePreviewModal
docs/
  updater-releases.md   # Updater signing, local-build, release, and test guide
LICENSE                 # MIT license for Sythoria source and distributions
THIRD_PARTY_NOTICES.md  # Direct dependency license summary and notice guidance
src-tauri/src/
  main.rs               # sythoria_lib::run()
  lib.rs                # Tauri commands, AppError, initialization, network policy, window/tray event hooks
  atomic_file.rs        # Crash-safe temporary-file writes with atomic replacement
  endpoint_security.rs  # Intrinsic outbound-network policy, exact local grants, and endpoint resolution
  keyring.rs            # Credential-vault adapter for the cached root key and legacy cleanup
  secure_storage.rs     # AES-256-GCM domain storage, root/domain key derivation, migration, and preferences
  secret_storage.rs     # Rust-only encrypted credentials, masked views, and transactional keychain migration
  stream_parser.rs      # SSE parsing, reasoning normalization, stream events with streamId
  ws_handler.rs         # WebSocket: generation-scoped sessions, cancellation, reconnect backoff (1s–30s, max 5)
  responses.rs          # Stateless Responses adapter, typed SSE events, image/function mapping, and native token counting
  anthropic.rs          # Anthropic Messages API client, stream event mapper, and system prompt formatting
  appshots.rs           # Screen capture, auto-cleanup, permissions check, custom path configuration
  git.rs                # Git status, commits, direct-workspace snapshots/undo, and legacy worktree recovery
  project.rs            # Workspace registration, direct-run capabilities, legacy worktree validation, exclusions
  project_tools.rs      # Workspace tools with path validation and exclusion-pruned read/list/grep/glob traversal
  terminal.rs           # User-driven PTY sessions launched in the registered project folder
  skills.rs             # Sandboxed Agent Skill discovery, YAML editing, and bounded resource/document reads
  commands/
    config.rs           # Encrypted settings/config commands, native secret-store bridges, and full data wipe
    conversations.rs    # Encrypted content-addressed conversation snapshots
  mcp/
    mod.rs              # McpServerConfig, McpToolInfo, McpToolResult, McpServerStatus, McpServerHandle, McpToolRequest, McpServerManager
    client.rs           # MCP client: connect/disconnect servers (stdio/SSE/streamable-http), call tools, rmcp integration
  search/
    mod.rs              # SearchResult, UrlContent, URL validation (blocks private IPs), tests
    google.rs / searxng.rs / firecrawl.rs / custom.rs
```

## State (11 Zustand stores)

- **useChatStore**: `conversations`, `activeId`, `isStreaming`, `generationState` (idle/thinking/searching/fetching/responding/mcp_executing/error), `generationByConversation` (per-conversation state), `compareIds`, `isCompareMode`, `draftAttachments`, `init()`, `sendMessage()`, `retryLastMessage()`, `stopStreaming()`, `deleteConversationTrees()`, `togglePinChat()`, `undoWorkspaceChanges()`, `setDraftAttachments()`, `setConversationProject()`. Write-capable runs edit the registered project folder directly. Git projects capture a before/after workspace snapshot so the final assistant edit card can report the run's paths and safely offer Undo. `publishPendingWorktree()` and `discardPendingWorktree()` remain only for conversations persisted by older versions with an isolated recovery worktree. Conversation deletion is descendant-aware and ordered through confirmation rejection, bounded stream/MCP cancellation, legacy worktree cleanup, the pure `conversationLifecycle.ts` state transition, and persistence.
- **useModelStore**: `models`, `selectedModel`, `temperature` (0–2, default 0.7), `maxToolSteps` (user-configurable step limit, 1–200) with an `unlimitedToolSteps` toggle that disables the cap entirely, `apiKeys`, `modelStatuses`, `titleConfig`, health checks (5min interval), and stream handlers keyed by native `streamId`.
- **useSearchStore**: `searchConfigs`, `activeSearchId`, `searchStatuses`, `fetchStatuses`, `checkSearchConnections()`, `checkFetchConnections()`, `startConnectionChecks()`, `stopConnectionChecks()`, `performSearch()`, `fetchUrlContent()`. Search and fetch connection checks use a credential-free native HEAD request and treat any HTTP response as reachable, so their disconnected/connecting/connected/error tags reflect endpoint reachability without validating API tokens or consuming provider quota. Enabled providers are checked together every 30 seconds while background activity is allowed and the app is online; startup, cleanup, Offline Mode, and Disable Background Activity manage the timer alongside model health checks. Web Search in the composer tool menu is an insert action: each use adds another inline chip at the caret, matching MCP mention behavior, and removing chips updates web search scope from the chips that remain. Each composer derives its web-search draft scope from its own chips, so main and side-chat chips cannot affect each other. Sending snapshots the active provider on the user message, preserves readable `[Web Search]` markers that render as chips in chat, and clears only the submitted composer while the captured run continues independently.
- **useMcpStore**: `mcpConfigs` (including per-server `trustLevel`, defaulting to untrusted), `envSecrets`, `serverStatuses` (disconnected/connecting/connected/error), `availableTools`, and persisted `enabledServerIds` for native execution/startup reconnect. Bundled catalog plugins carry a verified `catalogPluginId` and run without generic per-tool MCP approval dialogs; changing their executable identity clears verification and restores untrusted protection. Composer drafts reference connected servers with repeatable inline labels; each accepted send snapshots the referenced IDs and exposes tools only from those servers. Removing a draft label never stops a connected server; Settings disable/disconnect controls its lifecycle. The store also maintains connection generations that prevent stale connection publication, conversation-scoped active tool-call request IDs, transactional async disable/delete, `addMcpConfig()`, `updateMcpConfig()`, `deleteMcpConfig()`, `connectServer()`, `disconnectServer()`, `connectAllEnabled()`, `callTool()`, `cancelConversationToolCalls()`, `toggleServerEnabled()`, `getToolsForServers()`, `setEnvSecrets()`.
- **useUIStore**: `view`, `theme`, `sidebarOpen`, `sidebarCollapsed`, encrypted `sidebarWidth` / `auxPanelWidth` layout, `activeAuxTab` / `openAuxTabs` workspace tab state, `activeReviewFilePath` for focused changed-file review, `loading`, `toasts`, `showRenameModal`, `logBuffer`, `logFilterSource`, `logFilterLevel`, `activeSection` (selected settings panel), `showContextWindow` and `contextTokenizationMode` (`local` by default or provider endpoint counting through native Gemini, native Anthropic messages-count, and OpenAI/vLLM-compatible `/tokenize` routes such as NIM), background tasks, `pendingToolConfirmations` (confirmations for dangerous tool execution), and the signed Tauri updater flow (`checkForUpdates()`, `installUpdate()`, download progress).
- **useProjectStore**: `projects`, `activeProjectId`, `isProjectsEnabled`, `defaultPermission`, `activeWorktreePath`, `activeWorktreeBranch`, `init()`, `addProject()`, `updateProject()`, `deleteProject()`, `setActiveProject()`, `setWorktree()`, `persistProjects()`. Project creation and updates resolve only after the encrypted native project registry has been updated, preventing an immediate send from racing persistence.
- Workspace Full Shell commands use the app's tool-confirmation modal by default. A project may explicitly set `skipCommandConfirmations` to run shell commands without per-command prompts; native execution still requires Full Shell permission and either this persisted opt-out or an acknowledgement from the in-app gate.
- `project_bash` accepts an optional model-chosen `timeout` in milliseconds (1,000–600,000). Omitting it uses the native 120,000 ms default; the selected limit applies to that command invocation.
- **useKeybindStore**: `keybinds`, `zoomLevel` (clamped 0.5–2.0), `isRecording` (keycombo recording state), `initKeybinds()`, `setKeycombo()`, `resetKeycombo()`, `zoomIn()`, `zoomOut()`, `zoomReset()`, `startRecording()`.
- **useAppshotStore**: `config` (auto-clean options, formats, quality), `recentAppshots`, `isCapturing`, `hasPermission`, `init()`, `triggerCapture()`, `captureAndAttachToChat()`, `loadRecentAppshots()`, `deleteAppshot()`, `clearAll()`.
- **useGitStore**: `config` (auto-commit, AI commit messages, pre-commits), `status` (isRepo, branch, dirty files, ahead/behind), `loading`, `init()`, `verifyPath()`, `commitChanges()`, `undoLastCommit()`, `checkoutBranch()`, `getDiff()`, `autoCommitIfNeeded(scope)`. Automatic commits require an explicit captured project/model/path scope and are serialized per repository.
- **useWhisperStore**: `isVoiceEnabled`, `selectedModelId` (tiny.en, base.en, custom, etc.), `customModelPath` (managed basename, never an arbitrary renderer path), `language`, `downloadedFiles`, `isDownloading`, `downloadProgress`, `isRecording`, `isTranscribing`, `init()`, `toggleVoiceEnabled()`, `selectModel()`, `downloadModel()`, `cancelDownload()`, `deleteModel()`.
- **useSkillStore**: `skills`, lazy `skillContents`, `loadSkills(force)`, `readSkill()`, `createSkill()`, `updateSkill()`, and `deleteSkill()`. Startup loads the catalog, and send/retry/manual resume force-refresh it before an immutable skill snapshot is captured for the run. Automatic resumes retain the originating run snapshot, including MCP references and skills.

## OpenAI Responses

- Select **OpenAI (Responses)** in the model provider presets, or use a custom endpoint whose URL path ends in `/responses` (optional trailing slash/query). Existing OpenAI Chat Completions configurations remain unchanged. Endpoint-path detection controls routing for all four native generation commands, title generation, and token counting.
- `responses.rs` maps messages, image parts, function definitions, calls, and results to the Responses wire format. It uses `store: false`, requests encrypted reasoning for stateless replay, and maps the configured output limit to `max_output_tokens`. Reasoning models use nested `reasoning` controls and omit temperature.
- Typed SSE text, refusal, and reasoning-summary deltas use the existing stream events. Tool calls are released only from a successful terminal response's complete output array; incomplete, failed, malformed, and prematurely ended streams fail without executing partial calls. Parsing is bounded and cancellation uses the existing native stream scope/completion guard.
- Assistant `responsesOutput` metadata persists the complete native output items, including opaque reasoning, function IDs, and message phase. Both ordinary chats and tool-assisted runs retain it. Context replay includes native items exactly once and reconstructs paired results; other API protocols use the ordinary transcript. Context budgets count native items as indivisible payloads. Provider token counting uses `/responses/input_tokens`; connection checks use the sibling `/models` route.

## Tool Loop (Skills + MCP + Search + Project Workspaces)

- **`buildToolDefinitions(mcpTools, includeSearch, skills)`**: Merges only the capabilities available to the immutable run: installed-skill readers, native search tools (`search_query`, `fetch_url`), workspace tools (`project_read`, `project_grep`, `project_glob`, etc.), and MCP tools. Skill IDs are constrained to the run snapshot. MCP tools use `namespacedName` (`serverName__toolName`) and are prefixed with `[MCP: serverName]` in descriptions.
- **`buildToolSystemPrompt(toolDefinitions, project, skills)`**: Generates the prompt from the exact API tool definitions. Explicitly named and clearly matching skills must be read completely before substantive work; required package resources must also be read.
- **`sendWithToolLoop()`**: If skills, search, MCP, or project workspaces are available, runs iterative tool execution. The user-configurable limit (1–200, or unlimited via Settings) counts completed tool-execution rounds rather than provider continuation turns. One shared step budget spans the whole message chain — spawned subagents, queued follow-up messages, and notification-driven auto-resumes all draw from the same pool — with synchronous round reservations preventing concurrent descendants from spending the same allowance, so an automatic resume can never reset the cap; only a fresh user send starts a new budget. After the limit, one uncounted request with tools disabled synthesizes the completed results; if that request fails, a bounded partial-result summary is persisted so completed work remains available to follow-up turns. Tool definitions carry read/mutation metadata: declared read-only calls can overlap, while mutations are serialized per conversation, direct project folder, or MCP server. Rust requires a native confirmation for every untrusted custom MCP tool call and issues a 60-second single-use capability bound to server connection, tool, argument hash, and conversation. Bundled catalog plugins are verified against their preset identity and trusted automatically; a custom server explicitly marked trusted in Settings can also execute without a capability. MCP tool calls execute via `mcpCallTool(serverId, toolName, args, conversationId)`, returning structured `{ content, isError, images }`; the conversation scope allows deletion/stop flows to cancel only matching native requests.
- **Agent Skills**: Sythoria discovers portable packages only from `~/.agents/skills/<id>/SKILL.md`. `read_skill` paginates `SKILL.md`; `list_skill_resources` and `read_skill_resource` expose bounded UTF-8 package files while rejecting traversal, symlinks, excessive depth/count, and oversized content. Settings edits preserve unknown YAML frontmatter and use atomic writes. Codex-private `.codex/skills/.system` packages are intentionally excluded because they may require Codex-only tools and resource providers.
- **Skill tool UI**: Native `read_skill`, `list_skill_resources`, and `read_skill_resource` calls render as red skill-tagged disclosures in chat. Skill documents and packaged resources use dedicated content/list views instead of the generic “Tool result” presentation.
- **Project tool UI**: Native project tool disclosures place a muted, operation-specific icon before the action label and then the relevant filename, pattern, directory, command, or commit message. MCP file-change disclosures also use muted write/edit icons; file extensions do not color tool icons. Keep the existing expandable diff, image, shell, and result details.
- **Inline reference appearance**: Composer and sent-message MCP/web-search mentions, skill labels, file attachment chips, and source links use the shared `inline-reference` class: accent text with a leading icon and no pill background or border. Text mentions also use `inline-text-reference` so their label shares the surrounding text baseline. Preserve mention metadata, atomic caret/deletion behavior, and existing attachment/link interactions when changing presentation.
- **Inline MCP references**: The composer uses removable, repeatable MCP labels inside the prompt editor. Submitted message text preserves each label as a readable `[MCP: server name]` marker for model context and copy actions, while user-message rendering turns that marker back into a visual MCP chip. The message also stores `mcpServerIds` metadata so retries can recreate the same per-turn tool scope. A referenced server contributes tools only when its ID appears in that prompt snapshot; sends are rejected instead of silently falling back when a referenced server exposes no tools.
- **Context assembly**: Every model request reserves provider-specific output and tool capacity, structurally summarizes oversized tool results, prioritizes the system prompt and latest turn, and slides or summarizes older history to fit the configured context size. Preserved assistant reasoning is replayed through the OpenAI-compatible `reasoning_content` field (or Ollama's `reasoning` field) and included in both local and request-context token estimates. The prompt reserve is not sent as an artificial generation cap: an unset maximum omits the provider `max_tokens` parameter, while an explicit per-model maximum is clamped only to the estimated space remaining in a known context window. Unknown context sizes remain explicit and use a conservative internal assembly ceiling. The stored transcript is not rewritten; the UI adds a disclosure when request context is condensed. Full tool schemas are reserved, and requests whose mandatory tool arguments, signed reasoning, or images still exceed the local input estimate are rejected before dispatch rather than corrupted.
- **Project image reading**: Models configured with image-input support receive `project_read_image`, which returns PNG, JPEG, GIF, or WebP files (maximum 5 MiB) through the tool image pipeline so the model can inspect them. Text-only models do not receive this tool. It uses the same native run capability, read permission, path containment, and exclusion validation as `project_read`, detects format from file bytes, and bounds reads before base64 encoding. Chat renders it as a native image disclosure with Viewing/Viewed state, path and format metadata, an inline preview, and the full image preview modal.
- **Direct Workspace Execution**: Project file tools, Git tools, the agent shell, the Files panel, and the terminal all use the registered project folder as the same authoritative filesystem. A file created with `project_write` is therefore immediately visible to `project_bash` and to the user. Git projects take an internal before/after snapshot without changing the user's index or branch; the resulting exact patch powers the final change summary and conflict-safe Undo. Non-Git projects can still use write/full permissions, but do not receive Git-based summaries or Undo.

## Google plugin connections

- Gmail, Drive, and Calendar share one encrypted native Google Desktop OAuth client configuration. The renderer receives only its client ID; token exchange resolves the secret in Rust. OAuth grants are saved in the authenticated encrypted secret domain and MCP settings persist only opaque grant references. Complete, unambiguous legacy client pairs and legacy Google credential directories migrate into that encrypted store before the old files are removed. Dynamic loopback callbacks require Desktop app credentials, not Web clients.
- Google credentials must never be persisted as plaintext. Drive and Calendar receive externally managed OAuth values only in the spawned process environment. Gmail receives the same in-memory grant through a Node preload that exposes its required credential paths as read-only virtual files and blocks writes to them; the preload itself contains no secrets. Do not reintroduce durable token/client JSON files or conventional credential locations in the user's home folder.
- `services/googlePermissions.ts` defines service-specific read-only defaults, explicit write choices, and supported tool allowlists. Native MCP registration and execution enforce `SYTHORIA_ALLOWED_TOOLS`; Google plugins must not expose account-management tools that bypass the selected scopes. Partial consent fails before installation. Shared client credentials do not imply shared scopes or account tokens.
- Gmail's file-oriented MCP contract is satisfied only by the native runtime's virtual `GMAIL_OAUTH_PATH` / `GMAIL_CREDENTIALS_PATH` layer. Drive and Calendar use the package's external OAuth token mode and must not activate `GOOGLE_APPLICATION_CREDENTIALS`. Keep catalog package versions and tool contracts aligned.
- Setup keeps fields visible on failure, uses one inline error without duplicate store toasts, and places “Continue with Google” in the standard modal footer. Existing file-backed installations migrate automatically; reauthorization is needed only when the selected Google scopes change or the stored grant is no longer valid.

## Endpoint field errors

Model, web search, URL fetch, and MCP cards show accessible inline URL validation and friendly connection failures beneath their endpoint fields. Connection stores retain transient error messages separately from status; raw diagnostics stay in logs. Map native failures through `utils/endpointError.ts`, including exact local-origin grants in Privacy & Security. Model health checks preserve HTTP rejection status instead of reducing it to a boolean failure.

## Logging System

- **logInfo(source, message, opts)**, **logWarn(source, message, opts)**, **logError(source, message, opts)** — write to console, Tauri plugin-log, and a bounded in-memory log buffer (`MAX_LOGS = 500`).
- **Sources**: `general`, `chat`, `model`, `search`, `mcp`, `storage`, `stream`, `skills` (and dynamically `appshots`, `git`).
- Logs are synced to `useUIStore.logBuffer` via `requestAnimationFrame` for batched UI updates.
- **Error parsing** (`parseApiError.ts`): Returns structured `ParsedError` with `message`, `action`, `category`, `retryable`, and `rawDetail`. Includes dedicated `userFriendlyMcpError()` for MCP-specific failures.

## Motion System

- **`motion-tokens.ts`**: Defines `duration`, `easing`, `distance`, `scale` tokens and `springs` (snappy, gentle, bouncy, instant, release).
- **`motionConfig`**: Detects `prefers-reduced-motion` and low-end hardware (hardwareConcurrency <= 4) to disable non-essential animations.
- **`use-safe-motion.ts`**: Provides `useSafeMotion`, `useSafeScale`, `useSafeSlideX` hooks that respect reduced-motion preferences.
- **MotionButton**: Reusable `motion.button` with scale tap/hover effects.
- Review and Files folder trees animate chevron rotation and subtree height/opacity with `motionTransitions.hover`, which respects reduced or disabled motion. The Review file list animates show/hide without losing tree or search state; its width transition is disabled during pointer resizing. Review pane surfaces use subtle straight dividers; rounding is reserved for controls and selected rows.
- Workspace panel tabs use compact rounded pills. Review diff rows sit flush beneath their file header and show one file-sized line-number gutter: old numbers for deletions, new numbers for additions and context. Colored gutters, tinted code rows, and solid green or striped red edge markers convey change type without inline +/- signs.

## Data Flow

**SSE**: `sendMessage()` → `invoke("chat_stream", { streamId })` → Rust emits `chat-stream-chunk`/`chat-stream-done` → store appends content. Streaming HTTP uses a resettable 120-second inactivity timeout rather than a total request deadline, so active long-running reasoning can continue indefinitely. Cancel via `cancel_chat_stream`.

**Tool loop**: `sendMessage()` refreshes installed skills → snapshots a `ConversationRunContext` from the target conversation, including its skill catalog → queues it through the conversation actor → assembles a budgeted provider request → runs up to `maxToolSteps` tool rounds from one per-message shared budget → executes declared read-only calls concurrently and resource mutations serially → collects sources → final assistant message. Compare, retry, resume, and subagent runs keep their originating conversation's project/model/skill context instead of consulting global navigation state. Follow-up subagent messages wait for the active generation boundary. Queued and executing follow-ups mark the child running; subagent waits consume results only after every queued run has settled.

Native and MCP file write/edit results capture bounded diff hunks for the inline diff card. When a write fails, the stored diff describes the intended change and carries the error separately instead of falling back to the generic arguments/result view. Failed writes to previously absent paths are classified as `Create failed`; failures against existing files are classified as `Edit failed`.

**Message retry**: Message-level Regenerate actions pass the selected message ID to `retryLastMessage(convId, messageId)`. Retry retains history through that turn’s user prompt and removes its old response, tool activity, and all later messages before regenerating. Omitting the ID keeps the keyboard shortcut’s latest-prompt behavior. Capability validation completes before history is trimmed.

**Chat deletion**: Discover the selected conversation and all descendant subagents → reject their pending tool confirmations → mark their runs stopped → await bounded stream and conversation-scoped MCP cancellation → discard any unique legacy recovery worktree → atomically remove conversation/history/compare records → persist. Legacy discard is idempotent for an already-missing worktree only after its Sythoria path/branch identity is validated. Non-empty temporary chats use this same full-deletion path when the user switches away.

**Direct Workspace Change Flow**: If writing to a project:

1. `project_run_begin` binds the run capability to the registered project root; write/full projects no longer require a Git repository.
2. For a Git project, `git_workspace_snapshot_create` records the current tracked, staged, unstaged, and non-ignored untracked file state through a temporary index without touching the user's branch or index.
3. `project_write`, `project_edit`, `project_bash`, Git tools, subagents, Files, Review, and Terminal all operate on the actual project folder.
4. When the run ends, `git_workspace_snapshot_finish` compares the live folder to the captured baseline and stores authoritative changed paths/counts plus an opaque undo token on the originating assistant message and in the conversation's latest `workspaceChanges`. Per-turn message copies keep each completed change bubble visible after later sends. Optional auto-commit then commits only those captured paths.
5. Completed-edit **Undo** reverses the exact saved patch only after a native reverse dry-run succeeds. Later conflicting workspace edits are never overwritten; Git rejects the undo and leaves them intact.
6. `pendingWorktree` and its **Publish changes** / **Discard** actions are retained strictly to recover isolated changes saved by older Sythoria versions; new runs never create one.

**Appshots**: Trigger capture (`capture_screen`) → backend saves file and returns token → frontend fetches details (`read_file_from_token`) and maps it to a base64 `Attachment` → appended to chat input.

**Whisper Transcription**: Toggle voice recording (`start_recording` / `stop_recording`) with a UUID session → temporary audio is bound to that session → backend runs `transcribe_audio` against a managed Whisper model → output is injected into input text. UI abort/unmount cleanup stops only its own native session and releases live-poll/refinement resources.

**App Updates**: `checkForUpdates()` uses the Tauri updater plugin against the signed `latest.json` in GitHub Releases → the update modal downloads and installs the verified platform artifact → the process plugin relaunches Sythoria. Release builds require the `TAURI_SIGNING_PRIVATE_KEY` GitHub Actions secret; keep the corresponding private key backed up and never commit it. The macOS `app` bundle target must remain enabled so Tauri creates the `.app.tar.gz` updater artifact in addition to the DMG. See `docs/updater-releases.md` for the signing, release, and test procedure.

## Key Types

```typescript
export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "text";
  dataUrl?: string;
  textContent?: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  reasoningContent?: string; // Provider reasoning, replayed as reasoning_content on later turns
  responsesOutput?: Record<string, unknown>[]; // Complete native Responses items for stateless replay
  timestamp: Date;
  isStreaming?: boolean;
  toolCall?: { id: string; name: string; arguments: Record<string, string> };
  toolResult?: {
    id: string;
    name: string;
    content: string;
    images?: { mimeType: string; data: string }[];
    diffSummary?: {
      added: number;
      deleted: number;
      isNew?: boolean;
      filename?: string;
      language?: string;
      truncated?: boolean;
      error?: boolean; // Failed write/edit; hunks describe the intended change
      hunks?: DiffHunk[];
    };
  };
  sources?: { title: string; url: string }[];
  attachments?: Attachment[];
  mcpServerIds?: string[]; // Inline MCP references; content also preserves readable [MCP: name] labels
  searchConfigId?: string; // Per-turn web-search provider; content also preserves a readable [Web Search] label
  workingDuration?: number; // Total seconds for a completed tool-assisted turn
  workspaceChanges?: WorkspaceChangeSet; // Files changed by this specific assistant turn
}

export interface PendingWorktree {
  // Legacy recovery record; current runs execute in the project root.
  path: string;
  branch: string;
  commitScope?: {
    projectId: string;
    projectRoot: string;
    modelId: string;
  };
}

export interface WorkspaceChangeSet {
  projectId: string;
  files: { path: string; additions: number; deletions: number }[];
  appliedAt: Date;
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
  workspaceChanges?: WorkspaceChangeSet;
  isPinned?: boolean;
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
  systemPromptOverride?: string;
}
```

## Tauri Commands

| Command                                                                   | Purpose                                                         |
| ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `load_config` / `save_config`                                             | Encrypted model configs (`models.enc`)                          |
| `load_encrypted_preferences` / `mutate_encrypted_preferences`             | Read or atomically mutate encrypted preferences                 |
| `load_network_config` / `save_network_config`                             | Authenticated network policy (`network.enc`)                    |
| `load_search_config` / `save_search_config`                               | Encrypted search configs (`search.enc`)                         |
| `load_api_keys` / `save_api_keys_cmd`                                     | Mask/save encrypted model API keys                              |
| `load_search_api_keys` / `save_search_api_keys_cmd`                       | Mask/save encrypted search API keys                             |
| `load_encrypted_conversations` / `save_encrypted_conversations`           | Read/write encrypted chat snapshots                             |
| `clear_encrypted_conversations`                                           | Delete conversation ciphertext                                  |
| `chat_completion` / `chat_stream`                                         | Standard or streaming text generation                           |
| `count_model_tokens`                                                      | Count context through the configured model endpoint tokenizer   |
| `cancel_chat_stream`                                                      | Cancel active stream via `streamId`                             |
| `chat_completion_tools` / `chat_stream_tools`                             | Completion/Streaming with tool calls enabled                    |
| `generate_title`                                                          | Auto-generate conversation title                                |
| `check_api` / `check_ollama`                                              | Health checks on AI backends                                    |
| `web_search` / `fetch_url_content`                                        | Native search presets and web page readers                      |
| `ws_connect` / `ws_send` / `ws_disconnect`                                | WebSocket connection commands                                   |
| `load_mcp_config` / `save_mcp_config`                                     | Encrypted MCP server configs (`mcp.enc`)                        |
| `mcp_start_server` / `mcp_stop_server` / `mcp_set_server_enabled`         | Spawn, stop, or revoke MCP server execution                     |
| `mcp_check_command`                                                       | Probes command/args resolution on path                          |
| `mcp_list_tools` / `mcp_request_tool_approval` / `mcp_call_tool`          | MCP discovery, native approval, and execution                   |
| `mcp_cancel_tool_call`                                                    | Cancel one request-scoped MCP tool invocation                   |
| `list_skills` / `read_skill` / `read_skill_chunk`                         | Discover skills and read full/editor or paginated model content |
| `list_skill_resources` / `read_skill_resource`                            | List/read sandboxed auxiliary skill text resources              |
| `create_skill` / `update_skill` / `delete_skill`                          | Atomically manage portable Agent Skill packages                 |
| `select_file_and_get_token`                                               | Open dialog to import file, returns secure token                |
| `read_file_from_token`                                                    | Read local file contents via secure token payload               |
| `download_whisper_model` / `cancel_whisper_download`                      | Download checksum-pinned Whisper preset assets                  |
| `import_custom_whisper_model`                                             | Import an explicitly unverified model into app data             |
| `check_downloaded_whisper_models`                                         | Lists cached local Whisper files                                |
| `transcribe_audio`                                                        | Transcribes recorded audio buffer via whisper.cpp               |
| `load_projects` / `save_projects`                                         | Workspace configs storage                                       |
| `set_active_project`                                                      | Maps the active workspace selection                             |
| `project_run_begin`                                                       | Binds a run directly to its registered project root             |
| `project_browse_begin`                                                    | Issues a read-only Files panel capability                       |
| `git_detect_repo` / `git_get_status`                                      | Identifies local repositories and dirty tracking                |
| `git_create_commit` / `git_undo_last_commit`                              | Creates commits, commits with AI msgs, soft-resets              |
| `git_workspace_snapshot_create` / `git_workspace_snapshot_finish`         | Capture direct-run changes without modifying branch/index       |
| `git_workspace_undo`                                                      | Safely reverse an exact captured direct-workspace patch         |
| `git_worktree_apply`                                                      | Publish a legacy isolated recovery worktree                     |
| `git_worktree_cleanup_if_empty`                                           | Remove a verified isolated worktree only when it has no changes |
| `git_worktree_discard`                                                    | Prunes isolated branches and deletes worktree dirs              |
| `project_read` / `project_write` / `project_edit`                         | Workspace-scoped file tools                                     |
| `project_list_dir` / `project_grep` / `project_glob`                      | Workspace directory traversal and search tools                  |
| `project_bash`                                                            | Execute system shells in the actual registered project folder   |
| `terminal_start` / `terminal_write` / `terminal_resize` / `terminal_stop` | Run an interactive user-controlled project PTY                  |
| `capture_screen` / `list_appshots`                                        | Take screenshots, query galleries                               |
| `has_screen_capture_permission`                                           | Check macOS screen recording permissions                        |
| `wipe_config_files`                                                       | Ordered legacy-keychain and encrypted-data wipe                 |

## Storage

| Data                | Location                                                                       |
| ------------------- | ------------------------------------------------------------------------------ |
| Conversations       | Root-derived AES-256-GCM manifest + content-addressed blobs (`conversations/`) |
| Model configs       | Root-derived AES-256-GCM authenticated `models.enc`                            |
| API/search/MCP keys | Root-derived AES-256-GCM authenticated `secrets.enc`                           |
| Projects            | Authenticated encrypted `projects.enc`                                         |
| Network policy      | Authenticated encrypted `network.enc` + encrypted presence marker              |
| Search configs      | Authenticated encrypted preferences / `search.enc`                             |
| MCP configs         | Authenticated encrypted preferences / `mcp.enc`                                |
| MCP env secrets     | Root-derived AES-256-GCM authenticated `secrets.enc`                           |
| Preferences         | Authenticated encrypted `preferences.enc`                                      |
| Whisper Config      | Authenticated encrypted preferences + encrypted cloud key                      |
| UI/window layout    | Authenticated encrypted preferences                                            |
| Agent Skills        | User-managed portable packages (`~/.agents/skills/<id>/`)                      |

## Notes

- **Tailwind v4**: `@theme` directive, `@import "tailwindcss"` — no `tailwind.config.js`.
- **VS Code Themes**: Settings > Appearance houses customizable themes fetched from a marketplace, dynamically mapped to stylesheet CSS properties.
- **Direct project filesystem**: Write actions execute in the registered folder so file tools, shell commands, panels, and the user all see the same state. Permission tiers, run capabilities, path validation, exclusions, and shell confirmation remain enforced natively.
- **Graphical Review**: `gitDiff.ts` parses declared hunk bodies separately from Git metadata; Review renders code changes with old/new line numbers, syntax colors, addition/deletion gutters, and labeled unmodified-line ranges. Raw patch headers and native staged/untracked section markers are never code rows. Binary, rename-only, empty-file, and permission-only changes have text summaries. Large diffs reveal 500 rows at a time. The Review file rail uses a read-only project browser capability for a lazy, collapsible workspace tree; changed or deleted paths are merged into that tree from the Git diff. Search uses the project-scoped glob command, status badges distinguish file changes, and smaller dots mark parent folders. The rail can be hidden or resized by pointer or keyboard while the selected file remains open.
- **Project exclusions**: Project patterns use root-relative Git-ignore semantics, cannot use negation, and are enforced before and after canonicalization as well as during list/grep/glob traversal.
- **Appshots Permission**: On macOS, screen capture requests the `System Settings` permission only after the user triggers a capture, avoiding startup notification spam.
- **Stream listener Map**: Multiple active completion streams are supported in parallel (useful for Compare Mode layouts) using a thread-safe listener Map mapped by conversation IDs.
- **Credential vault**: `keyring-core` stores one 256-bit root key using the platform backend (macOS Keychain, Windows Credential Manager, Linux Secret Service). Rust caches that root for the process lifetime and derives independent domain keys with HMAC-SHA-256.
- **Renderer secret boundary**: Persisted encrypted values are represented in the WebView only by a fixed masked placeholder. Model streaming requests validate the accepted endpoint/model/provider identity before dispatch and reject mid-run configuration drift. Model, search, title-generation, speech, and MCP commands decrypt actual credentials natively immediately before use; MCP environment values never cross back into the renderer after storage.
- **Tauri capabilities**: The main window enumerates only the event names, URL schemes, resource cleanup, dialog, updater, logging, and window operations used by the renderer; do not restore broad `core:*:default` or `opener:default` grants.
- **MCP process environment**: Stdio servers start with a cleared environment. They inherit only the documented runtime allowlist in `mcp/client.rs` plus environment variables explicitly configured for that server.
- **Encrypted storage**: Settings and credentials use independent AES-256-GCM keys derived from one OS-vault root key. Writes are atomic; legacy plaintext/plugin-store values migrate on read and are removed only after a successful encrypted save.
- **Secret migration**: Legacy per-credential keychain records are read once, committed atomically to `secrets.enc`, and deleted only after the authenticated replacement reaches disk. Failed cleanup identifiers remain encrypted for retry.
- **Conversation storage**: Each conversation is an authenticated content-addressed blob behind a root-derived encrypted manifest. Legacy conversation keys migrate transactionally; failed saves retain the previous snapshot.
- **Network fail-closed**: If an existing authenticated network policy cannot be loaded, startup enables offline mode instead of silently reverting to permissive defaults.
- **TLS verification**: A bounded native HTTP client cache reuses connection pools by origin, validated address set, timeout mode, and network policy identity; every request still validates current DNS and policy before cache lookup. Shared HTTP clients always use platform certificate verification and never accept invalid certificates. The updater, model downloads, provider/search/speech traffic, and credential-bearing requests must not add certificate-verification bypasses.
- **Local endpoint policy**: Loopback, private, shared, link-local, unspecified, and cloud-metadata destinations are enforced natively and cannot be removed from the policy. An exact scheme/host/port grant is the sole authorization for an intentional local service, including plaintext HTTP/WebSocket transport; editable block rules are additive and always take precedence over grants.
- **Window state**: Main-window size, position, and maximized state are restored from encrypted preferences. The default window is 1200×780 when no saved geometry exists.
- **Privacy wipe**: The Rust backend removes residual legacy keychain records before encrypted files and the root key; frontend persistence is suspended during the wipe to prevent data recreation.
- **Logging privacy**: Legacy plaintext log files are removed at startup; runtime Rust logs target stdout at warning level.
- **ESLint 9 flat config** in `eslint.config.js`.
- **Prettier**: double quotes, 2-space indent, trailing commas, 120 print width.
- **Motion system**: Respects `prefers-reduced-motion` and disables animations on low-end devices.
- **Terminal fonts**: The interactive terminal prefers common installed Nerd Font families and falls back to the
  bundled `SymbolsNerdFontMono-Regular.ttf` for Powerline and Nerd Font glyph coverage.
- **macOS sidebar glass**: The native `NSVisualEffectView` supplies the behind-window blur. Keep the sidebar's
  color/alpha, gradient, and shadow stable during window movement and resizing; do not re-enable a CSS
  `backdrop-filter` for `.platform-macos .glass-sidebar`. Native fullscreen removes the traffic-light inset from
  sidebar header controls because macOS moves those controls out of the app content. Windows keeps the
  interaction-time translucency suspension workaround.
- **Internationalization (i18n)**: Implements dynamic locale switching for BCP 47 language keys (`en`, `es`, `fr`, `de`, `zh`, `ja`) with an automatic English fallback. State is saved persistently and updates `document.documentElement.lang`. Dictionaries are structured as modular files under `src/utils/i18n/` to keep code footprint minimal and simplify adding new locales.
- **Licensing**: Sythoria is MIT-licensed. Contributions are accepted under the same terms, and third-party license information is summarized in `THIRD_PARTY_NOTICES.md`.

- **Project file mentions**: Assistant Markdown links to project-relative files (for example `[App.tsx](src/App.tsx)`) open the originating conversation’s Review tab. Absolute links inside its registered project are also supported; external links retain the existing warning flow. Review shows the current diff when available, otherwise a bounded native file preview, including for non-Git projects. The project tool prompt teaches models this link format.

- **Inline web citations**: Search/fetch results include a run-local, one-based `citationId` into the assistant message’s saved sources. A shared URL registry reuses the first ID and source entry for each exact URL across repeated searches and successful fetches in the run, keeping the sources list unique without renumbering citations. Search-enabled prompts request `[[cite:N]]` after supported claims. Only valid custom markers render as rounded globe links with source titles/domain tooltips; ordinary Markdown links remain unchanged. Parsing skips code and links, and unresolved markers remain text. Tags preserve the external-link warning flow. Copied/exported content retains the custom markers.
