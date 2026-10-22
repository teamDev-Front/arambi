"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Minus, Search } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const anoDe = (m: string) => (/^\d{4}-\d{2}$/.test(m) ? m.slice(0, 4) : "");

/** "2026" quando a seleção é exatamente o ano inteiro (todos os meses dele na lista). */
function anoCompleto(sel: string[], lista: string[]): string | null {
  if (sel.length < 2) return null;
  const ano = anoDe(sel[0]);
  if (!ano || sel.some((m) => anoDe(m) !== ano)) return null;
  const doAno = lista.filter((m) => anoDe(m) === ano);
  return doAno.length === sel.length && doAno.every((m) => sel.includes(m)) ? ano : null;
}

interface CompetenciaMultiSelectProps {
  /** Competências disponíveis, em "AAAA-MM". */
  options: string[];
  /** Selecionadas. Lista VAZIA = todas (sem recorte). */
  value: string[];
  onChange: (value: string[]) => void;
  className?: string;
  /** Rótulo do botão quando nada está selecionado. */
  todasLabel?: string;
  disabled?: boolean;
  title?: string;
}

/**
 * Filtro de COMPETÊNCIA com seleção múltipla (ajuste 17-ago-2026).
 *
 * "sugiro implementar um checkbox para seleção múltipla em todos os filtros de
 *  Competência do sistema, como em Home, Financeiro, Distribuição de Lucro,
 *  Vendas Futuras e quaisquer outras telas".
 *
 * Duas decisões que o modelo enviado no documento deixa explícitas e que valem
 * registrar, porque mudam o comportamento em relação aos outros MultiSelect do
 * app:
 *
 *   • RASCUNHO + APLICAR. Marcar mês a mês NÃO refaz a consulta a cada clique —
 *     a seleção só vale quando ela clica em "Aplicar". Um filtro de competência
 *     costuma virar 6, 8 cliques seguidos; recarregar a tela em cada um deixaria
 *     a Lola esperando 8 vezes por um recorte que ela ainda está montando.
 *     "Cancelar" (e fechar clicando fora, e Esc) descarta o rascunho.
 *
 *   • VAZIO = TODAS. Não existe estado "nenhuma competência": desmarcar tudo é
 *     a forma de pedir a visão completa, que é como o seletor antigo de uma
 *     competência só funcionava com a opção "Todas".
 *
 * Ano inteiro (21-out-2026): os meses vêm agrupados por ano, e o cabeçalho de
 * cada ano marca/desmarca todos os meses dele de uma vez.
 */
export function CompetenciaMultiSelect({
  options,
  value,
  onChange,
  className,
  todasLabel = "Todas",
  disabled = false,
  title,
}: CompetenciaMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<string[]>(value);
  const ref = useRef<HTMLDivElement>(null);

  // Abrir sempre parte do que está aplicado hoje.
  function abrir() {
    if (disabled) return;
    setDraft(value);
    setQuery("");
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // A competência selecionada pode não estar na lista (ex.: veio de um link ou
  // de um mês sem lançamento) — nesse caso ela entra na lista mesmo assim.
  const lista = useMemo(() => {
    const extras = value.filter((v) => !options.includes(v));
    return [...extras, ...options];
  }, [options, value]);

  const q = query.trim().toLowerCase();
  const filtradas = q ? lista.filter((m) => m.toLowerCase().includes(q)) : lista;

  const draftSet = new Set(draft);
  const todasVisiveisMarcadas = filtradas.length > 0 && filtradas.every((m) => draftSet.has(m));

  function toggle(m: string) {
    setDraft((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  }

  /** "Selecionar todas" age sobre o que a BUSCA está mostrando — assim
   *  digitar "2027" e marcar seleciona o ano inteiro de uma vez. */
  function toggleTodas() {
    setDraft((prev) => {
      if (todasVisiveisMarcadas) return prev.filter((m) => !filtradas.includes(m));
      return Array.from(new Set([...prev, ...filtradas]));
    });
  }

  // Meses visíveis agrupados por ano, na ordem em que aparecem.
  const grupos: { ano: string; meses: string[] }[] = [];
  for (const m of filtradas) {
    const ano = anoDe(m);
    const g = grupos.find((x) => x.ano === ano);
    if (g) g.meses.push(m); else grupos.push({ ano, meses: [m] });
  }

  function toggleAno(meses: string[]) {
    setDraft((prev) =>
      meses.every((m) => prev.includes(m))
        ? prev.filter((m) => !meses.includes(m))
        : Array.from(new Set([...prev, ...meses])),
    );
  }

  function aplicar() {
    // Marcou tudo = sem recorte (mesma coisa, e mantém o rótulo "Todas").
    onChange(draft.length === lista.length ? [] : [...draft].sort());
    setOpen(false);
  }

  const anoAplicado = anoCompleto(value, lista);
  const anoRascunho = anoCompleto(draft, lista);
  const rotulo =
    value.length === 0
      ? todasLabel
      : anoAplicado
        ? `Ano ${anoAplicado}`
        : value.length === 1
          ? value[0]
          : `${value.length} selecionadas`;

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : abrir())}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={title}
        className={cn(
          "h-8 rounded-lg border border-stone-200 pl-2.5 pr-1.5 text-xs flex items-center gap-1.5 bg-white w-full min-w-32",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          value.length > 0 ? "text-stone-700 font-medium" : "text-stone-500",
        )}
      >
        <span className="truncate flex-1 text-left tabular-nums">{rotulo}</span>
        <ChevronDown size={12} className="text-stone-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-1 w-60 rounded-lg border border-stone-200 bg-white shadow-lg flex flex-col">
          <div className="p-2 border-b border-stone-100 relative">
            <Search size={12} className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar competência"
              className="w-full h-7 rounded-md border border-stone-200 pl-6 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-accent-400"
            />
          </div>

          <button
            type="button"
            onClick={toggleTodas}
            className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-stone-50 border-b border-stone-100"
            title={q ? `Marca/desmarca as ${filtradas.length} competências filtradas pela busca` : "Marca ou desmarca todas"}
          >
            <span
              className={cn(
                "w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                todasVisiveisMarcadas ? "bg-accent-500 border-accent-500 text-white" : "border-stone-300",
              )}
            >
              {todasVisiveisMarcadas && <Check size={11} />}
            </span>
            <span className="text-stone-700 font-medium">
              Selecionar todas{q && ` (${filtradas.length})`}
            </span>
          </button>

          <div className="overflow-y-auto max-h-56 py-1" role="listbox" aria-multiselectable>
            {filtradas.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-stone-400">Nenhuma competência</p>
            )}
            {grupos.map(({ ano, meses }) => {
              const marcados = meses.filter((m) => draftSet.has(m)).length;
              const anoTodo = marcados === meses.length;
              return (
                <div key={ano || "outras"}>
                  {ano && (
                    <button
                      type="button"
                      onClick={() => toggleAno(meses)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs bg-stone-50 hover:bg-stone-100"
                      title={`Marca ou desmarca todos os meses de ${ano}${q ? " mostrados pela busca" : ""}`}
                    >
                      <span
                        className={cn(
                          "w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                          marcados > 0 ? "bg-accent-500 border-accent-500 text-white" : "border-stone-300 bg-white",
                        )}
                      >
                        {anoTodo ? <Check size={11} /> : marcados > 0 && <Minus size={11} />}
                      </span>
                      <span className="font-semibold text-stone-700 tabular-nums">{ano}</span>
                      <span className="text-stone-400">ano inteiro</span>
                    </button>
                  )}
                  {meses.map((m) => {
                    const sel = draftSet.has(m);
                    return (
                      <button
                        key={m}
                        type="button"
                        role="option"
                        aria-selected={sel}
                        onClick={() => toggle(m)}
                        className={cn("w-full flex items-center gap-2 pr-3 py-1.5 text-left text-xs hover:bg-stone-50", ano ? "pl-6" : "pl-3")}
                      >
                        <span
                          className={cn(
                            "w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                            sel ? "bg-accent-500 border-accent-500 text-white" : "border-stone-300",
                          )}
                        >
                          {sel && <Check size={11} />}
                        </span>
                        <span className="text-stone-700 tabular-nums">{m}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div className="border-t border-stone-100 p-2 flex items-center justify-between gap-2">
            <span className="text-[10px] text-stone-400">
              {draft.length === 0 || draft.length === lista.length
                ? "Todas as competências"
                : anoRascunho
                  ? `Ano ${anoRascunho} inteiro`
                  : `${draft.length} selecionada${draft.length === 1 ? "" : "s"}`}
            </span>
            <span className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-7 px-3 rounded-lg border border-stone-200 text-xs text-stone-600 hover:bg-stone-50 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={aplicar}
                className="h-7 px-3 rounded-lg bg-accent-600 text-white text-xs font-medium hover:bg-accent-700 cursor-pointer"
              >
                Aplicar
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
