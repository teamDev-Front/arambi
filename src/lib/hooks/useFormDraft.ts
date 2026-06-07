"use client";
// Rascunho automático de formulários (RF-03) — salva o estado em localStorage
// com debounce, recupera ao reabrir e informa o "dirty" ao componente pai.
//
// Drop-in para useState: `const [form, setForm, draft] = useFormDraft(tipo, inicial, onDirtyChange)`.
// Dados ficam só no navegador (sem dados sensíveis no servidor) e expiram em 7 dias.

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

const PREFIX = "arambi:doc-draft:";
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias
const DEBOUNCE_MS = 500;

interface Stored<T> {
  data: T;
  savedAt: number;
}

/** Chave de armazenamento do rascunho de um tipo de documento. */
export function draftKey(tipo: string): string {
  return PREFIX + tipo;
}

/** Remove o rascunho de um tipo (após gerar ou descartar). */
export function clearDraft(tipo: string): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(draftKey(tipo)); } catch { /* ignore */ }
}

function lerRascunho<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored<T>;
    if (!parsed || typeof parsed.savedAt !== "number") return null;
    if (Date.now() - parsed.savedAt > TTL_MS) {
      window.localStorage.removeItem(key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export interface DraftControl {
  /** true quando o estado inicial veio de um rascunho recuperado. */
  recovered: boolean;
  /** Descarta o rascunho e volta ao estado inicial. */
  discard: () => void;
}

export function useFormDraft<T extends object>(
  tipo: string,
  inicial: T,
  onDirtyChange?: (dirty: boolean) => void,
  editing = false,
): [T, Dispatch<SetStateAction<T>>, DraftControl] {
  const key = draftKey(tipo);

  // Editando um documento existente: ignora o rascunho genérico do localStorage
  // (carrega os dados originais e não persiste neste navegador).
  const [form, setForm] = useState<T>(() => {
    if (editing) return inicial;
    const rascunho = lerRascunho<T>(key);
    return rascunho ? { ...inicial, ...rascunho } : inicial;
  });
  const [recovered, setRecovered] = useState<boolean>(() => !editing && lerRascunho<T>(key) !== null);

  // Snapshot estável do estado "limpo" para comparar e detectar alterações.
  const baseline = JSON.stringify(inicial);

  // Mantém a callback mais recente sem re-disparar o efeito de autosave.
  const onDirtyRef = useRef(onDirtyChange);
  useEffect(() => { onDirtyRef.current = onDirtyChange; }, [onDirtyChange]);

  useEffect(() => {
    const dirty = JSON.stringify(form) !== baseline;
    onDirtyRef.current?.(dirty);
    if (editing) return;            // modo edição: não persiste rascunho local
    if (!dirty) {
      clearDraft(tipo);
      return;
    }
    const t = setTimeout(() => {
      try {
        const payload: Stored<T> = { data: form, savedAt: Date.now() };
        window.localStorage.setItem(key, JSON.stringify(payload));
      } catch { /* ignore (quota, modo privado) */ }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [form, baseline, key, tipo, editing]);

  const discard = () => {
    clearDraft(tipo);
    setForm(inicial);
    setRecovered(false);
    onDirtyRef.current?.(false);
  };

  return [form, setForm, { recovered, discard }];
}
