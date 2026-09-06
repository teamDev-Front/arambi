"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface SelectAllHeaderProps {
  /** A página inteira está selecionada (estado do checkbox). */
  paginaSelecionada: boolean;
  /** Clique no checkbox: seleciona/desmarca só a página (comportamento antigo). */
  onTogglePagina: () => void;
  /** Quantos registros há nesta página. */
  qtdPagina: number;
  /** Quantos registros o filtro devolve no total (todas as páginas). */
  qtdFiltro: number;
  /** Quantos estão selecionados agora. */
  qtdSelecionados: number;
  /** Seleciona TODOS os registros do filtro, de todas as páginas. */
  onSelecionarFiltro: () => void | Promise<void>;
  onLimpar: () => void;
  /** Mostra spinner enquanto a seleção do filtro carrega (Financeiro busca no banco). */
  carregando?: boolean;
  disabled?: boolean;
}

/**
 * Cabeçalho da coluna de seleção com as DUAS opções pedidas em 04-set-2026:
 *
 *   • o checkbox continua sendo "Selecionar todos desta página" (a "1ª
 *     caixinha principal" que a Adri pediu para manter);
 *   • a setinha ao lado abre um menu com "Selecionar todos os N registros do
 *     filtro" — de uma vez, sem passar página por página.
 *
 * O menu é renderizado num portal (posição fixa): a tabela vive dentro de um
 * `overflow-x-auto`, que cortaria qualquer popover absoluto no cabeçalho.
 */
export function SelectAllHeader({
  paginaSelecionada,
  onTogglePagina,
  qtdPagina,
  qtdFiltro,
  qtdSelecionados,
  onSelecionarFiltro,
  onLimpar,
  carregando = false,
  disabled = false,
}: SelectAllHeaderProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    function onScroll() { setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const filtroInteiroSelecionado = qtdFiltro > 0 && qtdSelecionados >= qtdFiltro;
  const fmt = (n: number) => n.toLocaleString("pt-BR");

  const item = (
    label: string,
    hint: string | null,
    onClick: () => void,
    opts: { ativo?: boolean; danger?: boolean; disabled?: boolean } = {},
  ) => (
    <button
      type="button"
      role="menuitem"
      disabled={opts.disabled}
      onClick={() => { setOpen(false); onClick(); }}
      className={cn(
        "w-full flex items-start gap-2 px-3 py-2 text-left text-xs hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer",
        opts.danger ? "text-red-600" : "text-stone-700",
      )}
    >
      <span className="w-4 h-4 mt-px shrink-0 flex items-center justify-center text-accent-600">
        {opts.ativo && <Check size={12} />}
      </span>
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-[10px] text-stone-400 leading-tight">{hint}</span>}
      </span>
    </button>
  );

  return (
    <span className="inline-flex items-center gap-0.5">
      <input
        type="checkbox"
        aria-label="Selecionar todos desta página"
        title={paginaSelecionada
          ? "Desmarcar todos desta página"
          : "Selecionar todos desta página (a setinha ao lado seleciona todos os registros do filtro)"}
        checked={paginaSelecionada}
        disabled={disabled || qtdPagina === 0}
        onChange={onTogglePagina}
        className="h-3.5 w-3.5 rounded border-stone-300 accent-accent-500 cursor-pointer disabled:cursor-not-allowed"
      />
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Opções de seleção"
        title="Opções de seleção: só esta página ou todos os registros do filtro"
        disabled={disabled || (qtdFiltro === 0 && qtdSelecionados === 0)}
        onClick={() => setOpen((o) => !o)}
        className="p-0.5 rounded text-stone-400 hover:text-stone-700 hover:bg-stone-100 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {carregando ? <Loader2 size={12} className="animate-spin" /> : <ChevronDown size={12} />}
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{ top: pos.top, left: pos.left }}
          className="fixed z-50 w-72 rounded-lg border border-stone-200 bg-white shadow-lg py-1 text-left"
        >
          {item(
            `Selecionar todos desta página (${fmt(qtdPagina)})`,
            "Só os registros que estão na tela agora.",
            onTogglePagina,
            { ativo: paginaSelecionada && !filtroInteiroSelecionado, disabled: qtdPagina === 0 },
          )}
          {item(
            `Selecionar todos os registros do filtro (${fmt(qtdFiltro)})`,
            qtdFiltro > qtdPagina
              ? "De uma vez, em todas as páginas — sem passar página por página."
              : "O filtro cabe inteiro nesta página.",
            () => { void onSelecionarFiltro(); },
            { ativo: filtroInteiroSelecionado, disabled: qtdFiltro === 0 },
          )}
          <div className="my-1 border-t border-stone-100" />
          {item(
            qtdSelecionados > 0 ? `Limpar seleção (${fmt(qtdSelecionados)})` : "Limpar seleção",
            null,
            onLimpar,
            { danger: true, disabled: qtdSelecionados === 0 },
          )}
        </div>,
        document.body,
      )}
    </span>
  );
}
