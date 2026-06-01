// Registry central das tools dos assistentes.
// Cada agente_id recebe um subconjunto curado das tools disponíveis —
// o LLM só "enxerga" o que está no array dele.

import { COMMON_TOOLS } from "./common";
import { FINANCEIRO_TOOLS } from "./financeiro";
import { FISCAL_TOOLS } from "./fiscal";
import { ESTOQUE_TOOLS } from "./estoque";
import { OBRA_TOOLS } from "./obra";
import { SAFRA_TOOLS } from "./safra";
import { VENDAS_TOOLS } from "./vendas";
import type { ToolContext, ToolDefinition, ToolExecutionResult } from "./types";

export type { ToolContext, ToolDefinition, ToolExecutionResult } from "./types";
export { publicSchema } from "./types";

/** Constrói uma união de tools indexada pelo nome, sem duplicar referências. */
function unirTools(...listas: ToolDefinition[][]): ToolDefinition[] {
  const map = new Map<string, ToolDefinition>();
  for (const lista of listas) {
    for (const t of lista) {
      if (!map.has(t.name)) map.set(t.name, t);
    }
  }
  return Array.from(map.values());
}

/**
 * Catálogo de tools por agente. Adicionar novo agente = só estender este
 * dicionário e (se quiser) atualizar o system_prompt na migration.
 *
 * Agentes não listados caem no array vazio (nenhuma tool exposta).
 */
const TOOLS_POR_AGENTE: Record<string, ToolDefinition[]> = {
  contabilidade:     unirTools(COMMON_TOOLS, FINANCEIRO_TOOLS),
  "adv-tributarista":unirTools(COMMON_TOOLS, FINANCEIRO_TOOLS),
  "fiscal-notas":    unirTools(COMMON_TOOLS, FISCAL_TOOLS, FINANCEIRO_TOOLS),
  estoque:           unirTools(
                       COMMON_TOOLS,
                       ESTOQUE_TOOLS,
                       SAFRA_TOOLS,    // depósitos / armazéns / cálculo consolidado / parâmetros
                       VENDAS_TOOLS,   // vendas provisionadas (entradas futuras de venda de safra)
                       [
                         // Compras recentes pra investigar reposição
                         ...FINANCEIRO_TOOLS.filter(t =>
                           t.name === "listar_fornecedores" ||
                           t.name === "lancamentos_por_fornecedor"
                         ),
                       ],
                     ),
  "adv-contratual":  unirTools(COMMON_TOOLS, OBRA_TOOLS),
  "adv-trabalhista": unirTools(COMMON_TOOLS),
  "adv-ambiental":   unirTools(COMMON_TOOLS),
};

export function toolsParaAgente(agenteId: string): ToolDefinition[] {
  return TOOLS_POR_AGENTE[agenteId] ?? [];
}

/**
 * Executa uma tool pelo nome — chamada pelo loop de function calling.
 * Captura erros (não joga) e retorna ToolExecutionResult padronizado pra
 * passar ao modelo (que vai ler {ok, error} ou {ok, data}).
 */
export async function executarTool(
  toolset: ToolDefinition[],
  name: string,
  rawArgs: unknown,
  ctx: ToolContext,
): Promise<ToolExecutionResult> {
  const tool = toolset.find(t => t.name === name);
  if (!tool) {
    return { ok: false, error: `Ferramenta desconhecida: "${name}".` };
  }
  const args = (rawArgs && typeof rawArgs === "object")
    ? (rawArgs as Record<string, unknown>)
    : {};
  try {
    const data = await tool.handler(args, ctx);
    return { ok: true, data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
