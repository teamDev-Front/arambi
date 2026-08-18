// Exportação "espelho da tela" do Financeiro em PDF e XLSX (REL-01/02/03).
//
// Roda 100% no client a partir das linhas já carregadas do Supabase. O PDF usa
// pdf-lib (já é dependência do projeto) e o XLSX usa nosso writer sem deps.
// Ambos respeitam a ORDEM e os FILTROS/SELEÇÃO do recorte recebido.

"use client";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { sanitizeWinAnsi } from "@/lib/pdf/helpers";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { getStatusLabel } from "@/lib/utils/status-config";
import type { TransacaoEmpresaRich } from "@/lib/queries/financeiro";
import { TIPO_DESPESA_LABEL, OBS_OBRA_LABEL, FORMA_PGTO_LABEL } from "@/types";
import { buildXlsx, xtext, xmoney, type XlsxValue } from "./xlsx";

// ---------------------------------------------------------------------------
// Modelo de linha "achatado" — fonte única para PDF e XLSX (mesmas colunas
// que a tela: Vencimento, Emissão, Conta, Centro de Custo, Descrição,
// Fornecedor, Ref., Banco, Status, Valor).
// ---------------------------------------------------------------------------
export interface FinanceiroExportRow {
  vencimento: string;
  emissao: string;
  conta: string;
  centro: string;
  tipoDespesa: string; // label PT-BR ("" quando sem) — XLSX 27-jul
  descricao: string;
  fornecedor: string;
  obsObra: string;     // label PT-BR ("" quando sem) — XLSX 27-jul
  ref: string;         // Referência (NF / recibo) — coluna nova 23-jul
  parcelas: string;    // quantidade ou n/N — XLSX 27-jul
  formaPgto: string;   // label PT-BR ("" quando sem) — XLSX 27-jul
  banco: string;       // apelido/nome exibível
  status: string;      // label PT-BR
  valorNum: number;    // valor com sinal (negativo = saída)
  valorStr: string;    // formatado R$
}

export interface FinanceiroExportMeta {
  titulo?: string;
  /** Linha curta sobre o recorte (ex.: "Seleção manual — 12 lançamentos"). */
  escopo?: string;
  /** Filtros humanizados aplicados (ex.: ["Status: A pagar", "Banco: Sicredi"]). */
  filtros?: string[];
  /** Aviso de truncamento (quando o recorte excede o limite). */
  aviso?: string;
  /**
   * Campos escolhidos na tela de seleção (RF 31-jul). Ausente = layout padrão.
   * A ORDEM do relatório é sempre a do catálogo, não a de clique — assim dois
   * relatórios com os mesmos campos saem idênticos.
   */
  campos?: CampoExport[];
  /** Incluir a linha "Filtros aplicados" no cabeçalho (RF 31-jul). */
  incluirFiltros?: boolean;
  /** Incluir os subtotais por banco e o total geral (RF 31-jul). */
  incluirTotais?: boolean;
}

// ---------------------------------------------------------------------------
// Catálogo de campos exportáveis (RF 31-jul) — fonte única do modal de seleção,
// do PDF e do XLSX. Acrescentar um campo aqui o faz aparecer nos três lugares.
// ---------------------------------------------------------------------------
export type CampoExport =
  | "vencimento" | "emissao" | "conta" | "centro" | "tipoDespesa" | "descricao"
  | "fornecedor" | "obsObra" | "ref" | "parcelas" | "formaPgto" | "banco"
  | "status" | "valor";

export interface CampoExportDef {
  key: CampoExport;
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

export const CAMPOS_EXPORT: CampoExportDef[] = [
  { key: "vencimento",  label: "Vencimento",               padrao: true,  larguraPdf: 54,  larguraXlsx: 12, align: "left",  wrap: 1 },
  { key: "emissao",     label: "Emissão",                  padrao: true,  larguraPdf: 50,  larguraXlsx: 12, align: "left",  wrap: 1 },
  { key: "conta",       label: "Conta Contábil",           padrao: true,  larguraPdf: 90,  larguraXlsx: 30, align: "left",  wrap: 2 },
  { key: "centro",      label: "Centro de Custo",          padrao: true,  larguraPdf: 90,  larguraXlsx: 30, align: "left",  wrap: 2 },
  { key: "tipoDespesa", label: "Tipo de Despesa",          padrao: false, larguraPdf: 62,  larguraXlsx: 18, align: "left",  wrap: 2 },
  { key: "descricao",   label: "Descrição",                padrao: true,  larguraPdf: 132, larguraXlsx: 46, align: "left",  wrap: 3 },
  { key: "fornecedor",  label: "Fornecedor / contraparte", padrao: true,  larguraPdf: 88,  larguraXlsx: 26, align: "left",  wrap: 2 },
  { key: "obsObra",     label: "Obs. Obra",                padrao: false, larguraPdf: 58,  larguraXlsx: 16, align: "left",  wrap: 2 },
  { key: "ref",         label: "Referência (NF / recibo)", padrao: true,  larguraPdf: 54,  larguraXlsx: 20, align: "left",  wrap: 1 },
  { key: "parcelas",    label: "Parcelas",                 padrao: false, larguraPdf: 42,  larguraXlsx: 10, align: "left",  wrap: 1 },
  { key: "formaPgto",   label: "Forma de Pagamento",       padrao: false, larguraPdf: 62,  larguraXlsx: 16, align: "left",  wrap: 2 },
  { key: "banco",       label: "Banco",                    padrao: true,  larguraPdf: 52,  larguraXlsx: 14, align: "left",  wrap: 1 },
  { key: "status",      label: "Status",                   padrao: true,  larguraPdf: 64,  larguraXlsx: 16, align: "left",  wrap: 1 },
  { key: "valor",       label: "Valor",                    padrao: true,  larguraPdf: 70,  larguraXlsx: 16, align: "right", wrap: 1 },
];

export const CAMPOS_EXPORT_PADRAO: CampoExport[] =
  CAMPOS_EXPORT.filter((c) => c.padrao).map((c) => c.key);

/** Campos pedidos → definições, na ordem do catálogo. Vazio cai no padrão. */
function resolverCampos(campos?: CampoExport[]): CampoExportDef[] {
  if (!campos || campos.length === 0) {
    return CAMPOS_EXPORT.filter((c) => c.padrao);
  }
  const escolhidos = new Set(campos);
  const sel = CAMPOS_EXPORT.filter((c) => escolhidos.has(c.key));
  return sel.length > 0 ? sel : CAMPOS_EXPORT.filter((c) => c.padrao);
}

/** Valor da célula (o "valor" tem versão numérica e formatada). */
function celula(r: FinanceiroExportRow, key: CampoExport): string {
  return key === "valor" ? r.valorStr : r[key];
}

export function toExportRows(rows: TransacaoEmpresaRich[]): FinanceiroExportRow[] {
  return rows.map((r) => {
    const contaNome = r.conta_contabil?.nome ?? "";
    const centroNome = r.centro_custo?.nome ?? "";
    const banco = r.conta_bancaria?.apelido ?? r.conta_bancaria?.nome ?? "";
    return {
      vencimento: r.data ? formatDate(r.data) : "",
      emissao: r.data_emissao ? formatDate(r.data_emissao) : "",
      conta: contaNome ? `${r.conta_contabil_cod} ${contaNome}` : r.conta_contabil_cod,
      centro: centroNome ? `${r.centro_custo_cod} ${centroNome}` : r.centro_custo_cod,
      tipoDespesa: r.tipo_despesa && r.tipo_despesa !== "sem" ? TIPO_DESPESA_LABEL[r.tipo_despesa] : "",
      descricao: r.descricao ?? "",
      fornecedor: r.fornecedor_nome ?? "",
      obsObra: r.obs_obra && r.obs_obra !== "sem" ? OBS_OBRA_LABEL[r.obs_obra] : "",
      ref: r.ref ?? "",
      parcelas: r.parcelas ?? "",
      formaPgto: r.forma_pgto && r.forma_pgto !== "sem" ? FORMA_PGTO_LABEL[r.forma_pgto] : "",
      banco,
      status: getStatusLabel(r.status),
      valorNum: Number(r.valor) || 0,
      valorStr: formatCurrency(Number(r.valor) || 0),
    };
  });
}

/** Subtotais por banco (apenas bancos presentes) + total geral. */
export function calcularTotais(rows: FinanceiroExportRow[]): {
  porBanco: { banco: string; total: number }[];
  totalGeral: number;
} {
  const mapa = new Map<string, number>();
  let totalGeral = 0;
  for (const r of rows) {
    const k = r.banco || "Sem banco";
    mapa.set(k, (mapa.get(k) ?? 0) + r.valorNum);
    totalGeral += r.valorNum;
  }
  const porBanco = Array.from(mapa, ([banco, total]) => ({ banco, total }))
    .sort((a, b) => a.banco.localeCompare(b.banco));
  return { porBanco, totalGeral };
}

// ---------------------------------------------------------------------------
// Download helper
// ---------------------------------------------------------------------------
function baixar(bytes: Uint8Array, filename: string, mime: string): void {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const blob = new Blob([ab], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoga depois de um tick para garantir o início do download.
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function nomeArquivo(ext: string): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `arambi-financeiro-${ymd}.${ext}`;
}

// ===========================================================================
// XLSX
// ===========================================================================
export function exportFinanceiroXlsx(
  rowsRich: TransacaoEmpresaRich[],
  meta: FinanceiroExportMeta = {},
): void {
  const rows = toExportRows(rowsRich);
  const { porBanco, totalGeral } = calcularTotais(rows);

  // Campos escolhidos na tela de seleção (RF 31-jul); sem escolha = padrão.
  const cols = resolverCampos(meta.campos);
  const incluirTotais = meta.incluirTotais !== false;

  const titleRows: string[] = [meta.titulo ?? "AramBI — Relatório de Lançamentos Financeiros"];
  if (meta.escopo) titleRows.push(meta.escopo);
  if (meta.incluirFiltros !== false && meta.filtros?.length) {
    titleRows.push(`Filtros: ${meta.filtros.join(" · ")}`);
  }
  titleRows.push(`Gerado em ${formatDate(new Date())} · ${rows.length} lançamento${rows.length === 1 ? "" : "s"}`);
  if (meta.aviso) titleRows.push(meta.aviso);

  const dataRows: XlsxValue[][] = rows.map((r) =>
    cols.map((c) => (c.key === "valor" ? xmoney(r.valorNum) : xtext(celula(r, c.key)))),
  );

  // Totais só fazem sentido se a coluna Valor estiver no relatório.
  const temValor = cols.some((c) => c.key === "valor");
  if (incluirTotais && temValor) {
    const n = cols.length;
    const pad = (q: number): XlsxValue[] => Array.from({ length: q }, () => xtext(""));
    // Rótulo na penúltima coluna; com 1 coluna só, ele vira a linha inteira.
    const rotulo = (texto: string, total: number): XlsxValue[] =>
      n >= 2
        ? [...pad(n - 2), xtext(texto, { bold: true }), xmoney(total, { bold: true })]
        : [xmoney(total, { bold: true })];

    dataRows.push(pad(n));
    for (const b of porBanco) dataRows.push(rotulo(`Subtotal ${b.banco}`, b.total));
    dataRows.push(rotulo("TOTAL GERAL", totalGeral));
  }

  const bytes = buildXlsx({
    sheetName: "Lançamentos",
    titleRows,
    columns: cols.map((c) => ({ header: c.label, width: c.larguraXlsx })),
    rows: dataRows,
  });

  baixar(
    bytes,
    nomeArquivo("xlsx"),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}

// ===========================================================================
// PDF (paisagem A4, espelho da tela)
// ===========================================================================
const A4_LANDSCAPE = { w: 841.89, h: 595.28 };
const MARGIN = { top: 40, bottom: 38, left: 32, right: 32 };

// As colunas do PDF são montadas a partir do CAMPOS_EXPORT (RF 31-jul) — não
// existe mais lista fixa aqui.
interface ColDef {
  key: CampoExport;
  header: string;
  width: number;
  align: "left" | "right";
  wrap: number; // máx. de linhas
}

// Paleta (alinhada à identidade do app)
const C_INK = rgb(0.06, 0.12, 0.11);
const C_MUTED = rgb(0.42, 0.40, 0.36);
const C_LINE = rgb(0.85, 0.83, 0.78);
const C_HEADER_BG = rgb(0.93, 0.92, 0.89);
const C_ZEBRA = rgb(0.975, 0.97, 0.96);
const C_RED = rgb(0.78, 0.16, 0.13);
const C_GREEN = rgb(0.13, 0.45, 0.27);

function safe(s: string): string {
  return sanitizeWinAnsi(s ?? "").replace(/\t/g, " ");
}

function widthOf(font: PDFFont, text: string, size: number): number {
  try { return font.widthOfTextAtSize(text, size); } catch { return text.length * size * 0.5; }
}

/** Trunca em 1 linha com reticências para caber em `maxWidth`. */
function fitOneLine(font: PDFFont, text: string, size: number, maxWidth: number): string {
  const t = safe(text);
  if (widthOf(font, t, size) <= maxWidth) return t;
  let lo = 0, hi = t.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (widthOf(font, t.slice(0, mid) + "…", size) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return t.slice(0, lo) + "…";
}

/** Quebra em até `maxLines` linhas; a última recebe reticências se sobrar texto. */
function wrapLines(font: PDFFont, text: string, size: number, maxWidth: number, maxLines: number): string[] {
  const t = safe(text).replace(/\s+/g, " ").trim();
  if (!t) return [""];
  if (maxLines <= 1) return [fitOneLine(font, t, size, maxWidth)];
  const words = t.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const tryLine = cur ? `${cur} ${w}` : w;
    if (widthOf(font, tryLine, size) <= maxWidth) {
      cur = tryLine;
    } else {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  // Se ainda há overflow, marca reticências na última linha.
  const consumed = lines.join(" ").length;
  if (consumed < t.length) {
    const last = lines[lines.length - 1] ?? "";
    lines[lines.length - 1] = fitOneLine(font, last + " " + t.slice(consumed).trim(), size, maxWidth);
  }
  // Garante que cada linha caiba (palavras muito longas).
  return lines.map((l) => fitOneLine(font, l, size, maxWidth));
}

async function carregarLogo(doc: PDFDocument): Promise<PDFImage | null> {
  try {
    const res = await fetch("/logomarga-timbre-aramburu-agropecuaria.jpg");
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return await doc.embedJpg(buf);
  } catch {
    return null;
  }
}

export async function exportFinanceiroPdf(
  rowsRich: TransacaoEmpresaRich[],
  meta: FinanceiroExportMeta = {},
): Promise<void> {
  const rows = toExportRows(rowsRich);
  const { porBanco, totalGeral } = calcularTotais(rows);

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await carregarLogo(doc);

  const contentLeft = MARGIN.left;
  const contentRight = A4_LANDSCAPE.w - MARGIN.right;
  const disponivel = contentRight - contentLeft;

  // Colunas escolhidas na tela de seleção (RF 31-jul), na ordem do catálogo.
  const cols: ColDef[] = resolverCampos(meta.campos).map((c) => ({
    key: c.key,
    header: c.label,
    width: c.larguraPdf,
    align: c.align,
    wrap: c.wrap,
  }));

  // Ajuste de largura à página: sobra vai para a Descrição (ou para a maior
  // coluna, se Descrição não foi escolhida); falta é rateada proporcionalmente
  // — sem isso, marcar os 14 campos estouraria a margem direita.
  const tableWidth = cols.reduce((s, c) => s + c.width, 0);
  const extra = disponivel - tableWidth;
  if (extra > 0) {
    const alvo = cols.find((c) => c.key === "descricao")
      ?? cols.reduce((a, b) => (b.width > a.width ? b : a), cols[0]);
    if (alvo) alvo.width += extra;
  } else if (extra < 0) {
    const fator = disponivel / tableWidth;
    cols.forEach((c) => { c.width = Math.max(28, c.width * fator); });
    // O arredondamento do mínimo pode reestourar; devolve a diferença à maior.
    const sobra = disponivel - cols.reduce((s, c) => s + c.width, 0);
    if (sobra !== 0 && cols.length > 0) {
      cols.reduce((a, b) => (b.width > a.width ? b : a), cols[0]).width += sobra;
    }
  }

  const FS = 7.5;          // fonte das células
  const FS_HEAD = 7.5;     // cabeçalho da tabela
  const LINE_H = 9.2;      // altura de linha de texto
  const ROW_PAD = 4;       // padding vertical da célula

  let page!: PDFPage;
  let y = 0;
  const pages: PDFPage[] = [];

  const colX = (i: number): number => contentLeft + cols.slice(0, i).reduce((s, c) => s + c.width, 0);

  /**
   * Cabeçalho da tabela.
   *
   * Até 17-ago-2026 cada título era desenhado inteiro a partir do x da coluna,
   * sem nenhum limite de largura — então "Fornecedor / contraparte" invadia
   * "Referência (NF / recibo)", que invadia "Forma de Pagamento", e o
   * cabeçalho saía ilegível ("Fornecedor / contraparteReferência (NF Forma…").
   * As CÉLULAS já quebravam em várias linhas (wrapLines); só o cabeçalho não.
   * Agora ele quebra igual — em até 2 linhas — e a faixa cresce conforme a
   * necessidade da coluna mais alta.
   */
  const HEAD_WRAP = 2;

  /**
   * O corpo trunca com reticências quando não cabe (é o certo para um valor
   * longo), mas um TÍTULO truncado — "Venciment…", "Referência (NF…" — deixa a
   * coluna sem nome. Marcar os 14 campos aperta tanto as colunas que nem
   * "Parcelas" cabe em 7,5pt. Então, em vez de cortar, o cabeçalho encolhe:
   * procura o maior corpo em que TODOS os títulos cabem inteiros em até duas
   * linhas. Só se nem no menor couber é que a quebra volta a truncar.
   */
  const TAMANHOS_HEAD = [FS_HEAD, 7, 6.5, 6, 5.5];

  const fsHead = (() => {
    for (const size of TAMANHOS_HEAD) {
      const cabe = cols.every((c) => {
        const linhas = wrapLines(fontBold, c.header, size, c.width - 6, HEAD_WRAP);
        return linhas.every((l) => !l.endsWith("…"));
      });
      if (cabe) return size;
    }
    return TAMANHOS_HEAD[TAMANHOS_HEAD.length - 1];
  })();

  const headLineH = Math.max(LINE_H * (fsHead / FS_HEAD), fsHead + 1.2);

  function linhasCabecalho(): string[][] {
    return cols.map((c) => wrapLines(fontBold, c.header, fsHead, c.width - 6, HEAD_WRAP));
  }

  function drawCabecalhoTabela(): void {
    const linhas = linhasCabecalho();
    const nLinhas = Math.max(1, ...linhas.map((l) => l.length));
    const headH = nLinhas * headLineH + ROW_PAD * 2 - 2;
    page.drawRectangle({ x: contentLeft, y: y - headH, width: contentRight - contentLeft, height: headH, color: C_HEADER_BG });
    cols.forEach((c, i) => {
      const x = colX(i);
      linhas[i].forEach((ln, li) => {
        const tw = widthOf(fontBold, ln, fsHead);
        const tx = c.align === "right" ? x + c.width - 3 - tw : x + 3;
        page.drawText(ln, { x: tx, y: y - ROW_PAD - fsHead + 1 - li * headLineH, size: fsHead, font: fontBold, color: C_INK });
      });
    });
    y -= headH;
  }

  function novaPagina(primeira: boolean): void {
    page = doc.addPage([A4_LANDSCAPE.w, A4_LANDSCAPE.h]);
    pages.push(page);
    y = A4_LANDSCAPE.h - MARGIN.top;

    if (primeira) {
      // Cabeçalho institucional (1ª página).
      let textX = contentLeft;
      if (logo) {
        const lw = 30;
        const lh = (logo.height / logo.width) * lw;
        page.drawImage(logo, { x: contentLeft, y: y - lh + 2, width: lw, height: lh });
        textX = contentLeft + lw + 10;
      }
      page.drawText("AramBI", { x: textX, y: y - 12, size: 14, font: fontBold, color: C_INK });
      page.drawText("Gestão Agro", { x: textX, y: y - 22, size: 8, font, color: C_MUTED });
      const titulo = safe(meta.titulo ?? "Relatório de Lançamentos Financeiros");
      const tw = widthOf(fontBold, titulo, 11);
      page.drawText(titulo, { x: contentRight - tw, y: y - 12, size: 11, font: fontBold, color: C_INK });
      const sub = `Gerado em ${formatDate(new Date())}`;
      const sw = widthOf(font, sub, 8);
      page.drawText(sub, { x: contentRight - sw, y: y - 23, size: 8, font, color: C_MUTED });
      y -= 34;

      // Linha de escopo + filtros.
      const linhasMeta: string[] = [];
      if (meta.escopo) linhasMeta.push(meta.escopo);
      if (meta.filtros && meta.filtros.length) linhasMeta.push(`Filtros aplicados: ${meta.filtros.join("  ·  ")}`);
      linhasMeta.push(`${rows.length} lançamento${rows.length === 1 ? "" : "s"}`);
      for (const lm of linhasMeta) {
        page.drawText(fitOneLine(font, lm, 8, contentRight - contentLeft), { x: contentLeft, y: y - 8, size: 8, font, color: C_MUTED });
        y -= 11;
      }
      if (meta.aviso) {
        page.drawText(fitOneLine(fontBold, meta.aviso, 8, contentRight - contentLeft), { x: contentLeft, y: y - 8, size: 8, font: fontBold, color: C_RED });
        y -= 11;
      }
      y -= 4;
      page.drawLine({ start: { x: contentLeft, y }, end: { x: contentRight, y }, thickness: 0.6, color: C_LINE });
      y -= 8;
    }

    drawCabecalhoTabela();
  }

  novaPagina(true);

  // Corpo da tabela
  let zebra = false;
  for (const r of rows) {
    // Pré-calcula quebras por coluna para saber a altura da linha.
    const cellLines: string[][] = cols.map((c) => {
      const raw = celula(r, c.key);
      return wrapLines(c.align === "right" ? fontBold : font, raw, FS, c.width - 8, c.wrap);
    });
    const nLines = Math.max(1, ...cellLines.map((l) => l.length));
    const rowH = nLines * LINE_H + ROW_PAD * 2 - (LINE_H - FS);

    if (y - rowH < MARGIN.bottom + 4) {
      novaPagina(false);
      zebra = false;
    }

    if (zebra) {
      page.drawRectangle({ x: contentLeft, y: y - rowH, width: contentRight - contentLeft, height: rowH, color: C_ZEBRA });
    }
    zebra = !zebra;

    cols.forEach((c, i) => {
      const x = colX(i);
      const lines = cellLines[i];
      const isValor = c.key === "valor";
      const color = isValor ? (r.valorNum < 0 ? C_RED : r.valorNum > 0 ? C_GREEN : C_INK) : C_INK;
      const f = isValor ? fontBold : font;
      lines.forEach((ln, li) => {
        const ty = y - ROW_PAD - FS - li * LINE_H + 1;
        const tw = widthOf(f, ln, FS);
        const tx = c.align === "right" ? x + c.width - 4 - tw : x + 4;
        page.drawText(ln, { x: tx, y: ty, size: FS, font: f, color });
      });
    });

    y -= rowH;
    page.drawLine({ start: { x: contentLeft, y }, end: { x: contentRight, y }, thickness: 0.3, color: C_LINE });
  }

  // ---- Totais (subtotais por banco + total geral) ----
  const totaisH = (porBanco.length + 1) * 13 + 14;
  if (y - totaisH < MARGIN.bottom + 4) novaPagina(false);
  y -= 8;
  const boxX = contentRight - 260;
  page.drawLine({ start: { x: boxX, y }, end: { x: contentRight, y }, thickness: 0.6, color: C_LINE });
  y -= 13;
  for (const b of porBanco) {
    const lbl = fitOneLine(font, `Subtotal ${b.banco}`, 8.5, 170);
    page.drawText(lbl, { x: boxX, y: y - 8, size: 8.5, font, color: C_MUTED });
    const v = formatCurrency(b.total);
    const vw = widthOf(font, v, 8.5);
    page.drawText(v, { x: contentRight - vw, y: y - 8, size: 8.5, font, color: C_INK });
    y -= 13;
  }
  page.drawLine({ start: { x: boxX, y: y - 1 }, end: { x: contentRight, y: y - 1 }, thickness: 0.4, color: C_LINE });
  y -= 3;
  page.drawText("TOTAL GERAL", { x: boxX, y: y - 9, size: 9.5, font: fontBold, color: C_INK });
  const tg = formatCurrency(totalGeral);
  const tgw = widthOf(fontBold, tg, 9.5);
  page.drawText(tg, { x: contentRight - tgw, y: y - 9, size: 9.5, font: fontBold, color: totalGeral < 0 ? C_RED : C_INK });

  // ---- Rodapé (numeração) em todas as páginas ----
  const totalPages = pages.length;
  pages.forEach((pg, idx) => {
    const txt = `AramBI · Gestão Agro`;
    pg.drawText(txt, { x: MARGIN.left, y: MARGIN.bottom - 16, size: 7, font, color: C_MUTED });
    const pageTxt = `Página ${idx + 1} de ${totalPages}`;
    const pw = widthOf(font, pageTxt, 7);
    pg.drawText(pageTxt, { x: contentRight - pw, y: MARGIN.bottom - 16, size: 7, font, color: C_MUTED });
  });

  const bytes = await doc.save();
  baixar(bytes, nomeArquivo("pdf"), "application/pdf");
}
