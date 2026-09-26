import { describe, expect, it } from "vitest";
import type { ModelConfig } from "../types";
import {
  assembleContext,
  estimateApiMessageTokens,
  resolveContextBudget,
  type ApiContextMessage,
} from "./contextAssembler";

function model(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: "model",
    name: "Model",
    apiBase: "https://api.openai.com/v1/chat/completions",
    apiKey: "",
    modelId: "model-id",
    provider: "openai",
    ...overrides,
  };
}

describe("context budgets", () => {
  it("reports unknown model context explicitly while applying a conservative assembly ceiling", () => {
    const budget = resolveContextBudget(model());
    expect(budget.status).toBe("unknown");
    expect(budget.contextTokens).toBeNull();
    expect(budget.inputTokens).toBeLessThan(budget.assemblyCeilingTokens);
  });

  it("uses provider-aware output reserves", () => {
    const openai = resolveContextBudget(model({ contextSize: 100_000, provider: "openai" }));
    const anthropic = resolveContextBudget(model({ contextSize: 100_000, provider: "anthropic" }));
    expect(anthropic.reservedOutputTokens).toBeGreaterThan(openai.reservedOutputTokens);
  });
});

describe("assembleContext", () => {
  it("counts preserved assistant reasoning in the context budget", () => {
    const withoutReasoning = estimateApiMessageTokens({ role: "assistant", content: "Answer" });
    const withReasoning = estimateApiMessageTokens({
      role: "assistant",
      content: "Answer",
      reasoning_content: "r".repeat(400),
    });

    expect(withReasoning - withoutReasoning).toBe(100);
  });

  it("does not impose a provider output cap when max output is not configured", () => {
    const result = assembleContext({
      messages: [{ role: "user", content: "Write a long response." }],
      model: model({ contextSize: 128_000 }),
    });

    expect(result.budget.reservedOutputTokens).toBe(4_096);
    expect(result.requestMaxOutputTokens).toBeUndefined();
  });

  it("lets an explicit output maximum use prompt space beyond the fixed reserve", () => {
    const messages: ApiContextMessage[] = [{ role: "user", content: "Write a long response." }];
    const result = assembleContext({
      messages,
      model: model({ contextSize: 128_000, maxOutputTokens: 128_000 }),
    });
    const assembledTokens = result.messages.reduce(
      (total, message) => total + estimateApiMessageTokens(message),
      0,
    );

    expect(result.budget.reservedOutputTokens).toBe(32_000);
    expect(result.requestMaxOutputTokens).toBe(128_000 - assembledTokens);
    expect(result.requestMaxOutputTokens).toBeGreaterThan(result.budget.reservedOutputTokens);
  });

  it("clamps an explicit output maximum to the estimated context remaining after tool schemas", () => {
    const tools = [{ description: "x".repeat(4_000) }];
    const result = assembleContext({
      messages: [{ role: "user", content: "Use the tool and explain the result." }],
      model: model({ contextSize: 16_000, maxOutputTokens: 16_000 }),
      tools,
    });
    const assembledTokens = result.messages.reduce(
      (total, message) => total + estimateApiMessageTokens(message),
      0,
    );

    expect(result.requestMaxOutputTokens).toBe(
      16_000 - assembledTokens - result.budget.reservedToolTokens,
    );
  });

  it("keeps the system prompt and latest user turn while sliding older history", () => {
    const messages: ApiContextMessage[] = [
      { role: "system", content: "system" },
      ...Array.from({ length: 20 }, (_value, index) => [
        { role: "user", content: `old user ${index} ${"x".repeat(1_000)}` },
        { role: "assistant", content: `old assistant ${index} ${"y".repeat(1_000)}` },
      ]).flat(),
      { role: "user", content: "latest user instruction" },
    ];

    const result = assembleContext({ messages, model: model({ contextSize: 4_096 }) });
    expect(result.messages[0]).toEqual({ role: "system", content: "system" });
    expect(result.messages).toContainEqual({ role: "user", content: "latest user instruction" });
    expect(result.disclosure?.omittedMessages).toBeGreaterThan(0);
  });

  it("replaces oversized tool payloads with structured summaries without changing the source messages", () => {
    const toolContent = JSON.stringify(Array.from({ length: 5_000 }, (_value, index) => ({ index, value: "data" })));
    const messages: ApiContextMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "inspect" },
      { role: "assistant", content: null, tool_calls: [{ id: "call" }] },
      { role: "tool", name: "search", tool_call_id: "call", content: toolContent },
    ];

    const result = assembleContext({ messages, model: model({ contextSize: 32_000 }), tools: [{ name: "search" }] });
    const toolResult = result.messages.find((message) => message.role === "tool");
    expect(toolResult?.content).toContain("contextSummary");
    expect(toolResult?.content).toContain("itemCount");
    expect(messages[3].content).toBe(toolContent);
    expect(result.disclosure?.summarizedToolResults).toBe(1);
    expect(
      result.messages.reduce((total, message) => total + estimateApiMessageTokens(message), 0),
    ).toBeLessThanOrEqual(result.budget.inputTokens);
  });
});

it("reserves the full tool schema even when it exceeds a quarter of context", () => {
  const tools = [{ description: "x".repeat(8_000) }];
  const budget = resolveContextBudget(model({ contextSize: 4_096 }), tools);
  expect(budget.reservedToolTokens).toBeGreaterThanOrEqual(Math.ceil(JSON.stringify(tools).length / 4));
  expect(budget.inputTokens + budget.reservedToolTokens + budget.reservedOutputTokens).toBe(4_096);
  expect(() => resolveContextBudget(model({ contextSize: 4_096 }), [{ description: "x".repeat(20_000) }])).toThrow(
    "configured tools",
  );
});

it.each([
  {
    role: "assistant",
    content: "short",
    responses_output: [{ type: "reasoning", encrypted_content: "x".repeat(20_000), summary: [] }],
  },
  { role: "assistant", content: null, tool_calls: [{ id: "write", function: { arguments: "x".repeat(20_000) } }] },
  {
    role: "assistant",
    content: "short",
    anthropic_content: [{ type: "thinking", thinking: "x".repeat(20_000), signature: "signed" }],
  },
  {
    role: "user",
    content: Array.from({ length: 8 }, () => ({ type: "image_url", image_url: { url: "data:image/png;base64,abc" } })),
  },
])("rejects oversized indivisible mandatory context without changing it", (message) => {
  const original = JSON.stringify(message);
  expect(() =>
    assembleContext({
      messages: [{ role: "user", content: "inspect" }, message],
      model: model({ contextSize: 4_096 }),
    }),
  ).toThrow("input budget");
  expect(JSON.stringify(message)).toBe(original);
});
