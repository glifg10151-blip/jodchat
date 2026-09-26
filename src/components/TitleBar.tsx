import { useState, useRef, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { COMMAND_REGISTRY, type CommandId, useKeybindStore } from "../store/useKeybindStore";
import { useUIStore } from "../store/useUIStore";
import { useAppVersion } from "../hooks/useAppVersion";
import { executeCommand } from "../services/commandDispatcher";
import { formatShortcut } from "../utils/shortcutDisplay";

type MenuId = "sythoria" | "file" | "view" | "window";
type MenuType = MenuId | null;

const MenuButton = ({
  id,
  label,
  activeMenu,
  handleMenuClick,
}: {
  id: MenuId;
  label: string;
  activeMenu: MenuType;
  handleMenuClick: (menu: MenuType) => void;
}) => (
  <button
    type="button"
    role="menuitem"
    onClick={() => handleMenuClick(id)}
    aria-haspopup="menu"
    aria-expanded={activeMenu === id}
    aria-controls={activeMenu === id ? `titlebar-menu-${id}` : undefined}
    data-menu-trigger={id}
    className={`menu-trigger px-2 py-1 rounded-md transition-colors ${
      activeMenu === id ? "bg-hover text-text-primary" : "hover:bg-hover hover:text-text-primary"
    }`}
  >
    {label}
  </button>
);

const DropdownItem = ({
  label,
  shortcut,
  onClick,
  setActiveMenu,
}: {
  label: string;
  shortcut?: string;
  onClick?: () => void;
  setActiveMenu: (menu: MenuType) => void;
}) => (
  <button
    type="button"
    role="menuitem"
    onClick={() => {
      onClick?.();
      setActiveMenu(null);
    }}
    className="w-full text-left px-3 py-1.5 text-sm hover:bg-hover text-text-secondary hover:text-text-primary transition-colors flex justify-between items-center gap-4"
  >
    <span className="whitespace-nowrap">{label}</span>
    {shortcut && (
      <span className="shrink-0 whitespace-nowrap text-text-muted text-xs">{formatShortcut(shortcut)}</span>
    )}
  </button>
);

export function TitleBar() {
  const isMac = typeof window !== "undefined" && window.navigator.userAgent.includes("Mac");
  const isWindows = typeof window !== "undefined" && window.navigator.userAgent.includes("Windows");

  const appWindow = getCurrentWindow();
  const appVersion = useAppVersion();
  const [activeMenu, setActiveMenu] = useState<MenuType>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const keybinds = useKeybindStore((state) => state.keybinds);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const hasDraggedRef = useRef(false);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setActiveMenu(null);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setActiveMenu(null);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  useEffect(() => {
    let fallbackTimer = 0;
    const root = document.documentElement;

    function finishWindowDrag() {
      window.clearTimeout(fallbackTimer);
      if (isWindows) {
        root.classList.remove("window-dragging");
      }
      pointerStartRef.current = null;
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      if (!event.target.closest("[data-tauri-drag-region]")) return;
      if (event.target.closest("button, a, input, select, textarea, [role='menuitem'], [role='menu']")) return;

      pointerStartRef.current = { x: event.clientX, y: event.clientY };
      hasDraggedRef.current = false;

      if (isWindows) {
        root.classList.add("window-dragging");
      }
      window.clearTimeout(fallbackTimer);
      fallbackTimer = window.setTimeout(finishWindowDrag, 10_000);
    }

    function handlePointerMove(event: PointerEvent) {
      if (!pointerStartRef.current) return;
      const dx = Math.abs(event.clientX - pointerStartRef.current.x);
      const dy = Math.abs(event.clientY - pointerStartRef.current.y);
      if (dx > 5 || dy > 5) {
        hasDraggedRef.current = true;
      }
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerup", finishWindowDrag, true);
    window.addEventListener("pointercancel", finishWindowDrag, true);
    window.addEventListener("blur", finishWindowDrag);

    return () => {
      finishWindowDrag();
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", finishWindowDrag, true);
      window.removeEventListener("pointercancel", finishWindowDrag, true);
      window.removeEventListener("blur", finishWindowDrag);
    };
  }, [isWindows]);

  const handleMenuClick = (menu: MenuType) => {
    setActiveMenu(activeMenu === menu ? null : menu);
  };

  const commandMenuProps = (commandId: CommandId) => ({
    label: COMMAND_REGISTRY[commandId].label,
    shortcut: keybinds?.[commandId]?.currentCombo ?? COMMAND_REGISTRY[commandId].currentCombo,
    onClick: () => void executeCommand(commandId),
  });

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const menuIds: MenuId[] = ["sythoria", "file", "view", "window"];
    const triggers = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[data-menu-trigger]") ?? []);
    const activeTriggerIndex = triggers.findIndex((trigger) => trigger === document.activeElement);
    const currentIndex =
      activeTriggerIndex >= 0 ? activeTriggerIndex : Math.max(0, menuIds.indexOf(activeMenu ?? "sythoria"));
    const dropdown = menuRef.current?.querySelector<HTMLElement>("[role='menu']");
    const items = Array.from(dropdown?.querySelectorAll<HTMLButtonElement>("button[role='menuitem']") ?? []);
    const itemIndex = items.findIndex((item) => item === document.activeElement);

    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (currentIndex + delta + triggers.length) % triggers.length;
      triggers[nextIndex]?.focus();
      if (activeMenu) setActiveMenu(menuIds[nextIndex]);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      triggers[event.key === "Home" ? 0 : triggers.length - 1]?.focus();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (activeTriggerIndex >= 0) {
        setActiveMenu(menuIds[activeTriggerIndex]);
        requestAnimationFrame(() => {
          const nextItems = menuRef.current?.querySelectorAll<HTMLButtonElement>(
            "[role='menu'] button[role='menuitem']",
          );
          nextItems?.[event.key === "ArrowDown" ? 0 : nextItems.length - 1]?.focus();
        });
      } else if (items.length > 0) {
        const delta = event.key === "ArrowDown" ? 1 : -1;
        items[(itemIndex + delta + items.length) % items.length]?.focus();
      }
    }
  };

  if (isMac) return null;

  return (
    <div
      data-tauri-drag-region
      onDoubleClick={(event) => {
        if (event.button !== 0) return;
        if (!(event.target instanceof Element)) return;
        if (event.target.closest("button, a, input, select, textarea, [role='menuitem'], [role='menu']")) return;
        if (hasDraggedRef.current) {
          hasDraggedRef.current = false;
          return;
        }
        void appWindow.toggleMaximize();
      }}
      className="h-[32px] w-full flex justify-between items-center select-none shrink-0 border-b border-border/30 bg-surface z-50 relative"
    >
      <div
        ref={menuRef}
        className="flex items-center h-full px-2 text-xs font-medium text-text-muted relative"
        role="menubar"
        tabIndex={-1}
        aria-label="Application menu"
        onKeyDown={handleMenuKeyDown}
      >
        <MenuButton id="sythoria" label="Sythoria" activeMenu={activeMenu} handleMenuClick={handleMenuClick} />
        <MenuButton id="file" label="File" activeMenu={activeMenu} handleMenuClick={handleMenuClick} />
        <MenuButton id="view" label="View" activeMenu={activeMenu} handleMenuClick={handleMenuClick} />
        <MenuButton id="window" label="Window" activeMenu={activeMenu} handleMenuClick={handleMenuClick} />

        {activeMenu === "sythoria" && (
          <div
            id="titlebar-menu-sythoria"
            className="popup-surface absolute top-[32px] left-2 w-48 border border-border/30 rounded-md shadow-lg py-1 flex flex-col z-50"
            role="menu"
            aria-label="Sythoria"
          >
            <div role="presentation" className="px-3 py-1.5 text-sm text-text-muted">
              {appVersion ? `Version ${appVersion}` : "Version unavailable"}
            </div>
            <DropdownItem
              label="Check for Updates"
              onClick={() => void useUIStore.getState().checkForUpdates(false)}
              setActiveMenu={setActiveMenu}
            />
          </div>
        )}

        {activeMenu === "file" && (
          <div
            id="titlebar-menu-file"
            className="popup-surface absolute top-[32px] left-[70px] w-56 border border-border/30 rounded-md shadow-lg py-1 flex flex-col z-50"
            role="menu"
            aria-label="File"
          >
            <DropdownItem {...commandMenuProps("newChat")} setActiveMenu={setActiveMenu} />
            <DropdownItem
              label="Create Project"
              onClick={() => {
                useUIStore.getState().setView("settings");
                useUIStore.getState().setActiveSection("projects");
              }}
              setActiveMenu={setActiveMenu}
            />
            <DropdownItem {...commandMenuProps("commandPalette")} setActiveMenu={setActiveMenu} />
          </div>
        )}

        {activeMenu === "view" && (
          <div
            id="titlebar-menu-view"
            className="popup-surface absolute top-[32px] left-[110px] w-48 border border-border/30 rounded-md shadow-lg py-1 flex flex-col z-50"
            role="menu"
            aria-label="View"
          >
            <DropdownItem {...commandMenuProps("zoomIn")} setActiveMenu={setActiveMenu} />
            <DropdownItem {...commandMenuProps("zoomOut")} setActiveMenu={setActiveMenu} />
            <DropdownItem {...commandMenuProps("zoomReset")} setActiveMenu={setActiveMenu} />
          </div>
        )}

        {activeMenu === "window" && (
          <div
            id="titlebar-menu-window"
            className="popup-surface absolute top-[32px] left-[150px] w-48 border border-border/30 rounded-md shadow-lg py-1 flex flex-col z-50"
            role="menu"
            aria-label="Window"
          >
            <DropdownItem label="Minimize" onClick={() => appWindow.minimize()} setActiveMenu={setActiveMenu} />
            <DropdownItem label="Maximize" onClick={() => appWindow.toggleMaximize()} setActiveMenu={setActiveMenu} />
            <DropdownItem label="Close" onClick={() => appWindow.close()} setActiveMenu={setActiveMenu} />
          </div>
        )}
      </div>

      <div className="flex h-full z-50 relative">
        <button
          type="button"
          onClick={() => appWindow.minimize()}
          className="inline-flex justify-center items-center w-11 h-full hover:bg-hover text-text-muted hover:text-text-primary transition-colors cursor-default"
          aria-label="Minimize window"
          title="Minimize"
        >
          <Minus size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => appWindow.toggleMaximize()}
          className="inline-flex justify-center items-center w-11 h-full hover:bg-hover text-text-muted hover:text-text-primary transition-colors cursor-default"
          aria-label="Maximize window"
          title="Maximize"
        >
          <Square size={13} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => appWindow.close()}
          className="inline-flex justify-center items-center w-11 h-full hover:bg-red-500 hover:text-white text-text-muted transition-colors cursor-default"
          aria-label="Close window"
          title="Close"
        >
          <X size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
