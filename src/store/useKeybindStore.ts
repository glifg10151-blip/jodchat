import { create } from "zustand";
import { loadKeybinds, saveKeybinds, loadZoomLevel, saveZoomLevel, applyZoom, KeybindsData } from "../utils/storage";

export interface KeybindAction {
  id: string;
  label: string;
  category: "Recommended" | "Navigation" | "Conversation" | "Layout";
  description: string;
  defaultCombo: string;
  currentCombo: string;
  scope?: "global" | "modal" | "native";
}

export const COMMAND_REGISTRY = {
  openSearch: {
    id: "openSearch",
    label: "Open Conversation Picker",
    category: "Recommended",
    description: "Focuses the search box in the sidebar to find conversations",
    defaultCombo: "Ctrl+K",
    currentCombo: "Ctrl+K",
  },
  focusInput: {
    id: "focusInput",
    label: "Focus Chat Input",
    category: "Recommended",
    description: "Brings focus directly back to the message compose box",
    defaultCombo: "Ctrl+L",
    currentCombo: "Ctrl+L",
  },
  newChat: {
    id: "newChat",
    label: "New Conversation",
    category: "Recommended",
    description: "Clears the active session and creates a new conversation thread",
    defaultCombo: "Ctrl+N",
    currentCombo: "Ctrl+N",
  },
  captureAppshot: {
    id: "captureAppshot",
    label: "Capture Appshot",
    category: "Recommended",
    description: "Captures the frontmost application and attaches it to the current conversation",
    defaultCombo: "Alt+Shift+S",
    currentCombo: "Alt+Shift+S",
    scope: "native",
  },
  goBack: {
    id: "goBack",
    label: "Go Back",
    category: "Navigation",
    description: "Navigate backward in conversation history",
    defaultCombo: "Ctrl+[",
    currentCombo: "Ctrl+[",
  },
  goForward: {
    id: "goForward",
    label: "Go Forward",
    category: "Navigation",
    description: "Navigate forward in conversation history",
    defaultCombo: "Ctrl+]",
    currentCombo: "Ctrl+]",
  },
  openFilePicker: {
    id: "openFilePicker",
    label: "File Picker",
    category: "Navigation",
    description: "Open the file attachment dialog to upload files",
    defaultCombo: "Ctrl+P",
    currentCombo: "Ctrl+P",
  },
  prevChat: {
    id: "prevChat",
    label: "Select Previous Conversation",
    category: "Navigation",
    description: "Select the conversation directly above in the sidebar list",
    defaultCombo: "Alt+ArrowUp",
    currentCombo: "Alt+ArrowUp",
  },
  nextChat: {
    id: "nextChat",
    label: "Select Next Conversation",
    category: "Navigation",
    description: "Select the conversation directly below in the sidebar list",
    defaultCombo: "Alt+ArrowDown",
    currentCombo: "Alt+ArrowDown",
  },
  openSettings: {
    id: "openSettings",
    label: "Open Settings",
    category: "Navigation",
    description: "Switch active view to the Settings dashboard",
    defaultCombo: "Ctrl+,",
    currentCombo: "Ctrl+,",
  },
  toggleModel: {
    id: "toggleModel",
    label: "Toggle Model Selector",
    category: "Conversation",
    description: "Open or close the active Model selector dropdown",
    defaultCombo: "Ctrl+/",
    currentCombo: "Ctrl+/",
  },
  toggleSidebar: {
    id: "toggleSidebar",
    label: "Toggle Sidebar",
    category: "Layout",
    description: "Collapse or expand the history sidebar panel",
    defaultCombo: "Ctrl+B",
    currentCombo: "Ctrl+B",
  },
  zoomIn: {
    id: "zoomIn",
    label: "Zoom In",
    category: "Layout",
    description: "Increase the scaling and font size of interface text and elements",
    defaultCombo: "Ctrl+=",
    currentCombo: "Ctrl+=",
  },
  zoomOut: {
    id: "zoomOut",
    label: "Zoom Out",
    category: "Layout",
    description: "Decrease the scaling and font size of interface text and elements",
    defaultCombo: "Ctrl+-",
    currentCombo: "Ctrl+-",
  },
  zoomReset: {
    id: "zoomReset",
    label: "Reset Zoom",
    category: "Layout",
    description: "Restore interface elements back to default size (100%)",
    defaultCombo: "Ctrl+0",
    currentCombo: "Ctrl+0",
  },
  prevImage: {
    id: "prevImage",
    label: "Previous Image",
    category: "Navigation",
    description: "Navigate to the previous image in the preview viewer",
    defaultCombo: "ArrowLeft",
    currentCombo: "ArrowLeft",
    scope: "modal",
  },
  nextImage: {
    id: "nextImage",
    label: "Next Image",
    category: "Navigation",
    description: "Navigate to the next image in the preview viewer",
    defaultCombo: "ArrowRight",
    currentCombo: "ArrowRight",
    scope: "modal",
  },
  stopStreaming: {
    id: "stopStreaming",
    label: "Stop Generation",
    category: "Conversation",
    description: "Stop the active AI generation stream",
    defaultCombo: "Escape",
    currentCombo: "Escape",
  },
  toggleSearch: {
    id: "toggleSearch",
    label: "Add Web Search",
    category: "Conversation",
    description: "Insert a Web Search chip into the next message",
    defaultCombo: "Ctrl+Shift+S",
    currentCombo: "Ctrl+Shift+S",
  },
  toggleCompareMode: {
    id: "toggleCompareMode",
    label: "Toggle Compare Mode",
    category: "Conversation",
    description: "Toggle side-by-side model comparison view",
    defaultCombo: "Ctrl+Shift+C",
    currentCombo: "Ctrl+Shift+C",
  },
  retryMessage: {
    id: "retryMessage",
    label: "Retry Last Message",
    category: "Conversation",
    description: "Regenerate the last assistant response",
    defaultCombo: "Ctrl+Shift+R",
    currentCombo: "Ctrl+Shift+R",
  },
  deleteActiveChat: {
    id: "deleteActiveChat",
    label: "Delete Active Chat",
    category: "Conversation",
    description: "Delete the currently active conversation",
    defaultCombo: "Ctrl+Shift+Backspace",
    currentCombo: "Ctrl+Shift+Backspace",
  },
  scrollToBottom: {
    id: "scrollToBottom",
    label: "Scroll to Bottom",
    category: "Navigation",
    description: "Scroll the chat area to the latest message",
    defaultCombo: "Ctrl+ArrowDown",
    currentCombo: "Ctrl+ArrowDown",
  },
  toggleVoice: {
    id: "toggleVoice",
    label: "Toggle Voice Input",
    category: "Conversation",
    description: "Start or stop voice recording for speech-to-text",
    defaultCombo: "Ctrl+Shift+V",
    currentCombo: "Ctrl+Shift+V",
  },
  toggleTheme: {
    id: "toggleTheme",
    label: "Toggle Theme",
    category: "Layout",
    description: "Switch between dark and light mode",
    defaultCombo: "Ctrl+Shift+T",
    currentCombo: "Ctrl+Shift+T",
  },
  commandPalette: {
    id: "commandPalette",
    label: "Command Palette",
    category: "Recommended",
    description: "Open the global command palette",
    defaultCombo: "Ctrl+Shift+P",
    currentCombo: "Ctrl+Shift+P",
  },
  renameChat: {
    id: "renameChat",
    label: "Rename Active Chat",
    category: "Conversation",
    description: "Rename the currently active conversation",
    defaultCombo: "F2",
    currentCombo: "F2",
  },
  exportChat: {
    id: "exportChat",
    label: "Export Active Chat",
    category: "Conversation",
    description: "Export the currently active conversation as markdown",
    defaultCombo: "Ctrl+E",
    currentCombo: "Ctrl+E",
  },
  togglePinChat: {
    id: "togglePinChat",
    label: "Toggle Pin Chat",
    category: "Conversation",
    description: "Pin or unpin the active conversation",
    defaultCombo: "Alt+P",
    currentCombo: "Alt+P",
  },
  openWorkspaces: {
    id: "openWorkspaces",
    label: "Open Workspaces",
    category: "Navigation",
    description: "Open the project workspaces settings",
    defaultCombo: "Ctrl+Shift+W",
    currentCombo: "Ctrl+Shift+W",
  },
} satisfies Record<string, KeybindAction>;

export type CommandId = keyof typeof COMMAND_REGISTRY;

export const DEFAULT_KEYBINDS: Record<string, KeybindAction> = Object.fromEntries(
  Object.entries(COMMAND_REGISTRY).map(([id, command]) => [id, { ...command }]),
);

export interface KeybindValidationResult {
  ok: boolean;
  error?: string;
}

const RESERVED_COMBOS = new Set(["CTRL+Q", "CTRL+R", "CTRL+T", "CTRL+W", "CTRL+TAB", "ALT+F4", "CTRL+ALT+DELETE"]);

function normalizedCombo(combo: string): string {
  return combo
    .split("+")
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean)
    .join("+");
}

export function validateKeycombo(
  actionId: string,
  combo: string,
  keybinds: Record<string, KeybindAction>,
): KeybindValidationResult {
  const parts = combo.split("+").filter(Boolean);
  const mainKey = parts.at(-1) ?? "";
  const modifiers = new Set(parts.slice(0, -1).map((part) => part.toLowerCase()));
  const hasCommandModifier = modifiers.has("ctrl") || modifiers.has("alt");
  const isPrintable = mainKey === "Space" || mainKey.length === 1;

  if (isPrintable && !hasCommandModifier) {
    return { ok: false, error: "Printable shortcuts require Ctrl/Cmd or Alt." };
  }
  if (RESERVED_COMBOS.has(normalizedCombo(combo))) {
    return { ok: false, error: "That shortcut is reserved by the operating system or application shell." };
  }

  const duplicate = Object.values(keybinds).find(
    (action) => action.id !== actionId && normalizedCombo(action.currentCombo) === normalizedCombo(combo),
  );
  if (duplicate) {
    return { ok: false, error: `Already assigned to ${duplicate.label}.` };
  }
  return { ok: true };
}

interface KeybindsState {
  keybinds: Record<string, KeybindAction>;
  zoomLevel: number;
  isRecording: string | null;
  validationError: string | null;

  setKeycombo: (actionId: string, combo: string) => KeybindValidationResult;
  resetKeycombo: (actionId: string) => KeybindValidationResult;
  resetAllKeybinds: () => void;

  setZoomLevel: (level: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;

  startRecording: (actionId: string) => void;
  stopRecording: () => void;
  initKeybinds: () => Promise<void>;
}

export const useKeybindStore = create<KeybindsState>((set, get) => ({
  keybinds: { ...DEFAULT_KEYBINDS },
  zoomLevel: 1.0,
  isRecording: null,
  validationError: null,

  setKeycombo: (actionId, combo) => {
    const state = get();
    if (!state.keybinds[actionId]) {
      const result = { ok: false, error: "Unknown command." };
      set({ validationError: result.error });
      return result;
    }
    const result = validateKeycombo(actionId, combo, state.keybinds);
    if (!result.ok) {
      set({ validationError: result.error ?? "Invalid shortcut." });
      return result;
    }
    set((state) => {
      const updatedKeybinds = {
        ...state.keybinds,
        [actionId]: {
          ...state.keybinds[actionId],
          currentCombo: combo,
        },
      };

      saveKeybinds(updatedKeybinds as KeybindsData);
      return { keybinds: updatedKeybinds, validationError: null };
    });
    return result;
  },

  resetKeycombo: (actionId) => {
    const state = get();
    const action = state.keybinds[actionId];
    if (!action) return { ok: false, error: "Unknown command." };
    const result = validateKeycombo(actionId, action.defaultCombo, state.keybinds);
    if (!result.ok) {
      set({ validationError: result.error ?? "Invalid shortcut." });
      return result;
    }
    set((state) => {
      const updatedKeybinds = {
        ...state.keybinds,
        [actionId]: {
          ...state.keybinds[actionId],
          currentCombo: state.keybinds[actionId].defaultCombo,
        },
      };
      saveKeybinds(updatedKeybinds as KeybindsData);
      return { keybinds: updatedKeybinds, validationError: null };
    });
    return result;
  },

  resetAllKeybinds: () => {
    const reset = { ...DEFAULT_KEYBINDS };
    saveKeybinds(reset as KeybindsData);
    set({ keybinds: reset });
  },

  setZoomLevel: (level) => {
    const clamped = Math.max(0.5, Math.min(2.0, level));
    applyZoom(clamped);
    saveZoomLevel(clamped);
    set({ zoomLevel: clamped });
  },

  zoomIn: () => {
    const next = Math.min(2.0, parseFloat((get().zoomLevel + 0.1).toFixed(2)));
    applyZoom(next);
    saveZoomLevel(next);
    set({ zoomLevel: next });
  },

  zoomOut: () => {
    const next = Math.max(0.5, parseFloat((get().zoomLevel - 0.1).toFixed(2)));
    applyZoom(next);
    saveZoomLevel(next);
    set({ zoomLevel: next });
  },

  zoomReset: () => {
    applyZoom(1.0);
    saveZoomLevel(1.0);
    set({ zoomLevel: 1.0 });
  },

  startRecording: (actionId) => set({ isRecording: actionId, validationError: null }),
  stopRecording: () => set({ isRecording: null }),

  initKeybinds: async () => {
    const zoom = await loadZoomLevel();
    applyZoom(zoom);

    const loaded = await loadKeybinds();
    if (loaded) {
      set((state) => {
        const merged = { ...state.keybinds };
        for (const [id, item] of Object.entries(loaded)) {
          if (merged[id]) {
            const validation = validateKeycombo(id, item.currentCombo, merged);
            if (validation.ok) merged[id] = { ...merged[id], currentCombo: item.currentCombo };
          }
        }
        return { keybinds: merged, zoomLevel: zoom };
      });
    } else {
      set({ zoomLevel: zoom });
    }
  },
}));

export function matchKeybind(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.split("+");
  const mainKey = parts[parts.length - 1].toUpperCase();

  const hasCtrl = parts.includes("Ctrl");
  const hasShift = parts.includes("Shift");
  const hasAlt = parts.includes("Alt");

  const isMac = typeof window !== "undefined" && window.navigator.userAgent.includes("Mac");

  // Ctrl match (maps Ctrl to Cmd on Mac)
  const ctrlMatched = hasCtrl ? (isMac ? e.metaKey : e.ctrlKey) : !(e.ctrlKey || (isMac && e.metaKey));

  // Alt match
  const altMatched = hasAlt ? e.altKey : !e.altKey;

  // For Shift match, be lenient if the main key is zoom-in symbols '=' or '+'
  const shiftMatched = mainKey === "=" || mainKey === "+" ? true : hasShift ? e.shiftKey : !e.shiftKey;

  // Key match
  const pressedKey = e.key.toUpperCase();
  const keyMatched =
    (mainKey === "=" || mainKey === "+") && (pressedKey === "=" || pressedKey === "+") ? true : pressedKey === mainKey;

  return ctrlMatched && altMatched && shiftMatched && keyMatched;
}

export function findMatchingCommand(
  event: KeyboardEvent,
  keybinds: Record<string, KeybindAction>,
  scope: NonNullable<KeybindAction["scope"]> = "global",
): CommandId | null {
  for (const command of Object.values(keybinds)) {
    if ((command.scope ?? "global") !== scope) continue;
    if (matchKeybind(event, command.currentCombo)) return command.id as CommandId;
  }
  return null;
}
