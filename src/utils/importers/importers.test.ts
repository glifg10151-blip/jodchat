import { describe, expect, it } from "vitest";
import { parseImportData } from "./index";

describe("importers suite", () => {
  it("correctly parses ChatGPT conversations.json with tree mapping", () => {
    const chatGptExport = [
      {
        id: "chat-1",
        title: "Optimizing React code",
        create_time: 1700000000,
        mapping: {
          "node-1": {
            id: "node-1",
            parent: null,
            children: ["node-2"],
            message: null,
          },
          "node-2": {
            id: "node-2",
            parent: "node-1",
            children: ["node-3"],
            message: {
              id: "msg-1",
              author: { role: "user" },
              create_time: 1700000010,
              content: { content_type: "text", parts: ["How to optimize re-renders?"] },
            },
          },
          "node-3": {
            id: "node-3",
            parent: "node-2",
            children: [],
            message: {
              id: "msg-2",
              author: { role: "assistant" },
              create_time: 1700000020,
              content: { content_type: "text", parts: ["Use useMemo and useCallback."] },
            },
          },
        },
        current_node: "node-3",
      },
    ];

    const result = parseImportData(JSON.stringify(chatGptExport));
    expect(result.source).toBe("chatgpt");
    expect(result.conversations.length).toBe(1);
    expect(result.conversations[0].title).toBe("Optimizing React code");
    expect(result.conversations[0].messages.length).toBe(2);
    expect(result.conversations[0].messages[0].role).toBe("user");
    expect(result.conversations[0].messages[0].content).toBe("How to optimize re-renders?");
    expect(result.conversations[0].messages[1].role).toBe("assistant");
    expect(result.conversations[0].messages[1].content).toBe("Use useMemo and useCallback.");
  });

  it("correctly parses ChatGPT custom instructions / memory object", () => {
    const customInstructions = {
      custom_instructions: "I prefer concise answers with TypeScript examples.",
      about_user: "Software engineer based in Berlin.",
    };

    const result = parseImportData(JSON.stringify(customInstructions));
    expect(result.source).toBe("chatgpt");
    expect(result.memories.length).toBe(1);
    expect(result.memories[0].content).toContain("TypeScript");
  });

  it("correctly parses Claude conversations export", () => {
    const claudeExport = [
      {
        uuid: "claude-conv-1",
        name: "Rust Async Discussion",
        created_at: "2024-03-01T10:00:00.000Z",
        chat_messages: [
          {
            uuid: "c-msg-1",
            sender: "human",
            text: "Explain Tokio tasks",
            created_at: "2024-03-01T10:00:05.000Z",
          },
          {
            uuid: "c-msg-2",
            sender: "assistant",
            text: "Tokio tasks are green threads executed by a work-stealing scheduler.",
            created_at: "2024-03-01T10:00:15.000Z",
          },
        ],
      },
    ];

    const result = parseImportData(JSON.stringify(claudeExport));
    expect(result.source).toBe("claude");
    expect(result.conversations.length).toBe(1);
    expect(result.conversations[0].title).toBe("Rust Async Discussion");
    expect(result.conversations[0].messages.length).toBe(2);
    expect(result.conversations[0].messages[0].content).toBe("Explain Tokio tasks");
  });

  it("correctly parses Google Gemini / Takeout exports", () => {
    const geminiExport = {
      conversations: [
        {
          title: "Astrophysics facts",
          create_time: "2024-02-01T12:00:00Z",
          messages: [
            { author: "user", content: "What is an event horizon?" },
            { author: "model", content: "An event horizon is the boundary around a black hole." },
          ],
        },
      ],
    };

    const result = parseImportData(JSON.stringify(geminiExport));
    expect(result.source).toBe("gemini");
    expect(result.conversations.length).toBe(1);
    expect(result.conversations[0].messages.length).toBe(2);
    expect(result.conversations[0].messages[0].role).toBe("user");
    expect(result.conversations[0].messages[1].role).toBe("assistant");
  });

  it("correctly parses Sythoria native backups", () => {
    const sythoriaBackup = {
      app: "Sythoria",
      systemPrompt: "Always respond with code comments.",
      conversations: [
        {
          id: "syth-1",
          title: "My Sythoria Chat",
          model: "claude-3-5-sonnet",
          timestamp: "2026-08-19T00:00:00.000Z",
          messages: [
            { id: "m1", role: "user", content: "Hello Sythoria" },
            { id: "m2", role: "assistant", content: "Hello! How can I help?" },
          ],
        },
      ],
    };

    const result = parseImportData(JSON.stringify(sythoriaBackup));
    expect(result.source).toBe("sythoria");
    expect(result.conversations.length).toBe(1);
    expect(result.systemPrompt).toBe("Always respond with code comments.");
  });

  it("correctly parses plain Markdown memory notes with headings", () => {
    const markdownMemory = `
# Coding Preferences
- Use TypeScript for all frontend code.
- Prefer Tailwind CSS v4.

# Personal Notes
- Working on Tauri v2 desktop application.
`;

    const result = parseImportData(markdownMemory, "my_memory.md");
    expect(result.source).toBe("text_memory");
    expect(result.memories.length).toBe(2);
    expect(result.memories[0].title).toBe("Coding Preferences");
    expect(result.memories[0].content).toContain("TypeScript");
    expect(result.memories[1].title).toBe("Personal Notes");
  });
});
