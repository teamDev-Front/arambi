"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface ComboBoxOption {
  value: string;   // id do cadastro
  label: string;   // nome exibido
}

interface ComboBoxProps {
  options: ComboBoxOption[];
  /** Texto atual do campo (controlado). */
  value: string;
  /** Chamado a cada digitação ou seleção (com o rótulo escolhido). */
  onChange: (text: string) => void;
  label?: string;
  placeholder?: string;
  emptyText?: string;
  /** Permite texto livre fora da lista (default true — cadastro cresce ao salvar). */
  id?: string;
}

/**
 * Caixa de seleção com busca + texto livre (RF 23-jul: campo Fornecedor).
 * Ao digitar, filtra os cadastrados; clicar numa opção preenche o campo.
 * Texto que não está na lista continua válido — o cadastro é criado ao salvar.
 */
export function ComboBox({
  options,
  value,
  onChange,
  label,
  placeholder = "Digite para buscar…",
  emptyText = "Nenhum cadastro — o nome digitado será cadastrado ao salvar.",
  id,
}: ComboBoxProps) {
  const [open, setOpen] = useState(false);
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

  const q = value.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options),
    [options, q],
  );
  const exato = options.some((o) => o.label.trim().toLowerCase() === q);

  return (
    <div ref={ref} className="flex flex-col gap-1.5 relative">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-stone-700">{label}</label>
      )}
      <div className="relative">
        <input
          id={id}
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full h-9 rounded-lg border border-stone-300 bg-white px-3 pr-8 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent transition"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? "Fechar sugestões" : "Abrir sugestões"}
          onClick={() => setOpen((o) => !o)}
          className="absolute inset-y-0 right-2 flex items-center text-stone-400 hover:text-stone-600"
        >
          <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {open && (
        <div className="absolute z-40 top-full mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-stone-200 bg-white shadow-lg py-1">
          {filtered.length === 0 && (
            <p className="px-3 py-3 text-center text-xs text-stone-400">{emptyText}</p>
          )}
          {filtered.slice(0, 200).map((o) => {
            const sel = o.label.trim().toLowerCase() === q;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.label); setOpen(false); }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-stone-50",
                  sel ? "text-stone-900 font-medium" : "text-stone-700",
                )}
              >
                {sel ? <Check size={12} className="text-accent-600 shrink-0" /> : <span className="w-3 shrink-0" />}
                <span className="truncate">{o.label}</span>
              </button>
            );
          })}
          {q && !exato && filtered.length > 0 && (
            <p className="px-3 pt-1.5 pb-1 border-t border-stone-100 text-[10px] text-stone-400">
              Nome fora da lista? Sem problema — será cadastrado ao salvar.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
