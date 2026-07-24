"use client";
import { type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { FileText, Save } from "lucide-react";

interface FormShellProps {
  children: ReactNode;
  onCancel: () => void;
  onSubmit: () => void;
  submitting: boolean;
  submitLabel?: string;
  disabled?: boolean;
  /** Ação secundária opcional (RF 24-jul): "Salvar" sem gerar PDF na edição. */
  onSecondary?: () => void;
  secondaryLabel?: string;
  secondarySubmitting?: boolean;
}

export function FormShell({
  children, onCancel, onSubmit, submitting,
  submitLabel = "Gerar PDF", disabled,
  onSecondary, secondaryLabel = "Salvar sem gerar PDF", secondarySubmitting,
}: FormShellProps) {
  const busy = submitting || !!secondarySubmitting;
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (!disabled) onSubmit(); }}
      className="flex flex-col"
    >
      <div className="p-6 space-y-5 max-h-[calc(85vh-140px)] overflow-y-auto">
        {children}
      </div>
      <div className="px-6 py-4 border-t border-stone-100 flex items-center justify-end gap-2 bg-stone-50/50">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        {onSecondary && (
          <Button
            type="button"
            variant="outline"
            onClick={onSecondary}
            disabled={disabled || busy}
            loading={secondarySubmitting}
            title="Salva as alterações do documento sem gerar um novo PDF"
          >
            <Save size={14} /> {secondaryLabel}
          </Button>
        )}
        <Button type="submit" disabled={disabled || busy} loading={submitting}>
          <FileText size={14} /> {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function FormSection({ title, children, columns = 2 }: {
  title?: string;
  children: ReactNode;
  columns?: 1 | 2 | 3;
}) {
  const cols = columns === 1 ? "grid-cols-1" : columns === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-3";
  return (
    <div className="space-y-3">
      {title && (
        <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500 border-b border-stone-100 pb-1.5">
          {title}
        </h3>
      )}
      <div className={`grid ${cols} gap-4`}>{children}</div>
    </div>
  );
}
