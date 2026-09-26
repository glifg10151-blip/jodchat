/**
 * Model Name Auto-Generation Utility
 *
 * Formats model IDs (e.g. "z-ai/glm-5.2", "meta/llama-3.3-70b-instruct", "deepseek-r1:7b")
 * into clean, readable display names (e.g. "GLM 5.2", "Llama 3.3 70B Instruct", "DeepSeek R1 7B").
 */

const KNOWN_WORDS: Record<string, string> = {
  // Acronyms & Short Codes
  glm: "GLM",
  gpt: "GPT",
  dbrx: "DBRX",
  llm: "LLM",
  ai: "AI",
  r1: "R1",
  r2: "R2",
  vl: "VL",
  ocr: "OCR",
  tts: "TTS",
  stt: "STT",
  sql: "SQL",
  moe: "MoE",
  it: "IT",

  // Model families & brands
  deepseek: "DeepSeek",
  starcoder: "StarCoder",
  codestral: "Codestral",
  openrouter: "OpenRouter",
  mistralai: "Mistral",
  qwen: "Qwen",
  llama: "Llama",
  mistral: "Mistral",
  claude: "Claude",
  gemini: "Gemini",
  gemma: "Gemma",
  phi: "Phi",
  yi: "Yi",
  sonnet: "Sonnet",
  haiku: "Haiku",
  opus: "Opus",
  command: "Command",
  nemotron: "Nemotron",
  hermes: "Hermes",
  wizardlm: "WizardLM",
  vicuna: "Vicuna",
  zephyr: "Zephyr",
  solar: "Solar",
  sol: "Sol",
  nova: "Nova",
  titan: "Titan",
  jamba: "Jamba",
  falcon: "Falcon",
  internlm: "InternLM",
  baichuan: "Baichuan",
  groq: "Groq",
  cohere: "Cohere",
  anthropic: "Anthropic",
  openai: "OpenAI",
  meta: "Meta",
  google: "Google",

  // Common tags / modifiers
  instruct: "Instruct",
  chat: "Chat",
  flash: "Flash",
  pro: "Pro",
  ultra: "Ultra",
  turbo: "Turbo",
  plus: "Plus",
  mini: "Mini",
  nano: "Nano",
  large: "Large",
  medium: "Medium",
  small: "Small",
  coder: "Coder",
  code: "Code",
  math: "Math",
  vision: "Vision",
  embedding: "Embedding",
  preview: "Preview",
  latest: "Latest",
  distill: "Distill",
  distilled: "Distilled",
  base: "Base",
  thinking: "Thinking",
  reasoning: "Reasoning",
  free: "Free",
  online: "Online",
};

/**
 * Format a single token/word according to AI model naming conventions.
 */
function formatSingleToken(token: string): string {
  if (!token) return "";
  const lower = token.toLowerCase();

  // 1. Direct dictionary match
  if (KNOWN_WORDS[lower]) {
    return KNOWN_WORDS[lower];
  }

  // 2. Parameter sizes (e.g., 70b, 8b, 405b, 128k, 1m, 1.5b)
  const paramMatch = token.match(/^(\d+(?:\.\d+)?)([bkmBKM])$/);
  if (paramMatch) {
    return `${paramMatch[1]}${paramMatch[2].toUpperCase()}`;
  }

  // 3. Version prefixes (e.g., v1, v2, v0.3, v3.1)
  const versionMatch = token.match(/^v(\d+(?:\.\d+)*)$/i);
  if (versionMatch) {
    return `V${versionMatch[1]}`;
  }

  // 4. Reasoning codes (e.g., r1, r2)
  if (/^r\d+$/i.test(token)) {
    return token.toUpperCase();
  }

  // 5. GPT-style suffix (e.g., 4o, 4o-mini)
  if (/^\d+o$/i.test(token)) {
    return token.toLowerCase();
  }

  // 6. Quantization / precision formats (e.g., fp16, bf16, int4, int8, q4, q8, q4_k_m, q8_0)
  if (/^(fp\d+|bf\d+|int\d+|q\d+(_[a-z0-9]+)*)$/i.test(token)) {
    return token.toUpperCase();
  }

  // 7. Pure numbers, decimals, or dates (e.g., 5.2, 20241022, 2407)
  if (/^\d+(\.\d+)?$/.test(token)) {
    return token;
  }

  // 8. Short acronyms (<= 4 chars with only consonants, e.g., glm, dbrx, sql, vl)
  if (/^[bcdfghjklmnpqrstvwxyz]{2,4}$/i.test(token)) {
    return token.toUpperCase();
  }

  // 9. Preserve existing mixed-case (e.g. DeepSeek, StarCoder)
  if (token !== token.toLowerCase() && token !== token.toUpperCase()) {
    return token;
  }

  // 10. Default Title Case
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

/**
 * Parses and splits compound tokens such as "llama3", "phi4", "mistral7b", "gpt4o".
 */
function splitCompoundToken(token: string): string[] {
  if (!token) return [];
  const lower = token.toLowerCase();

  // If the whole token is in the dictionary or is a recognized precision tag, do not split
  if (KNOWN_WORDS[lower] || /^(fp\d+|bf\d+|int\d+|q\d+(_[a-z0-9]+)*|v\d+.*|r\d+)$/i.test(token)) {
    return [token];
  }

  // Check for word followed by number or number+unit (e.g., "llama3", "llama3.3", "mistral7b", "gpt4")
  const compoundMatch = token.match(/^([a-zA-Z]{2,})(\d+(?:\.\d+)?(?:[bkmBKM]|o)?)$/);
  if (compoundMatch) {
    const [, word, suffix] = compoundMatch;
    // Don't split if word is "v" or "r" or if suffix is just a single letter
    if (word.length >= 2 && suffix) {
      return [word, suffix];
    }
  }

  return [token];
}

/**
 * Generates a human-friendly model display name from a raw model ID.
 *
 * @example
 * formatModelName("z-ai/glm-5.2") // => "GLM 5.2"
 * formatModelName("meta/llama-3.3-70b-instruct") // => "Llama 3.3 70B Instruct"
 * formatModelName("deepseek-r1:7b") // => "DeepSeek R1 7B"
 * formatModelName("anthropic/claude-sonnet-5") // => "Claude Sonnet 5"
 */
export function formatModelName(modelId: string): string {
  if (!modelId || typeof modelId !== "string") return "";
  let clean = modelId.trim();
  if (!clean) return "";

  // Strip org/provider prefix if present (e.g. "z-ai/glm-5.2" -> "glm-5.2")
  if (clean.includes("/")) {
    const parts = clean.split("/").filter(Boolean);
    if (parts.length > 1) {
      clean = parts[parts.length - 1];
    }
  }

  // Convert version hyphenation "3-5" -> "3.5", "3-7" -> "3.7", "1-5" -> "1.5"
  clean = clean.replace(/\b(\d+)-(\d+)\b/g, "$1.$2");

  // Split on delimiters: hyphens, underscores, colons, slashes, @, whitespace
  const rawTokens = clean.split(/[-_:\s@]+/).filter(Boolean);
  if (rawTokens.length === 0) return "";

  // Expand compound tokens and format each sub-token
  const formattedTokens: string[] = [];
  for (const rawToken of rawTokens) {
    const subTokens = splitCompoundToken(rawToken);
    for (const sub of subTokens) {
      const formatted = formatSingleToken(sub);
      if (formatted) {
        formattedTokens.push(formatted);
      }
    }
  }

  return formattedTokens.join(" ");
}
