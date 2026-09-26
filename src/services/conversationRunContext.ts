import type { Conversation, McpTool, McpToolResult, ModelConfig, Project, SearchApiConfig, SkillInfo } from "../types";

export type McpToolCaller = (
  serverId: string,
  toolName: string,
  args: Record<string, string>,
  conversationId: string,
) => Promise<McpToolResult>;

// Mutable holder shared by reference across every run descending from one
// user message (subagents, follow-up messages, notification-driven resumes)
// so the configured tool-step limit cannot be reset mid-chain.
export interface ToolStepBudget {
  readonly limit: number | null;
  completedToolRounds: number;
}

export function createToolStepBudget(limit: number | null): ToolStepBudget {
  return { limit, completedToolRounds: 0 };
}

const reservedToolRounds = new WeakMap<ToolStepBudget, number>();

export function isToolBudgetExhausted(budget: ToolStepBudget): boolean {
  return budget.limit !== null && budget.completedToolRounds + (reservedToolRounds.get(budget) ?? 0) >= budget.limit;
}

// Synchronous admission prevents parallel descendants from spending the same slot.
export function reserveToolRound(budget: ToolStepBudget): ((completed: boolean) => void) | null {
  if (isToolBudgetExhausted(budget)) return null;
  reservedToolRounds.set(budget, (reservedToolRounds.get(budget) ?? 0) + 1);
  let released = false;
  return (completed) => {
    if (released) return;
    released = true;
    reservedToolRounds.set(budget, (reservedToolRounds.get(budget) ?? 1) - 1);
    if (completed) budget.completedToolRounds++;
  };
}

export interface ConversationRunContext {
  readonly stepBudget?: ToolStepBudget;
  readonly conversationId: string;
  readonly modelConfig: ModelConfig;
  readonly temperature: number;
  readonly project: Project | null;
  readonly searchConfig: SearchApiConfig | undefined;
  readonly searchApiKey: string;
  readonly mcpTools: McpTool[];
  readonly mcpCallTool: McpToolCaller | undefined;
  readonly skills: readonly SkillInfo[];
  readonly attachmentCapabilities: Readonly<{ images: boolean }>;
  readonly commitScope: Readonly<{
    projectId: string | null;
    projectRoot: string | null;
    modelId: string;
  }>;
  readonly shouldUseTools: boolean;
}

interface BuildConversationRunContextOptions {
  conversation: Conversation;
  models: ModelConfig[];
  selectedModel: string;
  temperature: number;
  projects: Project[];
  projectsEnabled: boolean;
  searchConfig: SearchApiConfig | undefined;
  searchApiKey: string;
  mcpTools: McpTool[];
  mcpCallTool: McpToolCaller | undefined;
  skills: readonly SkillInfo[];
  stepBudget?: ToolStepBudget;
}

function cloneProject(project: Project | null): Project | null {
  if (!project) return null;
  return Object.freeze({
    ...project,
    excludePatterns: project.excludePatterns ? Object.freeze([...project.excludePatterns]) : undefined,
  }) as Project;
}

function cloneMcpTools(tools: McpTool[]): McpTool[] {
  return Object.freeze(
    tools.map((tool) =>
      Object.freeze({
        ...tool,
        inputSchema: Object.freeze({ ...tool.inputSchema }),
      }),
    ),
  ) as unknown as McpTool[];
}

function cloneSkills(skills: readonly SkillInfo[] = []): readonly SkillInfo[] {
  return Object.freeze((skills ?? []).map((skill) => Object.freeze({ ...skill })));
}

export function buildConversationRunContext(
  options: BuildConversationRunContextOptions,
): ConversationRunContext | undefined {
  const project = cloneProject(
    options.projectsEnabled && options.conversation.projectId
      ? (options.projects.find((candidate) => candidate.id === options.conversation.projectId) ?? null)
      : null,
  );
  const selectedModel =
    options.models.find((model) => model.id === options.conversation.model && model.enabled !== false) ??
    options.models.find((model) => model.id === options.selectedModel && model.enabled !== false) ??
    options.models.find((model) => model.enabled !== false);
  if (!selectedModel) return undefined;

  const modelConfig = Object.freeze({ ...selectedModel }) as ModelConfig;
  const searchConfig = options.searchConfig
    ? (Object.freeze({ ...options.searchConfig }) as SearchApiConfig)
    : undefined;
  const mcpTools = cloneMcpTools(options.mcpTools);
  const skills = cloneSkills(options.skills);
  const attachmentCapabilities = Object.freeze({ images: modelConfig.supportsImages !== false });
  const commitScope = Object.freeze({
    projectId: project?.id ?? null,
    projectRoot: project?.path ?? null,
    modelId: modelConfig.id,
  });

  return Object.freeze({
    conversationId: options.conversation.id,
    modelConfig,
    temperature: options.temperature,
    project,
    searchConfig,
    searchApiKey: options.searchApiKey,
    mcpTools,
    mcpCallTool: options.mcpCallTool,
    skills,
    attachmentCapabilities,
    commitScope,
    shouldUseTools: Boolean(project || searchConfig || mcpTools.length > 0 || skills.length > 0),
    ...(options.stepBudget ? { stepBudget: options.stepBudget } : {}),
  });
}

export function withToolStepBudget(
  context: ConversationRunContext,
  stepBudget: ToolStepBudget,
): ConversationRunContext {
  if (context.stepBudget === stepBudget) return context;
  return Object.freeze({ ...context, stepBudget });
}

export function continueConversationRunContext(
  context: ConversationRunContext,
  conversationId: string,
): ConversationRunContext {
  return Object.freeze({
    ...context,
    conversationId,
  });
}
