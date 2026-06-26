"use client";
import { cn } from "@/lib/utils/cn";
import type { StatusAramburu } from "@/types";
import { useStatusConfig, getStatusEntry } from "@/lib/utils/status-config";

interface StatusBadgeProps {
  status: StatusAramburu | string;
  className?: string;
}

/**
 * Badge do status financeiro. Cores/rótulos vêm de `status_config` (editáveis em
 * Admin → Status & Cores), com fallback à legenda do Excel enquanto a config não
 * carrega ou se a tabela não existir. Reativo: re-renderiza ao carregar a config.
 */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { map } = useStatusConfig();
  const e = map.get(status) ?? getStatusEntry(status);
  return (
    <span
      style={{ backgroundColor: e.cor_bg, color: e.cor_text }}
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap",
        className,
      )}
    >
      {e.label}
    </span>
  );
}
