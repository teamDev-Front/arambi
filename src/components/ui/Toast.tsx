"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from "lucide-react";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
type ToastKind = "success" | "error" | "warning" | "info";

interface ToastItem {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
  duration?: number;          // ms — default 4500; 0 = não fecha sozinho
}

interface ToastContextValue {
  show: (t: Omit<ToastItem, "id">) => string;
  dismiss: (id: string) => void;
  /** Atalhos */
  success: (title: string, description?: string) => string;
  error:   (title: string, description?: string) => string;
  warning: (title: string, description?: string) => string;
  info:    (title: string, description?: string) => string;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast precisa estar dentro de <ToastProvider>");
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const tm = timersRef.current.get(id);
    if (tm) { clearTimeout(tm); timersRef.current.delete(id); }
  }, []);

  const show = useCallback((t: Omit<ToastItem, "id">) => {
    const id = (typeof crypto !== "undefined" && "randomUUID" in crypto)
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
    const duration = t.duration ?? 4500;
    setItems((prev) => [...prev, { ...t, id }]);
    if (duration > 0) {
      const tm = setTimeout(() => dismiss(id), duration);
      timersRef.current.set(id, tm);
    }
    return id;
  }, [dismiss]);

  // Limpa timers ao desmontar
  useEffect(() => {
    const timers = timersRef.current;
    return () => { timers.forEach((tm) => clearTimeout(tm)); timers.clear(); };
  }, []);

  const value: ToastContextValue = {
    show,
    dismiss,
    success: (title, description) => show({ kind: "success", title, description }),
    error:   (title, description) => show({ kind: "error",   title, description, duration: 7000 }),
    warning: (title, description) => show({ kind: "warning", title, description }),
    info:    (title, description) => show({ kind: "info",    title, description }),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Componente visual
// ---------------------------------------------------------------------------
const KIND_STYLES: Record<ToastKind, {
  bar: string; bg: string; iconBg: string; iconColor: string; title: string;
}> = {
  success: { bar: "bg-emerald-500", bg: "bg-white", iconBg: "bg-emerald-50", iconColor: "text-emerald-600", title: "text-emerald-900" },
  error:   { bar: "bg-red-500",     bg: "bg-white", iconBg: "bg-red-50",     iconColor: "text-red-600",     title: "text-red-900"     },
  warning: { bar: "bg-amber-500",   bg: "bg-white", iconBg: "bg-amber-50",   iconColor: "text-amber-600",   title: "text-amber-900"   },
  info:    { bar: "bg-sky-500",     bg: "bg-white", iconBg: "bg-sky-50",     iconColor: "text-sky-600",     title: "text-sky-900"     },
};

function ToastIcon({ kind, className }: { kind: ToastKind; className?: string }) {
  const props = { size: 18, className };
  switch (kind) {
    case "success": return <CheckCircle2 {...props} />;
    case "error":   return <AlertCircle  {...props} />;
    case "warning": return <AlertTriangle {...props} />;
    case "info":    return <Info {...props} />;
  }
}

function ToastViewport({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: string) => void }) {
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none w-[min(94vw,360px)]"
    >
      {items.map((t) => (
        <ToastCard key={t.id} item={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const styles = KIND_STYLES[item.kind];
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    // anima entrada
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      role="status"
      className={`pointer-events-auto relative ${styles.bg} rounded-xl shadow-lg shadow-stone-900/10 border border-stone-200 overflow-hidden transition-all duration-200 ${
        visible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-2"
      }`}
    >
      {/* barra colorida lateral */}
      <span className={`absolute left-0 top-0 bottom-0 w-1 ${styles.bar}`} />

      <div className="flex items-start gap-3 pl-4 pr-3 py-3">
        <span className={`shrink-0 mt-0.5 w-7 h-7 rounded-full ${styles.iconBg} ${styles.iconColor} flex items-center justify-center`}>
          <ToastIcon kind={item.kind} />
        </span>
        <div className="flex-1 min-w-0 pt-0.5">
          <p className={`text-sm font-semibold ${styles.title}`}>{item.title}</p>
          {item.description && (
            <p className="text-xs text-stone-600 mt-0.5 leading-relaxed break-words">
              {item.description}
            </p>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 text-stone-400 hover:text-stone-700 transition p-1 -mr-1 -mt-1 rounded"
          aria-label="Fechar"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
