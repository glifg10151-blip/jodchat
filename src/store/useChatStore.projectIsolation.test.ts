import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildConversationRunContext, createToolStepBudget } from "../services/conversationRunContext";
import type { Conversation, Project } from "../types";

const mocks = vi.hoisted(() => ({
  sendWithToolLoop: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/toolLoop", () => ({ sendWithToolLoop: mocks.sendWithToolLoop }));

import { useChatStore } from "./useChatStore";
import { useModelStore } from "./useModelStore";
import { useProjectStore } from "./useProjectStore";

describe("conversation project isolation", () => {
  const projects: Project[] = [
    { id: "project-a", name: "A", path: "C:/projects/a", permissions: "read" },
    { id: "project-b", name: "B", path: "C:/projects/b", permissions: "read" },
  ];
  const conversation: Conversation = {
    id: "conversation-a",
    title: "A task",
    timestamp: new Date(),
    messages: [{ id: "message-a", role: "user", content: "Continue", timestamp: new Date() }],
    model: "model-a",
    projectId: "project-a",
  };

  beforeEach(() => {
    mocks.sendWithToolLoop.mockClear();
    useChatStore.setState({ conversations: [conversation], activeId: conversation.id });
    useModelStore.setState({
      selectedModel: "model-a",
      models: [
        {
          id: "model-a",
          name: "Model A",
          apiBase: "https://example.test/v1/chat/completions",
          apiKey: "",
          modelId: "model-a",
          enabled: true,
        },
      ],
    });
    useProjectStore.setState({
      projects,
      isProjectsEnabled: true,
      activeProjectId: "project-b",
    });
  });

  it("resumes with the conversation's project even when another project is visible", async () => {
    await useChatStore.getState().resumeConversation(conversation.id);

    expect(mocks.sendWithToolLoop).toHaveBeenCalledOnce();
    expect(mocks.sendWithToolLoop.mock.calls[0][0].project).toEqual(projects[0]);
  });
  it("keeps original MCP capabilities on notification-driven resumes despite settings changes", async () => {
    const context = buildConversationRunContext({
      conversation,
      models: useModelStore.getState().models,
      selectedModel: "model-a",
      temperature: 0.7,
      projects,
      projectsEnabled: true,
      searchConfig: undefined,
      searchApiKey: "",
      mcpTools: [
        {
          serverId: "mcp-a",
          serverName: "Original",
          name: "read",
          namespacedName: "Original__read",
          description: "Read",
          inputSchema: { type: "object" },
        },
      ],
      mcpCallTool: vi.fn(),
      skills: [],
      stepBudget: createToolStepBudget(3),
    })!;
    useChatStore.setState({
      conversations: [
        {
          ...conversation,
          messages: [
            ...conversation.messages,
            { id: "notification", role: "user", content: "Child finished", isSystem: true, timestamp: new Date() },
          ],
        },
      ],
    });
    useProjectStore.setState({ isProjectsEnabled: false });
    useModelStore.setState({ models: [] });
    await useChatStore.getState().resumeConversation(conversation.id, { runContext: context });
    const resumed = mocks.sendWithToolLoop.mock.calls[0][0];
    expect(resumed.mcpTools).toEqual(context.mcpTools);
    expect(resumed.project).toEqual(projects[0]);
    expect(resumed.modelConfig).toEqual(context.modelConfig);
    expect(resumed.stepBudget).toBe(context.stepBudget);
  });
});
