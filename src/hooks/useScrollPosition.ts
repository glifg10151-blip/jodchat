import { useState, useCallback, useRef } from "react";
import type { VirtuosoHandle } from "react-virtuoso";

/**
 * Manages "is at bottom" state for the scroll-to-bottom button.
 *
 * ChatArea calls `setIsAtBottom()` from its scroll listeners.
 * App.tsx reads `isAtBottom` and calls `scrollToBottom()`.
 *
 * For the Virtuoso path: App passes `virtuosoRef` into ChatArea,
 * which attaches it to <Virtuoso/>. App can then call
 * `virtuosoRef.current.scrollToIndex(...)` directly.
 *
 * For the non-virtualized path: ChatArea marks its scroll container
 * with `[data-chat-scroll]` so `scrollToBottom()` can find it.
 */
export function useScrollButton() {
  const [isAtBottom, setIsAtBottom] = useState(true);
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);

  const scrollToBottom = useCallback((behavior: "auto" | "smooth" = "smooth") => {
    if (virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({
        index: Number.MAX_SAFE_INTEGER,
        behavior,
        align: "end",
      });
      setIsAtBottom(true);
      return;
    }

    const elements = document.querySelectorAll("[data-chat-scroll]");
    elements.forEach((el) => {
      el.scrollTo({ top: (el as HTMLElement).scrollHeight, behavior });
    });
    setIsAtBottom(true);
  }, []);

  return { isAtBottom, setIsAtBottom, scrollToBottom, virtuosoRef };
}
