import type { ModelConfig, ThinkingLevel } from "../types";

export const THINKING_LEVELS: {
  value: ThinkingLevel;
  label: string;
  description: string;
}[] = [
  { value: "auto", label: "Auto", description: "Use the model provider's default" },
  { value: "off", label: "Off", description: "Respond directly when the model allows it" },
  { value: "low", label: "Low", description: "Faster answers with light reasoning" },
  { value: "medium", label: "Medium", description: "Balanced reasoning, speed, and cost" },
  { value: "high", label: "High", description: "Deeper reasoning for complex work" },
];

export function getThinkingLevel(model?: ModelConfig): ThinkingLevel {
  return model?.thinkingLevel ?? "auto";
}

export function getThinkingLabel(model?: ModelConfig): string {
  const level = getThinkingLevel(model);
  return THINKING_LEVELS.find((option) => option.value === level)?.label ?? "Auto";
}

export function supportsThinkingControl(model?: ModelConfig): boolean {
  if (!model) return false;

  const provider = (model.provider ?? "").toLowerCase();
  const modelId = model.modelId.toLowerCase();

  if (provider.includes("openrouter") || provider.includes("ollama")) return true;
  if (provider.includes("anthropic")) {
    return /claude-(3-7|4|haiku-4|sonnet-4|opus-4|sonnet-5|opus-5|fable-5|mythos)/.test(modelId);
  }
  if (provider.includes("gemini") || provider.includes("google")) {
    return /^gemini-(2\.5|[3-9])/.test(modelId);
  }
  if (provider.includes("openai")) {
    return /^(o1|o3|o4|gpt-5|gpt-oss)/.test(modelId);
  }
  if (provider.includes("nim") || provider.includes("nvidia")) {
    return modelId.includes("gpt-oss");
  }

  return false;
}

export function getThinkingSupportText(model?: ModelConfig): string {
  if (!model) return "Choose a model to adjust thinking.";
  if (!supportsThinkingControl(model)) return "This model does not expose adjustable thinking.";

  const provider = (model.provider ?? "the provider").replace(/\s*\(.*\)$/, "");
  return `Mapped to ${provider}'s native reasoning controls.`;
}
