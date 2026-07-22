"use client";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

interface UnsavedChangesDialogProps {
  open: boolean;
  /** Volta ao formulário sem perder nada. */
  onStay: () => void;
  /** Descarta o que foi digitado e fecha o modal. */
  onDiscard: () => void;
}

/**
 * Diálogo padrão de confirmação de saída com alterações não salvas
 * (mesmo padrão da RF-03 do módulo Documentos). Renderizar como irmão do
 * modal de formulário — por vir depois no DOM, sobrepõe o modal aberto.
 */
export function UnsavedChangesDialog({ open, onStay, onDiscard }: UnsavedChangesDialogProps) {
  return (
    <Modal open={open} onClose={onStay} size="sm">
      <div className="p-6">
        <h3 className="text-sm font-semibold text-stone-800">Existem informações não salvas</h3>
        <p className="text-xs text-stone-600 mt-1.5 leading-relaxed">
          Se sair agora, o que foi digitado será perdido. O que deseja fazer?
        </p>
      </div>
      <div className="px-6 py-4 border-t border-stone-100 flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2 bg-stone-50/50">
        <Button type="button" variant="ghost" onClick={onStay}>
          Continuar editando
        </Button>
        <Button type="button" variant="danger" onClick={onDiscard}>
          Sair sem salvar
        </Button>
      </div>
    </Modal>
  );
}
