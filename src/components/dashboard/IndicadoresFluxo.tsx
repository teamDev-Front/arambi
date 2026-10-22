"use client";
// Indicadores da Home no formato do painel "FLUXO DE CAIXA" da planilha VS4
// (reunião 20-out): Vendas, Despesas Aramburu, Distribuição de Lucro, Saldo
// Fluxo de Caixa e Saldo Despesas Variáveis. Os números vêm da
// v_fluxo_caixa_planilha (migration 0060), conferida linha a linha com a aba
// "Saldo Disponível".
//
// Fluxos (vendas, despesas, DL) somam os meses da competência escolhida; sem
// competência, todos os meses. Saldos (fluxo de caixa e despesa variável) são
// de um mês: o último da competência escolhida ou, sem competência, o mês atual.

import { useMemo } from "react";
import { ChartNoAxesColumnIncreasing, TrendingDown, Coins, Wallet, Box, HelpCircle } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils/cn";
import { formatCurrency } from "@/lib/utils/format";
import type { FluxoPlanilhaMes } from "@/lib/queries/dashboard";

const MES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (ym: string) => `${MES_CURTO[Number(ym.slice(5, 7)) - 1] ?? ym.slice(5, 7)}/${ym.slice(2, 4)}`;

interface Props {
  linhas: FluxoPlanilhaMes[];
  /** Competência escolhida na Home (vazia = todos os meses). */
  meses: string[];
  /** "YYYY-MM" de hoje. */
  mesAtual: string;
}

export function IndicadoresFluxo({ linhas, meses, mesAtual }: Props) {
  const ind = useMemo(() => {
    const sel = meses.length ? linhas.filter((l) => meses.includes(l.mes_referencia)) : linhas;
    const soma = (campo: keyof FluxoPlanilhaMes) => sel.reduce((s, l) => s + Number(l[campo] ?? 0), 0);

    // Mês de referência dos saldos: último da competência ou o mês atual
    // (sem dado do mês atual: o último mês até hoje; sem nada, o último da série).
    const ordenadas = [...linhas].sort((a, b) => a.mes_referencia.localeCompare(b.mes_referencia));
    const mesSaldo = meses.length
      ? [...meses].sort().at(-1)!
      : (ordenadas.findLast((l) => l.mes_referencia <= mesAtual) ?? ordenadas.at(-1))?.mes_referencia ?? mesAtual;
    const linhaSaldo = linhas.find((l) => l.mes_referencia === mesSaldo);

    const ano = mesSaldo.slice(0, 4);
    const dvAno = linhas
      .filter((l) => l.mes_referencia.startsWith(ano))
      .reduce((s, l) => s + Number(l.dv_saldo ?? 0), 0);

    const periodo = sel.length === 0
      ? "—"
      : meses.length === 1
        ? rotuloMes(meses[0])
        : `${rotuloMes(sel[0].mes_referencia)} a ${rotuloMes(sel[sel.length - 1].mes_referencia)}`;

    return {
      periodo,
      vendas: soma("vendas"),
      despesas: Math.abs(soma("despesas_aramburu")),
      dl: Math.abs(soma("distribuicao_lucro")),
      saldoFluxo: Number(linhaSaldo?.saldo_contas_fluxo ?? 0),
      mesSaldo,
      dv: meses.length ? soma("dv_saldo") : Number(linhaSaldo?.dv_saldo ?? 0),
      dvAno,
      ano,
    };
  }, [linhas, meses, mesAtual]);

  const cards: CardProps[] = [
    {
      titulo: "Vendas",
      valor: ind.vendas,
      detalhe: ind.periodo,
      ajuda: "Receita de Parceria Rural (conta 1.2) com status A receber ou Recebido — linha \"Vendas\" do Fluxo de Caixa da planilha.",
      icon: ChartNoAxesColumnIncreasing,
      cor: "text-emerald-700", fundo: "bg-emerald-50", iconeCor: "text-emerald-600",
    },
    {
      titulo: "Despesas Aramburu",
      valor: ind.despesas,
      detalhe: ind.periodo,
      ajuda: "Provisionado, A pagar, Pago e Provisionado DV — sem obra (2.7.2), sem DL e sem transferências entre contas (linha \"Despesas Aramburu\" da planilha).",
      icon: TrendingDown,
      cor: "text-red-600", fundo: "bg-red-50", iconeCor: "text-red-500",
    },
    {
      titulo: "Distribuição de Lucro",
      valor: ind.dl,
      detalhe: ind.periodo,
      ajuda: "Provisionado DL, A repassar e Repassado no período.",
      icon: Coins,
      cor: "text-amber-700", fundo: "bg-amber-50", iconeCor: "text-amber-600",
    },
    {
      titulo: "Saldo Fluxo de Caixa",
      valor: ind.saldoFluxo,
      detalhe: `fim de ${rotuloMes(ind.mesSaldo)} · projetado`,
      ajuda: "Cora + Sicredi + Sicredinvest + Sicredi Empresarial + Sicredi Aplicação Automática: saldo projetado no fim do mês (inclui o que está a pagar, a receber e provisionado). As contas que entram nessa soma são marcadas em Bancos.",
      icon: Wallet,
      cor: "text-blue-700", fundo: "bg-blue-50", iconeCor: "text-blue-600",
    },
    {
      titulo: "Saldo Despesas Variáveis",
      valor: ind.dv,
      detalhe: meses.length ? ind.periodo : `${rotuloMes(ind.mesSaldo)} · no ano ${ind.ano}: ${formatCurrency(ind.dvAno)}`,
      ajuda: "Limite mensal de Despesas Variáveis menos o utilizado (A pagar, Pago, Recebido, A receber) e o provisionado. Negativo = passou do limite.",
      icon: Box,
      cor: "text-violet-700", fundo: "bg-violet-50", iconeCor: "text-violet-600",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-4">
      {cards.map((c) => <CardIndicador key={c.titulo} {...c} />)}
    </div>
  );
}

interface CardProps {
  titulo: string;
  valor: number;
  detalhe: string;
  ajuda: string;
  icon: typeof Wallet;
  cor: string;
  fundo: string;
  iconeCor: string;
}

function CardIndicador({ titulo, valor, detalhe, ajuda, icon: Icon, cor, fundo, iconeCor }: CardProps) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl", fundo)}>
        <Icon size={24} className={iconeCor} />
      </span>
      <div className="min-w-0">
        <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-stone-600">
          {titulo}
          <Tooltip text={ajuda} position="bottom">
            <HelpCircle size={11} className="text-stone-300 hover:text-stone-500" />
          </Tooltip>
        </p>
        <p className={cn("text-xl font-bold tabular-nums leading-tight", valor < 0 ? "text-red-600" : cor)}>
          {formatCurrency(valor)}
        </p>
        <p className="truncate text-[11px] text-stone-400" title={detalhe}>{detalhe}</p>
      </div>
    </div>
  );
}
