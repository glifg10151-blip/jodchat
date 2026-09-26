import type { CommandId } from "../store/useKeybindStore";
import { useKeybindStore } from "../store/useKeybindStore";
import { useChatStore } from "../store/useChatStore";
import { useUIStore } from "../store/useUIStore";
import { useAppshotStore } from "../store/useAppshotStore";

export interface CommandExecutionContext {
  toggleCompareMode?: () => void;
  scrollToBottom?: () => void;
}

function focusAfterRender(elementId: string): void {
  window.setTimeout(() => document.getElementById(elementId)?.focus(), 50);
}

export function executeCommand(commandId: CommandId, context: CommandExecutionContext = {}): boolean {
  const chat = useChatStore.getState();
  const ui = useUIStore.getState();

  switch (commandId) {
    case "openSearch":
      ui.setView("chat");
      ui.setSidebarOpen(true);
      if (ui.sidebarCollapsed) ui.toggleSidebarCollapsed();
      focusAfterRender("sidebar-search");
      return true;
    case "focusInput":
      document.getElementById("chat-input")?.focus();
      return true;
    case "newChat":
      chat.newChat();
      ui.setView("chat");
      focusAfterRender("chat-input");
      return true;
    case "captureAppshot":
      void useAppshotStore.getState().captureAndAttachToChat({ skipConfirmation: true, revealChat: true });
      return true;
    case "goBack":
      if (chat.navigationIndex <= 0) return false;
      chat.navigateBack();
      return true;
    case "goForward":
      if (chat.navigationIndex >= chat.navigationHistory.length - 1) return false;
      chat.navigateForward();
      return true;
    case "openFilePicker":
      document.getElementById("file-input-element")?.click();
      return true;
    case "prevChat": {
      const index = chat.conversations.findIndex((conversation) => conversation.id === chat.activeId);
      if (index <= 0) return false;
      void chat.setActiveId(chat.conversations[index - 1].id);
      return true;
    }
    case "nextChat": {
      const index = chat.conversations.findIndex((conversation) => conversation.id === chat.activeId);
      if (index < 0 || index >= chat.conversations.length - 1) return false;
      void chat.setActiveId(chat.conversations[index + 1].id);
      return true;
    }
    case "openSettings":
      ui.setView("settings");
      return true;
    case "toggleModel":
      document.getElementById("model-selector-button")?.click();
      return true;
    case "toggleSidebar":
      ui.toggleSidebarCollapsed();
      return true;
    case "zoomIn":
      useKeybindStore.getState().zoomIn();
      return true;
    case "zoomOut":
      useKeybindStore.getState().zoomOut();
      return true;
    case "zoomReset":
      useKeybindStore.getState().zoomReset();
      return true;
    case "stopStreaming":
      if (!chat.isStreaming) return false;
      void chat.stopStreaming(chat.activeId ?? undefined);
      return true;
    case "toggleSearch": {
      const focusedComposer = document.activeElement?.closest(".chat-composer-dock");
      const searchInsert =
        focusedComposer?.querySelector<HTMLButtonElement>("[data-search-insert]") ??
        document.querySelector<HTMLButtonElement>(".chat-composer-dock [data-search-insert]");
      if (!searchInsert || searchInsert.disabled) return false;
      searchInsert.click();
      return true;
    }
    case "toggleCompareMode":
      context.toggleCompareMode?.();
      return Boolean(context.toggleCompareMode);
    case "retryMessage":
      if (!chat.activeId || chat.isStreaming) return false;
      void chat.retryLastMessage(chat.activeId);
      return true;
    case "deleteActiveChat":
      if (!chat.activeId || !window.confirm("Delete the active conversation? This cannot be undone.")) return false;
      void chat.deleteChat(chat.activeId);
      return true;
    case "scrollToBottom":
      context.scrollToBottom?.();
      return Boolean(context.scrollToBottom);
    case "toggleVoice":
      document.getElementById("voice-input-button")?.click();
      return true;
    case "toggleTheme": {
      const isDark = document.documentElement.classList.contains("dark");
      ui.setTheme({ ...ui.theme, mode: isDark ? "light" : "dark" });
      return true;
    }
    case "commandPalette":
      ui.toggleCommandPalette();
      return true;
    case "renameChat": {
      if (!chat.activeId) return false;
      const title = chat.conversations.find((conversation) => conversation.id === chat.activeId)?.title ?? "";
      ui.openRenameModal(chat.activeId, title);
      return true;
    }
    case "exportChat":
      if (!chat.activeId) return false;
      void chat.exportChat(chat.activeId);
      return true;
    case "togglePinChat":
      if (!chat.activeId) return false;
      chat.togglePinChat(chat.activeId);
      return true;
    case "openWorkspaces":
      ui.setView("settings");
      ui.setActiveSection("projects");
      return true;
    case "prevImage":
    case "nextImage":
      return false;
  }
}
