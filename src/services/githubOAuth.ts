import { invoke } from "@tauri-apps/api/core";

export const DEFAULT_GITHUB_CLIENT_ID = "Ov23liEBjp5NydEwaPFX";

export interface GitHubDeviceCodeResult {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface GitHubDeviceTokenResult {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

/**
 * Initiates the GitHub Device Authorization Flow (Zero secrets required on client).
 */
export async function startGitHubDeviceFlow(
  clientId: string = DEFAULT_GITHUB_CLIENT_ID,
  scope = "repo,read:user,workflow",
): Promise<GitHubDeviceCodeResult> {
  return await invoke<GitHubDeviceCodeResult>("github_start_device_flow", {
    clientId,
    scope,
  });
}

/**
 * Polls GitHub until the user approves or rejects authorization in their browser.
 */
export async function pollGitHubDeviceToken(
  deviceCode: string,
  clientId: string = DEFAULT_GITHUB_CLIENT_ID,
  initialInterval = 5,
  signal?: AbortSignal,
): Promise<string> {
  let interval = Math.max(initialInterval, 5);
  const startTime = Date.now();
  const maxDurationMs = 15 * 60 * 1000; // 15 minutes

  while (Date.now() - startTime < maxDurationMs) {
    if (signal?.aborted) {
      throw new Error("GitHub authorization was cancelled.");
    }

    // Wait interval
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, interval * 1000);
      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new Error("GitHub authorization was cancelled."));
          },
          { once: true },
        );
      }
    });

    if (signal?.aborted) {
      throw new Error("GitHub authorization was cancelled.");
    }

    const response = await invoke<GitHubDeviceTokenResult>("github_poll_device_token", {
      clientId,
      deviceCode,
    });

    if (response.access_token) {
      return response.access_token;
    }

    if (response.error) {
      switch (response.error) {
        case "authorization_pending":
          // Continue polling
          break;
        case "slow_down":
          // Increase polling interval by 5s as per RFC 8628
          interval += 5;
          break;
        case "expired_token":
          throw new Error("The device code has expired. Please try connecting again.");
        case "access_denied":
          throw new Error("Access was denied in browser.");
        default:
          throw new Error(response.error_description || response.error || "Authorization failed.");
      }
    }
  }

  throw new Error("GitHub authorization timed out. Please try again.");
}
