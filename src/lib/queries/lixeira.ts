// Lixeira — itens excluídos guardados por 30 dias (migration 0054).
//
// "caso ela em algum lançamento exclua por acidente e perceba posteriormente
//  que não deveria ter excluído, o item poderá ficar armazenado na lixeira para
//  possível recuperação." (Ana, via documento de 17-ago-2026)
//
// O arquivamento é feito por GATILHO de DELETE no banco: nenhuma tela precisou
// mudar a forma como exclui, e exclusões feitas por script ou SQL manual caem
// na lixeira do mesmo jeito.

import { createClient } from "@/lib/supabase/client";

/** Tabelas cobertas — espelha public.fn_lixeira_tabelas(). */
export const LIXEIRA_TABELA_LABEL: Record<string, string> = {
  transacoes_empresa: "Financeiro",
  transacoes_socio: "Distribuição de Lucro",
  vendas_provisionadas: "Vendas Futuras",
};

export interface LixeiraItem {
  id: string;
  tabela: string;
  registro_id: string;
  resumo: string | null;
  dados: Record<string, unknown>;
  excluido_em: string;
  expira_em: string;
  dias_restantes: number;
  excluido_por_nome: string | null;
}

export interface ListarLixeiraFiltros {
  tabela?: string;
  search?: string;
}

/** true = a migration 0054 ainda não foi aplicada neste banco. */
export function lixeiraIndisponivel(msg: string): boolean {
  return /does not exist|schema cache|find the table|v_lixeira/i.test(msg);
}

export async function listarLixeira(filtros: ListarLixeiraFiltros = {}): Promise<LixeiraItem[]> {
  const supabase = createClient();
  let q = supabase
    .from("v_lixeira")
    .select("*")
    .order("excluido_em", { ascending: false })
    .range(0, 499);
  if (filtros.tabela) q = q.eq("tabela", filtros.tabela);
  if (filtros.search) {
    const s = filtros.search.replace(/[%_,]/g, " ").trim();
    if (s) q = q.ilike("resumo", `%${s}%`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as LixeiraItem[];
}

/** Devolve o item à tabela de origem, com o mesmo id. */
export async function restaurarDaLixeira(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("fn_lixeira_restaurar" as never, { p_id: id } as never);
  if (error) throw error;
}

/** Apaga de vez um item, antes do prazo. */
export async function descartarDaLixeira(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("fn_lixeira_descartar" as never, { p_id: id } as never);
  if (error) throw error;
}

/**
 * Expurga o que passou do prazo. A tela chama ao abrir — é o que substitui um
 * agendador: a lixeira só precisa estar limpa quando alguém a olha.
 */
export async function expurgarLixeira(): Promise<number> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("fn_lixeira_expurgar" as never, {} as never);
  if (error) throw error;
  return (data as unknown as number) ?? 0;
}
