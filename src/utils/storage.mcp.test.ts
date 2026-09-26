import { describe, it, expect } from "vitest";
import { McpServerConfigSchema, migrateMcpConfigs } from "../utils/storage";
import type { McpServerConfig } from "../types";

function stdio(id: string, command?: string, args?: string[]): McpServerConfig {
  return {
    id,
    name: id,
    transport: "stdio",
    command,
    args,
    enabled: true,
  };
}

describe("migrateMcpConfigs", () => {
  it("migrates configs without a trust level to the secure default", () => {
    const result = McpServerConfigSchema.parse(stdio("1", "npx"));

    expect(result.trustLevel).toBe("untrusted");
  });

  it("preserves trust policy fields", () => {
    const result = McpServerConfigSchema.parse({
      ...stdio("1", "npx"),
      trustLevel: "trusted",
    });

    expect(result.trustLevel).toBe("trusted");
  });

  it("upgrades an existing bundled catalog plugin to verified trust", () => {
    const result = migrateMcpConfigs([
      {
        ...stdio("memory-server", "npx", ["-y", "@modelcontextprotocol/server-memory"]),
        name: "Memory Knowledge Graph",
        trustLevel: "untrusted",
      },
    ]);

    expect(result[0]).toMatchObject({ catalogPluginId: "memory", trustLevel: "trusted" });
  });

  it("does not trust a similarly named server with a modified package", () => {
    const result = migrateMcpConfigs([
      {
        ...stdio("memory-server", "npx", ["-y", "unverified-memory-server"]),
        name: "Memory Knowledge Graph",
        trustLevel: "untrusted",
      },
    ]);

    expect(result[0].catalogPluginId).toBeUndefined();
    expect(result[0].trustLevel).toBe("untrusted");
  });

  it("revokes stale catalog verification when the executable identity changed", () => {
    const result = migrateMcpConfigs([
      {
        ...stdio("memory-server", "npx", ["-y", "unverified-memory-server"]),
        name: "Memory Knowledge Graph",
        trustLevel: "trusted",
        catalogPluginId: "memory",
      },
    ]);

    expect(result[0].catalogPluginId).toBeUndefined();
    expect(result[0].trustLevel).toBe("untrusted");
  });

  it("splits a legacy full command line into program + args", () => {
    const result = migrateMcpConfigs([
      stdio("1", "npx -y @modelcontextprotocol/server-filesystem", ["/Users/me/project"]),
    ]);
    expect(result[0].command).toBe("npx");
    expect(result[0].args).toEqual(["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/project"]);
  });

  it("leaves already-migrated program-only commands untouched", () => {
    const result = migrateMcpConfigs([stdio("1", "npx", ["-y", "@modelcontextprotocol/server-memory"])]);
    expect(result[0].command).toBe("npx");
    expect(result[0].args).toEqual(["-y", "@modelcontextprotocol/server-memory"]);
  });

  it("dedups duplicate -y/--yes flags from the legacy auto-add heuristic", () => {
    const result = migrateMcpConfigs([stdio("1", "npx -y @modelcontextprotocol/server-filesystem", ["-y", "/path"])]);
    const yesFlags = result[0].args!.filter((a) => a === "-y" || a === "--yes");
    expect(yesFlags).toHaveLength(1);
    expect(result[0].args).toEqual(["-y", "@modelcontextprotocol/server-filesystem", "/path"]);
  });

  it("is a no-op for non-stdio transports", () => {
    const http = {
      ...stdio("1", "npx something"),
      transport: "streamable-http" as const,
      baseUrl: "http://localhost:3001/mcp",
    };
    const result = migrateMcpConfigs([http]);
    expect(result[0]).toEqual(http);
  });

  it("passes through empty/undefined commands unchanged", () => {
    const result = migrateMcpConfigs([stdio("1", "", undefined)]);
    expect(result[0].command).toBe("");
    expect(result[0].args).toBeUndefined();
  });

  it("handles a command with no explicit args field", () => {
    const result = migrateMcpConfigs([stdio("1", "uvx mcp-server-fetch")]);
    expect(result[0].command).toBe("uvx");
    expect(result[0].args).toEqual(["mcp-server-fetch"]);
  });
});
