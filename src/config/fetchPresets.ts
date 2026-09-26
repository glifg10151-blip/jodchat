export const FETCH_PROVIDER_PRESETS = [
  {
    label: "Firecrawl" as const,
    provider: "firecrawl" as const,
    baseUrl: "https://api.firecrawl.dev/v1",
    fields: ["baseUrl", "apiKey"] as const,
  },
  {
    label: "Jina Reader" as const,
    provider: "jina" as const,
    baseUrl: "https://r.jina.ai",
    fields: ["baseUrl", "apiKey"] as const,
  },
] as const;
