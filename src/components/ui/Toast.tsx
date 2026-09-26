import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";
import { motionTokens, motionTransitions, springs } from "../../lib/motion-tokens";
import { useUIStore } from "../../store/useUIStore";

export interface Toast {
  id: string;
  message: React.ReactNode;
  variant: "error" | "success" | "info";
}

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

const VARIANT_STYLES: Record<Toast["variant"], string> = {
  error: "border-red-500/30 bg-red-50 dark:bg-red-950/80 text-red-700 dark:text-red-300",
  success: "border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300",
  info: "border-border bg-surface text-text-primary",
};

const CLOSE_BUTTON_STYLES: Record<Toast["variant"], string> = {
  error:
    "text-red-600/80 hover:text-red-700 dark:text-red-400/80 dark:hover:text-red-300 hover:bg-red-500/10 dark:hover:bg-red-500/20 active:bg-red-500/20 dark:active:bg-red-500/30 focus-visible:ring-red-500",
  success:
    "text-emerald-600/80 hover:text-emerald-700 dark:text-emerald-400/80 dark:hover:text-emerald-300 hover:bg-emerald-500/10 dark:hover:bg-emerald-500/20 active:bg-emerald-500/20 dark:active:bg-emerald-500/30 focus-visible:ring-emerald-500",
  info: "text-text-muted hover:text-text-primary hover:bg-hover active:bg-active focus-visible:ring-accent",
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animationsDisabled = useUIStore((s) => s.animationsDisabled);
  const shouldAnimate = !animationsDisabled;

  useEffect(() => {
    timerRef.current = setTimeout(() => onDismiss(toast.id), 5000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast.id, onDismiss]);

  return (
    <motion.div
      className={`flex items-start gap-2.5 px-4 py-3 rounded-xl border shadow-lg ${VARIANT_STYLES[toast.variant]}`}
      role="alert"
      aria-live="assertive"
      layout
      initial={{ opacity: 0, x: motionTokens.distance.xl, scale: motionTokens.scale.subtle }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{
        opacity: 0,
        x: motionTokens.distance.xl,
        scale: motionTokens.scale.subtle,
        transition: motionTransitions.modalExit,
      }}
      transition={motionTransitions.modalEnter}
    >
      <p className="flex-1 text-sm leading-relaxed">{toast.message}</p>
      <motion.button
        onClick={() => onDismiss(toast.id)}
        whileHover={shouldAnimate ? { scale: 1.04 } : undefined}
        whileTap={shouldAnimate ? { scale: 0.96 } : undefined}
        transition={springs.snappy}
        className={`shrink-0 p-1.5 rounded-full transition-colors outline-none focus-visible:ring-2 ${CLOSE_BUTTON_STYLES[toast.variant]}`}
        aria-label="Dismiss notification"
      >
        <X size={16} />
      </motion.button>
    </motion.div>
  );
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-20 right-4 z-50 flex flex-col gap-2 w-full max-w-sm pointer-events-none"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}
