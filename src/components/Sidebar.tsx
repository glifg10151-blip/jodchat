import {
  MessageSquarePlus,
  Settings,
  MessageSquare,
  X,
  Pencil,
  Trash2,
  Search,
  Download,
  MoreVertical,
  Folder,
  FolderPlus,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  Pin,
} from "lucide-react";
import { useMemo, useState, useCallback, useRef, useEffect, useLayoutEffect, useId, memo } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import type { Conversation } from "../types";
import { STATUS_COLORS } from "../types";
import type { ModelStatuses, ConnectionStatus } from "../types";
import { ConfirmModal } from "./ui/Modal";
import { useDebounce } from "../hooks/useDebounce";
import { COLLAPSED_SIDEBAR_WIDTH, DEFAULT_SIDEBAR_WIDTH } from "../config/constants";
import { useUIStore } from "../store/useUIStore";
import { useKeybindStore } from "../store/useKeybindStore";
import { useProjectStore } from "../store/useProjectStore";
import { SECTION_GROUPS, SectionId, SEARCHABLE_SETTINGS, SearchableSetting } from "./settings/types";
import { motionTransitions, springs } from "../lib/motion-tokens";
import { useTranslation } from "../utils/i18n";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { useShallow } from "zustand/react/shallow";

const categoryKeys: Record<string, string> = {
  Application: "category.application",
  "AI & Models": "category.aiModels",
  Integrations: "category.integrations",
  Developer: "category.developer",
};

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting\u2026",
  connected: "Connected",
  error: "Connection error",
};

const STATUS_KEYS: Record<ConnectionStatus, string> = {
  disconnected: "status.disconnected",
  connecting: "status.connecting",
  connected: "status.connected",
  error: "status.error",
};

const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 480;

function getResponsiveMaxSidebarWidth(viewportWidth = Number.POSITIVE_INFINITY) {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, viewportWidth - 480));
}

function clampSidebarWidth(width: number, viewportWidth = Number.POSITIVE_INFINITY) {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(getResponsiveMaxSidebarWidth(viewportWidth), width));
}

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onSettingsClick: () => void;
  onDeleteChat: (id: string) => void;
  onRenameChat: (id: string, newTitle: string) => void;
  onExportChat: (id: string) => void;
  onPinChat: (id: string) => void;
  isOpen: boolean;
  onClose: () => void;
  modelStatuses: ModelStatuses;
  isCollapsed: boolean;
  isMobile: boolean;
}

function groupConversations(conversations: Conversation[]) {
  const pinned: Conversation[] = [];
  const recents: Conversation[] = [];

  for (const conv of conversations) {
    if (conv.isPinned) {
      pinned.push(conv);
    } else {
      recents.push(conv);
    }
  }

  const groups: { label: string; items: Conversation[] }[] = [];
  if (pinned.length > 0) {
    groups.push({ label: "Pinned", items: pinned });
  }

  const hasAnyConversations = conversations.length > 0;
  if (recents.length > 0 || (pinned.length > 0 && hasAnyConversations)) {
    groups.push({ label: "Recents", items: recents });
  }
  return groups;
}

function getLatestMessageTimestamp(conversation: Conversation) {
  const latestMessage = conversation.messages.at(-1);
  const timestamp = latestMessage?.timestamp ?? conversation.timestamp;
  const time = new Date(timestamp).getTime();

  return Number.isNaN(time) ? 0 : time;
}

function sortConversationsByLatestMessage(conversations: Conversation[]) {
  return [...conversations].sort((left, right) => getLatestMessageTimestamp(right) - getLatestMessageTimestamp(left));
}

export default memo(function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  onSettingsClick,
  onDeleteChat,
  onRenameChat,
  onExportChat,
  onPinChat,
  isOpen,
  onClose,
  modelStatuses,
  isCollapsed,
  isMobile,
}: SidebarProps) {
  const view = useUIStore((s) => s.view);
  const isMac = typeof window !== "undefined" && window.navigator.userAgent.includes("Mac");
  const isWindows = typeof window !== "undefined" && window.navigator.userAgent.includes("Windows");
  const setView = useUIStore((s) => s.setView);
  const { t } = useTranslation();
  const activeSection = useUIStore((s) => s.activeSection) as SectionId;
  const setActiveSection = useUIStore((s) => s.setActiveSection);
  const openProjectConfigModal = useUIStore((s) => s.openProjectConfigModal);
  const addToast = useUIStore((s) => s.addToast);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const disableBgActivity = useUIStore((s) => s.disableBgActivity);

  const { projects, deleteProject, activeProjectId, setActiveProject, isProjectsEnabled } = useProjectStore(
    useShallow((state) => ({
      projects: state.projects,
      deleteProject: state.deleteProject,
      activeProjectId: state.activeProjectId,
      setActiveProject: state.setActiveProject,
      isProjectsEnabled: state.isProjectsEnabled,
    })),
  );
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);

  const toggleProject = (id: string) => {
    setExpandedProjects((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const zoomLevel = useKeybindStore((s) => s.zoomLevel);
  const [showZoom, setShowZoom] = useState(false);
  const prevZoom = useRef(zoomLevel);

  useEffect(() => {
    if (zoomLevel !== prevZoom.current) {
      prevZoom.current = zoomLevel;
      setShowZoom(true);
      const timer = setTimeout(() => {
        setShowZoom(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [zoomLevel]);

  const isSidebarCollapsed = isMobile ? !isOpen : isCollapsed;
  const previousSidebarStateRef = useRef({ isMobile, isSidebarCollapsed });
  const [sidebarMotionKey, setSidebarMotionKey] = useState("sidebar");
  const sidebarRef = useRef<HTMLElement>(null);
  const mobileSidebarTitleId = useId();
  useDialogFocus({
    isOpen: isMobile && isOpen,
    onClose,
    containerRef: sidebarRef,
  });
  const isDragging = useRef(false);
  const activeResizePointer = useRef<number | null>(null);
  const visualSidebarWidthRef = useRef(sidebarWidth);
  const [visualSidebarWidth, setVisualSidebarWidth] = useState(sidebarWidth);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (isDragging.current) return;
    visualSidebarWidthRef.current = sidebarWidth;
    setVisualSidebarWidth(sidebarWidth);
  }, [sidebarWidth]);

  useLayoutEffect(() => {
    const previous = previousSidebarStateRef.current;
    if (previous.isSidebarCollapsed && isSidebarCollapsed && previous.isMobile !== isMobile) {
      setSidebarMotionKey(`collapsed-${isMobile ? "mobile" : "desktop"}`);
    }
    previousSidebarStateRef.current = { isMobile, isSidebarCollapsed };
  }, [isMobile, isSidebarCollapsed]);

  const updateVisualSidebarWidth = useCallback((width: number) => {
    const nextWidth = Math.round(clampSidebarWidth(width, window.innerWidth));
    visualSidebarWidthRef.current = nextWidth;
    setVisualSidebarWidth(nextWidth);
  }, []);

  useEffect(() => {
    const fitSidebarToViewport = () => {
      if (window.innerWidth < 768) return;
      updateVisualSidebarWidth(visualSidebarWidthRef.current);
    };
    fitSidebarToViewport();
    window.addEventListener("resize", fitSidebarToViewport);
    return () => window.removeEventListener("resize", fitSidebarToViewport);
  }, [updateVisualSidebarWidth]);

  const stopResize = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;
    activeResizePointer.current = null;
    setIsResizing(false);
    document.documentElement.classList.remove("sidebar-resizing");
    document.documentElement.classList.remove("sidebar-translucency-suspended");
    setSidebarWidth(visualSidebarWidthRef.current);
  }, [setSidebarWidth]);

  const startResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      isDragging.current = true;
      activeResizePointer.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsResizing(true);
      document.documentElement.classList.add("sidebar-resizing");
      if (isWindows) {
        document.documentElement.classList.add("sidebar-translucency-suspended");
      }
    },
    [isWindows],
  );

  const resize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging.current || activeResizePointer.current !== event.pointerId) return;
      updateVisualSidebarWidth(event.clientX);
    },
    [updateVisualSidebarWidth],
  );

  const handleResizeEnd = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (activeResizePointer.current !== event.pointerId) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      stopResize();
    },
    [stopResize],
  );

  const handleResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      if (!direction && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      const step = event.shiftKey ? 24 : 8;
      const nextWidth =
        event.key === "Home"
          ? MIN_SIDEBAR_WIDTH
          : event.key === "End"
            ? MAX_SIDEBAR_WIDTH
            : visualSidebarWidthRef.current + direction * step;
      updateVisualSidebarWidth(nextWidth);
      setSidebarWidth(clampSidebarWidth(nextWidth, window.innerWidth));
    },
    [setSidebarWidth, updateVisualSidebarWidth],
  );

  const resetSidebarWidth = useCallback(() => {
    updateVisualSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
  }, [setSidebarWidth, updateVisualSidebarWidth]);

  useEffect(() => {
    if (!isResizing) return;
    window.addEventListener("blur", stopResize);
    return () => {
      window.removeEventListener("blur", stopResize);
    };
  }, [isResizing, stopResize]);

  useEffect(
    () => () => {
      document.documentElement.classList.remove("sidebar-resizing");
      document.documentElement.classList.remove("sidebar-translucency-suspended");
    },
    [],
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [settingsSearchQuery, setSettingsSearchQuery] = useState("");
  const [chatToDelete, setChatToDelete] = useState<string | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebounce(searchQuery);

  const filteredSectionGroups = useMemo(() => {
    const query = settingsSearchQuery.trim().toLowerCase();
    if (!query) return SECTION_GROUPS;

    return SECTION_GROUPS.map((group) => {
      const items = group.items.filter((item) => {
        const matchesLabel = item.label.toLowerCase().includes(query);
        const matchesCategory = group.category.toLowerCase().includes(query);
        const matchesTranslatedLabel = (t(`section.${item.id}`) || item.label).toLowerCase().includes(query);
        const matchesKeywords = item.keywords.some((keyword) => keyword.toLowerCase().includes(query));
        return matchesLabel || matchesCategory || matchesTranslatedLabel || matchesKeywords;
      });

      return {
        ...group,
        items,
      };
    }).filter((group) => group.items.length > 0);
  }, [settingsSearchQuery, t]);

  const filteredIndividualSettings = useMemo(() => {
    const query = settingsSearchQuery.trim().toLowerCase();
    if (!query) return [];

    return SEARCHABLE_SETTINGS.filter((setting) => {
      const matchesLabel = setting.label.toLowerCase().includes(query);
      const matchesDesc = setting.description?.toLowerCase().includes(query) ?? false;
      const matchesKeywords = setting.keywords.some((keyword) => keyword.toLowerCase().includes(query));
      return matchesLabel || matchesDesc || matchesKeywords;
    }).slice(0, 5);
  }, [settingsSearchQuery]);

  const handleSelectSetting = useCallback(
    (setting: SearchableSetting) => {
      setActiveSection(setting.sectionId);

      let attempts = 0;
      const findAndHighlight = () => {
        const el = document.getElementById(setting.id);
        if (el) {
          const reduceMotion =
            useUIStore.getState().animationsDisabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
          el.classList.add("setting-highlighted");
          setTimeout(() => {
            el.classList.remove("setting-highlighted");
          }, 2400);
        } else if (attempts < 8) {
          attempts++;
          setTimeout(findAndHighlight, 50);
        }
      };

      setTimeout(findAndHighlight, 50);
    },
    [setActiveSection],
  );

  const searchRef = useRef<HTMLInputElement>(null);

  const nonEmptyConversations = useMemo(
    () =>
      sortConversationsByLatestMessage(
        conversations.filter(
          (c) =>
            (c.messages.length > 0 || Boolean(c.pendingWorktree)) &&
            (!c.id.startsWith("compare-") || Boolean(c.pendingWorktree)) &&
            !c.isSubagent &&
            (!c.isTemporary || Boolean(c.pendingWorktree)),
        ),
      ),
    [conversations],
  );

  const filteredConversations = useMemo(() => {
    if (!debouncedQuery.trim()) return nonEmptyConversations;
    const query = debouncedQuery.toLowerCase();
    return nonEmptyConversations.filter(
      (conv) =>
        conv.title.toLowerCase().includes(query) || conv.messages.some((m) => m.content.toLowerCase().includes(query)),
    );
  }, [nonEmptyConversations, debouncedQuery]);

  const globalConversations = useMemo(() => {
    return filteredConversations.filter((c) => {
      if (!c.projectId) return true;
      if (!isProjectsEnabled) return true;
      const projectExists = projects.some((p) => p.id === c.projectId);
      return !projectExists;
    });
  }, [filteredConversations, isProjectsEnabled, projects]);

  const groups = useMemo(() => groupConversations(globalConversations), [globalConversations]);

  const projectConversations = useMemo(() => {
    const map: Record<string, typeof filteredConversations> = {};
    for (const conv of filteredConversations) {
      if (conv.projectId) {
        if (!map[conv.projectId]) map[conv.projectId] = [];
        map[conv.projectId].push(conv);
      }
    }
    return map;
  }, [filteredConversations]);

  const handleDeleteConfirm = useCallback(() => {
    if (chatToDelete) {
      onDeleteChat(chatToDelete);
      setChatToDelete(null);
    }
  }, [chatToDelete, onDeleteChat]);

  const handleDeleteProjectConfirm = useCallback(() => {
    if (projectToDelete) {
      if (
        conversations.some((conversation) => conversation.projectId === projectToDelete && conversation.pendingWorktree)
      ) {
        addToast("Apply or discard pending workspace changes before removing this project.", "error");
        setProjectToDelete(null);
        return;
      }
      deleteProject(projectToDelete);
      setProjectToDelete(null);
    }
  }, [projectToDelete, conversations, addToast, deleteProject]);

  useEffect(() => {
    if (openMenuId === null && !showProjectMenu) return;
    const handleOutsideAction = (e: Event) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) {
        setShowProjectMenu(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideAction);
    window.addEventListener("scroll", handleOutsideAction, true);
    return () => {
      document.removeEventListener("mousedown", handleOutsideAction);
      window.removeEventListener("scroll", handleOutsideAction, true);
    };
  }, [openMenuId, showProjectMenu]);

  const aggregateStatus: ConnectionStatus = useMemo(() => {
    const statuses = Object.values(modelStatuses);
    if (statuses.length === 0) return "disconnected";
    if (statuses.some((s) => s === "error")) return "error";
    if (statuses.some((s) => s === "connecting")) return "connecting";
    if (statuses.every((s) => s === "connected")) return "connected";
    return "disconnected";
  }, [modelStatuses]);

  const sidebarVariants = {
    expanded: {
      x: 0,
      opacity: 1,
      borderRightWidth: 1,
      ...(isMobile || isResizing ? {} : { width: visualSidebarWidth }),
      transition: {
        ...(isResizing ? { type: "tween" as const, duration: 0 } : springs.release),
        opacity: motionTransitions.popoverEnter,
      },
    },
    collapsed: {
      x: isMobile ? "-100%" : 0,
      opacity: isMobile ? 1 : 0,
      borderRightWidth: isMobile ? 1 : 0,
      ...(isMobile ? {} : { width: COLLAPSED_SIDEBAR_WIDTH }),
      transition: {
        ...(isResizing ? { type: "tween" as const, duration: 0 } : springs.release),
        opacity: motionTransitions.popoverExit,
      },
    },
  };

  const contentVariants = {
    expanded: { opacity: 1, x: 0, display: "flex" as const, flexDirection: "column" as const },
    collapsed: { opacity: 0, x: -8, display: "none" as const, flexDirection: "column" as const },
  };
  return (
    <>
      <AnimatePresence>
        {isMobile && isOpen && (
          <motion.div
            key="mobile-sidebar-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionTransitions.popoverEnter}
            className="absolute inset-0 z-30 backdrop-blur-md"
            style={{ backgroundColor: "var(--theme-overlay)" }}
            onClick={onClose}
            aria-hidden="true"
            data-dialog-backdrop
          />
        )}
      </AnimatePresence>

      {/* Avoid interpolating only between closed desktop and closed mobile states. */}
      <motion.aside
        key={sidebarMotionKey}
        ref={sidebarRef}
        tabIndex={isMobile ? -1 : undefined}
        className={`${
          isMobile ? "absolute inset-y-0 left-0" : "relative"
        } z-40 h-full flex flex-col overflow-hidden glass-sidebar border-r border-border`}
        initial={isSidebarCollapsed ? "collapsed" : "expanded"}
        animate={isSidebarCollapsed ? "collapsed" : "expanded"}
        variants={sidebarVariants}
        style={{
          width: isMobile ? `min(${visualSidebarWidth}px, calc(100vw - 24px))` : visualSidebarWidth,
          pointerEvents: isSidebarCollapsed ? "none" : "auto",
        }}
        role={isMobile ? "dialog" : "navigation"}
        aria-modal={isMobile && isOpen ? "true" : undefined}
        aria-labelledby={isMobile ? mobileSidebarTitleId : undefined}
        aria-label={isMobile ? undefined : "Sidebar navigation"}
        aria-hidden={isSidebarCollapsed}
        inert={isSidebarCollapsed}
      >
        <h2 id={mobileSidebarTitleId} className="sr-only">
          Navigation
        </h2>
        <div
          className="flex flex-col h-full overflow-hidden shrink-0"
          style={{ width: isMobile ? `min(${visualSidebarWidth}px, calc(100vw - 24px))` : visualSidebarWidth }}
        >
          {/* Header */}
          {view === "settings" ? (
            <div
              className="flex flex-col justify-start h-14 shrink-0 border-b border-border/30"
              data-tauri-drag-region={isMac ? true : undefined}
            >
              <div
                className={`flex items-center pr-3 gap-2.5 ${isMac ? "h-full macos-traffic-light-inset" : "h-[32px] pl-4"}`}
              >
                <button
                  onClick={() => setView("chat")}
                  className="p-1 rounded-md text-text-secondary hover:bg-hover hover:text-text-primary transition-colors flex items-center justify-center cursor-pointer"
                  aria-label="Back to chat"
                  title="Back"
                >
                  <ArrowLeft size={16} />
                </button>
                <Settings size={16} className="text-text-muted" />
                <span className="text-sm font-medium text-text-primary">{t("common.settings")}</span>
              </div>
            </div>
          ) : (
            <div
              className="flex items-center justify-end px-3 h-14 shrink-0"
              data-tauri-drag-region={isMac ? true : undefined}
            >
              <div className="flex items-center gap-1">
                <button
                  onClick={onClose}
                  className="md:hidden p-2 rounded-lg hover:bg-hover text-text-muted hover:text-text-secondary transition-colors flex items-center justify-center"
                  aria-label="Close sidebar"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
          )}{" "}
          {view === "settings" ? (
            <>
              {/* Settings Search */}
              {!isSidebarCollapsed && (
                <div className="px-3 py-2 border-b border-border/10">
                  <div className="relative">
                    <Search
                      size={15}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
                      aria-hidden="true"
                    />
                    <label htmlFor="settings-search" className="sr-only">
                      Search settings
                    </label>
                    <input
                      id="settings-search"
                      type="search"
                      value={settingsSearchQuery}
                      onChange={(e) => setSettingsSearchQuery(e.target.value)}
                      placeholder={t("settings.searchPlaceholder", { defaultValue: "Search settings…" })}
                      className="w-full pl-8 pr-8 py-1.5 rounded-lg bg-input border border-input-border text-sm text-text-primary placeholder-text-muted focus:border-text-muted focus:outline-none transition-colors"
                    />
                    {settingsSearchQuery && (
                      <button
                        onClick={() => setSettingsSearchQuery("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-hover transition-colors"
                        aria-label="Clear search"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                </div>
              )}

              <nav className="mr-1 flex-1 overflow-y-auto p-3 space-y-4" aria-label="Settings sections">
                {/* Individual Settings Results */}
                {settingsSearchQuery.trim() && filteredIndividualSettings.length > 0 && (
                  <div className="mb-4 space-y-2 border-b border-border/10 pb-3">
                    <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider px-3 mb-1">
                      Matching Settings
                    </h3>
                    <div className="space-y-0.5">
                      {filteredIndividualSettings.map((setting) => (
                        <button
                          key={setting.id}
                          onClick={() => handleSelectSetting(setting)}
                          className="w-full flex flex-col items-start gap-0.5 px-3 py-2 rounded-lg text-left text-text-secondary hover:bg-hover hover:text-text-primary transition-[color,background-color,border-color,box-shadow,transform] border border-transparent hover:border-border/30"
                        >
                          <span className="text-xs font-semibold text-text-primary">{setting.label}</span>
                          {setting.description && (
                            <span className="text-[10px] text-text-muted leading-tight line-clamp-1">
                              {setting.description}
                            </span>
                          )}
                          <span className="text-[9px] font-medium text-accent bg-accent-soft px-1.5 py-0.5 rounded mt-1">
                            in {setting.sectionLabel}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {filteredSectionGroups.length > 0
                  ? filteredSectionGroups.map((group) => (
                      <div key={group.category} className="mb-4">
                        {!isSidebarCollapsed && (
                          <h3 className="text-[11px] font-medium text-text-muted mb-1 px-3">
                            {t(categoryKeys[group.category] || group.category)}
                          </h3>
                        )}
                        <div className="space-y-0.5">
                          {group.items.map((section) => {
                            const Icon = section.icon;
                            const isActive = activeSection === section.id;
                            return (
                              <button
                                key={section.id}
                                onClick={() => setActiveSection(section.id as SectionId)}
                                className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm transition-colors text-left ${
                                  isActive
                                    ? "bg-active text-text-primary font-medium"
                                    : "text-text-secondary hover:bg-hover hover:text-text-primary"
                                }`}
                                aria-current={isActive ? "page" : undefined}
                                title={isSidebarCollapsed ? t(`section.${section.id}`) || section.label : undefined}
                              >
                                <Icon size={15} className="shrink-0" />
                                {!isSidebarCollapsed && (
                                  <span className="truncate">{t(`section.${section.id}`) || section.label}</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  : filteredIndividualSettings.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                        <p className="text-sm font-medium text-text-secondary">
                          {t("settings.searchNoResults", { defaultValue: "No settings found" })}
                        </p>
                        <p className="text-xs text-text-muted mt-1">
                          {t("settings.searchNoResultsDesc", { defaultValue: "Try a different search term" })}
                        </p>
                      </div>
                    )}
              </nav>
            </>
          ) : (
            <>
              {/* New Chat Button */}
              <div className="px-3 mb-2">
                <button
                  onClick={onNewChat}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-hover text-text-primary text-sm font-medium transition-colors"
                  aria-label="Start new chat"
                >
                  <MessageSquarePlus size={16} />
                  {t("common.newChat")}
                </button>
              </div>

              {/* Search */}
              <div className="px-3 mb-2">
                <div className="relative">
                  <Search
                    size={16}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
                    aria-hidden="true"
                  />
                  <label htmlFor="sidebar-search" className="sr-only">
                    Search conversations
                  </label>
                  <input
                    id="sidebar-search"
                    ref={searchRef}
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t("sidebar.searchPlaceholder") || "Search conversations…"}
                    className="w-full pl-8 pr-8 py-2 rounded-lg bg-input border border-input-border text-sm text-text-primary placeholder-text-muted focus:border-text-muted focus:outline-none transition-colors"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-hover transition-colors"
                      aria-label="Clear search"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Projects Section */}
              {isProjectsEnabled && (
                <>
                  <div className="px-3 mb-2 flex items-center justify-between">
                    <h3 className="text-[11px] font-medium text-text-muted pl-1">{t("sidebar.projects")}</h3>
                    <button
                      className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-hover transition-colors"
                      onClick={() => openProjectConfigModal("create")}
                      aria-label="New Project Workspace"
                      title="Add Project Workspace"
                    >
                      <FolderPlus size={14} />
                    </button>
                  </div>

                  {projects.length > 0 && (
                    <div className="px-2 mb-4 space-y-0.5">
                      {projects.map((project) => {
                        const isExpanded = expandedProjects[project.id];
                        const pChats = projectConversations[project.id] || [];
                        const isActive = activeProjectId === project.id;

                        return (
                          <div key={project.id} className="flex flex-col">
                            <div className="relative group flex items-center">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleProject(project.id);
                                }}
                                className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-hover transition-colors shrink-0"
                                aria-label={isExpanded ? "Collapse project" : "Expand project"}
                              >
                                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              </button>
                              <button
                                onClick={() => {
                                  setActiveProject(project.id);
                                  toggleProject(project.id);
                                }}
                                className={`flex-1 flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                  isActive
                                    ? "bg-active text-text-primary"
                                    : "text-text-secondary hover:bg-hover hover:text-text-primary"
                                }`}
                              >
                                <Folder size={14} className="shrink-0" />
                                <span className="truncate flex-1 text-left">{project.name}</span>
                              </button>
                              <div className="absolute right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity shrink-0">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openProjectConfigModal("edit", project.id);
                                  }}
                                  className="p-1 rounded bg-black/5 dark:bg-white/5 hover:bg-hover text-text-secondary hover:text-text-primary transition-colors"
                                  title="Project Settings"
                                >
                                  <Settings size={12} />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setProjectToDelete(project.id);
                                  }}
                                  className="p-1 rounded bg-black/5 dark:bg-white/5 hover:bg-red-500/10 text-red-500 hover:text-red-500 transition-colors"
                                  title="Remove project"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>

                            <AnimatePresence initial={false}>
                              {isExpanded && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: "auto", opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={motionTransitions.content}
                                  className="overflow-hidden pl-6 pr-1 space-y-0.5 mt-0.5"
                                >
                                  {pChats.length === 0 ? (
                                    <div className="py-1 px-2 text-[11px] text-text-muted">{t("sidebar.noChats")}</div>
                                  ) : (
                                    pChats.map((conv) => (
                                      <div key={conv.id} className="relative group">
                                        <button
                                          onClick={() => onSelect(conv.id)}
                                          className={`
                                          w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg
                                          text-sm text-left transition-colors pr-14
                                          ${
                                            activeId === conv.id
                                              ? "bg-active text-text-primary"
                                              : "text-text-secondary hover:bg-hover hover:text-text-primary"
                                          }
                                        `}
                                          aria-label={`Open conversation: ${conv.title}`}
                                          aria-current={activeId === conv.id ? "page" : undefined}
                                        >
                                          {conv.isPinned && (
                                            <MessageSquare size={14} className="shrink-0" aria-hidden="true" />
                                          )}
                                          <span className="truncate flex-1">{conv.title || t("common.untitled")}</span>
                                        </button>
                                        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onPinChat(conv.id);
                                            }}
                                            className="p-1 rounded-md text-text-muted hover:text-text-secondary hover:bg-hover transition-colors"
                                            title={conv.isPinned ? "Unpin conversation" : "Pin conversation"}
                                            aria-label={conv.isPinned ? "Unpin conversation" : "Pin conversation"}
                                          >
                                            <Pin size={13} className={conv.isPinned ? "text-accent fill-accent" : ""} />
                                          </button>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              const rect = e.currentTarget.getBoundingClientRect();
                                              setMenuPosition({ top: rect.bottom + 4, left: rect.left - 8 });
                                              setOpenMenuId(openMenuId === conv.id ? null : conv.id);
                                            }}
                                            className="p-1 rounded-md text-text-muted hover:text-text-secondary hover:bg-hover transition-colors"
                                            aria-label="Conversation actions"
                                          >
                                            <MoreVertical size={13} />
                                          </button>
                                        </div>
                                        {openMenuId === conv.id &&
                                          menuPosition &&
                                          createPortal(
                                            <div
                                              ref={menuRef}
                                              className="popup-surface fixed z-50 min-w-[160px] p-1 rounded-xl border border-border"
                                              style={{
                                                top: `${menuPosition.top}px`,
                                                left: `${menuPosition.left}px`,
                                                boxShadow: "var(--shadow-lg)",
                                              }}
                                              role="menu"
                                            >
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setOpenMenuId(null);
                                                  onExportChat(conv.id);
                                                }}
                                                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-text-secondary hover:bg-hover hover:text-text-primary transition-colors"
                                                role="menuitem"
                                              >
                                                <Download size={14} className="text-text-muted" />
                                                {t("common.export")}
                                              </button>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setOpenMenuId(null);
                                                  onRenameChat(conv.id, conv.title);
                                                }}
                                                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-text-secondary hover:bg-hover hover:text-text-primary transition-colors"
                                                role="menuitem"
                                              >
                                                <Pencil size={14} className="text-text-muted" />
                                                {t("common.rename")}
                                              </button>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setOpenMenuId(null);
                                                  setChatToDelete(conv.id);
                                                }}
                                                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-red-500 hover:bg-red-500/10 transition-colors"
                                                role="menuitem"
                                              >
                                                <Trash2 size={14} />
                                                {t("common.delete")}
                                              </button>
                                            </div>,
                                            document.body,
                                          )}
                                      </div>
                                    ))
                                  )}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {/* Global Conversation List */}
              <nav
                className="mr-1 flex-1 overflow-y-auto overflow-x-hidden px-2 py-1 min-h-0"
                aria-label="Conversation list"
              >
                <AnimatePresence mode="popLayout">
                  {groups.map((group) => (
                    <motion.div
                      key={group.label}
                      variants={contentVariants}
                      initial="collapsed"
                      animate="expanded"
                      exit="collapsed"
                      transition={motionTransitions.content}
                      className="mb-2"
                    >
                      <p className="px-2 py-1.5 text-[11px] font-medium text-text-muted">
                        {t(`sidebar.${group.label.toLowerCase()}`) || group.label}
                      </p>
                      {group.items.length === 0 ? (
                        <p className="px-2.5 py-1.5 text-xs text-text-muted italic">{t("sidebar.noRecentChats")}</p>
                      ) : (
                        group.items.map((conv) => (
                          <div key={conv.id} className="relative group">
                            <button
                              onClick={() => onSelect(conv.id)}
                              className={`
                              w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg
                              text-sm text-left transition-colors pr-14
                              ${
                                activeId === conv.id
                                  ? "bg-active text-text-primary"
                                  : "text-text-secondary hover:bg-hover hover:text-text-primary"
                              }
                            `}
                              aria-label={`Open conversation: ${conv.title}`}
                              aria-current={activeId === conv.id ? "page" : undefined}
                            >
                              {group.label === "Pinned" && (
                                <MessageSquare size={14} className="shrink-0" aria-hidden="true" />
                              )}
                              <span className="truncate flex-1">
                                {conv.title === "Untitled" || !conv.title ? t("common.untitled") : conv.title}
                              </span>
                            </button>
                            <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onPinChat(conv.id);
                                }}
                                className="p-1 rounded-md text-text-muted hover:text-text-secondary hover:bg-hover transition-colors"
                                title={conv.isPinned ? "Unpin conversation" : "Pin conversation"}
                                aria-label={conv.isPinned ? "Unpin conversation" : "Pin conversation"}
                              >
                                <Pin size={13} className={conv.isPinned ? "text-accent fill-accent" : ""} />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setMenuPosition({
                                    top: rect.bottom + 4,
                                    left: rect.left - 8,
                                  });
                                  setOpenMenuId(openMenuId === conv.id ? null : conv.id);
                                }}
                                className="p-1 rounded-md text-text-muted hover:text-text-secondary hover:bg-hover transition-colors"
                                aria-label="Conversation actions"
                              >
                                <MoreVertical size={14} />
                              </button>
                            </div>
                            {openMenuId === conv.id &&
                              menuPosition &&
                              createPortal(
                                <div
                                  ref={menuRef}
                                  className="popup-surface fixed z-50 min-w-[160px] p-1 rounded-xl border border-border"
                                  style={{
                                    top: `${menuPosition.top}px`,
                                    left: `${menuPosition.left}px`,
                                    boxShadow: "var(--shadow-lg)",
                                  }}
                                  role="menu"
                                >
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setOpenMenuId(null);
                                      onExportChat(conv.id);
                                    }}
                                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-text-secondary hover:bg-hover hover:text-text-primary transition-colors"
                                    role="menuitem"
                                  >
                                    <Download size={14} className="text-text-muted" />
                                    Export
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setOpenMenuId(null);
                                      onRenameChat(conv.id, conv.title);
                                    }}
                                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-text-secondary hover:bg-hover hover:text-text-primary transition-colors"
                                    role="menuitem"
                                  >
                                    <Pencil size={14} className="text-text-muted" />
                                    Rename
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setOpenMenuId(null);
                                      setChatToDelete(conv.id);
                                    }}
                                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-red-500 hover:bg-red-500/10 transition-colors"
                                    role="menuitem"
                                  >
                                    <Trash2 size={14} />
                                    Delete
                                  </button>
                                </div>,
                                document.body,
                              )}
                          </div>
                        ))
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>

                {nonEmptyConversations.length === 0 && (
                  <p className="px-2 py-4 text-sm text-text-muted text-center">{t("sidebar.noChats")}</p>
                )}
              </nav>

              {/* Bottom Section */}
              <div className="px-3 py-3 border-t border-border flex flex-col gap-1 shrink-0">
                {/* Connection Status */}
                {!disableBgActivity && (
                  <div
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-text-muted"
                    role="status"
                    aria-label={`Connection status: ${t(STATUS_KEYS[aggregateStatus]) || STATUS_LABELS[aggregateStatus]}`}
                  >
                    <div
                      className={`w-2 h-2 rounded-full shrink-0 ${STATUS_COLORS[aggregateStatus]}`}
                      aria-hidden="true"
                    />
                    <span>{t(STATUS_KEYS[aggregateStatus]) || STATUS_LABELS[aggregateStatus]}</span>
                  </div>
                )}

                {/* Settings */}
                <button
                  onClick={onSettingsClick}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-text-secondary hover:bg-hover hover:text-text-primary transition-colors"
                  aria-label="Open settings"
                >
                  <Settings size={16} aria-hidden="true" />
                  {t("common.settings")}
                </button>
              </div>
            </>
          )}
          <AnimatePresence>
            {showZoom && (
              <motion.div
                initial={{ opacity: 0, height: 0, scale: 0.95 }}
                animate={{ opacity: 1, height: "auto", scale: 1 }}
                exit={{ opacity: 0, height: 0, scale: 0.95 }}
                transition={springs.snappy}
                className="px-6 py-3 border-t border-border bg-accent-soft text-accent flex items-center justify-between text-xs font-semibold shrink-0"
              >
                <span>Scale / Zoom</span>
                <span>{Math.round(zoomLevel * 100)}%</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Resize Handle */}
        {!isSidebarCollapsed && (
          // The adjustable separator follows the WAI-ARIA window-splitter pattern.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
          <div
            className="group absolute top-0 -right-1 z-50 hidden h-full w-2 cursor-col-resize touch-none select-none focus-visible:outline-none md:block"
            role="separator"
            aria-label="Resize sidebar"
            aria-orientation="vertical"
            aria-valuemin={MIN_SIDEBAR_WIDTH}
            aria-valuemax={getResponsiveMaxSidebarWidth(typeof window === "undefined" ? undefined : window.innerWidth)}
            aria-valuenow={Math.round(visualSidebarWidth)}
            tabIndex={0}
            title="Double-click to reset sidebar width"
            onPointerDown={startResize}
            onPointerMove={resize}
            onPointerUp={handleResizeEnd}
            onPointerCancel={handleResizeEnd}
            onLostPointerCapture={stopResize}
            onKeyDown={handleResizeKeyDown}
            onDoubleClick={resetSidebarWidth}
          >
            <span className="pointer-events-none absolute left-1/2 top-1/2 h-12 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent opacity-0 transition-opacity group-hover:opacity-40 group-active:opacity-70 group-focus-visible:opacity-60" />
          </div>
        )}
      </motion.aside>

      <ConfirmModal
        isOpen={chatToDelete !== null}
        title="Delete Chat"
        message="Are you sure you want to delete this chat? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setChatToDelete(null)}
      />

      <ConfirmModal
        isOpen={projectToDelete !== null}
        title="Delete Project"
        message="Are you sure you want to remove this project? This will not delete the folder on your disk, but it will remove the project configuration and history from Sythoria."
        confirmText="Remove"
        variant="danger"
        onConfirm={handleDeleteProjectConfirm}
        onCancel={() => setProjectToDelete(null)}
      />
    </>
  );
});
