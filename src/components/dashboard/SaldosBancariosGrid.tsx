"use client";
import { Loader2, Wallet, TrendingUp } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import { formatCurrency } from "@/lib/utils/format";
import type { SaldoAtualBanco } from "@/lib/queries/dashboard";

interface Props {
  saldos: SaldoAtualBanco[];
  loading: boolean;
  onSelect: (b: SaldoAtualBanco) => void;
}

/**
 * Fileira de cards individuais — um por banco — em destaque no topo do dashboard.
 * Cada card mostra saldo conciliado grande + quebra discreta (a receber/a pagar/
 * provisionado/projetado) + tipo (corrente/investimento). Clicar abre o
 * BancoDetalheModal.
 */
export function SaldosBancariosGrid({ saldos, loading, onSelect }: Props) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wide flex items-center gap-1.5">
          <Wallet size={13} />
          <Tooltip text="Saldo conciliado de cada conta (saldo inicial + entradas − saídas realizadas). Clique num card para ver detalhes e os últimos lançamentos.">
            <span className="underline decoration-dotted decoration-stone-300">Saldos por Banco</span>
          </Tooltip>
        </h2>
        <span className="text-[10px] text-stone-400">
          {loading ? "carregando…" : `${saldos.length} conta${saldos.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {loading && saldos.length === 0 && (
        <div className="bg-white rounded-xl border border-stone-200 p-8 text-center">
          <Loader2 size={18} className="inline-block animate-spin text-stone-400" />
        </div>
      )}

      {!loading && saldos.length === 0 && (
        <div className="bg-white rounded-xl border border-stone-200 p-8 text-center text-sm text-stone-400">
          Nenhuma conta bancária cadastrada.
        </div>
      )}

      {saldos.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {saldos.map((b) => {
            const saldo = Number(b.saldo_atual);
            const aPagar = Math.abs(Number(b.a_pagar));
            const aReceber = Number(b.a_receber);
            const provis = Math.abs(Number(b.provisionado));
            const projetado = Number(b.saldo_projetado);
            const isInvest = b.banco_instituicao?.toLowerCase().includes("xp") ||
                             b.banco_apelido?.toLowerCase().includes("invest");
            const saldoColor =
              saldo > 0 ? "text-emerald-700" :
              saldo < 0 ? "text-red-600" : "text-stone-400";
            const ringColor = isInvest
              ? "hover:ring-accent-300"
              : "hover:ring-primary-300";
            const tipoBadgeColor = isInvest
              ? "bg-accent-50 text-accent-700"
              : "bg-primary-50 text-primary-700";

            return (
              <button
                key={b.conta_bancaria_id}
                onClick={() => onSelect(b)}
                className={`bg-white rounded-xl border border-stone-200 shadow-sm p-4 text-left transition hover:shadow-md hover:ring-2 ${ringColor} cursor-pointer flex flex-col gap-3`}
                title="Clique para ver detalhes e lançamentos"
              >
                {/* topo: nome + tipo */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-stone-800 truncate">
                      {b.banco_apelido ?? b.banco_nome}
                    </p>
                    <p className="text-[10px] text-stone-400 truncate">
                      {b.banco_instituicao}
                      {b.banco_agencia ? ` • ag. ${b.banco_agencia}` : ""}
                    </p>
                  </div>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${tipoBadgeColor}`}>
                    {isInvest ? <TrendingUp size={10} className="inline mr-0.5" /> : null}
                    {isInvest ? "investimento" : "corrente"}
                  </span>
                </div>

                {/* saldo grande */}
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-stone-400 mb-0.5">saldo atual</p>
                  <p className={`text-2xl font-bold tabular-nums ${saldoColor}`}>
                    {formatCurrency(saldo)}
                  </p>
                </div>

                {/* compromissos discretos (só se houver) */}
                {(aReceber > 0 || aPagar > 0 || provis > 0) && (
                  <div className="grid grid-cols-3 gap-1 text-[10px] text-stone-500 pt-2 border-t border-stone-100">
                    <div className="text-center">
                      {aReceber > 0 ? (
                        <>
                          <Tooltip text="Lançamentos com status 'A receber' — entradas previstas que ainda não caíram.">
                            <span className="text-stone-400 underline decoration-dotted">a receber</span>
                          </Tooltip>
                          <p className="text-emerald-600 font-medium tabular-nums">+{formatCurrency(aReceber)}</p>
                        </>
                      ) : <span className="text-stone-200">—</span>}
                    </div>
                    <div className="text-center">
                      {aPagar > 0 ? (
                        <>
                          <Tooltip text="Lançamentos com status 'A pagar' — saídas confirmadas ainda não pagas.">
                            <span className="text-stone-400 underline decoration-dotted">a pagar</span>
                          </Tooltip>
                          <p className="text-amber-600 font-medium tabular-nums">−{formatCurrency(aPagar)}</p>
                        </>
                      ) : <span className="text-stone-200">—</span>}
                    </div>
                    <div className="text-center">
                      {provis > 0 ? (
                        <>
                          <Tooltip text="Lançamentos provisionados — previsão sem confirmação. Não afeta o saldo atual.">
                            <span className="text-stone-400 underline decoration-dotted">provisionado</span>
                          </Tooltip>
                          <p className="text-red-500 font-medium tabular-nums">−{formatCurrency(provis)}</p>
                        </>
                      ) : <span className="text-stone-200">—</span>}
                    </div>
                  </div>
                )}

                {/* projetado quando difere do saldo */}
                {projetado !== saldo && (aPagar > 0 || provis > 0 || aReceber > 0) && (
                  <div className="flex items-center justify-between -mt-1 pt-2 border-t border-stone-50">
                    <Tooltip text="Saldo atual + a receber − a pagar − provisionado. Mostra como ficaria a conta se todos os compromissos em aberto se realizarem.">
                      <span className="text-[10px] text-stone-400 underline decoration-dotted">projetado</span>
                    </Tooltip>
                    <span className={`text-xs font-semibold tabular-nums ${projetado < 0 ? "text-red-600" : "text-stone-600"}`}>
                      {formatCurrency(projetado)}
                    </span>
                  </div>
                )}
              </button>
            );
          })}

          {/* card "total geral" */}
          {saldos.length > 1 && (
            <div className="bg-gradient-to-br from-primary-700 to-primary-800 rounded-xl p-4 text-white flex flex-col gap-2 justify-center">
              <p className="text-[10px] uppercase tracking-wide opacity-70">total geral</p>
              <p className="text-2xl font-bold tabular-nums">
                {formatCurrency(saldos.reduce((s, b) => s + Number(b.saldo_atual), 0))}
              </p>
              <p className="text-[10px] opacity-60">soma do saldo atual de todas as contas</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
