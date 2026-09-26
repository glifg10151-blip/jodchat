import { useState } from "react";
import { Modal } from "./ui/Modal";
import { useUIStore } from "../store/useUIStore";
import { ExternalLink, AlertTriangle } from "lucide-react";
import { normalizeExternalUrl, openExternalUrl } from "../utils/externalUrl";

export function LinkWarningModal() {
  const isOpen = useUIStore((s) => s.showLinkWarningModal);
  const pendingUrl = useUIStore((s) => s.pendingLinkUrl);
  const setSkipWarning = useUIStore((s) => s.setSkipExternalLinkWarning);
  const setShowModal = useUIStore((s) => s.setShowLinkWarningModal);

  const [skipNextTime, setSkipNextTime] = useState(false);

  const handleClose = () => {
    setShowModal(false, null);
    setTimeout(() => setSkipNextTime(false), 200);
  };

  const handleContinue = async () => {
    if (skipNextTime) {
      setSkipWarning(true);
    }

    if (pendingUrl && normalizeExternalUrl(pendingUrl)) {
      await openExternalUrl(pendingUrl);
    }

    setShowModal(false, null);
    setTimeout(() => setSkipNextTime(false), 200);
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="External Link Warning">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500">
          <AlertTriangle className="shrink-0 mt-0.5" size={18} />
          <div className="text-sm">
            <p className="font-semibold mb-1">
              {pendingUrl && normalizeExternalUrl(pendingUrl)
                ? "You are about to leave the app"
                : "This link is invalid or uses a blocked protocol"}
            </p>
            <p className="opacity-90">Please ensure you trust this link before opening it.</p>
          </div>
        </div>

        <div className="bg-input border border-border p-3 rounded-lg overflow-x-auto">
          <p className="text-xs font-mono text-text-primary whitespace-nowrap">{pendingUrl || "Unknown URL"}</p>
        </div>

        <label className="flex items-center gap-2 mt-2 cursor-pointer group">
          <div className="relative flex items-center justify-center w-4 h-4 border border-border rounded bg-surface group-hover:border-accent transition-colors">
            <input
              type="checkbox"
              className="absolute opacity-0 w-full h-full cursor-pointer"
              checked={skipNextTime}
              onChange={(e) => setSkipNextTime(e.target.checked)}
            />
            {skipNextTime && <div className="w-2.5 h-2.5 bg-accent rounded-sm" />}
          </div>
          <span className="text-sm text-text-secondary group-hover:text-text-primary transition-colors">
            Don't show this warning again
          </span>
        </label>

        <div className="flex gap-3 mt-2">
          <button
            onClick={handleClose}
            className="flex-1 px-4 py-2 rounded-lg text-sm font-medium border border-border text-text-secondary hover:bg-hover hover:text-text-primary transition-[color,background-color,border-color,box-shadow,transform] min-h-[40px]"
          >
            Cancel
          </button>
          <button
            onClick={handleContinue}
            disabled={!pendingUrl || !normalizeExternalUrl(pendingUrl)}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-accent-foreground hover:bg-accent-hover transition-[color,background-color,border-color,box-shadow,transform] min-h-[40px]"
          >
            <span>Continue</span>
            <ExternalLink size={14} />
          </button>
        </div>
      </div>
    </Modal>
  );
}
