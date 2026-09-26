import { useState, useRef, useCallback } from "react";
import { Attachment } from "../types";
import { useUIStore } from "../store/useUIStore";
import { useChatStore } from "../store/useChatStore";
import { validateFile, readFileAsAttachment, isImageFile } from "../utils/attachments";
import { useModelStore } from "../store/useModelStore";

export function useAttachments(isolated = false) {
  const sharedAttachments = useChatStore((s) => s.draftAttachments);
  const [localAttachments, setLocalAttachments] = useState<Attachment[]>([]);
  const localAttachmentsRef = useRef<Attachment[]>([]);
  const attachments = isolated ? localAttachments : sharedAttachments;
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentQueueRef = useRef<Promise<void>>(Promise.resolve());

  const setAttachments = useCallback(
    (updater: Attachment[] | ((prev: Attachment[]) => Attachment[])) => {
      if (isolated) {
        setLocalAttachments((current) => {
          const next = typeof updater === "function" ? updater(current) : updater;
          localAttachmentsRef.current = next;
          return next;
        });
        return;
      }
      const chatStore = useChatStore.getState();
      if (typeof updater === "function") {
        chatStore.setDraftAttachments(updater(chatStore.draftAttachments));
      } else {
        chatStore.setDraftAttachments(updater);
      }
    },
    [isolated],
  );

  const handleAddFiles = useCallback(
    (files: File[]) => {
      const processFiles = async () => {
        const addToast = useUIStore.getState().addToast;

        const modelStore = useModelStore.getState();
        const currentModel = modelStore.models.find((m) => m.id === modelStore.selectedModel);

        for (const file of files) {
          const currentAttachments = isolated ? localAttachmentsRef.current : useChatStore.getState().draftAttachments;
          // Check for duplicate by name and size
          const isDuplicate = currentAttachments.some((a) => a.name === file.name && a.size === file.size);
          if (isDuplicate) {
            continue;
          }

          if (isImageFile(file) && currentModel && currentModel.supportsImages === false) {
            addToast(`"${currentModel.name}" does not support image inputs.`, "error");
            continue;
          }

          const valResult = validateFile(file, currentAttachments.length);
          if (!valResult.ok) {
            addToast(valResult.reason || "Invalid file", "error");
            continue;
          }

          try {
            const attachment = await readFileAsAttachment(file);
            setAttachments((latest) => {
              const wasAddedWhileReading = latest.some((item) => item.name === file.name && item.size === file.size);
              return wasAddedWhileReading ? latest : [...latest, attachment];
            });
          } catch {
            addToast(`Failed to read "${file.name}"`, "error");
          }
        }
      };

      const queued = attachmentQueueRef.current.then(processFiles);
      attachmentQueueRef.current = queued.catch(() => undefined);
      return queued;
    },
    [isolated, setAttachments],
  );

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files) return;
      const files = Array.from(e.target.files);
      await handleAddFiles(files);
      e.target.value = ""; // reset input so the same file can be selected again
    },
    [handleAddFiles],
  );

  return {
    attachments,
    setAttachments,
    isDragging,
    setIsDragging,
    fileInputRef,
    handleAddFiles,
    handleFileChange,
  };
}
