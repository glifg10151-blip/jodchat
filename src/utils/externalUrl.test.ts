import { describe, expect, it } from "vitest";
import { normalizeExternalUrl } from "./externalUrl";

describe("normalizeExternalUrl", () => {
  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "https://user:password@example.com/private",
    "https://example.com/\u0000hidden",
    "not a URL",
  ])("rejects unsafe URL %s", (value) => {
    expect(normalizeExternalUrl(value)).toBeNull();
  });

  it.each([
    ["https://example.com/path", "https://example.com/path"],
    ["http://localhost:3000/", "http://localhost:3000/"],
    ["mailto:security@example.com", "mailto:security@example.com"],
  ])("allows supported URL %s", (value, expected) => {
    expect(normalizeExternalUrl(value)?.href).toBe(expected);
  });
});
