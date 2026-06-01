// Tools fiscais — usadas pelo Assistente Fiscal / NF-e.

import { clampLimit, num, type ToolDefinition } from "./types";

const buscarPorRefOuNF: ToolDefinition = {
  name: "buscar_por_ref_ou_nf",
  description:
    "Busca lançamentos pela referência (campo 'ref' — pode ser número de NF, identificador 'AGUARDANDO NF', código de recibo, etc.). " +
    "Use quando o usuário citar um número de nota ou código de referência.",
  parameters: {
    type: "object",
    properties: {
      ref:   { type: "string", description: "Substring case-insensitive a ser buscada no campo ref." },
      limit: { type: "integer", minimum: 1, maximum: 200 },
    },
    required: ["ref"],
    additionalProperties: false,
  },
  handler: async (args, { admin }) => {
    const limit = clampLimit(args.limit, 20);
    const ref = String(args.ref).trim();
    if (!ref) return { lancamentos: [] };
    const { data, error } = await admin
      .from("transacoes_empresa")
      .select("id, data, mes_referencia, fornecedor_nome, descricao, status, valor, ref, forma_pgto")
      .ilike("ref", `%${ref}%`)
      .order("data", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return { lancamentos: (data ?? []).map(r => ({
      id:             r.id,
      data:           r.data,
      mes_referencia: r.mes_referencia,
      fornecedor:     r.fornecedor_nome,
      descricao:      r.descricao,
      status:         r.status,
      forma_pgto:     r.forma_pgto,
      ref:            r.ref,
      valor:          num(r.valor),
    })) };
  },
};

const listarNotasEmGrupo: ToolDefinition = {
  name: "listar_notas_em_grupo",
  description:
    "Notas Fiscais que somam para um orçamento único parcelado (ex.: 'Orçamento 003M6G' em 6x). " +
    "Filtra opcionalmente por mês.",
  parameters: {
    type: "object",
    properties: {
      mes_referencia: { type: "string", description: "YYYY-MM. Opcional." },
      limit:          { type: "integer", minimum: 1, maximum: 200 },
    },
    additionalProperties: false,
  },
  handler: async (args, { admin }) => {
    const limit = clampLimit(args.limit);
    let q = admin
      .from("notas_em_grupo")
      .select("id, data, mes_referencia, referencia, valor, parcelas, conta_bancaria_id, observacao")
      .order("data", { ascending: false });
    if (typeof args.mes_referencia === "string" && args.mes_referencia.match(/^\d{4}-\d{2}$/)) {
      q = q.eq("mes_referencia", args.mes_referencia);
    }
    const { data, error } = await q.limit(limit);
    if (error) throw new Error(error.message);
    return { notas: (data ?? []).map(r => ({
      id:                r.id,
      data:              r.data,
      mes_referencia:    r.mes_referencia,
      referencia:        r.referencia,
      valor:             num(r.valor),
      parcelas:          r.parcelas,
      conta_bancaria_id: r.conta_bancaria_id,
      observacao:        r.observacao,
    })) };
  },
};

const listarDocumentos: ToolDefinition = {
  name: "listar_documentos",
  description:
    "Lista documentos anexados ao sistema (NFs/recibos/contratos digitalizados). " +
    "Filtra por mês, número de nota e/ou busca textual na descrição/nome.",
  parameters: {
    type: "object",
    properties: {
      mes_referencia: { type: "string", description: "YYYY-MM. Opcional." },
      numero_nota:    { type: "string", description: "Número da NF. Opcional." },
      busca:          { type: "string", description: "Substring no nome ou descrição." },
      limit:          { type: "integer", minimum: 1, maximum: 200 },
    },
    additionalProperties: false,
  },
  handler: async (args, { admin }) => {
    const limit = clampLimit(args.limit);
    let q = admin
      .from("documentos")
      .select("id, nome, tipo, mes_referencia, numero_nota, descricao, created_at")
      .order("created_at", { ascending: false });
    if (typeof args.mes_referencia === "string" && args.mes_referencia.match(/^\d{4}-\d{2}$/)) {
      q = q.eq("mes_referencia", args.mes_referencia);
    }
    if (typeof args.numero_nota === "string" && args.numero_nota.trim()) {
      q = q.eq("numero_nota", args.numero_nota.trim());
    }
    if (typeof args.busca === "string" && args.busca.trim()) {
      const t = args.busca.trim();
      q = q.or(`nome.ilike.%${t}%,descricao.ilike.%${t}%`);
    }
    const { data, error } = await q.limit(limit);
    if (error) throw new Error(error.message);
    return { documentos: data ?? [], total: (data ?? []).length };
  },
};

export const FISCAL_TOOLS: ToolDefinition[] = [
  buscarPorRefOuNF,
  listarNotasEmGrupo,
  listarDocumentos,
];
