// Builders que transformam dados crus do Supabase em payload dos templates
// do PDFMonkey.
//
// Status: a maioria dos campos já vem de views/tabelas reais. Os DEFAULTS
// abaixo (CNPJ, nome da empresa, "preparado por") podem ser sobrescritos:
//   • CNPJ e nome da empresa → leem de obra_parametros (chaves empresa_cnpj,
//     empresa_nome). Se não existir lá, cai no literal histórico.
//   • preparado_por → o caller pode passar args.preparadoPor.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types";
import type {
  CapaEmpresaPayload, CapaSocioPayload,
  RelatorioContabilPayload, RelatorioSociosPayload,
} from "./types";

// ----------------------------------------------------------------------------
// Helpers de formatação BRL
// ----------------------------------------------------------------------------
const fmt = (n: number) =>
  new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
export const brl   = (n: number) => `R$ ${fmt(n)}`;
export const brlOrDash = (n: number) => (n === 0 ? "-" : brl(n));

const NOMES_MES = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
];
const NUMS_MES = ["1º","2º","3º","4º","5º","6º","7º","8º","9º","10º","11º","12º"];

export function mesReferenciaToHuman(mesRef: string): { mes: string; numero_mes: string } {
  // "2026-01" → { mes: "JANEIRO DE 2026", numero_mes: "1º" }
  const [yy, mm] = mesRef.split("-");
  const idx = parseInt(mm, 10) - 1;
  return {
    mes: `${NOMES_MES[idx]?.toUpperCase() ?? "?"} DE ${yy}`,
    numero_mes: NUMS_MES[idx] ?? "?",
  };
}

export function mesReferenciaToFraseSocio(mesRef: string): string {
  const [yy, mm] = mesRef.split("-");
  const idx = parseInt(mm, 10) - 1;
  return `${NOMES_MES[idx]?.toLowerCase() ?? "?"}-${yy}`;
}

// ----------------------------------------------------------------------------
// Perfil da empresa (CNPJ + nome) — busca em obra_parametros com fallback
// ----------------------------------------------------------------------------
const EMPRESA_NOME_FALLBACK = "Agropecuária Aramburu Ltda";
const EMPRESA_CNPJ_FALLBACK = "30.921.299/0001-88";

async function lerPerfilEmpresa(
  supabase: SupabaseClient<Database>,
): Promise<{ nome: string; cnpj: string }> {
  const { data } = await supabase
    .from("obra_parametros")
    .select("chave, valor_texto")
    .in("chave", ["empresa_nome", "empresa_cnpj"]);
  const m = new Map((data ?? []).map((r) => [r.chave, r.valor_texto ?? ""]));
  return {
    nome: m.get("empresa_nome")?.trim() || EMPRESA_NOME_FALLBACK,
    cnpj: m.get("empresa_cnpj")?.trim() || EMPRESA_CNPJ_FALLBACK,
  };
}

// ----------------------------------------------------------------------------
// Capa Empresa
// ----------------------------------------------------------------------------
export interface BuildCapaEmpresaArgs {
  mesReferencia: string;                 // "YYYY-MM"
  preparadoPor?: string;
}

export async function buildCapaEmpresa(
  supabase: SupabaseClient<Database>,
  args: BuildCapaEmpresaArgs,
): Promise<CapaEmpresaPayload> {
  const { mes, numero_mes } = mesReferenciaToHuman(args.mesReferencia);

  // Saldos por banco no mês (vw existente) + cadastros para enriquecer apelido/banco
  const [porBancoRes, contasRes, perfilEmpresa] = await Promise.all([
    supabase.from("v_saldo_por_banco_mensal").select("*").eq("mes_referencia", args.mesReferencia),
    supabase.from("contas_bancarias_empresa").select("id, nome, apelido, banco, ordem, ativa").eq("ativa", true).order("ordem", { ascending: true, nullsFirst: false }),
    lerPerfilEmpresa(supabase),
  ]);
  const porBanco = porBancoRes.data;
  const contasCadastradas = contasRes.data ?? [];
  const cadastroPorId = new Map(contasCadastradas.map((c) => [c.id, c]));

  // Soma a variação por banco (uma row por banco), montando a lista dinâmica.
  const totalPorContaId = new Map<string, number>();
  for (const r of porBanco ?? []) {
    if (!r.conta_bancaria_id) continue;
    const v = Math.abs(Number(r.variacao_no_mes ?? 0));
    totalPorContaId.set(r.conta_bancaria_id, (totalPorContaId.get(r.conta_bancaria_id) ?? 0) + v);
  }

  // Lista de bancos preserva a ordem do cadastro; contas sem movimento aparecem zeradas.
  const bancos = contasCadastradas.map((c) => {
    const total = totalPorContaId.get(c.id) ?? 0;
    return {
      nome:           c.apelido ?? c.nome,
      nome_completo:  c.nome,
      slug:           (c.banco ?? c.nome ?? "").toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""),
      total:          brl(total),
    };
  });
  const total_geral = Array.from(totalPorContaId.values()).reduce((a, b) => a + b, 0);
  void cadastroPorId;

  // Transações do mês agrupadas por tipo_despesa (fixa/variavel/eventual)
  const { data: ts } = await supabase
    .from("transacoes_empresa")
    .select(`
      data, descricao, fornecedor_nome, valor, forma_pgto, tipo_despesa,
      conta_bancaria:contas_bancarias_empresa(apelido, nome)
    `)
    .eq("mes_referencia", args.mesReferencia)
    .in("tipo_despesa", ["fixa","variavel","eventual"])
    .order("data");

  type ListItem = { vencimento: string; valor: string; descricao: string; banco: string; pgto: string };
  const buckets: Record<"fixa" | "variavel" | "eventual", { items: ListItem[]; total: number }> = {
    fixa:     { items: [], total: 0 },
    variavel: { items: [], total: 0 },
    eventual: { items: [], total: 0 },
  };

  type TransacaoComConta = {
    data: string;
    descricao: string | null;
    fornecedor_nome: string | null;
    valor: number;
    forma_pgto: string;
    tipo_despesa: "fixa" | "variavel" | "eventual" | "periodica" | "sem";
    conta_bancaria: { apelido: string | null; nome: string } | null;
  };

  for (const t of (ts ?? []) as unknown as TransacaoComConta[]) {
    const tipo = t.tipo_despesa;
    if (tipo !== "fixa" && tipo !== "variavel" && tipo !== "eventual") continue;
    const valor = Math.abs(Number(t.valor));
    buckets[tipo].total += valor;
    buckets[tipo].items.push({
      vencimento: new Date(t.data).toLocaleDateString("pt-BR"),
      valor: brl(valor),
      descricao: t.descricao ?? t.fornecedor_nome ?? "—",
      banco: t.conta_bancaria?.apelido ?? t.conta_bancaria?.nome ?? "—",
      pgto: t.forma_pgto,
    });
  }

  return {
    empresa: perfilEmpresa.nome,
    cnpj: perfilEmpresa.cnpj,
    fazenda: "FAZENDA ARAMBURU",
    mes_referencia: mes.split(" ")[0],
    numero_mes,
    realizado_em: new Date().toLocaleDateString("pt-BR"),
    preparado_por: args.preparadoPor ?? "Adriane Estefany",
    bancos,
    total_geral: brl(total_geral),
    despesas_fixas: buckets.fixa.items,
    total_fixas: brl(buckets.fixa.total),
    despesas_variaveis: buckets.variavel.items,
    total_variaveis: brl(buckets.variavel.total),
    despesas_eventuais: buckets.eventual.items,
    total_eventuais: brl(buckets.eventual.total),
  };
}

// ----------------------------------------------------------------------------
// Capa Sócio
// ----------------------------------------------------------------------------
export interface BuildCapaSocioArgs {
  mesReferencia: string;
  socioId: string;
  preparadoPor?: string;
}

export async function buildCapaSocio(
  supabase: SupabaseClient<Database>,
  args: BuildCapaSocioArgs,
): Promise<CapaSocioPayload> {
  const { mes, numero_mes } = mesReferenciaToHuman(args.mesReferencia);

  const { data: socio } = await supabase
    .from("socios").select("*").eq("id", args.socioId).maybeSingle();
  if (!socio) throw new Error(`Sócio ${args.socioId} não encontrado`);

  const { data: contas } = await supabase
    .from("contas_bancarias_socio")
    .select("*")
    .eq("socio_id", args.socioId)
    .eq("ativa", true)
    .order("ordem");

  const { data: lancamentos } = await supabase
    .from("transacoes_socio")
    .select(`
      data, classificacao_pessoal, descricao, valor, conta_bancaria_socio_id,
      conta_bancaria_socio_nome,
      conta_bancaria:contas_bancarias_socio(id, banco, nome)
    `)
    .eq("socio_id", args.socioId)
    .eq("mes_referencia", args.mesReferencia)
    .order("data");

  type LancamentoSocio = {
    data: string;
    classificacao_pessoal: string;
    descricao: string;
    valor: number;
    conta_bancaria_socio_id: string | null;
    conta_bancaria_socio_nome: string | null;
    conta_bancaria: { id: string; banco: string | null; nome: string } | null;
  };

  type BucketKey = "imovel" | "familia" | "renda" | "pessoais" | "fazenda";
  const buckets: Record<BucketKey, { items: { vencimento: string; valor: string; descricao: string; banco: string }[]; total: number }> = {
    imovel:   { items: [], total: 0 },
    familia:  { items: [], total: 0 },
    renda:    { items: [], total: 0 },
    pessoais: { items: [], total: 0 },
    fazenda:  { items: [], total: 0 },
  };
  const toBucket: Record<string, BucketKey> = {
    "1.01": "imovel",   "1.1 - Imóvel": "imovel",
    "1.02": "familia",  "1.2 - Família": "familia",
    "1.03": "renda",    "1.3 - Renda Mensal/Qualidade de Vida": "renda",
    "1.04": "pessoais", "1.4 - Despesas Pessoais": "pessoais",
    "1.05": "fazenda",  "1.5 - Fazenda Aramburu": "fazenda",
  };

  // Agrupa por conta bancária do sócio (não por substring "cora/sicredi" no nome)
  const totalPorContaId = new Map<string, number>();
  for (const l of (lancamentos ?? []) as unknown as LancamentoSocio[]) {
    const k = toBucket[l.classificacao_pessoal];
    if (!k) continue;
    const valor = Math.abs(Number(l.valor));
    buckets[k].total += valor;
    const banco = l.conta_bancaria?.banco ?? l.conta_bancaria_socio_nome ?? "—";
    buckets[k].items.push({
      vencimento: new Date(l.data).toLocaleDateString("pt-BR"),
      valor: brl(valor),
      descricao: l.descricao,
      banco,
    });
    const cid = l.conta_bancaria?.id ?? l.conta_bancaria_socio_id;
    if (cid) totalPorContaId.set(cid, (totalPorContaId.get(cid) ?? 0) + valor);
  }

  // Lista de bancos do sócio (todas as contas ativas, mesmo sem movimento).
  // A tabela contas_bancarias_socio não tem campo `apelido`, usa-se o nome curto.
  const bancos = (contas ?? []).map((c) => ({
    nome:           c.banco ?? c.nome ?? "—",
    nome_completo:  c.nome,
    slug:           (c.banco ?? c.nome ?? "").toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""),
    total:          brl(totalPorContaId.get(c.id) ?? 0),
  }));
  const total_geral = Array.from(totalPorContaId.values()).reduce((a, b) => a + b, 0);

  return {
    nome_socio: socio.nome_completo,
    cpf_socio: "—",
    fazenda: "FAZENDA ARAMBURU",
    mes_referencia: mes.split(" ")[0],
    numero_mes,
    realizado_em: new Date().toLocaleDateString("pt-BR"),
    preparado_por: args.preparadoPor ?? "Adriane Estefany",
    periodo: mesReferenciaToFraseSocio(args.mesReferencia),
    imovel: buckets.imovel.items,
    total_imovel: brl(buckets.imovel.total),
    familia: buckets.familia.items,
    total_familia: brl(buckets.familia.total),
    renda_mensal: buckets.renda.items,
    total_renda_mensal: brl(buckets.renda.total),
    despesas_pessoais: buckets.pessoais.items,
    total_despesas_pessoais: brl(buckets.pessoais.total),
    fazenda_aramburu: buckets.fazenda.items,
    total_fazenda_aramburu: brl(buckets.fazenda.total),
    obs_fazenda: "",
    contratos_venda: [],
    total_contratos_venda: brl(0),
    contas_socio: (contas ?? []).map((c) => ({
      banco: c.banco ?? "—",
      agencia: c.agencia ?? "—",
      numero: c.numero_conta
        ? `${c.numero_conta}${c.digito ? "-" + c.digito : ""}`
        : c.nome,
      tipo: c.tipo ?? "Corrente",
    })),
    bancos,
    total_geral: brl(total_geral),
  };
}

// ----------------------------------------------------------------------------
// Relatório Contábil — versão inicial: usa o JSON-exemplo aprovado.
//
// O relatório contábil é gigantesco (44KB de JSON com transações detalhadas
// por banco e categoria). Vamos construí-lo iterativamente. Por enquanto,
// o builder devolve o esqueleto preenchido com totais por banco/categoria
// do mês — as observações ficam vazias, a serem editadas via UI no futuro.
// ----------------------------------------------------------------------------
export interface BuildRelatorioContabilArgs {
  mesReferencia: string;
  preparadoPor?: string;
}

export async function buildRelatorioContabil(
  supabase: SupabaseClient<Database>,
  args: BuildRelatorioContabilArgs,
): Promise<RelatorioContabilPayload> {
  const { mes } = mesReferenciaToHuman(args.mesReferencia);

  // Lê transações do mês com todos os joins
  const { data } = await supabase
    .from("transacoes_empresa")
    .select(`
      data, valor, status, descricao, fornecedor_nome,
      conta_contabil:classificacao_financeira!transacoes_empresa_conta_contabil_cod_fkey(codigo, nome, natureza),
      centro_custo:classificacao_financeira!transacoes_empresa_centro_custo_cod_fkey(codigo, nome),
      conta_bancaria:contas_bancarias_empresa(nome, apelido, banco)
    `)
    .eq("mes_referencia", args.mesReferencia)
    .order("data");

  type T = {
    data: string;
    valor: number;
    status: string;
    descricao: string | null;
    fornecedor_nome: string | null;
    conta_contabil: { codigo: string; nome: string; natureza: "entrada" | "saida" } | null;
    centro_custo: { codigo: string; nome: string } | null;
    conta_bancaria: { nome: string; apelido: string | null; banco: string | null } | null;
  };

  const ts = (data ?? []) as unknown as T[];

  // Agrupa: tipo_secao (ENTRADAS/SAÍDAS) → banco → conta_contabil → centro_custo → transações
  interface SubAcc { codigo: string; nome: string; total: number; transacoes: T[] }
  interface CatAcc { codigo: string; nome: string; total: number; subs: Map<string, SubAcc> }
  interface BlcAcc { banco: string; banco_tipo: string; tipo_secao: "ENTRADAS" | "SAÍDAS"; cats: Map<string, CatAcc> }

  const blocos = new Map<string, BlcAcc>();
  for (const t of ts) {
    if (!t.conta_contabil) continue;
    const tipo: "ENTRADAS" | "SAÍDAS" = t.conta_contabil.natureza === "entrada" ? "ENTRADAS" : "SAÍDAS";
    const bancoNome = (t.conta_bancaria?.nome ?? "Sem Banco").toUpperCase();
    const bancoTipo = (t.conta_bancaria?.banco ?? "").toLowerCase().replace(/\s+/g, "_");
    const key = `${tipo}|${bancoNome}`;
    const blk = blocos.get(key) ?? { banco: bancoNome, banco_tipo: bancoTipo, tipo_secao: tipo, cats: new Map() };
    const cKey = t.conta_contabil.codigo;
    const cat = blk.cats.get(cKey) ?? { codigo: cKey, nome: t.conta_contabil.nome.toUpperCase(), total: 0, subs: new Map() };
    const sKey = t.centro_custo?.codigo ?? "—";
    const sub = cat.subs.get(sKey) ?? {
      codigo: sKey, nome: t.centro_custo?.nome ?? "—", total: 0, transacoes: [] as T[],
    };
    sub.total += Math.abs(Number(t.valor));
    cat.total += Math.abs(Number(t.valor));
    sub.transacoes.push(t);
    cat.subs.set(sKey, sub);
    blk.cats.set(cKey, cat);
    blocos.set(key, blk);
  }

  return {
    empresa: "AGROPECUÁRIA ARAMBURU",
    mes: mes,
    preparado_por: args.preparadoPor ?? "Adriane Estefany",
    observacoes: [],   // editável via UI; vazio por padrão
    blocos: Array.from(blocos.values()).map((b) => ({
      tipo_secao: b.tipo_secao,
      banco: b.banco,
      banco_tipo: b.banco_tipo || "outro",
      nota_bloco: null,
      categorias: Array.from(b.cats.values()).map((c) => ({
        codigo: c.codigo,
        nome: c.nome,
        total: brl(c.total),
        nota_geral: null,
        nota: null,
        subcategorias: Array.from(c.subs.values()).map((s) => ({
          codigo: s.codigo,
          nome: s.nome,
          total: brl(s.total),
          transacoes: s.transacoes.map((t) => ({
            data: new Date(t.data).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
            nome: t.fornecedor_nome ?? "—",
            detalhe: t.descricao ?? "",
            valor: brl(Math.abs(Number(t.valor))),
            has_nota: false,
            nota: null,
          })),
        })),
      })),
    })),
  };
}

// ----------------------------------------------------------------------------
// Relatório Sócios (infográfico) — espelha o PDF Canva atual.
// Todas as seções vêm das views/tabelas reais. Cores fixas seguem a paleta
// aprovada pelo template PDFMonkey.
// ----------------------------------------------------------------------------
export interface BuildRelatorioSociosArgs {
  mesReferencia: string;
  preparadoPor?: string;
  /** Overrides opcionais que a UI pode injetar antes de gerar. */
  overrides?: {
    saldo_inicial_texto?: string;
    nota_entradas?:           string;
    nota_saidas?:             string;
    nota_obra_sede?:          string;
    nota_despesas_classif?:   string;
    nota_impostos?:           string;
    nota_distribuicao_lucro?: string;
    obs_fazenda?:             string;
  };
}

// Paleta usada pelo template (idêntica ao JSON-exemplo aprovado).
const CORES_SAIDA: Record<string, { classe: string; hex: string }> = {
  "2.1": { classe: "verde",     hex: "#4ade80" },
  "2.2": { classe: "verdeEsc",  hex: "#22c55e" },
  "2.3": { classe: "azul",      hex: "#60a5fa" },
  "2.4": { classe: "azul",      hex: "#3b82f6" },
  "2.5": { classe: "azul",      hex: "#1d4ed8" },
  "2.6": { classe: "roxo",      hex: "#8b5cf6" },
  "2.7": { classe: "roxoClaro", hex: "#c084fc" },
  "2.9": { classe: "rosa",      hex: "#ec4899" },
};

const NOMES_SAIDA: Record<string, string> = {
  "2.1": "Despesas Administrativas",
  "2.2": "Despesas com Pessoal",
  "2.3": "Operação da Propriedade",
  "2.4": "Serviços Terceirizados",
  "2.5": "Financeiras e Bancárias",
  "2.6": "Investimentos em Capital (aplicações)",
  "2.7": "Investimentos em Imobilizado Operacional (obra da sede)",
  "2.9": "Outras Saídas",
};

const OBRA_LABELS: Record<string, { label: string; cor: string; icone: string }> = {
  projeto:      { label: "PROJETO",         cor: "#60a5fa", icone: "📐" },
  ordem_compra: { label: "ORDEM DE COMPRA", cor: "#fb923c", icone: "🧾" },
  medicao_01:   { label: "MEDIÇÃO",         cor: "#ec4899", icone: "👷" },
  medicao_02:   { label: "MEDIÇÃO",         cor: "#ec4899", icone: "👷" },
  medicao_03:   { label: "MEDIÇÃO",         cor: "#ec4899", icone: "👷" },
  medicao_04:   { label: "MEDIÇÃO",         cor: "#ec4899", icone: "👷" },
  medicao_05:   { label: "MEDIÇÃO",         cor: "#ec4899", icone: "👷" },
  medicao_06:   { label: "MEDIÇÃO",         cor: "#ec4899", icone: "👷" },
  outras:       { label: "OUTRAS",          cor: "#a3e635", icone: "🛒" },
  retencao:     { label: "OUTRAS",          cor: "#a3e635", icone: "🛒" },
  sem:          { label: "OUTRAS",          cor: "#a3e635", icone: "🛒" },
};

const PCT_NUM = (parte: number, total: number) => total > 0 ? (parte / total) * 100 : 0;

export async function buildRelatorioSocios(
  supabase: SupabaseClient<Database>,
  args: BuildRelatorioSociosArgs,
): Promise<RelatorioSociosPayload> {
  const { mes } = mesReferenciaToHuman(args.mesReferencia);
  const overrides = args.overrides ?? {};
  const [ano, mesNumStr] = args.mesReferencia.split("-");
  const mesNum = parseInt(mesNumStr, 10);

  // ─── Queries paralelas ────────────────────────────────────────────────────
  const [
    porContaRes,
    porCentroRes,
    saldoBancosRes,
    obraRes,
    despesasTipoRes,
    impostosRes,
    armazenagemRes,
    distLucroYtdRes,
  ] = await Promise.all([
    supabase.from("v_por_conta_contabil_mensal").select("*").eq("mes_referencia", args.mesReferencia),
    supabase.from("v_por_centro_custo_mensal").select("*").eq("mes_referencia", args.mesReferencia),
    supabase.from("v_saldo_por_banco_mensal").select("*").eq("mes_referencia", args.mesReferencia),
    supabase.from("transacoes_empresa")
      .select("obs_obra, valor")
      .eq("mes_referencia", args.mesReferencia)
      .eq("centro_custo_cod", "2.7.2"),
    supabase.from("transacoes_empresa")
      .select("tipo_despesa, valor, conta_contabil_cod")
      .eq("mes_referencia", args.mesReferencia)
      .neq("status", "saldo_inicial"),
    supabase.from("v_por_centro_custo_mensal")
      .select("*")
      .eq("mes_referencia", args.mesReferencia)
      .in("centro_custo_cod", ["2.1.6", "2.2.2"]),
    supabase.from("v_safra_depositos_calculado")
      .select("cultura, sc_liquida")
      .neq("status", "vendido_total"),
    supabase.from("v_distribuicao_lucro_mensal")
      .select("classificacao_pessoal, valor_total, mes_referencia")
      .gte("mes_referencia", `${ano}-01`)
      .lte("mes_referencia", args.mesReferencia),
  ]);

  // ─── Totais por conta contábil no mês ─────────────────────────────────────
  const totByConta: Record<string, number> = {};
  for (const r of porContaRes.data ?? []) {
    totByConta[r.conta_contabil_cod] = Math.abs(Number(r.valor_total));
  }
  const get = (c: string) => totByConta[c] ?? 0;

  // ─── Visão geral ──────────────────────────────────────────────────────────
  const receita        = get("1.2") + get("1.3");
  const resgate        = get("1.8");
  const outros_recb    = get("1.9");
  const distrib_lucro  = get("2.8");
  const fazenda_total =
    get("2.1") + get("2.2") + get("2.3") + get("2.4") + get("2.5") + get("2.6") + get("2.7") + get("2.9");
  const total_despesas = fazenda_total + distrib_lucro;
  const pctDistrib = PCT_NUM(distrib_lucro, total_despesas);
  const pctFazenda = PCT_NUM(fazenda_total, total_despesas);

  // ─── Saldo inicial dos bancos (texto auto-gerado) ─────────────────────────
  let saldoInicialTexto = overrides.saldo_inicial_texto ?? "";
  if (!saldoInicialTexto) {
    const partes: string[] = [];
    let totalIni = 0;
    for (const r of (saldoBancosRes.data ?? []).sort((a, b) => (a.conta_bancaria_nome ?? "").localeCompare(b.conta_bancaria_nome ?? ""))) {
      const v = Number(r.saldo_inicial_no_mes ?? 0);
      if (v > 0) {
        partes.push(`R$ ${fmt(v)} no ${r.conta_bancaria_nome ?? "—"}`);
        totalIni += v;
      }
    }
    const mesNomeLower = NOMES_MES[mesNum - 1]?.toLowerCase() ?? "";
    saldoInicialTexto = partes.length > 0
      ? `Saldo inicial de caixa em ${mesNomeLower}: R$ ${fmt(totalIni)}, distribuído entre ${partes.join(", ")}.`
      : `Saldo inicial de caixa em ${mesNomeLower}: não há saldo inicial registrado para os bancos cadastrados.`;
  }

  // ─── Entradas ──────────────────────────────────────────────────────────────
  const receitaSoja  = get("1.2.1");
  const receitaMilho = get("1.2.2");
  const estorno      = get("1.6");

  // Altura: proporção ao maior valor de entrada (até 95)
  const maxEntrada = Math.max(receitaSoja, receitaMilho, estorno, resgate, outros_recb);
  const altura = (v: number) => maxEntrada > 0 ? Math.round((v / maxEntrada) * 95) : 0;

  const entradasItens = [
    { label: "Receita de Arrendamento de Terras - Soja",  valor: receitaSoja  > 0 ? fmt(receitaSoja)  : "-", cor: "verde",    altura: altura(receitaSoja) },
    { label: "Receita de Arrendamento de Terras - Milho", valor: receitaMilho > 0 ? fmt(receitaMilho) : "-", cor: "amarelo",  altura: altura(receitaMilho) },
    { label: "Estorno de Pagamento",                       valor: estorno      > 0 ? fmt(estorno)      : "-", cor: "vermelho", altura: altura(estorno) },
    { label: "Resgate de Aplicações",                      valor: resgate      > 0 ? fmt(resgate)      : "-", cor: "azul",     altura: altura(resgate) },
    { label: "Outros Recebimentos *",                      valor: outros_recb  > 0 ? fmt(outros_recb)  : "-", cor: "roxo",     altura: altura(outros_recb) },
  ];

  // ─── Receitas por cultura ──────────────────────────────────────────────────
  // Soma sacas por cultura nas vendas que pagaram neste mês de referência.
  type VendaPorMes = { cultura: string; sacas_total: number; valor_total: number };
  const { data: vendasMes } = await supabase
    .from("v_vendas_por_mes")
    .select("cultura, sacas_total, valor_total")
    .eq("mes_recebimento", args.mesReferencia);
  const sacasPorCultura: Record<string, number> = {};
  for (const v of (vendasMes ?? []) as VendaPorMes[]) {
    sacasPorCultura[v.cultura] = (sacasPorCultura[v.cultura] ?? 0) + Number(v.sacas_total);
  }

  const totalReceita = receitaSoja + receitaMilho;
  const pctSoja  = PCT_NUM(receitaSoja,  totalReceita);
  const pctMilho = PCT_NUM(receitaMilho, totalReceita);
  const receitas = [
    {
      cultura: "Soja", emoji: "🫛",
      valor: receitaSoja > 0 ? fmt(receitaSoja) : "-",
      sacas: sacasPorCultura["soja"] ? new Intl.NumberFormat("pt-BR").format(sacasPorCultura["soja"]) : (receitaSoja > 0 ? "—" : "0"),
      pct: Number(pctSoja.toFixed(0)),
      pct_txt: `${pctSoja.toFixed(0)}%`,
      ring_dash: Number((pctSoja * 2.638).toFixed(1)),
      cor: "#4ade80",
    },
    {
      cultura: "Milho", emoji: "🌽",
      valor: receitaMilho > 0 ? fmt(receitaMilho) : "-",
      sacas: sacasPorCultura["milho"] ? new Intl.NumberFormat("pt-BR").format(sacasPorCultura["milho"]) : "0",
      pct: Number(pctMilho.toFixed(0)),
      pct_txt: `${pctMilho.toFixed(0)}%`,
      ring_dash: Number((pctMilho * 2.638).toFixed(1)),
      cor: "#fbbf24",
    },
  ];

  // ─── Saídas (8 categorias) ─────────────────────────────────────────────────
  const codigosSaida = ["2.1","2.2","2.3","2.4","2.5","2.6","2.7","2.9"];
  const totalSaida = codigosSaida.reduce((acc, c) => acc + get(c), 0);
  let rotAcc = -90;
  const saidasItens = codigosSaida.map((c) => {
    const valor = get(c);
    const pct = PCT_NUM(valor, totalSaida);
    const dash = Number(pct.toFixed(1));
    const rot = Number(rotAcc.toFixed(2));
    rotAcc += dash * 3.6;
    const cores = CORES_SAIDA[c];
    return {
      label: NOMES_SAIDA[c] ?? c,
      valor: valor > 0 ? fmt(valor) : "-",
      pct: pct < 0.5 && pct > 0 ? "-" : pct.toFixed(1).replace(/\.0$/, ""),
      cor_classe: cores.classe,
      cor_hex:    cores.hex,
      dash,
      rot,
    };
  });

  // ─── Obra da sede (categorias por obs_obra) ───────────────────────────────
  type ObraRow = { obs_obra: string; valor: number };
  const obraTot: Record<string, number> = {};
  let obraTotal = 0;
  for (const r of (obraRes.data ?? []) as ObraRow[]) {
    const bucketKey = OBRA_LABELS[r.obs_obra]?.label ?? "OUTRAS";
    const v = Math.abs(Number(r.valor));
    obraTot[bucketKey] = (obraTot[bucketKey] ?? 0) + v;
    obraTotal += v;
  }
  const obraOrdem = ["PROJETO", "ORDEM DE COMPRA", "MEDIÇÃO", "OUTRAS"];
  const obraIconesPorLabel: Record<string, { cor: string; icone: string }> = {
    "PROJETO":         { cor: "#60a5fa", icone: "📐" },
    "ORDEM DE COMPRA": { cor: "#fb923c", icone: "🧾" },
    "MEDIÇÃO":         { cor: "#ec4899", icone: "👷" },
    "OUTRAS":          { cor: "#a3e635", icone: "🛒" },
  };
  const obraCategorias = obraOrdem.map((lbl) => {
    const v = obraTot[lbl] ?? 0;
    const pct = PCT_NUM(v, obraTotal);
    return {
      label: lbl,
      valor: v > 0 ? fmt(v) : "-",
      pct: v > 0 ? pct.toFixed(0) : "-",
      cor: obraIconesPorLabel[lbl].cor,
      icone: obraIconesPorLabel[lbl].icone,
    };
  });
  const obraBarra = obraOrdem
    .filter((lbl) => lbl !== "PROJETO" && (obraTot[lbl] ?? 0) > 0)
    .map((lbl) => ({ cor: obraIconesPorLabel[lbl].cor, altura: Number(PCT_NUM(obraTot[lbl] ?? 0, obraTotal).toFixed(0)) }));

  // ─── Despesas por tipo (fixa, variavel, eventual, periodica) ───────────────
  type DespTipoRow = { tipo_despesa: string; valor: number; conta_contabil_cod: string };
  const tipos = { fixa: 0, variavel: 0, eventual: 0, periodica: 0 };
  for (const r of (despesasTipoRes.data ?? []) as DespTipoRow[]) {
    // Excluímos investimentos (2.6, 2.7) e distribuição (2.8) — são movimentações
    const cod = r.conta_contabil_cod;
    if (cod.startsWith("2.6") || cod.startsWith("2.7") || cod.startsWith("2.8")) {
      // Mantém EVENTUAIS de obra da sede (2.7) por convenção — mas exclui aplicações (2.6) e distribuição
      if (cod.startsWith("2.6") || cod.startsWith("2.8")) continue;
    }
    if (r.tipo_despesa in tipos) {
      (tipos as Record<string, number>)[r.tipo_despesa] += Math.abs(Number(r.valor));
    }
  }
  const totalDespClass = tipos.fixa + tipos.variavel + tipos.eventual + tipos.periodica;
  const pctFixas    = PCT_NUM(tipos.fixa,      totalDespClass);
  const pctVar      = PCT_NUM(tipos.variavel,  totalDespClass);
  const pctEvent    = PCT_NUM(tipos.eventual,  totalDespClass);
  const pctPer      = PCT_NUM(tipos.periodica, totalDespClass);

  // Donut rotations: começa eventuais em -90 (topo) e acumula no sentido horário
  const segOrdem: Array<{ k: keyof typeof tipos; pct: number; cor: string }> = [
    { k: "eventual",  pct: pctEvent, cor: "#4ade80" },
    { k: "fixa",      pct: pctFixas, cor: "#fbbf24" },
    { k: "variavel",  pct: pctVar,   cor: "#cbd5e1" },
    { k: "periodica", pct: pctPer,   cor: "#3b82f6" },
  ];
  let acc = -90;
  const donutSegs = segOrdem.map((s) => {
    const dash = Number(s.pct.toFixed(1));
    const rot = Number(acc.toFixed(2));
    acc += dash * 3.6;
    return { cor: s.cor, dash, rot };
  });
  const [evSeg, fxSeg, vrSeg, prSeg] = donutSegs;
  const realizadoPct = totalReceita > 0 ? Number(((totalDespClass / totalReceita) * 100).toFixed(0)) : 0;

  // ─── Impostos ──────────────────────────────────────────────────────────────
  type ImpostoRow = { centro_custo_cod: string; valor_total: number };
  const impMap: Record<string, number> = {};
  for (const r of (impostosRes.data ?? []) as ImpostoRow[]) {
    impMap[r.centro_custo_cod] = Math.abs(Number(r.valor_total));
  }
  const impAdmin = impMap["2.1.6"] ?? 0;
  const impFolha = impMap["2.2.2"] ?? 0;

  // ─── Armazenagem ───────────────────────────────────────────────────────────
  type ArmRow = { cultura: string; sc_liquida: number };
  const armPorCultura: Record<string, number> = {};
  for (const r of (armazenagemRes.data ?? []) as ArmRow[]) {
    armPorCultura[r.cultura] = (armPorCultura[r.cultura] ?? 0) + Number(r.sc_liquida);
  }
  const armazenagem = [
    { cultura: "Soja",  emoji: "🫛", valor: armPorCultura["soja"]  ? new Intl.NumberFormat("pt-BR").format(armPorCultura["soja"])  + " sc" : "-", rotulo: "Armazém", cor: "#4ade80" },
    { cultura: "Milho", emoji: "🌽", valor: armPorCultura["milho"] ? new Intl.NumberFormat("pt-BR").format(armPorCultura["milho"]) + " sc" : "-", rotulo: "Armazém", cor: "#fbbf24" },
  ];

  // ─── Saídas distribuição (4 itens) ─────────────────────────────────────────
  const aplicacao = get("2.6");
  const imobOp    = get("2.7");
  const demaisFazenda = get("2.1") + get("2.2") + get("2.3") + get("2.4") + get("2.5") + get("2.9");
  const totalSaiDist  = distrib_lucro + aplicacao + imobOp + demaisFazenda;
  const itensDist: Array<{ label: string; valor: number; cor: string }> = [
    { label: "Distribuição de Lucro",                           valor: distrib_lucro,  cor: "#3b82f6" },
    { label: "Investimentos em Capital (aplicações)",           valor: aplicacao,      cor: "#22c55e" },
    { label: "Investimentos em Imobilizado Operacional (obra da sede)", valor: imobOp,         cor: "#86efac" },
    { label: "Demais despesas da Fazenda",                      valor: demaisFazenda,  cor: "#4ade80" },
  ];
  let rotDist = -90;
  const saidasDistItens = itensDist.map((i) => {
    const pct = PCT_NUM(i.valor, totalSaiDist);
    const dash = Number(pct.toFixed(1));
    const rot = Number(rotDist.toFixed(2));
    rotDist += dash * 3.6;
    return {
      label: i.label,
      valor: i.valor > 0 ? fmt(i.valor) : "-",
      pct: Number(pct.toFixed(1)),
      cor: i.cor,
      dash, rot,
    };
  });

  // ─── Distribuição de lucro YTD (Imóvel, Família, Renda, ...) ───────────────
  type DistRow = { classificacao_pessoal: string; valor_total: number };
  const distYtd: Record<string, number> = {};
  for (const r of (distLucroYtdRes.data ?? []) as DistRow[]) {
    distYtd[r.classificacao_pessoal] = (distYtd[r.classificacao_pessoal] ?? 0) + Math.abs(Number(r.valor_total));
  }
  const distTotal = Object.values(distYtd).reduce((a, b) => a + b, 0);

  const distCorPorCod: Record<string, string> = {
    "1.01": "#86efac",
    "1.02": "#7dd3fc",
    "1.03": "#fb923c",
    "1.04": "#fbbf24",
    "1.05": "#818cf8",
    "1.06": "#c084fc",
  };
  const distLabelPorCod: Record<string, string> = {
    "1.01": "Imóvel",
    "1.02": "Família",
    "1.03": "Renda Mensal/Qualidade de Vida",
    "1.04": "Despesas Pessoais",
    "1.05": "Fazenda Aramburu",
    "1.06": "Contratos de Venda",
  };
  const distCategorias = Object.keys(distLabelPorCod).map((cod) => {
    const v = distYtd[cod] ?? 0;
    const pct = PCT_NUM(v, distTotal);
    return {
      label: distLabelPorCod[cod],
      valor: v > 0 ? fmt(v) : "-",
      pct:   Number(pct.toFixed(0)),
      cor:   distCorPorCod[cod],
    };
  });

  // ─── Distribuição Aramburu (3 categorias resumindo despesas fazenda) ──────
  const energia    = (porCentroRes.data ?? []).find((r) => r.centro_custo_cod === "2.3.2")?.valor_total ?? 0;
  const despPessoal = get("2.2");
  const despOpDiv  = (get("2.3") + get("2.4") + get("2.5") + get("2.1") + get("2.9")) - Math.abs(Number(energia));
  const totFaz = Math.abs(Number(energia)) + despOpDiv + despPessoal;
  const segsFaz = [
    { label: "Despesa Fixa",                   sub: "Energia Elétrica",                              v: Math.abs(Number(energia)), cor: "#fbbf24" },
    { label: "Despesas Operacionais Diversas", sub: "Serviços, Taxas, Diárias, Materiais, etc",      v: Math.max(despOpDiv, 0),    cor: "#86efac" },
    { label: "Despesa com Pessoal",            sub: "Folha de Pagamento, Benefícios, Férias e Rescisões", v: despPessoal,           cor: "#bae6fd" },
  ];
  let rotF = -90;
  const distribuicaoAramburu = segsFaz.map((s) => {
    const pct = PCT_NUM(s.v, totFaz);
    const dash = Number(pct.toFixed(1));
    const rot = Number(rotF.toFixed(2));
    rotF += dash * 3.6;
    return {
      label: s.label, sub: s.sub,
      valor: s.v > 0 ? fmt(s.v) : "-",
      pct:   Number(pct.toFixed(1)),
      cor:   s.cor,
      dash, rot,
    };
  });

  // ─── Notas padrão (editáveis via overrides) ────────────────────────────────
  const notaEntradas = overrides.nota_entradas ?? "Outros Recebimentos: correspondem a entradas provenientes de transferências internas entre contas da empresa, sem impacto no resultado operacional.";
  const notaSaidas   = overrides.nota_saidas   ?? "Distribuição de Lucro não está considerada nesta saída, sendo contabilizadas exclusivamente as movimentações financeiras da empresa Agropecuária Aramburu Ltda.";
  const notaObra     = overrides.nota_obra_sede ?? (obraTotal > 0
    ? `O valor investido na obra da sede no mês corresponde a R$ ${fmt(obraTotal)}.`
    : "");
  const notaDespClass = overrides.nota_despesas_classif ?? "Despesas eventuais são gastos pontuais, como os custos da obra da sede. Despesas periódicas são aquelas realizadas em intervalos específicos, trimestral ou anual.";
  const notaImpostos = overrides.nota_impostos ?? "Administrativas compreendem impostos periódicos, como tributos trimestrais, diferencial de ICMS, taxas, CCIR, ITR, entre outros. Impostos retidos sobre notas fiscais integram o valor da despesa de origem.";
  const notaDistLucro = overrides.nota_distribuicao_lucro ?? "";

  return {
    fazenda: "ARAMBURU",
    tipo_relatorio: "RELATÓRIO FINANCEIRO",
    mes,
    preparado_por: args.preparadoPor ?? "Adriane Estefany Ramires Bento",

    visao_geral: {
      receita:            fmt(receita),
      resgate:            fmt(resgate),
      aplicacao:          fmt(aplicacao),
      total_despesas:     fmt(total_despesas),
      distribuicao_lucro: fmt(distrib_lucro),
      fazenda_aramburu:   fmt(fazenda_total),
      donut_segments: [
        { cor: "#fdba74", dash: Number(pctDistrib.toFixed(1)), rot: -90 },
        { cor: "#f97316", dash: Number(pctFazenda.toFixed(1)), rot: -90 + Number((pctDistrib * 3.6).toFixed(2)) },
      ],
      donut_r: 15.915,
      donut_cx: 21,
      donut_cy: 21,
      saldo_inicial_texto: saldoInicialTexto,
    },

    entradas: { itens: entradasItens, nota: notaEntradas },

    receitas,

    saidas: { itens: saidasItens, nota: notaSaidas },

    obra_sede: { categorias: obraCategorias, barra: obraBarra, nota: notaObra },

    despesas_classificacao: {
      fixas:      { valor: fmt(tipos.fixa),      pct: Number(pctFixas.toFixed(1)), cor: "#fbbf24", dash: fxSeg?.dash ?? 0, rot: fxSeg?.rot ?? 0 },
      variaveis:  { valor: fmt(tipos.variavel),  pct: Number(pctVar.toFixed(1)),   cor: "#cbd5e1", dash: vrSeg?.dash ?? 0, rot: vrSeg?.rot ?? 0 },
      eventuais:  { valor: fmt(tipos.eventual),  pct: Number(pctEvent.toFixed(1)), cor: "#4ade80", dash: evSeg?.dash ?? 0, rot: evSeg?.rot ?? 0 },
      periodicas: { valor: fmt(tipos.periodica), pct: Number(pctPer.toFixed(1)),   cor: "#3b82f6", dash: prSeg?.dash ?? 0, rot: prSeg?.rot ?? 0 },
      realizado_pct: realizadoPct,
      realizado_ring_dash: Number((realizadoPct * 2.638).toFixed(1)),
      saldo: fmt(Math.max(totalReceita - totalDespClass, 0)),
      donut_segs: donutSegs,
      nota: notaDespClass,
    },

    impostos: {
      administrativa: { label: "Administrativa",     sub: "Taxas e Impostos (ITR, INCRA, etc.)", valor: fmt(impAdmin) },
      folha:          { label: "Folha de Pagamento", sub: "Encargos Sociais (INSS, FGTS, etc.)", valor: fmt(impFolha) },
      realizado: fmt(impAdmin + impFolha),
      nota: notaImpostos,
    },

    armazenagem,

    saidas_distribuicao: { itens: saidasDistItens },

    distribuicao_lucro: {
      categorias: distCategorias,
      meses: ["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"],
      nota: notaDistLucro,
    },

    distribuicao_aramburu: distribuicaoAramburu,
  };
}
