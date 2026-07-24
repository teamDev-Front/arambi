// Queries do módulo Distribuição de Lucro (transacoes_socio + repasse global).
// Roda no client (browser) usando @supabase/ssr createBrowserClient.
//
// Fluxo operacional (call 24-jun-2026): a Adriane confere o DETALHADO por sócio,
// marca item a item como "A pagar" e consolida o valor global na empresa
// (Cora → Inter → contas pessoais) via fn_consolidar_repasse_dl.

import { createClient } from "@/lib/supabase/client";
import type {
  TransacaoSocioRow,
  TransacaoSocioInsert,
  TransacaoSocioUpdate,
  SocioRow,
  ClassificacaoPessoalRow,
  ContaBancariaSocioRow,
  TransacaoEmpresaRow,
  DlMensalResumoRow,
  StatusDL,
} from "@/types";

// Linha enriquecida com joins (sócio, classificação, conta destino).
export interface TransacaoSocioRich extends TransacaoSocioRow {
  socio?: { id: string; nome_completo: string; apelido: string | null } | null;
  classificacao?: { codigo: string; nome: string } | null;
  conta_bancaria_socio?: { id: string; nome: string; banco: string | null } | null;
}

const TS_SELECT = `
  *,
  socio:socios(id, nome_completo, apelido),
  classificacao:classificacao_pessoal(codigo, nome),
  conta_bancaria_socio:contas_bancarias_socio(id, nome, banco)
`;

export interface ListarDetalhadoFiltros {
  mesReferencia?: string;        // "YYYY-MM" (competência — opcional desde 23-jul)
  socioId?: string;
  classificacao?: string;        // "1.01".."1.06"
  status?: StatusDL;
  search?: string;               // descrição / observação
  // Períodos (23-jul): consulta pela Data do Repasse e/ou pelo Vencimento.
  repasseDe?: string;            // data_vencimento >= (Data do Repasse)
  repasseAte?: string;
  vencimentoDe?: string;         // data_vencimento_despesa >= (Vencimento da fatura)
  vencimentoAte?: string;
}

class PermissionOrNotFoundError extends Error {
  constructor(operacao: string) {
    super(
      `Operação não realizada (${operacao}). ` +
      `Provavelmente sua conta não tem permissão (precisa ser admin ou editor).`
    );
    this.name = "PermissionOrNotFoundError";
  }
}

export async function listarDetalhado(
  filtros: ListarDetalhadoFiltros = {},
): Promise<TransacaoSocioRich[]> {
  const supabase = createClient();
  let q = supabase
    .from("transacoes_socio")
    .select(TS_SELECT)
    .order("data_vencimento", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (filtros.mesReferencia) q = q.eq("mes_referencia", filtros.mesReferencia);
  if (filtros.socioId)       q = q.eq("socio_id", filtros.socioId);
  if (filtros.classificacao) q = q.eq("classificacao_pessoal", filtros.classificacao);
  if (filtros.status)        q = q.eq("status", filtros.status);
  if (filtros.repasseDe)     q = q.gte("data_vencimento", filtros.repasseDe);
  if (filtros.repasseAte)    q = q.lte("data_vencimento", filtros.repasseAte);
  if (filtros.vencimentoDe)  q = q.gte("data_vencimento_despesa", filtros.vencimentoDe);
  if (filtros.vencimentoAte) q = q.lte("data_vencimento_despesa", filtros.vencimentoAte);
  if (filtros.search) {
    const s = filtros.search.replace(/[%_,]/g, " ").trim();
    if (s) q = q.or(`descricao.ilike.%${s}%,observacao.ilike.%${s}%`);
  }

  const { data, error } = await q.range(0, 1999);
  if (error) throw error;
  return (data ?? []) as unknown as TransacaoSocioRich[];
}

export async function criarDetalhado(payload: TransacaoSocioInsert): Promise<TransacaoSocioRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("transacoes_socio")
    .insert(payload)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new PermissionOrNotFoundError("criar lançamento detalhado");
  return data as TransacaoSocioRow;
}

export async function atualizarDetalhado(
  id: string,
  payload: TransacaoSocioUpdate,
): Promise<TransacaoSocioRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("transacoes_socio")
    .update(payload)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new PermissionOrNotFoundError("atualizar lançamento detalhado");
  return data as TransacaoSocioRow;
}

export async function deletarDetalhado(id: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("transacoes_socio")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new PermissionOrNotFoundError("excluir lançamento detalhado");
}

// Ações em massa da checagem mensal (ela marca vários itens de uma vez e
// aplica o mesmo vencimento — "1 do 7, 1 do 7, 1 do 7").
export async function atualizarDetalhadoEmMassa(
  ids: string[],
  payload: { status?: StatusDL; data_vencimento?: string; data_vencimento_despesa?: string },
): Promise<number> {
  if (ids.length === 0) return 0;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("transacoes_socio")
    .update(payload)
    .in("id", ids)
    .select("id");
  if (error) throw error;
  const n = data?.length ?? 0;
  if (n === 0) throw new PermissionOrNotFoundError("atualizar lançamentos em massa");
  return n;
}

// ----------------------------------------------------------------------------
// Resumo mensal (SOMASE por status) + conferência com o global da empresa
// ----------------------------------------------------------------------------
export async function obterResumoMensal(mes: string): Promise<DlMensalResumoRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("v_dl_mensal_resumo")
    .select("*")
    .eq("mes_referencia", mes)
    .maybeSingle();
  if (error) throw error;
  return (data as DlMensalResumoRow | null) ?? null;
}

// Lançamentos globais 2.8 do mês na empresa (para conferência lado a lado).
export interface GlobalEmpresaMes {
  rows: TransacaoEmpresaRow[];
  provisionadoGlobal: number;   // linhas provisionado/provisionado_dl (valor negativo no banco)
  aPagarGlobal: number;
  realizadoGlobal: number;
  temProvisionadoManual: boolean; // provisionado 2.8 digitado à mão (fora do dl_auto)
}

export async function obterGlobalEmpresaMes(mes: string): Promise<GlobalEmpresaMes> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("transacoes_empresa")
    .select("*")
    .eq("mes_referencia", mes)
    .eq("conta_contabil_cod", "2.8")
    .order("data", { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as TransacaoEmpresaRow[];
  let prov = 0, aPagar = 0, realizado = 0, manual = false;
  for (const r of rows) {
    if (r.status === "provisionado" || r.status === "provisionado_dl" || r.status === "provisionado_dv") {
      prov += -r.valor;
      if (!r.origem_planilha?.startsWith("dl_auto:")) manual = true;
    } else if (r.status === "a_pagar" || r.status === "a_repassar") {
      aPagar += -r.valor;
    } else if (r.status === "pago" || r.status === "repassado") {
      realizado += -r.valor;
    }
  }
  return { rows, provisionadoGlobal: prov, aPagarGlobal: aPagar, realizadoGlobal: realizado, temProvisionadoManual: manual };
}

// Repasses consolidados do mês (globais criados por fn_consolidar_repasse_dl).
export interface RepasseConsolidado extends TransacaoEmpresaRow {
  qtd_detalhados: number;
}

export async function listarRepassesDoMes(mes: string): Promise<RepasseConsolidado[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("transacoes_empresa")
    .select("*")
    .eq("mes_referencia", mes)
    .eq("conta_contabil_cod", "2.8")
    .like("origem_planilha", "dl_repasse:%")
    .order("created_at", { ascending: true });
  if (error) throw error;
  const globais = (data ?? []) as TransacaoEmpresaRow[];
  if (globais.length === 0) return [];

  const { data: vinc, error: e2 } = await supabase
    .from("transacoes_socio")
    .select("repasse_id")
    .in("repasse_id", globais.map((g) => g.id));
  if (e2) throw e2;
  const contagem = new Map<string, number>();
  for (const v of (vinc ?? []) as { repasse_id: string | null }[]) {
    if (v.repasse_id) contagem.set(v.repasse_id, (contagem.get(v.repasse_id) ?? 0) + 1);
  }
  return globais.map((g) => ({ ...g, qtd_detalhados: contagem.get(g.id) ?? 0 }));
}

// ----------------------------------------------------------------------------
// Consolidação / desfazer / concluir (funções atômicas no Postgres — 0036)
// ----------------------------------------------------------------------------
// O Database type mantém Functions frouxo (ver comentário em types/database.ts),
// então chamamos as RPCs por um wrapper mínimo tipado aqui.
type RpcCall = (
  fn: string,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

function rpc(): RpcCall {
  const supabase = createClient();
  return supabase.rpc.bind(supabase) as unknown as RpcCall;
}

export async function consolidarRepasse(
  mes: string,
  dataRepasse: string,
  incluirTransferencia: boolean,
): Promise<string> {
  const { data, error } = await rpc()("fn_consolidar_repasse_dl", {
    p_mes: mes,
    p_data: dataRepasse,
    p_incluir_transferencia: incluirTransferencia,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function desfazerRepasse(repasseId: string): Promise<void> {
  const { error } = await rpc()("fn_desfazer_repasse_dl", { p_repasse_id: repasseId });
  if (error) throw new Error(error.message);
}

export async function concluirRepasse(repasseId: string): Promise<void> {
  const { error } = await rpc()("fn_concluir_repasse_dl", { p_repasse_id: repasseId });
  if (error) throw new Error(error.message);
}

// ----------------------------------------------------------------------------
// Lookups
// ----------------------------------------------------------------------------
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

export async function listarClassificacoesPessoais(): Promise<ClassificacaoPessoalRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("classificacao_pessoal")
    .select("*")
    .eq("ativo", true)
    .order("ordem");
  if (error) throw error;
  return (data ?? []) as ClassificacaoPessoalRow[];
}

export async function listarContasDoSocio(socioId: string): Promise<ContaBancariaSocioRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("contas_bancarias_socio")
    .select("*")
    .eq("socio_id", socioId)
    .eq("ativa", true)
    .order("ordem", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as ContaBancariaSocioRow[];
}

/**
 * Meses (YYYY-MM) com lançamento detalhado, do menor ao maior, incluindo o mês
 * corrente — mesma abordagem O(1) do Financeiro (duas queries min/max).
 */
export async function listarMesesDetalhado(): Promise<string[]> {
  const supabase = createClient();
  const [minRes, maxRes] = await Promise.all([
    supabase.from("transacoes_socio").select("data").order("data", { ascending: true }).limit(1).maybeSingle(),
    supabase.from("transacoes_socio").select("data").order("data", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (minRes.error) throw minRes.error;
  if (maxRes.error) throw maxRes.error;
  const min = minRes.data?.data as string | undefined;
  const max = maxRes.data?.data as string | undefined;
  const hoje = new Date();
  const mesCorrente = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  if (!min || !max) return [mesCorrente];

  const inicio = min.slice(0, 7) < mesCorrente ? min.slice(0, 7) : mesCorrente;
  const fim = max.slice(0, 7) > mesCorrente ? max.slice(0, 7) : mesCorrente;
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
