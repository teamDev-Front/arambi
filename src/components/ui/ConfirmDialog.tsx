"use client";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { AlertTriangle, Info } from "lucide-react";

type Tone = "danger" | "warning" | "info";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  /** Texto do botão de confirmar. Default "Confirmar". */
  confirmText?: string;
  /** Texto do cancelar. Default "Cancelar". */
  cancelText?: string;
  /** Visual do botão primário. Default "warning" (amarelo). */
  tone?: Tone;
  /** Quando o usuário confirma. */
  onConfirm: () => void | Promise<void>;
  /** Quando o usuário cancela (botão, X, overlay ou ESC). */
  onCancel: () => void;
  /** Bloqueia o botão de confirmar enquanto operação está em andamento. */
  busy?: boolean;
}

const TONE_ICON: Record<Tone, React.ReactNode> = {
  danger:  <AlertTriangle size={20} className="text-red-600" />,
  warning: <AlertTriangle size={20} className="text-amber-600" />,
  info:    <Info size={20} className="text-sky-600" />,
};

const TONE_ICONBG: Record<Tone, string> = {
  danger:  "bg-red-50",
  warning: "bg-amber-50",
  info:    "bg-sky-50",
};

const TONE_BUTTON: Record<Tone, "danger" | "primary" | "secondary"> = {
  danger:  "danger",
  warning: "primary",
  info:    "secondary",
};

/**
 * Diálogo de confirmação no padrão visual do projeto.
 * Substitui `window.confirm()` (que tem aparência de browser).
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = "Confirmar",
  cancelText  = "Cancelar",
  tone = "warning",
  onConfirm,
  onCancel,
  busy = false,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={busy ? () => {} : onCancel} size="sm">
      <div className="p-6 flex items-start gap-4">
        <span className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${TONE_ICONBG[tone]}`}>
          {TONE_ICON[tone]}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-stone-800">{title}</h3>
          {description && (
            <p className="text-xs text-stone-600 mt-1.5 leading-relaxed whitespace-pre-wrap">
              {description}
            </p>
          )}
        </div>
      </div>
      <div className="px-6 py-4 border-t border-stone-100 flex items-center justify-end gap-2 bg-stone-50/50">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          {cancelText}
        </Button>
        <Button
          type="button"
          variant={TONE_BUTTON[tone]}
          onClick={() => void onConfirm()}
          loading={busy}
          disabled={busy}
        >
          {confirmText}
        </Button>
      </div>
    </Modal>
  );
}
