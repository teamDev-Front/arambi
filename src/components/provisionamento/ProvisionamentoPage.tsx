"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LinkModulo } from "@/components/acessos/LinkModulo";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { KpiCard } from "@/components/ui/KpiCard";
import { Tooltip } from "@/components/ui/Tooltip";
import { useToast } from "@/components/ui/Toast";
import { Loader2, CalendarClock, TrendingUp, TrendingDown, HandCoins, Scale, HelpCircle, CopyPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useModulo } from "@/components/acessos/PermissoesProvider";
import { EspelharAnoModal } from "@/components/provisionamento/EspelharAnoModal";
import { formatCurrency } from "@/lib/utils/format";
import {
  listarProvisionamentoAnual, listarResumoDlAno, listarVendasPorMesAno, listarAnosDisponiveis,
} from "@/lib/queries/provisionamento";
import type { ProvisionamentoAnualRow, DlMensalResumoRow, VendaPorPeriodoRow } from "@/types";

const MESES_LABEL = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

// Valor compacto para caber 12 meses na tela: R$ 1,9 mi / 61,4 mil / 331
function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1_000) return `${(n / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

interface LinhaConta {
  cod: string;
  nome: string;
  natureza: "entrada" | "saida";
  previsto: number[];   // provisionado + em aberto, por mês (index 0 = jan)
  realizado: number[];
  totalPrevisto: number;
  totalRealizado: number;
}

export function ProvisionamentoPage() {
  const toast = useToast();
  // Modo leitura: a grade é só consulta; o que grava aqui é o "Espelhar ano".
  const { podeEditar } = useModulo("provisionamento");

  const anoCorrente = String(new Date().getFullYear());
  const [ano, setAno] = useState(anoCorrente);
  const [anos, setAnos] = useState<string[]>([anoCorrente]);
  const [rows, setRows] = useState<ProvisionamentoAnualRow[]>([]);
  const [dl, setDl] = useState<DlMensalResumoRow[]>([]);
  const [vendas, setVendas] = useState<VendaPorPeriodoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [espelharOpen, setEspelharOpen] = useState(false);

  useEffect(() => {
    listarAnosDisponiveis()
      .then(setAnos)
      .catch((e: unknown) => toast.error("Erro carregando anos", (e as Error).message ?? String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [p, d, v] = await Promise.all([
        listarProvisionamentoAnual(ano),
        listarResumoDlAno(ano),
        listarVendasPorMesAno(ano),
      ]);
      setRows(p); setDl(d); setVendas(v);
    } catch (e: unknown) {
      toast.error("Erro carregando provisionamento", (e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ano]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData(); }, [fetchData]);

  const mesIdx = (mesRef: string) => Number(mesRef.slice(5, 7)) - 1;
  const mesCorrenteIdx = ano === anoCorrente ? new Date().getMonth() : -1;

  // ---- linhas por conta contábil ----
  const linhas = useMemo<LinhaConta[]>(() => {
    const m = new Map<string, LinhaConta>();
    for (const r of rows) {
      let l = m.get(r.conta_contabil_cod);
      if (!l) {
        l = {
          cod: r.conta_contabil_cod,
          nome: r.conta_contabil_nome,
          natureza: r.natureza,
          previsto: Array(12).fill(0),
          realizado: Array(12).fill(0),
          totalPrevisto: 0,
          totalRealizado: 0,
        };
        m.set(r.conta_contabil_cod, l);
      }
      const i = mesIdx(r.mes_referencia);
      const prev = Number(r.provisionado) + Number(r.em_aberto);
      l.previsto[i] += prev;
      l.realizado[i] += Number(r.realizado);
      l.totalPrevisto += prev;
      l.totalRealizado += Number(r.realizado);
    }
    return Array.from(m.values()).sort((a, b) =>
      a.cod.localeCompare(b.cod, undefined, { numeric: true }));
  }, [rows]);

  const entradas = useMemo(() => linhas.filter((l) => l.natureza === "entrada"), [linhas]);
  const saidas   = useMemo(() => linhas.filter((l) => l.natureza === "saida"), [linhas]);

  // ---- linhas satélite: vendas firmadas + DL detalhado ----
  const vendasMes = useMemo(() => {
    const arr = Array(12).fill(0) as number[];
    for (const v of vendas) {
      if (!v.destino_empresa || !v.mes_recebimento) continue;
      arr[mesIdx(v.mes_recebimento)] += Number(v.valor_total);
    }
    return arr;
  }, [vendas]);

  const dlMes = useMemo(() => {
    const arr = Array(12).fill(0) as number[];
    for (const d of dl) {
      arr[mesIdx(d.mes_referencia)] += Number(d.provisionado) + Number(d.a_pagar);
    }
    return arr;
  }, [dl]);

  // ---- totais / KPIs ----
  const totalPrevistoMes = useMemo(() => {
    const arr = Array(12).fill(0) as number[];
    for (const l of linhas) l.previsto.forEach((v, i) => { arr[i] += v; });
    return arr;
  }, [linhas]);

  const kpi = useMemo(() => {
    const vendasAno = vendasMes.reduce((s, v) => s + v, 0);
    const saidasPrevAno = saidas.reduce((s, l) => s + l.totalPrevisto, 0);
    const entradasPrevAno = entradas.reduce((s, l) => s + l.totalPrevisto, 0);
    const dlAno = dlMes.reduce((s, v) => s + v, 0);
    return {
      vendasAno,
      saidasPrevAno,
      dlAno,
      resultado: vendasAno + entradasPrevAno + saidasPrevAno, // saídas já são negativas
    };
  }, [vendasMes, saidas, entradas, dlMes]);

  const celula = (previsto: number, realizado: number, destaque: boolean) => (
    <td className={`px-2 py-1.5 text-right whitespace-nowrap ${destaque ? "bg-accent-50/50" : ""}`}>
      {previsto !== 0
        ? <span className={`text-xs font-semibold ${previsto < 0 ? "text-red-600" : "text-emerald-700"}`}>{fmtCompact(previsto)}</span>
        : <span className="text-stone-300 text-xs">—</span>}
      {realizado !== 0 && (
        <div className="text-[10px] text-stone-400" title="Já realizado no mês">{fmtCompact(realizado)}</div>
      )}
    </td>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#0f1f1c]">Provisionamento Anual</h1>
          <p className="text-sm text-stone-500">
            Tudo que está programado até dezembro — custos, repasses e vendas firmadas, sem depender de planilha
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Espelhamento da virada do ano (17-ago) */}
          {podeEditar && (
            <Button variant="outline" size="sm" onClick={() => setEspelharOpen(true)}
              title="Copia as despesas fixas e periódicas deste ano para o ano seguinte, já provisionadas — sem lançar item por item">
              <CopyPlus size={14} /> Espelhar ano
            </Button>
          )}
          <select value={ano} onChange={(e) => setAno(e.target.value)}
            className="h-9 rounded-lg border border-stone-300 bg-white px-3 text-sm">
            {(anos.includes(ano) ? anos : [ano, ...anos]).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>

      <EspelharAnoModal
        open={espelharOpen}
        onClose={() => setEspelharOpen(false)}
        anoOrigem={ano}
        anos={anos}
        onConcluido={fetchData}
      />

      {/* KPIs do ano */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label={`Entradas previstas ${ano}`}
          value={formatCurrency(kpi.vendasAno)}
          icon={<TrendingUp size={16} />}
          helpText="Vendas já firmadas (módulo Vendas Futuras) com destino à empresa, pelo mês previsto de recebimento."
        />
        <KpiCard
          label={`Saídas previstas ${ano}`}
          value={formatCurrency(-kpi.saidasPrevAno)}
          icon={<TrendingDown size={16} />}
          helpText="Soma do provisionado + em aberto (a pagar) de todas as contas de saída da empresa no ano."
        />
        <KpiCard
          label="Distribuição de Lucro programada"
          value={formatCurrency(kpi.dlAno)}
          icon={<HandCoins size={16} />}
          helpText="Detalhado por sócio (provisionado + a pagar) — gerencie na tela Distribuição de Lucro."
        />
        <KpiCard
          label="Resultado projetado"
          value={formatCurrency(kpi.resultado)}
          icon={<Scale size={16} />}
          trend={kpi.resultado >= 0 ? "up" : "down"}
          helpText="Vendas firmadas + entradas previstas − saídas previstas do ano. Não inclui o saldo já em conta."
        />
      </div>

      {/* Grade anual */}
      <Card>
        <CardHeader>
          <CardTitle>
            Grade anual — {ano}
            <Tooltip text="Número principal = previsto (provisionado + a pagar/receber). Número menor cinza = já realizado no mês. Fonte: lançamentos do Financeiro — editar lá reflete aqui na hora." position="bottom">
              <HelpCircle size={12} className="inline-block ml-1 text-stone-300" />
            </Tooltip>
          </CardTitle>
          <CalendarClock size={16} className="text-stone-400" />
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="px-4 py-12 text-center text-stone-400">
              <Loader2 size={18} className="inline-block animate-spin mr-2" /> Carregando…
            </div>
          ) : linhas.length === 0 ? (
            <div className="px-4 py-12 text-center text-stone-400">
              Nenhum lançamento em {ano}. Os valores aparecem aqui automaticamente a partir do{" "}
              <LinkModulo href="/dashboard/financeiro" className="underline">Financeiro</LinkModulo>.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-100">
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap sticky left-0 bg-stone-50">Conta</th>
                    {MESES_LABEL.map((m, i) => (
                      <th key={m} className={`px-2 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wide ${i === mesCorrenteIdx ? "text-accent-600" : "text-stone-500"}`}>{m}</th>
                    ))}
                    <th className="px-3 py-2.5 text-right text-[10px] font-semibold text-stone-500 uppercase tracking-wide">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Entradas da empresa */}
                  {entradas.length > 0 && (
                    <tr className="bg-emerald-50/40 border-b border-stone-100">
                      <td colSpan={14} className="px-3 py-1.5 text-[10px] font-bold text-emerald-800 uppercase tracking-wide">Entradas</td>
                    </tr>
                  )}
                  {entradas.map((l) => (
                    <tr key={l.cod} className="border-b border-stone-50 hover:bg-stone-50 transition-colors">
                      <td className="px-3 py-1.5 text-xs text-stone-700 whitespace-nowrap sticky left-0 bg-white">
                        <span className="text-stone-400 mr-1">{l.cod}</span>{l.nome}
                      </td>
                      {MESES_LABEL.map((_, i) => celula(l.previsto[i], l.realizado[i], i === mesCorrenteIdx))}
                      <td className="px-3 py-1.5 text-right text-xs font-bold text-emerald-700 whitespace-nowrap">
                        {l.totalPrevisto !== 0 ? fmtCompact(l.totalPrevisto) : "—"}
                      </td>
                    </tr>
                  ))}
                  {/* Vendas firmadas (satélite) */}
                  <tr className="border-b border-stone-50 hover:bg-stone-50 transition-colors">
                    <td className="px-3 py-1.5 text-xs text-stone-700 whitespace-nowrap sticky left-0 bg-white">
                      <LinkModulo href="/dashboard/vendas-futuras" className="hover:underline" title="Contratos firmados no módulo Vendas Futuras — mês previsto de recebimento">
                        💰 Vendas firmadas (contratos)
                      </LinkModulo>
                    </td>
                    {vendasMes.map((v, i) => celula(v, 0, i === mesCorrenteIdx))}
                    <td className="px-3 py-1.5 text-right text-xs font-bold text-emerald-700 whitespace-nowrap">
                      {fmtCompact(vendasMes.reduce((s, v) => s + v, 0))}
                    </td>
                  </tr>

                  {/* Saídas da empresa */}
                  {saidas.length > 0 && (
                    <tr className="bg-red-50/40 border-b border-stone-100">
                      <td colSpan={14} className="px-3 py-1.5 text-[10px] font-bold text-red-800 uppercase tracking-wide">Saídas</td>
                    </tr>
                  )}
                  {saidas.map((l) => (
                    <tr key={l.cod} className="border-b border-stone-50 hover:bg-stone-50 transition-colors">
                      <td className="px-3 py-1.5 text-xs text-stone-700 whitespace-nowrap sticky left-0 bg-white">
                        <span className="text-stone-400 mr-1">{l.cod}</span>{l.nome}
                        {l.cod === "2.8" && (
                          <LinkModulo href="/dashboard/distribuicao" className="ml-1 text-accent-600 hover:underline text-[10px]">
                            ver detalhado →
                          </LinkModulo>
                        )}
                      </td>
                      {MESES_LABEL.map((_, i) => celula(l.previsto[i], l.realizado[i], i === mesCorrenteIdx))}
                      <td className="px-3 py-1.5 text-right text-xs font-bold text-red-600 whitespace-nowrap">
                        {l.totalPrevisto !== 0 ? fmtCompact(l.totalPrevisto) : "—"}
                      </td>
                    </tr>
                  ))}
                  {/* DL detalhado (satélite, conferência) */}
                  <tr className="border-b border-stone-50 hover:bg-stone-50 transition-colors">
                    <td className="px-3 py-1.5 text-xs text-stone-500 whitespace-nowrap sticky left-0 bg-white italic">
                      <LinkModulo href="/dashboard/distribuicao" className="hover:underline" title="Soma do detalhado por sócio (provisionado + a pagar) — deve bater com a linha 2.8">
                        ↳ conferência: DL detalhado por sócio
                      </LinkModulo>
                    </td>
                    {dlMes.map((v, i) => celula(v === 0 ? 0 : -v, 0, i === mesCorrenteIdx))}
                    <td className="px-3 py-1.5 text-right text-xs font-bold text-stone-500 whitespace-nowrap italic">
                      {fmtCompact(-dlMes.reduce((s, v) => s + v, 0))}
                    </td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr className="bg-stone-100 border-t-2 border-stone-200 font-semibold text-stone-700">
                    <td className="px-3 py-2 text-xs uppercase tracking-wide sticky left-0 bg-stone-100">Previsto no mês (empresa + vendas)</td>
                    {MESES_LABEL.map((_, i) => {
                      const v = totalPrevistoMes[i] + vendasMes[i];
                      return (
                        <td key={i} className={`px-2 py-2 text-right text-xs whitespace-nowrap ${v < 0 ? "text-red-700" : "text-emerald-700"} ${i === mesCorrenteIdx ? "bg-accent-50/60" : ""}`}>
                          {v !== 0 ? fmtCompact(v) : "—"}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right text-xs whitespace-nowrap">
                      {formatCurrency(kpi.resultado)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-stone-400">
        Fontes: lançamentos do <LinkModulo href="/dashboard/financeiro" className="underline">Financeiro</LinkModulo> (provisionado,
        a pagar/receber e realizado), contratos de <LinkModulo href="/dashboard/vendas-futuras" className="underline">Vendas Futuras</LinkModulo> e
        o detalhado da <LinkModulo href="/dashboard/distribuicao" className="underline">Distribuição de Lucro</LinkModulo>.
        Nada é digitado aqui — esta tela só espelha o que já está lançado, como as planilhas de provisionamento faziam.
      </p>
    </div>
  );
}
