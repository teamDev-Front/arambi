"use client";
// Página /dashboard/saldos
// Substitui a aba `Saldo Disponível` da planilha original — heatmap mensal
// Banco × Mês mostrando: saldo inicial → entradas → saídas → variação.
// Dados vêm de v_saldo_por_banco_mensal (já existente).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Select } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";
import { Wallet, TrendingUp, TrendingDown } from "lucide-react";

type LinhaBruta = {
  mes_referencia: string;
  conta_bancaria_id: string | null;
  conta_bancaria_nome: string | null;
  variacao_no_mes: number | null;
  saldo_inicial_no_mes: number | null;
  entradas: number | null;
  saidas: number | null;
};

type ContaCadastrada = {
  id: string;
  nome: string;
  apelido: string | null;
  ordem: number | null;
};

const NOMES_MES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const fmtBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtBRLcurta = (n: number) => {
  if (n === 0) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} mi`;
  if (abs >= 1_000)     return `${(n / 1_000).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })} mil`;
  return fmtBRL(n);
};

function mesParaTexto(yyyymm: string): string {
  const [, m] = yyyymm.split("-");
  return NOMES_MES[parseInt(m, 10) - 1] ?? yyyymm;
}

/**
 * Intensidade da célula (0..1) para o gradiente de cor — proporção contra o
 * maior valor absoluto da grade. Verde para positivo, vermelho para negativo.
 */
function corCelula(valor: number, maxAbs: number): { bg: string; fg: string } {
  if (valor === 0 || maxAbs === 0) return { bg: "transparent", fg: "#a8a29e" };
  const ratio = Math.min(1, Math.abs(valor) / maxAbs);
  const alpha = 0.10 + ratio * 0.55;          // 10% → 65%
  if (valor > 0) return { bg: `rgba(58, 98, 48, ${alpha})`, fg: ratio > 0.55 ? "#fff" : "#1a3028" };
  return                  { bg: `rgba(190, 40, 40, ${alpha})`, fg: ratio > 0.55 ? "#fff" : "#5b1a1a" };
}

export function SaldosPage() {
  const toast = useToast();
  const [ano, setAno] = useState<string>(() => String(new Date().getFullYear()));
  const [linhas, setLinhas] = useState<LinhaBruta[]>([]);
  const [contas, setContas] = useState<ContaCadastrada[]>([]);
  const [loading, setLoading] = useState(true);
  const [anosDisponiveis, setAnosDisponiveis] = useState<string[]>([]);

  const carregar = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    // Primeiro, anos disponíveis (varredura única na view)
    const [anosRes, contasRes] = await Promise.all([
      supabase.from("v_saldo_por_banco_mensal").select("mes_referencia"),
      supabase.from("contas_bancarias_empresa")
        .select("id, nome, apelido, ordem")
        .eq("ativa", true)
        .order("ordem", { ascending: true, nullsFirst: false })
        .order("nome"),
    ]);

    if (anosRes.error)   toast.error("Erro ao listar anos", anosRes.error.message);
    if (contasRes.error) toast.error("Erro ao listar contas", contasRes.error.message);

    const anosUnicos = Array.from(
      new Set((anosRes.data ?? []).map((r) => r.mes_referencia.slice(0, 4)))
    ).sort().reverse();
    setAnosDisponiveis(anosUnicos);
    setContas(contasRes.data ?? []);

    // Carrega só o ano selecionado
    const { data, error } = await supabase
      .from("v_saldo_por_banco_mensal")
      .select("mes_referencia, conta_bancaria_id, conta_bancaria_nome, variacao_no_mes, saldo_inicial_no_mes, entradas, saidas")
      .gte("mes_referencia", `${ano}-01`)
      .lte("mes_referencia", `${ano}-12`);

    if (error) {
      toast.error("Erro ao carregar saldos", error.message);
      setLinhas([]);
    } else {
      setLinhas((data ?? []) as LinhaBruta[]);
    }
    setLoading(false);
  }, [ano, toast]);

  useEffect(() => { void carregar(); }, [carregar]);

  // Pivot: linha por banco (na ordem do cadastro), coluna por mês (1..12)
  const pivot = useMemo(() => {
    const porBanco = new Map<string, Map<number, LinhaBruta>>();
    for (const r of linhas) {
      if (!r.conta_bancaria_id) continue;
      const mes = parseInt(r.mes_referencia.split("-")[1], 10);
      if (!porBanco.has(r.conta_bancaria_id)) porBanco.set(r.conta_bancaria_id, new Map());
      porBanco.get(r.conta_bancaria_id)!.set(mes, r);
    }

    const linhasPivot = contas
      .filter(c => porBanco.has(c.id))
      .map(c => ({
        conta:    c,
        meses:    porBanco.get(c.id) ?? new Map<number, LinhaBruta>(),
      }));

    // Totalizadores por mês e geral
    const totaisMes = new Array(13).fill(0); // índices 1..12
    let totalGeralEntradas = 0;
    let totalGeralSaidas   = 0;
    for (const r of linhas) {
      const mes = parseInt(r.mes_referencia.split("-")[1], 10);
      totaisMes[mes] += Number(r.variacao_no_mes ?? 0);
      totalGeralEntradas += Number(r.entradas ?? 0);
      totalGeralSaidas   += Number(r.saidas ?? 0);
    }
    const maxAbsCelula = Math.max(
      0.01,
      ...linhas.map(r => Math.abs(Number(r.variacao_no_mes ?? 0))),
    );

    return { linhasPivot, totaisMes, totalGeralEntradas, totalGeralSaidas, maxAbsCelula };
  }, [linhas, contas]);

  const hasData = pivot.linhasPivot.length > 0;

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#0f1f1c] flex items-center gap-2">
            <Wallet size={20} className="text-accent-500" /> Saldos Mensais
          </h1>
          <p className="text-sm text-stone-500 max-w-[760px]">
            Variação mensal de saldo por banco — entradas, saídas e movimentação líquida.
            Mesmo formato da aba <code className="text-[10px] bg-stone-100 px-1.5 py-0.5 rounded">Saldo Disponível</code> da planilha original.
          </p>
        </div>
        <Select
          value={ano}
          onChange={(e) => setAno(e.target.value)}
          className="w-32"
        >
          {(anosDisponiveis.length ? anosDisponiveis : [ano]).map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                <TrendingUp size={18} className="text-emerald-700" />
              </div>
              <div>
                <p className="text-[11px] text-stone-500 uppercase tracking-wide">Entradas no ano</p>
                <p className="text-lg font-bold text-stone-800">{fmtBRL(pivot.totalGeralEntradas)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center">
                <TrendingDown size={18} className="text-red-700" />
              </div>
              <div>
                <p className="text-[11px] text-stone-500 uppercase tracking-wide">Saídas no ano</p>
                <p className="text-lg font-bold text-stone-800">{fmtBRL(pivot.totalGeralSaidas)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                <Wallet size={18} className="text-amber-700" />
              </div>
              <div>
                <p className="text-[11px] text-stone-500 uppercase tracking-wide">Variação líquida</p>
                <p className="text-lg font-bold text-stone-800">{fmtBRL(pivot.totalGeralEntradas + pivot.totalGeralSaidas)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Variação mensal por banco — {ano}</CardTitle>
          <span className="text-[11px] text-stone-400">
            Verde = movimento positivo · Vermelho = negativo · Intensidade ∝ valor absoluto
          </span>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-100">
                  <th className="px-3 py-2 text-left text-[11px] font-semibold text-stone-500 uppercase sticky left-0 bg-stone-50 z-10">Banco</th>
                  {NOMES_MES.map((m) => (
                    <th key={m} className="px-2 py-2 text-center text-[11px] font-semibold text-stone-500 uppercase">{m}</th>
                  ))}
                  <th className="px-3 py-2 text-right text-[11px] font-semibold text-stone-500 uppercase border-l border-stone-200">Total ano</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={14} className="px-4 py-12 text-center text-xs text-stone-400">Carregando…</td></tr>
                )}
                {!loading && !hasData && (
                  <tr><td colSpan={14} className="px-4 py-12 text-center text-xs text-stone-400">
                    Nenhuma movimentação encontrada em {ano}. Lance transações em Financeiro para popular esta visão.
                  </td></tr>
                )}
                {!loading && pivot.linhasPivot.map(({ conta, meses }) => {
                  let totalAno = 0;
                  for (const mes of meses.values()) totalAno += Number(mes.variacao_no_mes ?? 0);
                  return (
                    <tr key={conta.id} className="border-b border-stone-50 hover:bg-stone-50/50 transition">
                      <td className="px-3 py-2 text-stone-700 text-xs font-medium sticky left-0 bg-white z-10">
                        {conta.apelido ?? conta.nome}
                      </td>
                      {Array.from({ length: 12 }).map((_, idx) => {
                        const mes = idx + 1;
                        const r = meses.get(mes);
                        const valor = Number(r?.variacao_no_mes ?? 0);
                        const cor = corCelula(valor, pivot.maxAbsCelula);
                        const tooltip = r
                          ? `Saldo inicial: ${fmtBRL(Number(r.saldo_inicial_no_mes ?? 0))}\nEntradas: ${fmtBRL(Number(r.entradas ?? 0))}\nSaídas: ${fmtBRL(Number(r.saidas ?? 0))}\nVariação: ${fmtBRL(valor)}`
                          : "Sem movimento";
                        return (
                          <td
                            key={mes}
                            className="px-2 py-2 text-center text-[11px] font-mono tabular-nums"
                            style={{ backgroundColor: cor.bg, color: cor.fg }}
                            title={tooltip}
                          >
                            {valor === 0 ? <span className="text-stone-300">—</span> : fmtBRLcurta(valor)}
                          </td>
                        );
                      })}
                      <td className={`px-3 py-2 text-right text-xs font-semibold border-l border-stone-200 tabular-nums ${
                        totalAno > 0 ? "text-emerald-700" : totalAno < 0 ? "text-red-700" : "text-stone-400"
                      }`}>
                        {totalAno === 0 ? "—" : fmtBRL(totalAno)}
                      </td>
                    </tr>
                  );
                })}
                {!loading && hasData && (
                  <tr className="border-t-2 border-stone-300 bg-stone-50 font-semibold">
                    <td className="px-3 py-2 text-stone-700 text-xs uppercase sticky left-0 bg-stone-50 z-10">Total</td>
                    {pivot.totaisMes.slice(1).map((v, idx) => (
                      <td key={idx} className={`px-2 py-2 text-center text-[11px] font-mono tabular-nums ${
                        v > 0 ? "text-emerald-700" : v < 0 ? "text-red-700" : "text-stone-400"
                      }`}>
                        {v === 0 ? "—" : fmtBRLcurta(v)}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right text-xs font-bold tabular-nums text-stone-800 border-l border-stone-200">
                      {fmtBRL(pivot.totaisMes.reduce((a, b) => a + b, 0))}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
