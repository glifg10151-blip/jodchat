import { openUrl } from "@tauri-apps/plugin-opener";

const ALLOWED_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);
export function normalizeExternalUrl(value: string): URL | null {
  if (
    !value ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  )
    return null;

  try {
    const parsed = new URL(value);
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol.toLowerCase())) return null;
    if (parsed.username || parsed.password) return null;
    if ((parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.hostname) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function openExternalUrl(value: string, options: { confirmInsecure?: boolean } = {}): Promise<boolean> {
  const parsed = normalizeExternalUrl(value);
  if (!parsed) {
    console.warn("Blocked invalid or disallowed external URL");
    return false;
  }

  if (
    options.confirmInsecure &&
    parsed.protocol !== "https:" &&
    !window.confirm(`Security warning: open this ${parsed.protocol.slice(0, -1)} link?\n\n${parsed.href}`)
  ) {
    return false;
  }

  try {
    await openUrl(parsed.href);
    return true;
  } catch (error) {
    console.error("Failed to open external URL:", error);
    return false;
  }
}
