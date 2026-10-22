"use client";
// Fluxo de Caixa — Saldo vs. Próximo Mês (redesenho da reunião 20-out).
// Mesmas linhas da aba "Saldo Disponível" da planilha VS4 (v_fluxo_caixa_planilha):
//   Entradas  = saldo inicial + vendas + resgates + outras entradas
//   Saídas    = despesas + DL + obra + aplicações + resgates do invest + transferências
//   Resultado = entradas − saídas
//   Saldo (−) contas do próximo mês = saldo final das contas do fluxo
//                                     + saídas, outras entradas e resgates do mês seguinte
// Ao abrir um mês: saldo inicial/final de cada conta (projetado, como a planilha).
// Realizado × provisionado (call de 20-out, migration 0061): indicadores do ano
// no topo e a divisão embaixo de Entradas/Saídas de cada mês. Sem a 0061 as
// colunas não vêm e essa parte simplesmente não aparece.

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ChartNoAxesColumnIncreasing, TrendingDown, Equal, Coins, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { BankLogo } from "@/components/ui/BankLogo";
import { LinkModulo } from "@/components/acessos/LinkModulo";
import { cn } from "@/lib/utils/cn";
import { formatCurrency } from "@/lib/utils/format";
import type { FluxoContaMes, FluxoPlanilhaMes } from "@/lib/queries/dashboard";

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const nomeMes = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1] ?? ym} / ${ym.slice(0, 4)}`;
const mesCurto = (ym: string) => `${(MESES[Number(ym.slice(5, 7)) - 1] ?? ym).slice(0, 3).toLowerCase()}/${ym.slice(2, 4)}`;
const n = (v: unknown) => Number(v ?? 0);

const AJUDA_REALIZADO = "Realizado: Recebido, Pago, Repassado, Aplicado e Resgatado (nas entradas, também o saldo inicial).";
const AJUDA_PROVISIONADO = "Provisionado: A receber, A pagar, Provisionado (inclusive DL e DV), A repassar, A aplicar, Aplicação, Resgate e A resgatar.";

interface Props {
  linhas: FluxoPlanilhaMes[];
  contas: FluxoContaMes[];
  loading: boolean;
  mesAtual: string;
}

export function FluxoCaixaTabela({ linhas, contas, loading, mesAtual }: Props) {
  const anos = useMemo(
    () => Array.from(new Set(linhas.map((l) => l.mes_referencia.slice(0, 4)))).sort(),
    [linhas],
  );
  const anoPadrao = anos.includes(mesAtual.slice(0, 4)) ? mesAtual.slice(0, 4) : anos.at(-1) ?? mesAtual.slice(0, 4);
  const [anoEscolhido, setAnoEscolhido] = useState<string | null>(null);
  const ano = anoEscolhido && anos.includes(anoEscolhido) ? anoEscolhido : anoPadrao;
  const [abertos, setAbertos] = useState<Set<string>>(() => new Set([mesAtual]));

  const doAno = useMemo(() => linhas.filter((l) => l.mes_referencia.startsWith(ano)), [linhas, ano]);
  const temSplit = doAno.some((l) => l.entradas_provisionadas != null);
  const totalAno = useMemo(() => {
    const soma = (k: keyof FluxoPlanilhaMes) => doAno.reduce((s, l) => s + n(l[k]), 0);
    return {
      entradas: soma("entradas"), saidas: soma("saidas"), resultado: soma("resultado"),
      entReal: soma("entradas_realizadas"), entProv: soma("entradas_provisionadas"),
      saiReal: soma("saidas_realizadas"), saiProv: soma("saidas_provisionadas"),
    };
  }, [doAno]);
  const ultimoDoAno = doAno.at(-1);

  const contasPorMes = useMemo(() => {
    const m = new Map<string, FluxoContaMes[]>();
    for (const c of contas) {
      // Conta inativa só aparece no mês em que ainda tinha saldo ou movimento.
      if (!c.ativa && n(c.saldo_inicial) === 0 && n(c.saldo_final) === 0 && n(c.movimento_mes) === 0) continue;
      const arr = m.get(c.mes_referencia) ?? [];
      arr.push(c);
      m.set(c.mes_referencia, arr);
    }
    return m;
  }, [contas]);

  const alternar = (mes: string) =>
    setAbertos((prev) => {
      const next = new Set(prev);
      if (next.has(mes)) next.delete(mes); else next.add(mes);
      return next;
    });

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-5 py-4">
        <h3 className="text-base font-bold text-[#1a2e28]">Fluxo de Caixa — Saldo vs. Próximo Mês</h3>
        <div className="flex items-center gap-3">
          {loading && <Loader2 size={14} className="animate-spin text-stone-400" />}
          <LinkModulo href="/dashboard/saldos" semAcesso="ocultar" className="text-xs text-accent-600 hover:underline">
            Saldos mensais
          </LinkModulo>
          {anos.length > 0 && (
            <label className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-600">
              Ano:
              <select
                value={ano}
                onChange={(e) => setAnoEscolhido(e.target.value)}
                className="bg-transparent font-semibold text-stone-800 focus:outline-none"
              >
                {anos.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>

      {temSplit && ultimoDoAno && (
        <div className="grid grid-cols-2 gap-3 border-b border-stone-100 bg-stone-50/50 px-5 py-3 sm:grid-cols-3 xl:grid-cols-5">
          <Indicador rotulo={`Entradas realizadas · ${ano}`} valor={totalAno.entReal} cor="text-emerald-700" ajuda={AJUDA_REALIZADO} />
          <Indicador rotulo={`Entradas provisionadas · ${ano}`} valor={totalAno.entProv} cor="text-emerald-600" ajuda={AJUDA_PROVISIONADO} />
          <Indicador rotulo={`Saídas realizadas · ${ano}`} valor={totalAno.saiReal} cor="text-red-600" ajuda={AJUDA_REALIZADO} />
          <Indicador rotulo={`Saídas provisionadas · ${ano}`} valor={totalAno.saiProv} cor="text-red-500" ajuda={AJUDA_PROVISIONADO} />
          <Indicador
            rotulo={`Saldo projetado · fim de ${mesCurto(ultimoDoAno.mes_referencia)}`}
            valor={n(ultimoDoAno.saldo_contas_fluxo)}
            cor="text-blue-700"
            ajuda="Saldo das contas do fluxo de caixa no fim do último mês do ano, contando tudo o que está provisionado (a receber, a pagar e provisionado)."
          />
        </div>
      )}

      {doAno.length === 0 && !loading ? (
        <p className="py-10 text-center text-xs text-stone-400">Sem dados de fluxo de caixa.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="border-b border-stone-100 bg-stone-50/70">
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">Mês</th>
                <Cabecalho icon={ChartNoAxesColumnIncreasing} fundo="bg-emerald-50" cor="text-emerald-600"
                  titulo="Entradas" sub="Saldo inicial + vendas + resgates + outras entradas" />
                <Cabecalho icon={TrendingDown} fundo="bg-red-50" cor="text-red-500"
                  titulo="Saídas" sub="Despesas + DL + aplicações + transf. entre contas + outros" />
                <Cabecalho icon={Equal} fundo="bg-blue-50" cor="text-blue-600"
                  titulo="Resultado líquido do mês" sub="Entradas menos saídas" />
                <Cabecalho icon={Coins} fundo="bg-amber-50" cor="text-amber-600"
                  titulo="Saldo (−) contas do próximo mês" sub="Saldos bancários final do mês + entradas garantidas − saídas do próximo mês" />
              </tr>
            </thead>
            <tbody>
              {doAno.map((l) => {
                const atual = l.mes_referencia === mesAtual;
                const aberto = abertos.has(l.mes_referencia);
                const bancos = contasPorMes.get(l.mes_referencia) ?? [];
                const resultado = n(l.resultado);
                const saldoProx = n(l.saldo_menos_proximo_mes);
                return (
                  <Fragment key={l.mes_referencia}>
                    <tr className={cn("border-b border-stone-100 transition-colors hover:bg-stone-50/70", atual && "bg-accent-50/50")}>
                      <td className="whitespace-nowrap px-5 py-2.5">
                        <button
                          type="button"
                          onClick={() => alternar(l.mes_referencia)}
                          className="inline-flex items-center gap-2 font-medium text-stone-700 hover:text-stone-900"
                          aria-expanded={aberto}
                          title={aberto ? "Ocultar saldos bancários" : "Ver saldos bancários do mês"}
                        >
                          {aberto ? <ChevronDown size={14} className="text-stone-400" /> : <ChevronRight size={14} className="text-stone-400" />}
                          {nomeMes(l.mes_referencia)}
                          {atual && (
                            <span className="rounded-md bg-accent-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-700">
                              Atual
                            </span>
                          )}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums font-semibold text-emerald-700"
                        title={[
                          `Saldo inicial: ${formatCurrency(n(l.saldo_inicial))}`,
                          `Vendas: ${formatCurrency(n(l.vendas))}`,
                          `Resgates: ${formatCurrency(n(l.resgates_entrada))}`,
                          `Outras entradas: ${formatCurrency(n(l.outras_entradas))}`,
                        ].join("\n")}
                      >
                        {formatCurrency(n(l.entradas))}
                        {temSplit && <Divisao realizado={n(l.entradas_realizadas)} provisionado={n(l.entradas_provisionadas)} />}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums font-semibold text-red-600"
                        title={[
                          `Despesas Aramburu: ${formatCurrency(n(l.despesas_aramburu))}`,
                          `Distribuição de lucro: ${formatCurrency(n(l.distribuicao_lucro))}`,
                          `Obra: ${formatCurrency(n(l.despesas_obra))}`,
                          `Aplicações: ${formatCurrency(n(l.aplicacoes))}`,
                          `Resgates (invest): ${formatCurrency(n(l.resgates_saida))}`,
                          `Transferências entre contas: ${formatCurrency(n(l.transferencias))}`,
                        ].join("\n")}
                      >
                        {formatCurrency(n(l.saidas))}
                        {temSplit && <Divisao realizado={n(l.saidas_realizadas)} provisionado={n(l.saidas_provisionadas)} />}
                      </td>
                      <td className={cn("whitespace-nowrap px-4 py-2.5 tabular-nums font-semibold", resultado < 0 ? "text-red-600" : "text-emerald-700")}>
                        {formatCurrency(resultado)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right">
                        <span className={cn(
                          "inline-flex rounded-full px-3 py-1 text-sm font-semibold tabular-nums",
                          saldoProx < 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700",
                        )}>
                          {formatCurrency(saldoProx)}
                        </span>
                      </td>
                    </tr>
                    {aberto && (
                      <tr className="border-b border-stone-100 bg-stone-50/60">
                        <td colSpan={5} className="px-5 py-3">
                          <p className="mb-2 text-xs font-semibold text-stone-500">Saldos bancários</p>
                          {bancos.length === 0 ? (
                            <p className="text-xs text-stone-400">Sem contas para este mês.</p>
                          ) : (
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
                              {bancos.map((b) => (
                                <div key={b.conta_bancaria_id} className="rounded-xl border border-stone-200 bg-white p-3">
                                  <div className="mb-2 flex items-center gap-2">
                                    <BankLogo banco={b.banco_instituicao} apelido={b.banco_apelido} size={28} />
                                    <span className="text-xs font-semibold uppercase leading-tight text-stone-700">
                                      {b.banco_apelido ?? b.banco_nome}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-stone-400">Saldo inicial</p>
                                  <p className="text-sm font-semibold tabular-nums text-stone-700">{formatCurrency(n(b.saldo_inicial))}</p>
                                  <p className="mt-1 text-[11px] text-stone-400">Saldo final</p>
                                  <p className={cn("text-sm font-bold tabular-nums", n(b.saldo_final) < 0 ? "text-red-600" : "text-emerald-700")}>
                                    {formatCurrency(n(b.saldo_final))}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            {doAno.length > 1 && (
              <tfoot>
                <tr className="border-t-2 border-stone-200 bg-stone-50/70 font-semibold">
                  <td className="whitespace-nowrap px-5 py-2.5 text-xs uppercase tracking-wide text-stone-500">Total {ano}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-emerald-700">
                    {formatCurrency(totalAno.entradas)}
                    {temSplit && <Divisao realizado={totalAno.entReal} provisionado={totalAno.entProv} />}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-red-600">
                    {formatCurrency(totalAno.saidas)}
                    {temSplit && <Divisao realizado={totalAno.saiReal} provisionado={totalAno.saiProv} />}
                  </td>
                  <td className={cn("whitespace-nowrap px-4 py-2.5 tabular-nums", totalAno.resultado < 0 ? "text-red-600" : "text-emerald-700")}>
                    {formatCurrency(totalAno.resultado)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      <p className="border-t border-stone-100 px-5 py-3 text-[11px] leading-relaxed text-stone-400">
        Mesmo cálculo da aba <strong className="text-stone-500">Saldo Disponível</strong> da planilha. Saldos bancários
        <strong className="text-stone-500"> projetados</strong> (incluem o que está a pagar, a receber e provisionado).
        <strong className="text-stone-500"> Saldo (−) contas do próximo mês</strong> soma só as contas do fluxo de caixa
        (Cora, Sicredi, Sicredinvest, Sicredi Empresarial e Aplicação Automática) e não conta vendas do mês seguinte.
        {temSplit && (
          <> <strong className="text-stone-500">Real.</strong> = já recebido/pago; <strong className="text-stone-500">prov.</strong> = a receber, a pagar e provisionado.</>
        )}
        {" "}Passe o mouse em Entradas/Saídas para ver a composição.
      </p>
    </Card>
  );
}

function Indicador({ rotulo, valor, cor, ajuda }: { rotulo: string; valor: number; cor: string; ajuda: string }) {
  return (
    <div className="min-w-0" title={ajuda}>
      <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-stone-500">{rotulo}</p>
      <p className={cn("text-sm font-bold tabular-nums", valor < 0 && cor.includes("blue") ? "text-red-600" : cor)}>
        {formatCurrency(valor)}
      </p>
    </div>
  );
}

/** Linha miúda "real. X · prov. Y" embaixo de Entradas/Saídas. */
function Divisao({ realizado, provisionado }: { realizado: number; provisionado: number }) {
  return (
    <span className="block text-[10px] font-normal text-stone-400">
      real. {formatCurrency(realizado)}
      {provisionado !== 0 && <> · prov. {formatCurrency(provisionado)}</>}
    </span>
  );
}

function Cabecalho({ icon: Icon, fundo, cor, titulo, sub }: {
  icon: typeof Coins;
  fundo: string;
  cor: string;
  titulo: string;
  sub: string;
}) {
  return (
    <th className="px-4 py-3 text-left align-top">
      <div className="flex items-start gap-2.5">
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", fundo)}>
          <Icon size={18} className={cor} />
        </span>
        <span>
          <span className="block text-xs font-bold uppercase tracking-wide text-stone-700">{titulo}</span>
          <span className="block max-w-[230px] text-[11px] font-normal leading-snug text-stone-400">{sub}</span>
        </span>
      </div>
    </th>
  );
}
