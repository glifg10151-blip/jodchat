import { AlertCircle } from "lucide-react";

export function EndpointError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="flex items-start gap-1 text-[11px] text-red-600 dark:text-red-400 mt-0.5">
      <AlertCircle size={12} className="shrink-0 mt-0.5" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}
