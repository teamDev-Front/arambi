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
    "Top N lançamentos da empresa filtrados/ordenados. Default: ordenado por valor absoluto descendente. " +
    "Use quando o usuário pede 'maiores lançamentos', 'maiores despesas', 'principais entradas do mês'.",
  parameters: {
    type: "object",
    properties: {
      mes_referencia: { type: "string", description: "YYYY-MM. Opcional." },
      natureza:       { type: "string", enum: ["entrada", "saida"], description: "Filtra entradas ou saídas (deriva pelo sinal do valor: entrada > 0, saída < 0). Opcional." },
      status:         { type: "string", description: "Filtra por status (ex.: 'pago', 'a_pagar', 'recebido', 'a_receber'). Opcional." },
      busca:          { type: "string", description: "Substring na descrição OU no nome do fornecedor. Opcional." },
      limit:          { type: "integer", minimum: 1, maximum: 200, description: "Default 10." },
    },
    additionalProperties: false,
  },
  handler: async (args, { admin }) => {
    const limit = clampLimit(args.limit, 10);
    let q = admin
      .from("transacoes_empresa")
      .select("id, data, mes_referencia, conta_contabil_cod, centro_custo_cod, fornecedor_nome, descricao, status, valor, ref, forma_pgto");
    if (typeof args.mes_referencia === "string" && args.mes_referencia.match(/^\d{4}-\d{2}$/)) {
      q = q.eq("mes_referencia", args.mes_referencia);
    }
    if (args.natureza === "entrada") q = q.gt("valor", 0);
    if (args.natureza === "saida")   q = q.lt("valor", 0);
    if (typeof args.status === "string" && args.status.trim()) {
      // status é enum; assume snake_case do schema
      q = q.eq("status", args.status.trim() as never);
    }
    if (typeof args.busca === "string" && args.busca.trim()) {
      const t = args.busca.trim().replace(/[%]/g, "");
      q = q.or(`descricao.ilike.%${t}%,fornecedor_nome.ilike.%${t}%`);
    }
    // PostgREST não suporta order by abs(valor) — ordenamos no app.
    const { data, error } = await q.limit(Math.min(limit * 4, 200));
    if (error) throw new Error(error.message);
    const ordenados = (data ?? [])
      .map(r => ({ ...r, _abs: Math.abs(num(r.valor) ?? 0) }))
      .sort((a, b) => b._abs - a._abs)
      .slice(0, limit)
      .map(({ _abs: _, ...r }) => ({
        id:             r.id,
        data:           r.data,
        mes_referencia: r.mes_referencia,
        conta_contabil: r.conta_contabil_cod,
        centro_custo:   r.centro_custo_cod,
        fornecedor:     r.fornecedor_nome,
        descricao:      r.descricao,
        status:         r.status,
        forma_pgto:     r.forma_pgto,
        ref:            r.ref,
        valor:          num(r.valor),
      }));
    return { lancamentos: ordenados };
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
