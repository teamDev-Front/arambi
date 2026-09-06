// Fatiamento de listas de ids para as chamadas `.in("id", ids)` do PostgREST.
//
// O filtro `in` vai na URL da requisição. Até 04-set-2026 as ações em massa
// mandavam a seleção inteira de uma vez — o que nunca doeu porque a seleção
// era feita página a página (25 por vez). Com "Selecionar todos os registros do
// filtro" a seleção pode ter centenas ou milhares de ids, e uma URL com mil
// uuids (~38 KB) é recusada pelo gateway antes de chegar ao banco. Aqui cada
// lote fica em torno de 6 KB.

export const TAMANHO_LOTE_IDS = 150;

/** Divide `itens` em fatias de até `tamanho` elementos (ordem preservada). */
export function fatiar<T>(itens: T[], tamanho = TAMANHO_LOTE_IDS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) out.push(itens.slice(i, i + tamanho));
  return out;
}

/**
 * Roda `fn` para cada fatia, EM SEQUÊNCIA (não em paralelo: as ações em massa
 * disparam triggers pesados no banco — resgate-espelho, SOMASE da DL — e
 * paralelizar só aumentaria a chance de deadlock). Devolve os resultados na
 * ordem das fatias.
 */
export async function emLotes<T, R>(
  itens: T[],
  fn: (lote: T[]) => Promise<R>,
  tamanho = TAMANHO_LOTE_IDS,
): Promise<R[]> {
  const resultados: R[] = [];
  for (const lote of fatiar(itens, tamanho)) resultados.push(await fn(lote));
  return resultados;
}
