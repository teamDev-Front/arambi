"use client";
import { cn } from "@/lib/utils/cn";
import type { LucideIcon } from "lucide-react";

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  icon?: LucideIcon;
  /** Contador opcional exibido como pílula ao lado do label. */
  count?: number;
}

interface TabsProps<T extends string> {
  tabs: TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}

/**
 * Abas no padrão visual do app (mesmo estilo das abas de Configurações:
 * border-b-2 + cor accent na ativa). Controlado por fora (active/onChange).
 */
export function Tabs<T extends string>({ tabs, active, onChange, className }: TabsProps<T>) {
  return (
    <div className={cn("flex gap-1 border-b border-stone-200 overflow-x-auto", className)}>
      {tabs.map(({ id, label, icon: Icon, count }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
            active === id
              ? "border-accent-500 text-accent-700"
              : "border-transparent text-stone-500 hover:text-stone-700"
          )}
        >
          {Icon && <Icon size={15} />} {label}
          {count !== undefined && (
            <span
              className={cn(
                "inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[10px] font-semibold",
                active === id ? "bg-accent-100 text-accent-700" : "bg-stone-100 text-stone-500"
              )}
            >
              {count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
