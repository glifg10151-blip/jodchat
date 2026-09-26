import { useState, useRef, useEffect, useCallback, memo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Plus,
  Paperclip,
  ChevronDown,
  Check,
  Search,
  Square,
  Loader2,
  Cpu,
  X,
  Image as ImageIcon,
  FileText as FileTextIcon,
  ArrowUp,
  Folder,
  FolderPlus,
  ShieldAlert,
  Shield,
  FolderOpen,
  Settings,
  Mic,
  Bot,
  Database,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useWhisperStore } from "../store/useWhisperStore";
import { WHISPER_PRESETS } from "../config/whisperPresets";
import { ModelConfig, McpServerConfig, McpServerStatus, Attachment, ProjectPermission } from "../types";
import type { ModelStatuses } from "../types";
import { MAX_INPUT_LENGTH, MAX_TEXTAREA_HEIGHT, PASTED_TEXT_FILE_THRESHOLD } from "../config/constants";

import { formatFileSize } from "../utils/attachments";
import { motionTokens, motionTransitions } from "../lib/motion-tokens";
import { useAttachments } from "../hooks/useAttachments";
import { useUIStore } from "../store/useUIStore";
import { useModelStore } from "../store/useModelStore";
import { useChatStore } from "../store/useChatStore";
import type { SendMessageStatus } from "../store/useChatStore";
import { useProjectStore } from "../store/useProjectStore";
import { estimateConversationTokens } from "../utils/tokens";
import { parseApiError } from "../utils/parseApiError";
import { resolveContextBudget } from "../services/contextAssembler";
import { buildConversationContextMessages } from "../services/toolLoop";
import { ImagePreviewModal } from "./ui/ImagePreviewModal";
import { useTranslation } from "../utils/i18n";
import { ResponseSettingsSelector } from "./ResponseSettingsSelector";
import { useShallow } from "zustand/react/shallow";
import { PromptEditor, type PromptDraft, type PromptDraftChangeOrigin, type PromptEditorHandle } from "./PromptEditor";
import { WorkspaceChangeIndicator } from "./WorkspaceChangeIndicator";

interface InputBarProps {
  models: ModelConfig[];
  onSend: (
    message: string,
    attachments?: Attachment[],
    mcpServerIds?: string[],
    searchConfigId?: string | null,
  ) => Promise<SendMessageStatus>;
  selectedModel: string;
  onModelChange: (model: string) => void;
  disabled?: boolean;
  modelStatuses: ModelStatuses;
  searchConfigId?: string | null;
  mcpServers: McpServerConfig[];
  mcpServerStatuses: Record<string, McpServerStatus>;
  isStreaming?: boolean;
  onStop?: () => void;
  centered?: boolean;
  isCompareMode?: boolean;
  conversationId?: string;
  idPrefix?: string;
  isolatedAttachments?: boolean;
}

export default memo(function InputBar({
  models,
  onSend,
  selectedModel,
  onModelChange,
  disabled,
  modelStatuses,
  searchConfigId,
  mcpServers,
  mcpServerStatuses,
  isStreaming,
  onStop,
  centered = false,
  isCompareMode = false,
  conversationId,
  idPrefix,
  isolatedAttachments = false,
}: InputBarProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [mcpMentionServerIds, setMcpMentionServerIds] = useState<string[]>([]);
  const [hasWebSearchMention, setHasWebSearchMention] = useState(false);
  const elementId = (id: string) => (idPrefix ? `${idPrefix}-${id}` : id);
  const [plusOpen, setPlusOpen] = useState(false);
  const [contextDetailsShiftX, setContextDetailsShiftX] = useState(0);
  const [endpointTokenCount, setEndpointTokenCount] = useState<{
    count: number | null;
    loading: boolean;
    error: string | null;
  }>({ count: null, loading: false, error: null });
  const editorHandleRef = useRef<PromptEditorHandle>(null);
  const plusDropdownRef = useRef<HTMLDivElement>(null);
  const projectDropdownRef = useRef<HTMLDivElement>(null);
  const contextDetailsRef = useRef<HTMLDivElement>(null);
  const composerDockRef = useRef<HTMLDivElement>(null);

  const { projects, activeProjectId, setActiveProject, updateProject, isProjectsEnabled } = useProjectStore(
    useShallow((state) => ({
      projects: state.projects,
      activeProjectId: state.activeProjectId,
      setActiveProject: state.setActiveProject,
      updateProject: state.updateProject,
      isProjectsEnabled: state.isProjectsEnabled,
    })),
  );
  const openProjectConfigModal = useUIStore((s) => s.openProjectConfigModal);
  const addToast = useUIStore((s) => s.addToast);
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const activeProject = projects.find((p) => p.id === activeProjectId);

  const { attachments, setAttachments, isDragging, setIsDragging, fileInputRef, handleAddFiles, handleFileChange } =
    useAttachments(isolatedAttachments);

  const handlePastedText = useCallback(
    (text: string) => {
      if (text.length < PASTED_TEXT_FILE_THRESHOLD) return false;

      const existingNames = new Set(attachments.map((attachment) => attachment.name));
      let filename = "pasted-text.txt";
      let suffix = 2;
      while (existingNames.has(filename)) {
        filename = `pasted-text-${suffix}.txt`;
        suffix += 1;
      }

      void handleAddFiles([new File([text], filename, { type: "text/plain" })]);
      return true;
    },
    [attachments, handleAddFiles],
  );

  const [previewImageIndex, setPreviewImageIndex] = useState<number | null>(null);
  const imageAttachments = attachments.filter((a) => a.kind === "image" && a.dataUrl);
  const [voiceDraft, setVoiceDraft] = useState<string>("");
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRecordingActiveRef = useRef<boolean>(false);
  const recordingSessionIdRef = useRef<string | null>(null);
  const recordingAbortRef = useRef<AbortController | null>(null);
  const refinementUnlistenRef = useRef<UnlistenFn | null>(null);
  const refinementStreamIdRef = useRef<string | null>(null);
  const unmountedRef = useRef(false);
  const initialValueRef = useRef<string>("");
  const recognitionRef = useRef<{ stop: () => void } | null>(null);

  const handleEditorDraftChange = useCallback(
    (draft: PromptDraft, origin: PromptDraftChangeOrigin) => {
      setValue(draft.text);
      setMcpMentionServerIds(draft.mcpServerIds);
      setHasWebSearchMention(draft.hasWebSearchMention);
      if (origin === "user" && voiceDraft && draft.text.trim() !== voiceDraft.trim()) setVoiceDraft("");
    },
    [voiceDraft],
  );

  const replaceEditorText = useCallback((text: string) => {
    editorHandleRef.current?.replaceText(text);
  }, []);

  const saveEditorSelection = useCallback(() => {
    editorHandleRef.current?.saveSelection();
  }, []);

  const insertMcpMention = useCallback(
    (server: McpServerConfig) => {
      if (disabled || isStreaming) return;
      if (editorHandleRef.current?.insertMcpMention(server)) setPlusOpen(false);
    },
    [disabled, isStreaming],
  );

  const insertWebSearchMention = useCallback(() => {
    if (disabled || isStreaming || !searchConfigId) return;
    editorHandleRef.current?.insertWebSearchMention();
    setPlusOpen(false);
  }, [disabled, isStreaming, searchConfigId]);

  const sendMessageShortcut = useUIStore((s) => s.sendMessageShortcut);
  const clearInputOnEscape = useUIStore((s) => s.clearInputOnEscape);
  const baseTextSize = useUIStore((s) => s.baseTextSize);
  const showContextWindow = useUIStore((s) => s.showContextWindow);
  const contextTokenizationMode = useUIStore((s) => s.contextTokenizationMode);
  const offlineMode = useUIStore((s) => s.offlineMode);
  const storeActiveConversationId = useChatStore((s) => s.activeId);
  const activeConversationId = conversationId || storeActiveConversationId;
  const conversation = useChatStore((s) => s.conversations.find((c) => c.id === activeConversationId));
  const setConversationProject = useChatStore((s) => s.setConversationProject);
  const systemPrompt = useModelStore((s) => s.systemPrompt);

  const {
    isVoiceEnabled,
    selectedModelId,
    customModelPath,
    language,
    isRecording,
    isTranscribing,
    setIsRecording,
    setIsTranscribing,
    init: initWhisper,
    downloadedFiles,
    sttProvider,
    cloudApiKey,
    cloudApiKeyConfigured,
    ensureCloudApiKeySaved,
    cloudApiUrl,
    cloudModel,
    isLlmPolishEnabled,
    refinementModelId,
  } = useWhisperStore(
    useShallow((state) => ({
      isVoiceEnabled: state.isVoiceEnabled,
      selectedModelId: state.selectedModelId,
      customModelPath: state.customModelPath,
      language: state.language,
      isRecording: state.isRecording,
      isTranscribing: state.isTranscribing,
      setIsRecording: state.setIsRecording,
      setIsTranscribing: state.setIsTranscribing,
      init: state.init,
      downloadedFiles: state.downloadedFiles,
      sttProvider: state.sttProvider,
      cloudApiKey: state.cloudApiKey,
      cloudApiKeyConfigured: state.cloudApiKeyConfigured,
      ensureCloudApiKeySaved: state.ensureCloudApiKeySaved,
      cloudApiUrl: state.cloudApiUrl,
      cloudModel: state.cloudModel,
      isLlmPolishEnabled: state.isLlmPolishEnabled,
      refinementModelId: state.refinementModelId,
    })),
  );

  const cancelActiveRefinement = useCallback(() => {
    refinementUnlistenRef.current?.();
    refinementUnlistenRef.current = null;
    const streamId = refinementStreamIdRef.current;
    refinementStreamIdRef.current = null;
    if (streamId) {
      void invoke("cancel_chat_stream", { streamId });
    }
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    void initWhisper();
    return () => {
      unmountedRef.current = true;
      isRecordingActiveRef.current = false;
      recordingAbortRef.current?.abort();
      recordingAbortRef.current = null;
      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
        recordingTimeoutRef.current = null;
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
      cancelActiveRefinement();
      const sessionId = recordingSessionIdRef.current;
      recordingSessionIdRef.current = null;
      if (sessionId) {
        void invoke("stop_recording", { sessionId });
      }
      useWhisperStore.getState().setIsRecording(false);
      useWhisperStore.getState().setIsTranscribing(false);
    };
  }, [cancelActiveRefinement, initWhisper]);

  const handleToggleVoice = async () => {
    // Check if Whisper model is ready (chosen, downloaded, or loaded)
    let isModelReady = false;
    let modelPath = "";
    if (selectedModelId === "custom" && customModelPath) {
      isModelReady = downloadedFiles.includes(customModelPath);
      modelPath = customModelPath;
    } else {
      const preset = WHISPER_PRESETS.find((p) => p.id === selectedModelId);
      if (preset) {
        modelPath = preset.fileName;
        if (downloadedFiles.includes(preset.fileName)) {
          isModelReady = true;
        }
      }
    }

    if (sttProvider === "local") {
      if (!selectedModelId || !modelPath || !isModelReady) {
        useUIStore.getState().addToast(
          <span>
            Voice input model is not loaded, visit{" "}
            <button
              onClick={() => {
                useUIStore.getState().setView("settings");
                useUIStore.getState().setActiveSection("whisper");
              }}
              className="text-red-200 underline font-medium hover:text-white transition-colors cursor-pointer"
            >
              settings/voiceinput
            </button>{" "}
            for more details.
          </span>,
          "error",
        );
        return;
      }
    } else if (sttProvider === "cloud") {
      const cloudKeyReady = cloudApiKey ? await ensureCloudApiKeySaved() : cloudApiKeyConfigured;
      if (!cloudKeyReady || !cloudApiUrl) {
        useUIStore.getState().addToast("Cloud STT API Key or URL is not configured.", "error");
        return;
      }
    }

    if (isRecording) {
      const sessionId = recordingSessionIdRef.current;
      if (!sessionId) {
        setIsRecording(false);
        return;
      }
      const sessionAbort = recordingAbortRef.current ?? new AbortController();
      isRecordingActiveRef.current = false;
      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
        recordingTimeoutRef.current = null;
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          console.warn("Speech recognition stop error:", e);
        }
        recognitionRef.current = null;
      }
      setIsRecording(false);
      setIsTranscribing(true);

      try {
        await invoke("stop_recording", { sessionId });
        if (sessionAbort.signal.aborted) return;

        let transcription = "";
        if (sttProvider === "cloud") {
          transcription = await invoke<string>("transcribe_audio_cloud", {
            apiUrl: cloudApiUrl,
            model: cloudModel,
            language,
            recordingSessionId: sessionId,
          });
        } else {
          transcription = await invoke<string>("transcribe_audio", {
            modelPath,
            audioData: [],
            language,
            recordingSessionId: sessionId,
          });
        }
        if (sessionAbort.signal.aborted || recordingSessionIdRef.current !== sessionId) return;

        const rawText = transcription.trim();
        if (rawText) {
          const combinedRaw = initialValueRef.current ? `${initialValueRef.current} ${rawText}` : rawText;
          replaceEditorText(combinedRaw);
          setVoiceDraft(combinedRaw);

          if (!isLlmPolishEnabled) return;

          useUIStore.getState().addToast("Refining speech...", "info");

          const streamId = "refine-" + Math.random().toString().slice(2, 10);
          let accumulated = "";
          let unlistenChunk: UnlistenFn | null = null;
          refinementStreamIdRef.current = streamId;

          try {
            unlistenChunk = await listen<{
              streamId: string;
              content: string;
              kind?: "content" | "reasoning";
            }>("chat-stream-chunk", (event) => {
              if (
                !sessionAbort.signal.aborted &&
                event.payload.streamId === streamId &&
                (event.payload.kind ?? "content") === "content"
              ) {
                accumulated += event.payload.content;
                const combinedRefined = initialValueRef.current
                  ? `${initialValueRef.current} ${accumulated}`
                  : accumulated;
                replaceEditorText(combinedRefined);
              }
            });
            refinementUnlistenRef.current = unlistenChunk;
            if (sessionAbort.signal.aborted) return;

            const modelStore = useModelStore.getState();
            const targetModelId = refinementModelId || modelStore.selectedModel || modelStore.models[0]?.id;
            const currentModel = modelStore.models.find((m) => m.id === targetModelId) || modelStore.models[0];

            if (currentModel) {
              replaceEditorText(initialValueRef.current);

              await invoke<string>("chat_stream", {
                configId: currentModel.id,
                messages: [
                  {
                    role: "system",
                    content:
                      "Clean filler words (uh, um, then, like) and speech bugs from this transcript. Output ONLY refined sentences. Do not add intro/outro.",
                  },
                  { role: "user", content: combinedRaw },
                ],
                temperature: 0.1,
                streamId,
                maxTokens: 500,
              });
            }
          } finally {
            unlistenChunk?.();
            if (refinementUnlistenRef.current === unlistenChunk) {
              refinementUnlistenRef.current = null;
            }
            if (refinementStreamIdRef.current === streamId) {
              refinementStreamIdRef.current = null;
            }
            if (sessionAbort.signal.aborted) {
              void invoke("cancel_chat_stream", { streamId });
            }
          }
        }
      } catch (err: unknown) {
        if (!sessionAbort.signal.aborted) {
          const message = err instanceof Error ? err.message : String(err);
          useUIStore.getState().addToast(`Voice transcription failed: ${message}`, "error");
        }
      } finally {
        try {
          await invoke("stop_recording", { sessionId });
        } catch {
          // The session may already have been stopped or superseded.
        }
        if (recordingSessionIdRef.current === sessionId) {
          recordingSessionIdRef.current = null;
          recordingAbortRef.current?.abort();
          recordingAbortRef.current = null;
        }
        if (!unmountedRef.current) {
          setIsTranscribing(false);
          setVoiceDraft("");
        }
      }
    } else {
      const sessionId = crypto.randomUUID();
      const sessionAbort = new AbortController();
      recordingSessionIdRef.current = sessionId;
      recordingAbortRef.current?.abort();
      recordingAbortRef.current = sessionAbort;
      try {
        initialValueRef.current = editorHandleRef.current?.readDraft().plainText ?? value;
        await invoke("start_recording", { sessionId });
        if (sessionAbort.signal.aborted) {
          await invoke("stop_recording", { sessionId });
          return;
        }
        setIsRecording(true);

        isRecordingActiveRef.current = true;
        const pollTranscription = async () => {
          if (
            sessionAbort.signal.aborted ||
            !isRecordingActiveRef.current ||
            recordingSessionIdRef.current !== sessionId
          ) {
            return;
          }
          try {
            let transcription = "";
            if (sttProvider === "cloud") {
              transcription = await invoke<string>("transcribe_audio_cloud", {
                apiUrl: cloudApiUrl,
                model: cloudModel,
                language,
                recordingSessionId: sessionId,
              });
            } else {
              transcription = await invoke<string>("transcribe_audio", {
                modelPath,
                audioData: [],
                language,
                recordingSessionId: sessionId,
              });
            }

            if (
              !sessionAbort.signal.aborted &&
              isRecordingActiveRef.current &&
              recordingSessionIdRef.current === sessionId &&
              transcription.trim()
            ) {
              const combined = initialValueRef.current
                ? `${initialValueRef.current} ${transcription.trim()}`
                : transcription.trim();
              replaceEditorText(combined);
              setVoiceDraft(combined);
            }
          } catch (e) {
            if (!sessionAbort.signal.aborted) {
              console.warn("Live transcription error:", e);
            }
          }
          if (
            !sessionAbort.signal.aborted &&
            isRecordingActiveRef.current &&
            recordingSessionIdRef.current === sessionId
          ) {
            recordingTimeoutRef.current = setTimeout(pollTranscription, 1200);
          }
        };

        recordingTimeoutRef.current = setTimeout(pollTranscription, 1200);
      } catch (err: unknown) {
        sessionAbort.abort();
        isRecordingActiveRef.current = false;
        if (recordingSessionIdRef.current === sessionId) {
          recordingSessionIdRef.current = null;
          recordingAbortRef.current = null;
        }
        try {
          await invoke("stop_recording", { sessionId });
        } catch {
          // Starting may have failed before the native session was registered.
        }
        if (!unmountedRef.current) {
          setIsRecording(false);
          const message = err instanceof Error ? err.message : String(err);
          useUIStore.getState().addToast(`Could not access microphone: ${message}`, "error");
        }
      }
    }
  };

  const textSizeClass =
    {
      small: "text-xs",
      medium: "text-sm",
      large: "text-base",
      xlarge: "text-lg",
    }[baseTextSize] || "text-sm";

  const anyToolActive = hasWebSearchMention || mcpMentionServerIds.length > 0;
  const connectedMcpServers = mcpServers.filter((s) => (mcpServerStatuses[s.id] ?? "disconnected") === "connected");

  const isOverLimit = value.length > MAX_INPUT_LENGTH;
  const trimmed = value.trim();
  const canSend = (trimmed.length > 0 || attachments.length > 0) && !isOverLimit && !disabled && !isStreaming;

  useEffect(() => {
    if (isStreaming && document.activeElement?.id === (idPrefix ? `${idPrefix}-chat-input` : "chat-input")) {
      (document.activeElement as HTMLElement).blur();
    }
  }, [idPrefix, isStreaming]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (plusDropdownRef.current && !plusDropdownRef.current.contains(e.target as Node)) {
        setPlusOpen(false);
      }
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(e.target as Node)) {
        setProjectDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleToggleProjectPermission = async (perm: ProjectPermission) => {
    if (!activeProject) return;
    if (perm === "full" && activeProject.permissions !== "full") {
      const confirmed = window.confirm(
        "WARNING: Enabling Full Shell gives the AI complete access to run arbitrary shell commands on your system. Only enable this for trusted tasks and projects. Continue?",
      );
      if (!confirmed) return;
    }
    try {
      await updateProject(activeProject.id, { permissions: perm });
      setProjectDropdownOpen(false);
    } catch (error) {
      addToast(
        `Could not save project permissions: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  };

  const handleSubmit = useCallback(async () => {
    if (!canSend) return;
    // The contenteditable DOM is the authoritative draft. Reading it here keeps
    // a newly inserted tool mention from being lost when send happens before the
    // corresponding React state update has rendered.
    const submittedDraft = editorHandleRef.current?.readDraft() ?? {
      text: value,
      plainText: value,
      mcpServerIds: mcpMentionServerIds,
      hasWebSearchMention,
    };
    const submittedValue = submittedDraft.text;
    const submittedText = submittedValue.trim();
    const submittedMcpServerIds = [...submittedDraft.mcpServerIds];
    const submittedHasWebSearchMention = submittedDraft.hasWebSearchMention;
    const submittedAttachments = attachments;
    if ((submittedText.length === 0 && submittedAttachments.length === 0) || submittedValue.length > MAX_INPUT_LENGTH) {
      return;
    }
    const status = await onSend(
      submittedText,
      submittedAttachments.length > 0 ? submittedAttachments : undefined,
      submittedMcpServerIds,
      submittedHasWebSearchMention ? (searchConfigId ?? null) : null,
    );
    if (status !== "accepted") return;

    const submittedAttachmentIds = new Set(submittedAttachments.map((attachment) => attachment.id));
    const currentDraft = editorHandleRef.current?.readDraft() ?? {
      text: "",
      plainText: "",
      mcpServerIds: [],
      hasWebSearchMention: false,
    };
    const mentionsAreUnchanged =
      currentDraft.mcpServerIds.length === submittedMcpServerIds.length &&
      currentDraft.mcpServerIds.every((serverId, index) => serverId === submittedMcpServerIds[index]) &&
      currentDraft.hasWebSearchMention === submittedHasWebSearchMention;
    if (currentDraft.text === submittedValue && mentionsAreUnchanged) {
      editorHandleRef.current?.clearDraft();
    }
    setAttachments((current) => current.filter((attachment) => !submittedAttachmentIds.has(attachment.id)));
  }, [canSend, value, mcpMentionServerIds, hasWebSearchMention, attachments, onSend, searchConfigId, setAttachments]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.nativeEvent.isComposing) return;

      if (plusOpen) {
        if (e.key === "Escape") {
          setPlusOpen(false);
        }
        return;
      }

      if (clearInputOnEscape && e.key === "Escape") {
        editorHandleRef.current?.clearDraft();
        return;
      }

      if (e.key === "Enter") {
        const shouldSend = sendMessageShortcut === "ctrl-enter" ? e.ctrlKey || e.metaKey : !e.shiftKey;
        if (!shouldSend) return;

        e.preventDefault();
        void handleSubmit();
      }
    },
    [plusOpen, handleSubmit, sendMessageShortcut, clearInputOnEscape],
  );

  const handleClipboardPaste = useCallback(
    async (clipboardData: DataTransfer | null) => {
      const files: File[] = [];

      // 1. Try to extract images from files
      if (clipboardData && clipboardData.files && clipboardData.files.length > 0) {
        for (let i = 0; i < clipboardData.files.length; i++) {
          const file = clipboardData.files[i];
          if (file.type && file.type.startsWith("image/")) {
            files.push(file);
          }
        }
      }

      // 2. Fall back to items (handles screenshots, copied browser images, Linux clipboard placeholders)
      if (files.length === 0 && clipboardData && clipboardData.items && clipboardData.items.length > 0) {
        for (let i = 0; i < clipboardData.items.length; i++) {
          const item = clipboardData.items[i];
          if (item.type && item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) {
              files.push(file);
            }
          }
        }
      }

      // 3. Fall back to direct Navigator Clipboard API if event-based data is restricted/empty (WebKit2GTK/Linux edge cases)
      if (
        files.length === 0 &&
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.read === "function"
      ) {
        try {
          const clipboardItems = await navigator.clipboard.read();
          for (const item of clipboardItems) {
            for (const type of item.types) {
              if (type.startsWith("image/")) {
                const blob = await item.getType(type);
                const file = new File([blob], "image.png", { type });
                files.push(file);
              }
            }
          }
        } catch (err) {
          console.warn("Navigator clipboard read failed:", err);
        }
      }

      if (files.length > 0) {
        await handleAddFiles(files);
        return true;
      }
      return false;
    },
    [handleAddFiles],
  );

  useEffect(() => {
    const handleGlobalPaste = async (e: ClipboardEvent) => {
      const target = e.target;
      const editableTarget =
        target instanceof Element ? target.closest('input, textarea, [contenteditable="true"]') : null;
      const isThisPromptEditor = editableTarget?.id === (idPrefix ? `${idPrefix}-chat-input` : "chat-input");
      if (editableTarget && !isThisPromptEditor) return;

      if (disabled || isStreaming) return;

      const clipboardData = e.clipboardData;
      if (!clipboardData) return;

      // Check synchronously to call preventDefault
      const types = clipboardData.types;
      const isFileOrImage = types && (types.includes("Files") || Array.from(types).some((t) => t.startsWith("image/")));

      if (isFileOrImage) {
        e.preventDefault();
        await handleClipboardPaste(clipboardData);
        editorHandleRef.current?.focus();
      }
    };

    document.addEventListener("paste", handleGlobalPaste);
    return () => {
      document.removeEventListener("paste", handleGlobalPaste);
    };
  }, [disabled, isStreaming, handleClipboardPaste, idPrefix]);

  const conversationProject = projects.find((project) => project.id === conversation?.projectId);
  const effectiveProject = conversation ? conversationProject : activeProject;
  const effectiveModelId = conversation?.model ?? selectedModel;
  const currentModel =
    models.find((m) => m.id === effectiveModelId && m.enabled !== false) ??
    models.find((m) => m.id === selectedModel && m.enabled !== false) ??
    models.find((m) => m.enabled !== false) ??
    models[0];
  const activeSystemPrompt =
    currentModel?.systemPromptOverride && currentModel.systemPromptOverride.trim()
      ? currentModel.systemPromptOverride
      : systemPrompt;
  const tokenBreakdown = estimateConversationTokens(conversation?.messages || [], activeSystemPrompt);
  const localEstimatedTokens = tokenBreakdown.total;
  const endpointCountAvailable = contextTokenizationMode === "endpoint" && endpointTokenCount.count !== null;
  const estimatedTokens = endpointCountAvailable ? endpointTokenCount.count! : localEstimatedTokens;
  const contextBudget = currentModel
    ? resolveContextBudget(
        currentModel,
        hasWebSearchMention || mcpMentionServerIds.length > 0 || (isProjectsEnabled && effectiveProject) ? [{}] : [],
      )
    : null;
  const contextSize = contextBudget?.contextTokens;
  const contextSizeSet = contextBudget?.status === "configured" && contextSize !== null;
  const configuredContextSize = contextSize ?? 0;
  const inputBudget = contextBudget?.inputTokens ?? 0;
  const percentage = contextSizeSet ? Math.min((estimatedTokens / inputBudget) * 100, 100) : null;
  const contextUsageColor =
    percentage === null
      ? "text-text-muted"
      : percentage > 90
        ? "text-red-500"
        : percentage > 75
          ? "text-amber-500"
          : "text-accent";

  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset =
    percentage === null ? circumference * 0.25 : circumference - (percentage / 100) * circumference;

  useEffect(() => {
    if (!showContextWindow || contextTokenizationMode !== "endpoint" || !currentModel) {
      setEndpointTokenCount({ count: null, loading: false, error: null });
      return;
    }

    if (offlineMode) {
      setEndpointTokenCount({ count: null, loading: false, error: "Unavailable while Offline Mode is enabled." });
      return;
    }

    let cancelled = false;
    setEndpointTokenCount({ count: null, loading: true, error: null });
    const timeout = window.setTimeout(() => {
      const messages = buildConversationContextMessages(conversation?.messages ?? [], currentModel);
      if (activeSystemPrompt.trim()) {
        messages.unshift({ role: "system", content: activeSystemPrompt });
      }

      void invoke<number>("count_model_tokens", { configId: currentModel.id, messages })
        .then((count) => {
          if (!cancelled) setEndpointTokenCount({ count, loading: false, error: null });
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          const message = parseApiError(error).message;
          setEndpointTokenCount({ count: null, loading: false, error: message });
        });
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [
    activeSystemPrompt,
    contextTokenizationMode,
    conversation?.messages,
    currentModel,
    offlineMode,
    showContextWindow,
  ]);

  const constrainContextDetails = useCallback(() => {
    const details = contextDetailsRef.current;
    if (!details) return;

    const viewportPadding = 16;
    const bounds = details.getBoundingClientRect();
    setContextDetailsShiftX((currentShift) => {
      const unshiftedLeft = bounds.left - currentShift;
      const unshiftedRight = bounds.right - currentShift;
      let nextShift = 0;
      if (unshiftedLeft < viewportPadding) {
        nextShift = viewportPadding - unshiftedLeft;
      } else if (unshiftedRight > window.innerWidth - viewportPadding) {
        nextShift = window.innerWidth - viewportPadding - unshiftedRight;
      }
      return Math.abs(nextShift - currentShift) < 0.5 ? currentShift : nextShift;
    });
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(constrainContextDetails);
    window.addEventListener("resize", constrainContextDetails);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", constrainContextDetails);
    };
  }, [constrainContextDetails, currentModel?.id, showContextWindow]);

  useEffect(() => {
    const dock = composerDockRef.current;
    const container = dock?.parentElement;
    if (centered || !dock || !container) return;

    const updateComposerHeight = () => {
      container.style.setProperty("--chat-composer-height", `${dock.getBoundingClientRect().height}px`);
    };

    updateComposerHeight();
    if (typeof ResizeObserver === "undefined") {
      return () => container.style.removeProperty("--chat-composer-height");
    }

    const observer = new ResizeObserver(updateComposerHeight);
    observer.observe(dock);
    return () => {
      observer.disconnect();
      container.style.removeProperty("--chat-composer-height");
    };
  }, [centered]);

  useEffect(() => {
    const dock = composerDockRef.current;
    const container = dock?.parentElement;
    if (centered || !dock || !container) return;

    // The message column is centered inside the scroll viewport, whose usable
    // width can exclude a classic scrollbar. Match that viewport so the fixed
    // composer does not shift sideways when scrolling starts or virtualization changes.
    let scroller: HTMLElement | null = null;
    let scrollerObserver: ResizeObserver | null = null;

    const alignToScrollViewport = () => {
      const nextScroller = container.querySelector<HTMLElement>("[data-chat-scroll]");
      if (nextScroller !== scroller) {
        scrollerObserver?.disconnect();
        scroller = nextScroller;
        if (scroller && typeof ResizeObserver !== "undefined") {
          scrollerObserver = new ResizeObserver(alignToScrollViewport);
          scrollerObserver.observe(scroller);
        }
      }

      const scrollbarWidth = scroller ? Math.max(0, scroller.offsetWidth - scroller.clientWidth) : 0;
      dock.style.right = `${scrollbarWidth}px`;
    };

    alignToScrollViewport();
    const mutationObserver = new MutationObserver(alignToScrollViewport);
    mutationObserver.observe(container, { childList: true, subtree: true });
    window.addEventListener("resize", alignToScrollViewport);

    return () => {
      scrollerObserver?.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", alignToScrollViewport);
      dock.style.removeProperty("right");
    };
  }, [centered]);

  const composerVisualStateClasses = `${
    conversation?.isTemporary
      ? "border-dashed !border-text-secondary/45 bg-accent/[0.03] focus-within:!border-accent/60"
      : ""
  } ${isOverLimit ? "ring-red-500/50 border-red-500/30" : ""} ${
    isStreaming ? "dark:animate-border-glow animate-border-glow-light" : ""
  } ${isDragging ? "ring-accent border-accent bg-active/40" : ""}`;
  const projectRowGenerationClass = isStreaming ? "dark:animate-border-glow animate-border-glow-light" : "";

  return (
    <div
      ref={composerDockRef}
      className={`chat-composer-dock transition-[transform,padding] duration-[var(--motion-duration-panel)] ease-[var(--motion-ease-standard)] ${
        centered
          ? "flex-1 flex flex-col items-center translate-y-[-7vh] pt-4"
          : "absolute inset-x-0 bottom-0 z-20 px-4 pt-2 md:px-0"
      }`}
    >
      <button
        type="button"
        hidden
        tabIndex={-1}
        aria-hidden="true"
        data-search-insert
        disabled={!searchConfigId}
        onClick={insertWebSearchMention}
      />
      {!centered && <div className="chat-composer-backdrop" aria-hidden="true" />}
      <div
        className={`relative z-10 mx-auto w-full ${
          centered ? "max-w-4xl px-2 sm:px-6" : "chat-column-content"
        } ${centered ? "" : "pt-2"}`}
      >
        {!centered && !conversation?.isSubagent && (
          <WorkspaceChangeIndicator conversationId={activeConversationId ?? undefined} />
        )}
        {conversation?.isSubagent ? (
          <div className="flex flex-col items-center justify-center p-4 bg-surface/50 border border-border rounded-xl text-text-muted text-sm select-none">
            <Bot size={24} className="mb-2 text-text-muted/70" />
            <p>Subagents are autonomous and cannot be messaged directly.</p>
          </div>
        ) : (
          <>
            <span id={elementId("chat-input-label")} className="sr-only">
              Message
            </span>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (!disabled && !isStreaming) {
                  setIsDragging(true);
                }
              }}
              onDragLeave={() => {
                setIsDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
              }}
              className={`group/input-bar relative flex flex-col items-stretch transition-[transform,border-color,background-color,box-shadow] ${
                isProjectsEnabled
                  ? ""
                  : `chat-composer-surface rounded-3xl border border-input-border px-4 py-2.5 focus-within:border-accent/60 ${composerVisualStateClasses}`
              } ${isDragging ? "scale-[1.01]" : ""}`}
            >
              {/* Hidden input element */}
              <input
                id={elementId("file-input-element")}
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                multiple
                accept="image/*,.txt,.md,.json,.csv,.xml,.yaml,.yml,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.c,.h,.cpp,.hpp,.cs,.php,.swift,.kt,.scala,.sh,.bash,.zsh,.sql,.html,.css,.scss,.toml,.ini,.cfg,.log,.env"
                className="hidden"
              />

              <div
                className={
                  isProjectsEnabled
                    ? `chat-composer-surface relative z-10 flex flex-col items-stretch rounded-3xl border border-input-border px-4 py-2.5 transition-[transform,border-color,background-color,box-shadow] after:pointer-events-none after:absolute after:-bottom-px after:left-6 after:right-6 after:h-[2px] ${
                        conversation?.isTemporary ? "after:bg-accent/[0.03]" : "after:bg-transparent"
                      } group-focus-within/input-bar:border-accent/60 ${composerVisualStateClasses}`
                    : "contents"
                }
              >
                {/* Attachments strip */}
                <AnimatePresence>
                  {attachments.length > 0 && (
                    <motion.div
                      layout
                      initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                      animate={{ opacity: 1, height: "auto", marginBottom: 8 }}
                      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                      transition={motionTransitions.content}
                      className="w-full overflow-hidden"
                    >
                      <div className="flex flex-wrap gap-3 w-full pb-3 border-b border-border/40">
                        {attachments.map((a) => {
                          const isImg = a.kind === "image" && a.dataUrl;
                          if (isImg) {
                            return (
                              <motion.div
                                layout
                                key={a.id}
                                initial={{ opacity: 0, scale: motionTokens.scale.subtle }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: motionTokens.scale.subtle }}
                                transition={motionTransitions.content}
                                className="relative group w-20 h-20 rounded-xl overflow-hidden border border-border bg-surface shadow-sm select-none shrink-0"
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    const imgIdx = imageAttachments.findIndex((img) => img.id === a.id);
                                    if (imgIdx !== -1) setPreviewImageIndex(imgIdx);
                                  }}
                                  className="h-full w-full cursor-pointer rounded-xl"
                                  aria-label={`Preview ${a.name}`}
                                >
                                  <img
                                    src={a.dataUrl}
                                    alt=""
                                    className="w-full h-full object-cover select-none transition-transform duration-[var(--motion-duration-content)] group-hover:scale-[1.035] group-focus-within:scale-[1.035]"
                                  />
                                  <div className="pointer-events-none absolute inset-0 bg-black/10 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setAttachments((prev) => prev.filter((item) => item.id !== a.id));
                                  }}
                                  className="absolute top-1.5 right-1.5 p-1 rounded-full bg-surface border border-border shadow-sm text-text-muted hover:text-text-primary hover:bg-input transition-[color,background-color,border-color,opacity,transform] image-close-btn z-10"
                                  title={t("chat.removeAttachment") || "Remove attachment"}
                                  aria-label={`${t("chat.removeAttachment") || "Remove attachment"}: ${a.name}`}
                                >
                                  <X size={12} />
                                </button>
                              </motion.div>
                            );
                          }

                          return (
                            <motion.div
                              layout
                              key={a.id}
                              initial={{ opacity: 0, scale: motionTokens.scale.subtle }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: motionTokens.scale.subtle }}
                              transition={motionTransitions.content}
                              className="inline-reference relative group pr-7 py-1 text-xs select-none"
                            >
                              {a.kind === "image" ? (
                                <ImageIcon size={13} className="shrink-0" aria-hidden="true" />
                              ) : (
                                <FileTextIcon size={13} className="shrink-0" aria-hidden="true" />
                              )}
                              <span className="max-w-[120px] truncate font-medium" title={a.name}>
                                {a.name}
                              </span>
                              <span className="text-[10px] text-text-muted shrink-0">({formatFileSize(a.size)})</span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAttachments((prev) => prev.filter((item) => item.id !== a.id));
                                }}
                                className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-text-muted hover:text-text-primary hover:bg-hover transition-[color,background-color,opacity,transform] md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                                title={t("chat.removeAttachment") || "Remove attachment"}
                                aria-label={`${t("chat.removeAttachment") || "Remove attachment"}: ${a.name}`}
                              >
                                <X size={12} />
                              </button>
                            </motion.div>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 w-full">
                  {/* Plus / tools button */}
                  <div ref={plusDropdownRef} className="relative shrink-0">
                    <button
                      type="button"
                      onMouseDown={saveEditorSelection}
                      onClick={() => setPlusOpen(!plusOpen)}
                      className={`p-1.5 rounded-full bg-transparent transition-colors flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                        anyToolActive
                          ? "text-accent hover:bg-hover"
                          : "text-text-muted hover:text-text-secondary hover:bg-hover"
                      }`}
                      aria-label={t("tooltip.attachOrSearch") || "Attach or search"}
                      title={t("tooltip.attachOrSearch") || "Attach or search"}
                      aria-expanded={plusOpen}
                      aria-haspopup="menu"
                    >
                      <Plus size={20} />
                    </button>

                    <AnimatePresence>
                      {plusOpen && (
                        <motion.div
                          className="popup-surface absolute bottom-full left-0 mb-2 w-56 border border-border rounded-xl p-1 z-50"
                          style={{ boxShadow: "var(--shadow-xl)" }}
                          role="menu"
                          aria-label="Attachment and search options"
                          initial={{ opacity: 0, y: 8, scale: motionTokens.scale.subtle }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{
                            opacity: 0,
                            y: 8,
                            scale: motionTokens.scale.subtle,
                            transition: motionTransitions.popoverExit,
                          }}
                          transition={motionTransitions.popoverEnter}
                        >
                          <button
                            onClick={() => {
                              setPlusOpen(false);
                              fileInputRef.current?.click();
                            }}
                            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-text-secondary hover:bg-hover hover:text-text-primary transition-colors"
                            role="menuitem"
                          >
                            <Paperclip size={15} className="text-text-muted" />
                            <span>{t("chat.addFile") || "Add File"}</span>
                          </button>
                          <button
                            type="button"
                            onClick={insertWebSearchMention}
                            disabled={!searchConfigId}
                            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-text-secondary hover:bg-hover hover:text-text-primary transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                            role="menuitem"
                          >
                            <Search size={15} className="text-text-muted" />
                            <span className="flex-1 text-left">{t("chat.webSearch") || "Web Search"}</span>
                            <Plus size={13} className="text-text-muted ml-1 shrink-0" aria-hidden="true" />
                          </button>
                          <button
                            onClick={() => {
                              setPlusOpen(false);
                              useUIStore.getState().setActiveAuxTab("knowledge");
                            }}
                            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-text-secondary hover:bg-hover hover:text-text-primary transition-colors"
                            role="menuitem"
                          >
                            <Database size={15} className="text-text-muted" />
                            <span>Knowledge & Docs</span>
                          </button>
                          {connectedMcpServers.length > 0 && (
                            <>
                              <div className="border-t border-border my-1 -mx-1" />
                              {connectedMcpServers.map((server) => {
                                return (
                                  <button
                                    key={server.id}
                                    type="button"
                                    onClick={() => {
                                      insertMcpMention(server);
                                    }}
                                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-text-secondary hover:bg-hover hover:text-text-primary transition-colors"
                                    role="menuitem"
                                  >
                                    <Cpu size={15} className="text-text-muted" />
                                    <span className="truncate flex-1 text-left">{server.name}</span>
                                    <Plus size={13} className="text-text-muted ml-1 shrink-0" aria-hidden="true" />
                                  </button>
                                );
                              })}
                            </>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="flex-1" aria-hidden="true" />

                  <PromptEditor
                    editorHandleRef={editorHandleRef}
                    id={elementId("chat-input")}
                    labelledBy={elementId("chat-input-label")}
                    describedBy={elementId(isOverLimit ? "input-limit-error" : "input-hint")}
                    placeholder={
                      isCompareMode
                        ? t("chat.comparePlaceholder") || "Ask all models..."
                        : t("chat.placeholder") || "Ask for follow-up changes..."
                    }
                    disabled={disabled}
                    invalid={isOverLimit}
                    isEmpty={value.length === 0 && mcpMentionServerIds.length === 0 && !hasWebSearchMention}
                    maxHeight={MAX_TEXTAREA_HEIGHT}
                    webSearchLabel={t("chat.webSearch") || "Web Search"}
                    onDraftChange={handleEditorDraftChange}
                    onKeyDown={handleKeyDown}
                    onPasteText={handlePastedText}
                    className={`${textSizeClass} ${isOverLimit ? "text-red-600 dark:text-red-400" : ""} ${
                      voiceDraft && value.trim() === voiceDraft.trim() ? "opacity-60 italic text-text-muted" : ""
                    }`}
                  />

                  {/* Context Window Radial Indicator */}
                  {showContextWindow && currentModel && !isCompareMode && (
                    <div
                      className="relative group shrink-0 flex items-center justify-center"
                      onMouseEnter={constrainContextDetails}
                      onFocusCapture={constrainContextDetails}
                    >
                      <button
                        type="button"
                        className="p-1.5 rounded-lg hover:bg-hover text-text-muted hover:text-text-primary transition-colors flex items-center justify-center cursor-help min-w-[32px] min-h-[32px]"
                        aria-label="Context Window Usage"
                      >
                        <svg className="w-5 h-5 -rotate-90" viewBox="0 0 20 20">
                          <circle
                            className="text-border/60"
                            strokeWidth="2"
                            stroke="currentColor"
                            fill="transparent"
                            r={radius}
                            cx="10"
                            cy="10"
                          />
                          <circle
                            className={contextUsageColor}
                            strokeWidth="2"
                            strokeDasharray={circumference}
                            strokeDashoffset={strokeDashoffset}
                            strokeLinecap="round"
                            stroke="currentColor"
                            fill="transparent"
                            r={radius}
                            cx="10"
                            cy="10"
                          />
                        </svg>
                      </button>

                      {/* Hover Details Card */}
                      <div
                        ref={contextDetailsRef}
                        className="absolute bottom-full mb-2 w-[min(16rem,calc(100vw-2rem))] pointer-events-none z-50"
                        style={{ right: -contextDetailsShiftX }}
                      >
                        <div className="w-full p-3.5 bg-surface border border-border rounded-xl shadow-xl opacity-0 scale-[0.98] translate-y-1 group-hover:opacity-100 group-hover:scale-100 group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:scale-100 group-focus-within:translate-y-0 transition-[opacity,transform] duration-[var(--motion-duration-popover)] ease-[var(--motion-ease-enter)] origin-bottom-right">
                          <div className="font-semibold text-text-primary mb-1 flex justify-between items-center text-xs">
                            <span>Context Window</span>
                            <span className={contextUsageColor}>
                              {percentage === null ? "Unknown" : `${percentage.toFixed(0)}%`}
                            </span>
                          </div>
                          <div className="w-full bg-border/40 h-1 rounded-full overflow-hidden mb-3">
                            <div
                              className={`h-full ${percentage === null ? "bg-text-muted" : percentage > 90 ? "bg-red-500" : percentage > 75 ? "bg-amber-500" : "bg-accent"}`}
                              style={{ width: percentage === null ? "0%" : `${Math.min(percentage, 100)}%` }}
                            />
                          </div>
                          <div className="space-y-1.5 text-[11px] text-text-secondary">
                            <div className="flex justify-between gap-3">
                              <span>{t("context.calculationSource")}</span>
                              <span className="font-medium text-right text-text-primary">
                                {contextTokenizationMode === "local"
                                  ? t("context.localEstimate")
                                  : endpointTokenCount.loading
                                    ? t("context.endpointLoading")
                                    : endpointCountAvailable
                                      ? t("context.endpointTokenizer")
                                      : t("context.localFallback")}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span>Usage:</span>
                              <span className="font-semibold font-mono text-text-primary">
                                {estimatedTokens.toLocaleString()} /{" "}
                                {contextSizeSet ? `${inputBudget.toLocaleString()} tokens` : "Unknown"}
                              </span>
                            </div>
                            {contextSizeSet ? (
                              <>
                                <div className="h-px bg-border/40 my-1" />
                                <div className="flex justify-between">
                                  <span>Context Size:</span>
                                  <span className="font-mono text-text-primary">
                                    {configuredContextSize.toLocaleString()}
                                  </span>
                                </div>
                                {endpointCountAvailable && (
                                  <div className="flex justify-between gap-3 text-text-muted">
                                    <span>{t("context.breakdown")}</span>
                                    <span className="text-right">{t("context.localEstimate")}</span>
                                  </div>
                                )}
                                <div className="flex justify-between">
                                  <span>System Prompt:</span>
                                  <span className="font-mono text-text-primary">
                                    {tokenBreakdown.systemPromptTokens.toLocaleString()}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span>Messages:</span>
                                  <span className="font-mono text-text-primary">
                                    {tokenBreakdown.messagesTokens.toLocaleString()}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span>Attachments:</span>
                                  <span className="font-mono text-text-primary">
                                    {tokenBreakdown.attachmentsTokens.toLocaleString()}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span>Output Reserve:</span>
                                  <span className="font-mono text-text-primary">
                                    {contextBudget.reservedOutputTokens.toLocaleString()}
                                  </span>
                                </div>
                                {contextBudget.reservedToolTokens > 0 && (
                                  <div className="flex justify-between">
                                    <span>Tool Reserve:</span>
                                    <span className="font-mono text-text-primary">
                                      {contextBudget.reservedToolTokens.toLocaleString()}
                                    </span>
                                  </div>
                                )}
                                <div className="flex justify-between border-t border-border/40 pt-1 mt-1">
                                  <span>Input Remaining:</span>
                                  <span className="font-semibold font-mono text-text-primary">
                                    {Math.max(0, inputBudget - estimatedTokens).toLocaleString()}
                                  </span>
                                </div>
                                {contextTokenizationMode === "endpoint" && endpointTokenCount.error && (
                                  <p className="text-amber-500 mt-1 leading-normal text-[10px]">
                                    {t("context.endpointError")} {endpointTokenCount.error}
                                  </p>
                                )}
                              </>
                            ) : (
                              <p className="text-amber-500 mt-1 italic leading-normal text-[10px]">
                                Context size is unknown. Requests use a conservative assembly budget until you configure
                                this model in Settings &gt; Models. Current conservative input budget:{" "}
                                {inputBudget.toLocaleString()} tokens.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Each comparison column owns its model and thinking settings. */}
                  {!isCompareMode && (
                    <ResponseSettingsSelector
                      models={models}
                      selectedModel={selectedModel}
                      onModelChange={onModelChange}
                      modelStatuses={modelStatuses}
                      buttonId={elementId("model-selector-button")}
                    />
                  )}

                  {/* Voice-to-Text Button */}
                  {isVoiceEnabled && (
                    <>
                      {isRecording && (
                        <span
                          className="flex shrink-0 items-center gap-1.5 rounded-full bg-red-500/10 px-2 py-1 text-[10px] font-semibold text-red-500"
                          role="status"
                          aria-live="polite"
                        >
                          <span className="size-1.5 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />
                          Recording
                        </span>
                      )}
                      <button
                        id={elementId("voice-input-button")}
                        type="button"
                        onClick={handleToggleVoice}
                        disabled={isTranscribing}
                        className={`shrink-0 p-2 rounded-full transition-colors flex items-center justify-center relative cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed ${
                          isRecording
                            ? "bg-red-500 hover:bg-red-600 text-white animate-pulse"
                            : "bg-transparent hover:bg-hover text-text-muted hover:text-text-primary disabled:opacity-40"
                        }`}
                        aria-label={isRecording ? t("tooltip.voiceStop") : t("tooltip.voiceStart")}
                        title={isRecording ? t("tooltip.voiceStop") : t("tooltip.voiceStart")}
                      >
                        {isTranscribing ? (
                          <Loader2 size={16} className="animate-spin text-accent" />
                        ) : (
                          <Mic size={16} className={isRecording ? "text-white" : ""} />
                        )}
                      </button>
                    </>
                  )}

                  {/* Send / Stop button */}
                  <button
                    onClick={isStreaming ? () => onStop?.() : handleSubmit}
                    disabled={!isStreaming && !canSend}
                    className={`shrink-0 p-2 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                      isStreaming
                        ? "bg-red-500/90 hover:bg-red-600 text-white"
                        : "bg-accent hover:bg-accent-hover text-accent-foreground shadow-sm disabled:hover:bg-accent"
                    }`}
                    aria-label={isStreaming ? t("tooltip.stop") : t("tooltip.send")}
                    title={isStreaming ? t("tooltip.stop") : t("tooltip.send")}
                  >
                    {isStreaming ? (
                      <Square size={16} className="fill-current" />
                    ) : (
                      <ArrowUp size={16} strokeWidth={2.5} />
                    )}
                  </button>
                </div>
              </div>

              {/* Active Tools and Context Row */}
              {isProjectsEnabled && (
                <div
                  className={`relative z-0 flex flex-wrap items-center gap-2 ${
                    isProjectsEnabled
                      ? `chat-composer-surface chat-composer-project-row -mt-px mx-4 min-h-10 w-[calc(100%-2rem)] rounded-b-2xl border-x border-b border-input-border px-3 py-2 transition-colors group-focus-within/input-bar:border-accent/60 ${projectRowGenerationClass} ${
                          conversation?.isTemporary
                            ? "border-dashed before:pointer-events-none before:absolute before:inset-0 before:rounded-b-2xl before:bg-accent/[0.03]"
                            : ""
                        }`
                      : "mt-2 w-full border-t border-border/30 pt-2"
                  }`}
                >
                  {/* Project Row */}
                  {isProjectsEnabled && (
                    <div ref={projectDropdownRef} className="relative">
                      <button
                        onClick={() => setProjectDropdownOpen(!projectDropdownOpen)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                          activeProject
                            ? "text-text-primary hover:bg-hover"
                            : "text-text-secondary hover:bg-hover hover:text-text-primary"
                        }`}
                        aria-label="Project context"
                        aria-expanded={projectDropdownOpen}
                      >
                        {activeProject ? (
                          <>
                            <FolderOpen size={14} className="shrink-0" />
                            <span className="truncate max-w-[120px]">{activeProject.name}</span>
                            {activeProject.permissions === "full" ? (
                              <span
                                title={t("chat.fullShellAccess") || "Full Shell Access"}
                                className="shrink-0 ml-1 flex items-center"
                              >
                                <ShieldAlert size={12} className="text-red-500" />
                              </span>
                            ) : activeProject.permissions === "write" ? (
                              <span
                                title={t("chat.readWriteAccess") || "Read/Write Access"}
                                className="shrink-0 ml-1 flex items-center"
                              >
                                <Shield size={12} className="text-amber-500" />
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <FolderPlus size={14} className="shrink-0" />
                            <span>{t("chat.workInProject") || "Work in a project"}</span>
                          </>
                        )}
                        <ChevronDown
                          size={12}
                          className={`shrink-0 ml-0.5 transition-transform ${projectDropdownOpen ? "rotate-180" : ""}`}
                        />
                      </button>

                      <AnimatePresence>
                        {projectDropdownOpen && (
                          <motion.div
                            className={`popup-surface absolute ${
                              centered ? "top-full mt-2" : "bottom-full mb-2"
                            } left-0 w-64 border border-border rounded-xl p-1 z-50 overflow-hidden`}
                            style={{ boxShadow: "var(--shadow-xl)" }}
                            role="menu"
                            initial={{
                              opacity: 0,
                              y: centered ? -8 : 8,
                              scale: motionTokens.scale.subtle,
                            }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{
                              opacity: 0,
                              y: centered ? -8 : 8,
                              scale: motionTokens.scale.subtle,
                              transition: motionTransitions.popoverExit,
                            }}
                            transition={motionTransitions.popoverEnter}
                          >
                            {!activeProject ? (
                              <>
                                <button
                                  onClick={() => {
                                    setProjectDropdownOpen(false);
                                    openProjectConfigModal("create");
                                  }}
                                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-accent hover:bg-accent-soft/20 transition-colors text-left font-medium"
                                  role="menuitem"
                                >
                                  <FolderPlus size={15} className="text-accent" />
                                  <span>Add Project Workspace...</span>
                                </button>
                                {projects.length > 0 && (
                                  <>
                                    <div className="border-t border-border/50 my-1 mx-1" />
                                    <div className="px-2.5 py-1 text-[9px] font-medium text-text-muted">
                                      Recent Workspaces
                                    </div>
                                    <div className="max-h-48 overflow-y-auto py-0.5">
                                      {projects.map((p) => (
                                        <button
                                          key={p.id}
                                          onClick={() => {
                                            setActiveProject(p.id);
                                            if (activeConversationId) {
                                              setConversationProject(activeConversationId, p.id);
                                            }
                                            setProjectDropdownOpen(false);
                                          }}
                                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-text-secondary hover:bg-hover hover:text-text-primary transition-colors text-left"
                                        >
                                          <Folder size={13} className="text-text-muted shrink-0" />
                                          <span className="truncate">{p.name}</span>
                                        </button>
                                      ))}
                                    </div>
                                  </>
                                )}
                              </>
                            ) : (
                              <>
                                <div className="px-2.5 py-1 text-[9px] font-medium text-text-muted">
                                  Active Workspace Info
                                </div>
                                <div className="px-2.5 py-1 text-xs text-text-secondary">
                                  <div className="font-semibold truncate">{activeProject.name}</div>
                                  <div
                                    className="text-[10px] text-text-muted truncate font-mono"
                                    title={activeProject.path}
                                  >
                                    {activeProject.path}
                                  </div>
                                </div>
                                <div className="border-t border-border/50 my-1 mx-1" />
                                <div className="px-2.5 py-1 text-[9px] font-medium text-text-muted">Permissions</div>
                                <button
                                  onClick={() => handleToggleProjectPermission("read")}
                                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                                    activeProject.permissions === "read"
                                      ? "bg-active text-text-primary font-medium"
                                      : "text-text-secondary hover:bg-hover hover:text-text-primary"
                                  }`}
                                >
                                  <span>Read Only (RO)</span>
                                  {activeProject.permissions === "read" && <Check size={12} />}
                                </button>
                                <button
                                  onClick={() => handleToggleProjectPermission("write")}
                                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                                    activeProject.permissions === "write"
                                      ? "bg-active text-text-primary font-medium"
                                      : "text-text-secondary hover:bg-hover hover:text-text-primary"
                                  }`}
                                >
                                  <span>Read/Write (RW)</span>
                                  {activeProject.permissions === "write" && <Check size={12} />}
                                </button>
                                <button
                                  onClick={() => handleToggleProjectPermission("full")}
                                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                                    activeProject.permissions === "full"
                                      ? "bg-red-500/10 text-red-500 font-medium"
                                      : "text-text-secondary hover:bg-hover hover:text-red-500"
                                  }`}
                                >
                                  <div className="flex items-center gap-1.5">
                                    <ShieldAlert
                                      size={12}
                                      className={
                                        activeProject.permissions === "full" ? "text-red-500" : "text-text-muted"
                                      }
                                    />
                                    <span>Full Shell</span>
                                  </div>
                                  {activeProject.permissions === "full" && <Check size={12} />}
                                </button>
                                <div className="border-t border-border/50 my-1 mx-1" />
                                <button
                                  onClick={() => {
                                    setProjectDropdownOpen(false);
                                    openProjectConfigModal("edit", activeProject.id);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-text-secondary hover:bg-hover hover:text-text-primary transition-colors text-left"
                                  role="menuitem"
                                >
                                  <Settings size={13} className="text-text-muted" />
                                  <span>Workspace Settings...</span>
                                </button>
                                <button
                                  onClick={() => {
                                    setActiveProject(null);
                                    if (activeConversationId) {
                                      setConversationProject(activeConversationId, undefined);
                                    }
                                    setProjectDropdownOpen(false);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-text-secondary hover:bg-hover hover:text-text-primary transition-colors text-left"
                                  role="menuitem"
                                >
                                  <X size={13} className="text-text-muted" />
                                  <span>Detach Project</span>
                                </button>
                              </>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {!conversation?.isSubagent && (
        <p
          id={elementId(isOverLimit ? "input-limit-error" : "input-hint")}
          className={`relative z-0 mt-2 bg-chat px-4 py-2 text-center text-[11px] text-text-secondary/80 ${
            centered ? "w-full" : "-mx-4 w-[calc(100%+2rem)] md:mx-0 md:w-full"
          }`}
        >
          {isOverLimit ? (
            <span className="text-red-600 dark:text-red-400" role="alert">
              Message exceeds {MAX_INPUT_LENGTH.toLocaleString()} character limit
            </span>
          ) : isStreaming ? (
            <span className="flex items-center justify-center gap-2 text-text-secondary font-medium animate-generating-pulse">
              <span>Generating response</span>
              <span className="generating-dots">
                <span />
                <span />
                <span />
              </span>
            </span>
          ) : (
            t("chat.disclaimer") || "Sythoria can make mistakes. Consider checking important information."
          )}
        </p>
      )}

      {previewImageIndex !== null && imageAttachments.length > 0 && (
        <ImagePreviewModal
          isOpen={previewImageIndex !== null}
          onClose={() => setPreviewImageIndex(null)}
          images={imageAttachments.map((a) => ({ url: a.dataUrl!, name: a.name, size: a.size }))}
          activeIndex={previewImageIndex}
          onChangeActiveIndex={(idx) => setPreviewImageIndex(idx)}
        />
      )}
    </div>
  );
});
