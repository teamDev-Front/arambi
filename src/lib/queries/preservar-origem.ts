/**
 * Proteção da PROCEDÊNCIA dos registros (ajuste 31-jul-2026).
 *
 * `origem_planilha` não é um campo de usuário: é a etiqueta interna que amarra
 * toda a automação do sistema —
 *
 *   • `dl_auto:<AAAA-MM>`            → linha global da Distribuição de Lucro que
 *                                      o trigger SOMASE mantém igual à soma do
 *                                      detalhado (0036/0047);
 *   • `dl_repasse:<uuid>`            → agrupa o repasse consolidado; é o que faz
 *                                      "Desfazer repasse" e "Dar baixa" acharem
 *                                      as três pernas do lançamento (0036/0044);
 *   • `auto:resgate_invest_saida:<id>` → espelho do resgate do Sicredi Invest,
 *                                      que segue a linha da conta corrente (0045);
 *   • `venda_auto:` / `venda_taxa_auto:` → vínculo Vendas ↔ Financeiro (0047);
 *   • `aramburu_mensal:<linha>`      → procedência da importação da planilha.
 *
 * Os formulários montam o payload de gravação com `origem_planilha: null` (o que
 * é correto para um registro NOVO, digitado à mão) e reaproveitam o mesmo objeto
 * no UPDATE. O efeito colateral era grave: **editar um lançamento apagava a
 * etiqueta dele**, transformando uma linha automática em "manual".
 *
 * Foi exatamente isso que travou a sincronização da DL em agosto/2026 — a Adri
 * editou a linha provisionada para lançar os valores reais, a etiqueta
 * `dl_auto:2026-08` se perdeu e o trigger passou a se calar (por segurança ele
 * nunca sobrescreve linha manual), congelando o global em R$ 176.340,97 enquanto
 * o detalhado seguia mudando.
 *
 * Regra a partir daqui: **UPDATE nunca mexe em procedência.** Quem escreve
 * `origem_planilha` é o banco (triggers/RPCs) ou o INSERT que cria o registro.
 */

/** Campos que um UPDATE vindo de formulário jamais deve tocar. */
const CAMPOS_IMUTAVEIS = ["origem_planilha", "created_by"] as const;

/**
 * Remove os campos de procedência de um payload de UPDATE.
 *
 * Só remove a CHAVE — não grava null. No PostgREST, chave ausente = coluna
 * intocada, então a etiqueta original sobrevive à edição.
 */
export function semCamposDeOrigem<T extends object>(payload: T): Partial<T> {
  const copia = { ...payload } as Record<string, unknown>;
  for (const campo of CAMPOS_IMUTAVEIS) delete copia[campo];
  return copia as Partial<T>;
}
