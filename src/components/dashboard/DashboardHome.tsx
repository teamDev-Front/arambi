"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { KpiCard } from "@/components/ui/KpiCard";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  TrendingUp, TrendingDown, Package, FileText, Bot,
  DollarSign, ArrowUpRight, Download, LayoutDashboard, Loader2,
  ChevronDown, ChevronRight, Landmark,
} from "lucide-react";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils/format";
import {
  getKpiMensal, getPorContaContabil, getSaldoAtualPorBanco, getFluxoCaixaMensal, getFluxoCaixaBancos,
  type KpiMensalRow, type PorContaContabilRow, type SaldoAtualBanco, type FluxoCaixaMes, type FluxoCaixaBancoMes,
} from "@/lib/queries/dashboard";
import { listarTransacoesEmpresa, type TransacaoEmpresaRich } from "@/lib/queries/financeiro";
import { STATUS_ARAMBURU_LABEL } from "@/types";
import { BancoDetalheModal } from "@/components/dashboard/BancoDetalheModal";
import { LancamentoDetalheModal } from "@/components/dashboard/LancamentoDetalheModal";
import { SaldosBancariosGrid } from "@/components/dashboard/SaldosBancariosGrid";
import { AgroPanoramaSection } from "@/components/dashboard/AgroPanoramaSection";
import { useToast } from "@/components/ui/Toast";

const PIE_COLORS = ["#246354", "#a67c20", "#3a6230", "#c49830", "#7aa870", "#d9b455", "#1a4d40", "#836016"];

const MES_NOMES: Record<string, string> = {
  "01": "Jan", "02": "Fev", "03": "Mar", "04": "Abr",
  "05": "Mai", "06": "Jun", "07": "Jul", "08": "Ago",
  "09": "Set", "10": "Out", "11": "Nov", "12": "Dez",
};

function mesShort(yyyymm: string) {
  const m = yyyymm?.split("-");
  if (!m || m.length < 2) return yyyymm ?? "";
  return `${MES_NOMES[m[1]] ?? m[1]}/${m[0].slice(2)}`;
}

const quickAccess = [
  { label: "Financeiro",  href: "/dashboard/financeiro",  icon: TrendingUp,      color: "bg-primary-700" },
  { label: "Estoque",     href: "/dashboard/estoque",     icon: Package,          color: "bg-primary-600" },
  { label: "Documentos",  href: "/dashboard/documentos",  icon: FileText,         color: "bg-accent-600" },
  { label: "Assistentes", href: "/dashboard/assistentes", icon: Bot,              color: "bg-stone-700" },
];

export function DashboardHome() {
  const toast = useToast();
  const [kpiAll, setKpiAll]     = useState<KpiMensalRow[]>([]);
  const [byConta, setByConta]   = useState<PorContaContabilRow[]>([]);
  const [saldosBanco, setSaldosBanco] = useState<SaldoAtualBanco[]>([]);
  const [fluxo, setFluxo]       = useState<FluxoCaixaMes[]>([]);
  const [fluxoBancos, setFluxoBancos] = useState<FluxoCaixaBancoMes[]>([]);
  const [mesesAbertos, setMesesAbertos] = useState<Set<string>>(new Set());
  const [recent, setRecent]     = useState<TransacaoEmpresaRich[]>([]);
  const [loading, setLoading]   = useState(true);

  const [mesFiltro, setMesFiltro] = useState<string>("");      // "" = todos
  const [contaSelecionada, setContaSelecionada] = useState<string | null>(null);   // drill no PieChart
  const [bancoModal, setBancoModal] = useState<SaldoAtualBanco | null>(null);
  const [lancModal, setLancModal] = useState<TransacaoEmpresaRich | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [k, c, sb, fx, fxb, r] = await Promise.all([
        getKpiMensal(),
        getPorContaContabil(mesFiltro || undefined),
        getSaldoAtualPorBanco(),
        getFluxoCaixaMensal(),
        // View da migration 0044 — se ainda não aplicada, degrada sem quebrar.
        getFluxoCaixaBancos().catch(() => [] as FluxoCaixaBancoMes[]),
        listarTransacoesEmpresa(mesFiltro ? { mesReferencia: mesFiltro } : {}, 1, 5),
      ]);
      setKpiAll(k);
      setByConta(c);
      setSaldosBanco(sb);
      setFluxo(fx);
      setFluxoBancos(fxb);
      setRecent(r.rows);
    } catch (e: unknown) {
      toast.error("Erro carregando dashboard", (e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesFiltro]);
  useEffect(() => { fetchAll(); }, [fetchAll]);

  // KPI consolidado: usa o mês filtrado ou totaliza tudo.
  const kpiAtual = useMemo(() => {
    const base = mesFiltro ? kpiAll.filter((r) => r.mes_referencia === mesFiltro) : kpiAll;
    return base.reduce(
      (acc, r) => {
        acc.entradas += Number(r.entradas_realizadas ?? 0);
        acc.saidas   += Number(r.saidas_realizadas ?? 0);
        acc.aPagar   += Number(r.saidas_a_pagar ?? 0);
        acc.provis   += Number(r.saidas_provisionadas ?? 0);
        return acc;
      },
      { entradas: 0, saidas: 0, aPagar: 0, provis: 0 },
    );
  }, [kpiAll, mesFiltro]);

  // BarChart: receita vs despesa mensal
  const barData = useMemo(() => kpiAll.map((r) => ({
    mes: mesShort(r.mes_referencia),
    Receita: Number(r.entradas_realizadas ?? 0),
    Despesa: Number(r.saidas_realizadas ?? 0),
  })), [kpiAll]);

  // PieChart: despesa por conta contábil (apenas saídas) — com percentual (RF-FIN-03)
  const pieData = useMemo(() => {
    const saidas = byConta.filter((r) => r.natureza === "saida");
    const m = new Map<string, { name: string; value: number; codigo: string }>();
    for (const r of saidas) {
      const k = r.conta_contabil_cod;
      const cur = m.get(k);
      const v = Math.abs(Number(r.valor_total ?? 0));
      if (cur) cur.value += v;
      else m.set(k, { name: r.conta_contabil_nome, value: v, codigo: k });
    }
    const arr = Array.from(m.values()).sort((a, b) => b.value - a.value).slice(0, 8);
    // percentual relativo ao total EXIBIDO (soma das fatias) — evita divisão por zero.
    const totalExibido = arr.reduce((s, d) => s + d.value, 0);
    return arr.map((d) => ({ ...d, pct: totalExibido > 0 ? (d.value / totalExibido) * 100 : 0 }));
  }, [byConta]);

  // "39,1%" — 1 casa decimal, vírgula PT-BR
  const fmtPct = (n: number) => `${n.toFixed(1).replace(".", ",")}%`;

  // mês corrente "YYYY-MM" — para destacar a linha atual no fluxo de caixa
  const mesAtual = new Date().toISOString().slice(0, 7);

  const meses = useMemo(() => kpiAll.map((r) => r.mes_referencia), [kpiAll]);

  // Saldos por banco de cada mês (conferência com extrato — RF 23-jul).
  const bancosPorMes = useMemo(() => {
    const m = new Map<string, FluxoCaixaBancoMes[]>();
    for (const b of fluxoBancos) {
      const arr = m.get(b.mes_referencia) ?? [];
      arr.push(b);
      m.set(b.mes_referencia, arr);
    }
    return m;
  }, [fluxoBancos]);

  const toggleMesAberto = (mes: string) => {
    setMesesAbertos((prev) => {
      const next = new Set(prev);
      if (next.has(mes)) next.delete(mes); else next.add(mes);
      return next;
    });
  };

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#0f1f1c]">Home</h1>
          <p className="text-sm text-stone-500">Visão geral da Agropecuária Aramburu</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={mesFiltro}
            onChange={(e) => { setMesFiltro(e.target.value); setContaSelecionada(null); }}
            className="h-9 rounded-lg border border-stone-200 px-3 text-sm bg-white"
          >
            <option value="">Todos os meses</option>
            {meses.map((m) => <option key={m} value={m}>{mesShort(m)}</option>)}
          </select>
          <Button variant="outline" size="sm">
            <Download size={14} /> Relatório Financeiro
          </Button>
          <Button size="sm">
            <Download size={14} /> Relatório Contábil
          </Button>
        </div>
      </div>

      {/* Saldos por Banco — informação principal, no início da página (RF 23-jul) */}
      <SaldosBancariosGrid
        saldos={saldosBanco}
        loading={loading}
        onSelect={setBancoModal}
      />

      {/* Corpo em duas colunas: conteúdo financeiro à esquerda; calendários e
          alertas à DIREITA (RF 23-jul). Em telas menores tudo empilha. */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
      <div className="xl:col-span-2 space-y-6 min-w-0">

      {/* Quick access */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {quickAccess.map(({ label, href, icon: Icon, color }) => (
          <Link key={href} href={href}>
            <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-5 flex flex-col items-center gap-3 hover:shadow-md transition cursor-pointer">
              <div className={`w-14 h-14 rounded-xl ${color} flex items-center justify-center`}>
                <Icon size={24} className="text-white" />
              </div>
              <span className="text-sm font-semibold text-stone-800">{label}</span>
            </div>
          </Link>
        ))}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Entradas realizadas"
          value={formatCurrency(kpiAtual.entradas)}
          icon={<TrendingUp size={16}/>}
          trend="up"
          helpText="Soma de tudo que efetivamente entrou na conta no período (Recebido, Resgatado, Aplicação)."
        />
        <KpiCard
          label="Saídas realizadas"
          value={formatCurrency(kpiAtual.saidas)}
          icon={<TrendingDown size={16}/>}
          trend="down"
          helpText="Soma de tudo que efetivamente saiu da conta no período (Pago, Repassado, Aplicado, Resgate)."
        />
        <KpiCard
          label="A pagar"
          value={formatCurrency(Math.abs(kpiAtual.aPagar))}
          icon={<DollarSign size={16}/>}
          helpText="Lançamentos confirmados que ainda não foram pagos. Saídas previstas."
        />
        <KpiCard
          label="Provisionado"
          value={formatCurrency(Math.abs(kpiAtual.provis))}
          icon={<DollarSign size={16}/>}
          trend="neutral"
          helpText="Previsões de saída ainda sem confirmação (estimativas, recorrências futuras). Não afeta o saldo atual."
        />
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Receita × Despesa por Mês</CardTitle>
            {loading && <Loader2 size={14} className="animate-spin text-stone-400" />}
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={barData}
                margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                onClick={(s) => {
                  // drill: clique numa barra filtra o mês
                  const label = s?.activeLabel as string | undefined;
                  if (!label) return;
                  const found = meses.find((m) => mesShort(m) === label);
                  if (found) setMesFiltro(found);
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" />
                <XAxis dataKey="mes" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                <RechartsTooltip
                  formatter={(v) => formatCurrency(Number(v ?? 0))}
                  contentStyle={{ borderRadius: 8, border: "1px solid #e7e5e4", fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Receita" fill="#246354" radius={[4,4,0,0]} cursor="pointer" />
                <Bar dataKey="Despesa" fill="#c49830" radius={[4,4,0,0]} cursor="pointer" />
              </BarChart>
            </ResponsiveContainer>
            <p className="text-[10px] text-stone-400 mt-1 text-center">Clique numa barra para filtrar o mês.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Despesa por Conta Contábil{mesFiltro ? ` — ${mesShort(mesFiltro)}` : ""}</CardTitle>
            {contaSelecionada && (
              <button onClick={() => setContaSelecionada(null)} className="text-xs text-accent-600 hover:underline">limpar</button>
            )}
          </CardHeader>
          <CardContent>
            {pieData.length === 0 && !loading && (
              <p className="text-xs text-stone-400 text-center py-8">Sem despesas neste período.</p>
            )}
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%" cy="50%"
                  outerRadius={88} innerRadius={48}
                  dataKey="value"
                  labelLine={false}
                  onClick={(d) => {
                    const codigo = (d as { codigo?: string }).codigo;
                    if (codigo) setContaSelecionada(prev => prev === codigo ? null : codigo);
                  }}
                >
                  {pieData.map((entry, i) => (
                    <Cell key={i}
                      fill={PIE_COLORS[i % PIE_COLORS.length]}
                      stroke={contaSelecionada === entry.codigo ? "#0f1f1c" : "none"}
                      strokeWidth={contaSelecionada === entry.codigo ? 2 : 0}
                      cursor="pointer"
                    />
                  ))}
                </Pie>
                <RechartsTooltip
                  formatter={(v, _n, item) => {
                    const pct = Number((item?.payload as { pct?: number })?.pct ?? 0);
                    return [`${formatCurrency(Number(v ?? 0))} — ${fmtPct(pct)}`, (item?.payload as { name?: string })?.name ?? ""];
                  }}
                  contentStyle={{ borderRadius: 8, border: "1px solid #e7e5e4", fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1 mt-2 text-[11px] max-h-32 overflow-y-auto">
              {pieData.map((d, i) => (
                <button
                  key={d.codigo}
                  onClick={() => setContaSelecionada(prev => prev === d.codigo ? null : d.codigo)}
                  className={`flex items-center gap-2 w-full text-left px-1 py-0.5 rounded hover:bg-stone-50 ${contaSelecionada === d.codigo ? "bg-accent-50" : ""}`}
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                  <span className="truncate flex-1 text-stone-600">{d.codigo} – {d.name}</span>
                  <span className="font-semibold text-stone-700 tabular-nums">{formatCurrency(d.value)}</span>
                  <span className="text-stone-400 tabular-nums w-12 text-right">{fmtPct(d.pct)}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Fluxo de Caixa — Saldo vs. próximo mês (espelha aba "Saldo Disponível") */}
      <Card>
        <CardHeader>
          <CardTitle>Fluxo de Caixa — Saldo vs. Próximo Mês</CardTitle>
          <Link href="/dashboard/saldos" className="text-xs text-accent-600 hover:underline">Saldos mensais</Link>
        </CardHeader>
        <CardContent className="p-0">
          {fluxo.length === 0 && !loading && (
            <p className="text-xs text-stone-400 text-center py-8">Sem dados de fluxo de caixa.</p>
          )}
          {fluxo.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-100">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500 uppercase tracking-wide">Mês</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap">Saldo no fim do mês</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap">Saídas do próx. mês</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap">Entradas garantidas (sem vendas)</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap">Saldo após o próximo mês</th>
                  </tr>
                </thead>
                <tbody>
                  {fluxo.map((f) => {
                    const ind = Number(f.saldo_menos_proximo_mes);
                    const ok = ind >= 0;
                    const atual = f.mes_referencia === mesAtual;
                    const entradas = Number(f.entradas_garantidas_proximo_mes);
                    const bancosMes = bancosPorMes.get(f.mes_referencia) ?? [];
                    const aberto = mesesAbertos.has(f.mes_referencia);
                    return (
                      <Fragment key={f.mes_referencia}>
                      <tr className={`border-b border-stone-50 hover:bg-stone-50 ${atual ? "bg-accent-50/40" : ""}`}>
                        <td className="px-4 py-2.5 text-stone-700 font-medium whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            {bancosMes.length > 0 && (
                              <button
                                type="button"
                                onClick={() => toggleMesAberto(f.mes_referencia)}
                                className="p-0.5 rounded hover:bg-stone-100 text-stone-400 hover:text-stone-700 transition"
                                title="Saldos por banco (conferência com os extratos)"
                                aria-label={`${aberto ? "Ocultar" : "Ver"} saldos por banco de ${mesShort(f.mes_referencia)}`}
                              >
                                {aberto ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                              </button>
                            )}
                            {mesShort(f.mes_referencia)}
                            {atual && <span className="ml-1.5 text-[9px] text-accent-600 font-semibold uppercase">atual</span>}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-stone-700 whitespace-nowrap">{formatCurrency(Number(f.saldo_final_acumulado))}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-red-600 whitespace-nowrap">{formatCurrency(Number(f.saidas_proximo_mes))}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700 whitespace-nowrap">{entradas > 0 ? `+${formatCurrency(entradas)}` : formatCurrency(entradas)}</td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold tabular-nums ${ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                            {formatCurrency(ind)}
                          </span>
                        </td>
                      </tr>
                      {/* Saldos por banco do mês — conferência com os extratos (RF 23-jul) */}
                      {aberto && bancosMes.length > 0 && (
                        <tr className="border-b border-stone-100 bg-stone-50/60">
                          <td colSpan={5} className="px-4 py-2.5">
                            <div className="flex flex-wrap gap-x-8 gap-y-1.5 pl-5">
                              {bancosMes.map((b) => (
                                <div key={b.conta_bancaria_id} className="flex items-center gap-2 text-xs">
                                  <Landmark size={12} className="text-stone-400 shrink-0" />
                                  <span className="font-semibold text-stone-600">{b.banco_apelido ?? b.banco_nome}</span>
                                  <span className="text-stone-400">inicial</span>
                                  <span className="tabular-nums font-medium text-stone-700">{formatCurrency(Number(b.saldo_inicial))}</span>
                                  <span className="text-stone-300">→</span>
                                  <span className="text-stone-400">final</span>
                                  <span className={`tabular-nums font-semibold ${Number(b.saldo_final) < 0 ? "text-red-600" : "text-emerald-700"}`}>
                                    {formatCurrency(Number(b.saldo_final))}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-stone-400 px-4 py-3 border-t border-stone-100 leading-relaxed">
            <strong className="text-stone-500">Saldo após o próximo mês</strong> = saldo no fim do mês + saídas e entradas garantidas (resgates/outras) do mês seguinte, <strong className="text-stone-500">sem contar vendas</strong>. Verde = passa o mês tranquila; vermelho = vai precisar de vendas ou resgates pra cobrir.
            {fluxoBancos.length > 0 && (
              <> Clique na setinha do mês para ver o <strong className="text-stone-500">saldo inicial e final de cada banco</strong> (CORA, SICREDI e INTER) — valores realizados, para bater com os extratos no fechamento.</>
            )}
          </p>
        </CardContent>
      </Card>

      {/* Últimos Lançamentos — full width */}
      <Card>
        <CardHeader>
          <CardTitle>Últimos Lançamentos</CardTitle>
          <Link href="/dashboard/financeiro" className="text-xs text-accent-600 hover:underline">Ver todos</Link>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-100">
                  {["Data","Descrição","Conta","Banco","Status","Valor"].map(h => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-stone-500 uppercase whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.length === 0 && !loading && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-stone-400 text-xs">Nenhum lançamento.</td></tr>
                )}
                {recent.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => setLancModal(t)}
                    className="border-b border-stone-50 last:border-0 table-row-alt hover:bg-primary-50/40 cursor-pointer transition-colors"
                    title="Clique para ver detalhes"
                  >
                    <td className="px-4 py-2 text-stone-500 text-xs whitespace-nowrap">
                      {new Date(t.data).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-4 py-2 text-stone-700 max-w-[320px] truncate" title={t.descricao ?? ""}>
                      {t.descricao || <span className="text-stone-300">—</span>}
                      <div className="text-[10px] text-stone-400">{t.fornecedor_nome ?? ""}</div>
                    </td>
                    <td className="px-4 py-2 text-stone-600 text-xs whitespace-nowrap">
                      {t.conta_contabil?.nome ?? <span className="text-stone-300">—</span>}
                    </td>
                    <td className="px-4 py-2 text-stone-600 text-xs whitespace-nowrap">
                      {t.conta_bancaria?.apelido ?? t.conta_bancaria?.nome ?? <span className="text-stone-300">—</span>}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant="neutral">{STATUS_ARAMBURU_LABEL[t.status]}</Badge>
                    </td>
                    <td className="px-4 py-2 font-semibold text-stone-800 tabular-nums whitespace-nowrap">
                      {formatCurrency(t.valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      </div>{/* /coluna esquerda */}

      {/* Coluna direita: calendários (chuva/vacinação) + central de alertas */}
      <div className="space-y-6 min-w-0">
        <AgroPanoramaSection layout="column" />
      </div>
      </div>{/* /grid duas colunas */}

      {/* Modais de drill-down */}
      <BancoDetalheModal banco={bancoModal} onClose={() => setBancoModal(null)} />
      <LancamentoDetalheModal lancamento={lancModal} onClose={() => setLancModal(null)} />
    </div>
  );
}
