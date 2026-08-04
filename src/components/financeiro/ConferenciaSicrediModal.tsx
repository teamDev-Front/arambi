"use client";
// Conferência "o Sicredi tem que zerar" (pedido da Adri, 04-ago-2026).
//
// Nas palavras dela: "tudo que está saindo como despesa não deve somar lá nas
// despesas, porque a gente está fazendo resgate — então zera". Toda saída da
// conta corrente Sicredi tem um resgate equivalente entrando do Invest, e o
// líquido do mês tem de ser zero.
//
// A tela mostra mês a mês (saídas × resgates × diferença) e, quando não fecha,
// lista exatamente o que está causando: saída sem resgate ou resgate sem título.

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import {
  Loader2, CheckCircle2, AlertTriangle, Scale, CalendarDays,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { getStatusLabel } from "@/lib/utils/status-config";
import { obterConferenciaSicredi, type ConferenciaSicredi } from "@/lib/queries/resgates";

const NOME_MES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

interface Props {
  open: boolean;
  onClose: () => void;
  anos: string[];
  anoInicial: string;
  /** Abre a composição de um resgate a partir das listas de pendência. */
  onVerResgate: (id: string) => void;
}

export function ConferenciaSicrediModal({ open, onClose, anos, anoInicial, onVerResgate }: Props) {
  const [ano, setAno] = useState(anoInicial);
  const [dados, setDados] = useState<ConferenciaSicredi | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- segue a competência da tela ao abrir
    if (open) setAno(anoInicial);
  }, [open, anoInicial]);

  useEffect(() => {
    if (!open) return;
    let cancelado = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- estado de carregamento da conferência disparada ao abrir/trocar de ano
    setCarregando(true);
    setErro(null);
    obterConferenciaSicredi(ano)
      .then((d) => { if (!cancelado) setDados(d); })
      .catch((e: unknown) => { if (!cancelado) setErro((e as Error).message ?? String(e)); })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, [open, ano]);

  const diferencaTotal = dados ? dados.totalResgates - dados.totalSaidas : 0;
  const fechaTudo = dados ? Math.abs(diferencaTotal) < 0.005 : false;

  return (
    <Modal open={open} onClose={onClose} title="Conferência do Sicredi" size="xl">
      <div className="px-6 pt-4 flex items-center gap-3">
        <span className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center bg-emerald-50 text-emerald-600">
          <Scale size={17} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-stone-800">O Sicredi tem que zerar</p>
          <p className="text-xs text-stone-500 leading-relaxed">
            Toda saída da conta corrente tem um resgate equivalente entrando do Invest — o líquido do
            mês deve ser zero. Diferença aponta saída sem resgate ou resgate sobrando.
          </p>
        </div>
        <select
          value={ano}
          onChange={(e) => setAno(e.target.value)}
          className="ml-auto h-8 rounded-lg border border-stone-200 px-2 text-xs bg-white"
          aria-label="Ano da conferência"
        >
          {anos.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {carregando && (
        <div className="py-16 text-center text-stone-400">
          <Loader2 size={18} className="inline-block animate-spin mr-2" /> Conferindo…
        </div>
      )}

      {erro && (
        <div className="p-6">
          <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2.5 text-sm text-red-700">{erro}</div>
        </div>
      )}

      {dados && !carregando && !dados.contaEncontrada && (
        <div className="p-6 text-sm text-stone-500">
          Conta &quot;Cooperativa Sicredi (0913)&quot; não encontrada no cadastro de bancos.
        </div>
      )}

      {dados && !carregando && dados.contaEncontrada && (
        <div className="p-4 max-h-[62vh] overflow-auto space-y-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-stone-800 text-white">
                {["Mês", "Saídas (R$)", "Resgates (R$)", "Diferença (R$)", "Aplicações (R$)", "Pagas pelo saldo (R$)", "Situação"].map((h, i) => (
                  <th key={h} className={`px-3 py-2 font-semibold uppercase tracking-wide ${i === 0 || i === 6 ? "text-left" : "text-right"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dados.linhas.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-stone-400">
                  Nenhuma movimentação no Sicredi em {ano}.
                </td></tr>
              )}
              {dados.linhas.map((l) => {
                const fecha = Math.abs(l.diferenca) < 0.005;
                return (
                  <tr key={l.mes} className="border-b border-stone-50">
                    <td className="px-3 py-2 text-stone-700 font-medium whitespace-nowrap">
                      <CalendarDays size={11} className="inline-block mr-1.5 text-stone-400" />
                      {NOME_MES[Number(l.mes.slice(5)) - 1]}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-stone-700">{formatCurrency(l.saidas)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-stone-700">{formatCurrency(l.resgates)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${fecha ? "text-emerald-700" : "text-red-600"}`}>
                      {formatCurrency(l.diferenca)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-stone-400">
                      {l.aplicacoes > 0 ? formatCurrency(l.aplicacoes) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-stone-400">
                      {l.pagasPeloSaldo > 0 ? formatCurrency(l.pagasPeloSaldo) : "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {fecha ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <CheckCircle2 size={12} /> zerou
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                          <AlertTriangle size={12} />
                          {l.qtdSemResgate > 0
                            ? `${l.qtdSemResgate} saída${l.qtdSemResgate === 1 ? "" : "s"} sem resgate`
                            : l.diferenca > 0 ? "resgate a mais" : "falta resgate"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {dados.linhas.length > 0 && (
              <tfoot>
                <tr className="bg-stone-100 border-t-2 border-stone-200 font-semibold text-stone-700">
                  <td className="px-3 py-2 uppercase tracking-wide">Total {ano}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(dados.totalSaidas)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(dados.totalResgates)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${fechaTudo ? "text-emerald-700" : "text-red-600"}`}>
                    {formatCurrency(diferencaTotal)}
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>

          <p className="text-[11px] text-stone-400 leading-relaxed">
            <b>Aplicações</b> não entram na conta: é dinheiro saindo da corrente para o próprio Invest,
            não despesa — por isso não têm resgate.
            {dados.qtdHistoricoSemResgate > 0 && (
              <> Também estão fora {dados.qtdHistoricoSemResgate} saída
                {dados.qtdHistoricoSemResgate === 1 ? "" : "s"} importada
                {dados.qtdHistoricoSemResgate === 1 ? "" : "s"} da planilha, anteriores à automação dos
                resgates — essas você já conferiu pelo extrato bancário.</>
            )}
          </p>

          {/* Saídas sem resgate — o caso mais comum de "não zerou" */}
          {dados.semResgate.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-1.5">
                Saídas sem resgate vinculado ({dados.semResgate.length})
              </p>
              <p className="text-[11px] text-stone-500 mb-2 leading-relaxed">
                Despesas lançadas no sistema que não têm resgate cobrindo. Pode ser resgate feito à mão
                numa linha separada (aí o mês fecha, só não fica amarrado) ou lançamento criado com os
                resgates automáticos desligados.
              </p>
              <div className="rounded-lg border border-stone-200 overflow-hidden">
                <table className="w-full text-xs">
                  <tbody>
                    {dados.semResgate.slice(0, 40).map((t) => (
                      <tr key={t.id} className="border-b border-stone-50 last:border-0">
                        <td className="px-3 py-1.5 text-stone-500 whitespace-nowrap w-24">{formatDate(t.data)}</td>
                        <td className="px-3 py-1.5 text-stone-700 max-w-[320px] truncate" title={t.descricao ?? ""}>
                          {t.descricao ?? "—"}
                        </td>
                        <td className="px-3 py-1.5 text-stone-500 whitespace-nowrap">{getStatusLabel(t.status)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-red-600 font-medium whitespace-nowrap">
                          {formatCurrency(Number(t.valor))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {dados.semResgate.length > 40 && (
                <p className="text-[11px] text-stone-400 mt-1">
                  Mostrando as 40 primeiras de {dados.semResgate.length}.
                </p>
              )}
            </div>
          )}

          {/* Resgates órfãos — foi o que gerou a duplicidade de agosto */}
          {dados.semTitulo.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-1.5">
                Resgates sem nenhum título ({dados.semTitulo.length})
              </p>
              <p className="text-[11px] text-stone-500 mb-2 leading-relaxed">
                Resgates automáticos que ficaram sem despesa vinculada — normalmente sobra de
                lançamento excluído. Clique para ver a composição.
              </p>
              <div className="rounded-lg border border-stone-200 overflow-hidden">
                <table className="w-full text-xs">
                  <tbody>
                    {dados.semTitulo.map((g) => (
                      <tr key={g.id} className="border-b border-stone-50 last:border-0 hover:bg-stone-50">
                        <td className="px-3 py-1.5 text-stone-500 whitespace-nowrap w-24">{formatDate(g.data)}</td>
                        <td className="px-3 py-1.5 text-stone-700 max-w-[320px] truncate" title={g.descricao ?? ""}>
                          {g.descricao ?? "—"}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700 font-medium whitespace-nowrap">
                          {formatCurrency(Number(g.valor))}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <button
                            onClick={() => onVerResgate(g.id)}
                            className="text-accent-600 hover:text-accent-700 underline cursor-pointer"
                          >
                            ver
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {fechaTudo && dados.semResgate.length === 0 && dados.semTitulo.length === 0 && dados.linhas.length > 0 && (
            <div className="rounded-xl bg-emerald-50/60 border border-emerald-100 px-4 py-3 flex items-start gap-2.5 text-xs text-emerald-900">
              <CheckCircle2 size={15} className="shrink-0 mt-0.5 text-emerald-600" />
              <span>
                <b>Tudo conferido.</b> Em {ano}, cada saída do Sicredi tem o resgate equivalente
                entrando do Invest — a conta zera e não há lançamento solto.
              </span>
            </div>
          )}
        </div>
      )}

      <div className="px-6 py-4 border-t border-stone-100 flex items-center justify-end bg-stone-50/50">
        <Button variant="outline" onClick={onClose}>Fechar</Button>
      </div>
    </Modal>
  );
}
