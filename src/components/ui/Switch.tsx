import { motion } from "motion/react";
import { springs } from "../../lib/motion-tokens";
import { useId } from "react";

interface SwitchBaseProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
  disabled?: boolean;
  className?: string;
}

type SwitchProps = SwitchBaseProps & ({ label: string; ariaLabel?: string } | { label?: string; ariaLabel: string });

export function Switch({ checked, onChange, label, description, ariaLabel, disabled, className = "" }: SwitchProps) {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <div
      className={`flex items-center justify-between gap-4 ${disabled ? "opacity-50 pointer-events-none" : ""} ${className}`}
    >
      {(label || description) && (
        <div className="min-w-0">
          {label && (
            <p id={labelId} className="text-sm font-medium text-text-primary">
              {label}
            </p>
          )}
          {description && (
            <p id={descriptionId} className="text-xs text-text-muted mt-0.5">
              {description}
            </p>
          )}
        </div>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        aria-labelledby={!ariaLabel && label ? labelId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent ${
          checked ? "bg-accent" : "bg-input-border"
        }`}
      >
        <motion.span
          className="inline-block h-4 w-4 rounded-full shadow-sm"
          style={{ backgroundColor: checked ? "var(--theme-accent-foreground)" : "#ffffff" }}
          initial={{ x: checked ? 24 : 4 }}
          animate={{
            x: checked ? 24 : 4,
          }}
          transition={springs.snappy}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}
