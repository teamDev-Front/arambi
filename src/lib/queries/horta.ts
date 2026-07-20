// Queries do módulo Horta / Canteiros (migration 0042).
// Roda no client. Escrita protegida por RLS (admin+editor).

import { createClient } from "@/lib/supabase/client";
import type { HortaCulturaRow, CanteiroRow, CanteiroCicloRow, CanteiroCicloStatus } from "@/types";

// ----------------------------------------------------------------------------
// Culturas
// ----------------------------------------------------------------------------
export async function listarCulturasHorta(): Promise<HortaCulturaRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from("horta_culturas").select("*").order("nome");
  if (error) throw error;
  return (data ?? []) as HortaCulturaRow[];
}

export async function criarCulturaHorta(p: { nome: string; ciclo_dias_padrao: number | null }): Promise<HortaCulturaRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("horta_culturas")
    .insert({ nome: p.nome.trim(), ciclo_dias_padrao: p.ciclo_dias_padrao })
    .select()
    .maybeSingle();
  if (error) {
    if (error.code === "23505") throw new Error(`A cultura "${p.nome}" já existe.`);
    throw error;
  }
  if (!data) throw new Error("Não foi possível criar — sem permissão de escrita.");
  return data as HortaCulturaRow;
}

export async function atualizarCulturaHorta(id: string, p: { nome: string; ciclo_dias_padrao: number | null; ativo: boolean }): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("horta_culturas")
    .update({ nome: p.nome.trim(), ciclo_dias_padrao: p.ciclo_dias_padrao, ativo: p.ativo })
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Não foi possível salvar — sem permissão de escrita.");
}

// ----------------------------------------------------------------------------
// Canteiros
// ----------------------------------------------------------------------------
export async function listarCanteiros(): Promise<CanteiroRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from("canteiros").select("*").order("numero");
  if (error) throw error;
  return (data ?? []) as CanteiroRow[];
}

export async function criarCanteiro(p: { numero: number; area_m2: number | null }): Promise<CanteiroRow> {
  const supabase = createClient();
  const { data, error } = await supabase.from("canteiros").insert(p).select().maybeSingle();
  if (error) {
    if (error.code === "23505") throw new Error(`O canteiro ${p.numero} já existe.`);
    throw error;
  }
  if (!data) throw new Error("Não foi possível criar — sem permissão de escrita.");
  return data as CanteiroRow;
}

export async function atualizarCanteiro(id: string, p: { area_m2: number | null; ativo: boolean }): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.from("canteiros").update(p).eq("id", id).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Não foi possível salvar — sem permissão de escrita.");
}

// ----------------------------------------------------------------------------
// Ciclos
// ----------------------------------------------------------------------------
export interface CicloFormPayload {
  canteiro_id: string;
  cultura_id: string;
  data_plantio: string;
  previsao_colheita: string | null;
  status: CanteiroCicloStatus;
  observacao: string | null;
}

export async function listarCiclos(): Promise<CanteiroCicloRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("canteiro_ciclos")
    .select("*")
    .order("data_plantio", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CanteiroCicloRow[];
}

export async function criarCiclo(p: CicloFormPayload): Promise<CanteiroCicloRow> {
  const supabase = createClient();
  const { data, error } = await supabase.from("canteiro_ciclos").insert(p).select().maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Não foi possível plantar — sem permissão de escrita.");
  return data as CanteiroCicloRow;
}

export async function atualizarCiclo(id: string, p: Partial<CicloFormPayload> & { colhido_em?: string | null }): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.from("canteiro_ciclos").update(p).eq("id", id).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Não foi possível salvar — sem permissão de escrita.");
}

export async function excluirCiclo(id: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.from("canteiro_ciclos").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Não foi possível excluir — sem permissão de escrita.");
}
