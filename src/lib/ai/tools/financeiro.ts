// Tools financeiras — consumidas pelo Contabilidade, Adv. Tributarista
// e (parcialmente) pelo Fiscal/NF-e.
//
// Todas read-only via admin client. Resultados serializam numeric→number
// e devolvem PT-BR-friendly (mas valores brutos — formatação é com o LLM).

import { clampLimit, num, type ToolDefinition } from "./types";

const kpiMensal: ToolDefinition = {
  name: "kpi_mensal",
  description:
    "Indicadores financeiros agregados por mês (entradas realizadas/a receber, saídas realizadas/a pagar/provisionadas, saldo). " +
    "Use para responder 'como está o mês X?' ou comparar meses. " +
    "Se 'mes_referencia' não for passado, retorna os ÚLTIMOS 12 meses ordenados do mais recente ao mais antigo.",
  parameters: {
    type: "object",
    properties: {
      mes_referencia: { type: "string", description: "Mês no formato YYYY-MM (ex.: '2026-05'). Opcional." },
    },
    additionalProperties: false,
  },
  handler: async (args, { admin }) => {
    let q = admin
      .from("v_kpi_mensal")
      .select("mes_referencia, entradas_realizadas, entradas_a_receber, saidas_realizadas, saidas_a_pagar, saidas_provisionadas, saldo_movimentacao")
      .order("mes_referencia", { ascending: false });
    if (typeof args.mes_referencia === "string" && args.mes_referencia.match(/^\d{4}-\d{2}$/)) {
      q = q.eq("mes_referencia", args.mes_referencia).limit(1);
    } else {
      q = q.limit(12);
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { meses: (data ?? []).map(r => ({
      mes_referencia:        r.mes_referencia,
      entradas_realizadas:   num(r.entradas_realizadas),
      entradas_a_receber:    num(r.entradas_a_receber),
      saidas_realizadas:     num(r.saidas_realizadas),
      saidas_a_pagar:        num(r.saidas_a_pagar),
      saidas_provisionadas:  num(r.saidas_provisionadas),
      saldo_movimentacao:    num(r.saldo_movimentacao),
    })) };
  },
};

const saldoAtualPorBanco: ToolDefinition = {
  name: "saldo_atual_por_banco",
  description:
    "Saldo atual consolidado de cada conta bancária da empresa. " +
    "Inclui saldo realizado, a pagar, a receber, provisionado e o saldo projetado. " +
    "Use quando o usuário pergunta 'quanto tenho no banco X?' ou 'qual o saldo total?'.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  handler: async (_args, { admin }) => {
    const { data, error } = await admin
      .from("v_saldo_atual_por_banco")
      .select("conta_bancaria_id, banco_nome, banco_apelido, banco_instituicao, banco_agencia, saldo_atual, a_pagar, a_receber, a_repassar, a_resgatar, provisionado, entradas_realizadas, saidas_realizadas, saldo_projetado, total_lancamentos");
    if (error) throw new Error(error.message);
    return { contas: (data ?? []).map(r => ({
      conta_bancaria_id:    r.conta_bancaria_id,
      banco_nome:           r.banco_nome,
      banco_apelido:        r.banco_apelido,
      banco_instituicao:    r.banco_instituicao,
      banco_agencia:        r.banco_agencia,
      saldo_atual:          num(r.saldo_atual),
      a_pagar:              num(r.a_pagar),
      a_receber:            num(r.a_receber),
      a_repassar:           num(r.a_repassar),
      a_resgatar:           num(r.a_resgatar),
      provisionado:         num(r.provisionado),
      entradas_realizadas:  num(r.entradas_realizadas),
      saidas_realizadas:    num(r.saidas_realizadas),
      saldo_projetado:      num(r.saldo_projetado),
      total_lancamentos:    r.total_lancamentos,
    })) };
  },
};

const lancamentosPorContaContabilMensal: ToolDefinition = {
  name: "lancamentos_por_conta_contabil_mensal",
  description:
    "Soma de lançamentos por CONTA CONTÁBIL (1.x = entradas, 2.x = saídas) em um mês. " +
    "Use para identificar onde mais entrou ou saiu dinheiro num período.",
  parameters: {
    type: "object",
    properties: {
      mes_referencia: { type: "string", description: "Obrigatório. YYYY-MM." },
      codigo:         { type: "string", description: "Filtra um código específico (ex.: '1.1'). Opcional." },
      limit:          { type: "integer", minimum: 1, maximum: 200 },
    },
    required: ["mes_referencia"],
    additionalProperties: false,
  },
  handler: async (args, { admin }) => {
    const limit = clampLimit(args.limit);
    let q = admin
      .from("v_por_conta_contabil_mensal")
      .select("mes_referencia, conta_contabil_cod, conta_contabil_nome, natureza, valor_total, qtd_lancamentos")
      .eq("mes_referencia", String(args.mes_referencia));
    if (typeof args.codigo === "string" && args.codigo.trim()) {
      q = q.eq("conta_contabil_cod", args.codigo.trim());
    }
    const { data, error } = await q.order("valor_total", { ascending: false }).limit(limit);
    if (error) throw new Error(error.message);
    return { contas: (data ?? []).map(r => ({
      mes_referencia:       r.mes_referencia,
      codigo:               r.conta_contabil_cod,
      nome:                 r.conta_contabil_nome,
      natureza:             r.natureza,
      valor_total:          num(r.valor_total),
      qtd_lancamentos:      r.qtd_lancamentos,
    })) };
  },
};

const lancamentosPorCentroCustoMensal: ToolDefinition = {
  name: "lancamentos_por_centro_custo_mensal",
  description:
    "Soma de lançamentos por CENTRO DE CUSTO (segunda dimensão contábil) em um mês. " +
    "Útil para análise de onde o dinheiro está sendo aplicado dentro do negócio.",
  parameters: {
    type: "object",
    properties: {
      mes_referencia: { type: "string", description: "Obrigatório. YYYY-MM." },
      codigo:         { type: "string", description: "Código específico (ex.: '2.7.2' = Obras e melhorias). Opcional." },
      limit:          { type: "integer", minimum: 1, maximum: 200 },
    },
    required: ["mes_referencia"],
    additionalProperties: false,
  },
  handler: async (args, { admin }) => {
    const limit = clampLimit(args.limit);
    let q = admin
      .from("v_por_centro_custo_mensal")
      .select("mes_referencia, centro_custo_cod, centro_custo_nome, natureza, valor_total, qtd_lancamentos")
      .eq("mes_referencia", String(args.mes_referencia));
    if (typeof args.codigo === "string" && args.codigo.trim()) {
      q = q.eq("centro_custo_cod", args.codigo.trim());
    }
    const { data, error } = await q.order("valor_total", { ascending: false }).limit(limit);
    if (error) throw new Error(error.message);
    return { centros: (data ?? []).map(r => ({
      mes_referencia:       r.mes_referencia,
      codigo:               r.centro_custo_cod,
      nome:                 r.centro_custo_nome,
      natureza:             r.natureza,
      valor_total:          num(r.valor_total),
      qtd_lancamentos:      r.qtd_lancamentos,
    })) };
  },
};

const topLancamentos: ToolDefinition = {
  name: "top_lancamentos",
  description:
    "Lista lançamentos da empresa com filtros e ordenação flexíveis. " +
    "Use para perguntas tipo 'maiores despesas do mês', 'lançamento mais recente da conta X', " +
    "'últimas movimentações do banco Y', 'qual o lançamento da conta 2.3.6'. " +
    "Os filtros de código contábil aceitam PREFIXO: passar '2.3' já encontra '2.3.1', '2.3.6.1', etc.",
  parameters: {
    type: "object",
    properties: {
      mes_referencia:     { type: "string", description: "YYYY-MM. SÓ informe se o usuário pediu explicitamente um mês. Para 'mais recente' deixe vazio e use ordenar_por='data_desc'." },
      conta_contabil_cod: { type: "string", description: "Filtra pelo código da conta contábil (prefix match — '2.3' inclui '2.3.6'). Opcional." },
      centro_custo_cod:   { type: "string", description: "Filtra pelo código do centro de custo (prefix match — '2.7' inclui '2.7.2'). Opcional." },
      natureza:           { type: "string", enum: ["entrada", "saida"], description: "Entradas (valor > 0) ou saídas (valor < 0). Opcional." },
      status:             { type: "string", description: "Filtra por status snake_case ('pago', 'a_pagar', 'recebido', 'a_receber', 'provisionado'…). Opcional." },
      conta_bancaria_id:  { type: "string", description: "UUID da conta bancária (use listar_bancos_empresa para obter)." },
      fornecedor:         { type: "string", description: "Substring case-insensitive no nome do fornecedor." },
      busca:              { type: "string", description: "Substring na descrição (ou no nome do fornecedor se 'fornecedor' não for usado)." },
      ordenar_por:        {
        type: "string",
        enum: ["valor_abs_desc", "data_desc", "data_asc", "valor_desc", "valor_asc"],
        description: "Critério de ordenação. Default 'valor_abs_desc' (maiores em módulo). Use 'data_desc' para 'mais recente'.",
      },
      limit:              { type: "integer", minimum: 1, maximum: 200, description: "Default 10." },
    },
    additionalProperties: false,
  },
  handler: async (args, { admin }) => {
    const limit  = clampLimit(args.limit, 10);
    const ordem  = String(args.ordenar_por ?? "valor_abs_desc");

    let q = admin
      .from("transacoes_empresa")
      .select("id, data, mes_referencia, conta_contabil_cod, centro_custo_cod, conta_bancaria_id, fornecedor_nome, descricao, status, valor, ref, forma_pgto");

    if (typeof args.mes_referencia === "string" && args.mes_referencia.match(/^\d{4}-\d{2}$/)) {
      q = q.eq("mes_referencia", args.mes_referencia);
    }
    if (typeof args.conta_contabil_cod === "string" && args.conta_contabil_cod.trim()) {
      const c = args.conta_contabil_cod.trim();
      q = q.like("conta_contabil_cod", `${c}%`);
    }
    if (typeof args.centro_custo_cod === "string" && args.centro_custo_cod.trim()) {
      const c = args.centro_custo_cod.trim();
      q = q.like("centro_custo_cod", `${c}%`);
    }
    if (args.natureza === "entrada") q = q.gt("valor", 0);
    if (args.natureza === "saida")   q = q.lt("valor", 0);
    if (typeof args.status === "string" && args.status.trim()) {
      q = q.eq("status", args.status.trim() as never);
    }
    if (typeof args.conta_bancaria_id === "string" && args.conta_bancaria_id.trim()) {
      q = q.eq("conta_bancaria_id", args.conta_bancaria_id.trim());
    }
    if (typeof args.fornecedor === "string" && args.fornecedor.trim()) {
      q = q.ilike("fornecedor_nome", `%${args.fornecedor.trim()}%`);
    }
    if (typeof args.busca === "string" && args.busca.trim()) {
      const t = args.busca.trim().replace(/[%]/g, "");
      q = q.or(`descricao.ilike.%${t}%,fornecedor_nome.ilike.%${t}%`);
    }

    // Ordenação: data e valor (asc/desc) podem ser feitas em SQL.
    // valor_abs_desc precisa de sort em JS — buscamos mais linhas e cortamos.
    if (ordem === "data_desc")   q = q.order("data", { ascending: false }).limit(limit);
    else if (ordem === "data_asc")  q = q.order("data", { ascending: true }).limit(limit);
    else if (ordem === "valor_desc") q = q.order("valor", { ascending: false }).limit(limit);
    else if (ordem === "valor_asc")  q = q.order("valor", { ascending: true }).limit(limit);
    else q = q.limit(Math.min(limit * 4, 200));  // valor_abs_desc → busca mais e ordena no app

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    let rows = (data ?? []).map(r => ({
      id:             r.id,
      data:           r.data,
      mes_referencia: r.mes_referencia,
      conta_contabil: r.conta_contabil_cod,
      centro_custo:   r.centro_custo_cod,
      banco_id:       r.conta_bancaria_id,
      fornecedor:     r.fornecedor_nome,
      descricao:      r.descricao,
      status:         r.status,
      forma_pgto:     r.forma_pgto,
      ref:            r.ref,
      valor:          num(r.valor),
    }));

    if (ordem === "valor_abs_desc") {
      rows = rows
        .map(r => ({ r, abs: Math.abs(r.valor ?? 0) }))
        .sort((a, b) => b.abs - a.abs)
        .slice(0, limit)
        .map(x => x.r);
    }

    return { lancamentos: rows, total: rows.length, ordenado_por: ordem };
  },
};

const listarFornecedores: ToolDefinition = {
  name: "listar_fornecedores",
  description: "Lista fornecedores cadastrados (id, nome, cnpj, ativo). Aceita busca por nome.",
  parameters: {
    type: "object",
    properties: {
      busca: { type: "string", description: "Substring (case-insensitive) no nome." },
      limit: { type: "integer", minimum: 1, maximum: 200 },
    },
    additionalProperties: false,
  },
  handler: async (args, { admin }) => {
    const limit = clampLimit(args.limit);
    let q = admin
      .from("fornecedores")
      .select("id, nome, cnpj, apelido, ativo")
      .eq("ativo", true)
      .order("nome");
    if (typeof args.busca === "string" && args.busca.trim()) {
      q = q.ilike("nome", `%${args.busca.trim()}%`);
    }
    const { data, error } = await q.limit(limit);
    if (error) throw new Error(error.message);
    return { fornecedores: data ?? [], total: (data ?? []).length };
  },
};

const lancamentosPorFornecedor: ToolDefinition = {
  name: "lancamentos_por_fornecedor",
  description:
    "Lista os lançamentos vinculados a um fornecedor específico, opcionalmente filtrando por mês. " +
    "Use para responder 'quanto pagamos para a empresa X?' ou 'últimas compras do fornecedor Y'.",
  parameters: {
    type: "object",
    properties: {
      fornecedor_nome: { type: "string", description: "Nome (substring case-insensitive) do fornecedor." },
      mes_referencia:  { type: "string", description: "YYYY-MM. Opcional." },
      limit:           { type: "integer", minimum: 1, maximum: 200 },
    },
    required: ["fornecedor_nome"],
    additionalProperties: false,
  },
  handler: async (args, { admin }) => {
    const limit = clampLimit(args.limit, 20);
    const fornecedor = String(args.fornecedor_nome).trim();
    if (!fornecedor) return { lancamentos: [], total: 0, soma: 0 };
    let q = admin
      .from("transacoes_empresa")
      .select("id, data, mes_referencia, fornecedor_nome, descricao, status, valor, ref, forma_pgto")
      .ilike("fornecedor_nome", `%${fornecedor}%`)
      .order("data", { ascending: false });
    if (typeof args.mes_referencia === "string" && args.mes_referencia.match(/^\d{4}-\d{2}$/)) {
      q = q.eq("mes_referencia", args.mes_referencia);
    }
    const { data, error } = await q.limit(limit);
    if (error) throw new Error(error.message);
    const rows = (data ?? []).map(r => ({
      id:             r.id,
      data:           r.data,
      mes_referencia: r.mes_referencia,
      fornecedor:     r.fornecedor_nome,
      descricao:      r.descricao,
      status:         r.status,
      forma_pgto:     r.forma_pgto,
      ref:            r.ref,
      valor:          num(r.valor),
    }));
    const soma = rows.reduce((acc, r) => acc + (r.valor ?? 0), 0);
    return { lancamentos: rows, total: rows.length, soma };
  },
};

const saldoPorBancoMensal: ToolDefinition = {
  name: "saldo_por_banco_mensal",
  description:
    "Movimentação por banco em UM mês específico (entradas, saídas, variação e saldo inicial declarado). " +
    "Use para conciliação bancária do mês.",
  parameters: {
    type: "object",
    properties: {
      mes_referencia: { type: "string", description: "YYYY-MM (obrigatório)." },
    },
    required: ["mes_referencia"],
    additionalProperties: false,
  },
  handler: async (args, { admin }) => {
    const { data, error } = await admin
      .from("v_saldo_por_banco_mensal")
      .select("mes_referencia, conta_bancaria_id, conta_bancaria_nome, variacao_no_mes, saldo_inicial_no_mes, entradas, saidas")
      .eq("mes_referencia", String(args.mes_referencia));
    if (error) throw new Error(error.message);
    return { contas: (data ?? []).map(r => ({
      mes_referencia:      r.mes_referencia,
      conta_bancaria_id:   r.conta_bancaria_id,
      conta_bancaria_nome: r.conta_bancaria_nome,
      variacao_no_mes:     num(r.variacao_no_mes),
      saldo_inicial:       num(r.saldo_inicial_no_mes),
      entradas:            num(r.entradas),
      saidas:              num(r.saidas),
    })) };
  },
};

export const FINANCEIRO_TOOLS: ToolDefinition[] = [
  kpiMensal,
  saldoAtualPorBanco,
  saldoPorBancoMensal,
  lancamentosPorContaContabilMensal,
  lancamentosPorCentroCustoMensal,
  topLancamentos,
  listarFornecedores,
  lancamentosPorFornecedor,
];
