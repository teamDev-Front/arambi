// Queries do módulo Maquinário & Veículos (migration 0039).
// Roda no client. Escrita protegida por RLS (admin+editor).

import { createClient } from "@/lib/supabase/client";
import type {
  EquipamentoRow,
  EquipamentoManutencaoRow,
  EquipamentoDocumentoRow,
  EquipamentoTipo,
  EquipamentoStatus,
  MedidorTipo,
  CombustivelTipo,
} from "@/types";

// ----------------------------------------------------------------------------
// Equipamentos
// ----------------------------------------------------------------------------
export interface EquipamentoFormPayload {
  codigo: string;
  nome: string;
  tipo: EquipamentoTipo;
  marca_modelo: string | null;
  ano: number | null;
  medidor_tipo: MedidorTipo;
  medidor_atual: number | null;
  status: EquipamentoStatus;
  localizacao: string | null;
  combustivel: CombustivelTipo;
  observacoes: string | null;
  ativo: boolean;
}

export async function listarEquipamentos(): Promise<EquipamentoRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from("equipamentos").select("*").order("codigo");
  if (error) throw error;
  return (data ?? []) as EquipamentoRow[];
}

export async function criarEquipamento(p: EquipamentoFormPayload): Promise<EquipamentoRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("equipamentos")
    .insert({ ...p, codigo: p.codigo.trim(), nome: p.nome.trim() })
    .select()
    .maybeSingle();
  if (error) {
    if (error.code === "23505") throw new Error(`O código "${p.codigo}" já existe.`);
    throw error;
  }
  if (!data) throw new Error("Não foi possível criar — sem permissão de escrita.");
  return data as EquipamentoRow;
}

export async function atualizarEquipamento(id: string, p: Partial<EquipamentoFormPayload>): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.from("equipamentos").update(p).eq("id", id).select("id");
  if (error) {
    if (error.code === "23505") throw new Error(`O código "${p.codigo}" já existe.`);
    throw error;
  }
  if (!data || data.length === 0) throw new Error("Não foi possível salvar — sem permissão de escrita.");
}

export async function excluirEquipamento(id: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.from("equipamentos").delete().eq("id", id).select("id");
  if (error) {
    if (error.code === "23503") throw new Error("Equipamento tem talões/abastecimentos registrados — inative em vez de excluir.");
    throw error;
  }
  if (!data || data.length === 0) throw new Error("Não foi possível excluir — sem permissão de escrita.");
}

// ----------------------------------------------------------------------------
// Manutenções
// ----------------------------------------------------------------------------
export interface ManutencaoFormPayload {
  equipamento_id: string;
  descricao: string;
  data_prevista: string | null;
  medidor_previsto: number | null;
  realizada_em: string | null;
  observacao: string | null;
}

export async function listarManutencoes(): Promise<EquipamentoManutencaoRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("equipamento_manutencoes")
    .select("*")
    .order("data_prevista", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as EquipamentoManutencaoRow[];
}

export async function criarManutencao(p: ManutencaoFormPayload): Promise<EquipamentoManutencaoRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("equipamento_manutencoes")
    .insert({ ...p, descricao: p.descricao.trim() })
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Não foi possível criar — sem permissão de escrita.");
  return data as EquipamentoManutencaoRow;
}

export async function atualizarManutencao(id: string, p: Partial<ManutencaoFormPayload>): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.from("equipamento_manutencoes").update(p).eq("id", id).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Não foi possível salvar — sem permissão de escrita.");
}

export async function excluirManutencao(id: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.from("equipamento_manutencoes").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Não foi possível excluir — sem permissão de escrita.");
}

// ----------------------------------------------------------------------------
// Documentação
// ----------------------------------------------------------------------------
export interface DocumentoEqFormPayload {
  equipamento_id: string;
  tipo: string;
  descricao: string | null;
  vencimento: string;
}

export async function listarDocumentosEq(): Promise<EquipamentoDocumentoRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("equipamento_documentos")
    .select("*")
    .order("vencimento");
  if (error) throw error;
  return (data ?? []) as EquipamentoDocumentoRow[];
}

export async function criarDocumentoEq(p: DocumentoEqFormPayload): Promise<EquipamentoDocumentoRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("equipamento_documentos")
    .insert({ ...p, tipo: p.tipo.trim() })
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Não foi possível criar — sem permissão de escrita.");
  return data as EquipamentoDocumentoRow;
}

export async function atualizarDocumentoEq(id: string, p: Partial<DocumentoEqFormPayload>): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.from("equipamento_documentos").update(p).eq("id", id).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Não foi possível salvar — sem permissão de escrita.");
}

export async function excluirDocumentoEq(id: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.from("equipamento_documentos").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Não foi possível excluir — sem permissão de escrita.");
}
