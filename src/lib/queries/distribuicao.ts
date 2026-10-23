// Queries do módulo Distribuição de Lucro (transacoes_socio + repasse global).
// Roda no client (browser) usando @supabase/ssr createBrowserClient.
//
// Fluxo operacional (call 24-jun-2026): a Adriane confere o DETALHADO por sócio,
// marca item a item como "A pagar" e consolida o valor global na empresa
// (Cora → Inter → contas pessoais) via fn_consolidar_repasse_dl.

import { createClient } from "@/lib/supabase/client";
import { obterPapeis } from "@/lib/plano/papeis-client";
import { semCamposDeOrigem } from "./preservar-origem";
import { emLotes } from "./lotes";
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
  /**
   * Competência em "YYYY-MM". Desde 17-ago aceita LISTA (o seletor virou
   * multi-seleção com checkbox); lista vazia = todas as competências.
   */
  mesReferencia?: string | string[];
  // Sócio, classificação e status viraram multi-seleção com checkbox em
  // 04-set-2026 ("idem ao Financeiro"): 1 valor ou lista; lista vazia = todos.
  socioId?: string | string[];
  classificacao?: string | string[];   // "1.01".."1.06"
  status?: StatusDL | StatusDL[];
  /** Conta destino do sócio (contas_bancarias_socio.id) — filtro novo 04-set. */
  contaSocioId?: string | string[];
  search?: string;               // descrição / observação
  // Períodos (23-jul): consulta pela Data do Repasse e/ou pelo Vencimento.
  repasseDe?: string;            // data_vencimento >= (Data do Repasse)
  repasseAte?: string;
  vencimentoDe?: string;         // data_vencimento_despesa >= (Vencimento da fatura)
  vencimentoAte?: string;
  // Faixa de valor em R$ (RF 24-jul — espelha o Financeiro). Em transacoes_socio
  // o valor é sempre positivo, então o gte/lte direto já é a magnitude.
  valorMin?: number;
  valorMax?: number;
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

  if (Array.isArray(filtros.mesReferencia)) {
    if (filtros.mesReferencia.length) q = q.in("mes_referencia", filtros.mesReferencia);
  } else if (filtros.mesReferencia) {
    q = q.eq("mes_referencia", filtros.mesReferencia);
  }
  // eq quando é 1 valor, in quando é lista (vazia = sem filtro) — 04-set.
  const eqOuIn = (col: string, v: string | string[] | undefined) => {
    if (!v) return;
    if (Array.isArray(v)) { if (v.length > 0) q = q.in(col, v); }
    else q = q.eq(col, v);
  };
  eqOuIn("socio_id", filtros.socioId);
  eqOuIn("classificacao_pessoal", filtros.classificacao);
  eqOuIn("status", filtros.status);
  eqOuIn("conta_bancaria_socio_id", filtros.contaSocioId);
  if (filtros.repasseDe)     q = q.gte("data_vencimento", filtros.repasseDe);
  if (filtros.repasseAte)    q = q.lte("data_vencimento", filtros.repasseAte);
  if (filtros.vencimentoDe)  q = q.gte("data_vencimento_despesa", filtros.vencimentoDe);
  if (filtros.vencimentoAte) q = q.lte("data_vencimento_despesa", filtros.vencimentoAte);
  if (filtros.valorMin != null && filtros.valorMin > 0) q = q.gte("valor", filtros.valorMin);
  if (filtros.valorMax != null && filtros.valorMax > 0) q = q.lte("valor", filtros.valorMax);
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
    // Preserva origem_planilha (procedência da importação) — ver preservar-origem.ts.
    .update(semCamposDeOrigem(payload))
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

/**
 * Exclui vários lançamentos detalhados de uma vez (ações em lote — 27-jul,
 * "idem ao Financeiro"). Linhas vinculadas a repasse não são selecionáveis na
 * tela; ainda assim o DELETE só remove o que a RLS permitir.
 */
export async function deletarDetalhadoEmMassa(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const supabase = createClient();
  // Em lotes de 150 ids (04-set): com "Selecionar todos os registros do
  // filtro" a lista pode ter centenas de ids — numa URL só o gateway recusa.
  const partes = await emLotes(ids, async (lote) => {
    const { data, error } = await supabase
      .from("transacoes_socio")
      .delete()
      .in("id", lote)
      .is("repasse_id", null)
      .select("id");
    if (error) throw error;
    return data?.length ?? 0;
  });
  const n = partes.reduce((s, x) => s + x, 0);
  if (n === 0) throw new PermissionOrNotFoundError("excluir lançamentos em massa");
  return n;
}

// Ações em massa da checagem mensal (ela marca vários itens de uma vez e
// aplica o mesmo vencimento — "1 do 7, 1 do 7, 1 do 7").
export async function atualizarDetalhadoEmMassa(
  ids: string[],
  payload: { status?: StatusDL; data_vencimento?: string; data_vencimento_despesa?: string },
): Promise<number> {
  if (ids.length === 0) return 0;
  const supabase = createClient();
  // Em lotes (04-set) — ver deletarDetalhadoEmMassa.
  const partes = await emLotes(ids, async (lote) => {
    const { data, error } = await supabase
      .from("transacoes_socio")
      .update(payload)
      .in("id", lote)
      .select("id");
    if (error) throw error;
    return data?.length ?? 0;
  });
  const n = partes.reduce((s, x) => s + x, 0);
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

/**
 * Resumo consolidado de VÁRIAS competências (17-ago). Lista vazia = o ano
 * inteiro que a view enxerga — é a opção "Todas" do seletor.
 *
 * Soma as linhas da v_dl_mensal_resumo em vez de refazer a conta em cima do
 * detalhado: o número tem que ser o MESMO que a tela mostra com uma
 * competência só selecionada, e a view já é a fonte disso.
 */
export async function obterResumoMeses(meses: string[]): Promise<DlMensalResumoRow | null> {
  const supabase = createClient();
  let q = supabase.from("v_dl_mensal_resumo").select("*");
  if (meses.length) q = q.in("mes_referencia", meses);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as DlMensalResumoRow[];
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0];
  return rows.reduce((acc, r) => ({
    mes_referencia: meses.length === 1 ? meses[0] : "",
    provisionado: acc.provisionado + Number(r.provisionado ?? 0),
    a_pagar: acc.a_pagar + Number(r.a_pagar ?? 0),
    a_pagar_sem_repasse: acc.a_pagar_sem_repasse + Number(r.a_pagar_sem_repasse ?? 0),
    realizado: acc.realizado + Number(r.realizado ?? 0),
    qtd_provisionado: acc.qtd_provisionado + Number(r.qtd_provisionado ?? 0),
    qtd_a_pagar: acc.qtd_a_pagar + Number(r.qtd_a_pagar ?? 0),
    qtd_a_pagar_sem_repasse: acc.qtd_a_pagar_sem_repasse + Number(r.qtd_a_pagar_sem_repasse ?? 0),
    qtd_realizado: acc.qtd_realizado + Number(r.qtd_realizado ?? 0),
  }), {
    mes_referencia: "", provisionado: 0, a_pagar: 0, a_pagar_sem_repasse: 0, realizado: 0,
    qtd_provisionado: 0, qtd_a_pagar: 0, qtd_a_pagar_sem_repasse: 0, qtd_realizado: 0,
  } as DlMensalResumoRow);
}

// Lançamentos globais 2.8 do mês na empresa (para conferência lado a lado).
// Conta e centro da DL vêm do mapa de papéis (dl / dl_lucros — 0066): os nomes
// "2.8"/"2.8.1" nos comentários e campos abaixo são os códigos de hoje.
export interface GlobalEmpresaMes {
  rows: TransacaoEmpresaRow[];  // só o centro 2.8.1 (a DL global)
  provisionadoGlobal: number;   // linhas provisionado/provisionado_dl (valor negativo no banco)
  aPagarGlobal: number;
  realizadoGlobal: number;
  temProvisionadoManual: boolean; // provisionado 2.8 digitado à mão (fora do dl_auto)
  /**
   * Total do CENTRO DE CUSTO 2.8.1 (Distribuição de Lucros) no mês — alimenta
   * o card "Global na empresa (2.8.1)" (ajuste 27-jul: centro em vez da conta).
   */
  totalCentro281: number;
  /** Quantos lançamentos entram no total acima (card 19-ago mostra a contagem). */
  qtdCentro281: number;
}

export async function obterGlobalEmpresaMes(mes: string | string[]): Promise<GlobalEmpresaMes> {
  const supabase = createClient();
  const meses = Array.isArray(mes) ? mes : [mes];
  const papeis = await obterPapeis();
  // Só o centro 2.8.1 — todos os totais abaixo usam apenas ele. O card Global
  // segue a competência e abre em "Todas" (02-out): trazer os demais centros da
  // conta 2.8 (Plano de Saúde etc.) de todos os meses só pesaria a consulta.
  let q = supabase
    .from("transacoes_empresa")
    .select("*")
    .eq("conta_contabil_cod", papeis.dl)
    .eq("centro_custo_cod", papeis.dl_lucros)
    .order("data", { ascending: true });
  if (meses.length) q = q.in("mes_referencia", meses);
  const { data, error } = await q;
  if (error) throw error;

  const rows = (data ?? []) as TransacaoEmpresaRow[];
  let prov = 0, aPagar = 0, realizado = 0, manual = false, centro281 = 0, qtd281 = 0;
  for (const r of rows) {
    // Desde a 0047 a DL global vive no CENTRO 2.8.1 — outros centros da conta
    // 2.8 (ex.: 2.8.3 Plano de Saúde) não entram nos totais nem bloqueiam a
    // sincronização automática (mesma regra do trigger SOMASE corrigido).
    const ehDL = r.centro_custo_cod === papeis.dl_lucros;
    let considerado = false;
    if (r.status === "provisionado" || r.status === "provisionado_dl" || r.status === "provisionado_dv") {
      considerado = true;
      if (ehDL) {
        prov += -r.valor;
        if (!r.origem_planilha?.startsWith("dl_auto:")) manual = true;
      }
    } else if (r.status === "a_pagar" || r.status === "a_repassar") {
      considerado = true;
      if (ehDL) aPagar += -r.valor;
    } else if (r.status === "pago" || r.status === "repassado") {
      considerado = true;
      if (ehDL) realizado += -r.valor;
    }
    if (considerado && ehDL) { centro281 += -r.valor; qtd281 += 1; }
  }
  return {
    rows,
    provisionadoGlobal: prov,
    aPagarGlobal: aPagar,
    realizadoGlobal: realizado,
    temProvisionadoManual: manual,
    totalCentro281: centro281,
    qtdCentro281: qtd281,
  };
}

// Repasses consolidados do mês (globais criados por fn_consolidar_repasse_dl).
export interface RepasseConsolidado extends TransacaoEmpresaRow {
  qtd_detalhados: number;
}

export async function listarRepassesDoMes(mes: string | string[]): Promise<RepasseConsolidado[]> {
  const supabase = createClient();
  const meses = Array.isArray(mes) ? mes : [mes];
  const papeis = await obterPapeis();
  let q = supabase
    .from("transacoes_empresa")
    .select("*")
    .eq("conta_contabil_cod", papeis.dl)
    .like("origem_planilha", "dl_repasse:%")
    .order("created_at", { ascending: true });
  if (meses.length) q = q.in("mes_referencia", meses);
  const { data, error } = await q;
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

export interface ReligarSyncResultado {
  mes: string;
  /** true = a linha provisionada do mês passou a ser mantida pelo sistema. */
  adotou_linha: boolean;
  linha_id: string | null;
  soma_detalhado: number;
  global_depois: number;
  sincronizado: boolean;
}

/**
 * Religa a sincronização automática do Provisionado DL de um mês (migration 0052).
 *
 * O global do Financeiro só acompanha o detalhado enquanto a linha carrega a
 * etiqueta interna `dl_auto:<mês>`. Se ela se perder — ou se a linha tiver sido
 * digitada à mão — o sistema para de sincronizar e não há como reatar pela
 * interface, porque a etiqueta não é campo de formulário. Esta RPC adota a
 * linha provisionada do mês e roda o SOMASE. Recusa (com mensagem) se houver
 * mais de uma candidata no centro 2.8.1.
 */
export async function religarSyncDl(mes: string): Promise<ReligarSyncResultado> {
  const { data, error } = await rpc()("fn_religar_sync_dl", { p_mes: mes });
  if (error) throw new Error(error.message);
  return data as ReligarSyncResultado;
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

/**
 * Todas as contas ATIVAS de todos os sócios — alimenta o filtro "Conta Destino"
 * da DL (04-set-2026). Com sócio(s) marcado(s) no filtro, a tela recorta esta
 * lista pelos `socio_id` escolhidos; sem sócio, mostra todas.
 */
export async function listarContasAtivasSocios(): Promise<ContaBancariaSocioRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("contas_bancarias_socio")
    .select("*")
    .eq("ativa", true)
    .order("ordem", { ascending: true, nullsFirst: false })
    .order("nome");
  if (error) throw error;
  return (data ?? []) as ContaBancariaSocioRow[];
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
