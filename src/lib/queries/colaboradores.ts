// Queries de Colaboradores (Configurações → Colaboradores — migration 0041).
// Escrita protegida por RLS (só admin — policy colaboradores_admin).
// NUNCA excluir fisicamente: desativar preserva o histórico (call 14/jul).

import { createClient } from "@/lib/supabase/client";
import type { ColaboradorRow } from "@/types";

export function normalizarCpf(cpf: string): string {
  return String(cpf ?? "").replace(/\D/g, "");
}

export function formatarCpf(cpf: string): string {
  const d = normalizarCpf(cpf);
  if (d.length !== 11) return cpf;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** Valida CPF com dígitos verificadores. */
export function cpfValido(cpf: string): boolean {
  const c = normalizarCpf(cpf);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (base: string, fator: number) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (fator - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return dv(c.slice(0, 9), 10) === Number(c[9]) && dv(c.slice(0, 10), 11) === Number(c[10]);
}

export async function listarColaboradores(): Promise<ColaboradorRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from("colaboradores").select("*").order("nome");
  if (error) throw error;
  // pendentes primeiro (aguardando aprovação), depois ativos, depois desativados
  const peso = { pendente: 0, ativo: 1, desativado: 2 } as const;
  return [...((data ?? []) as ColaboradorRow[])].sort(
    (a, b) => peso[a.status] - peso[b.status] || a.nome.localeCompare(b.nome),
  );
}

export async function criarColaborador(nome: string, cpf: string): Promise<ColaboradorRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("colaboradores")
    .insert({ nome: nome.trim(), cpf: normalizarCpf(cpf), status: "ativo" })
    .select()
    .maybeSingle();
  if (error) {
    if (error.code === "23505") throw new Error("Este CPF já está cadastrado.");
    throw error;
  }
  if (!data) throw new Error("Não foi possível cadastrar — precisa ser admin.");
  return data as ColaboradorRow;
}

export async function atualizarColaborador(id: string, p: { nome: string }): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("colaboradores")
    .update({ nome: p.nome.trim() })
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Não foi possível salvar — precisa ser admin.");
}

/** Aprova solicitação pendente (plano B do portal). */
export async function aprovarColaborador(id: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("colaboradores")
    .update({ status: "ativo", desativado_em: null })
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Não foi possível aprovar — precisa ser admin.");
}

/** Desativa (bloqueia acesso) SEM apagar histórico. */
export async function desativarColaborador(id: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("colaboradores")
    .update({ status: "desativado", desativado_em: new Date().toISOString() })
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Não foi possível desativar — precisa ser admin.");
}

/** Reativa um colaborador desativado. */
export async function reativarColaborador(id: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("colaboradores")
    .update({ status: "ativo", desativado_em: null })
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Não foi possível reativar — precisa ser admin.");
}

/** Recusa e remove uma solicitação pendente (nunca teve histórico). */
export async function recusarSolicitacao(id: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("colaboradores")
    .delete()
    .eq("id", id)
    .eq("status", "pendente")
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Não foi possível recusar — precisa ser admin.");
}
