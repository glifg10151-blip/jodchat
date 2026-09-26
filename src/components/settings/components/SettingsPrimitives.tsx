import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { springs, motionTokens, motionTransitions } from "../../../lib/motion-tokens";
import { Switch } from "../../ui/Switch";

interface SettingsSectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
}

export function SettingsSectionHeader({ title, description, actions, compact = false }: SettingsSectionHeaderProps) {
  const content = (
    <div>
      <h3
        className={
          compact
            ? "text-sm font-semibold text-text-primary mb-1"
            : "text-lg font-semibold tracking-tight text-text-primary mb-1"
        }
      >
        {title}
      </h3>
      {description != null && <p className="text-xs text-text-muted">{description}</p>}
    </div>
  );

  if (!actions) {
    return content;
  }

  return (
    <div className="flex items-center justify-between gap-3">
      {content}
      {actions}
    </div>
  );
}

interface SettingsHeaderButtonProps {
  children: ReactNode;
  onClick: () => void;
  ariaLabel?: string;
  disabled?: boolean;
}

export function SettingsHeaderButton({ children, onClick, ariaLabel, disabled = false }: SettingsHeaderButtonProps) {
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileHover={{ scale: motionTokens.scale.pop }}
      whileTap={{ scale: motionTokens.scale.press }}
      transition={springs.snappy}
      className="flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-lg bg-input text-text-primary hover:bg-hover border border-border text-sm font-medium transition-colors shadow-sm min-h-[44px]"
      aria-label={ariaLabel}
    >
      {children}
    </motion.button>
  );
}

interface SettingsEmptyStateProps {
  message: ReactNode;
  description?: ReactNode;
  actionLabel?: ReactNode;
  onAction?: () => void;
}

export function SettingsEmptyState({ message, description, actionLabel, onAction }: SettingsEmptyStateProps) {
  return (
    <div className="text-center py-8 bg-surface border border-border border-dashed rounded-xl">
      <p className="text-text-muted text-sm">{message}</p>
      {description != null && <p className="text-text-muted text-xs mt-1">{description}</p>}
      {actionLabel != null && onAction && (
        <button
          onClick={onAction}
          className="mt-2 text-accent hover:text-accent-hover text-sm font-medium min-h-[44px]"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

interface SettingsPanelProps {
  children: ReactNode;
  id?: string;
  className?: string;
  spacing?: "none" | "sm" | "md";
}

export function SettingsPanel({ children, id, className, spacing = "md" }: SettingsPanelProps) {
  const spacingClass = spacing === "sm" ? "space-y-2" : spacing === "md" ? "space-y-4" : "";

  return (
    <div
      id={id}
      className={`bg-surface border border-border rounded-xl p-4 ${spacingClass} shadow-sm${className ? ` ${className}` : ""}`}
    >
      {children}
    </div>
  );
}

interface SettingsDisclosureProps {
  open: boolean;
  children: ReactNode;
  className?: string;
}

export function SettingsDisclosure({ open, children, className = "" }: SettingsDisclosureProps) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={motionTransitions.content}
          className={`overflow-hidden${className ? ` ${className}` : ""}`}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface SettingsToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  children?: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  contentClassName?: string;
}

export function SettingsToggle({
  checked,
  onChange,
  label,
  description,
  children,
  ariaLabel,
  disabled,
  id,
  className = "",
  contentClassName = "",
}: SettingsToggleProps) {
  return (
    <div id={id} className={className}>
      <Switch
        checked={checked}
        onChange={onChange}
        label={label}
        description={description}
        ariaLabel={ariaLabel}
        disabled={disabled}
      />
      {children != null && (
        <SettingsDisclosure open={checked}>
          <div className={`mt-4 border-t border-border/50 pt-4${contentClassName ? ` ${contentClassName}` : ""}`}>
            {children}
          </div>
        </SettingsDisclosure>
      )}
    </div>
  );
}

interface SettingsTogglePanelProps extends Omit<SettingsToggleProps, "id"> {
  id?: string;
  panelClassName?: string;
}

export function SettingsTogglePanel({ id, panelClassName, ...toggleProps }: SettingsTogglePanelProps) {
  return (
    <SettingsPanel id={id} className={panelClassName} spacing="none">
      <SettingsToggle {...toggleProps} />
    </SettingsPanel>
  );
}
