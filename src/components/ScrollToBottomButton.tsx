import { forwardRef } from "react";
import { motion } from "motion/react";
import { ArrowDown } from "lucide-react";
import { springs, motionTokens } from "../lib/motion-tokens";

interface ScrollToBottomButtonProps {
  onClick: () => void;
  hasNewMessages?: boolean;
  className?: string;
}

const ScrollToBottomButton = forwardRef<HTMLButtonElement, ScrollToBottomButtonProps>(function ScrollToBottomButton(
  { onClick, hasNewMessages, className = "" },
  ref,
) {
  const label = hasNewMessages ? "New messages below. Scroll to bottom." : "Scroll to bottom";

  return (
    <motion.button
      ref={ref}
      onClick={onClick}
      className={`
          relative flex items-center justify-center
          w-9 h-9 rounded-full
          bg-surface border border-border text-text-secondary
          hover:text-text-primary hover:border-text-muted
          transition-colors
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-muted/50 focus-visible:ring-offset-2 focus-visible:ring-offset-chat
          z-30
          ${className}
        `}
      style={{ boxShadow: "var(--shadow-md)" }}
      aria-label={label}
      title={label}
      whileHover={{ scale: motionTokens.scale.pop }}
      whileTap={{ scale: motionTokens.scale.press }}
      transition={springs.snappy}
    >
      <ArrowDown size={16} className="shrink-0" />
      {hasNewMessages && (
        <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-chat animate-pulse" />
      )}
    </motion.button>
  );
});

export default ScrollToBottomButton;
