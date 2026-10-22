// Queries do módulo Estoque/Safra
// Espelha a planilha "Provisionamento Safra 25.25 - Copasul.xlsx".

import { createClient } from "@/lib/supabase/client";
import { semCamposDeOrigem } from "./preservar-origem";
import type {
  ArmazemRow,
  SafraParametrosRow,
  SafraDepositoCalculadoRow,
  SafraDepositoRow,
  CulturaSafra,
  Database,
} from "@/types";

type SpInsert = Database["public"]["Tables"]["safra_parametros"]["Insert"];
type SpUpdate = Database["public"]["Tables"]["safra_parametros"]["Update"];
type SdInsert = Database["public"]["Tables"]["safra_depositos"]["Insert"];
type SdUpdate = Database["public"]["Tables"]["safra_depositos"]["Update"];
type ArmInsert = Database["public"]["Tables"]["armazens"]["Insert"];

// ----------------------------------------------------------------------------
// Armazéns
// ----------------------------------------------------------------------------
export async function listarArmazens(): Promise<ArmazemRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("armazens")
    .select("*")
    .eq("ativo", true)
    .order("ordem", { ascending: true, nullsFirst: false })
    .order("nome");
  if (error) throw error;
  return (data ?? []) as ArmazemRow[];
}

export async function criarArmazem(payload: ArmInsert): Promise<ArmazemRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("armazens").insert(payload).select().maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Falha ao criar armazém");
  return data as ArmazemRow;
}

// ----------------------------------------------------------------------------
// Parâmetros (por armazem × cultura × safra)
// ----------------------------------------------------------------------------
export async function listarParametros(armazemId?: string): Promise<SafraParametrosRow[]> {
  const supabase = createClient();
  let q = supabase.from("safra_parametros").select("*").order("safra");
  if (armazemId) q = q.eq("armazem_id", armazemId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as SafraParametrosRow[];
}

export async function obterParametro(armazemId: string, cultura: CulturaSafra, safra: string): Promise<SafraParametrosRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("safra_parametros")
    .select("*")
    .eq("armazem_id", armazemId)
    .eq("cultura", cultura)
    .eq("safra", safra)
    .maybeSingle();
  if (error) throw error;
  return (data as SafraParametrosRow | null) ?? null;
}

export async function upsertParametro(payload: SpInsert): Promise<SafraParametrosRow> {
  const existente = await obterParametro(payload.armazem_id, payload.cultura, payload.safra);
  const supabase = createClient();
  if (existente) {
    const update: SpUpdate = { ...payload };
    const { data, error } = await supabase
      .from("safra_parametros")
      .update(update)
      .eq("id", existente.id)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Falha ao atualizar parâmetros");
    return data as SafraParametrosRow;
  }
  const { data, error } = await supabase
    .from("safra_parametros")
    .insert(payload)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Falha ao criar parâmetros");
  return data as SafraParametrosRow;
}

/**
 * Safras EFETIVAMENTE cadastradas (com depósito lançado) para um armazém ×
 * cultura — alimenta o seletor de safra sem os "combos fantasma" criados por
 * parâmetros salvos por engano (ajuste 27-jul).
 */
export async function listarSafrasComDeposito(
  armazemId: string,
  cultura: CulturaSafra,
): Promise<string[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("safra_depositos")
    .select("safra")
    .eq("armazem_id", armazemId)
    .eq("cultura", cultura);
  if (error) throw error;
  return Array.from(new Set(((data ?? []) as { safra: string }[]).map((r) => r.safra))).sort();
}

// ----------------------------------------------------------------------------
// Depósitos calculados (view)
// ----------------------------------------------------------------------------
export interface ListarDepositosFiltros {
  armazemId?: string;
  cultura?: CulturaSafra;
  safra?: string;
  status?: import("@/types").SafraDepositoStatus;
  search?: string;
}

export async function listarDepositosCalculados(filtros: ListarDepositosFiltros = {}): Promise<SafraDepositoCalculadoRow[]> {
  const supabase = createClient();
  let q = supabase
    .from("v_safra_depositos_calculado")
    .select("*")
    .order("data_deposito", { ascending: true });

  if (filtros.armazemId) q = q.eq("armazem_id", filtros.armazemId);
  if (filtros.cultura)   q = q.eq("cultura", filtros.cultura);
  if (filtros.safra)     q = q.eq("safra", filtros.safra);
  if (filtros.status)    q = q.eq("status", filtros.status);
  if (filtros.search) {
    const s = filtros.search.replace(/[%_,]/g, " ").trim();
    if (s) q = q.or(`dfe_entrada.ilike.%${s}%,nfp.ilike.%${s}%,observacao.ilike.%${s}%`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as SafraDepositoCalculadoRow[];
}

export async function criarDeposito(payload: SdInsert): Promise<SafraDepositoRow> {
  const supabase = createClient();
  const { error, data } = await supabase
    .from("safra_depositos")
    .insert(payload)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Falha ao criar depósito");
  return data as SafraDepositoRow;
}

/**
 * Linha do depósito na TABELA BASE (não na view calculada) — usada como
 * snapshot do "Desfazer" ao abrir a edição (RF 31-jul).
 */
export async function obterDeposito(id: string): Promise<SafraDepositoRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("safra_depositos").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as SafraDepositoRow | null) ?? null;
}

export async function atualizarDeposito(id: string, payload: SdUpdate): Promise<void> {
  const supabase = createClient();
  const { error, data } = await supabase
    .from("safra_depositos")
    // Preserva origem_planilha (procedência da importação) — ver preservar-origem.ts.
    .update(semCamposDeOrigem(payload))
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Falha ao atualizar depósito");
}

/**
 * Exclui um depósito e DEVOLVE a linha apagada (colunas da tabela base).
 *
 * A listagem da tela vem da view `v_safra_depositos_calculado`, que carrega
 * colunas calculadas (kg líquido, saldo, taxas) inexistentes em
 * `safra_depositos` — reinserir a partir dela quebraria. O retorno do próprio
 * DELETE é o snapshot fiel para o "Desfazer" (RF 31-jul).
 */
export async function deletarDeposito(id: string): Promise<SafraDepositoRow> {
  const supabase = createClient();
  const { error, data } = await supabase
    .from("safra_depositos")
    .delete()
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Depósito não encontrado ou sem permissão");
  return data as SafraDepositoRow;
}

// ----------------------------------------------------------------------------
// Resumo (totais)
// ----------------------------------------------------------------------------
// Desde a migration 0043 (baixa por volume), os totais de cálculo (quebra,
// líquido, taxas, valor de venda) somam apenas o SALDO remanescente de cada
// nota (colunas *_saldo da view) — volume vendido/retirado sai da projeção,
// como a Adriane pediu. kg/sc bruto seguem sendo o total DEPOSITADO.
//
// Sacas viraram a unidade principal da tela (reunião de 20-out): tudo é
// derivado das colunas sc_* da view (kg ÷ kg por saca do parâmetro salvo).
// Sem parâmetro salvo para a cultura × safra, a view devolve kg_por_saca e as
// sacas nulos — aqui contam como 0 e `disponivel` sai false (a tela mostra "—").

/** Quantidades em SACAS de uma nota, derivadas das colunas da view. */
export interface SacasDeposito {
  /** false = cultura × safra sem parâmetros salvos (kg por saca nulo). */
  disponivel: boolean;
  /** Bruto depositado — referência fixa, não muda com vendas e saídas. */
  inicial: number;
  /** Saídas (vendas, retiradas, perdas, quebra técnica) = sc_bruto − sc_saldo. */
  baixadas: number;
  /** Saldo remanescente da nota. */
  saldo: number;
  /** Quebra técnica do saldo — venda a terceiros (sc_saldo − sc_liquida_saldo). */
  quebra: number;
  /** Saldo líquido — venda a terceiros. */
  liquida: number;
  /** Quebra técnica do saldo — venda ao próprio armazém. */
  quebraArmazem: number;
  /** Saldo líquido — venda ao próprio armazém. */
  liquidaArmazem: number;
}

export function sacasDoDeposito(r: SafraDepositoCalculadoRow): SacasDeposito {
  const n = (v: number | null | undefined): number => Number(v ?? 0) || 0;
  // Fallbacks: colunas totais, caso a migration 0043 ainda não esteja aplicada.
  const inicial = n(r.sc_bruto);
  const saldo = n(r.sc_saldo ?? r.sc_bruto);
  const liquida = n(r.sc_liquida_saldo ?? r.sc_liquida);
  const liquidaArmazem = n(r.sc_liquida_saldo_armazem ?? r.sc_liquida_armazem);
  return {
    disponivel: n(r.kg_por_saca) > 0,
    inicial,
    // max(…, 0): as sacas vêm arredondadas por nota na view (4 casas).
    baixadas: Math.max(inicial - saldo, 0),
    saldo,
    quebra: Math.max(saldo - liquida, 0),
    liquida,
    quebraArmazem: Math.max(saldo - liquidaArmazem, 0),
    liquidaArmazem,
  };
}

export interface SafraResumo {
  qtd_depositos: number;
  /** Notas sem parâmetros salvos (kg por saca nulo) — ficam fora das somas em sacas. */
  qtd_sem_parametro: number;
  total_kg_bruto: number;
  total_kg_liquido: number;
  total_sc_bruto: number;
  total_sc_liquida: number;
  total_kg_baixado: number;
  total_kg_saldo: number;
  total_sc_saldo: number;
  /** Sacas que saíram do estoque (vendas e baixas) = Σ(sc_bruto − sc_saldo). */
  total_sc_baixado: number;
  total_quebra_kg: number;
  /** Quebra técnica do saldo em sacas — venda a terceiros. */
  total_quebra_sc: number;
  total_taxa_armazenagem: number;
  total_taxa_devolucao: number;
  total_taxa_recepcao: number;
  total_a_descontar: number;
  total_valor_venda: number;
  saldo_a_receber: number;
  // Cenário "venda ao próprio armazém" (carência longa — migration 0037)
  armazem_total_kg_liquido: number;
  armazem_total_sc_liquida: number;
  armazem_total_quebra_kg: number;
  /** Quebra técnica do saldo em sacas — venda ao próprio armazém. */
  armazem_total_quebra_sc: number;
  armazem_total_taxa_armazenagem: number;
  armazem_total_a_descontar: number;
  armazem_total_valor_venda: number;
  armazem_saldo_a_receber: number;
  /** Sacas depositadas por data (bruto e líquido do depósito — gráfico da tela). */
  por_data_deposito: Array<{ data: string; sc_bruto: number; sc_liquido: number }>;
}

export function calcularResumoSafra(rows: SafraDepositoCalculadoRow[]): SafraResumo {
  let kg_bruto = 0, kg_liquido = 0, sc_bruto = 0, sc_liquida = 0;
  let kg_baixado = 0, kg_saldo = 0, sc_saldo = 0;
  let sc_baixado = 0, quebra_sc = 0, a_quebra_sc = 0, sem_parametro = 0;
  let quebra_kg = 0, taxa_armaz = 0, taxa_dev = 0, taxa_recep = 0, descontar = 0, venda = 0;
  let a_kg_liq = 0, a_sc_liq = 0, a_quebra = 0, a_armaz = 0, a_descontar = 0, a_venda = 0;
  const aggDay = new Map<string, { sc_bruto: number; sc_liquido: number }>();

  for (const r of rows) {
    kg_bruto += Number(r.kg_bruto);
    sc_bruto += Number(r.sc_bruto);
    kg_baixado += Number(r.kg_baixado ?? 0);
    kg_saldo += Number(r.kg_saldo ?? r.kg_bruto);
    sc_saldo += Number(r.sc_saldo ?? r.sc_bruto);

    const sc = sacasDoDeposito(r);
    if (!sc.disponivel) sem_parametro++;
    sc_baixado += sc.baixadas;
    quebra_sc += sc.quebra;
    a_quebra_sc += sc.quebraArmazem;

    // Projeção sobre o saldo remanescente (fallback: colunas totais, caso a
    // migration 0043 ainda não esteja aplicada — comporta-se como antes).
    kg_liquido += Number(r.kg_liquido_saldo ?? r.kg_liquido);
    sc_liquida += Number(r.sc_liquida_saldo ?? r.sc_liquida);
    quebra_kg += Number(r.quebra_kg_saldo ?? r.quebra_kg);
    taxa_armaz += Number(r.taxa_armazenagem_saldo ?? r.taxa_armazenagem);
    taxa_dev += Number(r.taxa_devolucao_saldo ?? r.taxa_devolucao);
    taxa_recep += Number(r.taxa_recepcao_saldo ?? r.taxa_recepcao ?? 0);
    descontar += Number(r.total_a_descontar_saldo ?? r.total_a_descontar);
    venda += Number(r.valor_venda_saldo ?? r.valor_venda_simulado);

    a_kg_liq += Number(r.kg_liquido_saldo_armazem ?? r.kg_liquido_armazem ?? 0);
    a_sc_liq += Number(r.sc_liquida_saldo_armazem ?? r.sc_liquida_armazem ?? 0);
    a_quebra += Number(r.quebra_kg_saldo_armazem ?? r.quebra_kg_armazem ?? 0);
    a_armaz += Number(r.taxa_armazenagem_saldo_armazem ?? r.taxa_armazenagem_armazem ?? 0);
    a_descontar += Number(r.total_a_descontar_saldo_armazem ?? r.total_a_descontar_armazem ?? 0);
    a_venda += Number(r.valor_venda_saldo_armazem ?? r.valor_venda_armazem ?? 0);

    const k = r.data_deposito;
    const ex = aggDay.get(k) ?? { sc_bruto: 0, sc_liquido: 0 };
    ex.sc_bruto += Number(r.sc_bruto ?? 0);
    ex.sc_liquido += Number(r.sc_liquida ?? 0);
    aggDay.set(k, ex);
  }

  return {
    qtd_depositos: rows.length,
    qtd_sem_parametro: sem_parametro,
    total_kg_bruto: kg_bruto,
    total_kg_liquido: kg_liquido,
    total_sc_bruto: sc_bruto,
    total_sc_liquida: sc_liquida,
    total_kg_baixado: kg_baixado,
    total_kg_saldo: kg_saldo,
    total_sc_saldo: sc_saldo,
    total_sc_baixado: sc_baixado,
    total_quebra_kg: quebra_kg,
    total_quebra_sc: quebra_sc,
    total_taxa_armazenagem: taxa_armaz,
    total_taxa_devolucao: taxa_dev,
    total_taxa_recepcao: taxa_recep,
    total_a_descontar: descontar,
    total_valor_venda: venda,
    saldo_a_receber: venda - descontar,
    armazem_total_kg_liquido: a_kg_liq,
    armazem_total_sc_liquida: a_sc_liq,
    armazem_total_quebra_kg: a_quebra,
    armazem_total_quebra_sc: a_quebra_sc,
    armazem_total_taxa_armazenagem: a_armaz,
    armazem_total_a_descontar: a_descontar,
    armazem_total_valor_venda: a_venda,
    armazem_saldo_a_receber: a_venda - a_descontar,
    por_data_deposito: Array.from(aggDay, ([data, v]) => ({ data, ...v })).sort((a, b) => a.data.localeCompare(b.data)),
  };
}

// ----------------------------------------------------------------------------
// Baixa de estoque por volume — FIFO (migration 0043)
// ----------------------------------------------------------------------------
// O Database type mantém Functions frouxo (ver comentário em types/database.ts),
// então as RPCs são chamadas por um wrapper mínimo tipado aqui (mesmo padrão
// de queries/distribuicao.ts).
type RpcCall = (
  fn: string,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

function rpc(): RpcCall {
  const supabase = createClient();
  return supabase.rpc.bind(supabase) as unknown as RpcCall;
}

export interface BaixaFifoNota {
  /** id da linha em safra_baixas — alimenta o Desfazer (migration 0051). */
  baixa_id?: string;
  deposito_id: string;
  dfe: string | null;
  nfp: string | null;
  kg: number;
  restante_na_nota: number;
  consumo_total: boolean;
}

export interface BaixaFifoResultado {
  kg_solicitado: number;
  kg_baixado: number;
  saldo_restante_kg: number;
  notas_baixadas_total: number;
  notas_parciais: number;
  notas: BaixaFifoNota[];
}

/** Dá baixa de um volume no estoque da cultura×safra (FIFO — notas mais antigas primeiro). */
export async function baixarEstoqueFifo(params: {
  cultura: CulturaSafra;
  safra: string;
  kg: number;
  data?: string;
  vendaId?: string;
  armazemId?: string;
  motivo?: "venda" | "retirada" | "perda" | "quebra_tecnica";
  observacao?: string;
}): Promise<BaixaFifoResultado> {
  const { data, error } = await rpc()("fn_baixar_estoque_fifo", {
    p_cultura: params.cultura,
    p_safra: params.safra,
    p_kg: params.kg,
    p_data: params.data ?? new Date().toISOString().slice(0, 10),
    p_venda_id: params.vendaId ?? null,
    p_armazem_id: params.armazemId ?? null,
    p_motivo: params.motivo ?? "venda",
    p_observacao: params.observacao ?? null,
  });
  if (error) throw new Error(error.message);
  return data as BaixaFifoResultado;
}

/** Desfaz as baixas de uma venda (volume volta ao estoque). Retorna o nº de baixas removidas. */
export async function desfazerBaixasVenda(vendaId: string): Promise<number> {
  const { data, error } = await rpc()("fn_desfazer_baixas_venda", { p_venda_id: vendaId });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/**
 * Zera o saldo residual de uma cultura×safra lançando baixas por QUEBRA TÉCNICA
 * (migration 0051).
 *
 * Serve para o caso em que 100% do estoque já foi comercializado mas sobra um
 * resíduo: as notas guardam o peso BRUTO depositado e o armazém fixa o peso
 * LÍQUIDO, então a quebra real apurada por ele fica presa no estoque. O bruto
 * depositado continua íntegro — a saída vira histórico em safra_baixas.
 *
 * Não recebe quantidade: o banco mede o saldo sob lock e baixa exatamente ele,
 * evitando divergir do que a tela mostrava.
 */
export async function zerarSaldoQuebra(params: {
  cultura: CulturaSafra;
  safra: string;
  armazemId?: string;
  data?: string;
  observacao?: string;
}): Promise<BaixaFifoResultado> {
  const { data, error } = await rpc()("fn_zerar_saldo_quebra", {
    p_cultura: params.cultura,
    p_safra: params.safra,
    p_armazem_id: params.armazemId ?? null,
    p_data: params.data ?? new Date().toISOString().slice(0, 10),
    p_observacao: params.observacao ?? null,
  });
  if (error) throw new Error(error.message);
  return data as BaixaFifoResultado;
}

/** Desfaz baixas avulsas por id (volume volta ao estoque). Retorna o nº removido. */
export async function desfazerBaixas(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { data, error } = await rpc()("fn_desfazer_baixas", { p_ids: ids });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export interface SaldoEstoque {
  kg: number;
  sacas: number;
  notas: number;
}

/** Saldo em estoque (kg remanescente) de uma cultura×safra, somado da view calculada. */
export async function obterSaldoEstoque(cultura: CulturaSafra, safra: string): Promise<SaldoEstoque> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("v_safra_depositos_calculado")
    .select("kg_saldo, sc_saldo")
    .eq("cultura", cultura)
    .eq("safra", safra);
  if (error) throw error;
  let kg = 0, sacas = 0, notas = 0;
  for (const r of (data ?? []) as Array<{ kg_saldo: number | null; sc_saldo: number | null }>) {
    const s = Number(r.kg_saldo ?? 0);
    if (s > 0) {
      kg += s;
      sacas += Number(r.sc_saldo ?? 0);
      notas++;
    }
  }
  return { kg, sacas, notas };
}

/** kg baixado agregado por venda (para indicadores na tela de Vendas). */
export async function listarKgBaixadoPorVenda(): Promise<Map<string, number>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("safra_baixas")
    .select("venda_id, kg")
    .not("venda_id", "is", null);
  if (error) {
    // Tabela ainda não existe (migration 0043 não aplicada) → sem indicadores.
    if (/does not exist|schema cache|find the table/i.test(error.message)) return new Map();
    throw error;
  }
  const m = new Map<string, number>();
  for (const r of (data ?? []) as Array<{ venda_id: string; kg: number }>) {
    m.set(r.venda_id, (m.get(r.venda_id) ?? 0) + Number(r.kg));
  }
  return m;
}
