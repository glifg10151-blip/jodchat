import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "motion/react";
import {
  Menu,
  PanelLeft,
  MessageSquarePlus,
  ChevronLeft,
  ChevronRight,
  Split,
  X,
  Plus,
  Link,
  Maximize2,
  Minimize2,
  ArrowLeft,
  Ghost,
  PanelRight,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";
import Sidebar from "./components/Sidebar";
import { isGenerationActive, type Attachment, type Conversation } from "./types";
import InputBar from "./components/InputBar";
import ScrollToBottomButton from "./components/ScrollToBottomButton";
import { RenameChatModal, ToolConfirmationModal, UpdateModal } from "./components/ui/Modal";
import { Spinner } from "./components/ui/Spinner";
import { ToastContainer } from "./components/ui/Toast";
import { LinkWarningModal } from "./components/LinkWarningModal";

import StartScreen from "./components/StartScreen";
import { DragOverlay } from "./components/ui/DragOverlay";
import { TitleBar } from "./components/TitleBar";
import { useChatStore } from "./store/useChatStore";

const loadSettings = () => import("./components/settings");
const Settings = lazy(loadSettings);
const ChatArea = lazy(() => import("./components/ChatArea"));
const ComparisonColumn = lazy(() =>
  import("./components/ComparisonColumn").then((module) => ({ default: module.ComparisonColumn })),
);
const AuxiliaryPanel = lazy(() =>
  import("./components/AuxiliaryPanel").then((module) => ({ default: module.AuxiliaryPanel })),
);
const CommandPalette = lazy(() =>
  import("./components/CommandPalette").then((module) => ({ default: module.CommandPalette })),
);
const ProjectConfigModal = lazy(() => import("./components/ProjectConfigModal"));
const SpotlightArea = lazy(() =>
  import("./components/SpotlightArea").then((module) => ({ default: module.SpotlightArea })),
);

function scheduleWhenIdle(task: () => void, timeout = 1500): () => void {
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof idleWindow.requestIdleCallback === "function") {
    const id = idleWindow.requestIdleCallback(task, { timeout });
    return () => idleWindow.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(task, 250);
  return () => window.clearTimeout(id);
}

import { useModelStore } from "./store/useModelStore";
import { useSearchStore } from "./store/useSearchStore";
import { useMcpStore } from "./store/useMcpStore";
import { useUIStore } from "./store/useUIStore";
import { useProjectStore } from "./store/useProjectStore";
import { findMatchingCommand, useKeybindStore } from "./store/useKeybindStore";
import { useAppshotStore } from "./store/useAppshotStore";
import { useSkillStore } from "./store/useSkillStore";
import { useShallow } from "zustand/react/shallow";
import { useScrollButton } from "./hooks/useScrollPosition";
import { useScrollTracking } from "./hooks/useScrollTracking";
import { motionTransitions, springs } from "./lib/motion-tokens";
import { useTranslation } from "./utils/i18n";
import type { ComparisonColumnHandle } from "./components/ComparisonColumn";
import { executeCommand } from "./services/commandDispatcher";
import { useDialogFocus } from "./hooks/useDialogFocus";
import { DEFAULT_AUX_PANEL_WIDTH, MAX_AUX_PANEL_WIDTH, MIN_AUX_PANEL_WIDTH } from "./config/constants";

import "./index.css";

interface AuxiliaryPanelBounds {
  min: number;
  max: number;
}

function getAuxiliaryPanelBounds(containerWidth: number): AuxiliaryPanelBounds {
  const safeWidth = Math.max(0, containerWidth);
  const min = Math.min(300, Math.max(MIN_AUX_PANEL_WIDTH, Math.floor(safeWidth * 0.4)));
  const max = Math.max(min, Math.min(MAX_AUX_PANEL_WIDTH, Math.floor(safeWidth * 0.48)));
  return { min, max };
}

function clampAuxiliaryPanelWidth(width: number, bounds: AuxiliaryPanelBounds): number {
  return Math.max(bounds.min, Math.min(bounds.max, width));
}

function getSafeSrcDoc(content: string, allowNetwork: boolean): string {
  const connectSrc = allowNetwork ? "*" : "'none'";
  const imgSrc = allowNetwork ? "*" : "'self' data: blob:";
  const fontSrc = allowNetwork ? "*" : "'self' data:";
  const styleSrc = "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; style-src 'self' 'unsafe-inline';";

  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${styleSrc} connect-src ${connectSrc}; img-src ${imgSrc}; font-src ${fontSrc}; object-src 'none'; frame-src 'none';">`;

  const lowerContent = content.toLowerCase();
  const headIndex = lowerContent.indexOf("<head>");
  if (headIndex !== -1) {
    const insertPos = headIndex + 6;
    return content.slice(0, insertPos) + "\n  " + cspMeta + content.slice(insertPos);
  }

  const htmlIndex = lowerContent.indexOf("<html>");
  if (htmlIndex !== -1) {
    const insertPos = htmlIndex + 6;
    return content.slice(0, insertPos) + "\n<head>\n  " + cspMeta + "\n</head>" + content.slice(insertPos);
  }

  return "<!DOCTYPE html>\n<html>\n<head>\n  " + cspMeta + "\n</head>\n<body>\n" + content + "\n</body>\n</html>";
}

function App() {
  const { t } = useTranslation();
  const isMac = typeof window !== "undefined" && window.navigator.userAgent.includes("Mac");
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const previousIsMobileRef = useRef(isMobile);
  const activeListenerIdRef = useRef("");
  const captureAppshotCombo = useKeybindStore((state) => state.keybinds.captureAppshot.currentCombo);

  useEffect(() => {
    if (!isMac) return;

    let active = true;
    let unlisten: (() => void) | undefined;
    const root = document.documentElement;

    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const stopListening = await listen<boolean>("sythoria://macos-fullscreen-changed", (event) => {
        root.classList.toggle("macos-fullscreen", event.payload);
      });
      if (active) {
        unlisten = stopListening;
      } else {
        stopListening();
      }
    });

    return () => {
      active = false;
      unlisten?.();
      root.classList.remove("macos-fullscreen");
    };
  }, [isMac]);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const {
    conversations,
    activeId,
    isStreaming,
    generationByConversation,
    navigationHistory,
    navigationIndex,
    isCompareMode,
    compareIds,
  } = useChatStore(
    useShallow((s) => ({
      conversations: s.conversations,
      activeId: s.activeId,
      isStreaming: s.isStreaming,
      generationByConversation: s.generationByConversation,
      navigationHistory: s.navigationHistory,
      navigationIndex: s.navigationIndex,
      isCompareMode: s.isCompareMode,
      compareIds: s.compareIds,
    })),
  );
  const {
    init,
    setActiveId,
    newChat,
    newTemporaryChat,
    deleteChat,
    sendMessage,
    stopStreaming,
    retryLastMessage,
    exportChat,
    confirmRename,
    navigateBack,
    navigateForward,
    setIsCompareMode,
    togglePinChat,
  } = useChatStore(
    useShallow((s) => ({
      init: s.init,
      setActiveId: s.setActiveId,
      newChat: s.newChat,
      newTemporaryChat: s.newTemporaryChat,
      deleteChat: s.deleteChat,
      sendMessage: s.sendMessage,
      stopStreaming: s.stopStreaming,
      retryLastMessage: s.retryLastMessage,
      exportChat: s.exportChat,
      confirmRename: s.confirmRename,
      navigateBack: s.navigateBack,
      navigateForward: s.navigateForward,
      setIsCompareMode: s.setIsCompareMode,
      togglePinChat: s.togglePinChat,
    })),
  );

  const { models, selectedModel, modelStatuses } = useModelStore(
    useShallow((s) => ({
      models: s.models,
      selectedModel: s.selectedModel,
      modelStatuses: s.modelStatuses,
    })),
  );
  const { setSelectedModel } = useModelStore(
    useShallow((s) => ({
      setSelectedModel: s.setSelectedModel,
    })),
  );

  const { activeSearchId } = useSearchStore(
    useShallow((s) => ({
      activeSearchId: s.activeSearchId,
    })),
  );

  const { mcpConfigs, serverStatuses } = useMcpStore(
    useShallow((s) => ({
      mcpConfigs: s.mcpConfigs,
      serverStatuses: s.serverStatuses,
    })),
  );

  const {
    sidebarOpen,
    sidebarCollapsed,
    isLaunchReady,
    isConfigLoaded,
    startupRecovery,
    view,
    showRenameModal,
    renameCurrentTitle,
    loading,
    toasts,
    hasStarted,
    isDraggingFile,
    pendingToolConfirmations,
    activeArtifact,
    showUpdateModal,
    updateInfo,
    isInstallingUpdate,
    updateDownloadProgress,
    updateError,
    autoUpdateChecking,
    isAuxPanelOpen,
    isAuxPanelExpanded,
    auxPanelWidth,
    showCommandPalette,
    showSpotlight,
    showProjectConfigModal,
  } = useUIStore(
    useShallow((s) => ({
      sidebarOpen: s.sidebarOpen,
      sidebarCollapsed: s.sidebarCollapsed,
      isLaunchReady: s.isLaunchReady,
      isConfigLoaded: s.isConfigLoaded,
      startupRecovery: s.startupRecovery,
      view: s.view,
      showRenameModal: s.showRenameModal,
      renameCurrentTitle: s.renameCurrentTitle,
      loading: s.loading,
      toasts: s.toasts,
      hasStarted: s.hasStarted,
      isDraggingFile: s.isDraggingFile,
      pendingToolConfirmations: s.pendingToolConfirmations,
      activeArtifact: s.activeArtifact,
      showUpdateModal: s.showUpdateModal,
      updateInfo: s.updateInfo,
      isInstallingUpdate: s.isInstallingUpdate,
      updateDownloadProgress: s.updateDownloadProgress,
      updateError: s.updateError,
      autoUpdateChecking: s.autoUpdateChecking,
      isAuxPanelOpen: s.isAuxPanelOpen,
      isAuxPanelExpanded: s.isAuxPanelExpanded,
      auxPanelWidth: s.auxPanelWidth,
      showCommandPalette: s.showCommandPalette,
      showSpotlight: s.showSpotlight,
      showProjectConfigModal: s.showProjectConfigModal,
    })),
  );
  const {
    setSidebarOpen,
    toggleSidebarCollapsed,
    setView,
    setActiveSection,
    openRenameModal,
    closeRenameModal,
    dismissToast,
    setHasStarted,
    respondToToolConfirmation,
    setActiveArtifact,
    setShowUpdateModal,
    checkForUpdates,
    installUpdate,
    toggleCommandPalette,
    setAuxPanelOpen,
    setAuxPanelExpanded,
    setAuxPanelWidth,
    setActiveAuxTab,
    setActiveAuxConversationId,
  } = useUIStore(
    useShallow((s) => ({
      setSidebarOpen: s.setSidebarOpen,
      toggleSidebarCollapsed: s.toggleSidebarCollapsed,
      setView: s.setView,
      setActiveSection: s.setActiveSection,
      openRenameModal: s.openRenameModal,
      closeRenameModal: s.closeRenameModal,
      dismissToast: s.dismissToast,
      setHasStarted: s.setHasStarted,
      respondToToolConfirmation: s.respondToToolConfirmation,
      setActiveArtifact: s.setActiveArtifact,
      setShowUpdateModal: s.setShowUpdateModal,
      checkForUpdates: s.checkForUpdates,
      installUpdate: s.installUpdate,
      toggleCommandPalette: s.toggleCommandPalette,
      setAuxPanelOpen: s.setAuxPanelOpen,
      setAuxPanelExpanded: s.setAuxPanelExpanded,
      setAuxPanelWidth: s.setAuxPanelWidth,
      setActiveAuxTab: s.setActiveAuxTab,
      setActiveAuxConversationId: s.setActiveAuxConversationId,
    })),
  );

  const { activeProjectId, setActiveProject, isProjectsEnabled } = useProjectStore(
    useShallow((s) => ({
      activeProjectId: s.activeProjectId,
      setActiveProject: s.setActiveProject,
      isProjectsEnabled: s.isProjectsEnabled,
    })),
  );
  const [allowArtifactNetwork, setAllowArtifactNetwork] = useState(false);
  const sidebarOpenForViewport = sidebarOpen;
  const showAuxiliaryPanel = isProjectsEnabled && isAuxPanelOpen;
  const isWorkspacePanelFull = showAuxiliaryPanel && (isAuxPanelExpanded || isMobile);
  const workspaceSplitRef = useRef<HTMLDivElement>(null);
  const auxResizePointerRef = useRef<number | null>(null);
  const isAuxPanelResizingRef = useRef(false);
  const visualAuxPanelWidthRef = useRef(auxPanelWidth);
  const [visualAuxPanelWidth, setVisualAuxPanelWidth] = useState(auxPanelWidth);
  const [isAuxPanelResizing, setIsAuxPanelResizing] = useState(false);
  const [workspaceSplitWidth, setWorkspaceSplitWidth] = useState(() =>
    typeof window === "undefined" ? 1200 : window.innerWidth,
  );
  const [auxPanelBounds, setAuxPanelBounds] = useState(() =>
    getAuxiliaryPanelBounds(typeof window === "undefined" ? 1200 : window.innerWidth),
  );

  const updateVisualAuxPanelWidth = useCallback((width: number) => {
    const containerWidth = workspaceSplitRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const bounds = getAuxiliaryPanelBounds(containerWidth);
    const nextWidth = Math.round(clampAuxiliaryPanelWidth(width, bounds));
    visualAuxPanelWidthRef.current = nextWidth;
    setWorkspaceSplitWidth(containerWidth);
    setAuxPanelBounds(bounds);
    setVisualAuxPanelWidth(nextWidth);
  }, []);

  useEffect(() => {
    if (isAuxPanelResizingRef.current) return;
    updateVisualAuxPanelWidth(auxPanelWidth);
  }, [auxPanelWidth, updateVisualAuxPanelWidth]);

  useEffect(() => {
    const split = workspaceSplitRef.current;
    if (!split) return;
    const fitPanelToAvailableSpace = () => {
      if (!isAuxPanelResizingRef.current) updateVisualAuxPanelWidth(auxPanelWidth);
    };
    fitPanelToAvailableSpace();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fitPanelToAvailableSpace);
    observer?.observe(split);
    window.addEventListener("resize", fitPanelToAvailableSpace);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", fitPanelToAvailableSpace);
    };
  }, [auxPanelWidth, hasStarted, isConfigLoaded, showAuxiliaryPanel, updateVisualAuxPanelWidth, view]);

  const stopAuxPanelResize = useCallback(() => {
    if (!isAuxPanelResizingRef.current) return;
    isAuxPanelResizingRef.current = false;
    auxResizePointerRef.current = null;
    setIsAuxPanelResizing(false);
    document.documentElement.classList.remove("aux-panel-resizing");
    setAuxPanelWidth(visualAuxPanelWidthRef.current);
  }, [setAuxPanelWidth]);

  const startAuxPanelResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    isAuxPanelResizingRef.current = true;
    auxResizePointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsAuxPanelResizing(true);
    document.documentElement.classList.add("aux-panel-resizing");
  }, []);

  const resizeAuxPanel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isAuxPanelResizingRef.current || auxResizePointerRef.current !== event.pointerId) return;
      const rightEdge = workspaceSplitRef.current?.getBoundingClientRect().right ?? window.innerWidth;
      updateVisualAuxPanelWidth(rightEdge - event.clientX);
    },
    [updateVisualAuxPanelWidth],
  );

  const endAuxPanelResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (auxResizePointerRef.current !== event.pointerId) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      stopAuxPanelResize();
    },
    [stopAuxPanelResize],
  );

  const handleAuxPanelResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const direction = event.key === "ArrowLeft" ? 1 : event.key === "ArrowRight" ? -1 : 0;
      if (!direction && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      const step = event.shiftKey ? 24 : 8;
      const nextWidth =
        event.key === "Home"
          ? auxPanelBounds.min
          : event.key === "End"
            ? auxPanelBounds.max
            : visualAuxPanelWidthRef.current + direction * step;
      updateVisualAuxPanelWidth(nextWidth);
      setAuxPanelWidth(clampAuxiliaryPanelWidth(nextWidth, auxPanelBounds));
    },
    [auxPanelBounds, setAuxPanelWidth, updateVisualAuxPanelWidth],
  );

  const resetAuxPanelWidth = useCallback(() => {
    updateVisualAuxPanelWidth(DEFAULT_AUX_PANEL_WIDTH);
    setAuxPanelWidth(DEFAULT_AUX_PANEL_WIDTH);
  }, [setAuxPanelWidth, updateVisualAuxPanelWidth]);

  useEffect(() => {
    if (!isAuxPanelResizing) return;
    window.addEventListener("blur", stopAuxPanelResize);
    return () => window.removeEventListener("blur", stopAuxPanelResize);
  }, [isAuxPanelResizing, stopAuxPanelResize]);

  useEffect(
    () => () => {
      document.documentElement.classList.remove("aux-panel-resizing");
    },
    [],
  );

  const auxiliaryPanelTargetWidth = isWorkspacePanelFull ? workspaceSplitWidth : visualAuxPanelWidth;
  const auxiliaryPanelVariants = {
    expanded: {
      x: 0,
      opacity: 1,
      width: auxiliaryPanelTargetWidth,
      borderLeftWidth: 1,
      transition: {
        ...(isAuxPanelResizing ? { type: "tween" as const, duration: 0 } : springs.release),
        opacity: motionTransitions.popoverEnter,
      },
    },
    collapsed: {
      x: 8,
      opacity: 0,
      width: 0,
      borderLeftWidth: 0,
      transition: {
        ...(isAuxPanelResizing ? { type: "tween" as const, duration: 0 } : springs.release),
        opacity: motionTransitions.popoverExit,
      },
    },
  };

  useEffect(() => {
    const wasMobile = previousIsMobileRef.current;
    if (isMobile && !wasMobile) {
      setSidebarOpen(false);
    }
    previousIsMobileRef.current = isMobile;
  }, [isMobile, setSidebarOpen]);

  useEffect(() => {
    if (!hasStarted || !isConfigLoaded) return;
    return scheduleWhenIdle(() => {
      void loadSettings();
    }, 2000);
  }, [hasStarted, isConfigLoaded]);

  useEffect(() => {
    if (!isLaunchReady) return;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        performance.mark("sythoria:shell-painted");
        void invoke("frontend_ready").catch((error) => {
          console.warn("Could not signal frontend readiness:", error);
        });
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [isLaunchReady]);

  useEffect(() => {
    if (!activeArtifact) {
      requestAnimationFrame(() => {
        setAllowArtifactNetwork(false);
      });
    }
  }, [activeArtifact]);

  useEffect(() => {
    if (!isProjectsEnabled && isAuxPanelOpen) {
      setAuxPanelOpen(false);
    }
  }, [isAuxPanelOpen, isProjectsEnabled, setAuxPanelOpen]);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );
  const parentConversation = useMemo(() => {
    if (activeConversation?.isSubagent && activeConversation.parentId) {
      return conversations.find((c) => c.id === activeConversation.parentId) ?? null;
    }
    return null;
  }, [conversations, activeConversation]);
  const messages = activeConversation?.messages ?? [];
  const primaryGeneration = activeId ? generationByConversation[activeId] : null;
  const isPrimaryGenerating = isGenerationActive(primaryGeneration?.state);
  const isInputDisabled = isPrimaryGenerating || !!activeConversation?.isSubagent;

  const [syncScrolls, setSyncScrolls] = useState(true);
  const [isArtifactFullScreen, setIsArtifactFullScreen] = useState(false);
  const artifactDialogRef = useRef<HTMLDivElement>(null);
  const artifactTitleId = useId();
  const closeArtifactPreview = useCallback(() => {
    setActiveArtifact(null);
    setIsArtifactFullScreen(false);
  }, [setActiveArtifact]);
  useDialogFocus({
    isOpen: Boolean(activeArtifact && isArtifactFullScreen),
    onClose: closeArtifactPreview,
    containerRef: artifactDialogRef,
  });

  const compareConversations = useMemo(
    () => compareIds.map((id) => conversations.find((c) => c.id === id)).filter(Boolean) as Conversation[],
    [conversations, compareIds],
  );

  const handleAddComparison = useCallback(() => {
    const currentState = useChatStore.getState();
    if (!currentState.activeId) return;

    const activeConv = currentState.conversations.find((c) => c.id === currentState.activeId);
    const currentComparisons = currentState.compareIds
      .map((id) => currentState.conversations.find((conversation) => conversation.id === id))
      .filter(Boolean) as Conversation[];
    const usedModelIds = new Set([activeConv?.model, ...currentComparisons.map((conversation) => conversation.model)]);
    const modelId =
      models.find((model) => model.enabled !== false && !usedModelIds.has(model.id))?.id ??
      models.find((model) => model.enabled !== false)?.id ??
      activeConv?.model ??
      selectedModel;
    const newId = `compare-${Date.now()}-${currentState.compareIds.length}`;
    const clonedMessages = activeConv ? activeConv.messages.map((m) => ({ ...m })) : [];

    const newConv = {
      id: newId,
      title: (activeConv?.title ?? "Comparison") + " (Compare)",
      timestamp: new Date(),
      messages: clonedMessages,
      model: modelId,
      projectId: activeConv?.projectId || undefined,
    };

    useChatStore.setState((state) => ({
      conversations: [newConv, ...state.conversations],
      compareIds: [...state.compareIds, newId],
    }));
  }, [models, selectedModel]);

  const handleToggleTemporaryChat = useCallback(() => {
    if (activeConversation?.isTemporary) {
      newChat();
    } else {
      newTemporaryChat();
    }
  }, [activeConversation, newChat, newTemporaryChat]);

  const handleToggleCompareMode = useCallback(() => {
    const nextCompareMode = !isCompareMode;

    if (nextCompareMode) {
      let currentActiveId = activeId;

      if (!currentActiveId) {
        currentActiveId = newChat();
      }

      const currentState = useChatStore.getState();
      const currentConvs = currentState.conversations;
      const currentCompareIds = currentState.compareIds;

      if (currentActiveId && currentCompareIds.length === 0) {
        const activeConv = currentConvs.find((c) => c.id === currentActiveId);
        const secondaryModel =
          models.find((m) => m.id !== activeConv?.model && m.enabled !== false)?.id || selectedModel;

        const newId = "compare-" + Date.now();
        const clonedMessages = activeConv ? activeConv.messages.map((m) => ({ ...m })) : [];

        const newConv = {
          id: newId,
          title: (activeConv?.title ?? "New chat") + " (Compare)",
          timestamp: new Date(),
          messages: clonedMessages,
          model: secondaryModel,
          projectId: activeConv?.projectId || undefined,
        };

        useChatStore.setState({
          conversations: [newConv, ...useChatStore.getState().conversations],
          compareIds: [newId],
          isCompareMode: true,
        });
      } else {
        setIsCompareMode(true);
      }
    } else {
      if (!setIsCompareMode(false)) return;
      if (compareIds.length > 0) {
        useChatStore.setState({
          conversations: conversations.filter((c) => !compareIds.includes(c.id)),
          compareIds: [],
        });
      }
    }
  }, [isCompareMode, activeId, compareIds, conversations, models, selectedModel, setIsCompareMode, newChat]);

  const {
    virtuosoRef: primaryVirtuosoRef,
    isAtBottom: primaryIsAtBottom,
    setIsAtBottom: primarySetIsAtBottom,
    scrollToBottom: primaryScrollToBottom,
  } = useScrollButton();

  const primaryComparisonRef = useRef<ComparisonColumnHandle | null>(null);
  const compareRefsMap = useRef<Record<string, ComparisonColumnHandle | null>>({});

  const activeScrollSourceRef = useRef<string | null>(null);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleScrollSync = useCallback(
    (cId: string, scrollTop: number, ratio: number) => {
      if (!syncScrolls) return;
      if (isStreaming) return; // Prevent scroll fighting/oscillations during streaming
      if (activeScrollSourceRef.current && activeScrollSourceRef.current !== cId) return;

      activeScrollSourceRef.current = cId;

      if (activeId !== cId && primaryComparisonRef.current) {
        const scroller = primaryComparisonRef.current.getScroller();
        if (scroller) {
          const targetTop = ratio * (scroller.scrollHeight - scroller.clientHeight);
          primaryComparisonRef.current.scrollTo({ top: targetTop });
        } else {
          primaryComparisonRef.current.scrollTo({ top: scrollTop });
        }
      }

      compareIds.forEach((id) => {
        if (id !== cId) {
          const compRef = compareRefsMap.current[id];
          if (compRef) {
            const scroller = compRef.getScroller();
            if (scroller) {
              const targetTop = ratio * (scroller.scrollHeight - scroller.clientHeight);
              compRef.scrollTo({ top: targetTop });
            } else {
              compRef.scrollTo({ top: scrollTop });
            }
          }
        }
      });

      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        activeScrollSourceRef.current = null;
      }, 120);
    },
    [syncScrolls, activeId, compareIds, isStreaming],
  );

  // Synchronize active project when active conversation changes
  useEffect(() => {
    if (activeConversation) {
      if (activeConversation.projectId !== activeProjectId) {
        setActiveProject(activeConversation.projectId || null);
      }
      const projectStore = useProjectStore.getState();
      if (activeConversation.pendingWorktree) {
        if (
          projectStore.activeWorktreePath !== activeConversation.pendingWorktree.path ||
          projectStore.activeWorktreeBranch !== activeConversation.pendingWorktree.branch
        ) {
          projectStore.setWorktree(activeConversation.pendingWorktree.path, activeConversation.pendingWorktree.branch);
        }
      } else {
        if (projectStore.activeWorktreePath !== null || projectStore.activeWorktreeBranch !== null) {
          projectStore.setWorktree(null, null);
        }
      }
    } else {
      const projectStore = useProjectStore.getState();
      if (projectStore.activeWorktreePath !== null || projectStore.activeWorktreeBranch !== null) {
        projectStore.setWorktree(null, null);
      }
    }
  }, [activeConversation, activeProjectId, setActiveProject]);

  const primaryTracking = useScrollTracking(activeId, messages.length, primaryIsAtBottom, isStreaming);

  const showScrollToBottom = !primaryIsAtBottom;
  const hasNewMessages = primaryTracking.hasNewMessages;

  const scrollChatsToBottom = useCallback(
    (behavior: "auto" | "smooth" = "smooth") => {
      primaryScrollToBottom(behavior);

      if (!isCompareMode) return;

      const scrollOptions = {
        index: Number.MAX_SAFE_INTEGER,
        behavior,
        align: "end" as const,
      };
      primaryComparisonRef.current?.scrollToIndex(scrollOptions);
      compareIds.forEach((id) => {
        compareRefsMap.current[id]?.scrollToIndex(scrollOptions);
      });
    },
    [primaryScrollToBottom, isCompareMode, compareIds],
  );

  const handleScrollToBottom = useCallback(() => {
    scrollChatsToBottom();
    primaryTracking.setHasNewMessages(false);
  }, [scrollChatsToBottom, primaryTracking]);

  const handleSendMessage = useCallback(
    async (message: string, attachments?: Attachment[], mcpServerIds?: string[], searchConfigId?: string | null) => {
      const status = await sendMessage(message, attachments, undefined, mcpServerIds, searchConfigId);
      if (status === "accepted") {
        requestAnimationFrame(() => scrollChatsToBottom());
      }
      return status;
    },
    [sendMessage, scrollChatsToBottom],
  );

  // Scroll to bottom instantly when switching conversations or going to the chat view
  useEffect(() => {
    if (view === "chat" && activeId) {
      const scroll = () => scrollChatsToBottom("auto");

      scroll();

      const raf = requestAnimationFrame(() => {
        scroll();
      });

      const timer = setTimeout(() => {
        scroll();
      }, 60);

      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(timer);
      };
    }
  }, [activeId, view, scrollChatsToBottom]);

  useEffect(() => {
    performance.mark("sythoria:bootstrap-start");
    void init();
  }, [init]);

  useEffect(() => {
    if (!isConfigLoaded) return;
    performance.mark("sythoria:config-ready");
    try {
      performance.measure("sythoria:bootstrap", "sythoria:bootstrap-start", "sythoria:config-ready");
    } catch {
      // Performance marks are diagnostic only and may be unavailable in test environments.
    }
    return scheduleWhenIdle(() => {
      void useUIStore.getState().initDownloadedThemes();
      void useKeybindStore.getState().initKeybinds();
      void useAppshotStore.getState().init();
      void useSkillStore.getState().loadSkills(true);
      void useUIStore.getState().initSkipExternalLinkWarning();
    });
  }, [isConfigLoaded]);

  useEffect(() => {
    if (!isConfigLoaded) return;
    return scheduleWhenIdle(() => {
      invoke("register_appshot_shortcut", { shortcut: captureAppshotCombo }).catch((error) => {
        useUIStore.getState().addToast(`Could not register the global Appshot shortcut: ${String(error)}`, "error");
      });
    });
  }, [captureAppshotCombo, isConfigLoaded]);

  useEffect(() => {
    if (!isConfigLoaded || !autoUpdateChecking) return;
    return scheduleWhenIdle(() => {
      void checkForUpdates(true);
    }, 2500);
  }, [isConfigLoaded, autoUpdateChecking, checkForUpdates]);

  useEffect(() => {
    let active = true;
    const currentListenerId = Math.random().toString();
    activeListenerIdRef.current = currentListenerId;

    let unlistenDragEnter: (() => void) | undefined;
    let unlistenDragOver: (() => void) | undefined;
    let unlistenDragLeave: (() => void) | undefined;
    let unlistenDragDrop: (() => void) | undefined;

    async function setupListeners() {
      const { listen } = await import("@tauri-apps/api/event");

      const enter = await listen("tauri://drag-enter", () => {
        if (activeListenerIdRef.current !== currentListenerId) return;
        const uiState = useUIStore.getState();
        if (uiState.view === "chat") {
          uiState.setIsDraggingFile(true);
        }
      });
      if (!active) {
        enter();
        return;
      }
      unlistenDragEnter = enter;

      const over = await listen("tauri://drag-over", () => {
        if (activeListenerIdRef.current !== currentListenerId) return;
        const uiState = useUIStore.getState();
        if (uiState.view === "chat" && !uiState.isDraggingFile) {
          uiState.setIsDraggingFile(true);
        }
      });
      if (!active) {
        over();
        return;
      }
      unlistenDragOver = over;

      const leave = await listen("tauri://drag-leave", () => {
        if (activeListenerIdRef.current !== currentListenerId) return;
        useUIStore.getState().setIsDraggingFile(false);
      });
      if (!active) {
        leave();
        return;
      }
      unlistenDragLeave = leave;

      const drop = await listen<{ token: string; name: string; size: number }[]>(
        "sythoria://drag-drop-tokens",
        async (event) => {
          if (activeListenerIdRef.current !== currentListenerId) return;
          useUIStore.getState().setIsDraggingFile(false);
          const uiState = useUIStore.getState();
          if (uiState.view !== "chat") return;

          const payload = event.payload;
          if (payload && payload.length > 0) {
            const chatStore = useChatStore.getState();
            for (const item of payload) {
              await chatStore.addDraftFileFromToken(item.token, item.name, item.size);
            }
          }
        },
      );
      if (!active) {
        drop();
        return;
      }
      unlistenDragDrop = drop;
    }

    setupListeners();

    return () => {
      active = false;
      if (unlistenDragEnter) unlistenDragEnter();
      if (unlistenDragOver) unlistenDragOver();
      if (unlistenDragLeave) unlistenDragLeave();
      if (unlistenDragDrop) unlistenDragDrop();
    };
  }, []);

  // Spotlight: listen for show event from backend global shortcut
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen("sythoria://spotlight-shown", () => {
        const uiState = useUIStore.getState();
        uiState.setShowSpotlight(true);
      });
    })();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;

    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const stopListening = await listen("sythoria://appshot-requested", () => {
        void useAppshotStore.getState().captureAndAttachToChat({
          skipConfirmation: true,
          revealChat: true,
        });
      });
      if (active) {
        unlisten = stopListening;
      } else {
        stopListening();
      }
    })();

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing) return;
      const recording = useKeybindStore.getState().isRecording;
      if (recording) return;

      if (
        e.key === "Escape" &&
        document.querySelector('[aria-modal="true"], [role="menu"], [data-escape-layer="true"]')
      ) {
        return;
      }

      const commandId = findMatchingCommand(e, useKeybindStore.getState().keybinds);
      if (!commandId) return;
      const executed = executeCommand(commandId, {
        toggleCompareMode: handleToggleCompareMode,
        scrollToBottom: handleScrollToBottom,
      });
      if (executed) e.preventDefault();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleToggleCompareMode, handleScrollToBottom]);

  useEffect(() => {
    return () => {
      useChatStore.getState().cleanup();
    };
  }, []);

  const handleNewChat = useCallback(() => {
    return newChat();
  }, [newChat]);

  useEffect(() => {
    const unlistens: (() => void)[] = [];
    async function setupMenuListeners() {
      const { listen } = await import("@tauri-apps/api/event");

      const un1 = await listen("menu-new-conversation", () => {
        handleNewChat();
      });
      const un2 = await listen("menu-create-project", () => {
        setView("settings");
        setActiveSection("projects");
      });
      const un3 = await listen("menu-command-palette", () => {
        toggleCommandPalette();
      });
      const un4 = await listen("menu-check-updates", () => {
        void checkForUpdates(false);
      });
      const un5 = await listen("menu-zoom-in", () => {
        useKeybindStore.getState().zoomIn();
      });
      const un6 = await listen("menu-zoom-out", () => {
        useKeybindStore.getState().zoomOut();
      });
      const un7 = await listen("menu-zoom-reset", () => {
        useKeybindStore.getState().zoomReset();
      });

      unlistens.push(un1, un2, un3, un4, un5, un6, un7);
    }
    setupMenuListeners();

    return () => {
      unlistens.forEach((fn) => fn());
    };
  }, [handleNewChat, setView, setActiveSection, checkForUpdates, toggleCommandPalette]);

  const handleDeleteChat = useCallback(
    (id: string) => {
      deleteChat(id);
    },
    [deleteChat],
  );

  const handleSelectConversation = useCallback(
    (id: string) => {
      setActiveId(id);
      setView("chat");
      setSidebarOpen(false);
    },
    [setActiveId, setView, setSidebarOpen],
  );

  const handleSettingsClick = useCallback(() => {
    setView("settings");
    setSidebarOpen(false);
  }, [setView, setSidebarOpen]);

  const handleRetry = useCallback(
    (messageId: string) => {
      if (activeId) retryLastMessage(activeId, messageId);
    },
    [activeId, retryLastMessage],
  );

  const renderArtifactContent = () => {
    if (!activeArtifact) return null;
    return (
      <div className="flex flex-1 flex-col overflow-hidden h-full">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-4">
            <h3 id={artifactTitleId} className="text-sm font-semibold text-text-primary">
              {activeArtifact.title}
            </h3>
            {(activeArtifact.type === "html" || activeArtifact.type === "svg") && (
              <div className="flex items-center gap-2 border-l border-border pl-4">
                <input
                  id="allow-network-toggle"
                  type="checkbox"
                  checked={allowArtifactNetwork}
                  onChange={(e) => setAllowArtifactNetwork(e.target.checked)}
                  className="w-3.5 h-3.5 accent-accent cursor-pointer rounded border-border"
                />
                <label
                  htmlFor="allow-network-toggle"
                  className="text-xs text-text-muted font-medium cursor-pointer select-none hover:text-text-secondary transition-colors"
                >
                  Allow Network Access
                </label>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsArtifactFullScreen(!isArtifactFullScreen)}
              className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
              aria-label={isArtifactFullScreen ? "Show side panel" : "Show full screen"}
              title={isArtifactFullScreen ? "Side Panel" : "Full Screen"}
            >
              {isArtifactFullScreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button
              onClick={closeArtifactPreview}
              className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
              aria-label="Close artifact preview"
              title="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        {activeArtifact.type === "html" || activeArtifact.type === "svg" ? (
          <iframe
            title={activeArtifact.title}
            sandbox="allow-scripts"
            srcDoc={getSafeSrcDoc(activeArtifact.content, allowArtifactNetwork)}
            className="min-h-0 flex-1 bg-white"
          />
        ) : (
          <pre className="min-h-0 flex-1 overflow-auto bg-chat p-4 font-mono text-xs text-text-primary">
            {activeArtifact.content}
          </pre>
        )}
      </div>
    );
  };

  const handlePrimaryModelChange = useCallback(
    (newModelId: string) => {
      setSelectedModel(newModelId);
      if (activeId) {
        useChatStore.setState((state) => ({
          conversations: state.conversations.map((c) => (c.id === activeId ? { ...c, model: newModelId } : c)),
        }));
        void useChatStore.getState().persistConversations();
      }
    },
    [activeId, setSelectedModel],
  );

  const handleCompareModelChange = useCallback((cId: string, newModelId: string) => {
    useChatStore.setState((state) => ({
      conversations: state.conversations.map((conv) => (conv.id === cId ? { ...conv, model: newModelId } : conv)),
    }));
    void useChatStore.getState().persistConversations();
  }, []);

  const handleCompareClose = useCallback(
    (cId: string) => {
      deleteChat(cId);
    },
    [deleteChat],
  );

  const handleCompareRetry = useCallback(
    (cId: string, messageId: string) => {
      retryLastMessage(cId, messageId);
    },
    [retryLastMessage],
  );

  const handlePrimaryScroll = useCallback(
    (top: number, ratio: number) => {
      if (activeId) handleScrollSync(activeId, top, ratio);
    },
    [activeId, handleScrollSync],
  );

  const handleCompareScroll = useCallback(
    (cId: string, top: number, ratio: number) => {
      handleScrollSync(cId, top, ratio);
    },
    [handleScrollSync],
  );

  if (startupRecovery) {
    return (
      <div className="flex h-screen w-screen overflow-hidden flex-col bg-transparent">
        <TitleBar />
        <main
          className="glass-loading-screen flex flex-1 items-center justify-center p-6"
          aria-labelledby="recovery-title"
        >
          <section className="glass-panel w-full max-w-lg rounded-2xl border border-border p-6 text-center shadow-xl">
            <ShieldAlert className="mx-auto mb-4 text-warning" size={32} aria-hidden="true" />
            <h1 id="recovery-title" className="text-lg font-semibold text-text-primary">
              Recovery mode
            </h1>
            <p className="mt-3 text-sm leading-6 text-text-secondary">{startupRecovery.message}</p>
            <p className="mt-2 text-xs leading-5 text-text-muted">{startupRecovery.detail}</p>
            <p className="mt-4 text-xs leading-5 text-text-muted">
              Persistence is disabled for this session to prevent empty defaults from overwriting your data. Check
              credential-vault and file access, then restart Sythoria.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mx-auto mt-5 inline-flex min-h-9 items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <RotateCcw size={15} aria-hidden="true" />
              Retry startup
            </button>
          </section>
        </main>
      </div>
    );
  }

  if (!isConfigLoaded || loading.init) {
    return (
      <div className="flex h-screen w-screen overflow-hidden flex-col bg-transparent">
        <TitleBar />
        <div
          className="glass-loading-screen flex flex-1 items-center justify-center"
          role="status"
          aria-label="Loading application"
        >
          <div className="flex flex-col items-center gap-3">
            <Spinner size="lg" />
            <p className="text-sm text-text-muted">Loading Sythoria...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!hasStarted) {
    return <StartScreen onStart={() => setHasStarted(true)} />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden flex-col bg-transparent">
      <TitleBar />
      <Suspense fallback={null}>
        {showCommandPalette && <CommandPalette />}
        {showSpotlight && <SpotlightArea />}
      </Suspense>
      <div className="flex flex-1 overflow-hidden relative glass-app-container">
        <AnimatePresence>{isDraggingFile && <DragOverlay />}</AnimatePresence>
        {!(view === "settings" && (isMobile ? sidebarOpenForViewport : !sidebarCollapsed)) && (
          <div
            className={`absolute top-0 left-0 z-50 flex items-center ${isMac ? "h-14 macos-traffic-light-inset" : "h-[32px] pl-4"}`}
            data-tauri-drag-region={isMac ? true : undefined}
          >
            <div className="flex items-center gap-1 h-full">
              <button
                onClick={toggleSidebarCollapsed}
                className="hidden md:flex p-1.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-hover transition-colors items-center justify-center"
                aria-label={sidebarCollapsed ? t("tooltip.expandSidebar") : t("tooltip.collapseSidebar")}
                title={sidebarCollapsed ? t("tooltip.expandSidebar") : t("tooltip.collapseSidebar")}
              >
                <PanelLeft size={16} />
              </button>

              {!sidebarOpenForViewport && (
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="flex md:hidden p-1.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-hover transition-colors items-center justify-center"
                  aria-label={t("tooltip.openSidebar") || "Open sidebar"}
                  title={t("tooltip.openSidebar") || "Open sidebar"}
                >
                  <Menu size={16} />
                </button>
              )}

              {/* History navigation arrows */}
              <div className="hidden md:flex items-center gap-0.5 mx-1">
                <button
                  onClick={navigateBack}
                  disabled={!(navigationIndex > 0)}
                  className={`p-1 rounded-md transition-colors ${
                    navigationIndex > 0
                      ? "text-text-secondary hover:bg-hover cursor-pointer"
                      : "text-text-muted/30 cursor-not-allowed"
                  }`}
                  aria-label={t("tooltip.navigateBack") || "Navigate back"}
                  title={t("common.back") || "Back"}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={navigateForward}
                  disabled={!(navigationIndex < navigationHistory.length - 1 && navigationHistory.length > 0)}
                  className={`p-1 rounded-md transition-colors ${
                    navigationIndex < navigationHistory.length - 1 && navigationHistory.length > 0
                      ? "text-text-secondary hover:bg-hover cursor-pointer"
                      : "text-text-muted/30 cursor-not-allowed"
                  }`}
                  aria-label={t("tooltip.navigateForward") || "Navigate forward"}
                  title={t("tooltip.navigateForward") || "Forward"}
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              <AnimatePresence>
                {sidebarCollapsed && (
                  <motion.button
                    key="new-chat-btn"
                    initial={{ opacity: 0, scale: 0.8, x: -10 }}
                    animate={{ opacity: 1, scale: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.8, x: -10 }}
                    transition={motionTransitions.popoverEnter}
                    onClick={handleNewChat}
                    className="hidden md:flex p-1.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-hover transition-colors items-center justify-center"
                    aria-label={t("common.newChat") || "Start new chat"}
                    title={t("common.newChat") || "New Chat"}
                  >
                    <MessageSquarePlus size={16} />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}

        <Sidebar
          conversations={conversations}
          activeId={activeId}
          onSelect={handleSelectConversation}
          onNewChat={handleNewChat}
          onSettingsClick={handleSettingsClick}
          onDeleteChat={handleDeleteChat}
          onRenameChat={openRenameModal}
          onExportChat={exportChat}
          onPinChat={togglePinChat}
          isOpen={sidebarOpenForViewport}
          onClose={() => setSidebarOpen(false)}
          modelStatuses={modelStatuses}
          isCollapsed={sidebarCollapsed}
          isMobile={isMobile}
        />

        <div className="native-backdrop-content flex-1 flex flex-col min-w-0 overflow-hidden relative bg-chat">
          <AnimatePresence mode="wait">
            {view === "settings" ? (
              <motion.div
                key="settings"
                className="flex-1 flex flex-col min-w-0 overflow-hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: motionTransitions.panelExit }}
                transition={motionTransitions.panelEnter}
              >
                <Suspense
                  fallback={
                    <div
                      className="flex flex-1 items-center justify-center"
                      role="status"
                      aria-label="Loading settings"
                    >
                      <Spinner size="lg" />
                    </div>
                  }
                >
                  <Settings />
                </Suspense>
              </motion.div>
            ) : (
              <motion.main
                key="chat"
                className="chat-focus-scope flex-1 flex flex-col min-w-0 min-h-0 relative"
                aria-label="Chat area"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: motionTransitions.panelExit }}
                transition={motionTransitions.panelEnter}
              >
                <header
                  className={`chat-titlebar shrink-0 flex items-center justify-between px-4 md:px-6 bg-chat/80 backdrop-blur-md relative z-20 ${
                    isMac ? "h-14 py-0" : "py-4 pt-6"
                  }`}
                  data-tauri-drag-region={isMac ? true : undefined}
                >
                  <div className="flex items-center gap-2 pl-12 md:pl-28 z-20">
                    {activeConversation?.isSubagent && activeConversation.parentId && (
                      <button
                        onClick={() => setActiveId(activeConversation.parentId!)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-accent-soft/50 hover:bg-accent-soft/80 text-text-primary text-xs transition-colors font-medium border border-border/30 cursor-pointer shadow-sm"
                        title={`Return to: ${parentConversation?.title || "Parent Chat"}`}
                      >
                        <ArrowLeft size={14} className="text-accent" />
                        <span>Parent Chat</span>
                      </button>
                    )}
                  </div>
                  {!activeConversation?.isTemporary && (
                    <div className="absolute left-1/2 -translate-x-1/2">
                      <motion.h2
                        className="max-w-[min(42vw,32rem)] truncate text-sm font-medium text-text-secondary"
                        key={activeConversation?.id ?? "empty"}
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={motionTransitions.content}
                      >
                        {activeConversation
                          ? activeConversation.title === "Untitled" || !activeConversation.title
                            ? t("common.untitled")
                            : activeConversation.title.endsWith(" (Compare)")
                              ? `${activeConversation.title.slice(0, -10)} (${t("common.compare")})`
                              : activeConversation.title
                          : t("common.newChat")}
                      </motion.h2>
                    </div>
                  )}
                  <div className="flex items-center gap-2 ml-auto relative">
                    {isCompareMode && (
                      <>
                        <button
                          onClick={() => setSyncScrolls(!syncScrolls)}
                          className={`p-1.5 rounded-md transition-colors ${
                            syncScrolls
                              ? "text-accent bg-accent/10 hover:bg-accent/15"
                              : "text-text-muted hover:text-text-secondary hover:bg-hover"
                          }`}
                          aria-label={syncScrolls ? t("tooltip.disableSyncScrolls") : t("tooltip.syncScrolls")}
                          title={syncScrolls ? t("tooltip.disableSyncScrolls") : t("tooltip.syncScrolls")}
                        >
                          <Link size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={handleAddComparison}
                          className="p-1.5 rounded-md text-text-muted transition-colors hover:bg-hover hover:text-text-secondary"
                          aria-label={t("tooltip.addComparison") || "Add another comparison"}
                          title={t("tooltip.addComparison") || "Add another comparison"}
                        >
                          <Plus size={16} aria-hidden="true" />
                        </button>
                      </>
                    )}
                    <button
                      onClick={handleToggleTemporaryChat}
                      className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                        activeConversation?.isTemporary
                          ? "text-accent bg-accent/10 hover:bg-accent/15"
                          : "text-text-muted hover:text-text-secondary hover:bg-hover"
                      }`}
                      aria-label={activeConversation?.isTemporary ? "Disable temporary chat" : "Enable temporary chat"}
                      title={activeConversation?.isTemporary ? "Disable temporary chat" : "Enable temporary chat"}
                    >
                      <Ghost size={16} className={activeConversation?.isTemporary ? "animate-pulse" : ""} />
                    </button>
                    <button
                      onClick={handleToggleCompareMode}
                      className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                        isCompareMode
                          ? "text-accent bg-accent/10 hover:bg-accent/15"
                          : "text-text-muted hover:text-text-secondary hover:bg-hover"
                      }`}
                      aria-label={isCompareMode ? t("tooltip.disableCompare") : t("tooltip.enableCompare")}
                      title={isCompareMode ? t("tooltip.disableCompare") : t("tooltip.enableCompare")}
                    >
                      <Split size={16} />
                    </button>
                    {showAuxiliaryPanel && !isMobile && (
                      <button
                        type="button"
                        onClick={() => setAuxPanelExpanded(!isAuxPanelExpanded)}
                        className="p-1.5 rounded-md text-text-muted transition-colors hover:bg-hover hover:text-text-secondary"
                        aria-label={
                          isAuxPanelExpanded ? "Restore workspace panel with side chat" : "Expand workspace panel"
                        }
                        title={isAuxPanelExpanded ? "Restore workspace panel with side chat" : "Expand workspace panel"}
                      >
                        {isAuxPanelExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                      </button>
                    )}
                    {isProjectsEnabled && (
                      <button
                        onClick={() => {
                          if (isAuxPanelOpen) {
                            setAuxPanelOpen(false);
                            return;
                          }
                          setActiveAuxConversationId(null);
                          setActiveAuxTab(null);
                          setAuxPanelOpen(true);
                        }}
                        className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                          isAuxPanelOpen
                            ? "text-accent bg-accent/10 hover:bg-accent/15"
                            : "text-text-muted hover:text-text-secondary hover:bg-hover"
                        }`}
                        aria-label={isAuxPanelOpen ? "Close workspace panel" : "Open workspace panel"}
                        title={isAuxPanelOpen ? "Close workspace panel" : "Open workspace panel"}
                      >
                        <PanelRight size={16} />
                      </button>
                    )}
                  </div>
                </header>

                <div ref={workspaceSplitRef} className="flex-1 min-h-0 flex flex-row overflow-hidden relative">
                  {/* Left Column */}
                  <motion.div
                    className="min-w-0 min-h-0 flex flex-1 flex-col relative overflow-hidden"
                    aria-hidden={isWorkspacePanelFull}
                    inert={isWorkspacePanelFull ? true : undefined}
                  >
                    <div className="relative flex min-h-0 flex-1 flex-col">
                      <Suspense
                        fallback={
                          <div
                            className="flex flex-1 items-center justify-center"
                            role="status"
                            aria-label="Loading chat"
                          >
                            <Spinner size="lg" />
                          </div>
                        }
                      >
                        {isCompareMode && compareConversations.length > 0 ? (
                          <div className="comparison-grid-container">
                            {/* Primary Column */}
                            <ComparisonColumn
                              conversation={activeConversation!}
                              isPrimary={true}
                              label={t("chat.primary")}
                              models={models}
                              onModelChange={handlePrimaryModelChange}
                              onRetry={handleRetry}
                              isStreaming={isStreaming}
                              onScroll={syncScrolls ? handlePrimaryScroll : undefined}
                              ref={primaryComparisonRef}
                            />

                            {/* Comparison Columns */}
                            {compareConversations.map((c, index) => {
                              return (
                                <ComparisonColumn
                                  key={c.id}
                                  conversation={c}
                                  label={`${t("chat.comparison")} ${index + 1}`}
                                  models={models}
                                  onModelChange={(newModelId) => handleCompareModelChange(c.id, newModelId)}
                                  onClose={() => handleCompareClose(c.id)}
                                  onRetry={(messageId) => handleCompareRetry(c.id, messageId)}
                                  isStreaming={isStreaming}
                                  onScroll={
                                    syncScrolls ? (top, ratio) => handleCompareScroll(c.id, top, ratio) : undefined
                                  }
                                  ref={(el) => {
                                    compareRefsMap.current[c.id] = el;
                                  }}
                                />
                              );
                            })}
                          </div>
                        ) : (
                          <ChatArea
                            messages={messages}
                            setIsAtBottom={primarySetIsAtBottom}
                            virtuosoRef={primaryVirtuosoRef}
                            onRetry={handleRetry}
                            conversationId={activeId || undefined}
                          />
                        )}
                      </Suspense>

                      <AnimatePresence>
                        {showScrollToBottom && messages.length > 0 && !isPrimaryGenerating && (
                          <motion.div
                            className="absolute left-1/2 z-30 -translate-x-1/2"
                            style={{ bottom: "calc(var(--chat-composer-height, 14rem) + 0.75rem)" }}
                            initial={{ opacity: 0, y: 12, scale: 0.9 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 12, scale: 0.9 }}
                            transition={motionTransitions.popoverEnter}
                          >
                            <ScrollToBottomButton onClick={handleScrollToBottom} hasNewMessages={hasNewMessages} />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    <InputBar
                      models={models}
                      onSend={handleSendMessage}
                      selectedModel={activeConversation?.model || selectedModel}
                      onModelChange={handlePrimaryModelChange}
                      disabled={isInputDisabled}
                      modelStatuses={modelStatuses}
                      searchConfigId={activeSearchId}
                      mcpServers={mcpConfigs}
                      mcpServerStatuses={serverStatuses}
                      isStreaming={isPrimaryGenerating}
                      onStop={stopStreaming}
                      centered={messages.length === 0 && !isCompareMode}
                      isCompareMode={isCompareMode}
                    />
                  </motion.div>

                  <AnimatePresence>
                    {showAuxiliaryPanel && (
                      <motion.div
                        key="workspace-panel"
                        className="relative z-20 flex min-h-0 min-w-0 shrink-0 flex-col border-l border-border/50 bg-chat"
                        initial="collapsed"
                        animate="expanded"
                        exit="collapsed"
                        variants={auxiliaryPanelVariants}
                      >
                        {!isWorkspacePanelFull && (
                          // The adjustable separator follows the WAI-ARIA window-splitter pattern.
                          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
                          <div
                            className="group absolute -left-1 top-0 z-40 hidden h-full w-2 cursor-col-resize touch-none select-none focus-visible:outline-none md:block"
                            role="separator"
                            aria-label="Resize workspace panel"
                            aria-orientation="vertical"
                            aria-valuemin={auxPanelBounds.min}
                            aria-valuemax={auxPanelBounds.max}
                            aria-valuenow={Math.round(visualAuxPanelWidth)}
                            tabIndex={0}
                            title="Drag to resize; double-click to reset"
                            onPointerDown={startAuxPanelResize}
                            onPointerMove={resizeAuxPanel}
                            onPointerUp={endAuxPanelResize}
                            onPointerCancel={endAuxPanelResize}
                            onLostPointerCapture={stopAuxPanelResize}
                            onKeyDown={handleAuxPanelResizeKeyDown}
                            onDoubleClick={resetAuxPanelWidth}
                          >
                            <span className="pointer-events-none absolute left-1/2 top-1/2 h-12 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent opacity-0 transition-opacity group-hover:opacity-40 group-active:opacity-70 group-focus-visible:opacity-60" />
                          </div>
                        )}
                        <div className="h-full shrink-0 overflow-hidden" style={{ width: auxiliaryPanelTargetWidth }}>
                          <Suspense
                            fallback={
                              <div
                                className="flex h-full items-center justify-center"
                                role="status"
                                aria-label="Loading workspace panel"
                              >
                                <Spinner size="md" />
                              </div>
                            }
                          >
                            <AuxiliaryPanel />
                          </Suspense>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.main>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {showRenameModal && (
          <motion.div
            key="rename-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionTransitions.modalEnter}
          >
            <RenameChatModal
              isOpen={showRenameModal}
              currentTitle={renameCurrentTitle}
              onConfirm={confirmRename}
              onCancel={closeRenameModal}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <Suspense fallback={null}>{showProjectConfigModal && <ProjectConfigModal />}</Suspense>
      <ToolConfirmationModal
        confirmation={
          pendingToolConfirmations && pendingToolConfirmations.length > 0 ? pendingToolConfirmations[0] : null
        }
        onRespond={respondToToolConfirmation}
      />
      <UpdateModal
        isOpen={showUpdateModal}
        onClose={() => setShowUpdateModal(false)}
        onInstall={installUpdate}
        currentVersion={updateInfo?.currentVersion || ""}
        latestVersion={updateInfo?.latestVersion || ""}
        releaseNotes={updateInfo?.releaseNotes}
        isInstalling={isInstallingUpdate}
        downloadProgress={updateDownloadProgress}
        error={updateError}
      />
      <LinkWarningModal />
      <AnimatePresence>
        {activeArtifact && isArtifactFullScreen && (
          <motion.div
            key="artifact-preview-fullscreen"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-transparent"
            role="dialog"
            aria-modal="true"
            aria-labelledby={artifactTitleId}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionTransitions.modalEnter}
          >
            <div
              className="absolute inset-0 cursor-default"
              style={{ backgroundColor: "var(--theme-overlay)" }}
              onClick={closeArtifactPreview}
              aria-hidden="true"
              data-dialog-backdrop
            />
            <motion.div
              ref={artifactDialogRef}
              tabIndex={-1}
              className="relative z-10 flex h-[min(760px,90vh)] w-[min(980px,92vw)] flex-col overflow-hidden rounded-xl border border-border bg-surface"
              style={{ boxShadow: "var(--shadow-xl)" }}
              initial={{ opacity: 0, scale: 0.98, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 8 }}
              transition={motionTransitions.modalEnter}
            >
              {renderArtifactContent()}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default App;
