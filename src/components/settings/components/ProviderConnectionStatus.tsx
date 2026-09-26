import type { ConnectionStatus } from "../../../types";
import { STATUS_COLORS } from "../../../types";
import { useTranslation } from "../../../utils/i18n";

const STATUS_KEYS: Record<ConnectionStatus, string> = {
  disconnected: "status.disconnected",
  connecting: "status.connecting",
  connected: "status.connected",
  error: "status.error",
};

interface ProviderConnectionStatusProps {
  status: ConnectionStatus;
}

export function ProviderConnectionStatus({ status }: ProviderConnectionStatusProps) {
  const { t } = useTranslation();
  const label = t(STATUS_KEYS[status]);

  return (
    <div className="flex items-center gap-2 mb-2" role="status" aria-atomic="true" aria-label={`Status: ${status}`}>
      <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[status]}`} aria-hidden="true" />
      <span className="text-[11px] text-text-muted">{label}</span>
    </div>
  );
}
