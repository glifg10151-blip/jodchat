/** Route by endpoint path so custom OpenAI-compatible providers work too. */
export function isResponsesEndpoint(apiBase: string): boolean {
  try {
    return new URL(apiBase).pathname.replace(/\/+$/, "").endsWith("/responses");
  } catch {
    return false;
  }
}
