// Tools da Obra Sede / LTS Engenharia — usadas principalmente pelo Adv. Contratual.

import { clampLimit, num, type ToolDefinition } from "./types";

const listarObraLtsItens: ToolDefinition = {
  name: "listar_obra_lts_itens",
  description:
    "Lista itens de Ordens de Compra (OC) e parcelas de Medição do contrato com a LTS Engenharia. " +
    "Filtra por status, contrato e/ou OC. Use para acompanhamento financeiro de contratos da obra.",
  parameters: {
    type: "object",
    properties: {
      status:    { type: "string", enum: ["pago", "em_aberto", "vence_hoje", "vencido", "cancelado"], description: "Opcional." },
      contrato:  { type: "string", description: "Filtra por nome de contrato (ex.: 'Contrato 01', 'Contrato 02', 'Projeto'). Opcional." },
      oc_numero: { type: "string", description: "Filtra por número de OC. Opcional." },
      limit:     { type: "integer", minimum: 1, maximum: 200, description: "Default 50." },
    },
    additionalProperties: false,
  },
  handler: async (args, { admin }) => {
    const limit = clampLimit(args.limit);
    let q = admin
      .from("obra_lts_itens")
      .select("id, oc_numero, data_compra, loja, nf, forma_pagamento, valor, vencimento, status, contrato, parcela, observacao")
      .order("vencimento", { ascending: true, nullsFirst: false });
    if (typeof args.status === "string" && args.status.trim()) {
      q = q.eq("status", args.status.trim() as never);
    }
    if (typeof args.contrato === "string" && args.contrato.trim()) {
      q = q.ilike("contrato", `%${args.contrato.trim()}%`);
    }
    if (typeof args.oc_numero === "string" && args.oc_numero.trim()) {
      q = q.eq("oc_numero", args.oc_numero.trim());
    }
    const { data, error } = await q.limit(limit);
    if (error) throw new Error(error.message);
    return { itens: (data ?? []).map(r => ({
      id:               r.id,
      oc_numero:        r.oc_numero,
      data_compra:      r.data_compra,
      loja:             r.loja,
      nf:               r.nf,
      forma_pagamento:  r.forma_pagamento,
      valor:            num(r.valor),
      vencimento:       r.vencimento,
      status:           r.status,
      contrato:         r.contrato,
      parcela:          r.parcela,
      observacao:       r.observacao,
    })) };
  },
};

const obraPendencias: ToolDefinition = {
  name: "obra_pendencias",
  description:
    "Lista pendências da obra (itens a contratar) — categoria, subcategoria, empresa, valor estimado. " +
    "Filtra opcionalmente por 'resolvida' (false = abertas, true = já resolvidas).",
  parameters: {
    type: "object",
    properties: {
      resolvida: { type: "boolean", description: "false = só abertas (default), true = só resolvidas." },
      limit:     { type: "integer", minimum: 1, maximum: 200 },
    },
    additionalProperties: false,
  },
  handler: async (args, { admin }) => {
    const limit = clampLimit(args.limit);
    const resolvida = args.resolvida === true ? true : false;
    const { data, error } = await admin
      .from("obra_pendencias")
      .select("id, categoria, subcategoria, descricao, empresa, condicao_pgto, valor, observacao, resolvida, resolvida_at")
      .eq("resolvida", resolvida)
      .order("ordem", { ascending: true, nullsFirst: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return { pendencias: (data ?? []).map(r => ({
      id:            r.id,
      categoria:     r.categoria,
      subcategoria:  r.subcategoria,
      descricao:     r.descricao,
      empresa:       r.empresa,
      condicao_pgto: r.condicao_pgto,
      valor:         num(r.valor),
      observacao:    r.observacao,
      resolvida:     r.resolvida,
      resolvida_at:  r.resolvida_at,
    })) };
  },
};

const obraResumo: ToolDefinition = {
  name: "obra_resumo",
  description:
    "Resumo financeiro consolidado da obra (totais por categoria: OC/Projeto, Medições, Outras, Provisionados, Retenção).",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  handler: async (_args, { admin }) => {
    const { data, error } = await admin
      .from("v_obra_totais")
      .select("pago_oc_projeto, pago_medicoes, pago_outras, a_pagar_outras, provisionado_medicoes, provisionado_outras, provisionado_retencao")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { resumo: null };
    return { resumo: {
      pago_oc_projeto:       num(data.pago_oc_projeto),
      pago_medicoes:         num(data.pago_medicoes),
      pago_outras:           num(data.pago_outras),
      a_pagar_outras:        num(data.a_pagar_outras),
      provisionado_medicoes: num(data.provisionado_medicoes),
      provisionado_outras:   num(data.provisionado_outras),
      provisionado_retencao: num(data.provisionado_retencao),
    }};
  },
};

const obraParametros: ToolDefinition = {
  name: "obra_parametros",
  description:
    "Parâmetros declarados da obra (chave/valor — ex.: capital_inicial, pago_2025_lts_medicao). " +
    "Use quando precisar de constantes/contexto histórico não derivado de transações.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  handler: async (_args, { admin }) => {
    const { data, error } = await admin
      .from("obra_parametros")
      .select("chave, valor_numerico, valor_texto, data_referencia, observacao");
    if (error) throw new Error(error.message);
    return { parametros: (data ?? []).map(r => ({
      chave:           r.chave,
      valor_numerico:  num(r.valor_numerico),
      valor_texto:     r.valor_texto,
      data_referencia: r.data_referencia,
      observacao:      r.observacao,
    })) };
  },
};

export const OBRA_TOOLS: ToolDefinition[] = [
  listarObraLtsItens,
  obraPendencias,
  obraResumo,
  obraParametros,
];
