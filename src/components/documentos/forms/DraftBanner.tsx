"use client";
import { History } from "lucide-react";

/** Aviso de rascunho recuperado, exibido no topo do formulário (RF-03). */
export function DraftBanner({ show, onDiscard }: { show: boolean; onDiscard: () => void }) {
  if (!show) return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <span className="flex items-center gap-2">
        <History size={14} className="shrink-0" />
        Rascunho recuperado automaticamente.
      </span>
      <button
        type="button"
        onClick={onDiscard}
        className="font-medium underline hover:no-underline shrink-0"
      >
        Descartar
      </button>
    </div>
  );
}
