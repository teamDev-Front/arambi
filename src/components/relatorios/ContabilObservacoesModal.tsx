"use client";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { UnsavedChangesDialog } from "@/components/ui/UnsavedChangesDialog";
import { useUnsavedGuard } from "@/lib/hooks/useUnsavedGuard";
import { Plus, Trash2, FileText } from "lucide-react";
import type { ContabilObservacao } from "@/lib/pdfmonkey/types";

interface Props {
  open: boolean;
  mesRef: string;
  onClose: () => void;
  onConfirmar: (observacoes: ContabilObservacao[]) => void | Promise<void>;
  submitting: boolean;
}

export function ContabilObservacoesModal({ open, mesRef, onClose, onConfirmar, submitting }: Props) {
  const [obs, setObs] = useState<ContabilObservacao[]>([{ titulo: "", texto: "" }]);
  const guard = useUnsavedGuard(open, obs, onClose);

  function add() { setObs((prev) => [...prev, { titulo: "", texto: "" }]); }
  function remove(i: number) { setObs((prev) => prev.filter((_, k) => k !== i)); }
  function update(i: number, patch: Partial<ContabilObservacao>) {
    setObs((prev) => prev.map((o, k) => (k === i ? { ...o, ...patch } : o)));
  }

  // Filtra observações vazias antes de mandar
  function handleConfirmar() {
    const limpo = obs
      .map((o) => ({ titulo: o.titulo.trim(), texto: o.texto.trim() }))
      .filter((o) => o.titulo || o.texto);
    void onConfirmar(limpo);
  }

  return (
    <Modal open={open} onClose={guard.requestClose} title={`Observações do Relatório Contábil — ${mesRef}`} size="xl">
      <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
        <p className="text-xs text-stone-500">
          Cada observação é um <strong>cartão</strong> no PDF, com título em negrito e texto explicativo abaixo. Use para registrar alterações de banco, NFs pendentes, avisos sobre fornecedores, etc.
          Deixe em branco para gerar sem observações.
        </p>

        {obs.map((o, i) => (
          <div key={i} className="rounded-lg border border-stone-200 p-4 space-y-3 bg-stone-50/40">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-stone-500">Observação {i + 1}</span>
              {obs.length > 1 && (
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="p-1.5 rounded hover:bg-red-50 text-stone-400 hover:text-red-500 transition"
                  title="Remover esta observação"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
            <Input
              label="Título"
              value={o.titulo}
              onChange={(e) => update(i, { titulo: e.target.value })}
              placeholder="Ex.: Cooperativa Sicredi de Maracaju — alteração de identificação"
            />
            <Textarea
              label="Texto"
              rows={5}
              value={o.texto}
              onChange={(e) => update(i, { texto: e.target.value })}
              placeholder="Descreva o aviso, mudança ou informação relevante para a contabilidade…"
            />
          </div>
        ))}

        <button
          type="button"
          onClick={add}
          className="w-full py-3 rounded-lg border border-dashed border-stone-300 text-sm text-stone-500 hover:border-[#a67c20] hover:text-[#a67c20] transition flex items-center justify-center gap-2"
        >
          <Plus size={14} /> Adicionar observação
        </button>
      </div>

      <div className="px-6 py-4 border-t border-stone-100 flex items-center justify-end gap-2 bg-stone-50/50">
        <Button type="button" variant="ghost" onClick={guard.requestClose} disabled={submitting}>Cancelar</Button>
        <Button onClick={handleConfirmar} disabled={submitting} loading={submitting}>
          <FileText size={13} /> Gerar PDF
        </Button>
      </div>
      <UnsavedChangesDialog open={guard.confirmOpen} onStay={guard.stay} onDiscard={guard.discard} />
    </Modal>
  );
}
