"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  TrendingUp, Package, FileText, Bot,
  ArrowUpRight, Download, LayoutDashboard, Loader2, Database,
} from "lucide-react";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils/format";
import {
  getKpiMensal, getPorContaContabil, getSaldoAtualPorBanco, getFluxoPlanilha, getFluxoContas,
  type KpiMensalRow, type PorContaContabilRow, type SaldoAtualBanco, type FluxoPlanilhaMes, type FluxoContaMes,
} from "@/lib/queries/dashboard";
import { IndicadoresFluxo } from "@/components/dashboard/IndicadoresFluxo";
import { FluxoCaixaTabela } from "@/components/dashboard/FluxoCaixaTabela";
import { listarTransacoesEmpresa, type TransacaoEmpresaRich } from "@/lib/queries/financeiro";
import { STATUS_ARAMBURU_LABEL } from "@/types";
import { BancoDetalheModal } from "@/components/dashboard/BancoDetalheModal";
import { LancamentoDetalheModal } from "@/components/dashboard/LancamentoDetalheModal";
import { SaldosBancariosGrid } from "@/components/dashboard/SaldosBancariosGrid";
import { CompetenciaMultiSelect } from "@/components/ui/CompetenciaMultiSelect";
import { AgroPanoramaSection } from "@/components/dashboard/AgroPanoramaSection";
import { useToast } from "@/components/ui/Toast";
import { usePermissoes } from "@/components/acessos/PermissoesProvider";
import type { ModuloKey } from "@/lib/acessos/modulos";

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

const quickAccess: { label: string; href: string; icon: typeof Bot; color: string; modulo: ModuloKey }[] = [
  { label: "Financeiro",  href: "/dashboard/financeiro",  icon: TrendingUp,      color: "bg-primary-700", modulo: "financeiro" },
  { label: "Estoque",     href: "/dashboard/estoque",     icon: Package,          color: "bg-primary-600", modulo: "estoque" },
  { label: "Documentos",  href: "/dashboard/documentos",  icon: FileText,         color: "bg-accent-600",  modulo: "documentos" },
  { label: "Assistentes", href: "/dashboard/assistentes", icon: Bot,              color: "bg-stone-700",   modulo: "assistentes" },
];

export function DashboardHome() {
  const toast = useToast();
  // Home adaptativa (0058): blocos financeiros só para quem vê o Financeiro;
  // atalhos só para módulos liberados.
  const { podeVer } = usePermissoes();
  const verFinanceiro = podeVer("financeiro");
  const atalhos = quickAccess.filter((q) => podeVer(q.modulo));
  const [kpiAll, setKpiAll]     = useState<KpiMensalRow[]>([]);
  const [byConta, setByConta]   = useState<PorContaContabilRow[]>([]);
  const [saldosBanco, setSaldosBanco] = useState<SaldoAtualBanco[]>([]);
  // Fluxo de Caixa da planilha VS4 (migration 0060); null = views ainda não criadas.
  const [fluxo, setFluxo]       = useState<FluxoPlanilhaMes[] | null>([]);
  const [fluxoContas, setFluxoContas] = useState<FluxoContaMes[]>([]);
  const [recent, setRecent]     = useState<TransacaoEmpresaRich[]>([]);
  const [loading, setLoading]   = useState(true);

  // Competência multi-seleção (17-ago) — lista vazia = todos os meses.
  const [mesesFiltro, setMesesFiltro] = useState<string[]>([]);
  const [contaSelecionada, setContaSelecionada] = useState<string | null>(null);   // drill no PieChart
  const [bancoModal, setBancoModal] = useState<SaldoAtualBanco | null>(null);
  const [lancModal, setLancModal] = useState<TransacaoEmpresaRich | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [k, c, sb, fx, fxc, r] = await Promise.all([
        getKpiMensal(),
        getPorContaContabil(mesesFiltro),
        getSaldoAtualPorBanco(),
        // Views da migration 0060 — se ainda não aplicada, a Home avisa e segue.
        getFluxoPlanilha().catch(() => null),
        getFluxoContas().catch(() => [] as FluxoContaMes[]),
        // Últimos REGISTRADOS (reunião 20-out: "está puxando de janeiro").
        listarTransacoesEmpresa(mesesFiltro.length ? { mesReferencia: mesesFiltro } : {}, 1, 5, "desc", "registro"),
      ]);
      setKpiAll(k);
      setByConta(c);
      setSaldosBanco(sb);
      setFluxo(fx);
      setFluxoContas(fxc);
      setRecent(r.rows);
    } catch (e: unknown) {
      toast.error("Erro carregando dashboard", (e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesesFiltro]);
  useEffect(() => { if (verFinanceiro) fetchAll(); }, [fetchAll, verFinanceiro]);

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

  // mês corrente "YYYY-MM" (data local) — linha atual do fluxo e saldos dos indicadores
  const hoje = new Date();
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;

  const meses = useMemo(() => kpiAll.map((r) => r.mes_referencia), [kpiAll]);

  const avisoMigration = (
    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <Database size={18} className="mt-0.5 shrink-0 text-amber-600" />
      <span>
        Indicadores e Fluxo de Caixa no formato da planilha VS4 dependem da migration{" "}
        <code className="rounded bg-amber-100 px-1.5 py-0.5 text-xs">0060_fluxo_caixa_vs4.sql</code> — aplique no SQL Editor do Supabase.
      </span>
    </div>
  );

  const atalhosJsx = atalhos.length > 0 && (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {atalhos.map(({ label, href, icon: Icon, color }) => (
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
  );

  // Sem o Financeiro: só atalhos e o panorama agro (calendários e alertas).
  if (!verFinanceiro) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold text-[#0f1f1c]">Home</h1>
          <p className="text-sm text-stone-500">Visão geral da Agropecuária Aramburu</p>
        </div>
        {atalhosJsx}
        <AgroPanoramaSection layout="row" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#0f1f1c]">Home</h1>
          <p className="text-sm text-stone-500">Visão geral da Agropecuária Aramburu</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Competência multi-seleção — mesmo padrão do Financeiro (17-ago) */}
          <label className="flex items-center gap-1.5 text-xs text-stone-500"
            title="Competência dos indicadores e do gráfico de despesa por conta. Nenhuma marcada = todos os meses (os saldos de Fluxo de Caixa e Despesas Variáveis usam o mês atual).">
            Competência
            <CompetenciaMultiSelect
              className="w-40"
              options={meses}
              value={mesesFiltro}
              onChange={(v: string[]) => { setMesesFiltro(v); setContaSelecionada(null); }}
              todasLabel="Todos os meses"
            />
          </label>
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

      {/* Ajuste 24-jul (Adri): as informações FINANCEIRAS ocupam a largura toda
          (em destaque); calendários e alertas descem para o FINAL da página,
          na horizontal — ver <AgroPanoramaSection layout="row" /> lá embaixo. */}

      {/* Quick access */}
      {atalhosJsx}

      {/* Indicadores no formato do painel "FLUXO DE CAIXA" da planilha VS4 (reunião 20-out) */}
      {fluxo === null
        ? avisoMigration
        : <IndicadoresFluxo linhas={fluxo} meses={mesesFiltro} mesAtual={mesAtual} />}

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
                  if (found) setMesesFiltro([found]);
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
            <CardTitle>
              Despesa por Conta Contábil
              {mesesFiltro.length === 1
                ? ` — ${mesShort(mesesFiltro[0])}`
                : mesesFiltro.length > 1
                  ? ` — ${mesesFiltro.length} competências`
                  : ""}
            </CardTitle>
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

      {/* Fluxo de Caixa — mesmo cálculo da aba "Saldo Disponível" da planilha VS4 (reunião 20-out) */}
      {fluxo !== null && (
        <FluxoCaixaTabela linhas={fluxo} contas={fluxoContas} loading={loading} mesAtual={mesAtual} />
      )}

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

      {/* Calendários (chuva/vacinação) + Central de Alertas — no FINAL da
          página, em horizontal (ajuste 24-jul). */}
      <AgroPanoramaSection layout="row" />

      {/* Modais de drill-down */}
      <BancoDetalheModal banco={bancoModal} onClose={() => setBancoModal(null)} />
      <LancamentoDetalheModal lancamento={lancModal} onClose={() => setLancModal(null)} />
    </div>
  );
}
