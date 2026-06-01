// Tools de Vendas Futuras — vendas provisionadas de safra (cultura/comprador/preço).
// Usadas pelo Assistente de Estoque (e podem alimentar um futuro Assistente de Vendas).

import { clampLimit, num, type ToolDefinition } from "./types";

const listarVendasProvisionadas: ToolDefinition = {
  name: "listar_vendas_provisionadas",
  description:
    "Lista vendas futuras já firmadas (contratos de venda de safra com comprador, kg, preço/saca, data prevista de pagamento). " +
    "Use para 'quanto temos vendido em soja safra 25/25?', 'próximos recebimentos', 'vendas firmadas para o sócio X'.",
  parameters: {
    type: "object",
    properties: {
      cultura:        {
        type: "string",
        enum: ["soja", "milho", "sorgo", "girassol", "algodao", "feijao", "trigo"],
      },
      safra:          { type: "string", description: "Identificador da safra (ex.: '25/25')." },
      status:         {
        type: "string",
        enum: ["firmada", "parcial", "liquidada", "cancelada"],
        description: "Status da venda.",
      },
      comprador:      { type: "string", description: "Substring case-insensitive no nome do comprador." },
      destino_empresa:{ type: "boolean", description: "true=destino empresa (default), false=destino sócio." },
      limit:          { type: "integer", minimum: 1, maximum: 200, description: "Default 50." },
    },
    additionalProperties: false,
  },
  handler: async (args, { admin }) => {
    const limit = clampLimit(args.limit);
    let q = admin
      .from("vendas_provisionadas")
      .select("id, data_venda, comprador, cultura, safra, aut_fixacao, numero_contrato, nota_fiscal, kg, preco_sc, kg_por_saca, data_pgto_prevista, destino_empresa, socio_destino_id, taxa_armazenagem, status, observacao")
      .order("data_pgto_prevista", { ascending: true, nullsFirst: false });
    if (typeof args.cultura === "string" && args.cultura.trim())   q = q.eq("cultura", args.cultura.trim() as never);
    if (typeof args.safra === "string" && args.safra.trim())       q = q.eq("safra", args.safra.trim());
    if (typeof args.status === "string" && args.status.trim())     q = q.eq("status", args.status.trim() as never);
    if (typeof args.comprador === "string" && args.comprador.trim()) {
      q = q.ilike("comprador", `%${args.comprador.trim()}%`);
    }
    if (typeof args.destino_empresa === "boolean") {
      q = q.eq("destino_empresa", args.destino_empresa);
    }
    const { data, error } = await q.limit(limit);
    if (error) throw new Error(error.message);
    const rows = (data ?? []).map(r => {
      const kg     = num(r.kg) ?? 0;
      const kgSaca = num(r.kg_por_saca) ?? 60;
      const preco  = num(r.preco_sc) ?? 0;
      const sacas  = kgSaca > 0 ? kg / kgSaca : 0;
      return {
        id:               r.id,
        data_venda:       r.data_venda,
        comprador:        r.comprador,
        cultura:          r.cultura,
        safra:            r.safra,
        aut_fixacao:      r.aut_fixacao,
        numero_contrato:  r.numero_contrato,
        nota_fiscal:      r.nota_fiscal,
        kg,
        sacas,
        preco_sc:         preco,
        valor_bruto:      sacas * preco,
        kg_por_saca:      kgSaca,
        data_pgto_prevista: r.data_pgto_prevista,
        destino_empresa:  r.destino_empresa,
        socio_destino_id: r.socio_destino_id,
        taxa_armazenagem: num(r.taxa_armazenagem),
        status:           r.status,
        observacao:       r.observacao,
      };
    });
    const totais = rows.reduce(
      (acc, r) => ({
        kg:          acc.kg          + (r.kg ?? 0),
        sacas:       acc.sacas       + (r.sacas ?? 0),
        valor_bruto: acc.valor_bruto + (r.valor_bruto ?? 0),
      }),
      { kg: 0, sacas: 0, valor_bruto: 0 },
    );
    return { vendas: rows, total: rows.length, totais };
  },
};

export const VENDAS_TOOLS: ToolDefinition[] = [
  listarVendasProvisionadas,
];
