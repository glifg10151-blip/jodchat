import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToastContainer } from "./Toast";
import { parseApiError, parseApiErrorMessage } from "../../utils/parseApiError";
import type { Toast } from "./Toast";

describe("parseApiError", () => {
  it("maps 401 errors to friendly message", () => {
    const result = parseApiError(new Error("API error 401: Unauthorized"));
    expect(result.message).toContain("Invalid API key");
    expect(result.category).toBe("auth");
    expect(result.retryable).toBe(false);
    expect(result.action).toBeTruthy();
  });

  it("maps 429 errors to rate limit message", () => {
    const result = parseApiError(new Error("API error 429: Too Many Requests"));
    expect(result.message).toContain("Rate limited");
    expect(result.category).toBe("rate-limit");
    expect(result.retryable).toBe(true);
  });

  it("maps 500 errors to server error message", () => {
    const result = parseApiError(new Error("API error 500: Internal Server Error"));
    expect(result.message).toContain("Server error");
    expect(result.category).toBe("server");
    expect(result.retryable).toBe(true);
  });

  it("maps network errors to connection message", () => {
    const result = parseApiError(new Error("Failed to fetch"));
    expect(result.message).toContain("Network error");
    expect(result.category).toBe("network");
  });

  it("maps timeout errors to timeout message", () => {
    const result = parseApiError(new Error("Request timeout"));
    expect(result.message).toContain("timed out");
    expect(result.category).toBe("network");
  });

  it("maps invalid URL errors", () => {
    const result = parseApiError(new Error("Invalid URL"));
    expect(result.message).toContain("Invalid API URL");
    expect(result.category).toBe("config");
  });

  it("returns generic message for unknown errors", () => {
    const result = parseApiError("some random error");
    expect(result.message).toBe("some random error");
    expect(result.category).toBe("unknown");
  });

  it("handles non-Error, non-string errors", () => {
    const result = parseApiError({ unknown: true });
    expect(result.message).toContain("unexpected error");
  });

  it("truncates long error messages", () => {
    const longMsg = "x".repeat(300);
    const result = parseApiError(new Error(longMsg));
    expect(result.message.length).toBeLessThanOrEqual(203);
    expect(result.message).toContain("\u2026");
  });

  it("handles structured AppError JSON from Rust backend", () => {
    const structuredError = JSON.stringify({
      ApiError: { status: 401, message: "Unauthorized" },
    });
    const result = parseApiError(structuredError);
    expect(result.message).toContain("Invalid API key");
    expect(result.category).toBe("auth");
  });

  it("handles structured UrlValidationError from Rust backend", () => {
    const structuredError = JSON.stringify({
      UrlValidationError: "URL points to localhost",
    });
    const result = parseApiError(structuredError);
    expect(result.message).toContain("URL validation error");
    expect(result.category).toBe("search");
  });

  it("handles structured KeyNotFound from Rust backend", () => {
    const structuredError = JSON.stringify({
      KeyNotFound: "No API key found for search config 'search-123'",
    });
    const result = parseApiError(structuredError);
    expect(result.message).toContain("No API key found");
    expect(result.category).toBe("auth");
  });

  it("handles structured StreamError from Rust backend", () => {
    const structuredError = JSON.stringify({
      StreamError: "connection reset",
    });
    const result = parseApiError(structuredError);
    expect(result.message).toContain("Stream error");
    expect(result.category).toBe("network");
    expect(result.retryable).toBe(true);
  });

  it("handles structured McpError from Rust backend", () => {
    const structuredError = JSON.stringify({
      McpError: 'Could not start "npx": the executable was not found',
    });
    const result = parseApiError(structuredError);
    expect(result.message).toContain("was not found");
    expect(result.message).toContain('"npx"');
    expect(result.category).toBe("mcp");
    expect(result.rawDetail).toBeTruthy();
  });

  it("includes a runtime-specific install hint for MCP spawn errors", () => {
    const structuredError = JSON.stringify({
      McpError: 'Could not start "npx": not found on PATH',
    });
    const result = parseApiError(structuredError);
    expect(result.action).toContain("Node.js");
    expect(result.category).toBe("mcp");
    expect(result.retryable).toBe(false);
  });

  it("includes a uv install hint for uvx spawn errors", () => {
    const structuredError = JSON.stringify({
      McpError: 'Could not start "uvx": was not found',
    });
    const result = parseApiError(structuredError);
    expect(result.action).toContain("uv");
  });

  it("surfaces MCP permission errors distinctly", () => {
    const structuredError = JSON.stringify({
      McpError: 'Could not start "/usr/local/bin/foo": permission denied',
    });
    const result = parseApiError(structuredError);
    expect(result.message).toContain("permission denied");
    expect(result.action).toContain("executable");
  });

  it("handles MCP handshake/transport error with full detail", () => {
    const structuredError = JSON.stringify({
      McpError:
        "MCP handshake failed: Send message error Transport [rmcp::transport::worker::WorkerTransport] error: Client error: error sending request for url (http://localhost:4000/)",
    });
    const result = parseApiError(structuredError);
    expect(result.message).toContain("MCP handshake failed");
    expect(result.message).toContain("Send message error");
    expect(result.category).toBe("mcp");
    expect(result.rawDetail).toContain("handshake/transport");
    expect(result.retryable).toBe(true);
  });

  it("falls through for non-JSON error strings", () => {
    const result = parseApiError("some plain text error");
    expect(result.message).toBe("some plain text error");
  });

  it("handles structured AppError as a raw object (Tauri rejection style)", () => {
    const structuredObject = {
      ApiError: { status: 401, message: "Unauthorized" },
    };
    const result = parseApiError(structuredObject);
    expect(result.message).toContain("Invalid API key");
    expect(result.category).toBe("auth");
  });

  it("extracts and formats JSON error bodies from LLM providers", () => {
    const structuredError = JSON.stringify({
      ApiError: {
        status: 500,
        message: 'Request failed: {"error":{"message":"Model context window exceeded","type":"invalid_request_error"}}',
      },
    });
    const result = parseApiError(structuredError);
    expect(result.message).toContain("Server error");
    expect(result.message).toContain("Request failed: Model context window exceeded");
    expect(result.category).toBe("server");
  });

  it("parseApiErrorMessage returns just the message string", () => {
    const msg = parseApiErrorMessage(new Error("API error 401: Unauthorized"));
    expect(typeof msg).toBe("string");
    expect(msg).toContain("Invalid API key");
  });
});

describe("ToastContainer", () => {
  it("renders nothing when toasts is empty", () => {
    const { container } = render(<ToastContainer toasts={[]} onDismiss={vi.fn()} />);

    expect(container.innerHTML).toBe("");
  });

  it("renders toast messages", () => {
    const toasts: Toast[] = [{ id: "t-1", message: "Test toast", variant: "info" }];
    render(<ToastContainer toasts={toasts} onDismiss={vi.fn()} />);

    expect(screen.getByText("Test toast")).toBeInTheDocument();
  });

  it("renders error toasts with alert role", () => {
    const toasts: Toast[] = [{ id: "t-1", message: "Error!", variant: "error" }];
    render(<ToastContainer toasts={toasts} onDismiss={vi.fn()} />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("calls onDismiss when dismiss button clicked", () => {
    const onDismiss = vi.fn();
    const toasts: Toast[] = [{ id: "t-1", message: "Dismiss me", variant: "info" }];
    render(<ToastContainer toasts={toasts} onDismiss={onDismiss} />);

    const btn = screen.getByLabelText("Dismiss notification");
    btn.click();
    expect(onDismiss).toHaveBeenCalledWith("t-1");
  });
});
