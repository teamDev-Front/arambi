// Exportação "espelho da tela" da Distribuição de Lucro em XLSX e PDF
// (ajuste 27-jul — mesmas praticidades do Financeiro).
//
// Roda 100% no client a partir das linhas já carregadas (o recorte filtrado da
// tela). Colunas na ordem pedida: Data do Repasse, Sócio, Classificação,
// Descrição, Conta Destino, Valor, Vencimento, Status.

"use client";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { sanitizeWinAnsi } from "@/lib/pdf/helpers";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import type { TransacaoSocioRich } from "@/lib/queries/distribuicao";
import { STATUS_DL_LABEL } from "@/types";
import { buildXlsx, xtext, xmoney, type XlsxValue } from "./xlsx";

export interface DistribuicaoExportMeta {
  titulo?: string;
  /** Filtros humanizados aplicados (ex.: ["Sócio: Cláudio", "Status: Provisionado"]). */
  filtros?: string[];
}

interface DlExportRow {
  dataRepasse: string;
  socio: string;
  classificacao: string;
  descricao: string;
  contaDestino: string;
  valorNum: number;
  vencimento: string;
  status: string;
}

function toRows(rows: TransacaoSocioRich[]): DlExportRow[] {
  return rows.map((r) => ({
    dataRepasse: r.data_vencimento ? formatDate(r.data_vencimento) : "",
    socio: r.socio?.apelido ?? r.socio?.nome_completo ?? "",
    classificacao: r.classificacao
      ? `${r.classificacao_pessoal} ${r.classificacao.nome}`
      : r.classificacao_pessoal,
    descricao: r.descricao ?? "",
    contaDestino: r.conta_bancaria_socio?.nome ?? r.conta_bancaria_socio_nome ?? "",
    valorNum: Number(r.valor) || 0,
    vencimento: r.data_vencimento_despesa ? formatDate(r.data_vencimento_despesa) : "",
    status: STATUS_DL_LABEL[r.status] ?? r.status,
  }));
}

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
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function nomeArquivo(ext: string): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `arambi-distribuicao-lucro-${ymd}.${ext}`;
}

// ===========================================================================
// XLSX — ordem pedida no ajuste 27-jul
// ===========================================================================
export function exportDistribuicaoXlsx(
  rowsRich: TransacaoSocioRich[],
  meta: DistribuicaoExportMeta = {},
): void {
  const rows = toRows(rowsRich);
  const total = rows.reduce((s, r) => s + r.valorNum, 0);

  const titleRows: string[] = [meta.titulo ?? "AramBI — Distribuição de Lucro (detalhado por sócio)"];
  if (meta.filtros && meta.filtros.length) titleRows.push(`Filtros: ${meta.filtros.join(" · ")}`);
  titleRows.push(`Gerado em ${formatDate(new Date())} · ${rows.length} lançamento${rows.length === 1 ? "" : "s"}`);

  const dataRows: XlsxValue[][] = rows.map((r) => [
    xtext(r.dataRepasse),
    xtext(r.socio),
    xtext(r.classificacao),
    xtext(r.descricao),
    xtext(r.contaDestino),
    xmoney(r.valorNum),
    xtext(r.vencimento),
    xtext(r.status),
  ]);

  dataRows.push([
    xtext(""), xtext(""), xtext(""), xtext(""),
    xtext("TOTAL", { bold: true }),
    xmoney(total, { bold: true }),
    xtext(""), xtext(""),
  ]);

  const bytes = buildXlsx({
    sheetName: "Distribuição de Lucro",
    titleRows,
    columns: [
      { header: "Data do Repasse", width: 15 },
      { header: "Sócio", width: 22 },
      { header: "Classificação", width: 30 },
      { header: "Descrição", width: 46 },
      { header: "Conta Destino", width: 28 },
      { header: "Valor", width: 16 },
      { header: "Vencimento", width: 13 },
      { header: "Status", width: 14 },
    ],
    rows: dataRows,
  });

  baixar(
    bytes,
    nomeArquivo("xlsx"),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}

// ===========================================================================
// PDF (paisagem A4 — mesmo visual do export do Financeiro)
// ===========================================================================
const A4_LANDSCAPE = { w: 841.89, h: 595.28 };
const MARGIN = { top: 40, bottom: 38, left: 32, right: 32 };

interface ColDef {
  key: keyof Omit<DlExportRow, "valorNum"> | "valorStr";
  header: string;
  width: number;
  align: "left" | "right";
  wrap: number;
}

const COLS: ColDef[] = [
  { key: "dataRepasse", header: "Data do Repasse", width: 74, align: "left", wrap: 1 },
  { key: "socio", header: "Sócio", width: 96, align: "left", wrap: 2 },
  { key: "classificacao", header: "Classificação", width: 120, align: "left", wrap: 2 },
  { key: "descricao", header: "Descrição", width: 200, align: "left", wrap: 3 },
  { key: "contaDestino", header: "Conta Destino", width: 120, align: "left", wrap: 2 },
  { key: "valorStr", header: "Valor", width: 74, align: "right", wrap: 1 },
  { key: "vencimento", header: "Vencimento", width: 58, align: "left", wrap: 1 },
  { key: "status", header: "Status", width: 60, align: "left", wrap: 1 },
];

const C_INK = rgb(0.06, 0.12, 0.11);
const C_MUTED = rgb(0.42, 0.40, 0.36);
const C_LINE = rgb(0.85, 0.83, 0.78);
const C_HEADER_BG = rgb(0.93, 0.92, 0.89);
const C_ZEBRA = rgb(0.975, 0.97, 0.96);
const C_RED = rgb(0.78, 0.16, 0.13);

function safe(s: string): string {
  return sanitizeWinAnsi(s ?? "").replace(/\t/g, " ");
}

function widthOf(font: PDFFont, text: string, size: number): number {
  try { return font.widthOfTextAtSize(text, size); } catch { return text.length * size * 0.5; }
}

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
  const consumed = lines.join(" ").length;
  if (consumed < t.length) {
    const last = lines[lines.length - 1] ?? "";
    lines[lines.length - 1] = fitOneLine(font, last + " " + t.slice(consumed).trim(), size, maxWidth);
  }
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

export async function exportDistribuicaoPdf(
  rowsRich: TransacaoSocioRich[],
  meta: DistribuicaoExportMeta = {},
): Promise<void> {
  const rows = toRows(rowsRich);
  const total = rows.reduce((s, r) => s + r.valorNum, 0);

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await carregarLogo(doc);

  const contentLeft = MARGIN.left;
  const contentRight = A4_LANDSCAPE.w - MARGIN.right;
  const tableWidth = COLS.reduce((s, c) => s + c.width, 0);
  const extra = (contentRight - contentLeft) - tableWidth;
  const cols = COLS.map((c) => ({ ...c }));
  if (extra > 0) {
    const desc = cols.find((c) => c.key === "descricao")!;
    desc.width += extra;
  }

  const FS = 7.5;
  const FS_HEAD = 7.5;
  const LINE_H = 9.2;
  const ROW_PAD = 4;

  let page!: PDFPage;
  let y = 0;
  const pages: PDFPage[] = [];

  const colX = (i: number): number => contentLeft + cols.slice(0, i).reduce((s, c) => s + c.width, 0);

  function drawCabecalhoTabela(): void {
    const headH = LINE_H + ROW_PAD * 2 - 2;
    page.drawRectangle({ x: contentLeft, y: y - headH, width: contentRight - contentLeft, height: headH, color: C_HEADER_BG });
    cols.forEach((c, i) => {
      const x = colX(i);
      const tw = widthOf(fontBold, c.header, FS_HEAD);
      const tx = c.align === "right" ? x + c.width - 4 - tw : x + 4;
      page.drawText(c.header, { x: tx, y: y - ROW_PAD - FS_HEAD + 1, size: FS_HEAD, font: fontBold, color: C_INK });
    });
    y -= headH;
  }

  function novaPagina(primeira: boolean): void {
    page = doc.addPage([A4_LANDSCAPE.w, A4_LANDSCAPE.h]);
    pages.push(page);
    y = A4_LANDSCAPE.h - MARGIN.top;

    if (primeira) {
      let textX = contentLeft;
      if (logo) {
        const lw = 30;
        const lh = (logo.height / logo.width) * lw;
        page.drawImage(logo, { x: contentLeft, y: y - lh + 2, width: lw, height: lh });
        textX = contentLeft + lw + 10;
      }
      page.drawText("AramBI", { x: textX, y: y - 12, size: 14, font: fontBold, color: C_INK });
      page.drawText("Gestão Agro", { x: textX, y: y - 22, size: 8, font, color: C_MUTED });
      const titulo = safe(meta.titulo ?? "Distribuição de Lucro — Detalhado por Sócio");
      const tw = widthOf(fontBold, titulo, 11);
      page.drawText(titulo, { x: contentRight - tw, y: y - 12, size: 11, font: fontBold, color: C_INK });
      const sub = `Gerado em ${formatDate(new Date())}`;
      const sw = widthOf(font, sub, 8);
      page.drawText(sub, { x: contentRight - sw, y: y - 23, size: 8, font, color: C_MUTED });
      y -= 34;

      const linhasMeta: string[] = [];
      if (meta.filtros && meta.filtros.length) linhasMeta.push(`Filtros aplicados: ${meta.filtros.join("  ·  ")}`);
      linhasMeta.push(`${rows.length} lançamento${rows.length === 1 ? "" : "s"}`);
      for (const lm of linhasMeta) {
        page.drawText(fitOneLine(font, lm, 8, contentRight - contentLeft), { x: contentLeft, y: y - 8, size: 8, font, color: C_MUTED });
        y -= 11;
      }
      y -= 4;
      page.drawLine({ start: { x: contentLeft, y }, end: { x: contentRight, y }, thickness: 0.6, color: C_LINE });
      y -= 8;
    }

    drawCabecalhoTabela();
  }

  novaPagina(true);

  let zebra = false;
  for (const r of rows) {
    const cellLines: string[][] = cols.map((c) => {
      const raw = c.key === "valorStr" ? formatCurrency(r.valorNum) : r[c.key];
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
      const isValor = c.key === "valorStr";
      const f = isValor ? fontBold : font;
      lines.forEach((ln, li) => {
        const ty = y - ROW_PAD - FS - li * LINE_H + 1;
        const tw = widthOf(f, ln, FS);
        const tx = c.align === "right" ? x + c.width - 4 - tw : x + 4;
        page.drawText(ln, { x: tx, y: ty, size: FS, font: f, color: C_INK });
      });
    });

    y -= rowH;
    page.drawLine({ start: { x: contentLeft, y }, end: { x: contentRight, y }, thickness: 0.3, color: C_LINE });
  }

  // Total
  if (y - 30 < MARGIN.bottom + 4) novaPagina(false);
  y -= 10;
  const boxX = contentRight - 220;
  page.drawLine({ start: { x: boxX, y }, end: { x: contentRight, y }, thickness: 0.6, color: C_LINE });
  y -= 4;
  page.drawText("TOTAL DO RECORTE", { x: boxX, y: y - 9, size: 9.5, font: fontBold, color: C_INK });
  const tg = formatCurrency(total);
  const tgw = widthOf(fontBold, tg, 9.5);
  page.drawText(tg, { x: contentRight - tgw, y: y - 9, size: 9.5, font: fontBold, color: total < 0 ? C_RED : C_INK });

  const totalPages = pages.length;
  pages.forEach((pg, idx) => {
    pg.drawText("AramBI · Gestão Agro", { x: MARGIN.left, y: MARGIN.bottom - 16, size: 7, font, color: C_MUTED });
    const pageTxt = `Página ${idx + 1} de ${totalPages}`;
    const pw = widthOf(font, pageTxt, 7);
    pg.drawText(pageTxt, { x: contentRight - pw, y: MARGIN.bottom - 16, size: 7, font, color: C_MUTED });
  });

  const bytes = await doc.save();
  baixar(bytes, nomeArquivo("pdf"), "application/pdf");
}
