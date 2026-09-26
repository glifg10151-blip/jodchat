import React, { useEffect } from "react";
import { X } from "lucide-react";
import ChatArea from "./ChatArea";
import { ResponseSettingsSelector } from "./ResponseSettingsSelector";
import { useScrollButton } from "../hooks/useScrollPosition";
import { useScrollTracking } from "../hooks/useScrollTracking";
import type { Conversation, ModelConfig } from "../types";
import { useModelStore } from "../store/useModelStore";
import { useTranslation } from "../utils/i18n";
import type { VirtuosoHandle } from "react-virtuoso";

interface ComparisonColumnProps {
  conversation: Conversation;
  isPrimary?: boolean;
  label: string;
  models: ModelConfig[];
  onModelChange: (modelId: string) => void;
  onClose?: () => void;
  onRetry: (messageId: string) => void;
  isStreaming: boolean;
  onScroll?: (scrollTop: number, ratio: number) => void;
}

export interface ComparisonColumnHandle {
  scrollTo: (options: ScrollToOptions) => void;
  scrollToIndex: (options: Parameters<VirtuosoHandle["scrollToIndex"]>[0]) => void;
  getScroller: () => HTMLElement | null;
}

export const ComparisonColumn = React.memo(
  React.forwardRef<ComparisonColumnHandle, ComparisonColumnProps>(
    (
      { conversation, isPrimary = false, label, models, onModelChange, onClose, onRetry, isStreaming, onScroll },
      ref,
    ) => {
      const { t } = useTranslation();
      const { virtuosoRef, isAtBottom, setIsAtBottom, scrollToBottom } = useScrollButton();
      const nonVirtualizedRef = React.useRef<HTMLDivElement>(null);
      const modelStatuses = useModelStore((state) => state.modelStatuses);

      React.useImperativeHandle(
        ref,
        () => ({
          scrollTo: (options: ScrollToOptions) => {
            if (virtuosoRef.current) {
              virtuosoRef.current.scrollTo(options);
            } else if (nonVirtualizedRef.current) {
              nonVirtualizedRef.current.scrollTo(options);
            }
          },
          scrollToIndex: (options: Parameters<VirtuosoHandle["scrollToIndex"]>[0]) => {
            if (virtuosoRef.current) {
              virtuosoRef.current.scrollToIndex(options);
            } else if (nonVirtualizedRef.current) {
              nonVirtualizedRef.current.scrollTo({
                top: nonVirtualizedRef.current.scrollHeight,
                behavior: typeof options === "object" ? options.behavior : undefined,
              });
            }
          },
          getScroller: () => nonVirtualizedRef.current,
        }),
        [virtuosoRef],
      );

      const messages = conversation.messages;
      useScrollTracking(conversation.id, messages.length, isAtBottom, isStreaming);

      useEffect(() => {
        if (isStreaming && isAtBottom) {
          scrollToBottom("auto");
        }
      }, [messages.length, isStreaming, isAtBottom, scrollToBottom]);

      return (
        <section
          aria-label={`${label} response`}
          className="comparison-column-panel min-h-0 flex flex-col relative bg-chat"
        >
          <div className="shrink-0 px-4 py-2 text-xs font-medium border-b border-border/70 bg-surface/35 backdrop-blur-sm flex items-center justify-between gap-2 relative z-10">
            <span className={`min-w-0 flex-1 truncate ${isPrimary ? "text-text-primary" : "text-text-muted"}`}>
              {label}
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              <ResponseSettingsSelector
                models={models}
                selectedModel={conversation.model}
                onModelChange={onModelChange}
                modelStatuses={modelStatuses}
                placement="below"
                triggerClassName="max-w-[190px] border border-border bg-surface shadow-sm"
              />
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="ml-1 rounded-md p-1 text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
                  title={t("chat.removeComparison") || "Remove comparison"}
                  aria-label={t("chat.removeComparison") || "Remove comparison"}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
          <ChatArea
            messages={messages}
            setIsAtBottom={setIsAtBottom}
            virtuosoRef={virtuosoRef}
            onRetry={onRetry}
            onScroll={onScroll}
            conversationId={conversation.id}
            scrollContainerRef={nonVirtualizedRef}
            showEmptyState={false}
          />
        </section>
      );
    },
  ),
);
