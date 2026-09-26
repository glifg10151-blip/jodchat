import React, { useCallback, useId, useState, useRef } from "react";
import { Search, Command, Settings } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { motionTransitions } from "../lib/motion-tokens";
import { useUIStore } from "../store/useUIStore";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { useShallow } from "zustand/react/shallow";

interface SettingItem {
  id: string;
  label: string;
  section: string;
  keywords: string[];
}

const SETTINGS_ITEMS: SettingItem[] = [
  {
    id: "general",
    label: "General Settings",
    section: "general",
    keywords: ["system", "startup", "language", "tray", "text size", "updates"],
  },
  {
    id: "appearance",
    label: "Appearance & Theme",
    section: "appearance",
    keywords: ["theme", "dark mode", "light mode", "animations", "colors"],
  },
  {
    id: "marketplace",
    label: "Theme Marketplace",
    section: "marketplace",
    keywords: ["themes", "download", "styles", "vscode"],
  },
  {
    id: "configuration",
    label: "Chat Configuration",
    section: "configuration",
    keywords: ["temperature", "max tools", "defaults"],
  },
  {
    id: "personalization",
    label: "Personalization",
    section: "personalization",
    keywords: ["title generation", "auto title"],
  },
  {
    id: "models",
    label: "AI Models & API Keys",
    section: "models",
    keywords: ["openai", "anthropic", "local", "api keys", "providers", "ollama"],
  },
  {
    id: "browser",
    label: "Browser & Web Search",
    section: "browser",
    keywords: ["google", "searxng", "web search", "fetch url"],
  },
  { id: "mcp", label: "MCP Servers", section: "mcp", keywords: ["tools", "plugins", "mcp config", "stdio", "sse"] },
  { id: "logs", label: "System Logs", section: "logs", keywords: ["debug", "console", "errors", "system logs"] },
  { id: "keybinds", label: "Keyboard Shortcuts", section: "keybinds", keywords: ["shortcuts", "keyboard", "hotkeys"] },
  {
    id: "projects",
    label: "Project Workspaces",
    section: "projects",
    keywords: ["workspaces", "git", "directories", "codebase"],
  },
  {
    id: "appshots",
    label: "Appshots (Screenshots)",
    section: "appshots",
    keywords: ["screenshots", "capture", "screen recording"],
  },
  {
    id: "privacy",
    label: "Privacy & Network",
    section: "privacy",
    keywords: ["offline", "ssl", "blocked hosts", "security"],
  },
  {
    id: "whisper",
    label: "Whisper Voice",
    section: "whisper",
    keywords: ["audio", "speech", "transcription", "microphone", "voice"],
  },
  { id: "skills", label: "Custom Skills", section: "skills", keywords: ["customization", "rules", "instructions"] },
];

export function SpotlightArea() {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const { showSpotlight, setShowSpotlight, setView, setActiveSection } = useUIStore(
    useShallow((state) => ({
      showSpotlight: state.showSpotlight,
      setShowSpotlight: state.setShowSpotlight,
      setView: state.setView,
      setActiveSection: state.setActiveSection,
    })),
  );
  const handleClose = useCallback(() => {
    setQuery("");
    setSelectedIndex(0);
    setShowSpotlight(false);
  }, [setShowSpotlight]);
  useDialogFocus({
    isOpen: showSpotlight,
    onClose: handleClose,
    containerRef: dialogRef,
    initialFocusRef: inputRef,
  });

  const filteredItems = SETTINGS_ITEMS.filter((item) => {
    const q = query.toLowerCase();
    return item.label.toLowerCase().includes(q) || item.keywords.some((k) => k.includes(q));
  });

  const executeAction = (section: string) => {
    handleClose();
    setView("settings");
    setActiveSection(section);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filteredItems.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredItems.length > 0) {
        executeAction(filteredItems[selectedIndex].section);
      }
    }
  };

  return (
    <AnimatePresence>
      {showSpotlight && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: motionTransitions.modalExit }}
          transition={motionTransitions.modalEnter}
          className="fixed inset-0 z-[9999] bg-overlay flex justify-center items-start pt-[20vh] backdrop-blur-sm"
          onClick={handleClose}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <motion.div
            ref={dialogRef}
            tabIndex={-1}
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98, transition: motionTransitions.modalExit }}
            transition={motionTransitions.modalEnter}
            className="popup-surface w-full max-w-2xl border border-border/50 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleKeyDown}
          >
            <h2 id={titleId} className="sr-only">
              Search settings
            </h2>
            <div className="w-full flex items-center gap-3 px-4 py-3 bg-chat border-b border-border/30">
              <Search size={22} className="text-text-muted shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelectedIndex(0);
                }}
                placeholder="Search settings..."
                className="flex-1 bg-transparent border-none text-text-primary placeholder-text-muted text-lg font-medium outline-none"
                aria-label="Search settings"
              />
              <span className="shrink-0 flex items-center gap-1 text-xs text-text-muted">
                <Command size={12} />
                <span>Esc to close</span>
              </span>
            </div>

            <div className="max-h-[350px] overflow-y-auto p-2">
              {filteredItems.length === 0 ? (
                <div className="py-8 text-center text-sm text-text-muted">No settings found for "{query}".</div>
              ) : (
                filteredItems.map((item, idx) => (
                  <button
                    key={item.id}
                    onClick={() => executeAction(item.section)}
                    className={`w-full flex items-center gap-4 px-4 py-3 rounded-xl text-sm transition-colors text-left ${
                      idx === selectedIndex ? "bg-hover text-text-primary" : "text-text-secondary hover:bg-hover/50"
                    }`}
                  >
                    <div
                      className={`p-2 rounded-lg ${idx === selectedIndex ? "bg-accent/15 text-accent" : "bg-surface-raised text-text-muted"}`}
                    >
                      <Settings size={18} />
                    </div>
                    <div className="flex flex-col">
                      <span className="font-semibold">{item.label}</span>
                      <span className="text-xs text-text-muted/80">{item.keywords.slice(0, 4).join(", ")}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
