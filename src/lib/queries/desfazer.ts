/**
 * Ações compensatórias do "Desfazer ação" (RF 31-jul-2026).
 *
 * A gravação acontece na hora; o botão "Desfazer" do toast executa o INVERSO
 * durante 8 segundos. Adiar a escrita (como o Gmail faz com o envio) seria
 * arriscado aqui: fechar a aba antes do prazo perderia o lançamento.
 *
 *   criar    → desfazerCriacao   (apaga o que acabou de nascer)
 *   editar   → desfazerEdicao    (regrava o snapshot anterior)
 *   excluir  → desfazerExclusao  (reinsere a linha com o MESMO id)
 *
 * Reinserir com o mesmo id preserva quem apontava para o registro por FK
 * `on delete set null` — mas os ponteiros já foram zerados pelo DELETE e o
 * banco não os reconstrói. Por isso as telas não oferecem desfazer em exclusões
 * de registros que carregam vínculo vivo (repasse consolidado, venda com baixa
 * de estoque): nesses casos existe fluxo próprio ("Desfazer repasse").
 */

import { createClient } from "@/lib/supabase/client";

/** Tabelas cobertas pelo desfazer. */
export type TabelaDesfazivel =
  | "transacoes_empresa"
  | "transacoes_socio"
  | "vendas_provisionadas"
  | "safra_depositos"
  | "documentos"
  | "animais_lotes"
  | "animais_eventos"
  | "maquinario_equipamentos"
  | "maquinario_manutencoes"
  | "horta_ciclos"
  | "obra_lts";

/**
 * Colunas que o banco calcula/gera sozinho — nunca vão num INSERT/UPDATE de
 * restauração (`mes_referencia` é GENERATED ALWAYS e recusa escrita).
 */
const COLUNAS_GERADAS = ["mes_referencia", "updated_at"] as const;

type Linha = Record<string, unknown>;

/**
 * Snapshot de uma linha do banco. Aceita as linhas "ricas" das telas (com joins)
 * — interfaces do TS não têm index signature, por isso o tipo público é `object`
 * e a conversão para mapa acontece aqui dentro.
 */
export type Snapshot = object;

const comoLinha = (s: Snapshot): Linha => s as Linha;

/**
 * Prepara uma linha para reinserção/regravação.
 *
 * As telas guardam a linha "rica" (com os joins de conta contábil, centro de
 * custo, banco, sócio…). Esses objetos aninhados não são colunas da tabela e
 * fariam o PostgREST recusar a escrita — então tudo que for objeto sai junto
 * com as colunas geradas pelo banco.
 */
function limpar(row: Linha, tambemId: boolean): Linha {
  const copia: Linha = {};
  for (const [chave, valor] of Object.entries(row)) {
    if (valor !== null && typeof valor === "object") continue; // join do select
    copia[chave] = valor;
  }
  for (const c of COLUNAS_GERADAS) delete copia[c];
  if (tambemId) { delete copia.id; delete copia.created_at; }
  return copia;
}

/** Client tipado de forma frouxa: as tabelas são resolvidas em runtime. */
function tabela(nome: TabelaDesfazivel) {
  return createClient().from(nome as never);
}

/** Desfaz uma CRIAÇÃO: apaga os ids recém-criados. */
export async function desfazerCriacao(nome: TabelaDesfazivel, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await tabela(nome).delete().in("id", ids);
  if (error) throw new Error(error.message);
}

/**
 * Desfaz uma EDIÇÃO: regrava o snapshot capturado antes de salvar.
 * `anterior` é a linha completa como veio do banco (o SELECT da listagem).
 */
export async function desfazerEdicao(nome: TabelaDesfazivel, snapshot: Snapshot): Promise<void> {
  const anterior = comoLinha(snapshot);
  const id = anterior.id as string | undefined;
  if (!id) throw new Error("Snapshot sem id — não é possível restaurar.");
  const { error } = await tabela(nome)
    .update(limpar(anterior, true) as never)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Desfaz uma EXCLUSÃO: reinsere as linhas apagadas preservando o id. */
export async function desfazerExclusao(nome: TabelaDesfazivel, linhas: Snapshot[]): Promise<void> {
  if (linhas.length === 0) return;
  const { error } = await tabela(nome)
    .insert(linhas.map((l) => limpar(comoLinha(l), false)) as never);
  if (error) throw new Error(error.message);
}

/**
 * Desfaz uma mudança de STATUS em massa: devolve cada id ao status que tinha.
 * Agrupa por status para fazer 1 UPDATE por status distinto, não 1 por linha.
 */
export async function desfazerStatusEmMassa(
  nome: TabelaDesfazivel,
  anteriores: Array<{ id: string; status: string }>,
): Promise<void> {
  if (anteriores.length === 0) return;
  const porStatus = new Map<string, string[]>();
  for (const a of anteriores) {
    const lista = porStatus.get(a.status) ?? [];
    lista.push(a.id);
    porStatus.set(a.status, lista);
  }
  for (const [status, ids] of porStatus) {
    const { error } = await tabela(nome).update({ status } as never).in("id", ids);
    if (error) throw new Error(error.message);
  }
}
