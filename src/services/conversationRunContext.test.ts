import { describe, expect, it, vi } from "vitest";
import type { Conversation, ModelConfig, Project } from "../types";
import {
  createToolStepBudget,
  reserveToolRound,
  withToolStepBudget,
  continueConversationRunContext,
  buildConversationRunContext,
} from "./conversationRunContext";

const models: ModelConfig[] = [
  {
    id: "model-a",
    name: "Model A",
    apiBase: "https://provider-a.example/v1",
    apiKey: "",
    modelId: "provider-a-model",
    provider: "openai",
  },
  {
    id: "model-b",
    name: "Model B",
    apiBase: "https://provider-b.example/v1",
    apiKey: "",
    modelId: "provider-b-model",
    provider: "anthropic",
  },
];

const projects: Project[] = [
  { id: "project-a", name: "Project A", path: "/projects/a", permissions: "read" },
  { id: "project-b", name: "Project B", path: "/projects/b", permissions: "full" },
];

function conversation(projectId: string): Conversation {
  return {
    id: `conversation-${projectId}`,
    title: "Conversation",
    timestamp: new Date(),
    messages: [],
    model: "model-a",
    projectId,
  };
}

describe("buildConversationRunContext", () => {
  it("resolves project and provider from the target conversation rather than global navigation state", () => {
    const context = buildConversationRunContext({
      conversation: conversation("project-a"),
      models,
      selectedModel: "model-b",
      temperature: 0.7,
      projects,
      projectsEnabled: true,
      searchConfig: undefined,
      searchApiKey: "",
      mcpTools: [],
      mcpCallTool: vi.fn(),
      skills: [],
    });

    expect(context?.project?.id).toBe("project-a");
    expect(context?.project?.permissions).toBe("read");
    expect(context?.modelConfig.id).toBe("model-a");
    expect(context?.modelConfig.provider).toBe("openai");
  });

  it("remains unchanged when source project and model objects mutate after capture", () => {
    const mutableModels = models.map((model) => ({ ...model }));
    const mutableProjects = projects.map((project) => ({ ...project }));
    const context = buildConversationRunContext({
      conversation: conversation("project-b"),
      models: mutableModels,
      selectedModel: "model-a",
      temperature: 0.4,
      projects: mutableProjects,
      projectsEnabled: true,
      searchConfig: undefined,
      searchApiKey: "",
      mcpTools: [],
      mcpCallTool: undefined,
      skills: [],
    });

    mutableProjects[1].name = "Changed Project";
    mutableModels[0].provider = "changed";

    expect(context?.project?.name).toBe("Project B");
    expect(context?.modelConfig.provider).toBe("openai");
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context?.project)).toBe(true);
    expect(Object.isFrozen(context?.modelConfig)).toBe(true);
  });

  it("falls back to the selected model when the conversation model is unavailable", () => {
    const context = buildConversationRunContext({
      conversation: conversation("project-b"),
      models: models.map((model) => (model.id === "model-a" ? { ...model, enabled: false } : model)),
      selectedModel: "model-b",
      temperature: 0.7,
      projects,
      projectsEnabled: true,
      searchConfig: undefined,
      searchApiKey: "",
      mcpTools: [],
      mcpCallTool: undefined,
      skills: [],
    });

    expect(context?.modelConfig.id).toBe("model-b");
  });

  it("does not route new runs through a legacy pending worktree", () => {
    const context = buildConversationRunContext({
      conversation: {
        ...conversation("project-b"),
        pendingWorktree: { path: "/legacy/worktree", branch: "sythoria-agent-legacy" },
      },
      models,
      selectedModel: "model-a",
      temperature: 0.7,
      projects,
      projectsEnabled: true,
      searchConfig: undefined,
      searchApiKey: "",
      mcpTools: [],
      mcpCallTool: undefined,
      skills: [],
    });

    expect(context?.commitScope).toEqual({
      projectId: "project-b",
      projectRoot: "/projects/b",
      modelId: "model-a",
    });
  });

  it("captures installed skills immutably and enables the tool loop for a plain chat", () => {
    const skills = [{ id: "react-patterns", name: "React Patterns", description: "React guidance" }];
    const context = buildConversationRunContext({
      conversation: { ...conversation("none"), projectId: undefined },
      models,
      selectedModel: "model-a",
      temperature: 0.7,
      projects,
      projectsEnabled: false,
      searchConfig: undefined,
      searchApiKey: "",
      mcpTools: [],
      mcpCallTool: undefined,
      skills,
    });

    skills[0].name = "Changed";

    expect(context?.skills).toEqual([{ id: "react-patterns", name: "React Patterns", description: "React guidance" }]);
    expect(context?.shouldUseTools).toBe(true);
    expect(Object.isFrozen(context?.skills)).toBe(true);
    expect(Object.isFrozen(context?.skills[0])).toBe(true);
  });
});

it("reserves a shared budget atomically across descendants and releases cancelled work", () => {
  const budget = createToolStepBudget(1);
  const context = withToolStepBudget({ conversationId: "parent" } as never, budget);
  const child = continueConversationRunContext(context, "child");
  const finish = reserveToolRound(context.stepBudget!);
  expect(finish).not.toBeNull();
  expect(reserveToolRound(child.stepBudget!)).toBeNull();
  finish!(false);
  const retry = reserveToolRound(child.stepBudget!);
  expect(retry).not.toBeNull();
  retry!(true);
  retry!(true);
  expect(budget.completedToolRounds).toBe(1);
  expect(reserveToolRound(budget)).toBeNull();
});
