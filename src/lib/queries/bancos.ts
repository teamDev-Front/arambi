// Queries do módulo Bancos.
// Gerencia tanto as contas bancárias da empresa (Aramburu) como as dos sócios.
// O limite de 5 contas/sócio é enforçado por trigger no Postgres (migration 0015).

import { createClient } from "@/lib/supabase/client";
import type {
  ContaBancariaEmpresaRow,
  ContaBancariaSocioRow,
  SocioRow,
  Database,
} from "@/types";

type CbeInsert = Database["public"]["Tables"]["contas_bancarias_empresa"]["Insert"];
type CbeUpdate = Database["public"]["Tables"]["contas_bancarias_empresa"]["Update"];
type CbsInsert = Database["public"]["Tables"]["contas_bancarias_socio"]["Insert"];
type CbsUpdate = Database["public"]["Tables"]["contas_bancarias_socio"]["Update"];

export const MAX_CONTAS_POR_SOCIO = 5;

// ----------------------------------------------------------------------------
// Empresa
// ----------------------------------------------------------------------------
export async function listarContasEmpresa(): Promise<ContaBancariaEmpresaRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("contas_bancarias_empresa")
    .select("*")
    .order("ordem", { ascending: true, nullsFirst: false })
    .order("nome");
  if (error) throw error;
  return (data ?? []) as ContaBancariaEmpresaRow[];
}

export async function criarContaEmpresa(payload: CbeInsert): Promise<ContaBancariaEmpresaRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("contas_bancarias_empresa")
    .insert(payload)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Falha ao criar conta da empresa (sem permissão?)");
  return data as ContaBancariaEmpresaRow;
}

export async function atualizarContaEmpresa(id: string, payload: CbeUpdate): Promise<ContaBancariaEmpresaRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("contas_bancarias_empresa")
    .update(payload)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Falha ao atualizar conta da empresa");
  return data as ContaBancariaEmpresaRow;
}

export async function deletarContaEmpresa(id: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("contas_bancarias_empresa")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Conta não encontrada ou sem permissão");
}

// ----------------------------------------------------------------------------
// Sócio
// ----------------------------------------------------------------------------
export interface ContaBancariaSocioRich extends ContaBancariaSocioRow {
  socio?: { id: string; nome_completo: string; apelido: string | null } | null;
}

export async function listarSocios(): Promise<SocioRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("socios")
    .select("*")
    .eq("ativo", true)
    .order("nome_completo");
  if (error) throw error;
  return (data ?? []) as SocioRow[];
}

export async function listarContasSocios(socioId?: string): Promise<ContaBancariaSocioRich[]> {
  const supabase = createClient();
  let q = supabase
    .from("contas_bancarias_socio")
    .select(`
      *,
      socio:socios(id, nome_completo, apelido)
    `)
    .order("ordem", { ascending: true, nullsFirst: false })
    .order("nome");
  if (socioId) q = q.eq("socio_id", socioId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ContaBancariaSocioRich[];
}

export async function contarContasAtivasDoSocio(socioId: string): Promise<number> {
  const supabase = createClient();
  const { count, error } = await supabase
    .from("contas_bancarias_socio")
    .select("id", { count: "exact", head: true })
    .eq("socio_id", socioId)
    .eq("ativa", true);
  if (error) throw error;
  return count ?? 0;
}

export async function criarContaSocio(payload: CbsInsert): Promise<ContaBancariaSocioRow> {
  // Pré-check amigável (o trigger no Postgres também garante)
  if (payload.ativa !== false) {
    const atuais = await contarContasAtivasDoSocio(payload.socio_id);
    if (atuais >= MAX_CONTAS_POR_SOCIO) {
      throw new Error(
        `Este sócio já possui ${MAX_CONTAS_POR_SOCIO} contas bancárias ativas. ` +
        `Desative uma para cadastrar outra.`
      );
    }
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from("contas_bancarias_socio")
    .insert(payload)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Falha ao criar conta do sócio");
  return data as ContaBancariaSocioRow;
}

export async function atualizarContaSocio(id: string, payload: CbsUpdate): Promise<ContaBancariaSocioRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("contas_bancarias_socio")
    .update(payload)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Falha ao atualizar conta do sócio");
  return data as ContaBancariaSocioRow;
}

export async function deletarContaSocio(id: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("contas_bancarias_socio")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Conta não encontrada ou sem permissão");
}
