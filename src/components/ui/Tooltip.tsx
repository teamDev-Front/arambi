"use client";
import { useState, type ReactNode } from "react";

interface TooltipProps {
  text: string;
  children: ReactNode;
  position?: "top" | "bottom";
  className?: string;
}

/**
 * Tooltip leve em CSS puro (sem dependência externa).
 * Aparece no hover e suporta texto curto explicativo.
 */
export function Tooltip({ text, children, position = "top", className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className={`relative inline-flex items-center cursor-help ${className ?? ""}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className={`absolute z-50 left-1/2 -translate-x-1/2 px-2.5 py-1.5 rounded-md bg-stone-900 text-white text-[10px] font-normal leading-tight shadow-lg whitespace-normal w-44 text-center pointer-events-none ${
            position === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5"
          }`}
        >
          {text}
          <span
            className={`absolute left-1/2 -translate-x-1/2 w-0 h-0 border-x-4 border-x-transparent ${
              position === "top"
                ? "top-full border-t-4 border-t-stone-900"
                : "bottom-full border-b-4 border-b-stone-900"
            }`}
          />
        </span>
      )}
    </span>
  );
}
