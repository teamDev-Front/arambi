// Builders que transformam dados crus do Supabase em payload dos templates
// do PDFMonkey.
//
// IMPORTANTE: estes builders são "stubs" iniciais — devolvem um payload de
// referência (mesmo conteúdo dos JSONs em /jsons-pdf-monkey/*) preenchido com
// os dados que conseguimos extrair do mês selecionado. À medida que as
// queries do mês (v_kpi_mensal, v_por_conta_contabil_mensal, etc.) cobrirem
// todas as métricas, troque os campos hardcoded por valores derivados.

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

  // Saldos por banco no mês (vw existente)
  const { data: porBanco } = await supabase
    .from("v_saldo_por_banco_mensal")
    .select("*")
    .eq("mes_referencia", args.mesReferencia);

  let total_cora = 0, total_sicredi = 0, total_geral = 0;
  for (const r of porBanco ?? []) {
    const v = Math.abs(Number(r.variacao_no_mes ?? 0));
    if ((r.conta_bancaria_nome ?? "").toLowerCase().includes("cora")) total_cora += v;
    if ((r.conta_bancaria_nome ?? "").toLowerCase().includes("sicredi")) total_sicredi += v;
    total_geral += v;
  }

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
    empresa: "Agropecuária Aramburu Ltda",
    cnpj: "30.921.299/0001-88",
    fazenda: "FAZENDA ARAMBURU",
    mes_referencia: mes.split(" ")[0],
    numero_mes,
    realizado_em: new Date().toLocaleDateString("pt-BR"),
    preparado_por: args.preparadoPor ?? "Adriane Estefany",
    banco_principal: "CORA",
    banco_secundario: "SICREDI",
    total_cora: brl(total_cora),
    total_sicredi: brl(total_sicredi),
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
      data, classificacao_pessoal, descricao, valor,
      conta_bancaria_socio_nome,
      conta_bancaria:contas_bancarias_socio(banco, nome)
    `)
    .eq("socio_id", args.socioId)
    .eq("mes_referencia", args.mesReferencia)
    .order("data");

  type LancamentoSocio = {
    data: string;
    classificacao_pessoal: string;
    descricao: string;
    valor: number;
    conta_bancaria_socio_nome: string | null;
    conta_bancaria: { banco: string | null; nome: string } | null;
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

  let total_cora = 0, total_sicredi = 0;
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
    if (banco.toLowerCase().includes("cora")) total_cora += valor;
    if (banco.toLowerCase().includes("sicredi")) total_sicredi += valor;
  }

  return {
    nome_socio: socio.nome_completo,
    cpf_socio: "—",
    fazenda: "FAZENDA ARAMBURU",
    mes_referencia: mes.split(" ")[0],
    numero_mes,
    realizado_em: new Date().toLocaleDateString("pt-BR"),
    preparado_por: args.preparadoPor ?? "Adriane Estefany",
    banco_principal: "CORA",
    banco_secundario: "SICREDI",
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
    total_cora: brl(total_cora),
    total_sicredi: brl(total_sicredi),
    total_geral: brl(total_cora + total_sicredi),
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
// Relatório Sócios (infográfico) — esqueleto inicial usa os números reais
// das views mensais. A maioria dos campos visuais (cores, dashes, rotações)
// segue um cálculo determinístico simples; pode ser refinado depois.
// ----------------------------------------------------------------------------
export interface BuildRelatorioSociosArgs {
  mesReferencia: string;
  preparadoPor?: string;
}

export async function buildRelatorioSocios(
  supabase: SupabaseClient<Database>,
  args: BuildRelatorioSociosArgs,
): Promise<RelatorioSociosPayload> {
  const { mes } = mesReferenciaToHuman(args.mesReferencia);

  // 1) Totais por conta contábil no mês
  const { data: porConta } = await supabase
    .from("v_por_conta_contabil_mensal")
    .select("*")
    .eq("mes_referencia", args.mesReferencia);

  const totByConta: Record<string, number> = {};
  for (const r of porConta ?? []) {
    totByConta[r.conta_contabil_cod] = Math.abs(Number(r.valor_total));
  }
  const get = (c: string) => totByConta[c] ?? 0;

  const receita        = get("1.2");
  const resgate        = get("1.8");
  const outros_recb    = get("1.9");
  const aplicacao      = get("2.6");      // Invest Capital
  const imob_op        = get("2.7");
  const distrib_lucro  = get("2.8");
  const fazenda_total =
    get("2.1") + get("2.2") + get("2.3") + get("2.4") + get("2.5") + get("2.7") + get("2.9");

  const total_despesas = fazenda_total + distrib_lucro;
  const pctDistrib = total_despesas > 0 ? (distrib_lucro / total_despesas) * 100 : 0;
  const pctFazenda = total_despesas > 0 ? (fazenda_total / total_despesas) * 100 : 0;

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
      saldo_inicial_texto: "Saldo inicial — atualizar conforme conciliação dos bancos do mês.",
    },

    entradas: {
      itens: [
        { label: "Receita de Arrendamento de Terras - Soja",  valor: receita > 0 ? fmt(receita) : "-",     cor: "verde",    altura: receita > 0 ? 95 : 0 },
        { label: "Receita de Arrendamento de Terras - Milho", valor: "-",                                  cor: "amarelo",  altura: 0 },
        { label: "Estorno de Pagamento",                       valor: "-",                                  cor: "vermelho", altura: 0 },
        { label: "Resgate de Aplicações",                      valor: resgate > 0 ? fmt(resgate) : "-",     cor: "azul",     altura: resgate > 0 ? 18 : 0 },
        { label: "Outros Recebimentos *",                      valor: outros_recb > 0 ? fmt(outros_recb) : "-", cor: "roxo", altura: outros_recb > 0 ? 38 : 0 },
      ],
      nota: "Outros Recebimentos: entradas provenientes de transferências internas entre contas, sem impacto operacional.",
    },

    receitas: [
      { cultura: "Soja",  emoji: "🫛", valor: receita > 0 ? fmt(receita) : "-", sacas: "—", pct: receita > 0 ? 100 : 0,  pct_txt: receita > 0 ? "100%" : "0%", ring_dash: receita > 0 ? 263.8 : 0, cor: "#4ade80" },
      { cultura: "Milho", emoji: "🌽", valor: "-",                              sacas: "0", pct: 0,                       pct_txt: "0%",                          ring_dash: 0,                        cor: "#fbbf24" },
    ],

    saidas: {
      itens: [],
      nota: "Distribuição de Lucro não está considerada nesta saída.",
    },

    obra_sede: {
      categorias: [], barra: [],
      nota: "",
    },

    despesas_classificacao: {
      fixas:      { valor: "0,00", pct: 0,    cor: "#fbbf24", dash: 0,    rot: 157.68 },
      variaveis:  { valor: "0,00", pct: 0,    cor: "#cbd5e1", dash: 0,    rot: 253.8 },
      eventuais:  { valor: "0,00", pct: 0,    cor: "#4ade80", dash: 0,    rot: -90 },
      periodicas: { valor: "0,00", pct: 0,    cor: "#3b82f6", dash: 0,    rot: 269.64 },
      realizado_pct: 0,
      realizado_ring_dash: 0,
      saldo: "0,00",
      donut_segs: [],
      nota: "",
    },

    impostos: {
      administrativa: { label: "Administrativa", sub: "Taxas e Impostos (ITR, INCRA, etc.)", valor: "0,00" },
      folha:          { label: "Folha de Pagamento", sub: "Encargos Sociais (INSS, FGTS, etc.)", valor: "0,00" },
      realizado: "0,00",
      nota: "",
    },

    armazenagem: [
      { cultura: "Soja",  emoji: "🫛", valor: "-", rotulo: "Armazém", cor: "#4ade80" },
      { cultura: "Milho", emoji: "🌽", valor: "-", rotulo: "Armazém", cor: "#fbbf24" },
    ],

    saidas_distribuicao: { itens: [] },

    distribuicao_lucro: {
      categorias: [],
      meses: ["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"],
      nota: "",
    },

    distribuicao_aramburu: [],
  };
}
