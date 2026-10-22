// Queries que alimentam o dashboard (Home) — todas batem nas views.
import { createClient } from "@/lib/supabase/client";
import type { FluxoContaRow, FluxoPlanilhaRow } from "@/types/database";

export interface KpiMensalRow {
  mes_referencia: string;
  entradas_realizadas: number;
  entradas_a_receber: number;
  saidas_realizadas: number;
  saidas_a_pagar: number;
  saidas_provisionadas: number;
  saldo_movimentacao: number;
}

export interface PorContaContabilRow {
  mes_referencia: string;
  conta_contabil_cod: string;
  conta_contabil_nome: string;
  natureza: "entrada" | "saida";
  valor_total: number;
  qtd_lancamentos: number;
}

export async function getKpiMensal(mesRef?: string): Promise<KpiMensalRow[]> {
  const supabase = createClient();
  let q = supabase.from("v_kpi_mensal").select("*").order("mes_referencia");
  if (mesRef) q = q.eq("mes_referencia", mesRef);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as KpiMensalRow[];
}

/** `mesRef` aceita LISTA desde 17-ago (competência virou multi-seleção). */
export async function getPorContaContabil(mesRef?: string | string[]): Promise<PorContaContabilRow[]> {
  const supabase = createClient();
  let q = supabase.from("v_por_conta_contabil_mensal").select("*");
  if (Array.isArray(mesRef)) {
    if (mesRef.length) q = q.in("mes_referencia", mesRef);
  } else if (mesRef) {
    q = q.eq("mes_referencia", mesRef);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as PorContaContabilRow[];
}

export async function getPorCentroCusto(mesRef?: string) {
  const supabase = createClient();
  let q = supabase.from("v_por_centro_custo_mensal").select("*");
  if (mesRef) q = q.eq("mes_referencia", mesRef);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function getSaldoPorBanco(mesRef?: string) {
  const supabase = createClient();
  let q = supabase.from("v_saldo_por_banco_mensal").select("*");
  if (mesRef) q = q.eq("mes_referencia", mesRef);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// Saldo conciliado por banco (não filtra por mês — saldo é cumulativo).
// Use para mostrar a "foto atual" das contas bancárias.
export interface SaldoAtualBanco {
  conta_bancaria_id: string;
  banco_nome: string;
  banco_apelido: string | null;
  banco_instituicao: string | null;
  banco_numero: string | null;            // código BACEN (403, 748, 077, 348)
  banco_tipo_instituicao: string | null;  // "banco" | "cooperativa"
  banco_agencia: string | null;
  banco_numero_conta: string | null;
  banco_digito: string | null;
  banco_tipo: string | null;              // "corrente" | "investimento"
  saldo_atual: number;
  a_pagar: number;
  a_receber: number;
  provisionado: number;
  entradas_realizadas: number;
  saidas_realizadas: number;
  saldo_projetado: number;
  total_lancamentos: number;
}

export async function getSaldoAtualPorBanco(): Promise<SaldoAtualBanco[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("v_saldo_atual_por_banco")
    .select("conta_bancaria_id, banco_nome, banco_apelido, banco_instituicao, banco_numero, banco_tipo_instituicao, banco_agencia, banco_numero_conta, banco_digito, banco_tipo, saldo_atual, a_pagar, a_receber, provisionado, entradas_realizadas, saidas_realizadas, saldo_projetado, total_lancamentos")
    .order("banco_ordem");
  if (error) throw error;
  return (data ?? []) as SaldoAtualBanco[];
}

// Fluxo de Caixa no formato da aba "Saldo Disponível" da planilha VS4
// (migration 0060): entradas, saídas, resultado, "saldo (−) contas do próximo
// mês" e despesa variável — mês a mês. Conferido linha a linha com a planilha.
export type FluxoPlanilhaMes = FluxoPlanilhaRow;

export async function getFluxoPlanilha(): Promise<FluxoPlanilhaMes[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("v_fluxo_caixa_planilha")
    .select("*")
    .order("mes_referencia");
  if (error) throw error;
  return (data ?? []) as FluxoPlanilhaMes[];
}

// Saldo inicial/final PROJETADO (todos os status, como a planilha) de cada
// conta em cada mês — cards de "Saldos bancários" do Fluxo de Caixa.
export type FluxoContaMes = FluxoContaRow;

export async function getFluxoContas(): Promise<FluxoContaMes[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("v_fluxo_caixa_contas")
    .select("*")
    .order("mes_referencia")
    .order("banco_ordem");
  if (error) throw error;
  return (data ?? []) as FluxoContaMes[];
}
