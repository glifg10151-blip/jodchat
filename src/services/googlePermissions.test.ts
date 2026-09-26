import { describe, expect, it } from "vitest";
import { googlePermissions, validateGoogleScopes } from "./googlePermissions";

describe("Google permissions", () => {
  it.each(["gmail", "google-calendar", "google-drive"])("requests only %s scopes and defaults to read access", (id) => {
    const permissions = googlePermissions(id);
    const prefix = id === "gmail" ? "gmail." : id === "google-calendar" ? "calendar." : "drive.";
    expect(permissions.scopes.every((value) => value.startsWith(`https://www.googleapis.com/auth/${prefix}`))).toBe(
      true,
    );
    expect(permissions.scopes.every((value) => value.endsWith("readonly"))).toBe(true);
    expect(permissions.tools).not.toContain("manage_accounts");
  });
  it("only offers Gmail sending after explicit write access", () => {
    expect(googlePermissions("gmail").tools).not.toContain("send_email");
    expect(googlePermissions("gmail", "write").scopes).toContain("https://www.googleapis.com/auth/gmail.compose");
    expect(googlePermissions("gmail", "write").tools).toContain("send_email");
    expect(googlePermissions("gmail", "write").tools).not.toContain("delete_email");
  });
  it("rejects partial consent before installing a plugin", () => {
    expect(() => validateGoogleScopes("read write", "read")).toThrow("did not grant");
    expect(validateGoogleScopes("read", undefined)).toBe("read");
  });
});
