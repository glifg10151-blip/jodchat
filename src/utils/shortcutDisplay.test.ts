import { describe, expect, it } from "vitest";
import { formatShortcut, getShortcutDisplayParts } from "./shortcutDisplay";

describe("shortcut display", () => {
  it("keeps Windows shortcut labels unchanged", () => {
    expect(formatShortcut("Ctrl+Win+Alt+K", "windows")).toBe("Ctrl+Win+Alt+K");
  });

  it("uses Super for the Windows key on Linux", () => {
    expect(formatShortcut("Ctrl+Win+Shift+K", "linux")).toBe("Ctrl+Super+Shift+K");
  });

  it("uses native modifier symbols on macOS", () => {
    expect(getShortcutDisplayParts("Ctrl+Alt+Shift+K", "macos")).toEqual(["⌘", "⌥", "⇧", "K"]);
    expect(formatShortcut("Control+K", "macos")).toBe("⌃+K");
  });
});
