import { MAX_TOOL_CONTEXT_CHARS, UNKNOWN_CONTEXT_ASSEMBLY_TOKENS } from "../config/constants";
import type { ContextDisclosure, ModelConfig } from "../types";

export interface ApiContextMessage {
  role: string;
  content: string | null | unknown[];
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
  anthropic_content?: unknown[];
  responses_output?: unknown[];
  reasoning_content?: string;
  reasoning_details?: unknown[];
  reasoning?: string;
}

export interface ContextBudget {
  provider: string;
  status: "configured" | "unknown";
  contextTokens: number | null;
  assemblyCeilingTokens: number;
  reservedOutputTokens: number;
  reservedToolTokens: number;
  inputTokens: number;
}

export interface AssembledContext {
  messages: ApiContextMessage[];
  budget: ContextBudget;
  requestMaxOutputTokens: number | undefined;
  disclosure: ContextDisclosure | null;
}

const OUTPUT_RESERVE_BY_PROVIDER: Record<string, number> = {
  anthropic: 8_192,
  gemini: 8_192,
  openai: 4_096,
  openrouter: 4_096,
  ollama: 4_096,
  nim: 4_096,
  custom: 4_096,
};

const TOOL_RESERVE_RATIO_BY_PROVIDER: Record<string, number> = {
  anthropic: 0.12,
  gemini: 0.1,
  openai: 0.1,
  openrouter: 0.1,
  ollama: 0.08,
  nim: 0.08,
  custom: 0.1,
};

function normalizeProvider(model: ModelConfig): string {
  const provider = model.provider?.trim().toLowerCase() ?? "";
  const apiBase = model.apiBase.toLowerCase();
  if (provider.includes("anthropic") || apiBase.includes("anthropic.com")) return "anthropic";
  if (provider.includes("gemini") || provider.includes("google") || apiBase.includes("googleapis.com")) {
    return "gemini";
  }
  if (provider.includes("openrouter") || apiBase.includes("openrouter.ai")) return "openrouter";
  if (provider.includes("ollama") || apiBase.includes("localhost:11434")) return "ollama";
  if (provider.includes("nvidia") || provider.includes("nim") || apiBase.includes("nvidia.com")) return "nim";
  if (provider.includes("openai") || apiBase.includes("openai.com")) return "openai";
  return "custom";
}

function estimateContentTokens(content: ApiContextMessage["content"]): number {
  if (typeof content === "string") return Math.ceil(content.length / 4);
  if (!content) return 0;
  let tokens = 0;
  for (const part of content) {
    if (!part || typeof part !== "object") {
      tokens += Math.ceil(JSON.stringify(part).length / 4);
      continue;
    }
    const record = part as Record<string, unknown>;
    if (record.type === "image_url" || record.type === "image") {
      tokens += 1_000;
    } else if (typeof record.text === "string") {
      tokens += Math.ceil(record.text.length / 4);
    } else {
      tokens += Math.ceil(JSON.stringify(record).length / 4);
    }
  }
  return tokens;
}

export function estimateApiMessageTokens(message: ApiContextMessage): number {
  if (message.responses_output) return 6 + Math.ceil(JSON.stringify(message.responses_output).length / 4);
  return (
    6 +
    estimateContentTokens(message.content) +
    (message.tool_calls ? Math.ceil(JSON.stringify(message.tool_calls).length / 4) : 0) +
    (message.reasoning_content ? Math.ceil(message.reasoning_content.length / 4) : 0) +
    (message.reasoning_details ? Math.ceil(JSON.stringify(message.reasoning_details).length / 4) : 0) +
    (message.anthropic_content ? Math.ceil(JSON.stringify(message.anthropic_content).length / 4) : 0) +
    (message.reasoning ? Math.ceil(message.reasoning.length / 4) : 0)
  );
}

export function resolveContextBudget(model: ModelConfig, tools: unknown[] = []): ContextBudget {
  const provider = normalizeProvider(model);
  const configuredContext =
    typeof model.contextSize === "number" && Number.isFinite(model.contextSize) && model.contextSize > 0
      ? Math.floor(model.contextSize)
      : null;
  const assemblyCeilingTokens = configuredContext ?? UNKNOWN_CONTEXT_ASSEMBLY_TOKENS;
  const requestedOutput = model.maxOutputTokens ?? OUTPUT_RESERVE_BY_PROVIDER[provider] ?? 4_096;
  const reservedOutputTokens = Math.min(
    Math.max(512, Math.floor(requestedOutput)),
    Math.max(512, Math.floor(assemblyCeilingTokens * 0.25)),
  );
  const toolDefinitionTokens = tools.length > 0 ? Math.ceil(JSON.stringify(tools).length / 4) : 0;
  const toolRatio = TOOL_RESERVE_RATIO_BY_PROVIDER[provider] ?? 0.1;
  const requestedToolReserve =
    tools.length > 0
      ? Math.max(2_048, Math.ceil(toolDefinitionTokens * 1.25), Math.floor(assemblyCeilingTokens * toolRatio))
      : 0;
  const reservedToolTokens = Math.max(
    toolDefinitionTokens,
    Math.min(requestedToolReserve, Math.floor(assemblyCeilingTokens * 0.25)),
  );
  const inputTokens = assemblyCeilingTokens - reservedOutputTokens - reservedToolTokens;
  if (inputTokens < 256) {
    throw new Error(
      "The model context is too small for the configured tools and output allowance. Reduce the tool selection or output limit, or select a model with a larger context.",
    );
  }

  return {
    provider,
    status: configuredContext ? "configured" : "unknown",
    contextTokens: configuredContext,
    assemblyCeilingTokens,
    reservedOutputTokens,
    reservedToolTokens,
    inputTokens,
  };
}

function summarizeToolMessage(message: ApiContextMessage): { message: ApiContextMessage; summarized: boolean } {
  if (
    message.role !== "tool" ||
    typeof message.content !== "string" ||
    message.content.length <= MAX_TOOL_CONTEXT_CHARS
  ) {
    return { message, summarized: false };
  }

  let shape: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(message.content) as unknown;
    if (Array.isArray(parsed)) {
      shape = { resultType: "array", itemCount: parsed.length };
    } else if (parsed && typeof parsed === "object") {
      shape = { resultType: "object", topLevelKeys: Object.keys(parsed as Record<string, unknown>).slice(0, 20) };
    } else {
      shape = { resultType: typeof parsed };
    }
  } catch {
    shape = { resultType: "text" };
  }

  return {
    message: {
      ...message,
      content: JSON.stringify({
        contextSummary: {
          tool: message.name ?? "tool",
          originalCharacters: message.content.length,
          ...shape,
          preview: message.content.slice(0, 2_000),
          note: "The full tool result remains available in the visible transcript.",
        },
      }),
    },
    summarized: true,
  };
}

function compactMessage(
  message: ApiContextMessage,
  tokenLimit: number,
): { message: ApiContextMessage; compacted: boolean } {
  if (message.responses_output) return { message, compacted: false };
  if (estimateApiMessageTokens(message) <= tokenLimit) return { message, compacted: false };
  const characterLimit = Math.max(1_000, tokenLimit * 4);
  if (typeof message.content === "string") {
    return {
      message: {
        ...message,
        content: `${message.content.slice(0, characterLimit)}\n\n[Content condensed for the model; full text remains in the transcript.]`,
      },
      compacted: true,
    };
  }
  if (Array.isArray(message.content)) {
    let remainingCharacters = characterLimit;
    const content = message.content.map((part) => {
      if (!part || typeof part !== "object") return part;
      const record = part as Record<string, unknown>;
      if (typeof record.text !== "string") return part;
      const text = record.text.slice(0, Math.max(0, remainingCharacters));
      remainingCharacters -= text.length;
      return {
        ...record,
        text: `${text}${text.length < record.text.length ? "\n\n[Attached text condensed for the model.]" : ""}`,
      };
    });
    return { message: { ...message, content }, compacted: true };
  }
  return { message, compacted: false };
}

function isSyntheticToolImageMessage(message: ApiContextMessage): boolean {
  if (message.role !== "user" || !Array.isArray(message.content)) return false;
  const first = message.content[0];
  return Boolean(
    first &&
    typeof first === "object" &&
    typeof (first as Record<string, unknown>).text === "string" &&
    ((first as Record<string, unknown>).text as string).startsWith("[Images from MCP tool"),
  );
}

function createSegments(messages: ApiContextMessage[]): ApiContextMessage[][] {
  const segments: ApiContextMessage[][] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role === "assistant" && message.tool_calls?.length) {
      const segment = [message];
      while (index + 1 < messages.length) {
        const next = messages[index + 1];
        if (next.role === "tool" || isSyntheticToolImageMessage(next)) {
          segment.push(next);
          index++;
        } else {
          break;
        }
      }
      segments.push(segment);
    } else {
      segments.push([message]);
    }
  }
  return segments;
}

function summarizeOmittedSegments(segments: ApiContextMessage[][]): ApiContextMessage {
  const messages = segments.flat();
  const roleCounts = messages.reduce<Record<string, number>>((counts, message) => {
    counts[message.role] = (counts[message.role] ?? 0) + 1;
    return counts;
  }, {});
  const highlights = messages
    .filter((message) => typeof message.content === "string" && message.content.trim())
    .slice(-6)
    .map((message) => `${message.role}: ${(message.content as string).replace(/\s+/g, " ").slice(0, 240)}`);
  return {
    role: "system",
    content: [
      "[Condensed earlier conversation context]",
      `Omitted message counts by role: ${JSON.stringify(roleCounts)}.`,
      highlights.length > 0 ? `Recent highlights:\n${highlights.join("\n")}` : "No textual highlights were available.",
      "The complete transcript remains visible to the user.",
    ].join("\n"),
  };
}

export function assembleContext(options: {
  messages: ApiContextMessage[];
  model: ModelConfig;
  tools?: unknown[];
  summarizeOmitted?: boolean;
}): AssembledContext {
  const budget = resolveContextBudget(options.model, options.tools ?? []);
  const originalTokens = options.messages.reduce((total, message) => total + estimateApiMessageTokens(message), 0);
  let summarizedToolResults = 0;
  let condensedMessages = 0;
  const normalized = options.messages.map((message) => {
    const summarized = summarizeToolMessage(message);
    if (summarized.summarized) summarizedToolResults++;
    const compacted = compactMessage(summarized.message, Math.max(256, Math.floor(budget.inputTokens * 0.45)));
    if (compacted.compacted) condensedMessages++;
    return compacted.message;
  });

  const systemMessages = normalized.filter((message) => message.role === "system");
  const bodySegments = createSegments(normalized.filter((message) => message.role !== "system"));
  const selected = new Set<number>();
  let usedTokens = systemMessages.reduce((total, message) => total + estimateApiMessageTokens(message), 0);
  let latestUserSegment = -1;
  for (let index = bodySegments.length - 1; index >= 0; index--) {
    if (bodySegments[index].some((message) => message.role === "user" && !isSyntheticToolImageMessage(message))) {
      latestUserSegment = index;
      break;
    }
  }
  const mandatoryIndexes = new Set<number>([bodySegments.length - 1, latestUserSegment].filter((index) => index >= 0));

  for (const index of [...mandatoryIndexes].sort((a, b) => a - b)) {
    selected.add(index);
    usedTokens += bodySegments[index].reduce((total, message) => total + estimateApiMessageTokens(message), 0);
  }
  for (let index = bodySegments.length - 1; index >= 0; index--) {
    if (selected.has(index)) continue;
    const segmentTokens = bodySegments[index].reduce((total, message) => total + estimateApiMessageTokens(message), 0);
    if (usedTokens + segmentTokens <= budget.inputTokens) {
      selected.add(index);
      usedTokens += segmentTokens;
    }
  }

  const omittedSegments = bodySegments.filter((_segment, index) => !selected.has(index));
  let selectedBody = bodySegments.filter((_segment, index) => selected.has(index)).flat();
  const availableBodyTokens = Math.max(
    512,
    budget.inputTokens -
      usedTokens +
      selectedBody.reduce((total, message) => total + estimateApiMessageTokens(message), 0),
  );
  const selectedBodyTokens = selectedBody.reduce((total, message) => total + estimateApiMessageTokens(message), 0);
  if (selectedBodyTokens > availableBodyTokens && selectedBody.length > 0) {
    const perMessageLimit = Math.max(512, Math.floor(availableBodyTokens / selectedBody.length));
    selectedBody = selectedBody.map((message) => {
      const compacted = compactMessage(message, perMessageLimit);
      if (compacted.compacted) condensedMessages++;
      return compacted.message;
    });
  }
  const assembled = [...systemMessages];
  if (omittedSegments.length > 0 && options.summarizeOmitted !== false) {
    const summary = summarizeOmittedSegments(omittedSegments);
    if (usedTokens + estimateApiMessageTokens(summary) <= budget.inputTokens) assembled.push(summary);
  }
  assembled.push(...selectedBody);

  const assembledTokens = assembled.reduce((total, message) => total + estimateApiMessageTokens(message), 0);
  // Signed reasoning, tool arguments, and images are indivisible. Never silently
  // corrupt them or send a request known to exceed even our local estimate.
  if (assembledTokens > budget.inputTokens) {
    throw new Error(
      `Required conversation context (${assembledTokens} estimated tokens) exceeds this model's input budget (${budget.inputTokens}). Reduce attachments/tool output or select a model with a larger context.`,
    );
  }
  const omittedMessages = omittedSegments.flat().length;
  const disclosure =
    omittedMessages > 0 || condensedMessages > 0 || summarizedToolResults > 0
      ? {
          omittedMessages,
          condensedMessages,
          summarizedToolResults,
          originalTokens,
          assembledTokens,
        }
      : null;

  // The prompt reserve is an assembly policy, not a provider generation cap.
  // When no maximum is configured, omit max_tokens and let the provider use
  // its native limit. For an explicit maximum, only clamp it to the estimated
  // space that remains in a known context window. This lets short prompts use
  // more than the fixed output reserve without overcommitting long prompts.
  const configuredMaxOutputTokens =
    typeof options.model.maxOutputTokens === "number" &&
    Number.isFinite(options.model.maxOutputTokens) &&
    options.model.maxOutputTokens > 0
      ? Math.floor(options.model.maxOutputTokens)
      : undefined;
  const availableOutputTokens =
    budget.status === "configured"
      ? Math.max(1, budget.assemblyCeilingTokens - assembledTokens - budget.reservedToolTokens)
      : undefined;
  const requestMaxOutputTokens =
    configuredMaxOutputTokens === undefined
      ? undefined
      : availableOutputTokens === undefined
        ? configuredMaxOutputTokens
        : Math.min(configuredMaxOutputTokens, availableOutputTokens);

  return { messages: assembled, budget, requestMaxOutputTokens, disclosure };
}

export function formatContextDisclosure(disclosure: ContextDisclosure): string {
  const details = [
    disclosure.omittedMessages > 0 ? `${disclosure.omittedMessages} earlier messages omitted` : "",
    disclosure.condensedMessages > 0 ? `${disclosure.condensedMessages} oversized messages condensed` : "",
    disclosure.summarizedToolResults > 0
      ? `${disclosure.summarizedToolResults} tool results structurally summarized`
      : "",
  ].filter(Boolean);
  return `Context condensed for this model request: ${details.join(", ")}. The full transcript remains visible.`;
}
