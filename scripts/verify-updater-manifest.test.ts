import { describe, expect, it } from "vitest";
import { validateUpdaterManifest } from "./verify-updater-manifest.mjs";

const artifact = (platform: string) => ({
  url: `https://github.com/sythoria/sythoria-desktop/releases/download/v0.4.1/${platform}.zip`,
  signature: `signature-${platform}`,
});

describe("updater manifest verification", () => {
  it("accepts signed HTTPS artifacts for every supported platform family", () => {
    expect(
      validateUpdaterManifest(
        {
          version: "0.4.1",
          platforms: {
            "windows-x86_64": artifact("windows"),
            "linux-x86_64": artifact("linux"),
            "darwin-aarch64": artifact("darwin"),
          },
        },
        "v0.4.1",
        ["windows-", "linux-", "darwin-"],
      ),
    ).toHaveLength(3);
  });

  it("rejects unsigned, plaintext, missing, or version-mismatched artifacts", () => {
    expect(() =>
      validateUpdaterManifest(
        { version: "0.4.0", platforms: { "windows-x86_64": { url: "http://example.test/app", signature: "" } } },
        "v0.4.1",
        ["windows-", "linux-"],
      ),
    ).toThrow();
  });
});
