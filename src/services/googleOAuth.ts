import { validateGoogleScopes } from "./googlePermissions";
import { invoke } from "@tauri-apps/api/core";
import { openExternalUrl } from "../utils/externalUrl";

export interface GoogleTokenResult {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

function generateRandomString(length: number): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => possible[b % possible.length])
    .join("");
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Initiates the Google Desktop OAuth 2.0 PKCE flow.
 * 1. Generates PKCE code_verifier and code_challenge.
 * 2. Starts a local loopback listener on an OS-assigned port.
 * 3. Opens the user's browser to Google authorization consent page.
 * 4. Captures authorization code on loopback redirect.
 * 5. Exchanges code for Google OAuth access and refresh tokens.
 */
export interface GoogleOAuthResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
}

export interface ParsedGoogleClientSecret {
  clientId?: string;
  clientSecret?: string;
  projectId?: string;
}

/**
 * Parses Google Cloud Console downloaded client credentials JSON (client_secret_xxx.json).
 * Accepts only complete "installed" (Desktop app) clients for dynamic loopback redirects.
 */
export function parseGoogleClientSecretsFile(jsonString: string): ParsedGoogleClientSecret {
  try {
    const parsed = JSON.parse(jsonString);
    const data = parsed?.installed;
    if (
      !data ||
      typeof data.client_id !== "string" ||
      typeof data.client_secret !== "string" ||
      !data.client_id.trim() ||
      !data.client_secret.trim()
    )
      return {};
    return {
      clientId: typeof data.client_id === "string" ? data.client_id.trim() : undefined,
      clientSecret: typeof data.client_secret === "string" ? data.client_secret.trim() : undefined,
      projectId: typeof data.project_id === "string" ? data.project_id.trim() : undefined,
    };
  } catch {
    return {};
  }
}

export async function startGoogleOAuthFlow(
  clientId: string,
  scope: string,
  signal?: AbortSignal,
): Promise<GoogleOAuthResult> {
  const sessionId = crypto.randomUUID();
  const checkCancelled = () => {
    if (signal?.aborted) throw new Error("Google authorization was cancelled.");
  };
  const cancel = () => {
    void invoke("cancel_google_oauth_listener", { sessionId }).catch(() => {});
  };
  checkCancelled();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const codeVerifier = generateRandomString(64);
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateRandomString(32);
    checkCancelled();
    // Bind before opening the browser; each attempt owns its loopback port.
    const listenerPort = await invoke<number>("start_google_oauth_listener", { sessionId });
    checkCancelled();
    const callbackUri = `http://127.0.0.1:${listenerPort}/oauth/callback`;
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUri,
      response_type: "code",
      scope,
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }).toString();
    if (!(await openExternalUrl(authUrl.toString()))) {
      throw new Error("Could not open your browser. Check your default browser and try again.");
    }
    checkCancelled();
    const callback = await invoke<{ code: string }>("wait_google_oauth_callback", { sessionId, expectedState: state });
    checkCancelled();
    if (!callback.code) throw new Error("No authorization code received from Google.");
    const tokenResult = await invoke<GoogleTokenResult>("google_exchange_token", {
      clientId,
      code: callback.code,
      codeVerifier,
      redirectUri: callbackUri,
    });
    checkCancelled();
    if (tokenResult.error) throw new Error(tokenResult.error_description || tokenResult.error);
    if (!tokenResult.access_token) throw new Error("No access token returned from Google.");
    return {
      accessToken: tokenResult.access_token,
      refreshToken: tokenResult.refresh_token,
      expiresIn: tokenResult.expires_in,
      scope: validateGoogleScopes(scope, tokenResult.scope),
    };
  } finally {
    signal?.removeEventListener("abort", cancel);
    await invoke("cancel_google_oauth_listener", { sessionId });
  }
}

export interface GoogleMcpGrantReference {
  grantId: string;
}

export async function saveGoogleMcpTokens(
  clientId: string,
  accessToken: string,
  refreshToken?: string,
  expiresIn?: number,
  scope?: string,
): Promise<GoogleMcpGrantReference> {
  return invoke<GoogleMcpGrantReference>("save_google_mcp_tokens", {
    clientId,
    accessToken,
    refreshToken,
    expiresIn,
    scope,
  });
}

export function buildGoogleMcpEnvironment(
  pluginId: string,
  reference: GoogleMcpGrantReference,
): Record<string, string> {
  if (pluginId === "gmail")
    return { SYTHORIA_GOOGLE_OAUTH_GRANT: reference.grantId, SYTHORIA_GOOGLE_OAUTH_KIND: "gmail" };
  if (pluginId === "google-drive" || pluginId === "google-calendar") {
    return { SYTHORIA_GOOGLE_OAUTH_GRANT: reference.grantId, SYTHORIA_GOOGLE_OAUTH_KIND: "workspace" };
  }
  throw new Error("Unsupported Google plugin");
}

export interface GoogleClientStatus {
  clientId: string;
}
export function getGoogleOAuthClient(): Promise<GoogleClientStatus | null> {
  return invoke("get_google_oauth_client");
}
export function saveGoogleOAuthClient(clientId: string, clientSecret: string): Promise<void> {
  return invoke("save_google_oauth_client", { clientId, clientSecret });
}
