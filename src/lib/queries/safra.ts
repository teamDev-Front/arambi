// Queries do módulo Estoque/Safra
// Espelha a planilha "Provisionamento Safra 25.25 - Copasul.xlsx".

import { createClient } from "@/lib/supabase/client";
import type {
  ArmazemRow,
  SafraParametrosRow,
  SafraDepositoCalculadoRow,
  CulturaSafra,
  Database,
} from "@/types";

type SpInsert = Database["public"]["Tables"]["safra_parametros"]["Insert"];
type SpUpdate = Database["public"]["Tables"]["safra_parametros"]["Update"];
type SdInsert = Database["public"]["Tables"]["safra_depositos"]["Insert"];
type SdUpdate = Database["public"]["Tables"]["safra_depositos"]["Update"];
type ArmInsert = Database["public"]["Tables"]["armazens"]["Insert"];

// ----------------------------------------------------------------------------
// Armazéns
// ----------------------------------------------------------------------------
export async function listarArmazens(): Promise<ArmazemRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("armazens")
    .select("*")
    .eq("ativo", true)
    .order("ordem", { ascending: true, nullsFirst: false })
    .order("nome");
  if (error) throw error;
  return (data ?? []) as ArmazemRow[];
}

export async function criarArmazem(payload: ArmInsert): Promise<ArmazemRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("armazens").insert(payload).select().maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Falha ao criar armazém");
  return data as ArmazemRow;
}

// ----------------------------------------------------------------------------
// Parâmetros (por armazem × cultura × safra)
// ----------------------------------------------------------------------------
export async function listarParametros(armazemId?: string): Promise<SafraParametrosRow[]> {
  const supabase = createClient();
  let q = supabase.from("safra_parametros").select("*").order("safra");
  if (armazemId) q = q.eq("armazem_id", armazemId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as SafraParametrosRow[];
}

export async function obterParametro(armazemId: string, cultura: CulturaSafra, safra: string): Promise<SafraParametrosRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("safra_parametros")
    .select("*")
    .eq("armazem_id", armazemId)
    .eq("cultura", cultura)
    .eq("safra", safra)
    .maybeSingle();
  if (error) throw error;
  return (data as SafraParametrosRow | null) ?? null;
}

export async function upsertParametro(payload: SpInsert): Promise<SafraParametrosRow> {
  const existente = await obterParametro(payload.armazem_id, payload.cultura, payload.safra);
  const supabase = createClient();
  if (existente) {
    const update: SpUpdate = { ...payload };
    const { data, error } = await supabase
      .from("safra_parametros")
      .update(update)
      .eq("id", existente.id)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Falha ao atualizar parâmetros");
    return data as SafraParametrosRow;
  }
  const { data, error } = await supabase
    .from("safra_parametros")
    .insert(payload)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Falha ao criar parâmetros");
  return data as SafraParametrosRow;
}

// ----------------------------------------------------------------------------
// Depósitos calculados (view)
// ----------------------------------------------------------------------------
export interface ListarDepositosFiltros {
  armazemId?: string;
  cultura?: CulturaSafra;
  safra?: string;
  status?: import("@/types").SafraDepositoStatus;
  search?: string;
}

export async function listarDepositosCalculados(filtros: ListarDepositosFiltros = {}): Promise<SafraDepositoCalculadoRow[]> {
  const supabase = createClient();
  let q = supabase
    .from("v_safra_depositos_calculado")
    .select("*")
    .order("data_deposito", { ascending: true });

  if (filtros.armazemId) q = q.eq("armazem_id", filtros.armazemId);
  if (filtros.cultura)   q = q.eq("cultura", filtros.cultura);
  if (filtros.safra)     q = q.eq("safra", filtros.safra);
  if (filtros.status)    q = q.eq("status", filtros.status);
  if (filtros.search) {
    const s = filtros.search.replace(/[%_,]/g, " ").trim();
    if (s) q = q.or(`dfe_entrada.ilike.%${s}%,nfp.ilike.%${s}%,observacao.ilike.%${s}%`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as SafraDepositoCalculadoRow[];
}

export async function criarDeposito(payload: SdInsert): Promise<void> {
  const supabase = createClient();
  const { error, data } = await supabase
    .from("safra_depositos")
    .insert(payload)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Falha ao criar depósito");
}

export async function atualizarDeposito(id: string, payload: SdUpdate): Promise<void> {
  const supabase = createClient();
  const { error, data } = await supabase
    .from("safra_depositos")
    .update(payload)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Falha ao atualizar depósito");
}

export async function deletarDeposito(id: string): Promise<void> {
  const supabase = createClient();
  const { error, data } = await supabase
    .from("safra_depositos")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Depósito não encontrado ou sem permissão");
}

// ----------------------------------------------------------------------------
// Resumo (totais)
// ----------------------------------------------------------------------------
export interface SafraResumo {
  qtd_depositos: number;
  total_kg_bruto: number;
  total_kg_liquido: number;
  total_sc_bruto: number;
  total_sc_liquida: number;
  total_quebra_kg: number;
  total_taxa_armazenagem: number;
  total_taxa_devolucao: number;
  total_a_descontar: number;
  total_valor_venda: number;
  saldo_a_receber: number;
  por_data_deposito: Array<{ data: string; kg_bruto: number; kg_liquido: number }>;
}

export function calcularResumoSafra(rows: SafraDepositoCalculadoRow[]): SafraResumo {
  let kg_bruto = 0, kg_liquido = 0, sc_bruto = 0, sc_liquida = 0;
  let quebra_kg = 0, taxa_armaz = 0, taxa_dev = 0, descontar = 0, venda = 0;
  const aggDay = new Map<string, { kg_bruto: number; kg_liquido: number }>();

  for (const r of rows) {
    kg_bruto += Number(r.kg_bruto);
    kg_liquido += Number(r.kg_liquido);
    sc_bruto += Number(r.sc_bruto);
    sc_liquida += Number(r.sc_liquida);
    quebra_kg += Number(r.quebra_kg);
    taxa_armaz += Number(r.taxa_armazenagem);
    taxa_dev += Number(r.taxa_devolucao);
    descontar += Number(r.total_a_descontar);
    venda += Number(r.valor_venda_simulado);

    const k = r.data_deposito;
    const ex = aggDay.get(k) ?? { kg_bruto: 0, kg_liquido: 0 };
    ex.kg_bruto += Number(r.kg_bruto);
    ex.kg_liquido += Number(r.kg_liquido);
    aggDay.set(k, ex);
  }

  return {
    qtd_depositos: rows.length,
    total_kg_bruto: kg_bruto,
    total_kg_liquido: kg_liquido,
    total_sc_bruto: sc_bruto,
    total_sc_liquida: sc_liquida,
    total_quebra_kg: quebra_kg,
    total_taxa_armazenagem: taxa_armaz,
    total_taxa_devolucao: taxa_dev,
    total_a_descontar: descontar,
    total_valor_venda: venda,
    saldo_a_receber: venda - descontar,
    por_data_deposito: Array.from(aggDay, ([data, v]) => ({ data, ...v })).sort((a, b) => a.data.localeCompare(b.data)),
  };
}
