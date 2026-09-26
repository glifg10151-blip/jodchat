import {
  Settings as SettingsIcon,
  Sun,
  Sliders,
  MessageSquareText,
  Keyboard,
  Camera,
  Cpu,
  Search,
  Plug,
  Folder,
  FileText,
  Store,
  Shield,
  Mic,
  BookOpen,
  Database,
  ArrowUpDown,
  Blocks,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type SectionId =
  | "general"
  | "appearance"
  | "privacy"
  | "configuration"
  | "personalization"
  | "keybinds"
  | "appshots"
  | "plugins"
  | "mcp"
  | "browser"
  | "computer"
  | "hooks"
  | "models"
  | "projects"
  | "environments"
  | "search"
  | "marketplace"
  | "whisper"
  | "skills"
  | "knowledge"
  | "data_transfer"
  | "logs";

export interface SettingSectionItem {
  id: SectionId;
  label: string;
  icon: LucideIcon;
  keywords: string[];
}

export interface SettingSectionGroup {
  category: string;
  items: SettingSectionItem[];
}

export const SECTION_GROUPS: SettingSectionGroup[] = [
  {
    category: "Application",
    items: [
      {
        id: "general",
        label: "General",
        icon: SettingsIcon,
        keywords: ["language", "startup", "autostart", "close to tray", "system tray", "reset"],
      },
      {
        id: "appearance",
        label: "Appearance",
        icon: Sun,
        keywords: ["theme", "dark", "light", "colors", "accent", "animations", "custom theme", "presets"],
      },
      {
        id: "marketplace",
        label: "Theme Marketplace",
        icon: Store,
        keywords: ["themes", "vs code", "download", "community", "styles", "install"],
      },
      {
        id: "keybinds",
        label: "Keyboard Shortcuts",
        icon: Keyboard,
        keywords: ["shortcuts", "keys", "hotkeys", "keyboard", "zoom", "map"],
      },
      {
        id: "privacy",
        label: "Privacy & Security",
        icon: Shield,
        keywords: ["network", "proxy", "offline", "strict ssl", "blocked hosts", "ip address", "security"],
      },
    ],
  },
  {
    category: "AI & Models",
    items: [
      {
        id: "models",
        label: "Model Providers",
        icon: Plug,
        keywords: [
          "providers",
          "openai",
          "anthropic",
          "gemini",
          "ollama",
          "openrouter",
          "api keys",
          "endpoints",
          "connection",
        ],
      },
      {
        id: "configuration",
        label: "Chat Settings",
        icon: Sliders,
        keywords: ["chat settings", "temperature", "max tools", "steps", "defaults", "model selector"],
      },
      {
        id: "personalization",
        label: "System Prompts",
        icon: MessageSquareText,
        keywords: ["system prompts", "instructions", "title generation", "custom prompts"],
      },
      {
        id: "whisper",
        label: "Voice Input",
        icon: Mic,
        keywords: ["voice input", "speech to text", "transcribe", "stt", "audio", "recording", "gguf", "whisper"],
      },
    ],
  },
  {
    category: "Integrations",
    items: [
      {
        id: "plugins",
        label: "Plugins & Apps",
        icon: Blocks,
        keywords: [
          "plugins",
          "apps",
          "integrations",
          "github",
          "notion",
          "slack",
          "linear",
          "google drive",
          "postgres",
          "marketplace",
          "connect",
          "tools",
        ],
      },
      {
        id: "mcp",
        label: "MCP Servers",
        icon: Cpu,
        keywords: ["mcp", "servers", "tools", "model context protocol", "stdio", "sse", "env", "secrets"],
      },
      {
        id: "knowledge",
        label: "Knowledge & RAG",
        icon: Database,
        keywords: [
          "knowledge",
          "rag",
          "documents",
          "vector",
          "embeddings",
          "pdf",
          "collections",
          "sqlite-vec",
          "hybrid search",
        ],
      },
      {
        id: "browser",
        label: "Web Search",
        icon: Search,
        keywords: ["web search", "google", "firecrawl", "jina", "fetch url", "searxng", "jina reader", "search preset"],
      },
      {
        id: "appshots",
        label: "Appshots",
        icon: Camera,
        keywords: ["screen capture", "screenshots", "gallery", "auto-clean", "quality", "format", "images"],
      },
      {
        id: "data_transfer",
        label: "Data & Memory Transfer",
        icon: ArrowUpDown,
        keywords: ["export", "import", "chatgpt", "claude", "gemini", "memory", "backup", "data transfer", "migration"],
      },
    ],
  },
  {
    category: "Developer",
    items: [
      {
        id: "projects",
        label: "Workspace Projects",
        icon: Folder,
        keywords: ["workspace", "directories", "git repo", "direct edits", "permissions", "auto commit"],
      },
      {
        id: "skills",
        label: "Agent Skills",
        icon: BookOpen,
        keywords: ["agents", "customizations", "slash commands", "SKILL.md", "tools"],
      },
      {
        id: "logs",
        label: "Activity Log",
        icon: FileText,
        keywords: ["activity log", "debug", "warn", "error", "console", "Tauri", "logs", "view logs"],
      },
    ],
  },
];

export interface SearchableSetting {
  id: string; // The HTML element ID to scroll/highlight
  label: string;
  description?: string;
  sectionId: SectionId;
  sectionLabel: string;
  keywords: string[];
}

export const SEARCHABLE_SETTINGS: SearchableSetting[] = [
  {
    id: "setting-general-language",
    label: "Language",
    description: "Change application display language",
    sectionId: "general",
    sectionLabel: "General",
    keywords: [
      "language",
      "lang",
      "locale",
      "bcp 47",
      "translation",
      "english",
      "spanish",
      "french",
      "german",
      "chinese",
      "japanese",
    ],
  },
  {
    id: "setting-general-shortcut",
    label: "Send Message Shortcut",
    description: "Choose the key combination to send messages",
    sectionId: "general",
    sectionLabel: "General",
    keywords: ["shortcut", "keyboard", "enter", "ctrl+enter", "send message", "chat"],
  },
  {
    id: "setting-general-clear-escape",
    label: "Clear Input on Escape",
    description: "Clear the chat input field when pressing the Escape key",
    sectionId: "general",
    sectionLabel: "General",
    keywords: ["escape", "clear input", "clear", "esc", "keyboard"],
  },
  {
    id: "setting-general-context-window",
    label: "Show Context Window",
    description: "Display the context usage indicator and choose local or endpoint token counting",
    sectionId: "general",
    sectionLabel: "General",
    keywords: [
      "context window",
      "radial",
      "token usage",
      "show context",
      "context indicator",
      "usage limit",
      "tokenizer",
      "local estimate",
      "privacy",
    ],
  },
  {
    id: "setting-general-text-size",
    label: "Base Text Size",
    description: "Adjust the text size of the chat interface",
    sectionId: "general",
    sectionLabel: "General",
    keywords: ["text size", "font size", "size", "zoom", "small", "large", "medium"],
  },
  {
    id: "setting-general-always-on-top",
    label: "Always on Top",
    description: "Keep the application window above all other windows",
    sectionId: "general",
    sectionLabel: "General",
    keywords: ["always on top", "top", "window float", "pin window"],
  },
  {
    id: "setting-general-close-to-tray",
    label: "Close to Tray / Minimize",
    description: "Minimize the application to the system tray when closing the window",
    sectionId: "general",
    sectionLabel: "General",
    keywords: ["close to tray", "tray", "minimize", "system tray", "background run"],
  },
  {
    id: "setting-general-launch-startup",
    label: "Run on Startup",
    description: "Launch Sythoria automatically when your computer starts up",
    sectionId: "general",
    sectionLabel: "General",
    keywords: ["startup", "launch", "autostart", "boot", "run at startup"],
  },
  {
    id: "setting-appearance-theme-mode",
    label: "UI Theme Mode",
    description: "Switch between Light, Dark, or System theme settings",
    sectionId: "appearance",
    sectionLabel: "Appearance",
    keywords: ["theme", "dark", "light", "system", "mode", "appearance", "style"],
  },
  {
    id: "setting-appearance-animations",
    label: "UI Animations",
    description: "Enable or disable transition animations across the application",
    sectionId: "appearance",
    sectionLabel: "Appearance",
    keywords: ["animations", "transitions", "motion", "prefers-reduced-motion", "speed"],
  },
  {
    id: "setting-appearance-translucent-sidebar",
    label: "Translucent Sidebar",
    description: "Show the left sidebar with a blurred translucent background",
    sectionId: "appearance",
    sectionLabel: "Appearance",
    keywords: ["sidebar", "translucent", "transparency", "blur", "glass", "vibrancy"],
  },
  {
    id: "setting-configuration-temperature",
    label: "Model Temperature",
    description: "Control the randomness or creativity of model responses",
    sectionId: "configuration",
    sectionLabel: "Chat Settings",
    keywords: ["temperature", "creativity", "randomness", "precise", "balanced", "creative"],
  },
  {
    id: "setting-configuration-max-steps",
    label: "Max Tool Loop Steps",
    description: "Set the limit on iterative tool executions in a single loop",
    sectionId: "configuration",
    sectionLabel: "Chat Settings",
    keywords: ["max tools", "steps", "loop limit", "tool loops", "agent execution"],
  },
  {
    id: "setting-personalization-title",
    label: "Conversation Title Generation",
    description: "Configure how models auto-generate titles for new chats",
    sectionId: "personalization",
    sectionLabel: "System Prompts",
    keywords: ["title", "rename", "auto rename", "generate title", "chat title"],
  },
  {
    id: "setting-personalization-system",
    label: "System Prompt Override",
    description: "Set custom instruction templates to customize model behavior",
    sectionId: "personalization",
    sectionLabel: "System Prompts",
    keywords: ["system prompt", "instructions", "custom prompt", "personality", "system prompt override"],
  },
  {
    id: "setting-whisper-voice",
    label: "Whisper Voice Configuration",
    description: "Set up Whisper speech-to-text transcription and GGUF models",
    sectionId: "whisper",
    sectionLabel: "Voice Input",
    keywords: ["whisper", "voice", "speech to text", "audio", "recording", "transcribe", "stt", "model download"],
  },
  {
    id: "setting-plugins-catalog",
    label: "Plugins & Apps",
    description: "Browse, connect, and configure top integrations and tools (GitHub, Notion, Slack, etc.)",
    sectionId: "plugins",
    sectionLabel: "Plugins & Apps",
    keywords: ["plugins", "apps", "integrations", "github", "notion", "slack", "linear", "connect", "tools"],
  },
  {
    id: "setting-mcp-servers",
    label: "MCP Servers",
    description: "Manage Model Context Protocol servers and tool integrations",
    sectionId: "mcp",
    sectionLabel: "MCP Servers",
    keywords: ["mcp", "servers", "tools", "model context protocol", "mcp config", "stdio", "sse"],
  },
  {
    id: "setting-browser-search",
    label: "Web Search Configurations",
    description: "Configure Google, Firecrawl, SearXNG search endpoints and API keys",
    sectionId: "browser",
    sectionLabel: "Web Search",
    keywords: ["web search", "google", "firecrawl", "searxng", "search preset", "jina reader", "fetch url"],
  },
  {
    id: "setting-keybinds-shortcuts",
    label: "Keyboard Shortcuts Map",
    description: "View and customize hotkeys or global key configurations",
    sectionId: "keybinds",
    sectionLabel: "Keyboard Shortcuts",
    keywords: ["shortcuts", "hotkeys", "keybinds", "keyboard", "zoom"],
  },
  {
    id: "setting-appshots-config",
    label: "Appshots (Screen Captures)",
    description: "Configure format, quality, and auto-clean patterns for screenshots",
    sectionId: "appshots",
    sectionLabel: "Appshots",
    keywords: ["appshots", "screenshots", "screen capture", "images", "auto-clean", "gallery"],
  },
  {
    id: "setting-projects-config",
    label: "Workspace Projects",
    description: "Configure project directories, direct workspace permissions, and auto-commit",
    sectionId: "projects",
    sectionLabel: "Workspace Projects",
    keywords: ["workspace", "projects", "git repo", "direct edits", "permissions", "auto-commit"],
  },
  {
    id: "setting-logs-viewer",
    label: "Activity Log Viewer",
    description: "View and filter real-time Tauri and JS console logs for debugging",
    sectionId: "logs",
    sectionLabel: "Activity Log",
    keywords: ["logs", "debug", "activity log", "console", "errors", "warnings"],
  },
  {
    id: "setting-privacy-network",
    label: "Network & Proxy Security",
    description: "Set custom proxy, strict SSL, offline mode, or blocked host list",
    sectionId: "privacy",
    sectionLabel: "Privacy & Security",
    keywords: ["proxy", "offline", "ssl", "strict ssl", "hosts", "network", "privacy", "security"],
  },
  {
    id: "setting-models-providers",
    label: "Model Providers & API Keys",
    description: "Add/edit endpoints, credentials, and API keys for OpenAI, Anthropic, Ollama, etc.",
    sectionId: "models",
    sectionLabel: "Model Providers",
    keywords: ["providers", "api keys", "openai", "anthropic", "endpoints", "connection", "api credentials"],
  },
];
