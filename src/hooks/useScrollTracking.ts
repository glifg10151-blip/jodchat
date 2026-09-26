import { useState, useRef, useEffect } from "react";

export function useScrollTracking(
  activeId: string | null,
  messagesLength: number,
  isAtBottom: boolean,
  isStreaming: boolean,
) {
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const prevMessageCountRef = useRef(0);

  useEffect(() => {
    if (activeId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHasNewMessages(false);
    }
  }, [activeId]);

  useEffect(() => {
    if (messagesLength > prevMessageCountRef.current && !isAtBottom && !isStreaming) {
      setHasNewMessages(true);
    }
    if (isAtBottom) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHasNewMessages(false);
    }
    prevMessageCountRef.current = messagesLength;
  }, [messagesLength, isAtBottom, isStreaming]);

  return { hasNewMessages, setHasNewMessages };
}
