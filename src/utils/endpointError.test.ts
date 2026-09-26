import { describe, expect, it } from "vitest";
import { endpointFieldError, friendlyEndpointError } from "./endpointError";

describe("endpoint field errors", () => {
  it("explains exact local grants without displaying native diagnostics", () => {
    const message = friendlyEndpointError({
      UrlValidationError:
        "Endpoint resolves to a local, private, shared, or link-local address. Add the exact origin 'http://secret-host:8080' to Local endpoint grants",
    });
    expect(message).toContain("Settings > Privacy & Security");
    expect(message).toContain("scheme, host, and port");
    expect(message).not.toContain("secret-host");
  });
  it("keeps network rules distinct from authentication failures", () => {
    expect(friendlyEndpointError("blocked by a custom network rule")).toContain("blocked hosts");
    expect(friendlyEndpointError({ ApiError: { status: 401, message: "secret" } })).toContain("Authentication failed");
  });
  it("does not echo unknown provider or command output", () => {
    expect(friendlyEndpointError("secret provider output")).not.toContain("secret");
    expect(friendlyEndpointError("secret process output", true)).not.toContain("secret");
  });
  it("shows validation first and hides old connection errors after recovery", () => {
    expect(endpointFieldError("", "error", "old error")).toBe("Enter an endpoint URL.");
    expect(endpointFieldError("example.com", "connected")).toContain("http://");
    expect(endpointFieldError("https://example.com", "connected", "old error")).toBeUndefined();
    expect(endpointFieldError("https://example.com", "error", "Connection refused")).toBe("Connection refused");
  });
  it("distinguishes process and endpoint failures", () => {
    expect(friendlyEndpointError("command not found", true)).toContain("Install the program");
    expect(friendlyEndpointError("HTTP 404 not found")).toContain("API path");
    expect(friendlyEndpointError("connection refused")).toContain("host and port");
  });
});
