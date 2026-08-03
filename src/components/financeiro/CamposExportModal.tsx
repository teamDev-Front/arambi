"use client";
// Tela de seleção de campos da exportação (RF 31-jul-2026).
//
// Antes, "Exportar PDF/XLSX" gerava um layout fixo. Agora ela escolhe o que
// entra no arquivo — inclusive campos que não cabem na tela (Tipo de Despesa,
// Obs. Obra, Parcelas, Forma de Pagamento) — e se quer a linha de filtros
// aplicados e os totais por banco.
//
// A escolha fica salva no navegador: quem monta o mesmo relatório todo mês não
// precisa remarcar tudo de novo.

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { FileDown, FileSpreadsheet, RotateCcw } from "lucide-react";
import {
  CAMPOS_EXPORT, CAMPOS_EXPORT_PADRAO, type CampoExport,
} from "@/lib/export/financeiro-export";

const STORAGE_KEY = "arambi.financeiro.export.campos.v1";

export interface CamposExportEscolha {
  campos: CampoExport[];
  incluirFiltros: boolean;
  incluirTotais: boolean;
}

type Preferencias = CamposExportEscolha;

function carregar(): Preferencias {
  const padrao: Preferencias = {
    campos: CAMPOS_EXPORT_PADRAO,
    incluirFiltros: true,
    incluirTotais: true,
  };
  if (typeof window === "undefined") return padrao;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return padrao;
    const p = JSON.parse(raw) as Partial<Preferencias>;
    const validos = new Set(CAMPOS_EXPORT.map((c) => c.key as string));
    const campos = Array.isArray(p.campos)
      ? (p.campos.filter((c) => validos.has(c)) as CampoExport[])
      : padrao.campos;
    return {
      campos: campos.length > 0 ? campos : padrao.campos,
      incluirFiltros: p.incluirFiltros !== false,
      incluirTotais: p.incluirTotais !== false,
    };
  } catch {
    return padrao;
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Quantas linhas o recorte tem (só informativo no cabeçalho). */
  totalLinhas: number;
  /** Descrição curta do recorte (ex.: "Seleção manual — 16 lançamentos"). */
  escopo: string;
  exportando: "pdf" | "xlsx" | null;
  onExportar: (formato: "pdf" | "xlsx", escolha: CamposExportEscolha) => void;
}

export function CamposExportModal({
  open, onClose, totalLinhas, escopo, exportando, onExportar,
}: Props) {
  const [pref, setPref] = useState<Preferencias>(() => carregar());

  // Hidrata do localStorage a cada abertura (outra aba pode ter mudado).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- leitura do localStorage ao abrir
    if (open) setPref(carregar());
  }, [open]);

  function persistir(p: Preferencias) {
    setPref(p);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /* sem localStorage */ }
  }

  function toggleCampo(key: CampoExport) {
    const marcado = pref.campos.includes(key);
    // Pelo menos um campo tem de sobrar — senão o arquivo sairia vazio.
    if (marcado && pref.campos.length === 1) return;
    persistir({
      ...pref,
      campos: marcado ? pref.campos.filter((c) => c !== key) : [...pref.campos, key],
    });
  }

  const todosMarcados = pref.campos.length === CAMPOS_EXPORT.length;

  return (
    <Modal open={open} onClose={onClose} title="Campos do relatório" size="lg">
      <div className="px-6 pt-4">
        <p className="text-xs text-stone-500 leading-relaxed">
          Escolha o que entra no arquivo. {escopo} · <b>{totalLinhas}</b> lançamento
          {totalLinhas === 1 ? "" : "s"}. As colunas saem sempre nesta ordem, independente da ordem
          em que você marcar.
        </p>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => persistir({ ...pref, campos: todosMarcados ? CAMPOS_EXPORT_PADRAO : CAMPOS_EXPORT.map((c) => c.key) })}
            className="h-7 px-2.5 rounded-lg border border-stone-200 text-xs font-medium text-stone-600 hover:bg-stone-50 cursor-pointer"
          >
            {todosMarcados ? "Só os campos padrão" : "Marcar todos"}
          </button>
          <button
            type="button"
            onClick={() => persistir({ campos: CAMPOS_EXPORT_PADRAO, incluirFiltros: true, incluirTotais: true })}
            className="h-7 px-2.5 rounded-lg text-xs font-medium text-stone-500 hover:text-stone-700 inline-flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw size={12} /> Restaurar padrão
          </button>
          <span className="ml-auto text-xs text-stone-400">
            {pref.campos.length} de {CAMPOS_EXPORT.length} campos
          </span>
        </div>
      </div>

      <div className="p-6 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
        {CAMPOS_EXPORT.map((c) => {
          const marcado = pref.campos.includes(c.key);
          return (
            <label
              key={c.key}
              className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-stone-50 cursor-pointer select-none"
            >
              <input
                type="checkbox"
                checked={marcado}
                onChange={() => toggleCampo(c.key)}
                className="h-3.5 w-3.5 rounded border-stone-300 accent-accent-500 cursor-pointer"
              />
              <span className={`text-sm ${marcado ? "text-stone-800" : "text-stone-500"}`}>
                {c.label}
              </span>
              {!c.padrao && (
                <span className="text-[10px] uppercase tracking-wide text-stone-300 font-semibold">
                  extra
                </span>
              )}
            </label>
          );
        })}
      </div>

      <div className="px-6 pb-4 border-t border-stone-100 pt-3 space-y-1">
        <label className="flex items-center gap-2.5 py-1 px-2 rounded-lg hover:bg-stone-50 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={pref.incluirFiltros}
            onChange={() => persistir({ ...pref, incluirFiltros: !pref.incluirFiltros })}
            className="h-3.5 w-3.5 rounded border-stone-300 accent-accent-500 cursor-pointer"
          />
          <span className="text-sm text-stone-700">Incluir a linha de filtros aplicados no cabeçalho</span>
        </label>
        <label className="flex items-center gap-2.5 py-1 px-2 rounded-lg hover:bg-stone-50 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={pref.incluirTotais}
            onChange={() => persistir({ ...pref, incluirTotais: !pref.incluirTotais })}
            className="h-3.5 w-3.5 rounded border-stone-300 accent-accent-500 cursor-pointer"
          />
          <span className="text-sm text-stone-700">Incluir subtotais por banco e total geral</span>
        </label>
      </div>

      <div className="px-6 py-4 border-t border-stone-100 flex items-center justify-end gap-2 bg-stone-50/50">
        <Button variant="ghost" onClick={onClose} disabled={!!exportando}>Cancelar</Button>
        <Button
          variant="outline"
          loading={exportando === "xlsx"}
          disabled={!!exportando}
          onClick={() => onExportar("xlsx", pref)}
        >
          <FileSpreadsheet size={14} /> Exportar XLSX
        </Button>
        <Button
          loading={exportando === "pdf"}
          disabled={!!exportando}
          onClick={() => onExportar("pdf", pref)}
        >
          <FileDown size={14} /> Exportar PDF
        </Button>
      </div>
    </Modal>
  );
}
