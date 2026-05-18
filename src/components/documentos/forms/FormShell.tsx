"use client";
import { type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { FileText } from "lucide-react";

interface FormShellProps {
  children: ReactNode;
  onCancel: () => void;
  onSubmit: () => void;
  submitting: boolean;
  submitLabel?: string;
  disabled?: boolean;
}

export function FormShell({
  children, onCancel, onSubmit, submitting,
  submitLabel = "Gerar PDF", disabled,
}: FormShellProps) {
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (!disabled) onSubmit(); }}
      className="flex flex-col"
    >
      <div className="p-6 space-y-5 max-h-[calc(85vh-140px)] overflow-y-auto">
        {children}
      </div>
      <div className="px-6 py-4 border-t border-stone-100 flex items-center justify-end gap-2 bg-stone-50/50">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancelar
        </Button>
        <Button type="submit" disabled={disabled || submitting} loading={submitting}>
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
