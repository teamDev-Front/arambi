"use client";
// Ajuste 29-jul — busca do modelo de fornecedor do Termo de Transferência.
// São 94 termos-modelo: em vez de dropdown gigante, um autocomplete que casa
// nome do modelo, favorecido, razão social e CNPJ/CPF (sem acento/caixa).

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import {
  buscarTemplates, TERMO_TEMPLATES,
  type TermoFornecedorTemplate,
} from "@/lib/documentos/termo-templates";

interface Props {
  onSelect: (t: TermoFornecedorTemplate) => void;
}

export function TermoTemplatePicker({ onSelect }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const resultados = useMemo(() => buscarTemplates(q, 12), [q]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function escolher(t: TermoFornecedorTemplate) {
    onSelect(t);
    setQ("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) { setOpen(true); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setAtivo((a) => Math.min(a + 1, resultados.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAtivo((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (resultados[ativo]) escolher(resultados[ativo]); }
    else if (e.key === "Escape") setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <span className="absolute inset-y-0 left-3 flex items-center text-stone-400 pointer-events-none">
          <Search size={14} />
        </span>
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setAtivo(0); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={`Buscar entre os ${TERMO_TEMPLATES.length} modelos — nome, razão social ou CNPJ/CPF…`}
          autoComplete="off"
          className="w-full h-9 rounded-lg border border-stone-300 bg-white pl-9 pr-3 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent transition"
        />
      </div>

      {open && (
        <div className="absolute z-40 top-full mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-stone-200 bg-white shadow-lg py-1">
          {resultados.length === 0 && (
            <p className="px-3 py-3 text-center text-xs text-stone-400">
              Nenhum modelo encontrado — confira a grafia ou preencha os campos manualmente.
            </p>
          )}
          {resultados.map((t, i) => (
            <button
              key={t.id}
              type="button"
              // onMouseDown antes do blur, para o clique registrar.
              onMouseDown={(e) => { e.preventDefault(); escolher(t); }}
              onMouseEnter={() => setAtivo(i)}
              className={`w-full px-3 py-2 text-left ${i === ativo ? "bg-amber-50" : "hover:bg-stone-50"}`}
            >
              <p className="text-xs font-semibold text-stone-800">{t.nome}</p>
              <p className="text-[11px] text-stone-500 truncate">
                {t.destinatario.razao_social}
                {t.destinatario.documento ? ` · ${t.destinatario.documento}` : ""}
              </p>
            </button>
          ))}
          {q.trim() === "" && resultados.length > 0 && (
            <p className="px-3 pt-1.5 pb-1 border-t border-stone-100 text-[10px] text-stone-400">
              Digite para filtrar — ex.: {"“douravet”"}, {"“jv tubos”"} ou um CNPJ.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
