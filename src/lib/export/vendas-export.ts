// Exportação das Vendas Futuras — tabela "Contratos de Venda" — em XLSX e PDF
// (reunião 20-out-2026: "Inclua a opção de exportar vendas futuras para Excel"
// e "Inclua opções de exportação em PDF para vendas futuras").
//
// Mesmo padrão da Distribuição de Lucro (19/20-ago): catálogo único de campos
// que alimenta a tela "Campos do relatório", o PDF e o XLSX, com a linha de
// filtros e os totais opcionais e o rodapé "Emitido por". O PDF sai pelo motor
// compartilhado (pdf-tabela.ts).
//
// A unidade do relatório é a SACA — kg não sai em lugar nenhum (decisão da
// reunião de 20-out: o kg saiu da exibição). Cultura sai pelo CULTURA_LABEL,
// nunca pelo emoji (o Helvetica do pdf-lib não tem esses glifos).
//
// Roda 100% no client a partir das linhas já carregadas (o recorte da tela).

"use client";

import { formatCurrency, formatDate } from "@/lib/utils/format";
import {
  CULTURA_LABEL, VENDA_STATUS_LABEL,
  type CulturaSafra, type VendaProvisionadaRichRow,
} from "@/types";
import { buildXlsx, xtext, xmoney, xnum, type XlsxValue } from "./xlsx";
import { baixarArquivo, exportarPdfTabela, nomeArquivoRelatorio, type PdfTotal } from "./pdf-tabela";

const TITULO = "Vendas Futuras — Contratos de Venda";

export interface VendasExportMeta {
  /** Filtros humanizados aplicados (ex.: ["Competência: 10/2026", "Cultura: Soja"]). */
  filtros?: string[];
  /**
   * Campos escolhidos na tela de seleção. Ausente = layout padrão (as colunas
   * da tela). A ORDEM do relatório é sempre a do catálogo, não a de clique.
   */
  campos?: CampoExportVendas[];
  /** Incluir a linha "Filtros aplicados" no cabeçalho. */
  incluirFiltros?: boolean;
  /** Incluir os subtotais por cultura e o total geral (sacas e valor). */
  incluirTotais?: boolean;
  /** Rodapé "Emitido por: Fulano | data às hora". */
  emitidoPor?: string;
}

// ---------------------------------------------------------------------------
// Catálogo de campos exportáveis — fonte única do modal de seleção, do PDF e
// do XLSX. Os padrão são as colunas da tabela "Contratos de Venda" (Contrato e
// NF saem separados; na tela dividem uma célula). Os extras ficam encaixados
// ao lado do campo a que se referem.
//
// Larguras do PDF: o Comprador recebe a sobra da página, então a base dele só
// pesa quando os extras estouram a largura — aí o motor encolhe todas por
// igual. Por isso as colunas de texto (que quebram linha) têm base enxuta e o
// Valor Total folga para "R$ 1.235.040,00" não sair cortado.
// ---------------------------------------------------------------------------
export type CampoExportVendas =
  | "dataVenda" | "cultura" | "safra" | "comprador" | "contrato" | "autFixacao" | "nf"
  | "sacas" | "precoSc" | "valorTotal" | "pgtoPrevisto" | "competencia" | "trimestre"
  | "destino" | "status" | "taxaArmazenagem" | "taxaDataPgto" | "taxaNd" | "observacao";

export interface CampoExportVendasDef {
  key: CampoExportVendas;
  label: string;
  /** Vem marcado por padrão (espelha as colunas da tela). */
  padrao: boolean;
  /** Largura relativa no PDF e no XLSX. */
  larguraPdf: number;
  larguraXlsx: number;
  align: "left" | "right";
  /** Máximo de linhas na célula do PDF. */
  wrap: number;
}

export const CAMPOS_EXPORT_VENDAS: CampoExportVendasDef[] = [
  { key: "dataVenda",       label: "Data da Venda",       padrao: false, larguraPdf: 54,  larguraXlsx: 13, align: "left",  wrap: 1 },
  { key: "cultura",         label: "Cultura",             padrao: true,  larguraPdf: 50,  larguraXlsx: 11, align: "left",  wrap: 1 },
  { key: "safra",           label: "Safra",               padrao: true,  larguraPdf: 40,  larguraXlsx: 9,  align: "left",  wrap: 1 },
  { key: "comprador",       label: "Comprador",           padrao: true,  larguraPdf: 90,  larguraXlsx: 30, align: "left",  wrap: 2 },
  { key: "contrato",        label: "Contrato",            padrao: true,  larguraPdf: 58,  larguraXlsx: 14, align: "left",  wrap: 2 },
  { key: "autFixacao",      label: "Aut. Fixação",        padrao: false, larguraPdf: 54,  larguraXlsx: 13, align: "left",  wrap: 1 },
  { key: "nf",              label: "NF",                  padrao: true,  larguraPdf: 54,  larguraXlsx: 12, align: "left",  wrap: 1 },
  { key: "sacas",           label: "Sacas",               padrao: true,  larguraPdf: 58,  larguraXlsx: 12, align: "right", wrap: 1 },
  { key: "precoSc",         label: "R$/sc",               padrao: true,  larguraPdf: 56,  larguraXlsx: 12, align: "right", wrap: 1 },
  { key: "valorTotal",      label: "Valor Total",         padrao: true,  larguraPdf: 80,  larguraXlsx: 17, align: "right", wrap: 1 },
  { key: "pgtoPrevisto",    label: "Pgto Previsto",       padrao: true,  larguraPdf: 56,  larguraXlsx: 13, align: "left",  wrap: 1 },
  { key: "competencia",     label: "Competência",         padrao: false, larguraPdf: 52,  larguraXlsx: 12, align: "left",  wrap: 1 },
  { key: "trimestre",       label: "Trimestre",           padrao: false, larguraPdf: 54,  larguraXlsx: 12, align: "left",  wrap: 1 },
  { key: "destino",         label: "Destino",             padrao: true,  larguraPdf: 66,  larguraXlsx: 18, align: "left",  wrap: 2 },
  { key: "status",          label: "Status",              padrao: true,  larguraPdf: 54,  larguraXlsx: 11, align: "left",  wrap: 1 },
  { key: "taxaArmazenagem", label: "Taxa de Armazenagem", padrao: false, larguraPdf: 66,  larguraXlsx: 17, align: "right", wrap: 1 },
  { key: "taxaDataPgto",    label: "Data Pgto da Taxa",   padrao: false, larguraPdf: 56,  larguraXlsx: 15, align: "left",  wrap: 1 },
  { key: "taxaNd",          label: "ND da Taxa",          padrao: false, larguraPdf: 48,  larguraXlsx: 11, align: "left",  wrap: 1 },
  { key: "observacao",      label: "Observação",          padrao: false, larguraPdf: 100, larguraXlsx: 40, align: "left",  wrap: 3 },
];

export const CAMPOS_EXPORT_VENDAS_PADRAO: CampoExportVendas[] =
  CAMPOS_EXPORT_VENDAS.filter((c) => c.padrao).map((c) => c.key);

/** Campos pedidos → definições, na ordem do catálogo. Vazio cai no padrão. */
function resolverCampos(campos?: CampoExportVendas[]): CampoExportVendasDef[] {
  if (!campos || campos.length === 0) {
    return CAMPOS_EXPORT_VENDAS.filter((c) => c.padrao);
  }
  const escolhidos = new Set(campos);
  const sel = CAMPOS_EXPORT_VENDAS.filter((c) => escolhidos.has(c.key));
  return sel.length > 0 ? sel : CAMPOS_EXPORT_VENDAS.filter((c) => c.padrao);
}

// ---------------------------------------------------------------------------
// Linha "achatada" — fonte única para PDF e XLSX. Os campos de texto já vêm
// prontos; sacas e valores em R$ ficam crus para o XLSX gravar como número.
// ---------------------------------------------------------------------------
type CampoNumerico = "sacas" | "precoSc" | "valorTotal" | "taxaArmazenagem";
type VendaExportRow =
  & Record<Exclude<CampoExportVendas, CampoNumerico>, string>
  & Record<CampoNumerico, number>
  & { culturaKey: CulturaSafra };

/** "2026-10" → "10/2026". */
export function mesHumano(m: string): string {
  return m?.length === 7 ? `${m.slice(5)}/${m.slice(0, 4)}` : m || "";
}

/** Sacas com 2 casas, em PT-BR ("12.345,67"). */
function fmtSacas(n: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const arred2 = (n: number): number => Math.round(n * 100) / 100;

function toRows(rows: VendaProvisionadaRichRow[]): VendaExportRow[] {
  return rows.map((r) => {
    const ano = (r.mes_recebimento ?? "").slice(0, 4);
    return {
      dataVenda: r.data_venda ? formatDate(r.data_venda) : "",
      cultura: CULTURA_LABEL[r.cultura] ?? r.cultura,
      culturaKey: r.cultura,
      safra: r.safra ?? "",
      comprador: r.comprador ?? "",
      contrato: r.numero_contrato ?? "",
      autFixacao: r.aut_fixacao ?? "",
      nf: r.nota_fiscal ?? "",
      sacas: Number(r.sacas) || 0,
      precoSc: Number(r.preco_sc) || 0,
      valorTotal: Number(r.valor_total) || 0,
      pgtoPrevisto: r.data_pgto_prevista ? formatDate(r.data_pgto_prevista) : "",
      competencia: mesHumano(r.mes_recebimento),
      // Com o ano: num recorte de mais de um exercício, "1º TRI" sozinho é ambíguo.
      trimestre: [r.trimestre_recebimento, ano].filter(Boolean).join("/"),
      destino: r.destino_empresa
        ? "Empresa"
        : (r.socio_destino_apelido ?? r.socio_destino_nome ?? "Sócio"),
      status: VENDA_STATUS_LABEL[r.status] ?? r.status,
      taxaArmazenagem: Number(r.taxa_armazenagem) || 0,
      taxaDataPgto: r.taxa_data_pgto ? formatDate(r.taxa_data_pgto) : "",
      taxaNd: r.taxa_nd ?? "",
      observacao: r.observacao ?? "",
    };
  });
}

/** Célula do PDF (texto pronto). Taxa zerada sai em branco, como ND e data. */
function celula(r: VendaExportRow, key: CampoExportVendas): string {
  switch (key) {
    case "sacas":           return fmtSacas(r.sacas);
    case "precoSc":         return formatCurrency(r.precoSc);
    case "valorTotal":      return formatCurrency(r.valorTotal);
    case "taxaArmazenagem": return r.taxaArmazenagem ? formatCurrency(r.taxaArmazenagem) : "";
    default:                return r[key];
  }
}

/** Célula do XLSX: sacas e R$ como número de verdade (o Excel soma). */
function celulaXlsx(r: VendaExportRow, key: CampoExportVendas): XlsxValue {
  switch (key) {
    case "sacas":           return xnum(arred2(r.sacas));
    case "precoSc":         return xmoney(r.precoSc);
    case "valorTotal":      return xmoney(r.valorTotal);
    case "taxaArmazenagem": return r.taxaArmazenagem ? xmoney(r.taxaArmazenagem) : xtext("");
    default:                return xtext(r[key]);
  }
}

/** Subtotais por cultura (na ordem do cadastro — Soja, Milho, …) + total geral. */
function calcularTotais(rows: VendaExportRow[]): {
  porCultura: { cultura: CulturaSafra; sacas: number; valor: number }[];
  geral: { sacas: number; valor: number };
} {
  const mapa = new Map<CulturaSafra, { sacas: number; valor: number }>();
  const geral = { sacas: 0, valor: 0 };
  for (const r of rows) {
    const t = mapa.get(r.culturaKey) ?? { sacas: 0, valor: 0 };
    t.sacas += r.sacas;
    t.valor += r.valorTotal;
    mapa.set(r.culturaKey, t);
    geral.sacas += r.sacas;
    geral.valor += r.valorTotal;
  }
  const ordem = Object.keys(CULTURA_LABEL);
  const porCultura = Array.from(mapa, ([cultura, t]) => ({ cultura, ...t }))
    .sort((a, b) => ordem.indexOf(a.cultura) - ordem.indexOf(b.cultura));
  return { porCultura, geral };
}

// ===========================================================================
// XLSX
// ===========================================================================

/**
 * Linha de subtotal/total do XLSX: sacas e valor caem sob as próprias colunas
 * (número, o Excel soma) e o rótulo na primeira coluna livre — na prática a
 * Cultura, então "Subtotal Soja" fica sob a própria cultura. O que não tiver
 * coluna no relatório vai por extenso no rótulo.
 */
function linhaTotalXlsx(
  cols: CampoExportVendasDef[],
  rotulo: string,
  sacas: number,
  valor: number,
): XlsxValue[] {
  const linha: XlsxValue[] = cols.map(() => xtext(""));
  const iSacas = cols.findIndex((c) => c.key === "sacas");
  const iValor = cols.findIndex((c) => c.key === "valorTotal");
  // -1 = só Sacas e/ou Valor Total marcados: tudo por extenso na 1ª coluna.
  const iRotulo = cols.findIndex((_, i) => i !== iSacas && i !== iValor);
  const texto = [rotulo];
  if (iSacas >= 0 && iRotulo >= 0) linha[iSacas] = xnum(arred2(sacas), { bold: true });
  else texto.push(`${fmtSacas(sacas)} sc`);
  if (iValor >= 0 && iRotulo >= 0) linha[iValor] = xmoney(arred2(valor), { bold: true });
  else texto.push(formatCurrency(valor));
  linha[Math.max(iRotulo, 0)] = xtext(texto.join(" — "), { bold: true });
  return linha;
}

export function exportVendasXlsx(
  rowsRich: VendaProvisionadaRichRow[],
  meta: VendasExportMeta = {},
): void {
  const rows = toRows(rowsRich);
  const cols = resolverCampos(meta.campos);

  const titleRows: string[] = [`AramBI — ${TITULO}`];
  if (meta.incluirFiltros !== false && meta.filtros?.length) {
    titleRows.push(`Filtros: ${meta.filtros.join(" · ")}`);
  }
  if (meta.emitidoPor) titleRows.push(meta.emitidoPor);

  const dataRows: XlsxValue[][] = rows.map((r) => cols.map((c) => celulaXlsx(r, c.key)));

  if (meta.incluirTotais !== false) {
    const { porCultura, geral } = calcularTotais(rows);
    dataRows.push(cols.map(() => xtext("")));
    for (const c of porCultura) {
      dataRows.push(linhaTotalXlsx(cols, `Subtotal ${CULTURA_LABEL[c.cultura] ?? c.cultura}`, c.sacas, c.valor));
    }
    dataRows.push(linhaTotalXlsx(cols, "TOTAL GERAL", geral.sacas, geral.valor));
  }

  const bytes = buildXlsx({
    sheetName: "Vendas Futuras",
    titleRows,
    columns: cols.map((c) => ({ header: c.label, width: c.larguraXlsx })),
    rows: dataRows,
  });

  baixarArquivo(
    bytes,
    nomeArquivoRelatorio("vendas-futuras", "xlsx"),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}

// ===========================================================================
// PDF (A4 paisagem — motor compartilhado pdf-tabela.ts)
// ===========================================================================
export async function exportVendasPdf(
  rowsRich: VendaProvisionadaRichRow[],
  meta: VendasExportMeta = {},
): Promise<void> {
  const rows = toRows(rowsRich);
  const cols = resolverCampos(meta.campos);

  const subtitulos: string[] = [];
  if (meta.incluirFiltros !== false && meta.filtros?.length) {
    subtitulos.push(`Filtros aplicados: ${meta.filtros.join("  ·  ")}`);
  }

  // Caixa de totais: subtotal por cultura (sacas no rótulo, R$ no valor) e o
  // TOTAL GERAL em destaque.
  let totais: PdfTotal[] | undefined;
  if (meta.incluirTotais !== false) {
    const { porCultura, geral } = calcularTotais(rows);
    totais = [
      ...porCultura.map((c) => ({
        rotulo: `Subtotal ${CULTURA_LABEL[c.cultura] ?? c.cultura} — ${fmtSacas(c.sacas)} sc`,
        valor: formatCurrency(c.valor),
      })),
      { rotulo: `TOTAL GERAL — ${fmtSacas(geral.sacas)} sc`, valor: formatCurrency(geral.valor), destaque: true },
    ];
  }

  await exportarPdfTabela(
    {
      titulo: TITULO,
      subtitulos,
      colunas: cols.map((c) => ({
        header: c.label,
        width: c.larguraPdf,
        align: c.align,
        wrap: c.wrap,
        bold: c.key === "valorTotal",      // valor em negrito, como na DL
        expandir: c.key === "comprador",   // a sobra da página vai para o Comprador
      })),
      // Caracteres que o Helvetica não desenha (emoji etc.) o motor tira — o XLSX guarda o original.
      linhas: rows.map((r) => cols.map((c) => celula(r, c.key))),
      totais,
      emitidoPor: meta.emitidoPor,
    },
    nomeArquivoRelatorio("vendas-futuras", "pdf"),
  );
}
