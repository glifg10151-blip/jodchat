import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useChatStore } from "./useChatStore";
import { useModelStore } from "./useModelStore";
import { useProjectStore } from "./useProjectStore";
import { useSearchStore } from "./useSearchStore";
import { useSkillStore } from "./useSkillStore";
import { useMcpStore } from "./useMcpStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const originalChat = useChatStore.getState();
const originalModel = useModelStore.getState();
const originalProject = useProjectStore.getState();
const originalSearch = useSearchStore.getState();
const originalSkill = useSkillStore.getState();
const originalMcp = useMcpStore.getState();
afterEach(() => {
  useChatStore.setState(originalChat, true);
  useModelStore.setState(originalModel, true);
  useProjectStore.setState(originalProject, true);
  useSearchStore.setState(originalSearch, true);
  useSkillStore.setState(originalSkill, true);
  useMcpStore.setState(originalMcp, true);
  vi.mocked(invoke).mockReset();
});

it("retains and replays native Responses items in a plain chat without enabling tools", async () => {
  const output = [
    { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "opaque-reasoning" },
    {
      type: "message",
      id: "msg_1",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "Hello" }],
    },
  ];
  let onChunk: (chunk: { kind: "content"; content: string }) => void = () => {};
  let onDone: () => void = () => {};
  useModelStore.setState({
    models: [
      {
        id: "responses",
        name: "Responses",
        provider: "openai-responses",
        apiBase: "https://api.openai.com/v1/responses",
        apiKey: "masked",
        modelId: "gpt-5.6-sol",
      },
    ],
    selectedModel: "responses",
    titleConfig: { ...useModelStore.getState().titleConfig, enabled: false },
    ensureStreamListeners: vi.fn().mockImplementation(async (_id, _conv, chunk, done) => {
      onChunk = chunk;
      onDone = done;
      return vi.fn();
    }),
  });
  useProjectStore.setState({ isProjectsEnabled: false, projects: [] });
  useSkillStore.setState({ skills: [], loadSkills: vi.fn().mockResolvedValue(undefined) });
  useChatStore.setState({
    conversations: [{ id: "plain", title: "Plain", model: "responses", messages: [], timestamp: new Date() }],
    activeId: "plain",
    isCompareMode: false,
    compareIds: [],
    isStreaming: false,
    generationByConversation: {},
    persistConversations: vi.fn().mockResolvedValue(undefined),
  });
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command !== "chat_stream_tools") throw new Error(`Unexpected command: ${command}`);
    onChunk({ kind: "content", content: "Hello" });
    onDone();
    return JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: "Hello", responses_output: output } }],
    });
  });

  expect(await useChatStore.getState().sendMessage("Hi")).toBe("accepted");
  await vi.waitFor(() => expect(useChatStore.getState().isStreaming).toBe(false));
  const assistant = useChatStore.getState().conversations[0].messages.find((message) => message.role === "assistant");
  expect(assistant).toMatchObject({ content: "Hello", responsesOutput: output });

  expect(await useChatStore.getState().sendMessage("Continue")).toBe("accepted");
  await vi.waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(useChatStore.getState().isStreaming).toBe(false));
  const request = vi.mocked(invoke).mock.calls[1][1] as { tools: string; messages: { responses_output?: unknown[] }[] };
  expect(request.tools).toBe("[]");
  expect(request.messages.some((message) => JSON.stringify(message.responses_output) === JSON.stringify(output))).toBe(
    true,
  );

  // Retrying the earlier response must discard the later user turn and its response.
  await useChatStore.getState().retryLastMessage("plain", assistant!.id);
  await vi.waitFor(() => expect(useChatStore.getState().isStreaming).toBe(false));
  const retriedMessages = useChatStore.getState().conversations[0].messages;
  expect(retriedMessages.map((message) => [message.role, message.content])).toEqual([
    ["user", "Hi"],
    ["assistant", "Hello"],
  ]);
  expect(retriedMessages[1].id).not.toBe(assistant!.id);
  const retryRequest = vi.mocked(invoke).mock.calls[2][1] as { messages: { content: string }[] };
  expect(retryRequest.messages.some((message) => message.content === "Continue")).toBe(false);

  const callsBeforeInvalidRetry = vi.mocked(invoke).mock.calls.length;
  await useChatStore.getState().retryLastMessage("plain", "deleted-message");
  expect(vi.mocked(invoke)).toHaveBeenCalledTimes(callsBeforeInvalidRetry);
  expect(useChatStore.getState().conversations[0].messages).toEqual(retriedMessages);
});

it("keeps the existing response when retry capabilities are unavailable", async () => {
  const messages = [
    {
      id: "user",
      role: "user" as const,
      content: "Find current information",
      timestamp: new Date(),
      searchConfigId: "missing-search",
    },
    {
      id: "assistant",
      role: "assistant" as const,
      content: "Existing response",
      timestamp: new Date(),
    },
  ];
  useSkillStore.setState({ skills: [], loadSkills: vi.fn().mockResolvedValue(undefined) });
  useSearchStore.setState({ searchConfigs: [], activeSearchId: null });
  useChatStore.setState({
    conversations: [{ id: "retry", title: "Retry", model: "missing", messages, timestamp: new Date() }],
    activeId: "retry",
    isStreaming: false,
  });

  await useChatStore.getState().retryLastMessage("retry");

  expect(useChatStore.getState().conversations[0].messages).toEqual(messages);
});

it("reconnects a referenced MCP server before retrying", async () => {
  const reconnect = vi.fn(async () => {
    useMcpStore.setState({
      enabledServerIds: new Set(["server-1"]),
      serverStatuses: { "server-1": "connected" },
      availableTools: [
        {
          name: "read",
          namespacedName: "mcp_7365727665722d31__read",
          description: "Read",
          inputSchema: {},
          serverId: "server-1",
          serverName: "Server",
        },
      ],
    });
  });
  useMcpStore.setState({
    mcpConfigs: [{ id: "server-1", name: "Server", transport: "stdio", command: "server", enabled: true }],
    enabledServerIds: new Set(),
    serverStatuses: { "server-1": "disconnected" },
    availableTools: [],
    toggleServerEnabled: reconnect,
  });
  useModelStore.setState({ models: [], selectedModel: "" });
  useProjectStore.setState({ projects: [], isProjectsEnabled: false });
  useSearchStore.setState({ searchConfigs: [], activeSearchId: null });
  useSkillStore.setState({ skills: [], loadSkills: vi.fn().mockResolvedValue(undefined) });
  useChatStore.setState({
    conversations: [
      {
        id: "retry-mcp",
        title: "Retry MCP",
        model: "missing",
        timestamp: new Date(),
        messages: [
          {
            id: "user",
            role: "user",
            content: "Use the server",
            timestamp: new Date(),
            mcpServerIds: ["server-1"],
          },
        ],
      },
    ],
    activeId: "retry-mcp",
    isStreaming: false,
  });

  await useChatStore.getState().retryLastMessage("retry-mcp");

  expect(reconnect).toHaveBeenCalledWith("server-1", true);
});
