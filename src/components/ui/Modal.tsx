"use client";
import { cn } from "@/lib/utils/cn";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  /** Fecha ao clicar fora (overlay). Default true. Use false p/ evitar perda
   *  de dados em formulários (ex.: geração de documentos). */
  closeOnBackdrop?: boolean;
}

const sizeClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export function Modal({ open, onClose, title, children, size = "md", className, closeOnBackdrop = true }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (closeOnBackdrop && e.target === overlayRef.current) onClose(); }}
    >
      <div
        className={cn(
          "relative w-full bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]",
          sizeClasses[size],
          className
        )}
      >
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100 shrink-0">
            <h2 className="text-base font-semibold text-stone-800">{title}</h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-stone-100 text-stone-500 transition"
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}
