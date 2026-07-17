// Queries da tela Provisionamento Anual (call 24-jun-2026).
// Junta três fontes que JÁ existem no banco — nada é duplicado:
//   • v_provisionamento_anual  → empresa por mês × conta (realizado/aberto/provisionado)
//   • v_dl_mensal_resumo       → distribuição de lucro detalhada por mês
//   • v_vendas_por_mes         → entradas futuras já firmadas (vendas provisionadas)

import { createClient } from "@/lib/supabase/client";
import type { ProvisionamentoAnualRow, DlMensalResumoRow, VendaPorPeriodoRow } from "@/types";

export async function listarProvisionamentoAnual(ano: string): Promise<ProvisionamentoAnualRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("v_provisionamento_anual")
    .select("*")
    .eq("ano", ano)
    .order("conta_contabil_cod");
  if (error) throw error;
  return (data ?? []) as ProvisionamentoAnualRow[];
}

export async function listarResumoDlAno(ano: string): Promise<DlMensalResumoRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("v_dl_mensal_resumo")
    .select("*")
    .gte("mes_referencia", `${ano}-01`)
    .lte("mes_referencia", `${ano}-12`)
    .order("mes_referencia");
  if (error) throw error;
  return (data ?? []) as DlMensalResumoRow[];
}

export async function listarVendasPorMesAno(ano: string): Promise<VendaPorPeriodoRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("v_vendas_por_mes")
    .select("*")
    .gte("mes_recebimento", `${ano}-01`)
    .lte("mes_recebimento", `${ano}-12`);
  if (error) throw error;
  return (data ?? []) as VendaPorPeriodoRow[];
}

/** Anos com movimento na empresa (para o seletor), do mais antigo ao mais novo. */
export async function listarAnosDisponiveis(): Promise<string[]> {
  const supabase = createClient();
  const [minRes, maxRes] = await Promise.all([
    supabase.from("transacoes_empresa").select("data").order("data", { ascending: true }).limit(1).maybeSingle(),
    supabase.from("transacoes_empresa").select("data").order("data", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (minRes.error) throw minRes.error;
  if (maxRes.error) throw maxRes.error;
  const anoCorrente = new Date().getFullYear();
  const min = Number((minRes.data?.data as string | undefined)?.slice(0, 4) ?? anoCorrente);
  const max = Math.max(Number((maxRes.data?.data as string | undefined)?.slice(0, 4) ?? anoCorrente), anoCorrente);
  const anos: string[] = [];
  for (let a = min; a <= max && anos.length < 50; a++) anos.push(String(a));
  return anos;
}
