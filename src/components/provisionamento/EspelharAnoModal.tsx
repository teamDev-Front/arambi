"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useModulo } from "@/components/acessos/PermissoesProvider";
import { CopyPlus, Loader2, AlertTriangle, Check, CalendarDays } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { useStatusConfig, getStatusLabel } from "@/lib/utils/status-config";
import { TIPO_DESPESA_LABEL, type TipoDespesa, type StatusAramburu } from "@/types";
import {
  montarPreviaEspelhamento, executarEspelhamento, gerarLinhasSaldoDvDoAno,
  type EspelhamentoPrevia,
} from "@/lib/queries/espelhamento";

/**
 * Tipos que a Adriane pediu para espelhar, e por quê (documento de 17-ago):
 *
 *   fixa      — "Despesas fixas"     → marcada por padrão
 *   periodica — "Despesas periódicas"→ marcada por padrão
 *   variavel  — "seriam apenas algumas que precisariam ser espelhadas, mas a
 *                maioria não, pois serão lançadas conforme a necessidade,
 *                debitando do limite mensal de 20k" → desmarcada
 *   eventual  — por definição não se repete → desmarcada
 *
 * As VENDAS ficam de fora inteiramente ("também não precisam ser copiadas, pois
 * serão lançadas conforme forem realizadas") — nem aparecem como opção.
 */
const TIPOS_DISPONIVEIS: { tipo: TipoDespesa; padrao: boolean; nota: string }[] = [
  { tipo: "fixa", padrao: true, nota: "Repetem todo mês — o caso principal da virada" },
  { tipo: "periodica", padrao: true, nota: "Repetem em intervalo fixo (trimestral, anual…)" },
  { tipo: "variavel", padrao: false, nota: "Em geral não se espelham: saem do limite mensal" },
  { tipo: "eventual", padrao: false, nota: "Por definição não se repetem" },
];

const NOME_MES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

interface Props {
  open: boolean;
  onClose: () => void;
  /** Ano exibido na tela — vira a origem sugerida. */
  anoOrigem: string;
  anos: string[];
  onConcluido: () => void;
}

/**
 * "Espelhar ano" (17-ago-2026).
 *
 *   "Criar uma forma automatizada de espelhamento dos lançamentos anuais,
 *    principalmente na virada do ano, para gerar o provisionado do ano seguinte
 *    sem precisar copiar, lançar e editar item por item."
 *
 * Três coisas que a tela faz questão de deixar claras antes de gravar:
 *   1. QUANTOS e QUANTO vão nascer, mês a mês — a virada do ano é a pior hora
 *      para descobrir depois que veio coisa demais;
 *   2. o que JÁ foi espelhado numa rodada anterior não duplica (cada cópia
 *      carrega a etiqueta da origem), então rodar de novo é seguro;
 *   3. as cópias nascem PROVISIONADAS: são programação, não conta a pagar.
 */
export function EspelharAnoModal({ open, onClose, anoOrigem, anos, onConcluido }: Props) {
  const toast = useToast();
  // Modo leitura: a prévia é consulta, mas gravar o espelhamento não.
  const { podeEditar } = useModulo("provisionamento");
  const { entries: statusEntries } = useStatusConfig();

  const [origem, setOrigem] = useState(anoOrigem);
  const [destino, setDestino] = useState(String(Number(anoOrigem) + 1));
  const [tipos, setTipos] = useState<TipoDespesa[]>(
    TIPOS_DISPONIVEIS.filter((t) => t.padrao).map((t) => t.tipo),
  );
  const [status, setStatus] = useState<StatusAramburu>("provisionado");
  const [gerarDv, setGerarDv] = useState(true);

  const [previa, setPrevia] = useState<EspelhamentoPrevia | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Ao (re)abrir, volta a sugerir a virada a partir do ano exibido na tela.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset intencional na abertura
    setOrigem(anoOrigem);
    setDestino(String(Number(anoOrigem) + 1));
  }, [open, anoOrigem]);

  const carregarPrevia = useCallback(async () => {
    if (!open) return;
    setCarregando(true);
    setErro(null);
    try {
      setPrevia(await montarPreviaEspelhamento({ anoOrigem: origem, anoDestino: destino, tipos, status }));
    } catch (e: unknown) {
      setErro((e as Error).message ?? String(e));
      setPrevia(null);
    } finally {
      setCarregando(false);
    }
  }, [open, origem, destino, tipos, status]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { carregarPrevia(); }, [carregarPrevia]);

  const statusOpcoes = useMemo(
    () => statusEntries.filter((e) => e.ativo && (e.kind === "saida" || e.kind === "neutro")),
    [statusEntries],
  );

  const mesmoAno = origem === destino;
  const podeGravar = !!previa && previa.novas > 0 && !mesmoAno && !carregando && !gravando;

  function alternarTipo(t: TipoDespesa) {
    setTipos((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  async function gravar() {
    if (!podeEditar) return;
    if (!previa) return;
    const resumo =
      `Criar ${previa.novas} lançamento${previa.novas === 1 ? "" : "s"} ` +
      `${getStatusLabel(status)} em ${destino}, no total de ${formatCurrency(previa.totalNovas)}?` +
      `\n\nEles nascem como cópia dos de ${origem}, com a mesma data no ano seguinte. ` +
      `Você pode revisar e ajustar cada um depois no Financeiro.`;
    if (!confirm(resumo)) return;

    setGravando(true);
    try {
      const r = await executarEspelhamento({ anoOrigem: origem, anoDestino: destino, tipos, status }, previa);
      if (gerarDv) {
        try {
          await gerarLinhasSaldoDvDoAno(destino);
        } catch (e: unknown) {
          toast.warning(
            "Lançamentos criados, mas as linhas de saldo DV não",
            (e as Error).message ?? String(e),
          );
        }
      }
      toast.success(
        `${destino} provisionado`,
        `${r.criados} lançamento${r.criados === 1 ? "" : "s"} criado${r.criados === 1 ? "" : "s"}` +
        (gerarDv ? ", mais as 12 linhas de saldo de Despesa Variável" : "") +
        ". Revise no Financeiro filtrando pela competência.",
      );
      onConcluido();
      onClose();
    } catch (e: unknown) {
      toast.error("Espelhamento interrompido", (e as Error).message ?? String(e));
      await carregarPrevia();
    } finally {
      setGravando(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Espelhar lançamentos para o ano seguinte" size="lg">
      <div className="p-5 space-y-5">
        <p className="text-xs text-stone-500 leading-relaxed">
          Copia os lançamentos de um ano para o outro na <b>mesma data</b>, para você não precisar
          lançar item por item na virada. As cópias nascem <b>provisionadas</b> (programação, não
          conta a pagar) e podem ser ajustadas depois, uma a uma, no Financeiro.
        </p>

        {/* Anos */}
        <div className="flex items-end gap-3 flex-wrap">
          <label className="text-xs text-stone-500 flex flex-col gap-1">
            Copiar de
            <select value={origem} onChange={(e) => setOrigem(e.target.value)}
              className="h-9 rounded-lg border border-stone-200 px-2 text-sm bg-white">
              {(anos.includes(origem) ? anos : [origem, ...anos]).map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <span className="text-stone-300 pb-2">→</span>
          <label className="text-xs text-stone-500 flex flex-col gap-1">
            Para
            <input type="number" min={2000} max={2100} value={destino}
              onChange={(e) => setDestino(e.target.value)}
              className="h-9 w-24 rounded-lg border border-stone-200 px-2 text-sm tabular-nums" />
          </label>
          <label className="text-xs text-stone-500 flex flex-col gap-1 ml-auto">
            Status das cópias
            <select value={status} onChange={(e) => setStatus(e.target.value as StatusAramburu)}
              className="h-9 rounded-lg border border-stone-200 px-2 text-sm bg-white">
              {statusOpcoes.map((e) => <option key={e.codigo} value={e.codigo}>{e.label}</option>)}
            </select>
          </label>
        </div>

        {mesmoAno && (
          <p className="text-xs text-red-600 flex items-center gap-1.5">
            <AlertTriangle size={13} /> Origem e destino são o mesmo ano — escolha um destino diferente.
          </p>
        )}

        {/* Tipos de despesa */}
        <div>
          <p className="text-xs font-semibold text-stone-700 mb-2">O que espelhar</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {TIPOS_DISPONIVEIS.map(({ tipo, nota }) => {
              const sel = tipos.includes(tipo);
              return (
                <button
                  key={tipo}
                  type="button"
                  onClick={() => alternarTipo(tipo)}
                  className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition ${
                    sel ? "border-accent-300 bg-accent-50/60" : "border-stone-200 hover:bg-stone-50"
                  }`}
                >
                  <span className={`w-4 h-4 mt-0.5 rounded border flex items-center justify-center shrink-0 ${
                    sel ? "bg-accent-500 border-accent-500 text-white" : "border-stone-300"
                  }`}>
                    {sel && <Check size={11} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-stone-800">{TIPO_DESPESA_LABEL[tipo]}</span>
                    <span className="block text-[11px] text-stone-500 leading-snug">{nota}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-stone-400 leading-relaxed">
            Ficam sempre de fora: vendas (lançadas conforme acontecem), a Distribuição de Lucro global e os
            resgates do Invest — o sistema recria esses três sozinho a partir do que existir no ano novo.
          </p>
        </div>

        {/* Linhas de saldo de Despesa Variável */}
        <button
          type="button"
          onClick={() => setGerarDv((v) => !v)}
          className={`w-full flex items-start gap-2 rounded-lg border px-3 py-2.5 text-left transition ${
            gerarDv ? "border-accent-300 bg-accent-50/60" : "border-stone-200 hover:bg-stone-50"
          }`}
        >
          <span className={`w-4 h-4 mt-0.5 rounded border flex items-center justify-center shrink-0 ${
            gerarDv ? "bg-accent-500 border-accent-500 text-white" : "border-stone-300"
          }`}>
            {gerarDv && <Check size={11} />}
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-medium text-stone-800">
              Lançar o limite mensal de Despesa Variável nos 12 meses de {destino}
            </span>
            <span className="block text-[11px] text-stone-500 leading-snug">
              Cria a linha <b>Provisionado DV</b> de cada mês e passa a mantê-la igual ao <b>saldo</b> do
              limite. Respondendo à sua pergunta: a partir daí, sim — cada Despesa Variável lançada
              <b> debita automaticamente</b> desse valor, e um lançamento positivo credita de volta.
            </span>
          </span>
        </button>

        {/* Prévia */}
        <div className="rounded-xl border border-stone-200 overflow-hidden">
          <div className="bg-stone-50 px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
            <span className="text-xs font-semibold text-stone-700 flex items-center gap-1.5">
              <CalendarDays size={13} className="text-stone-400" />
              Prévia — o que será criado em {destino}
            </span>
            {carregando && <Loader2 size={14} className="animate-spin text-stone-400" />}
          </div>

          {erro && (
            <p className="px-4 py-4 text-xs text-red-600 flex items-start gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {erro}
            </p>
          )}

          {!erro && previa && !carregando && (
            <div className="px-4 py-3 space-y-3">
              <div className="flex flex-wrap gap-x-8 gap-y-2">
                <span className="leading-tight">
                  <span className="block text-[10px] uppercase tracking-wide text-stone-400 font-semibold">
                    Lançamentos novos
                  </span>
                  <b className="text-lg tabular-nums text-stone-800">{previa.novas}</b>
                </span>
                <span className="leading-tight">
                  <span className="block text-[10px] uppercase tracking-wide text-stone-400 font-semibold">
                    Total no ano
                  </span>
                  <b className="text-lg tabular-nums text-red-600">{formatCurrency(previa.totalNovas)}</b>
                </span>
                {previa.jaEspelhadas > 0 && (
                  <span className="leading-tight">
                    <span className="block text-[10px] uppercase tracking-wide text-stone-400 font-semibold">
                      Já espelhados antes
                    </span>
                    <b className="text-lg tabular-nums text-stone-400">{previa.jaEspelhadas}</b>
                    <span className="text-[11px] text-stone-400"> (não duplicam)</span>
                  </span>
                )}
              </div>

              {previa.novas === 0 ? (
                <p className="text-xs text-stone-500 py-2">
                  {previa.linhas.length === 0
                    ? `Nenhum lançamento de ${origem} nos tipos marcados. Confira o ano de origem e as marcações acima.`
                    : `Tudo o que havia para espelhar de ${origem} já foi criado em ${destino} numa rodada anterior.`}
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-stone-400 border-b border-stone-100">
                      <th className="py-1.5 text-left font-semibold uppercase tracking-wide">Mês</th>
                      <th className="py-1.5 text-right font-semibold uppercase tracking-wide">Lançamentos</th>
                      <th className="py-1.5 text-right font-semibold uppercase tracking-wide">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previa.porMes.map((m) => (
                      <tr key={m.mes} className="border-b border-stone-50 last:border-0">
                        <td className="py-1.5 text-stone-700">{NOME_MES[Number(m.mes.slice(5)) - 1]}</td>
                        <td className="py-1.5 text-right tabular-nums text-stone-600">{m.qtd}</td>
                        <td className="py-1.5 text-right tabular-nums text-red-600">{formatCurrency(m.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {previa.novas > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-stone-500 hover:text-stone-700 select-none">
                    Ver os {previa.novas} lançamentos que serão criados
                  </summary>
                  <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-stone-100">
                    <table className="w-full text-[11px]">
                      <tbody>
                        {previa.linhas.filter((l) => !l.jaExiste).map((l) => (
                          <tr key={l.origem.id} className="border-b border-stone-50 last:border-0">
                            <td className="px-2 py-1 text-stone-500 whitespace-nowrap tabular-nums">
                              {formatDate(l.dataDestino)}
                            </td>
                            <td className="px-2 py-1 text-stone-700 max-w-[240px] truncate" title={l.origem.descricao ?? ""}>
                              {l.origem.descricao || "—"}
                            </td>
                            <td className="px-2 py-1 text-stone-400 max-w-[130px] truncate">
                              {l.origem.fornecedor_nome || ""}
                            </td>
                            <td className="px-2 py-1 text-right text-red-600 tabular-nums whitespace-nowrap">
                              {formatCurrency(Number(l.origem.valor))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={gravando}>Cancelar</Button>
          {podeEditar && (
            <Button onClick={gravar} loading={gravando} disabled={!podeGravar}>
              <CopyPlus size={14} />
              {previa && previa.novas > 0 ? `Espelhar ${previa.novas} para ${destino}` : "Espelhar"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
