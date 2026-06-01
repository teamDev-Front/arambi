// Tools comuns — todos os agentes recebem.

import { clampLimit, type ToolDefinition } from "./types";

const mesReferenciaAtual: ToolDefinition = {
  name: "mes_referencia_atual",
  description:
    "Retorna o mês de referência atual no formato YYYY-MM (timezone UTC). " +
    "Use quando o usuário pedir 'este mês', 'mês atual', 'agora', sem especificar.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  handler: async () => {
    const d = new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    return { mes_referencia: `${y}-${m}`, hoje_iso: d.toISOString().slice(0, 10) };
  },
};

const listarSocios: ToolDefinition = {
  name: "listar_socios",
  description: "Lista os sócios da Agropecuária Aramburu (id, nome, apelido, ativo).",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  handler: async (_args, { admin }) => {
    const { data, error } = await admin
      .from("socios")
      .select("id, nome_completo, apelido, ativo")
      .order("nome_completo");
    if (error) throw new Error(error.message);
    return { socios: data ?? [] };
  },
};

const listarBancosEmpresa: ToolDefinition = {
  name: "listar_bancos_empresa",
  description:
    "Lista as contas bancárias da empresa (Aramburu). Inclui nome, banco, agência, conta, tipo e se está ativa.",
  parameters: {
    type: "object",
    properties: {
      apenas_ativos: { type: "boolean", description: "Se true, retorna só contas ativas. Default: true." },
    },
    additionalProperties: false,
  },
  handler: async (args, { admin }) => {
    const apenasAtivos = args.apenas_ativos !== false;
    let q = admin
      .from("contas_bancarias_empresa")
      .select("id, nome, apelido, banco, agencia, conta, tipo, ativa, ordem")
      .order("ordem", { ascending: true, nullsFirst: false });
    if (apenasAtivos) q = q.eq("ativa", true);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { bancos: data ?? [] };
  },
};

const planoDeContas: ToolDefinition = {
  name: "plano_de_contas",
  description:
    "Consulta o plano de contas (classificação financeira) da empresa. " +
    "Filtros opcionais: natureza ('entrada'/'saida'), nivel (1, 2 ou 3) e busca por nome. " +
    "Use para mapear nomes humanos ('Energia Elétrica', 'Insumos Agrícolas') para o código contábil (ex.: '2.5.3').",
  parameters: {
    type: "object",
    properties: {
      natureza: { type: "string", enum: ["entrada", "saida"], description: "Filtra por entrada ou saída." },
      nivel:    { type: "integer", minimum: 1, maximum: 3, description: "Nível da classificação (1 mais geral, 3 mais específico)." },
      busca:    { type: "string", description: "Busca textual no nome da conta (case-insensitive, substring)." },
      limit:    { type: "integer", minimum: 1, maximum: 200, description: "Máximo de linhas (default 50)." },
    },
    additionalProperties: false,
  },
  handler: async (args, { admin }) => {
    const limit = clampLimit(args.limit);
    let q = admin
      .from("classificacao_financeira")
      .select("codigo, nome, natureza, parent_codigo, nivel, ordem")
      .eq("ativo", true)
      .order("codigo");
    if (args.natureza === "entrada" || args.natureza === "saida") {
      q = q.eq("natureza", args.natureza);
    }
    if (typeof args.nivel === "number") {
      q = q.eq("nivel", args.nivel);
    }
    if (typeof args.busca === "string" && args.busca.trim()) {
      q = q.ilike("nome", `%${args.busca.trim()}%`);
    }
    const { data, error } = await q.limit(limit);
    if (error) throw new Error(error.message);
    return { contas: data ?? [], total: (data ?? []).length };
  },
};

export const COMMON_TOOLS: ToolDefinition[] = [
  mesReferenciaAtual,
  listarSocios,
  listarBancosEmpresa,
  planoDeContas,
];
