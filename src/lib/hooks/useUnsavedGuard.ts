"use client";
import { useCallback, useEffect, useState } from "react";

/**
 * Trava padrão contra perda de dados em modais de formulário (padrão RF-03).
 *
 * Tira um "snapshot" do formulário no momento em que o modal abre e compara a
 * cada render. Se houver alteração não salva, `requestClose` abre o diálogo de
 * confirmação em vez de fechar direto; enquanto estiver sujo, fechar/recarregar
 * a aba do navegador também dispara o aviso nativo (beforeunload).
 *
 * Uso:
 *   const guard = useUnsavedGuard(modalOpen, form, () => setModalOpen(false));
 *   <Modal open={modalOpen} onClose={guard.requestClose} …>
 *     …
 *     <Button variant="ghost" onClick={guard.requestClose}>Cancelar</Button>
 *   </Modal>
 *   <UnsavedChangesDialog open={guard.confirmOpen} onStay={guard.stay} onDiscard={guard.discard} />
 *
 * Modais que carregam dados assíncronos após abrir devem passar
 * `open && !loading` como primeiro argumento (snapshot só após o load) —
 * ou chamar `rebaseline()` quando os dados chegarem.
 *
 * O fechamento programático (ex.: após salvar com sucesso) continua sendo feito
 * direto pelo setState da página — a trava não interfere.
 */
export function useUnsavedGuard<T>(open: boolean, value: T, close: () => void) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [prevOpen, setPrevOpen] = useState(false);

  // Snapshot na transição fechado→aberto (padrão "adjust state during render").
  if (open !== prevOpen) {
    setPrevOpen(open);
    setBaseline(open ? JSON.stringify(value ?? null) : null);
    if (!open && confirmOpen) setConfirmOpen(false);
  }

  const dirty =
    open && baseline != null && JSON.stringify(value ?? null) !== baseline;

  // Fechar/recarregar a aba do navegador com dados não salvos → aviso nativo.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  /** Re-captura o snapshot (ex.: após carregar dados assíncronos no modal). */
  const rebaseline = useCallback(() => {
    setBaseline(JSON.stringify(value ?? null));
  }, [value]);

  const requestClose = useCallback(() => {
    if (dirty) { setConfirmOpen(true); return; }
    close();
  }, [dirty, close]);

  const discard = useCallback(() => { setConfirmOpen(false); close(); }, [close]);
  const stay = useCallback(() => setConfirmOpen(false), []);

  return { requestClose, confirmOpen, discard, stay, dirty, rebaseline };
}
