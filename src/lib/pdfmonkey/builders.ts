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
import { FORMA_PGTO_LABEL, type Database, type FormaPgto } from "@/types";
import { formatDataCurta } from "@/lib/pdf/helpers";
import type {
  BancoTotalBox, CapaEmpresaPayload, CapaSocioPayload, ContabilObservacao,
  RelatorioContabilPayload, RelatorioSociosPayload,
  ReportScope,
} from "./types";

// ----------------------------------------------------------------------------
// Escopo do relatório (RF-FIN-09)
// ----------------------------------------------------------------------------
// Aplica o recorte escolhido pela Lola a uma query de transacoes_empresa.
// Precedência: seleção manual (por_selecao) > filtros (por_filtros) > mês.
// Tipagem propositalmente frouxa: o filter builder do supabase-js encadeia os
// mesmos métodos retornando o mesmo tipo — a interface mínima abaixo basta.
interface QueryFiltravel {
  eq: (col: string, val: unknown) => QueryFiltravel;
  in: (col: string, vals: readonly unknown[]) => QueryFiltravel;
  gte: (col: string, val: unknown) => QueryFiltravel;
  lte: (col: string, val: unknown) => QueryFiltravel;
  lt: (col: string, val: unknown) => QueryFiltravel;
  or: (filtros: string) => QueryFiltravel;
}

function aplicarEscopo<T>(query: T, scope: ReportScope | undefined, mesFallback: string): T {
  const q = query as unknown as QueryFiltravel;

  if (!scope || scope.scope_type === "por_mes") {
    const mes = scope?.filtros?.mes_referencia;
    if (Array.isArray(mes) && mes.length > 0) return q.in("mes_referencia", mes) as unknown as T;
    return q.eq("mes_referencia", (typeof mes === "string" && mes) || mesFallback) as unknown as T;
  }
  if (scope.scope_type === "por_selecao") {
    // Seleção manual: o conjunto é exatamente os ids marcados (vazio = nada).
    return q.in("id", scope.transacao_ids ?? []) as unknown as T;
  }

  // por_filtros
  const f = scope.filtros ?? {};
  let r = q;
  const eqOuIn = (col: string, v: string | string[] | undefined) => {
    if (!v) return;
    if (Array.isArray(v)) { if (v.length > 0) r = r.in(col, v); }
    else r = r.eq(col, v);
  };
  // Recorte por ids (lançamentos tagueados — fix 28-jul). Lista vazia = recorte
  // vazio (uuid sentinela evita `in ()` inválido), igual à listagem da tela.
  if (f.ids) r = r.in("id", f.ids.length > 0 ? f.ids : ["00000000-0000-0000-0000-000000000000"]);
  eqOuIn("mes_referencia", f.mes_referencia);
  eqOuIn("status", f.status);
  eqOuIn("conta_contabil_cod", f.conta_contabil_cod);
  if (f.centro_custo_cod?.length)  r = r.in("centro_custo_cod", f.centro_custo_cod);
  eqOuIn("conta_bancaria_id", f.conta_bancaria_id);
  eqOuIn("tipo_despesa", f.tipo_despesa);
  eqOuIn("forma_pgto", f.forma_pgto);
  if (f.somente_negativos)         r = r.lt("valor", 0);
  if (f.data_de)                   r = r.gte("data", f.data_de);
  if (f.data_ate)                  r = r.lte("data", f.data_ate);
  if (f.emissao_de)                r = r.gte("data_emissao", f.emissao_de);
  if (f.emissao_ate)               r = r.lte("data_emissao", f.emissao_ate);
  // Valor por magnitude (mesma regra da tela Financeiro — 23-jul).
  if (f.valor_min != null && f.valor_min > 0) r = r.or(`valor.gte.${f.valor_min},valor.lte.${-f.valor_min}`);
  if (f.valor_max != null && f.valor_max > 0) r = r.gte("valor", -f.valor_max).lte("valor", f.valor_max);
  if (f.search) {
    const s = f.search.replace(/[%_,]/g, " ").trim();
    if (s) r = r.or(`descricao.ilike.%${s}%,fornecedor_nome.ilike.%${s}%,ref.ilike.%${s}%`);
  }
  return r as unknown as T;
}

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

/** "2026-04" → "Abril" — badge dourado das capas (a documentação nova usa Title Case). */
export function mesReferenciaToNome(mesRef: string): string {
  const idx = parseInt(mesRef.split("-")[1], 10) - 1;
  return NOMES_MES[idx] ?? "?";
}

export function mesReferenciaToFraseSocio(mesRef: string): string {
  const [yy, mm] = mesRef.split("-");
  const idx = parseInt(mm, 10) - 1;
  return `${NOMES_MES[idx]?.toLowerCase() ?? "?"}-${yy}`;
}

/**
 * Linha "periodo" do cabeçalho da capa (template agendamento.html, 04-set):
 * "01/04 a 30/04/2026". Sem recorte de datas, é o mês inteiro; com filtro de
 * vencimento (De/Até), é o intervalo filtrado — o que faltar cai na borda do mês.
 * A documentação avisa: se `periodo` faltar, a linha sai em branco.
 */
export function periodoLabel(mesRef: string, de?: string, ate?: string): string {
  const [yy, mm] = mesRef.split("-").map(Number);
  const ultimoDia = new Date(yy, mm, 0).getDate();
  const ini = de || `${mesRef}-01`;
  const fim = ate || `${mesRef}-${String(ultimoDia).padStart(2, "0")}`;
  const a = formatDataCurta(ini);
  const b = formatDataCurta(fim);
  // Mesmo ano: "01/04 a 30/04/2026"; anos diferentes: "20/12/2025 a 10/01/2026".
  return a.slice(6) === b.slice(6) ? `${a.slice(0, 5)} a ${b}` : `${a} a ${b}`;
}

/**
 * Número do selo dourado digitado no modal da capa: "2", "2o" e "2°" viram
 * "2º" (o "º" é chato de digitar); outro texto sai como veio. Vazio = undefined,
 * e quem chama usa o automático (número do mês).
 */
function numeroSelo(digitado: string | undefined): string | undefined {
  const t = digitado?.trim();
  if (!t) return undefined;
  const m = /^(\d{1,2})\s*[ºo°]?$/i.exec(t);
  return m ? `${Number(m[1])}º` : t;
}

/** Forma de pagamento legível ("pix" → "Pix"); "sem" sai vazio. */
function pgtoLabel(forma: string | null | undefined): string {
  if (!forma || forma === "sem") return "";
  return FORMA_PGTO_LABEL[forma as FormaPgto] ?? forma;
}

/** PGTO das compras no cartão de crédito na Capa Empresa — listadas, mas fora dos totais. */
const PGTO_CARTAO_INFORMATIVO = "Cartão (débito automático)";
const NOTA_CARTAO =
  "Compras no cartão de crédito aparecem para conferência e não somam no total — " +
  "saem na fatura, coberta pelo resgate “Fatura Cartão”.";

/**
 * Observações livres digitadas no modal da capa (uma por linha — 21-out).
 * Mesmo formato das observações do Relatório Contábil ({ titulo, texto }); o
 * corpo da requisição não é confiável, então só passam textos não vazios.
 */
function limparObservacoes(obs: unknown): ContabilObservacao[] {
  if (!Array.isArray(obs)) return [];
  const out: ContabilObservacao[] = [];
  for (const o of obs) {
    if (!o || typeof o !== "object") continue;
    const { titulo, texto } = o as { titulo?: unknown; texto?: unknown };
    const t = typeof titulo === "string" ? titulo.trim() : "";
    const x = typeof texto === "string" ? texto.trim() : "";
    if (t || x) out.push({ titulo: t, texto: x });
  }
  return out;
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
  /** Recorte escolhido pela Lola (RF-FIN-09). Ausente → mês inteiro (comportamento histórico). */
  scope?: ReportScope;
  /** Número do lote informado manualmente (4.3) — ex.: "7º". Sobrescreve o auto. */
  numeroLote?: string;
  /** Mês de referência do lote informado manualmente (4.3) — ex.: "Julho". Sobrescreve o auto. */
  mesReferenciaLabel?: string;
  /** Observações do modal (uma por linha → um item) — vão em `observacoes`. */
  observacoes?: ContabilObservacao[];
}

// Monta a descrição completa de um lançamento para o relatório CAPAS (4.4):
//   "Fornecedor (NF 123 – Categoria | Descrição) – Parcela X de Y"
// Defensivo: omite as partes ausentes sem deixar parênteses/traços vazios.
function montarDescricaoCapa(t: {
  fornecedor_nome: string | null;
  ref: string | null;
  parcelas: string | null;
  descricao: string | null;
  categoria: string | null;
}): string {
  const fornecedor = (t.fornecedor_nome ?? "").trim();
  const ref = (t.ref ?? "").trim();
  const descricao = (t.descricao ?? "").trim();
  const categoria = (t.categoria ?? "").trim();

  // "318841" → "NF 318841"; "NF 318841"/"Recibo ..." já vem rotulado → mantém.
  const refTxt = ref ? (/^(nf|nota|recibo|nº|n°|contrato)/i.test(ref) ? ref : `NF ${ref}`) : "";
  const catDesc = [categoria, descricao].filter(Boolean).join(" | ");
  const dentro = [refTxt, catDesc].filter(Boolean).join(" – ");

  // "2/12" → "Parcela 2 de 12"
  const p = (t.parcelas ?? "").trim();
  const mParc = /^(\d+)\s*\/\s*(\d+)$/.exec(p);
  const parcelaTxt = mParc ? `Parcela ${Number(mParc[1])} de ${Number(mParc[2])}` : p;

  let out = fornecedor;
  if (dentro) out = out ? `${out} (${dentro})` : dentro;
  if (parcelaTxt) out = out ? `${out} – ${parcelaTxt}` : parcelaTxt;
  return out || descricao || fornecedor || "—";
}

export async function buildCapaEmpresa(
  supabase: SupabaseClient<Database>,
  args: BuildCapaEmpresaArgs,
): Promise<CapaEmpresaPayload> {
  const { numero_mes } = mesReferenciaToHuman(args.mesReferencia);
  const escopado = !!args.scope && args.scope.scope_type !== "por_mes";

  const perfilEmpresa = await lerPerfilEmpresa(supabase);

  // Transações do recorte (ou do mês inteiro), com banco, tipo_despesa e os
  // campos que compõem a descrição completa (4.4): ref (NF), parcelas e o
  // nome do centro de custo (categoria).
  let txQuery = supabase
    .from("transacoes_empresa")
    .select(`
      conta_bancaria_id, data, descricao, fornecedor_nome, valor, forma_pgto, tipo_despesa, ref, parcelas,
      conta_contabil_cod, origem_planilha, resgate_auto_id,
      conta_bancaria:contas_bancarias_empresa(apelido, nome, banco, ordem),
      centro_custo:classificacao_financeira!transacoes_empresa_centro_custo_cod_fkey(nome)
    `);
  txQuery = aplicarEscopo(txQuery, args.scope, args.mesReferencia);
  const { data: tsAll } = await txQuery.order("data");

  type TransacaoComConta = {
    conta_bancaria_id: string | null;
    data: string;
    descricao: string | null;
    fornecedor_nome: string | null;
    valor: number;
    forma_pgto: string;
    tipo_despesa: "fixa" | "variavel" | "eventual" | "periodica" | "sem";
    ref: string | null;
    parcelas: string | null;
    conta_contabil_cod: string;
    origem_planilha: string | null;
    resgate_auto_id: string | null;
    conta_bancaria: { apelido: string | null; nome: string; banco: string | null; ordem: number | null } | null;
    centro_custo: { nome: string } | null;
  };
  const txs = (tsAll ?? []) as unknown as TransacaoComConta[];

  const bancoSlug = (banco: string | null, nome: string) =>
    (banco ?? nome ?? "").toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");

  // ---- Seções da capa ----
  // fixa/variavel/eventual → as três tabelas de despesas, como sempre. Sem um
  // desses tipos, a linha ainda entra se for (seção 10 do DOCUMENTACAO_JSON,
  // out-2026 — sem elas a capa fechava abaixo do relatório da tela):
  //   • Distribuição de Lucro — conta 2.8, ou perna do repasse consolidado /
  //     provisionado automático da DL (etiquetas dl_repasse:/dl_auto:), como a
  //     "Transf. Entre Contas_Distribuição de Lucro" que sai da CORA. O centro
  //     dessa perna é 2.9.3 hoje e vira 2.9.1 com a 0063 (plano alinhado à
  //     VS4) — a regra olha a ETIQUETA, não o centro, e vale para os dois;
  //   • Resgate — conta 1.8.
  // Nas duas, só o lado que SAI: o resgate tem o crédito na corrente SICREDI e
  // a saída no Invest, e o repasse da DL tem a entrada 1.9.1 no INTER — somar
  // as duas pernas zeraria o total.
  type Secao = "fixa" | "variavel" | "eventual" | "dl" | "resgate";
  const secaoDaCapa = (t: TransacaoComConta): Secao | null => {
    const tipo = t.tipo_despesa;
    if (tipo === "fixa" || tipo === "variavel" || tipo === "eventual") return tipo;
    if (Number(t.valor) >= 0) return null;
    const origem = t.origem_planilha ?? "";
    if (t.conta_contabil_cod === "2.8" || origem.startsWith("dl_repasse:") || origem.startsWith("dl_auto:")) return "dl";
    if (t.conta_contabil_cod === "1.8") return "resgate";
    return null; // periódica / sem tipo: o template não tem seção para ela
  };

  type ListItem = { vencimento: string; valor: string; descricao: string; banco: string; pgto: string; informativo?: boolean };
  const buckets: Record<Secao, { items: ListItem[]; total: number }> = {
    fixa:     { items: [], total: 0 },
    variavel: { items: [], total: 0 },
    eventual: { items: [], total: 0 },
    dl:       { items: [], total: 0 },
    resgate:  { items: [], total: 0 },
  };

  // Totais por banco a partir das MESMAS linhas que entram nas tabelas.
  //
  // Regra de ouro do template novo (DOCUMENTACAO_JSON.md, 04-set-2026): "o
  // template não calcula nada" e total_geral = soma das tabelas = soma das
  // caixas de banco. Até aqui os totais por banco vinham de outra fonte (a
  // variação mensal da conta, com entradas e tudo) e não batiam com as tabelas,
  // que só listam saídas. Agora é uma fonte só.
  const porBanco = new Map<string, { nome: string; nome_completo: string; banco: string | null; ordem: number; total: number }>();

  // Compras no CARTÃO DE CRÉDITO (reunião de 20-out: "o débito automático de
  // cartões aparece sem inflar as saídas"). Cada compra é lançada uma a uma e a
  // fatura sai por débito automático, coberta pelo resgate "Fatura Cartão"
  // (0048) — que já entra na seção Resgate. Somar as compras E o resgate dobrava
  // a saída. As compras seguem listadas na seção delas (PGTO "Cartão (débito
  // automático)" e `informativo: true`), mas ficam FORA do subtotal da seção,
  // das caixas de banco e do total geral; a soma vai em total_cartao_informativo.
  // Só a compra COBERTA por resgate de fatura (resgate_auto_id): sem resgate
  // (dispensa, saldo na corrente), a compra é a única saída registrada e soma.
  let totalCartao = 0;

  for (const t of txs) {
    const secao = secaoDaCapa(t);
    if (!secao) continue;
    const valor = Math.abs(Number(t.valor));
    if (valor === 0) continue; // o template esconde linha zerada; nem mandamos
    const cartao = t.forma_pgto === "cartao_credito" && !!t.resgate_auto_id;
    const bancoNome = t.conta_bancaria?.apelido ?? t.conta_bancaria?.nome ?? "—";
    buckets[secao].items.push({
      vencimento: formatDataCurta(t.data),
      valor: brl(valor),
      // Descrição completa (4.4): fornecedor + NF + categoria + descrição + parcela.
      // Em DL e Resgate o centro de custo fica de fora: o nome dele só repetiria
      // a seção ("Distribuição de Lucros") ou confundiria (o centro da
      // transferência do repasse é "Outras Despesas Não Classificadas" hoje e
      // "Transferências Enviadas" depois da 0063).
      descricao: montarDescricaoCapa({
        fornecedor_nome: t.fornecedor_nome,
        ref: t.ref,
        parcelas: t.parcelas,
        descricao: t.descricao,
        categoria: secao === "dl" || secao === "resgate" ? null : t.centro_custo?.nome ?? null,
      }),
      banco: bancoNome,
      // "Pix", "Boleto", "Cartão de Crédito"… (era o código cru "pix"/"boleto").
      pgto: cartao ? PGTO_CARTAO_INFORMATIVO : pgtoLabel(t.forma_pgto),
      ...(cartao ? { informativo: true } : {}),
    });
    if (cartao) { totalCartao += valor; continue; } // listada, mas não soma
    buckets[secao].total += valor;
    const k = t.conta_bancaria_id ?? bancoNome;
    const a = porBanco.get(k) ?? {
      nome: bancoNome,
      nome_completo: t.conta_bancaria?.nome ?? bancoNome,
      banco: t.conta_bancaria?.banco ?? null,
      ordem: t.conta_bancaria?.ordem ?? 999,
      total: 0,
    };
    a.total += valor;
    porBanco.set(k, a);
  }

  // ---- Lista de bancos ----
  // totais_bancos[] → caixas coloridas do template novo ({ label, valor }); o
  //                   label leva o apelido da conta ("CORA", "SICREDI INVEST",
  //                   "B. Brasil"…), que contém a palavra-chave da cor/logo.
  // bancos[] / subtotais_bancos[] / total_cora… → campos do template antigo,
  //                   mantidos para o PDFMonkey poder trocar de template sem
  //                   o sistema quebrar (extras são ignorados pelo template).
  const lista = Array.from(porBanco.values()).sort((x, y) => x.ordem - y.ordem || y.total - x.total);
  const bancos = lista.map((c) => ({
    nome: c.nome,
    nome_completo: c.nome_completo,
    slug: bancoSlug(c.banco, c.nome),
    total: brl(c.total),
  }));
  const bancosNum = lista.map((c) => ({ nome: c.nome, slug: bancoSlug(c.banco, c.nome), total: c.total }));
  const totais_bancos: BancoTotalBox[] = lista.map((c) => ({ label: c.nome, valor: brl(c.total) }));
  // Soma das cinco seções = soma das caixas de banco. Bate com o TOTAL GERAL do
  // "Exportar PDF" da tela quando o recorte só tem saídas dessas seções e
  // nenhuma compra no cartão de crédito (o Exportar soma o cartão; a capa o
  // deixa só no informativo) — periódica e sem tipo (fora DL/Resgate) seguem
  // fora: o template não tem seção.
  const total_geral = (Object.keys(buckets) as Secao[]).reduce((s, k) => s + buckets[k].total, 0);

  // ---- Subtotais por banco (4.6 — template antigo) ----
  const somaSlug = (needle: string) =>
    bancosNum.filter((b) => b.slug.includes(needle)).reduce((s, b) => s + b.total, 0);
  const nomePorSlug = (needle: string, fb: string) =>
    bancosNum.find((b) => b.slug.includes(needle))?.nome ?? fb;
  const total_cora = brl(somaSlug("cora"));
  const total_sicredi = brl(somaSlug("sicredi"));
  const banco_principal = (nomePorSlug("cora", bancosNum[0]?.nome ?? "CORA")).toUpperCase();
  const banco_secundario = (nomePorSlug("sicredi", bancosNum[1]?.nome ?? "SICREDI")).toUpperCase();
  const subtotais_bancos = bancosNum.map((b) => ({ nome: b.nome, slug: b.slug, total: brl(b.total) }));

  // Período do cabeçalho: mês inteiro, ou o intervalo de vencimento do filtro.
  const filtrosScope = escopado ? args.scope?.filtros : undefined;
  const periodo = periodoLabel(args.mesReferencia, filtrosScope?.data_de, filtrosScope?.data_ate);

  return {
    empresa: perfilEmpresa.nome,
    cnpj: perfilEmpresa.cnpj,
    fazenda: "FAZENDA ARAMBURU",
    // 4.3: mês de referência do lote — manual (ex.: "Julho") sobrescreve o automático.
    mes_referencia: args.mesReferenciaLabel?.trim() || mesReferenciaToNome(args.mesReferencia),
    // 4.3: número do lote — manual (ex.: "7º") sobrescreve o automático.
    numero_mes: numeroSelo(args.numeroLote) ?? numero_mes,
    realizado_em: formatDataCurta(new Date().toISOString().slice(0, 10)),
    preparado_por: args.preparadoPor ?? "Adriane Estefany",
    periodo,
    totais_bancos,
    bancos,
    // 4.6: subtotais por banco — planos (template atual) + array dinâmico (futuro).
    banco_principal,
    banco_secundario,
    total_cora,
    total_sicredi,
    subtotais_bancos,
    total_geral: brl(total_geral),
    despesas_fixas: buckets.fixa.items,
    total_fixas: brl(buckets.fixa.total),
    despesas_variaveis: buckets.variavel.items,
    total_variaveis: brl(buckets.variavel.total),
    despesas_eventuais: buckets.eventual.items,
    total_eventuais: brl(buckets.eventual.total),
    distribuicao_lucro: buckets.dl.items,
    total_distribuicao_lucro: brl(buckets.dl.total),
    resgates: buckets.resgate.items,
    total_resgates: brl(buckets.resgate.total),
    // Campos novos (21-out) — o template ignora até ganhar o bloco (ver
    // ajustes-20-outubro-26/NOTAS_CAPAS_PDFMONKEY.md).
    total_cartao_informativo: brl(totalCartao),
    nota_cartao: totalCartao > 0 ? NOTA_CARTAO : "",
    observacoes: limparObservacoes(args.observacoes),
  };
}

// ----------------------------------------------------------------------------
// Capa Sócio
// ----------------------------------------------------------------------------
export interface BuildCapaSocioArgs {
  mesReferencia: string;
  socioId: string;
  preparadoPor?: string;
  /** Recorte por ids (lançamentos TAGUEADOS na tela DL — ajuste 29-jul). */
  ids?: string[];
  /**
   * Número da capa no mês, informado no modal (ex.: "2º") — out-2026. O selo
   * dourado mostrava sempre o número do MÊS ("10º" em outubro); vazio mantém isso.
   */
  numeroCapa?: string;
  /** Mês de referência do selo, informado no modal (ex.: "Outubro"). Vazio = automático. */
  mesReferenciaLabel?: string;
  /** Observações do modal (uma por linha → um item) — vão em `observacoes`. */
  observacoes?: ContabilObservacao[];
}

export async function buildCapaSocio(
  supabase: SupabaseClient<Database>,
  args: BuildCapaSocioArgs,
): Promise<CapaSocioPayload> {
  const { numero_mes } = mesReferenciaToHuman(args.mesReferencia);

  const { data: socio } = await supabase
    .from("socios").select("*").eq("id", args.socioId).maybeSingle();
  if (!socio) throw new Error(`Sócio ${args.socioId} não encontrado`);

  const { data: contas } = await supabase
    .from("contas_bancarias_socio")
    .select("*")
    .eq("socio_id", args.socioId)
    .eq("ativa", true)
    .order("ordem");

  let lancamentosQuery = supabase
    .from("transacoes_socio")
    .select(`
      data, data_vencimento, data_vencimento_despesa,
      classificacao_pessoal, descricao, valor, conta_bancaria_socio_id,
      conta_bancaria_socio_nome,
      conta_bancaria:contas_bancarias_socio(id, banco, nome),
      classificacao:classificacao_pessoal(nome)
    `)
    .eq("socio_id", args.socioId)
    .eq("mes_referencia", args.mesReferencia);
  // Recorte por tags (ajuste 29-jul): a capa sai só com os lançamentos
  // marcados na DL — a interseção com sócio+mês continua valendo.
  if (args.ids && args.ids.length > 0) lancamentosQuery = lancamentosQuery.in("id", args.ids);
  const { data: lancamentos } = await lancamentosQuery.order("data");

  type LancamentoSocio = {
    data: string;
    data_vencimento: string | null;
    data_vencimento_despesa: string | null;
    classificacao_pessoal: string;
    descricao: string;
    valor: number;
    conta_bancaria_socio_id: string | null;
    conta_bancaria_socio_nome: string | null;
    conta_bancaria: { id: string; banco: string | null; nome: string } | null;
    classificacao: { nome: string } | null;
  };

  type BucketKey = "imovel" | "familia" | "renda" | "pessoais" | "fazenda" | "contratos";
  const buckets: Record<BucketKey, { items: { vencimento: string; valor: string; descricao: string; banco: string }[]; total: number }> = {
    imovel:    { items: [], total: 0 },
    familia:   { items: [], total: 0 },
    renda:     { items: [], total: 0 },
    pessoais:  { items: [], total: 0 },
    fazenda:   { items: [], total: 0 },
    contratos: { items: [], total: 0 },
  };
  const toBucket: Record<string, BucketKey> = {
    "1.01": "imovel",   "1.1 - Imóvel": "imovel",
    "1.02": "familia",  "1.2 - Família": "familia",
    "1.03": "renda",    "1.3 - Renda Mensal/Qualidade de Vida": "renda",
    "1.04": "pessoais", "1.4 - Despesas Pessoais": "pessoais",
    "1.05": "fazenda",  "1.5 - Fazenda Aramburu": "fazenda",
    "1.06": "contratos",
  };
  // Código fora do mapa (cadastro novo em Configurações): decide pelo NOME da
  // classificação, para o lançamento não sumir da capa em silêncio.
  const bucketPorNome = (nome: string | null | undefined): BucketKey | null => {
    const n = (nome ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!n) return null;
    if (n.includes("imovel")) return "imovel";
    if (n.includes("familia")) return "familia";
    if (n.includes("renda") || n.includes("qualidade")) return "renda";
    if (n.includes("pessoa")) return "pessoais";
    if (n.includes("fazenda") || n.includes("aramburu")) return "fazenda";
    if (n.includes("contrato") || n.includes("venda")) return "contratos";
    return null;
  };

  // A coluna VENCIMENTO da capa é o vencimento da despesa (ou, na falta, a
  // data do repasse) — não o 1º dia da competência, que é o que `data` guarda.
  // Datas-puras passam por formatDataCurta (o toLocaleDateString de antes
  // interpretava "2026-04-01" como UTC e recuava um dia no Brasil).
  const dataCapa = (l: LancamentoSocio) => l.data_vencimento_despesa ?? l.data_vencimento ?? l.data;
  const ordenados = ((lancamentos ?? []) as unknown as LancamentoSocio[])
    .slice()
    .sort((a, b) => (dataCapa(a) < dataCapa(b) ? -1 : dataCapa(a) > dataCapa(b) ? 1 : 0));

  // Totais por banco a partir das MESMAS linhas das tabelas (regra de ouro do
  // template novo: total_geral = soma das seções = soma das caixas de banco).
  // Agrupa pela conta do sócio; lançamento sem conta cadastrada (só o nome da
  // planilha) agrupa pelo nome — antes ele entrava na tabela mas ficava fora
  // do total, e os dois números não fechavam.
  const porBanco = new Map<string, { label: string; total: number }>();
  const totalPorContaId = new Map<string, number>();
  for (const l of ordenados) {
    const k = toBucket[l.classificacao_pessoal] ?? bucketPorNome(l.classificacao?.nome);
    if (!k) continue;
    const valor = Math.abs(Number(l.valor));
    if (valor === 0) continue; // o template esconde linha zerada; nem mandamos
    buckets[k].total += valor;
    // Nome da conta ("Bradesco 3489 C/C 3154-2") — contém a palavra-chave que o
    // template usa para cor e logo; só o banco ("Bradesco") juntaria duas contas.
    const label = l.conta_bancaria?.nome ?? l.conta_bancaria_socio_nome ?? "—";
    buckets[k].items.push({
      vencimento: formatDataCurta(dataCapa(l)),
      valor: brl(valor),
      descricao: l.descricao,
      banco: label,
    });
    const cid = l.conta_bancaria?.id ?? l.conta_bancaria_socio_id;
    if (cid) totalPorContaId.set(cid, (totalPorContaId.get(cid) ?? 0) + valor);
    const pk = cid ?? `nome:${label}`;
    const acc = porBanco.get(pk) ?? { label, total: 0 };
    acc.total += valor;
    porBanco.set(pk, acc);
  }

  // Caixas coloridas do template novo — só bancos com movimento, ordenadas
  // pela ordem das contas do sócio (as sem cadastro vão ao fim).
  const ordemConta = new Map((contas ?? []).map((c, i) => [c.id, c.ordem ?? i]));
  const totais_bancos: BancoTotalBox[] = Array.from(porBanco.entries())
    .sort(([ka, a], [kb, b]) => (ordemConta.get(ka) ?? 999) - (ordemConta.get(kb) ?? 999) || b.total - a.total)
    .map(([, b]) => ({ label: b.label, valor: brl(b.total) }));

  // Lista de bancos do sócio (todas as contas ativas, mesmo sem movimento) —
  // campos do template antigo, mantidos para a troca de template ser segura.
  const bancos = (contas ?? []).map((c) => ({
    nome:           c.banco ?? c.nome ?? "—",
    nome_completo:  c.nome,
    slug:           (c.banco ?? c.nome ?? "").toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""),
    total:          brl(totalPorContaId.get(c.id) ?? 0),
  }));
  const total_geral = (Object.keys(buckets) as BucketKey[]).reduce((s, k) => s + buckets[k].total, 0);

  return {
    nome_socio: socio.nome_completo,
    cpf_socio: "—",
    fazenda: "FAZENDA ARAMBURU",
    // Selo dourado: o que a Adri informar no modal sobrescreve o automático —
    // mesmo contrato da Capa Empresa (numero_lote / mes_referencia_label).
    mes_referencia: args.mesReferenciaLabel?.trim() || mesReferenciaToNome(args.mesReferencia),
    numero_mes: numeroSelo(args.numeroCapa) ?? numero_mes,
    realizado_em: formatDataCurta(new Date().toISOString().slice(0, 10)),
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
    contratos_venda: buckets.contratos.items,
    total_contratos_venda: brl(buckets.contratos.total),
    contas_socio: (contas ?? []).map((c) => ({
      banco: c.banco ?? "—",
      agencia: c.agencia ?? "—",
      numero: c.numero_conta
        ? `${c.numero_conta}${c.digito ? "-" + c.digito : ""}`
        : c.nome,
      tipo: c.tipo ?? "Corrente",
    })),
    totais_bancos,
    bancos,
    total_geral: brl(total_geral),
    // Campo novo (21-out) — o template ignora até ganhar o bloco de observações.
    observacoes: limparObservacoes(args.observacoes),
  };
}

// ----------------------------------------------------------------------------
// Relatório Contábil — versão inicial: usa o JSON-exemplo aprovado.
//
// O relatório contábil é gigantesco (44KB de JSON com transações detalhadas
// por banco e categoria). Vamos construí-lo iterativamente. Por enquanto,
// o builder devolve o esqueleto preenchido com totais por banco/categoria
// do mês — as observações saem vazias e a rota /api/pdfmonkey/generate as
// preenche com o que vier dos modais (Relatórios PDF e, desde 21-out,
// Financeiro → Gerar relatório).
// ----------------------------------------------------------------------------
export interface BuildRelatorioContabilArgs {
  mesReferencia: string;
  preparadoPor?: string;
  /** Recorte escolhido pela Lola (RF-FIN-09). Ausente → mês inteiro. */
  scope?: ReportScope;
}

export async function buildRelatorioContabil(
  supabase: SupabaseClient<Database>,
  args: BuildRelatorioContabilArgs,
): Promise<RelatorioContabilPayload> {
  const { mes } = mesReferenciaToHuman(args.mesReferencia);

  // Lê transações do recorte (ou do mês inteiro) com todos os joins
  let q = supabase
    .from("transacoes_empresa")
    .select(`
      data, valor, status, descricao, fornecedor_nome,
      conta_contabil:classificacao_financeira!transacoes_empresa_conta_contabil_cod_fkey(codigo, nome, natureza),
      centro_custo:classificacao_financeira!transacoes_empresa_centro_custo_cod_fkey(codigo, nome),
      conta_bancaria:contas_bancarias_empresa(nome, apelido, banco)
    `);
  q = aplicarEscopo(q, args.scope, args.mesReferencia);
  const { data } = await q.order("data");

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
    observacoes: [],   // a rota sobrescreve com as do modal; vazio por padrão
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

// Paleta usada pelo template (idêntica ao JSON-exemplo aprovado). "outras" =
// Outras Saídas: a conta muda com o plano (2.9 hoje, 2.10 depois da 0063) e é
// resolvida dentro do builder — rótulo e cor acompanham a conta certa.
const CORES_SAIDA: Record<string, { classe: string; hex: string }> = {
  "2.1": { classe: "verde",     hex: "#4ade80" },
  "2.2": { classe: "verdeEsc",  hex: "#22c55e" },
  "2.3": { classe: "azul",      hex: "#60a5fa" },
  "2.4": { classe: "azul",      hex: "#3b82f6" },
  "2.5": { classe: "azul",      hex: "#1d4ed8" },
  "2.6": { classe: "roxo",      hex: "#8b5cf6" },
  "2.7": { classe: "roxoClaro", hex: "#c084fc" },
  outras: { classe: "rosa",     hex: "#ec4899" },
};

const NOMES_SAIDA: Record<string, string> = {
  "2.1": "Despesas Administrativas",
  "2.2": "Despesas com Pessoal",
  "2.3": "Operação da Propriedade",
  "2.4": "Serviços Terceirizados",
  "2.5": "Financeiras e Bancárias",
  "2.6": "Investimentos em Capital (aplicações)",
  "2.7": "Investimentos em Imobilizado Operacional (obra da sede)",
  outras: "Outras Saídas",
};

// Plano de contas alinhado à VS4 (migration 0063): "Transferências Entre
// Contas" e "Outras Saídas"/"Outros Recebimentos" trocam de código — antes,
// 2.9 Outras Saídas (com as transferências dentro, em 2.9.3) e 1.9 Outros
// Recebimentos; depois, 2.9/1.9 Transferências Entre Contas e 2.10/1.10 Outras
// Saídas/Outros Recebimentos. O relatório precisa valer nas duas estruturas
// (o deploy pode ir antes do SQL), então o NOME da conta decide o papel dela.
const CONTAS_OUTRAS_SAIDAS = ["2.9", "2.10"];
const CONTAS_OUTROS_RECEBIMENTOS = ["1.9", "1.10"];

/** "transfer" no nome = transferência entre contas (par que soma zero) — nunca é despesa. */
function ehContaTransferencia(nome: string | null | undefined): boolean {
  return (nome ?? "").toLowerCase().includes("transfer"); // = ilike '%transfer%' da view 0060
}

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
    planoNivel2Res,
    resgateEntradaRes,
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
    // Saldo (0043), não o volume total da nota — ver "Armazenagem" abaixo.
    supabase.from("v_safra_depositos_calculado")
      .select("cultura, sc_liquida_saldo")
      .neq("status", "vendido_total"),
    supabase.from("v_distribuicao_lucro_mensal")
      .select("classificacao_pessoal, valor_total, mes_referencia")
      .gte("mes_referencia", `${ano}-01`)
      .lte("mes_referencia", args.mesReferencia),
    // Nomes das contas nível 2 — decidem quem é transferência (ver CONTAS_OUTRAS_SAIDAS).
    supabase.from("classificacao_financeira")
      .select("codigo, nome")
      .eq("nivel", 2),
    // Resgate: só a ENTRADA na corrente — o par (saída do Invest + entrada na
    // corrente) fica todo no 1.8 e soma zero no total por conta.
    supabase.from("transacoes_empresa")
      .select("valor")
      .eq("mes_referencia", args.mesReferencia)
      .eq("conta_contabil_cod", "1.8")
      .gt("valor", 0),
  ]);

  // ─── Totais por conta contábil no mês ─────────────────────────────────────
  const totByConta: Record<string, number> = {};
  for (const r of porContaRes.data ?? []) {
    totByConta[r.conta_contabil_cod] = Math.abs(Number(r.valor_total));
  }
  const get = (c: string) => totByConta[c] ?? 0;

  // ─── Estrutura do plano: transferências × Outras Saídas ──────────────────
  // Nome da conta pelo plano; a view (que já traz o nome) cobre a falta.
  const nomeConta = new Map<string, string>();
  for (const r of planoNivel2Res.data ?? []) nomeConta.set(r.codigo, r.nome);
  for (const r of porContaRes.data ?? []) {
    if (!nomeConta.has(r.conta_contabil_cod)) nomeConta.set(r.conta_contabil_cod, r.conta_contabil_nome);
  }
  const ehTransferencia = (cod: string) => ehContaTransferencia(nomeConta.get(cod));
  // Outras Saídas = a conta (2.9 ou 2.10) que NÃO é de transferência. Antes da
  // 0063 é o 2.9 (com as transferências dentro — o plano ainda não separa);
  // depois, o 2.10, e o 2.9 de transferências fica fora das despesas (achado
  // de 20-out: ele somava nas despesas da fazenda).
  const outras_saidas = CONTAS_OUTRAS_SAIDAS
    .filter((c) => !ehTransferencia(c))
    .reduce((s, c) => s + get(c), 0);

  // ─── Visão geral ──────────────────────────────────────────────────────────
  const receita        = get("1.2") + get("1.3");
  // Era get("1.8"): o par de resgate se anula e o card saía "-" (achado de 21-out).
  const resgate        = (resgateEntradaRes.data ?? []).reduce((s, r) => s + Number(r.valor ?? 0), 0);
  // "Outros Recebimentos *" = 1.9 + 1.10: transferências recebidas + recebimentos
  // diversos — o mesmo valor de sempre, antes ou depois da troca da 0063.
  const outros_recb    = CONTAS_OUTROS_RECEBIMENTOS.reduce((s, c) => s + get(c), 0);
  const distrib_lucro  = get("2.8");
  const fazenda_total =
    get("2.1") + get("2.2") + get("2.3") + get("2.4") + get("2.5") + get("2.6") + get("2.7") + outras_saidas;
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
  // 1.2.1/1.2.2 são CENTROS de custo — o total por conta (get) não os tem e a
  // receita por cultura saía sempre "-" (achado de 21-out).
  const totByCentro = new Map(
    (porCentroRes.data ?? []).map((r) => [r.centro_custo_cod, Math.abs(Number(r.valor_total ?? 0))] as const),
  );
  const receitaSoja  = totByCentro.get("1.2.1") ?? 0;
  const receitaMilho = totByCentro.get("1.2.2") ?? 0;
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
  // A 8ª é Outras Saídas (conta resolvida acima) — transferências entre contas
  // não entram (antes era o 2.9 inteiro).
  const valoresSaida: Array<[string, number]> = [
    ...["2.1","2.2","2.3","2.4","2.5","2.6","2.7"].map((c): [string, number] => [c, get(c)]),
    ["outras", outras_saidas],
  ];
  const totalSaida = valoresSaida.reduce((acc, [, v]) => acc + v, 0);
  let rotAcc = -90;
  const saidasItens = valoresSaida.map(([c, valor]) => {
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
    // Transferência entre contas nunca é despesa, mesmo com tipo marcado (as do
    // sistema já nascem "sem" tipo; vale para alguma digitada/importada).
    if (ehTransferencia(cod)) continue;
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
  // SALDO em armazém, líquido de quebra (achado de 20-out): `sc_liquida` é o
  // líquido sobre o volume TOTAL da nota, e nota vendida em parte entrava
  // inteira. `sc_liquida_saldo` (0043) desconta as baixas da nota — vendas,
  // retiradas, perdas e o "Ajustar Saldo" (0051) —, a mesma conta do saldo
  // líquido da tela de Estoque (venda a terceiros). "vendido_total" segue fora.
  type ArmRow = { cultura: string; sc_liquida_saldo: number | null };
  const armPorCultura: Record<string, number> = {};
  for (const r of (armazenagemRes.data ?? []) as ArmRow[]) {
    armPorCultura[r.cultura] = (armPorCultura[r.cultura] ?? 0) + (Number(r.sc_liquida_saldo) || 0);
  }
  const armazenagem = [
    { cultura: "Soja",  emoji: "🫛", valor: armPorCultura["soja"]  ? new Intl.NumberFormat("pt-BR").format(armPorCultura["soja"])  + " sc" : "-", rotulo: "Armazém", cor: "#4ade80" },
    { cultura: "Milho", emoji: "🌽", valor: armPorCultura["milho"] ? new Intl.NumberFormat("pt-BR").format(armPorCultura["milho"]) + " sc" : "-", rotulo: "Armazém", cor: "#fbbf24" },
  ];

  // ─── Saídas distribuição (4 itens) ─────────────────────────────────────────
  const aplicacao = get("2.6");
  const imobOp    = get("2.7");
  const demaisFazenda = get("2.1") + get("2.2") + get("2.3") + get("2.4") + get("2.5") + outras_saidas;
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
  const despOpDiv  = (get("2.3") + get("2.4") + get("2.5") + get("2.1") + outras_saidas) - Math.abs(Number(energia));
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
  // Outros Recebimentos = 1.9 + 1.10 (ver outros_recb): o texto vale antes e
  // depois da 0063 — as transferências e os diversos estão nos dois casos.
  const notaEntradas = overrides.nota_entradas ?? "Outros Recebimentos: somam as transferências internas entre contas da empresa, sem impacto no resultado operacional, e eventuais recebimentos diversos não classificados nas linhas acima.";
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
