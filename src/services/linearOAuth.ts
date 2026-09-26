import { invoke } from "@tauri-apps/api/core";
import { openExternalUrl } from "../utils/externalUrl";

export const DEFAULT_LINEAR_CLIENT_ID = "4c8cf80a34931c6e5b6338c9df74f1f8";
export const DEFAULT_LINEAR_SCOPES = "read,write,issues:create";
export const DEFAULT_LINEAR_PORT = 54321;
export const DEFAULT_LINEAR_REDIRECT_URI = `http://localhost:${DEFAULT_LINEAR_PORT}/oauth/callback`;

export interface LinearTokenResult {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  scope?: unknown;
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
 * Initiates the 1-Click Linear OAuth 2.0 PKCE Flow.
 * 1. Generates PKCE code_verifier and code_challenge.
 * 2. Starts a local loopback listener on port 54321.
 * 3. Opens the user's browser to Linear authorization page.
 * 4. Captures the authorization code on loopback redirect.
 * 5. Exchanges the code for an API access token securely.
 */
export async function startLinearOAuthFlow(
  clientId: string = DEFAULT_LINEAR_CLIENT_ID,
  scope: string = DEFAULT_LINEAR_SCOPES,
  redirectUri: string = DEFAULT_LINEAR_REDIRECT_URI,
  port: number = DEFAULT_LINEAR_PORT,
  signal?: AbortSignal,
): Promise<string> {
  const codeVerifier = generateRandomString(64);
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateRandomString(32);

  const authUrl = `https://linear.app/oauth/authorize?client_id=${encodeURIComponent(
    clientId,
  )}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(
    scope,
  )}&state=${encodeURIComponent(state)}&code_challenge=${encodeURIComponent(
    codeChallenge,
  )}&code_challenge_method=S256&prompt=consent`;

  // Start background loopback listener
  const listenerPromise = invoke<{ code: string; state?: string }>("listen_oauth_callback", {
    port,
    expectedState: state,
  });

  // Open user's default browser to Linear
  await openExternalUrl(authUrl);

  // Wait for callback or abort signal
  const callbackResult = await Promise.race([
    listenerPromise,
    new Promise<{ code: string; state?: string }>((_, reject) => {
      if (signal) {
        signal.addEventListener("abort", () => reject(new Error("Linear authorization was cancelled.")), {
          once: true,
        });
      }
    }),
  ]);

  if (!callbackResult.code) {
    throw new Error("No authorization code received from Linear callback.");
  }

  // Exchange code + codeVerifier for access_token
  const tokenResult = await invoke<LinearTokenResult>("linear_exchange_token", {
    clientId,
    code: callbackResult.code,
    codeVerifier,
    redirectUri,
  });

  if (tokenResult.error) {
    throw new Error(tokenResult.error_description || tokenResult.error || "Failed to exchange token with Linear.");
  }

  if (!tokenResult.access_token) {
    throw new Error("No access token returned from Linear OAuth exchange.");
  }

  return tokenResult.access_token;
}
