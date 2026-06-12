import { cn } from "@/lib/utils/cn";
import { STATUS_ARAMBURU_LABEL, type StatusAramburu } from "@/types";
import { statusBadgeClassName } from "@/lib/utils/status-colors";

interface StatusBadgeProps {
  status: StatusAramburu;
  className?: string;
}

/**
 * Badge do status financeiro com as cores da legenda do Excel (RF-FIN-05).
 * Fonte única da verdade de status → cor, garantindo consistência entre telas.
 */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap",
        statusBadgeClassName(status),
        className,
      )}
    >
      {STATUS_ARAMBURU_LABEL[status]}
    </span>
  );
}
