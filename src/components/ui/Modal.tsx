import React, { useEffect, useId, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, ArrowUpCircle, Download, LoaderCircle } from "lucide-react";
import { useDialogFocus } from "../../hooks/useDialogFocus";
import { motionTokens, motionTransitions } from "../../lib/motion-tokens";
import { ToolConfirmation } from "../../store/useUIStore";
import { useTranslation } from "../../utils/i18n";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: string;
}

export function Modal({ isOpen, onClose, title, children, maxWidth = "max-w-md" }: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogFocus({ isOpen, onClose, containerRef: modalRef });

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: motionTransitions.modalExit }}
          transition={motionTransitions.modalEnter}
        >
          <motion.div
            className="absolute inset-0 backdrop-blur-sm"
            style={{ backgroundColor: "var(--theme-overlay)" }}
            onClick={onClose}
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionTransitions.modalEnter}
          />
          <motion.div
            ref={modalRef}
            tabIndex={-1}
            className={`relative z-10 flex max-h-[calc(100dvh-2rem)] w-full ${maxWidth} flex-col rounded-xl bg-surface border border-border`}
            style={{ boxShadow: "var(--shadow-xl)" }}
            initial={{ opacity: 0, scale: motionTokens.scale.subtle, y: motionTokens.distance.sm }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{
              opacity: 0,
              scale: motionTokens.scale.subtle,
              y: motionTokens.distance.sm,
              transition: motionTransitions.modalExit,
            }}
            transition={motionTransitions.modalEnter}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
              <h3 id={titleId} className="text-sm font-semibold text-text-primary">
                {title}
              </h3>
              <button
                onClick={onClose}
                className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-hover transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
                aria-label="Close dialog"
              >
                <X size={16} />
              </button>
            </div>
            <div className="min-h-0 overflow-y-auto p-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: "danger" | "default";
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  variant = "default",
}: ConfirmModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useDialogFocus({ isOpen, onClose: onCancel, containerRef: modalRef });

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <div
        className="absolute inset-0 backdrop-blur-sm"
        style={{ backgroundColor: "var(--theme-overlay)" }}
        onClick={onCancel}
        aria-hidden="true"
      />
      <div
        ref={modalRef}
        tabIndex={-1}
        className="relative z-10 max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-xl bg-surface border border-border"
        style={{ boxShadow: "var(--shadow-xl)" }}
      >
        <div className="px-5 pt-5 pb-1">
          <h3 id={titleId} className="text-sm font-semibold text-text-primary">
            {title}
          </h3>
          <p id={descriptionId} className="mt-1.5 text-sm text-text-secondary leading-relaxed">
            {message}
          </p>
        </div>
        <div className="flex gap-2 p-4 pt-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-text-secondary hover:bg-hover transition-[color,background-color,border-color,box-shadow,transform] min-h-[40px]"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-[color,background-color,border-color,box-shadow,transform] min-h-[40px] ${
              variant === "danger"
                ? "bg-red-500 text-white hover:bg-red-600"
                : "bg-accent text-accent-foreground hover:bg-accent-hover"
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

interface RenameChatModalProps {
  isOpen: boolean;
  currentTitle: string;
  onConfirm: (newTitle: string) => void;
  onCancel: () => void;
}

export function RenameChatModal({ isOpen, currentTitle, onConfirm, onCancel }: RenameChatModalProps) {
  const [value, setValue] = useState(currentTitle ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const isEmpty = !value || value.trim().length === 0;
  useDialogFocus({ isOpen, onClose: onCancel, containerRef: modalRef, initialFocusRef: inputRef });

  useEffect(() => {
    if (isOpen) requestAnimationFrame(() => inputRef.current?.select());
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (!isEmpty) {
      onConfirm(value.trim());
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        className="absolute inset-0 backdrop-blur-sm"
        style={{ backgroundColor: "var(--theme-overlay)" }}
        onClick={onCancel}
        aria-hidden="true"
      />
      <div
        ref={modalRef}
        tabIndex={-1}
        className="relative z-10 max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-xl bg-surface border border-border"
        style={{ boxShadow: "var(--shadow-xl)" }}
      >
        <div className="px-5 pt-5 pb-1">
          <h3 id={titleId} className="text-sm font-semibold text-text-primary">
            Rename Chat
          </h3>
          <label htmlFor="rename-input" className="sr-only">
            New title
          </label>
          <input
            id="rename-input"
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-3 w-full px-3 py-2 rounded-lg text-sm bg-input border border-input-border text-text-primary placeholder-text-muted focus:border-text-muted focus:outline-none transition-colors"
            placeholder="Enter new title"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConfirm();
            }}
          />
        </div>
        <div className="flex gap-2 p-4 pt-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-text-secondary hover:bg-hover transition-[color,background-color,border-color,box-shadow,transform] min-h-[40px]"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isEmpty}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-[color,background-color,border-color,box-shadow,opacity,transform] min-h-[40px] bg-accent text-accent-foreground hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Rename
          </button>
        </div>
      </div>
    </div>
  );
}

interface ToolConfirmationModalProps {
  confirmation: ToolConfirmation | null;
  onRespond: (id: string, approved: boolean) => void;
}

export function ToolConfirmationModal({ confirmation, onRespond }: ToolConfirmationModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const rejectConfirmation = useCallback(() => {
    if (confirmation) onRespond(confirmation.id, false);
  }, [confirmation, onRespond]);
  useDialogFocus({
    isOpen: Boolean(confirmation),
    onClose: rejectConfirmation,
    containerRef: modalRef,
  });

  if (!confirmation) return null;

  const { id, toolName, arguments: args } = confirmation;
  const stringArg = (key: string) => {
    const value = args[key];
    return typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
  };
  const fileArgs = Array.isArray(args.files)
    ? args.files.filter((file): file is string => typeof file === "string")
    : [];

  // Formatting content based on the tool
  let detailsContent: React.ReactNode;
  let warnMessage = "This action will execute code or modify files on your local machine.";

  if (toolName === "project_write") {
    detailsContent = (
      <div className="mt-2 text-left">
        <div className="text-xs font-semibold text-text-secondary mb-1">Target File:</div>
        <div className="bg-hover border border-border px-3 py-1.5 rounded font-mono text-xs text-text-primary break-all">
          {stringArg("file_path")}
        </div>
        <div className="text-xs font-semibold text-text-secondary mt-3 mb-1">Content:</div>
        <pre className="bg-hover border border-border p-3 rounded font-mono text-[11px] text-text-primary overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
          {stringArg("content")}
        </pre>
      </div>
    );
    warnMessage = "Writing files can modify project source code.";
  } else if (toolName === "project_bash") {
    detailsContent = (
      <div className="mt-2 text-left">
        <div className="text-xs font-semibold text-text-secondary mb-1">Command to Execute:</div>
        <pre className="bg-hover border border-border p-3 rounded font-mono text-xs text-text-primary overflow-x-auto whitespace-pre-wrap break-all">
          {stringArg("command")}
        </pre>
      </div>
    );
    warnMessage = "Executing commands can run arbitrary code on your system.";
  } else if (toolName === "project_git_commit" || toolName === "git_create_commit") {
    detailsContent = (
      <div className="mt-2 text-left">
        <div className="text-xs font-semibold text-text-secondary mb-1">Commit Message:</div>
        <div className="bg-hover border border-border px-3 py-2 rounded font-medium text-xs text-text-primary">
          {stringArg("message")}
        </div>
        {fileArgs.length > 0 && (
          <>
            <div className="text-xs font-semibold text-text-secondary mt-3 mb-1">Files:</div>
            <ul className="bg-hover border border-border p-2.5 rounded font-mono text-[11px] text-text-primary max-h-24 overflow-y-auto list-disc list-inside">
              {fileArgs.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
    warnMessage = "This will create a new Git commit in the repository.";
  } else {
    if (confirmation.destination) {
      warnMessage =
        "This MCP server is untrusted. Executing this tool may perform network requests or external operations.";
    }
    detailsContent = (
      <div className="mt-2 text-left">
        {confirmation.destination && (
          <div className="mb-2">
            <span className="text-xs font-semibold text-text-secondary">Destination: </span>
            <span className="font-mono text-xs text-accent bg-hover px-2 py-0.5 rounded border border-border">
              {confirmation.destination}
            </span>
          </div>
        )}
        <div className="text-xs font-semibold text-text-secondary mb-1">Arguments:</div>
        <pre className="bg-hover border border-border p-3 rounded font-mono text-xs text-text-primary overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
          {JSON.stringify(args, null, 2)}
        </pre>
        {confirmation.schema && (
          <div className="mt-3">
            <div className="text-xs font-semibold text-text-secondary mb-1">Input Schema:</div>
            <pre className="bg-hover border border-border p-3 rounded font-mono text-[11px] text-text-muted overflow-x-auto max-h-32 whitespace-pre-wrap break-all">
              {JSON.stringify(confirmation.schema, null, 2)}
            </pre>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <div
        className="absolute inset-0 backdrop-blur-sm"
        style={{ backgroundColor: "var(--theme-overlay)" }}
        onClick={() => onRespond(id, false)}
        aria-hidden="true"
      />
      <div
        ref={modalRef}
        tabIndex={-1}
        className="relative z-10 max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-xl bg-surface border border-border"
        style={{ boxShadow: "var(--shadow-xl)" }}
      >
        <div className="px-6 pt-5 pb-1">
          <h3 id={titleId} className="text-sm font-semibold text-text-primary">
            Tool Execution Authorization
          </h3>
          <p id={descriptionId} className="mt-1 text-xs text-red-500 font-medium">
            {warnMessage}
          </p>
          <div className="mt-3 py-1 border-t border-border">
            <div className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
              Tool Name: <span className="font-mono text-accent">{toolName}</span>
            </div>
            {detailsContent}
          </div>
        </div>
        <div className="flex gap-2.5 p-6 pt-4">
          <button
            type="button"
            onClick={() => onRespond(id, false)}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-text-secondary hover:bg-hover transition-[color,background-color,border-color,box-shadow,transform] min-h-[40px] border border-border"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => onRespond(id, true)}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-accent text-accent-foreground hover:bg-accent-hover transition-[color,background-color,border-color,box-shadow,transform] min-h-[40px]"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}

interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInstall: () => Promise<void>;
  currentVersion: string;
  latestVersion: string;
  releaseNotes?: string;
  isInstalling: boolean;
  downloadProgress: number | null;
  error: string | null;
}

export function UpdateModal({
  isOpen,
  onClose,
  onInstall,
  currentVersion,
  latestVersion,
  releaseNotes,
  isInstalling,
  downloadProgress,
  error,
}: UpdateModalProps) {
  const { t } = useTranslation();
  const modalRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogFocus({
    isOpen,
    onClose,
    containerRef: modalRef,
    closeOnEscape: !isInstalling,
  });

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: motionTransitions.modalExit }}
          transition={motionTransitions.modalEnter}
        >
          <motion.div
            className="absolute inset-0 backdrop-blur-sm"
            style={{ backgroundColor: "var(--theme-overlay)" }}
            onClick={isInstalling ? undefined : onClose}
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionTransitions.modalEnter}
          />
          <motion.div
            ref={modalRef}
            tabIndex={-1}
            className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-surface border border-border"
            style={{ boxShadow: "var(--shadow-xl)" }}
            initial={{ opacity: 0, scale: motionTokens.scale.subtle, y: motionTokens.distance.sm }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{
              opacity: 0,
              scale: motionTokens.scale.subtle,
              y: motionTokens.distance.sm,
              transition: motionTransitions.modalExit,
            }}
            transition={motionTransitions.modalEnter}
          >
            {/* Header Area */}
            <div className="flex items-start justify-between p-6 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-accent-soft text-accent">
                  <ArrowUpCircle size={24} className="animate-pulse" />
                </div>
                <div>
                  <h3 id={titleId} className="text-base font-bold text-text-primary">
                    {t("updates.title")}
                  </h3>
                  <p className="text-xs text-text-muted mt-0.5">{t("updates.newVersion")}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                disabled={isInstalling}
                className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-hover transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
                aria-label="Close dialog"
              >
                <X size={16} />
              </button>
            </div>

            {/* Content Area */}
            <div className="min-h-0 overflow-y-auto p-6 space-y-4">
              {/* Version Info Badge Comparison */}
              <div className="grid grid-cols-2 gap-4 bg-hover/40 border border-border/60 rounded-xl p-3.5">
                <div className="text-center space-y-1">
                  <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block">
                    {t("updates.current")}
                  </span>
                  <span className="text-sm font-mono font-medium text-text-secondary">{currentVersion}</span>
                </div>
                <div className="text-center space-y-1 border-l border-border/80">
                  <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block">
                    {t("updates.latest")}
                  </span>
                  <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full bg-accent-soft text-accent text-xs font-mono font-bold">
                    {latestVersion}
                  </span>
                </div>
              </div>

              {/* Release Notes */}
              {releaseNotes && (
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-text-primary block">{t("updates.releaseNotes")}</span>
                  <div className="bg-hover border border-border rounded-xl p-4 overflow-y-auto max-h-48 scrollbar-thin">
                    <pre className="font-sans text-xs text-text-secondary leading-relaxed whitespace-pre-wrap break-words">
                      {releaseNotes}
                    </pre>
                  </div>
                </div>
              )}

              {isInstalling && (
                <div className="space-y-2" aria-live="polite">
                  <div className="flex items-center justify-between text-xs text-text-secondary">
                    <span>{t("updates.installing")}</span>
                    {downloadProgress !== null && <span>{downloadProgress}%</span>}
                  </div>
                  <div
                    className="h-2 overflow-hidden rounded-full bg-input"
                    role="progressbar"
                    aria-label={t("updates.installing")}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={downloadProgress ?? undefined}
                  >
                    <motion.div
                      className="h-full rounded-full bg-accent"
                      initial={{ width: 0 }}
                      animate={{ width: downloadProgress === null ? "35%" : `${downloadProgress}%` }}
                      transition={motionTransitions.content}
                    />
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-300">
                  {error}
                </div>
              )}
            </div>

            {/* Actions Footer */}
            <div className="flex gap-3 p-6 pt-0">
              <button
                onClick={onClose}
                disabled={isInstalling}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium border border-border text-text-secondary hover:bg-hover hover:text-text-primary transition-[color,background-color,border-color,box-shadow,transform] min-h-[44px]"
              >
                {t("updates.remindLater")}
              </button>
              <button
                onClick={() => void onInstall()}
                disabled={isInstalling}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold bg-accent text-accent-foreground hover:bg-accent-hover transition-[color,background-color,border-color,box-shadow,transform] min-h-[44px] flex items-center justify-center gap-1.5 shadow-sm shadow-accent-soft"
              >
                <span>{isInstalling ? t("updates.installing") : t("updates.download")}</span>
                {isInstalling ? <LoaderCircle size={14} className="animate-spin" /> : <Download size={14} />}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
