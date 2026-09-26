export const PROVIDER_PRESETS = [
  {
    providerId: "openai-responses",
    label: "OpenAI (Responses)",
    apiBase: "https://api.openai.com/v1/responses",
    defaultModel: "gpt-5.6-sol",
  },
  {
    providerId: "openai",
    label: "OpenAI",
    apiBase: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-5.6-sol",
  },
  {
    providerId: "gemini",
    label: "Google Gemini",
    apiBase: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    defaultModel: "gemini-3.1-pro",
  },
  {
    providerId: "anthropic",
    label: "Anthropic",
    apiBase: "https://api.anthropic.com/v1/messages",
    defaultModel: "claude-opus-5",
  },
  {
    providerId: "ollama",
    label: "Ollama (Local)",
    apiBase: "http://localhost:11434/v1/chat/completions",
    defaultModel: "deepseek-r1:7b",
  },
  {
    providerId: "nim",
    label: "NVIDIA NIM",
    apiBase: "https://integrate.api.nvidia.com/v1/chat/completions",
    defaultModel: "meta/llama-3.3-70b-instruct",
  },
  {
    providerId: "openrouter",
    label: "OpenRouter",
    apiBase: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "anthropic/claude-sonnet-5",
  },
  { providerId: "custom", label: "Custom", apiBase: "", defaultModel: "" },
] as const;
