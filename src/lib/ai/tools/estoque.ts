// Tools de Estoque — usadas pelo Assistente de Estoque.

import { clampLimit, num, type ToolDefinition } from "./types";

const listarEstoque: ToolDefinition = {
  name: "listar_estoque",
  description:
    "Lista itens do estoque com filtros opcionais (categoria, status, busca por nome do produto). " +
    "Use para responder 'quanto temos de X?', 'quais itens críticos?', 'estoque por categoria'.",
  parameters: {
    type: "object",
    properties: {
      categoria: { type: "string", description: "Filtra por categoria (substring). Opcional." },
      status:    {
        type: "string",
        enum: ["em_estoque", "baixo_estoque", "critico", "esgotado"],
        description: "Filtra por status do item. Opcional.",
      },
      busca:     { type: "string", description: "Busca no nome do produto (substring case-insensitive). Opcional." },
      limit:     { type: "integer", minimum: 1, maximum: 200, description: "Default 50." },
    },
    additionalProperties: false,
  },
  handler: async (args, { admin }) => {
    const limit = clampLimit(args.limit);
    let q = admin
      .from("estoque")
      .select("id, produto, categoria, quantidade, unidade, valor_unitario, status, fornecedor_nome, observacao, updated_at")
      .order("produto");
    if (typeof args.categoria === "string" && args.categoria.trim()) {
      q = q.ilike("categoria", `%${args.categoria.trim()}%`);
    }
    if (typeof args.status === "string" && args.status.trim()) {
      q = q.eq("status", args.status.trim() as never);
    }
    if (typeof args.busca === "string" && args.busca.trim()) {
      q = q.ilike("produto", `%${args.busca.trim()}%`);
    }
    const { data, error } = await q.limit(limit);
    if (error) throw new Error(error.message);
    return { itens: (data ?? []).map(r => ({
      id:             r.id,
      produto:        r.produto,
      categoria:      r.categoria,
      quantidade:     num(r.quantidade),
      unidade:        r.unidade,
      valor_unitario: num(r.valor_unitario),
      status:         r.status,
      fornecedor:     r.fornecedor_nome,
      observacao:     r.observacao,
      updated_at:     r.updated_at,
    })), total: (data ?? []).length };
  },
};

const alertasEstoque: ToolDefinition = {
  name: "alertas_estoque",
  description:
    "Lista APENAS itens em estado crítico, baixo estoque ou esgotados. " +
    "Use quando o usuário pedir 'o que está faltando?', 'alertas de estoque', 'comprar urgente'.",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 200, description: "Default 50." },
    },
    additionalProperties: false,
  },
  handler: async (args, { admin }) => {
    const limit = clampLimit(args.limit);
    const { data, error } = await admin
      .from("estoque")
      .select("id, produto, categoria, quantidade, unidade, valor_unitario, status, fornecedor_nome, observacao")
      .in("status", ["baixo_estoque", "critico", "esgotado"])
      .order("status", { ascending: true })
      .order("produto")
      .limit(limit);
    if (error) throw new Error(error.message);
    return { itens: (data ?? []).map(r => ({
      id:             r.id,
      produto:        r.produto,
      categoria:      r.categoria,
      quantidade:     num(r.quantidade),
      unidade:        r.unidade,
      valor_unitario: num(r.valor_unitario),
      status:         r.status,
      fornecedor:     r.fornecedor_nome,
      observacao:     r.observacao,
    })), total: (data ?? []).length };
  },
};

export const ESTOQUE_TOOLS: ToolDefinition[] = [
  listarEstoque,
  alertasEstoque,
];
