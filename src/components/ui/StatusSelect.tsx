"use client";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface StatusSelectOption {
  value: string;
  label: string;
  bg: string;    // cor de fundo (hex)
  text: string;  // cor do texto (hex)
}

interface StatusSelectProps {
  value: string;
  options: StatusSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  "aria-label"?: string;
}

/**
 * Select de status pintado com a cor do status atual (padrão da Distribuição
 * de Lucro, estendido ao Financeiro no ajuste 23-jul). Mudar o valor troca o
 * status direto na tela, sem abrir "Editar Lançamento".
 */
export function StatusSelect({
  value, options, onChange, disabled, title, className, "aria-label": ariaLabel,
}: StatusSelectProps) {
  const atual = options.find((o) => o.value === value);
  const cores = atual ? { backgroundColor: atual.bg, color: atual.text } : undefined;
  return (
    <span className={cn("relative inline-flex items-center", className)}>
      <select
        value={value}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel ?? "Mudar status"}
        onChange={(e) => onChange(e.target.value)}
        style={cores}
        className={cn(
          "h-7 rounded-full border-0 pl-3 pr-7 text-xs font-medium cursor-pointer appearance-none",
          "focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-accent-400",
          "disabled:opacity-60 disabled:cursor-not-allowed",
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} style={{ backgroundColor: "#ffffff", color: "#1c1917" }}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={12}
        className="absolute right-2 pointer-events-none"
        style={{ color: atual?.text }}
      />
    </span>
  );
}
