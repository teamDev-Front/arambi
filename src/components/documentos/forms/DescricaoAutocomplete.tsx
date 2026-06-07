"use client";
// RF-02 — Textarea de descrição com sugestões de textos já utilizados
// (por tipo de documento). Busca com debounce; seleção continua editável.

import { useEffect, useState } from "react";
import { Textarea } from "@/components/ui/Input";
import { sugerirDescricoes } from "@/lib/queries/documentos";
import type { DocumentoGeradoTipo } from "@/types";

interface Props {
  tipo: DocumentoGeradoTipo;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}

export function DescricaoAutocomplete({ tipo, label, value, onChange, placeholder, rows = 3 }: Props) {
  const [sugestoes, setSugestoes] = useState<string[]>([]);
  const [focado, setFocado] = useState(false);

  useEffect(() => {
    const q = value.trim();
    let ativo = true;
    const t = setTimeout(() => {
      if (!ativo) return;
      if (q.length < 2) { setSugestoes([]); return; }
      sugerirDescricoes(tipo, q)
        .then((rows) => {
          if (!ativo) return;
          setSugestoes(rows.filter((s) => s.toLowerCase() !== q.toLowerCase()));
        })
        .catch(() => { /* histórico é acessório */ });
    }, 300);
    return () => { ativo = false; clearTimeout(t); };
  }, [value, tipo]);

  const aberto = focado && sugestoes.length > 0;

  function selecionar(s: string) {
    onChange(s);
    setSugestoes([]);
    setFocado(false);
  }

  return (
    <div className="relative">
      <Textarea
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocado(true)}
        onBlur={() => setFocado(false)}
        onKeyDown={(e) => { if (e.key === "Escape") setFocado(false); }}
        placeholder={placeholder}
        rows={rows}
      />
      {aberto && (
        <ul className="absolute z-20 left-0 right-0 mt-1 max-h-52 overflow-y-auto rounded-lg border border-stone-200 bg-white shadow-lg">
          {sugestoes.map((s, i) => (
            <li key={i}>
              <button
                type="button"
                // onMouseDown (antes do blur) garante que o clique registre.
                onMouseDown={(e) => { e.preventDefault(); selecionar(s); }}
                className="block w-full text-left px-3 py-2 text-xs text-stone-700 hover:bg-amber-50 leading-relaxed"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
