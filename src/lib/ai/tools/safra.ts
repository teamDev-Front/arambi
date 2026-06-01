// Tools de Safra — depósitos por armazém, parâmetros e cálculo consolidado.
// Usadas pelo Assistente de Estoque (que cobre 3 domínios: estoque/safra/vendas).

import { clampLimit, num, type ToolDefinition } from "./types";

const listarArmazens: ToolDefinition = {
  name: "listar_armazens",
  description:
    "Lista os armazéns cadastrados onde a Aramburu armazena safra (cooperativas, recebedoras). " +
    "Útil pra mapear nome humano (ex.: 'Copasul Maracaju') pro armazem_id usado nas outras tools.",
  parameters: {
    type: "object",
    properties: {
      apenas_ativos: { type: "boolean", description: "Default true." },
    },
    additionalProperties: false,
  },
  handler: async (args, { admin }) => {
    const apenasAtivos = args.apenas_ativos !== false;
    let q = admin
      .from("armazens")
      .select("id, nome, apelido, cnpj, cidade, uf, ativo, ordem, observacao")
      .order("ordem", { ascending: true, nullsFirst: false });
    if (apenasAtivos) q = q.eq("ativo", true);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { armazens: data ?? [] };
  },
};

const listarDepositosSafra: ToolDefinition = {
  name: "listar_depositos_safra",
  description:
    "Lista depósitos de safra (DFE/NFP) com filtros. Cada depósito é um lote de grãos entregue em um armazém. " +
    "Use para 'quantos kg temos no armazém X?', 'depósitos de soja safra 25/25', 'últimas entregas'.",
  parameters: {
    type: "object",
    properties: {
      armazem_id: { type: "string", description: "UUID do armazém (use listar_armazens)." },
      cultura:    {
        type: "string",
        enum: ["soja", "milho", "sorgo", "girassol", "algodao", "feijao", "trigo"],
        description: "Cultura plantada.",
      },
      safra:      { type: "string", description: "Identificador da safra (ex.: '25/25', '24/25')." },
      status:     {
        type: "string",
        enum: ["armazenado", "vendido_parcial", "vendido_total", "retirado", "baixa"],
        description: "Status do depósito.",
      },
      limit:      { type: "integer", minimum: 1, maximum: 200, description: "Default 50." },
    },
    additionalProperties: false,
  },
  handler: async (args, { admin }) => {
    const limit = clampLimit(args.limit);
    let q = admin
      .from("safra_depositos")
      .select("id, armazem_id, cultura, safra, data_deposito, dfe_entrada, nfp, kg_bruto, status, observacao")
      .order("data_deposito", { ascending: false });
    if (typeof args.armazem_id === "string" && args.armazem_id.trim()) q = q.eq("armazem_id", args.armazem_id.trim());
    if (typeof args.cultura === "string" && args.cultura.trim())       q = q.eq("cultura", args.cultura.trim() as never);
    if (typeof args.safra === "string" && args.safra.trim())           q = q.eq("safra", args.safra.trim());
    if (typeof args.status === "string" && args.status.trim())         q = q.eq("status", args.status.trim() as never);
    const { data, error } = await q.limit(limit);
    if (error) throw new Error(error.message);
    const rows = (data ?? []).map(r => ({
      id:            r.id,
      armazem_id:    r.armazem_id,
      cultura:       r.cultura,
      safra:         r.safra,
      data_deposito: r.data_deposito,
      dfe_entrada:   r.dfe_entrada,
      nfp:           r.nfp,
      kg_bruto:      num(r.kg_bruto),
      status:        r.status,
      observacao:    r.observacao,
    }));
    const kg_total = rows.reduce((acc, r) => acc + (r.kg_bruto ?? 0), 0);
    return { depositos: rows, total: rows.length, kg_total };
  },
};

const calculoConsolidadoSafra: ToolDefinition = {
  name: "calculo_consolidado_safra",
  description:
    "Cálculo CONSOLIDADO de cada depósito (já com quebra técnica, armazenagem, devolução, total a descontar e valor de venda simulado). " +
    "Use para 'quanto rende se eu vender hoje?', 'líquido após quebra', 'taxa de armazenagem acumulada'. " +
    "Aceita os mesmos filtros de listar_depositos_safra.",
  parameters: {
    type: "object",
    properties: {
      armazem_id: { type: "string" },
      cultura:    {
        type: "string",
        enum: ["soja", "milho", "sorgo", "girassol", "algodao", "feijao", "trigo"],
      },
      safra:      { type: "string" },
      status:     {
        type: "string",
        enum: ["armazenado", "vendido_parcial", "vendido_total", "retirado", "baixa"],
      },
      limit:      { type: "integer", minimum: 1, maximum: 200 },
    },
    additionalProperties: false,
  },
  handler: async (args, { admin }) => {
    const limit = clampLimit(args.limit);
    let q = admin
      .from("v_safra_depositos_calculado")
      .select("id, armazem_id, armazem_nome, armazem_apelido, cultura, safra, data_deposito, dfe_entrada, nfp, kg_bruto, sc_bruto, dias_percorridos, quinzenas, quebra_kg, kg_liquido, sc_liquida, taxa_armazenagem, taxa_devolucao, total_a_descontar, valor_venda_simulado, cotacao_simulada_sc, status")
      .order("data_deposito", { ascending: false });
    if (typeof args.armazem_id === "string" && args.armazem_id.trim()) q = q.eq("armazem_id", args.armazem_id.trim());
    if (typeof args.cultura === "string" && args.cultura.trim())       q = q.eq("cultura", args.cultura.trim() as never);
    if (typeof args.safra === "string" && args.safra.trim())           q = q.eq("safra", args.safra.trim());
    if (typeof args.status === "string" && args.status.trim())         q = q.eq("status", args.status.trim() as never);
    const { data, error } = await q.limit(limit);
    if (error) throw new Error(error.message);
    const rows = (data ?? []).map(r => ({
      id:                   r.id,
      armazem:              r.armazem_apelido ?? r.armazem_nome,
      cultura:              r.cultura,
      safra:                r.safra,
      data_deposito:        r.data_deposito,
      kg_bruto:             num(r.kg_bruto),
      sc_bruto:             num(r.sc_bruto),
      dias_percorridos:     r.dias_percorridos,
      quinzenas:            r.quinzenas,
      quebra_kg:            num(r.quebra_kg),
      kg_liquido:           num(r.kg_liquido),
      sc_liquida:           num(r.sc_liquida),
      taxa_armazenagem:     num(r.taxa_armazenagem),
      taxa_devolucao:       num(r.taxa_devolucao),
      total_a_descontar:    num(r.total_a_descontar),
      cotacao_simulada_sc:  num(r.cotacao_simulada_sc),
      valor_venda_simulado: num(r.valor_venda_simulado),
      status:               r.status,
    }));
    // Totais agregados para resposta rápida.
    const totais = rows.reduce(
      (acc, r) => ({
        kg_bruto:             acc.kg_bruto              + (r.kg_bruto ?? 0),
        kg_liquido:           acc.kg_liquido            + (r.kg_liquido ?? 0),
        total_a_descontar:    acc.total_a_descontar     + (r.total_a_descontar ?? 0),
        valor_venda_simulado: acc.valor_venda_simulado  + (r.valor_venda_simulado ?? 0),
      }),
      { kg_bruto: 0, kg_liquido: 0, total_a_descontar: 0, valor_venda_simulado: 0 },
    );
    return { depositos: rows, total: rows.length, totais };
  },
};

const parametrosSafra: ToolDefinition = {
  name: "parametros_safra",
  description:
    "Parâmetros usados no cálculo de cada (armazém, cultura, safra): quebra técnica, taxa de armazenagem, devolução, kg/saca, cotação simulada. " +
    "Use quando precisar entender por que um valor está como está OU mostrar a cotação simulada que a Lola configurou.",
  parameters: {
    type: "object",
    properties: {
      armazem_id: { type: "string" },
      cultura:    {
        type: "string",
        enum: ["soja", "milho", "sorgo", "girassol", "algodao", "feijao", "trigo"],
      },
      safra:      { type: "string" },
    },
    additionalProperties: false,
  },
  handler: async (args, { admin }) => {
    let q = admin
      .from("safra_parametros")
      .select("id, armazem_id, cultura, safra, quebra_quinzena_pct, armazenagem_por_kg_quinzena, devolucao_por_saca, carencia_dias, kg_por_saca, data_atual, cotacao_simulada_sc, observacao");
    if (typeof args.armazem_id === "string" && args.armazem_id.trim()) q = q.eq("armazem_id", args.armazem_id.trim());
    if (typeof args.cultura === "string" && args.cultura.trim())       q = q.eq("cultura", args.cultura.trim() as never);
    if (typeof args.safra === "string" && args.safra.trim())           q = q.eq("safra", args.safra.trim());
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { parametros: (data ?? []).map(r => ({
      id:                          r.id,
      armazem_id:                  r.armazem_id,
      cultura:                     r.cultura,
      safra:                       r.safra,
      quebra_quinzena_pct:         num(r.quebra_quinzena_pct),
      armazenagem_por_kg_quinzena: num(r.armazenagem_por_kg_quinzena),
      devolucao_por_saca:          num(r.devolucao_por_saca),
      carencia_dias:               r.carencia_dias,
      kg_por_saca:                 num(r.kg_por_saca),
      data_atual:                  r.data_atual,
      cotacao_simulada_sc:         num(r.cotacao_simulada_sc),
      observacao:                  r.observacao,
    })) };
  },
};

export const SAFRA_TOOLS: ToolDefinition[] = [
  listarArmazens,
  listarDepositosSafra,
  calculoConsolidadoSafra,
  parametrosSafra,
];
