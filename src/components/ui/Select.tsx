import { useState, useRef, useEffect, useId, useCallback, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, Check } from "lucide-react";
import { motionTransitions, springs } from "../../lib/motion-tokens";

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  className?: string;
  id?: string;
  size?: "default" | "compact";
  placeholder?: string;
  "aria-label"?: string;
}

export function Select({
  value,
  onChange,
  options,
  disabled = false,
  className = "",
  id,
  size = "default",
  placeholder,
  "aria-label": ariaLabel,
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const generatedId = useId();
  const listboxId = `${id ?? generatedId}-listbox`;
  const triggerId = `${id ?? generatedId}-trigger`;
  const selectedOption = options.find((option) => option.value === value);
  const safeActiveIndex = Math.min(activeIndex, Math.max(0, options.length - 1));
  const triggerSizeClass = size === "compact" ? "px-2 py-1.5 text-xs" : "h-10 px-3 py-2 text-sm";
  const optionSizeClass = size === "compact" ? "px-2 py-1.5 text-xs" : "min-h-[44px] px-3 py-2.5 text-sm";

  const positionListbox = useCallback(() => {
    const trigger = buttonRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 8;
    const menuGap = 4;
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding;
    const availableAbove = rect.top - viewportPadding;
    const openAbove = availableBelow < 200 && availableAbove > availableBelow;
    const availableHeight = openAbove ? availableAbove : availableBelow;
    const maxWidth = Math.max(0, window.innerWidth - viewportPadding * 2);
    const width = Math.min(Math.max(rect.width, 150), maxWidth);
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
    );

    setMenuStyle({
      left,
      width,
      maxHeight: Math.max(40, Math.min(240, availableHeight - menuGap)),
      ...(openAbove
        ? { bottom: window.innerHeight - rect.top + menuGap, top: undefined }
        : { top: rect.bottom + menuGap, bottom: undefined }),
    });
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef.current && !containerRef.current.contains(target) && !listboxRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    positionListbox();
    window.addEventListener("resize", positionListbox);
    window.addEventListener("scroll", positionListbox, true);
    return () => {
      window.removeEventListener("resize", positionListbox);
      window.removeEventListener("scroll", positionListbox, true);
    };
  }, [isOpen, positionListbox]);

  const openListbox = () => {
    const selectedIndex = options.findIndex((option) => option.value === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    positionListbox();
    setIsOpen(true);
  };

  const closeListbox = (restoreFocus = true) => {
    setIsOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => buttonRef.current?.focus());
    }
  };

  const selectActiveOption = () => {
    const option = options[safeActiveIndex];
    if (!option) return;
    onChange(option.value);
    closeListbox();
  };

  useEffect(() => {
    if (isOpen) {
      listboxRef.current?.focus();
    }
  }, [isOpen]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (isOpen) {
        closeListbox();
      } else {
        openListbox();
      }
    } else if (event.key === "Escape") {
      closeListbox();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openListbox();
    }
  };

  const handleListboxKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(0, options.length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(0, options.length - 1));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectActiveOption();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeListbox();
    } else if (event.key === "Tab") {
      closeListbox(false);
    }
  };

  const listbox = (
    <AnimatePresence>
      {isOpen && (
        <motion.ul
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabel ? undefined : triggerId}
          aria-activedescendant={options[safeActiveIndex] ? `${listboxId}-option-${safeActiveIndex}` : undefined}
          tabIndex={-1}
          onKeyDown={handleListboxKeyDown}
          initial={{ opacity: 0, scale: 0.95, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.98, y: -4, transition: motionTransitions.popoverExit }}
          transition={motionTransitions.popoverEnter}
          style={menuStyle}
          className="popup-surface fixed z-[100] max-h-60 min-w-[150px] overflow-auto rounded-xl border border-border p-1 shadow-lg focus:outline-none scrollbar-thin"
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === safeActiveIndex;
            return (
              <li
                id={`${listboxId}-option-${index}`}
                key={option.value}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIndex(index)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onChange(option.value);
                    closeListbox(false);
                  }
                }}
                onClick={() => {
                  onChange(option.value);
                  closeListbox(false);
                }}
                className={`flex items-center justify-between ${optionSizeClass} rounded-lg cursor-pointer transition-colors ${
                  isSelected
                    ? "bg-accent text-accent-foreground font-medium"
                    : isActive
                      ? "bg-hover text-text-primary"
                      : "text-text-primary hover:bg-hover hover:text-text-primary"
                }`}
              >
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate">{option.label}</span>
                  {option.description && (
                    <span
                      className={`block truncate text-[10px] font-normal ${
                        isSelected ? "text-accent-foreground/70" : "text-text-muted"
                      }`}
                    >
                      {option.description}
                    </span>
                  )}
                </span>
                {isSelected && <Check size={14} className="shrink-0 ml-2" />}
              </li>
            );
          })}
        </motion.ul>
      )}
    </AnimatePresence>
  );

  return (
    <div ref={containerRef} className={`relative ${className}`} id={id}>
      <button
        ref={buttonRef}
        id={triggerId}
        type="button"
        disabled={disabled}
        onClick={() => (isOpen ? closeListbox() : openListbox())}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-label={ariaLabel}
        className={`w-full flex items-center justify-between gap-2 ${triggerSizeClass} rounded-lg border bg-input text-text-primary focus-visible:border-accent focus-visible:outline-none transition-[border-color,background-color,color] cursor-pointer ${
          isOpen ? "border-accent bg-hover/50" : "border-input-border"
        } ${disabled ? "opacity-50 cursor-not-allowed pointer-events-none" : ""}`}
      >
        <span className="truncate">{selectedOption?.label ?? placeholder ?? value}</span>
        <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={springs.snappy}>
          <ChevronDown size={14} className="text-text-muted" />
        </motion.div>
      </button>

      {typeof document !== "undefined" && createPortal(listbox, document.body)}
    </div>
  );
}
