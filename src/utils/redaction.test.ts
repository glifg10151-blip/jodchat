import { describe, expect, it } from "vitest";
import { redactSensitiveValues, summarizeToolArguments } from "./redaction";

describe("logging redaction", () => {
  it("redacts sensitive fields recursively", () => {
    expect(redactSensitiveValues({ apiKey: "secret", nested: { password: "hidden", path: "src/app.ts" } })).toEqual({
      apiKey: "[REDACTED]",
      nested: { password: "[REDACTED]", path: "src/app.ts" },
    });
  });

  it("summarizes tool argument names without values", () => {
    const summary = summarizeToolArguments({ source: "private text", token: "secret" });
    expect(summary).toBe("Argument fields: source, token");
    expect(summary).not.toContain("private text");
    expect(summary).not.toContain("secret");
  });
});
