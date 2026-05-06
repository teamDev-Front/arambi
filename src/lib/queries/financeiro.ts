// Queries do módulo Financeiro (transacoes_empresa).
// Roda no client (browser) usando @supabase/ssr createBrowserClient.

import { createClient } from "@/lib/supabase/client";
import type {
  TransacaoEmpresaRow,
  TransacaoEmpresaInsert,
  TransacaoEmpresaUpdate,
  ClassificacaoFinanceiraRow,
  ContaBancariaEmpresaRow,
  StatusAramburu,
} from "@/types";

// Linha "enriquecida" trazida via select com joins.
export interface TransacaoEmpresaRich extends TransacaoEmpresaRow {
  conta_contabil?: { codigo: string; nome: string } | null;
  centro_custo?:   { codigo: string; nome: string } | null;
  conta_bancaria?: { id: string; nome: string; apelido: string | null } | null;
}

export interface ListarTransacoesFiltros {
  search?: string;                  // descrição/fornecedor/ref
  status?: StatusAramburu | "";
  contaContabilCod?: string;        // "2.7" — filtra prefixo
  centroCustoCod?: string;          // "2.7.2"
  contaBancariaId?: string;
  mesReferencia?: string;           // "YYYY-MM"
  dataDe?: string;
  dataAte?: string;
}

export interface ListarTransacoesResult {
  rows: TransacaoEmpresaRich[];
  total: number;
}

const TRANS_SELECT = `
  *,
  conta_contabil:classificacao_financeira!transacoes_empresa_conta_contabil_cod_fkey(codigo, nome),
  centro_custo:classificacao_financeira!transacoes_empresa_centro_custo_cod_fkey(codigo, nome),
  conta_bancaria:contas_bancarias_empresa(id, nome, apelido)
`;

export async function listarTransacoesEmpresa(
  filtros: ListarTransacoesFiltros = {},
  page = 1,
  pageSize = 25,
): Promise<ListarTransacoesResult> {
  const supabase = createClient();

  let q = supabase
    .from("transacoes_empresa")
    .select(TRANS_SELECT, { count: "exact" })
    .order("data", { ascending: false })
    .order("created_at", { ascending: false });

  if (filtros.search) {
    const s = filtros.search.replace(/[%_,]/g, " ").trim();
    if (s) {
      q = q.or(
        `descricao.ilike.%${s}%,fornecedor_nome.ilike.%${s}%,ref.ilike.%${s}%`,
      );
    }
  }
  if (filtros.status)            q = q.eq("status", filtros.status);
  if (filtros.centroCustoCod)    q = q.eq("centro_custo_cod", filtros.centroCustoCod);
  if (filtros.contaContabilCod)  q = q.eq("conta_contabil_cod", filtros.contaContabilCod);
  if (filtros.contaBancariaId)   q = q.eq("conta_bancaria_id", filtros.contaBancariaId);
  if (filtros.mesReferencia)     q = q.eq("mes_referencia", filtros.mesReferencia);
  if (filtros.dataDe)            q = q.gte("data", filtros.dataDe);
  if (filtros.dataAte)           q = q.lte("data", filtros.dataAte);

  const from = (page - 1) * pageSize;
  q = q.range(from, from + pageSize - 1);

  const { data, count, error } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as TransacaoEmpresaRich[], total: count ?? 0 };
}

export async function criarTransacaoEmpresa(payload: TransacaoEmpresaInsert): Promise<TransacaoEmpresaRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("transacoes_empresa")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data as TransacaoEmpresaRow;
}

export async function atualizarTransacaoEmpresa(
  id: string,
  payload: TransacaoEmpresaUpdate,
): Promise<TransacaoEmpresaRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("transacoes_empresa")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as TransacaoEmpresaRow;
}

export async function deletarTransacaoEmpresa(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("transacoes_empresa").delete().eq("id", id);
  if (error) throw error;
}

// ----------------------------------------------------------------------------
// Lookups (carregados uma vez por sessão na página)
// ----------------------------------------------------------------------------
export async function listarClassificacoes(): Promise<ClassificacaoFinanceiraRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("classificacao_financeira")
    .select("*")
    .eq("ativo", true)
    .order("ordem");
  if (error) throw error;
  return data as ClassificacaoFinanceiraRow[];
}

export async function listarContasEmpresa(): Promise<ContaBancariaEmpresaRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("contas_bancarias_empresa")
    .select("*")
    .eq("ativa", true)
    .order("ordem");
  if (error) throw error;
  return data as ContaBancariaEmpresaRow[];
}

export async function listarMesesDistintos(): Promise<string[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("transacoes_empresa")
    .select("mes_referencia")
    .order("mes_referencia", { ascending: false })
    .limit(200);
  if (error) throw error;
  return Array.from(new Set((data ?? []).map((r) => r.mes_referencia))).filter(Boolean) as string[];
}
