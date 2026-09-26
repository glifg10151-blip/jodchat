/**
 * MCP transport field presets and a library of popular stdio MCP servers.
 *
 * `MCP_SERVER_PRESETS` is surfaced in Settings as a "Templates" dropdown. Each
 * preset pre-fills `command` (program only) and `args` (template tokens like
 * `<PATH>` are highlighted in the UI so the user knows to replace them) and
 * pre-seeds any required environment variables.
 */

export const MCP_TRANSPORT_PRESETS = [
  {
    label: "Stdio" as const,
    transport: "stdio" as const,
    fields: ["command", "args", "env"] as const,
  },
  {
    label: "SSE" as const,
    transport: "sse" as const,
    fields: ["baseUrl", "apiKey"] as const,
  },
  {
    label: "Streamable HTTP" as const,
    transport: "streamable-http" as const,
    fields: ["baseUrl", "apiKey"] as const,
  },
] as const;

export interface McpServerPreset {
  id: string;
  /** Display name shown in the templates dropdown. */
  name: string;
  /** Short one-line description shown below the name. */
  description: string;
  /** Link to the server's homepage / docs. */
  homepageUrl?: string;
  /** Program/executable only (e.g. "npx"). */
  command: string;
  /** Full ordered argument list. May contain `<TOKEN>` placeholders. */
  args: string[];
  /** Environment variable keys this server expects (values left blank). */
  envKeys?: string[];
}

/**
 * Popular, officially-maintained MCP servers. Commands use `npx`/`uvx` which
 * resolve the package at runtime; `-y` is included so npx auto-confirms.
 */
export const MCP_SERVER_PRESETS: McpServerPreset[] = [
  {
    id: "filesystem",
    name: "Filesystem",
    description: "Read/write access to files and directories on your machine.",
    homepageUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "<PATH>"],
  },
  {
    id: "github",
    name: "GitHub",
    description: "Repositories, issues, PRs, and more via the GitHub API.",
    homepageUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    envKeys: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
  },
  {
    id: "sqlite",
    name: "SQLite",
    description: "Query and inspect a local SQLite database.",
    homepageUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite",
    command: "uvx",
    args: ["mcp-server-sqlite", "--db-path", "<DB_PATH>"],
  },
  {
    id: "memory",
    name: "Memory",
    description: "Persistent key/value memory store across conversations.",
    homepageUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
  },
  {
    id: "brave-search",
    name: "Brave Search",
    description: "Web and local search via the Brave Search API.",
    homepageUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    envKeys: ["BRAVE_API_KEY"],
  },
  {
    id: "fetch",
    name: "Fetch",
    description: "Fetch and extract content from web URLs.",
    homepageUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
    command: "uvx",
    args: ["mcp-server-fetch"],
  },
];
