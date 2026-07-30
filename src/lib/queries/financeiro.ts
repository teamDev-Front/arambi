// Queries do módulo Financeiro (transacoes_empresa).
// Roda no client (browser) usando @supabase/ssr createBrowserClient.

import { createClient } from "@/lib/supabase/client";
import { compararCodigo } from "./configuracoes";
import type {
  TransacaoEmpresaRow,
  TransacaoEmpresaInsert,
  TransacaoEmpresaUpdate,
  ClassificacaoFinanceiraRow,
  ContaBancariaEmpresaRow,
  FornecedorRow,
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
  contaContabilCod?: string | string[];  // "2.7" — 1 conta ou lista (multi-seleção)
  centroCustoCod?: string | string[]; // "2.7.2" — string (1) ou lista (multi-seleção)
  contaBancariaId?: string | string[];   // 1 banco ou lista (multi-seleção)
  mesReferencia?: string;           // "YYYY-MM" (legado — relatórios antigos)
  dataDe?: string;                  // vencimento (coluna data)
  dataAte?: string;
  emissaoDe?: string;               // emissão (coluna data_emissao) — UX 23-jul
  emissaoAte?: string;
  /** Filtro por valor (magnitude em R$, ignora o sinal) — UX 23-jul. */
  valorMin?: number;
  valorMax?: number;
  /** Recorte por ids explícitos (ex.: lançamentos TAGUEADOS — RF 24-jul). */
  ids?: string[];
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

// Aplica os filtros da tela a qualquer query builder de transacoes_empresa.
// Tipagem propositalmente frouxa (igual a aplicarEscopo em builders.ts): o filter
// builder do supabase-js encadeia os mesmos métodos retornando o mesmo tipo — a
// interface mínima abaixo basta e evita brigar com as colunas tipadas. Reusado na
// listagem paginada e na exportação para garantir EXATAMENTE o mesmo recorte.
interface QueryFiltravel {
  eq: (col: string, val: unknown) => QueryFiltravel;
  in: (col: string, vals: readonly unknown[]) => QueryFiltravel;
  gte: (col: string, val: unknown) => QueryFiltravel;
  lte: (col: string, val: unknown) => QueryFiltravel;
  or: (filtros: string) => QueryFiltravel;
}

// eq quando é 1 valor, in quando é lista (vazia = sem filtro).
function eqOuIn(r: QueryFiltravel, col: string, v: string | string[] | undefined): QueryFiltravel {
  if (!v) return r;
  if (Array.isArray(v)) return v.length > 0 ? r.in(col, v) : r;
  return r.eq(col, v);
}

function aplicarFiltros<T>(query: T, filtros: ListarTransacoesFiltros): T {
  let r = query as unknown as QueryFiltravel;
  if (filtros.search) {
    const s = filtros.search.replace(/[%_,]/g, " ").trim();
    if (s) r = r.or(`descricao.ilike.%${s}%,fornecedor_nome.ilike.%${s}%,ref.ilike.%${s}%`);
  }
  r = eqOuIn(r, "status", filtros.status);
  r = eqOuIn(r, "centro_custo_cod", filtros.centroCustoCod);
  r = eqOuIn(r, "conta_contabil_cod", filtros.contaContabilCod);
  r = eqOuIn(r, "conta_bancaria_id", filtros.contaBancariaId);
  if (filtros.mesReferencia)     r = r.eq("mes_referencia", filtros.mesReferencia);
  if (filtros.dataDe)            r = r.gte("data", filtros.dataDe);
  if (filtros.dataAte)           r = r.lte("data", filtros.dataAte);
  if (filtros.emissaoDe)         r = r.gte("data_emissao", filtros.emissaoDe);
  if (filtros.emissaoAte)        r = r.lte("data_emissao", filtros.emissaoAte);
  if (filtros.ids) {
    // Lista vazia = recorte vazio (uuid sentinela evita `in ()` inválido).
    r = r.in("id", filtros.ids.length > 0 ? filtros.ids : ["00000000-0000-0000-0000-000000000000"]);
  }
  // Valor por MAGNITUDE (independe de entrada/saída): |valor| entre min e max.
  if (filtros.valorMin != null && filtros.valorMin > 0) {
    r = r.or(`valor.gte.${filtros.valorMin},valor.lte.${-filtros.valorMin}`);
  }
  if (filtros.valorMax != null && filtros.valorMax > 0) {
    r = r.gte("valor", -filtros.valorMax).lte("valor", filtros.valorMax);
  }
  return r as unknown as T;
}

export async function listarTransacoesEmpresa(
  filtros: ListarTransacoesFiltros = {},
  page = 1,
  pageSize = 25,
  sortDir: "asc" | "desc" = "asc",
): Promise<ListarTransacoesResult> {
  const supabase = createClient();

  // Ordem por vencimento — default CRESCENTE (UX-03), invertível pelo clique
  // no cabeçalho "Vencimento" da tela. created_at desempata de forma estável.
  const asc = sortDir === "asc";
  let q = supabase
    .from("transacoes_empresa")
    .select(TRANS_SELECT, { count: "exact" })
    .order("data", { ascending: asc })
    .order("created_at", { ascending: asc });

  q = aplicarFiltros(q, filtros);

  const from = (page - 1) * pageSize;
  q = q.range(from, from + pageSize - 1);

  const { data, count, error } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as TransacaoEmpresaRich[], total: count ?? 0 };
}

// ----------------------------------------------------------------------------
// Exportação (PDF / XLSX) — traz TODAS as linhas do recorte (não paginado).
// Precedência: seleção manual (ids) > filtros aplicados. Limitado a `cap`
// linhas por segurança/performance; `capped` sinaliza truncamento à UI.
// ----------------------------------------------------------------------------
export interface ExportTransacoesResult {
  rows: TransacaoEmpresaRich[];
  total: number;
  capped: boolean;
}

export async function listarTransacoesParaExport(
  opts: { filtros?: ListarTransacoesFiltros; transacaoIds?: string[]; cap?: number } = {},
): Promise<ExportTransacoesResult> {
  const supabase = createClient();
  const cap = opts.cap ?? 5000;

  let q = supabase
    .from("transacoes_empresa")
    .select(TRANS_SELECT, { count: "exact" })
    .order("data", { ascending: true })
    .order("created_at", { ascending: true });

  if (opts.transacaoIds && opts.transacaoIds.length > 0) {
    q = q.in("id", opts.transacaoIds);
  } else {
    q = aplicarFiltros(q, opts.filtros ?? {});
  }
  q = q.range(0, cap - 1);

  const { data, count, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as TransacaoEmpresaRich[];
  return { rows, total: count ?? rows.length, capped: (count ?? 0) > rows.length };
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
    // Mesmo recorte da listagem/exportação (inclui os filtros novos de 23-jul).
    q = aplicarFiltros(q, scope.filtros);
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

// ----------------------------------------------------------------------------
// Indicadores de vencimento (cards do topo da tela Financeiro — ajuste 24-jul)
// Substituem os antigos KPIs "da página": mostram a foto GLOBAL do que está em
// aberto — atrasado, vencendo hoje e o que sai/entra até o fim do mês corrente.
// ----------------------------------------------------------------------------

/** Saídas em aberto (compromissos ainda não realizados) — mesmo recorte da v_kpi_mensal. */
export const STATUS_SAIDA_PENDENTE: StatusAramburu[] = [
  "a_pagar", "a_repassar", "a_aplicar", "provisionado", "provisionado_dl", "provisionado_dv",
];
/** Entradas em aberto — mesmo recorte da v_kpi_mensal. */
export const STATUS_ENTRADA_PENDENTE: StatusAramburu[] = ["a_receber", "a_resgatar"];

export interface IndicadorVencimento {
  qtd: number;
  total: number; // magnitude em R$ (sempre positiva)
}

export interface IndicadoresVencimentos {
  hoje: string;                             // YYYY-MM-DD no fuso LOCAL
  fimDoMes: string;                         // último dia do mês corrente
  emAtraso: IndicadorVencimento;            // saídas em aberto com vencimento < hoje
  vencemHoje: IndicadorVencimento;          // saídas em aberto vencendo hoje
  aPagarAteFimDoMes: IndicadorVencimento;   // saídas em aberto de hoje até o fim do mês
  aReceberAteFimDoMes: IndicadorVencimento; // entradas em aberto até o fim do mês (inclui atrasadas)
}

/** Data em ISO no fuso LOCAL — toISOString() usa UTC e "vira o dia" mais cedo no Brasil. */
function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const INDICADORES_CAP = 10000;

export async function getIndicadoresVencimentos(): Promise<IndicadoresVencimentos> {
  const agora = new Date();
  const hoje = isoLocal(agora);
  const fimDoMes = isoLocal(new Date(agora.getFullYear(), agora.getMonth() + 1, 0));

  const supabase = createClient();
  const { data, error } = await supabase
    .from("transacoes_empresa")
    .select("data, valor, status")
    .in("status", [...STATUS_SAIDA_PENDENTE, ...STATUS_ENTRADA_PENDENTE])
    .lte("data", fimDoMes)
    .range(0, INDICADORES_CAP - 1);
  if (error) throw error;

  const zero = (): IndicadorVencimento => ({ qtd: 0, total: 0 });
  const r: IndicadoresVencimentos = {
    hoje,
    fimDoMes,
    emAtraso: zero(),
    vencemHoje: zero(),
    aPagarAteFimDoMes: zero(),
    aReceberAteFimDoMes: zero(),
  };
  const soma = (ind: IndicadorVencimento, valor: number) => {
    ind.qtd += 1;
    ind.total += Math.abs(valor);
  };

  const rows = (data ?? []) as { data: string; valor: number; status: StatusAramburu }[];
  for (const t of rows) {
    const valor = Number(t.valor);
    if (STATUS_ENTRADA_PENDENTE.includes(t.status)) {
      // Entradas atrasadas não têm card próprio — entram aqui para não sumirem.
      soma(r.aReceberAteFimDoMes, valor);
    } else if (t.data < hoje) {
      soma(r.emAtraso, valor);
    } else {
      soma(r.aPagarAteFimDoMes, valor);
      if (t.data === hoje) soma(r.vencemHoje, valor);
    }
  }
  return r;
}

/**
 * Meses (YYYY-MM) com lançamento na empresa, do menor ao maior, incluindo o mês
 * corrente — alimenta o seletor de Competência do header (ajuste 28-jul).
 * Mesma abordagem O(1) do listarMesesDetalhado da Distribuição.
 */
export async function listarMesesFinanceiro(): Promise<string[]> {
  const supabase = createClient();
  const [minRes, maxRes] = await Promise.all([
    supabase.from("transacoes_empresa").select("data").order("data", { ascending: true }).limit(1).maybeSingle(),
    supabase.from("transacoes_empresa").select("data").order("data", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (minRes.error) throw minRes.error;
  if (maxRes.error) throw maxRes.error;
  const min = (minRes.data?.data as string | undefined)?.slice(0, 7);
  const max = (maxRes.data?.data as string | undefined)?.slice(0, 7);
  const hoje = new Date();
  const mesCorrente = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  if (!min || !max) return [mesCorrente];

  const inicio = min < mesCorrente ? min : mesCorrente;
  const fim = max > mesCorrente ? max : mesCorrente;
  const meses: string[] = [];
  let [y, m] = inicio.split("-").map(Number);
  const [yf, mf] = fim.split("-").map(Number);
  let guard = 0;
  while ((y < yf || (y === yf && m <= mf)) && guard++ < 600) {
    meses.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) { m = 1; y++; }
  }
  return meses;
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

/**
 * Cria vários lançamentos de uma vez (parcelas geradas no cadastro — 23-jul).
 * Um único INSERT: ou grava tudo, ou nada (inclusive se o trigger de resgate
 * do Sicredi bloquear por saldo insuficiente no Invest).
 */
export async function criarTransacoesEmpresaLote(payloads: TransacaoEmpresaInsert[]): Promise<TransacaoEmpresaRow[]> {
  if (payloads.length === 0) return [];
  const supabase = createClient();
  const { data, error } = await supabase
    .from("transacoes_empresa")
    .insert(payloads)
    .select();
  if (error) throw error;
  if (!data || data.length === 0) throw new PermissionOrNotFoundError("criar lançamentos");
  return data as TransacaoEmpresaRow[];
}

/**
 * Muda o status de vários lançamentos de uma vez (seleção múltipla — 23-jul).
 * UPDATE único: atômico (se um lançamento do Sicredi estourar o saldo do
 * Invest, nada muda).
 */
export async function atualizarStatusEmMassa(ids: string[], status: StatusAramburu): Promise<number> {
  if (ids.length === 0) return 0;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("transacoes_empresa")
    .update({ status })
    .in("id", ids)
    .select("id");
  if (error) throw error;
  const n = data?.length ?? 0;
  if (n === 0) throw new PermissionOrNotFoundError("atualizar status em massa");
  return n;
}

/**
 * Exclui vários lançamentos de uma vez (ações em lote — RF 24-jul).
 * DELETE único com retorno dos ids: se RLS bloquear tudo, erra; se bloquear
 * parte, o chamador compara o retorno com o pedido e avisa.
 */
export async function deletarTransacoesEmpresaEmMassa(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("transacoes_empresa")
    .delete()
    .in("id", ids)
    .select("id");
  if (error) throw error;
  const n = data?.length ?? 0;
  if (n === 0) throw new PermissionOrNotFoundError("excluir lançamentos em massa");
  return n;
}

// ----------------------------------------------------------------------------
// "Executar mesmo assim" (migration 0046) — a validação de saldo do Sicredi
// Invest (0044) bloqueia a gravação; quando o usuário confirma no modal, a
// operação é refeita pelas RPCs abaixo, que pulam SÓ essa validação (a RLS de
// escrita continua valendo). O bypass é local da transação — a operação
// seguinte volta a validar normalmente.
// ----------------------------------------------------------------------------

/** Detecta o erro da validação de saldo do Invest (0044). */
export function isErroSaldoInvest(msg: string): boolean {
  return msg.includes("Saldo insuficiente na conta Sicredi Invest");
}

export async function criarTransacoesSemSaldoInvest(payloads: TransacaoEmpresaInsert[]): Promise<void> {
  if (payloads.length === 0) return;
  const supabase = createClient();
  const { error } = await supabase.rpc(
    "fn_criar_transacoes_sem_saldo_invest" as never,
    { p_payloads: payloads } as never,
  );
  if (error) throw error;
}

export async function atualizarTransacaoSemSaldoInvest(
  id: string,
  payload: TransacaoEmpresaUpdate,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc(
    "fn_atualizar_transacao_sem_saldo_invest" as never,
    { p_id: id, p_payload: payload } as never,
  );
  if (error) throw error;
}

export async function atualizarStatusEmMassaSemSaldoInvest(
  ids: string[],
  status: StatusAramburu,
): Promise<number> {
  if (ids.length === 0) return 0;
  const supabase = createClient();
  const { data, error } = await supabase.rpc(
    "fn_status_massa_sem_saldo_invest" as never,
    { p_ids: ids, p_status: status } as never,
  );
  if (error) throw error;
  return (data as unknown as number) ?? 0;
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
    .eq("ativo", true);
  if (error) throw error;
  // Ordena por CÓDIGO (1.1 < 1.1.3 < 1.2 < 2.10) em vez da coluna `ordem`:
  // classificações criadas no Admin ficam com `ordem` NULL e caíam no FIM dos
  // filtros/selects (ajuste 29-jul — "1.1.3 Inter" aparecia depois do 2.9.x).
  return ([...((data ?? []) as ClassificacaoFinanceiraRow[])])
    .sort((a, b) => compararCodigo(a.codigo, b.codigo));
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

/**
 * Fornecedores/prestadores cadastrados (caixa de seleção com busca — 23-jul).
 * A tabela `fornecedores` é o cadastro (deduplicado); os lançamentos guardam
 * fornecedor_id + snapshot do nome.
 */
export async function listarFornecedores(): Promise<FornecedorRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("fornecedores")
    .select("*")
    .eq("ativo", true)
    .order("nome");
  if (error) throw error;
  return (data ?? []) as FornecedorRow[];
}

/**
 * Garante que um fornecedor exista no cadastro e retorna o id — quando a Lola
 * digita um nome novo no lançamento, ele vira cadastro automaticamente.
 * Case-insensitive contra a lista carregada; corrida de UNIQUE(nome) tratada
 * relendo a linha existente.
 *
 * NUNCA lança: se o cadastro falhar (ex.: RLS antes da migration 0044), o
 * lançamento segue apenas com o nome em texto (fornecedor_id = null), como era
 * antes — o cadastro do fornecedor não pode travar o financeiro.
 */
export async function garantirFornecedor(
  nome: string,
  conhecidos: FornecedorRow[],
): Promise<{ id: string; nome: string } | null> {
  const alvo = nome.trim();
  if (!alvo) return null;
  const existente = conhecidos.find((f) => f.nome.trim().toLowerCase() === alvo.toLowerCase());
  if (existente) return { id: existente.id, nome: existente.nome };

  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("fornecedores")
      .insert({ nome: alvo, cnpj: null, apelido: null, observacao: null, ativo: true })
      .select("id, nome")
      .maybeSingle();
    if (!error && data) return data as { id: string; nome: string };

    // Nome já cadastrado (unique) — busca a linha existente.
    const { data: achado } = await supabase
      .from("fornecedores")
      .select("id, nome")
      .ilike("nome", alvo)
      .limit(1)
      .maybeSingle();
    if (achado) return achado as { id: string; nome: string };
    return null;
  } catch {
    return null;
  }
}
