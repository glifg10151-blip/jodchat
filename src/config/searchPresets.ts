export const SEARCH_PROVIDER_PRESETS = [
  {
    label: "Google" as const,
    provider: "google" as const,
    baseUrl: "https://www.googleapis.com/customsearch/v1",
    defaultMaxResults: 5,
    fields: ["baseUrl", "apiKey", "cx", "maxResults"] as const,
  },
  {
    label: "SearXNG" as const,
    provider: "searxng" as const,
    baseUrl: "http://localhost:8080",
    defaultMaxResults: 10,
    fields: ["baseUrl", "maxResults"] as const,
  },
  {
    label: "Firecrawl" as const,
    provider: "firecrawl" as const,
    baseUrl: "https://api.firecrawl.dev/v1",
    defaultMaxResults: 5,
    fields: ["baseUrl", "apiKey", "maxResults"] as const,
  },
  {
    label: "Custom" as const,
    provider: "custom" as const,
    baseUrl: "",
    defaultMaxResults: 5,
    fields: ["baseUrl", "apiKey", "maxResults"] as const,
  },
] as const;
