import { describe, expect, it } from "vitest";
import { formatModelName } from "./formatModelName";

describe("formatModelName", () => {
  it("formats standard model IDs with prefixes", () => {
    expect(formatModelName("z-ai/glm-5.2")).toBe("GLM 5.2");
    expect(formatModelName("meta/llama-3.3-70b-instruct")).toBe("Llama 3.3 70B Instruct");
    expect(formatModelName("meta-llama/llama-3.1-405b-instruct")).toBe("Llama 3.1 405B Instruct");
    expect(formatModelName("anthropic/claude-sonnet-5")).toBe("Claude Sonnet 5");
    expect(formatModelName("anthropic/claude-3-7-sonnet-20250219")).toBe("Claude 3.7 Sonnet 20250219");
    expect(formatModelName("google/gemini-2.5-flash")).toBe("Gemini 2.5 Flash");
    expect(formatModelName("openai/gpt-4o-mini")).toBe("GPT 4o Mini");
    expect(formatModelName("openai/gpt-5.6-sol")).toBe("GPT 5.6 Sol");
    expect(formatModelName("deepseek-ai/DeepSeek-R1-Distill-Qwen-32B")).toBe("DeepSeek R1 Distill Qwen 32B");
    expect(formatModelName("mistralai/mistral-large-2407")).toBe("Mistral Large 2407");
    expect(formatModelName("mistralai/codestral-2501")).toBe("Codestral 2501");
    expect(formatModelName("01-ai/yi-1.5-34b-chat")).toBe("Yi 1.5 34B Chat");
    expect(formatModelName("databricks/dbrx-instruct")).toBe("DBRX Instruct");
    expect(formatModelName("microsoft/phi-4")).toBe("Phi 4");
    expect(formatModelName("cohere/command-r-plus")).toBe("Command R Plus");
  });

  it("formats IDs without provider prefixes", () => {
    expect(formatModelName("glm-5.2")).toBe("GLM 5.2");
    expect(formatModelName("claude-opus-5")).toBe("Claude Opus 5");
    expect(formatModelName("gemini-3.1-pro")).toBe("Gemini 3.1 Pro");
    expect(formatModelName("gpt-5.6-sol")).toBe("GPT 5.6 Sol");
  });

  it("handles tags with colons, underscores, and quantization", () => {
    expect(formatModelName("deepseek-r1:7b")).toBe("DeepSeek R1 7B");
    expect(formatModelName("ollama/llama3.2:1b")).toBe("Llama 3.2 1B");
    expect(formatModelName("mistral:latest")).toBe("Mistral Latest");
    expect(formatModelName("meta-llama/Llama-3.1-8B-Instruct-FP8")).toBe("Llama 3.1 8B Instruct FP8");
    expect(formatModelName("deepseek-ai/DeepSeek-V3")).toBe("DeepSeek V3");
  });

  it("handles compound tokens like llama3, phi4, mistral7b", () => {
    expect(formatModelName("llama3.3")).toBe("Llama 3.3");
    expect(formatModelName("phi4")).toBe("Phi 4");
    expect(formatModelName("gemma2")).toBe("Gemma 2");
  });

  it("handles empty and edge case inputs", () => {
    expect(formatModelName("")).toBe("");
    expect(formatModelName("   ")).toBe("");
  });
});
