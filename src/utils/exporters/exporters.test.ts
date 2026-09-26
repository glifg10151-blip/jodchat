import { describe, expect, it } from "vitest";
import type { Conversation } from "../../types";
import {
  conversationToMarkdown,
  exportAllConversationsToMarkdown,
  exportMemoryToMarkdown,
  exportToChatGptJson,
  exportToClaudeJson,
  exportToSythoriaJson,
} from "./index";

const sampleConversation: Conversation = {
  id: "conv-1",
  title: "Test Conversation",
  model: "claude-3-5-sonnet",
  timestamp: new Date("2026-08-19T10:00:00.000Z"),
  messages: [
    {
      id: "m1",
      role: "user",
      content: "What is quantum computing?",
      timestamp: new Date("2026-08-19T10:00:05.000Z"),
    },
    {
      id: "m2",
      role: "assistant",
      content: "Quantum computing leverages qubits and superposition.",
      timestamp: new Date("2026-08-19T10:00:15.000Z"),
    },
  ],
};

describe("exporters suite", () => {
  it("exports conversation to readable Markdown", () => {
    const md = conversationToMarkdown(sampleConversation);
    expect(md).toContain("# Test Conversation");
    expect(md).toContain("### 👤 User");
    expect(md).toContain("What is quantum computing?");
    expect(md).toContain("### 🤖 Assistant");
    expect(md).toContain("Quantum computing leverages qubits");
  });

  it("exports all conversations to unified Markdown", () => {
    const md = exportAllConversationsToMarkdown([sampleConversation]);
    expect(md).toContain("# Sythoria Chat History");
    expect(md).toContain("Exported 1 conversations");
  });

  it("exports memory to Markdown", () => {
    const md = exportMemoryToMarkdown("Global coding instructions", [
      { title: "User Prefs", content: "Likes dark mode" },
    ]);
    expect(md).toContain("## Global System Instructions");
    expect(md).toContain("Global coding instructions");
    expect(md).toContain("### User Prefs");
    expect(md).toContain("Likes dark mode");
  });

  it("exports to Sythoria JSON schema", () => {
    const json = exportToSythoriaJson([sampleConversation], "Sys prompt");
    const parsed = JSON.parse(json);
    expect(parsed.app).toBe("Sythoria");
    expect(parsed.conversations.length).toBe(1);
    expect(parsed.systemPrompt).toBe("Sys prompt");
  });

  it("exports to ChatGPT-compatible JSON schema", () => {
    const json = exportToChatGptJson([sampleConversation]);
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].title).toBe("Test Conversation");
    expect(parsed[0].mapping).toBeDefined();
    expect(parsed[0].mapping["node-0"].message.content.parts[0]).toBe("What is quantum computing?");
  });

  it("exports to Claude-compatible JSON schema", () => {
    const json = exportToClaudeJson([sampleConversation]);
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].name).toBe("Test Conversation");
    expect(parsed[0].chat_messages.length).toBe(2);
    expect(parsed[0].chat_messages[0].sender).toBe("human");
    expect(parsed[0].chat_messages[1].sender).toBe("assistant");
  });
});
