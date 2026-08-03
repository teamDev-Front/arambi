"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X, Undo2, Loader2 } from "lucide-react";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
type ToastKind = "success" | "error" | "warning" | "info";

/** Janela do "Desfazer ação" (RF 31-jul-2026) — o mesmo conceito do envio de e-mail. */
export const DESFAZER_MS = 8000;

interface ToastAction {
  label: string;
  /** Executada ao clicar. Se lançar, o toast mostra o erro e permanece. */
  onClick: () => void | Promise<void>;
}

interface ToastItem {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
  duration?: number;          // ms — default 4500; 0 = não fecha sozinho
  /** Botão de ação no próprio toast (ex.: "Desfazer"). */
  action?: ToastAction;
}

interface ToastContextValue {
  show: (t: Omit<ToastItem, "id">) => string;
  dismiss: (id: string) => void;
  /** Atalhos */
  success: (title: string, description?: string) => string;
  error:   (title: string, description?: string) => string;
  warning: (title: string, description?: string) => string;
  info:    (title: string, description?: string) => string;
  /**
   * Confirmação com janela de arrependimento (RF 31-jul): mostra o resultado da
   * operação por 8 segundos com o botão "Desfazer".
   *
   * A gravação NÃO é adiada — ela já aconteceu. O `onUndo` é a ação
   * compensatória (apagar o que foi criado, restaurar o valor anterior,
   * recriar o que foi excluído). Adiar a escrita seria pior num sistema
   * financeiro: fechar a aba antes dos 8s perderia o lançamento.
   */
  desfazer: (title: string, description: string | undefined, onUndo: () => void | Promise<void>) => string;
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

  // Atalhos estáveis — não recriar referência a cada render, senão consumidores
  // que listam `toast` em deps de useEffect/useCallback ficam refazendo o
  // trabalho a cada toast disparado em outro lugar.
  const success = useCallback((title: string, description?: string) => show({ kind: "success", title, description }), [show]);
  const error   = useCallback((title: string, description?: string) => show({ kind: "error",   title, description, duration: 7000 }), [show]);
  const warning = useCallback((title: string, description?: string) => show({ kind: "warning", title, description }), [show]);
  const info    = useCallback((title: string, description?: string) => show({ kind: "info",    title, description }), [show]);

  const desfazer = useCallback(
    (title: string, description: string | undefined, onUndo: () => void | Promise<void>) =>
      show({
        kind: "success",
        title,
        description,
        duration: DESFAZER_MS,
        action: { label: "Desfazer", onClick: onUndo },
      }),
    [show],
  );

  const value = useMemo<ToastContextValue>(
    () => ({ show, dismiss, success, error, warning, info, desfazer }),
    [show, dismiss, success, error, warning, info, desfazer],
  );

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
  const [executando, setExecutando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    // anima entrada
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  // Barra de progresso da janela de arrependimento: o usuário VÊ o tempo
  // restante em vez de adivinhar quanto ainda dá para desfazer.
  const [restante, setRestante] = useState(100);
  const temContagem = !!item.action && (item.duration ?? 0) > 0;
  useEffect(() => {
    if (!temContagem) return;
    const total = item.duration ?? DESFAZER_MS;
    const inicio = Date.now();
    const iv = setInterval(() => {
      const pct = Math.max(0, 100 - ((Date.now() - inicio) / total) * 100);
      setRestante(pct);
      if (pct <= 0) clearInterval(iv);
    }, 80);
    return () => clearInterval(iv);
  }, [temContagem, item.duration]);

  async function executarAcao() {
    if (!item.action || executando) return;
    setExecutando(true);
    setErro(null);
    try {
      await item.action.onClick();
      onDismiss();
    } catch (e: unknown) {
      setErro((e as Error)?.message ?? String(e));
      setExecutando(false);
    }
  }

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
          {erro && (
            <p className="text-xs text-red-600 mt-1 leading-relaxed break-words">
              Não foi possível desfazer: {erro}
            </p>
          )}
          {item.action && (
            <button
              type="button"
              onClick={executarAcao}
              disabled={executando}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-xs font-semibold text-stone-700 hover:bg-stone-50 hover:border-stone-400 transition cursor-pointer disabled:opacity-60 disabled:cursor-wait"
            >
              {executando
                ? <Loader2 size={12} className="animate-spin" />
                : <Undo2 size={12} />}
              {item.action.label}
            </button>
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

      {/* Contagem regressiva da janela de "Desfazer" */}
      {temContagem && (
        <span className="absolute bottom-0 left-0 h-0.5 bg-stone-300 transition-[width] duration-100 ease-linear"
          style={{ width: `${restante}%` }} />
      )}
    </div>
  );
}
