import { RefObject, useEffect, useRef } from "react";
import { lockBodyScroll, unlockBodyScroll } from "../utils/scrollLock";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogFocusOptions {
  isOpen: boolean;
  onClose: () => void;
  containerRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  lockScroll?: boolean;
  closeOnEscape?: boolean;
  inertBackground?: boolean;
}

const dialogStack: symbol[] = [];

function inertOutside(container: HTMLElement): () => void {
  const snapshots: Array<{ element: HTMLElement; inert: boolean; ariaHidden: string | null }> = [];
  let branch: HTMLElement | null = container.closest<HTMLElement>('[aria-modal="true"]') ?? container;

  while (branch?.parentElement) {
    const parent: HTMLElement = branch.parentElement;
    for (const sibling of Array.from(parent.children)) {
      if (!(sibling instanceof HTMLElement) || sibling === branch || sibling.hasAttribute("data-dialog-backdrop")) {
        continue;
      }
      snapshots.push({ element: sibling, inert: sibling.inert, ariaHidden: sibling.getAttribute("aria-hidden") });
      sibling.inert = true;
      sibling.setAttribute("aria-hidden", "true");
    }
    branch = parent;
    if (parent === document.body) break;
  }

  return () => {
    for (const snapshot of snapshots.reverse()) {
      snapshot.element.inert = snapshot.inert;
      if (snapshot.ariaHidden === null) snapshot.element.removeAttribute("aria-hidden");
      else snapshot.element.setAttribute("aria-hidden", snapshot.ariaHidden);
    }
  };
}

export function useDialogFocus({
  isOpen,
  onClose,
  containerRef,
  initialFocusRef,
  lockScroll = true,
  closeOnEscape = true,
  inertBackground = true,
}: DialogFocusOptions): void {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const stackId = Symbol("dialog-focus-scope");
    dialogStack.push(stackId);
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const restoreInert = containerRef.current && inertBackground ? inertOutside(containerRef.current) : undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (dialogStack.at(-1) !== stackId) return;
      if (event.key === "Escape") {
        if (!closeOnEscape) return;
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !containerRef.current) return;

      const focusable = Array.from(containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        event.preventDefault();
        containerRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || !containerRef.current.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    if (lockScroll) lockBodyScroll();
    requestAnimationFrame(() => {
      const initial =
        initialFocusRef?.current ??
        containerRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
        containerRef.current;
      initial?.focus();
    });

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (lockScroll) unlockBodyScroll();
      const stackIndex = dialogStack.lastIndexOf(stackId);
      if (stackIndex >= 0) dialogStack.splice(stackIndex, 1);
      restoreInert?.();
      if (previouslyFocused?.isConnected && !previouslyFocused.closest("[inert]")) previouslyFocused.focus();
    };
  }, [closeOnEscape, containerRef, inertBackground, initialFocusRef, isOpen, lockScroll]);
}
