import { validateApiUrl } from "./validation";

/** Deliberately never displays provider bodies, URLs with secrets, or process output. */
export function friendlyEndpointError(error: unknown, command = false): string {
  const raw = (
    error instanceof Error ? error.message : typeof error === "string" ? error : (JSON.stringify(error) ?? "")
  ).toLowerCase();
  if (/offline/.test(raw)) return "Offline Mode is on. Turn it off in Settings > Privacy & Security, then retry.";
  if (/cloud metadata|unspecified/.test(raw))
    return "This address is blocked for security. Choose a different endpoint.";
  if (/custom network rule/.test(raw))
    return "Blocked by a network rule. Review blocked hosts in Settings > Privacy & Security.";
  if (/local endpoint grant|local, private|exact local|local endpoint grants/.test(raw))
    return "Local endpoint access is blocked. Add this URL’s origin (scheme, host, and port) to Local endpoint grants in Settings > Privacy & Security, then retry.";
  if (/embedded credentials|invalid endpoint|invalid url|hostname|schemes/.test(raw))
    return "Check the endpoint URL. Use HTTP or HTTPS without a username or password in the URL.";
  if (/plaintext/.test(raw))
    return "This connection requires HTTPS. Use an HTTPS URL, or grant the exact origin of a local endpoint in Settings > Privacy & Security.";
  if (/401|unauthorized|auth required|autherror|keynotfound|invalid.*key/.test(raw))
    return "Authentication failed. Check the API key or credentials for this provider.";
  if (/403|forbidden/.test(raw))
    return "Access denied. Check that your credentials have permission to use this service.";
  if (/429|rate.limit/.test(raw)) return "Too many requests. Wait a moment, then retry.";
  if (/404|not found/.test(raw) && !command) return "Endpoint not found. Check the URL and API path.";
  if (/timed out|timeout|deadline/.test(raw))
    return "Connection timed out. Check that the server is running and try again.";
  if (/certificate|tls|ssl/.test(raw))
    return "A secure connection could not be established. Check the server’s HTTPS certificate.";
  if (/resolve|dns/.test(raw))
    return "Server address could not be found. Check the hostname and your network connection.";
  if (/connection refused|connect refused/.test(raw))
    return "Connection refused. Start the server and check the host and port.";
  if (/5\d\d/.test(raw)) return "The service is having trouble. Try again later.";
  if (command) {
    if (/not found|no such file|failed to spawn/.test(raw))
      return "Command not found. Install the program or enter its full executable path. Put options in Arguments.";
    if (/permission denied/.test(raw)) return "The command cannot run. Check that the program has execute permission.";
    return "MCP server could not start or complete its connection. Check the command, arguments, and environment variables, then reconnect.";
  }
  if (/handshake|transport|parse/.test(raw))
    return "The server returned an unexpected response. Check the endpoint path and selected protocol.";
  return "Unable to connect. Check the URL, your network connection, and that the server is running, then retry.";
}

export function endpointFieldError(url: string, status: string, error?: string): string | undefined {
  if (!url.trim()) return "Enter an endpoint URL.";
  if (!validateApiUrl(url).valid) return "Enter a valid URL starting with http:// or https://.";
  return status === "error" ? error || friendlyEndpointError(undefined) : undefined;
}
