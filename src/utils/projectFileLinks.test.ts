import { describe, expect, it } from "vitest";
import { resolveProjectFileLink } from "./projectFileLinks";

describe("resolveProjectFileLink", () => {
  it("resolves relative and project-contained absolute references", () => {
    expect(resolveProjectFileLink("./src/My%20File.ts#L12", "/work/app")).toBe("src/My File.ts");
    expect(resolveProjectFileLink("/work/app/src/main.ts:12", "/work/app")).toBe("src/main.ts");
    expect(resolveProjectFileLink("README.md", "/work/app")).toBe("README.md");
  });

  it("rejects external URLs, traversal, malformed encoding, and outside paths", () => {
    for (const href of [
      "https://example.com",
      "mailto:a@b.com",
      "//example.com/file",
      "../secret",
      "%2e%2e/secret",
      "/work/app-other/file",
      "#section",
      "%ZZ",
      "src/%00file",
      "src/",
    ]) {
      expect(resolveProjectFileLink(href, "/work/app")).toBeNull();
    }
  });
});
