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
  status?: StatusAramburu | StatusAramburu[]; // 1 status ou lista (multi-seleção)
  contaContabilCod?: string;        // "2.7" — filtra prefixo
  centroCustoCod?: string | string[]; // "2.7.2" — string (1) ou lista (multi-seleção)
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
  if (filtros.status) {
    const st = filtros.status;
    if (Array.isArray(st)) { if (st.length > 0) q = q.in("status", st); }
    else q = q.eq("status", st);
  }
  if (filtros.centroCustoCod) {
    const cc = filtros.centroCustoCod;
    if (Array.isArray(cc)) {
      if (cc.length > 0) q = q.in("centro_custo_cod", cc);
    } else {
      q = q.eq("centro_custo_cod", cc);
    }
  }
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

// ----------------------------------------------------------------------------
// Resumo do escopo (RF-FIN-09) — alimenta o modal de revisão antes de gerar
// o relatório. Precedência: seleção manual (ids) > filtros aplicados.
// ----------------------------------------------------------------------------
export interface ResumoEscopo {
  count: number;                         // total de lançamentos no recorte
  soma: number;                          // soma líquida dos valores (com sinal)
  contas: { id: string; nome: string }[];
  centros: { cod: string; nome: string }[];
  statuses: StatusAramburu[];
  capped: boolean;                       // true se o recorte excedeu o limite de amostragem
}

const RESUMO_CAP = 10000;

export async function resumirEscopoTransacoes(
  scope: { filtros?: ListarTransacoesFiltros; transacaoIds?: string[] },
): Promise<ResumoEscopo> {
  const supabase = createClient();
  let q = supabase
    .from("transacoes_empresa")
    .select(
      `id, valor, status, conta_bancaria_id,
       centro_custo:classificacao_financeira!transacoes_empresa_centro_custo_cod_fkey(codigo, nome),
       conta_bancaria:contas_bancarias_empresa(id, nome, apelido)`,
      { count: "exact" },
    );

  if (scope.transacaoIds && scope.transacaoIds.length) {
    q = q.in("id", scope.transacaoIds);
  } else if (scope.filtros) {
    const f = scope.filtros;
    if (f.search) {
      const s = f.search.replace(/[%_,]/g, " ").trim();
      if (s) q = q.or(`descricao.ilike.%${s}%,fornecedor_nome.ilike.%${s}%,ref.ilike.%${s}%`);
    }
    if (f.status) {
      const st = f.status;
      if (Array.isArray(st)) { if (st.length > 0) q = q.in("status", st); }
      else q = q.eq("status", st);
    }
    if (f.centroCustoCod) {
      const cc = f.centroCustoCod;
      if (Array.isArray(cc)) { if (cc.length) q = q.in("centro_custo_cod", cc); }
      else q = q.eq("centro_custo_cod", cc);
    }
    if (f.contaContabilCod) q = q.eq("conta_contabil_cod", f.contaContabilCod);
    if (f.contaBancariaId)  q = q.eq("conta_bancaria_id", f.contaBancariaId);
    if (f.mesReferencia)    q = q.eq("mes_referencia", f.mesReferencia);
    if (f.dataDe)           q = q.gte("data", f.dataDe);
    if (f.dataAte)          q = q.lte("data", f.dataAte);
  }

  q = q.range(0, RESUMO_CAP - 1);
  const { data, count, error } = await q;
  if (error) throw error;

  type Row = {
    id: string;
    valor: number;
    status: StatusAramburu;
    conta_bancaria_id: string | null;
    centro_custo: { codigo: string; nome: string } | null;
    conta_bancaria: { id: string; nome: string; apelido: string | null } | null;
  };
  const rows = (data ?? []) as unknown as Row[];

  let soma = 0;
  const contas = new Map<string, string>();
  const centros = new Map<string, string>();
  const statuses = new Set<StatusAramburu>();
  for (const r of rows) {
    soma += Number(r.valor);
    if (r.conta_bancaria) contas.set(r.conta_bancaria.id, r.conta_bancaria.apelido ?? r.conta_bancaria.nome);
    if (r.centro_custo) centros.set(r.centro_custo.codigo, r.centro_custo.nome);
    statuses.add(r.status);
  }

  return {
    count: count ?? rows.length,
    soma,
    contas: Array.from(contas, ([id, nome]) => ({ id, nome })),
    centros: Array.from(centros, ([cod, nome]) => ({ cod, nome })),
    statuses: Array.from(statuses),
    capped: (count ?? 0) > rows.length,
  };
}

/**
 * Erro lançado quando uma operação atinge 0 linhas — geralmente RLS bloqueando
 * (usuário sem permissão) ou registro inexistente.
 */
class PermissionOrNotFoundError extends Error {
  constructor(operacao: string) {
    super(
      `Operação não realizada (${operacao}). ` +
      `Provavelmente sua conta não tem permissão (precisa ser admin ou editor). ` +
      `Verifique sua role em public.users no Supabase.`
    );
    this.name = "PermissionOrNotFoundError";
  }
}

export async function criarTransacaoEmpresa(payload: TransacaoEmpresaInsert): Promise<TransacaoEmpresaRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("transacoes_empresa")
    .insert(payload)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new PermissionOrNotFoundError("criar lançamento");
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
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new PermissionOrNotFoundError("atualizar lançamento");
  return data as TransacaoEmpresaRow;
}

export async function deletarTransacaoEmpresa(id: string): Promise<void> {
  const supabase = createClient();
  // Pedimos retorno da row deletada pra confirmar que de fato saiu (RLS pode
  // bloquear silenciosamente — sem erro, mas sem deletar nada).
  const { data, error } = await supabase
    .from("transacoes_empresa")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new PermissionOrNotFoundError("excluir lançamento");
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
