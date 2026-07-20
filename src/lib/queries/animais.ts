// Queries do módulo Estoque de Animais (migration 0038).
// Roda no client (browser). Escrita protegida por RLS:
//   animal_especies → só admin; lotes/eventos/ocorrências → admin+editor.

import { createClient } from "@/lib/supabase/client";
import type {
  AnimalEspecieRow,
  AnimalLoteRow,
  AnimalEventoRow,
  AnimalOcorrenciaRow,
  AnimalLoteStatus,
  AnimalEventoTipo,
  OcorrenciaSeveridade,
} from "@/types";

// ----------------------------------------------------------------------------
// Espécies
// ----------------------------------------------------------------------------
export async function listarEspecies(incluirInativas = false): Promise<AnimalEspecieRow[]> {
  const supabase = createClient();
  let query = supabase.from("animal_especies").select("*");
  if (!incluirInativas) query = query.eq("ativo", true);
  const { data, error } = await query;
  if (error) throw error;
  return [...((data ?? []) as AnimalEspecieRow[])].sort(
    (a, b) => (a.ordem ?? 99) - (b.ordem ?? 99) || a.nome.localeCompare(b.nome),
  );
}

export async function criarEspecie(p: { nome: string; icone: string; ordem: number | null }): Promise<AnimalEspecieRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("animal_especies")
    .insert({ nome: p.nome.trim(), icone: p.icone || "🐄", ordem: p.ordem })
    .select()
    .maybeSingle();
  if (error) {
    if (error.code === "23505") throw new Error(`A espécie "${p.nome}" já existe.`);
    throw error;
  }
  if (!data) throw new Error("Não foi possível criar — sua conta precisa ser administradora.");
  return data as AnimalEspecieRow;
}

export async function atualizarEspecie(id: string, p: { nome: string; icone: string; ordem: number | null; ativo: boolean }): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("animal_especies")
    .update({ nome: p.nome.trim(), icone: p.icone, ordem: p.ordem, ativo: p.ativo })
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Não foi possível salvar — precisa ser admin.");
}

// ----------------------------------------------------------------------------
// Lotes
// ----------------------------------------------------------------------------
export interface LoteFormPayload {
  codigo: string;
  especie_id: string;
  categoria: string | null;
  raca: string | null;
  idade_meses: number | null;
  quantidade: number;
  status: AnimalLoteStatus;
  observacoes: string | null;
}

export async function listarLotes(): Promise<AnimalLoteRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from("animal_lotes").select("*").order("codigo");
  if (error) throw error;
  return (data ?? []) as AnimalLoteRow[];
}

export async function criarLote(p: LoteFormPayload): Promise<AnimalLoteRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("animal_lotes")
    .insert({ ...p, codigo: p.codigo.trim() })
    .select()
    .maybeSingle();
  if (error) {
    if (error.code === "23505") throw new Error(`O código "${p.codigo}" já existe.`);
    throw error;
  }
  if (!data) throw new Error("Não foi possível criar — sem permissão de escrita.");
  return data as AnimalLoteRow;
}

export async function atualizarLote(id: string, p: Partial<LoteFormPayload>): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("animal_lotes")
    .update(p.codigo !== undefined ? { ...p, codigo: p.codigo.trim() } : p)
    .eq("id", id)
    .select("id");
  if (error) {
    if (error.code === "23505") throw new Error(`O código "${p.codigo}" já existe.`);
    throw error;
  }
  if (!data || data.length === 0) throw new Error("Não foi possível salvar — sem permissão de escrita.");
}

export async function excluirLote(id: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.from("animal_lotes").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Não foi possível excluir — sem permissão de escrita.");
}

// ----------------------------------------------------------------------------
// Eventos sanitários (vacinação / vermifugação)
// ----------------------------------------------------------------------------
export interface EventoFormPayload {
  lote_id: string;
  tipo: AnimalEventoTipo;
  nome: string;
  data_aplicacao: string | null;
  proxima_data: string | null;
  observacao: string | null;
}

export async function listarEventos(): Promise<AnimalEventoRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("animal_eventos")
    .select("*")
    .order("proxima_data", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as AnimalEventoRow[];
}

export async function criarEvento(p: EventoFormPayload): Promise<AnimalEventoRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("animal_eventos")
    .insert({ ...p, nome: p.nome.trim() })
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Não foi possível registrar — sem permissão de escrita.");
  return data as AnimalEventoRow;
}

export async function atualizarEvento(id: string, p: Partial<EventoFormPayload>): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.from("animal_eventos").update(p).eq("id", id).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Não foi possível salvar — sem permissão de escrita.");
}

export async function excluirEvento(id: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.from("animal_eventos").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Não foi possível excluir — sem permissão de escrita.");
}

// ----------------------------------------------------------------------------
// Ocorrências (histórico de saúde)
// ----------------------------------------------------------------------------
export interface OcorrenciaFormPayload {
  lote_id: string;
  data: string;
  descricao: string;
  severidade: OcorrenciaSeveridade;
}

export async function listarOcorrencias(): Promise<AnimalOcorrenciaRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("animal_ocorrencias")
    .select("*")
    .order("data", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AnimalOcorrenciaRow[];
}

export async function criarOcorrencia(p: OcorrenciaFormPayload): Promise<AnimalOcorrenciaRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("animal_ocorrencias")
    .insert({ ...p, descricao: p.descricao.trim() })
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Não foi possível registrar — sem permissão de escrita.");
  return data as AnimalOcorrenciaRow;
}

export async function setOcorrenciaResolvida(id: string, resolvida: boolean): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("animal_ocorrencias")
    .update({ resolvida })
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Não foi possível alterar — sem permissão de escrita.");
}

export async function excluirOcorrencia(id: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.from("animal_ocorrencias").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Não foi possível excluir — sem permissão de escrita.");
}
