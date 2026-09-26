export type ShortcutPlatform = "windows" | "linux" | "macos";

export function getShortcutPlatform(): ShortcutPlatform {
  if (typeof window === "undefined") return "windows";

  const platformHint = `${window.navigator.userAgent} ${window.navigator.platform}`.toLowerCase();
  if (platformHint.includes("mac")) return "macos";
  if (platformHint.includes("linux")) return "linux";
  return "windows";
}

function formatShortcutPart(part: string, platform: ShortcutPlatform): string {
  if (platform === "windows") return part;

  const normalizedPart = part.toLowerCase();

  if (platform === "linux") {
    return ["win", "windows", "meta", "command", "cmd"].includes(normalizedPart) ? "Super" : part;
  }

  if (["ctrl", "command", "cmd", "win", "windows", "meta", "super"].includes(normalizedPart)) {
    return "⌘";
  }
  if (normalizedPart === "alt" || normalizedPart === "option") return "⌥";
  if (normalizedPart === "control") return "⌃";
  if (normalizedPart === "shift") return "⇧";
  return part;
}

export function getShortcutDisplayParts(
  shortcut: string,
  platform: ShortcutPlatform = getShortcutPlatform(),
): string[] {
  return shortcut.split("+").map((part) => formatShortcutPart(part, platform));
}

export function formatShortcut(shortcut: string, platform: ShortcutPlatform = getShortcutPlatform()): string {
  return getShortcutDisplayParts(shortcut, platform).join("+");
}
