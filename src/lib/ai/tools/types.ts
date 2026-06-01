// Contratos para o sistema de tools (function calling) dos assistentes.
// As tools são executadas SERVER-SIDE com o admin client (bypass RLS).
// Cada tool é read-only e tem um nome único, descrição (lida pelo LLM),
// schema JSON dos parâmetros e um handler que retorna JSON-serializável.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type AdminClient = SupabaseClient<Database>;

export interface ToolContext {
  admin: AdminClient;
  userId: string;        // quem está conversando — útil para tools que filtram por dono
}

/** JSON Schema (subset OpenAPI 3.0) aceito por Gemini e OpenAI. */
export type ToolJsonSchema = {
  type: "object";
  properties: Record<string, ToolParamSchema>;
  required?: string[];
  additionalProperties?: false;
};

export type ToolParamSchema =
  | { type: "string"; description?: string; enum?: string[] }
  | { type: "number"; description?: string; minimum?: number; maximum?: number }
  | { type: "integer"; description?: string; minimum?: number; maximum?: number }
  | { type: "boolean"; description?: string }
  | { type: "array"; description?: string; items: ToolParamSchema };

export interface ToolDefinition {
  name: string;                              // snake_case
  description: string;                       // o LLM lê isso pra decidir quando chamar
  parameters: ToolJsonSchema;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

/** Resultado de uma execução de tool, padronizado pra devolver ao LLM. */
export interface ToolExecutionResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** Retorna a versão "pública" (sem handler) pra mandar ao SDK. */
export function publicSchema(tool: ToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

/** Limites globais — evita o LLM pedir 10k linhas e estourar contexto/tokens. */
export const ROW_LIMIT_DEFAULT = 50;
export const ROW_LIMIT_MAX     = 200;

export function clampLimit(n: unknown, fallback = ROW_LIMIT_DEFAULT): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : fallback;
  return Math.max(1, Math.min(v, ROW_LIMIT_MAX));
}

/** Helper pra serializar valores numéricos do Supabase (numeric vem como string às vezes). */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : null;
}
