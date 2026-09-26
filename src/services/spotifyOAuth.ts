import { invoke } from "@tauri-apps/api/core";
import { openExternalUrl } from "../utils/externalUrl";

export const DEFAULT_SPOTIFY_CLIENT_ID = "65b708073fc0480ea92a077233ca87bd";
export const DEFAULT_SPOTIFY_SCOPES =
  "user-read-private user-read-email user-read-playback-state user-modify-playback-state user-read-currently-playing user-read-recently-played user-read-playback-position user-top-read user-library-read user-library-modify user-follow-read user-follow-modify playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private";
export const DEFAULT_SPOTIFY_PORT = 8888;
export const DEFAULT_SPOTIFY_REDIRECT_URI = `http://127.0.0.1:${DEFAULT_SPOTIFY_PORT}/callback`;

export interface SpotifyTokenResult {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

export interface SpotifyOAuthResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
}

export interface SpotifyMcpTokenPaths {
  tokenPath: string;
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
 * Initiates the 1-Click Spotify OAuth 2.0 PKCE Flow.
 * 1. Generates PKCE code_verifier and code_challenge.
 * 2. Starts a local loopback listener on port 8888 (standard for Spotify MCP).
 * 3. Opens user's browser to Spotify authorization consent page.
 * 4. Captures authorization code on loopback redirect.
 * 5. Exchanges code for Spotify OAuth access and refresh tokens without client secrets.
 */
export async function startSpotifyOAuthFlow(
  clientId: string = DEFAULT_SPOTIFY_CLIENT_ID,
  scope: string = DEFAULT_SPOTIFY_SCOPES,
  redirectUri: string = DEFAULT_SPOTIFY_REDIRECT_URI,
  port: number = DEFAULT_SPOTIFY_PORT,
  signal?: AbortSignal,
): Promise<SpotifyOAuthResult> {
  const codeVerifier = generateRandomString(64);
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateRandomString(32);

  const authUrl = `https://accounts.spotify.com/authorize?client_id=${encodeURIComponent(
    clientId,
  )}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(
    scope,
  )}&state=${encodeURIComponent(state)}&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=S256`;

  // Start background loopback listener
  const listenerPromise = invoke<{ code: string; state?: string }>("listen_oauth_callback", {
    port,
    expectedState: state,
  });

  // Open user's default browser to Spotify
  await openExternalUrl(authUrl);

  // Wait for callback or abort signal
  const callbackResult = await Promise.race([
    listenerPromise,
    new Promise<{ code: string; state?: string }>((_, reject) => {
      if (signal) {
        signal.addEventListener("abort", () => reject(new Error("Spotify authorization was cancelled.")), {
          once: true,
        });
      }
    }),
  ]);

  if (!callbackResult.code) {
    throw new Error("No authorization code received from Spotify callback.");
  }

  // Exchange code + codeVerifier for access_token and refresh_token
  const tokenResult = await invoke<SpotifyTokenResult>("spotify_exchange_token", {
    clientId,
    code: callbackResult.code,
    codeVerifier,
    redirectUri,
  });

  if (tokenResult.error) {
    throw new Error(tokenResult.error_description || tokenResult.error || "Failed to exchange token with Spotify.");
  }

  if (!tokenResult.access_token) {
    throw new Error("No access token returned from Spotify OAuth exchange.");
  }

  return {
    accessToken: tokenResult.access_token,
    refreshToken: tokenResult.refresh_token,
    expiresIn: tokenResult.expires_in,
    scope: tokenResult.scope,
  };
}

/**
 * Saves Spotify OAuth tokens to ~/.spotify-mcp/tokens.json for the spotify-mcp server.
 */
export async function saveSpotifyMcpTokens(
  accessToken: string,
  refreshToken?: string,
  expiresIn?: number,
): Promise<SpotifyMcpTokenPaths> {
  return invoke<SpotifyMcpTokenPaths>("save_spotify_mcp_tokens", {
    accessToken,
    refreshToken,
    expiresIn,
  });
}
