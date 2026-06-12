"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  /** Texto no rótulo quando há N selecionados (ex.: "centros"). */
  unitLabel?: string;
}

/**
 * Seletor de múltipla escolha com busca, em popover.
 * Usado nos filtros do Financeiro (ex.: Centro de Custo).
 * Controlado: `value` é a lista de códigos selecionados.
 */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "Selecionar…",
  searchPlaceholder = "Buscar…",
  emptyText = "Nenhuma opção",
  className,
  unitLabel = "selecionados",
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selectedSet = new Set(value);
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;

  function toggle(v: string) {
    if (selectedSet.has(v)) onChange(value.filter((x) => x !== v));
    else onChange([...value, v]);
  }

  const buttonLabel =
    value.length === 0
      ? placeholder
      : value.length === 1
        ? options.find((o) => o.value === value[0])?.label ?? `1 ${unitLabel}`
        : `${value.length} ${unitLabel}`;

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "h-8 rounded-lg border border-stone-200 pl-2 pr-1.5 text-xs flex items-center gap-1 bg-white w-full min-w-[10rem]",
          value.length > 0 ? "text-stone-700" : "text-stone-500",
        )}
      >
        <span className="truncate flex-1 text-left">{buttonLabel}</span>
        {value.length > 0 && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Limpar seleção"
            onClick={(e) => {
              e.stopPropagation();
              onChange([]);
            }}
            className="text-stone-400 hover:text-stone-600 shrink-0"
          >
            <X size={12} />
          </span>
        )}
        <ChevronDown size={12} className="text-stone-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-64 max-h-72 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-lg flex flex-col">
          <div className="p-2 border-b border-stone-100">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full h-7 rounded-md border border-stone-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-accent-400"
            />
          </div>
          <div className="overflow-y-auto py-1" role="listbox" aria-multiselectable>
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-stone-400">{emptyText}</p>
            )}
            {filtered.map((o) => {
              const sel = selectedSet.has(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={sel}
                  onClick={() => toggle(o.value)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-stone-50"
                >
                  <span
                    className={cn(
                      "w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                      sel ? "bg-accent-500 border-accent-500 text-white" : "border-stone-300",
                    )}
                  >
                    {sel && <Check size={11} />}
                  </span>
                  <span className="truncate text-stone-700">{o.label}</span>
                </button>
              );
            })}
          </div>
          {value.length > 0 && (
            <div className="border-t border-stone-100 p-1.5 flex justify-between items-center">
              <span className="text-[10px] text-stone-400 px-1">
                {value.length} {unitLabel}
              </span>
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-[11px] text-stone-500 hover:text-stone-700 px-2 py-0.5"
              >
                Limpar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
