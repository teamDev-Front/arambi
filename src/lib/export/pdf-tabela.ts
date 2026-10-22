// Motor de PDF "tabela de relatório" compartilhado (21-out-2026).
//
// Mesmo visual dos exports do Financeiro e da Distribuição de Lucro (A4
// paisagem, timbre com respiro de 30pt — 04-set —, cabeçalho de tabela que
// quebra em até 2 linhas e encolhe a fonte para caber — 17-ago —, zebra,
// caixa de totais à direita e rodapé "AramBI · Gestão Agro | Emitido por |
// Página X de Y" — 20-ago). Financeiro e DL seguem com as cópias deles; os
// relatórios novos (Vendas Futuras, Culturas & Safra) usam este.
//
// Recebe células JÁ FORMATADAS (texto): quem chama decide moeda, sacas, datas.
// Roda no client (pdf-lib + fetch do timbre em /public).

"use client";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { sanitizeWinAnsi } from "@/lib/pdf/helpers";

export interface PdfColuna {
  header: string;
  /** Largura relativa (pt). A tabela é ajustada à página. */
  width: number;
  align?: "left" | "right";
  /** Máximo de linhas na célula (padrão 1). */
  wrap?: number;
  /** Célula em negrito (ex.: valores em R$). */
  bold?: boolean;
  /** Recebe a sobra de largura da página (ex.: Comprador, Descrição). */
  expandir?: boolean;
}

export interface PdfTotal {
  rotulo: string;
  valor: string;
  /** Linha final em negrito, com traço acima (ex.: TOTAL GERAL). */
  destaque?: boolean;
  /** Valor em vermelho. */
  negativo?: boolean;
}

export interface PdfTabelaOpts {
  titulo: string;
  /** Linhas curtas sob o timbre (ex.: "Filtros aplicados: …"). */
  subtitulos?: string[];
  /** Quadros de resumo antes da tabela (ex.: Armazenado / Saldo atual). */
  resumo?: { rotulo: string; valor: string }[];
  colunas: PdfColuna[];
  /** Células já formatadas, uma linha por item. */
  linhas: string[][];
  /** Linha de totais da própria tabela (fundo cinza, mesmas colunas). */
  linhaTotais?: string[];
  /** Caixa de subtotais/total no fim, à direita. */
  totais?: PdfTotal[];
  /** "Emitido por: Fulano | data às hora" — rodapé de toda página. */
  emitidoPor?: string;
}

const A4_LANDSCAPE = { w: 841.89, h: 595.28 };
const MARGIN = { top: 40, bottom: 38, left: 32, right: 32 };

const C_INK = rgb(0.06, 0.12, 0.11);
const C_MUTED = rgb(0.42, 0.40, 0.36);
const C_LINE = rgb(0.85, 0.83, 0.78);
const C_HEADER_BG = rgb(0.93, 0.92, 0.89);
const C_ZEBRA = rgb(0.975, 0.97, 0.96);
const C_RED = rgb(0.78, 0.16, 0.13);

// O Helvetica do pdf-lib só desenha WinAnsi (Latin-1 + 27 sinais do CP1252) e o
// drawText LANÇA ERRO com o resto — um emoji colado do WhatsApp numa observação
// derrubava o PDF inteiro. sanitizeWinAnsi converte o que tem equivalente
// (seta → "->", espaço não separável…); o que sobrar fora do WinAnsi sai.
const WINANSI_EXTRAS = "ŒœŠšŸŽžƒˆ˜–—‘’‚“”„†‡•…‰‹›€™";

function safe(s: string): string {
  return Array.from(sanitizeWinAnsi(s ?? "").replace(/[\t\r\n]+/g, " "))
    .filter((ch) => {
      const cp = ch.codePointAt(0) ?? 0;
      return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WINANSI_EXTRAS.includes(ch);
    })
    .join("");
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

export function baixarArquivo(bytes: Uint8Array, filename: string, mime: string): void {
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

/** "arambi-<prefixo>-AAAAMMDD.<ext>" com a data de hoje. */
export function nomeArquivoRelatorio(prefixo: string, ext: string): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `arambi-${prefixo}-${ymd}.${ext}`;
}

export async function gerarPdfTabela(opts: PdfTabelaOpts): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await carregarLogo(doc);

  const contentLeft = MARGIN.left;
  const contentRight = A4_LANDSCAPE.w - MARGIN.right;
  const disponivel = contentRight - contentLeft;

  const cols = opts.colunas.map((c) => ({
    header: c.header,
    width: c.width,
    align: c.align ?? "left",
    wrap: c.wrap ?? 1,
    bold: !!c.bold,
    expandir: !!c.expandir,
  }));

  // Ajuste à página: sobra vai para a coluna "expandir" (ou a maior); falta é
  // rateada proporcionalmente — mesma regra do export da DL (19-ago).
  const tableWidth = cols.reduce((s, c) => s + c.width, 0);
  const extra = disponivel - tableWidth;
  if (cols.length > 0 && extra > 0) {
    const alvo = cols.find((c) => c.expandir) ?? cols.reduce((a, b) => (b.width > a.width ? b : a), cols[0]);
    alvo.width += extra;
  } else if (cols.length > 0 && extra < 0) {
    const fator = disponivel / tableWidth;
    cols.forEach((c) => { c.width = Math.max(28, c.width * fator); });
    const sobra = disponivel - cols.reduce((s, c) => s + c.width, 0);
    if (sobra !== 0) cols.reduce((a, b) => (b.width > a.width ? b : a), cols[0]).width += sobra;
  }

  const FS = 7.5;
  const FS_HEAD = 7.5;
  const LINE_H = 9.2;
  const ROW_PAD = 4;

  let page!: PDFPage;
  let y = 0;
  const pages: PDFPage[] = [];

  const colX = (i: number): number => contentLeft + cols.slice(0, i).reduce((s, c) => s + c.width, 0);

  const HEAD_WRAP = 2;
  const TAMANHOS_HEAD = [FS_HEAD, 7, 6.5, 6, 5.5];
  const fsHead = (() => {
    for (const size of TAMANHOS_HEAD) {
      const cabe = cols.every((c) =>
        wrapLines(fontBold, c.header, size, c.width - 6, HEAD_WRAP).every((l) => !l.endsWith("…")),
      );
      if (cabe) return size;
    }
    return TAMANHOS_HEAD[TAMANHOS_HEAD.length - 1];
  })();
  const headLineH = Math.max(LINE_H * (fsHead / FS_HEAD), fsHead + 1.2);

  function drawCabecalhoTabela(): void {
    const linhas = cols.map((c) => wrapLines(fontBold, c.header, fsHead, c.width - 6, HEAD_WRAP));
    const nLinhas = Math.max(1, ...linhas.map((l) => l.length));
    const headH = nLinhas * headLineH + ROW_PAD * 2 - 2;
    page.drawRectangle({ x: contentLeft, y: y - headH, width: disponivel, height: headH, color: C_HEADER_BG });
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

  function drawResumo(): void {
    const itens = opts.resumo ?? [];
    if (itens.length === 0) return;
    const porLinha = Math.min(itens.length, 5);
    const larg = disponivel / porLinha;
    for (let i = 0; i < itens.length; i += porLinha) {
      itens.slice(i, i + porLinha).forEach((it, j) => {
        const x = contentLeft + j * larg;
        page.drawText(fitOneLine(font, it.rotulo, 7.5, larg - 10), { x, y: y - 8, size: 7.5, font, color: C_MUTED });
        page.drawText(fitOneLine(fontBold, it.valor, 11, larg - 10), { x, y: y - 22, size: 11, font: fontBold, color: C_INK });
      });
      y -= 30;
    }
    y -= 4;
  }

  function novaPagina(primeira: boolean): void {
    page = doc.addPage([A4_LANDSCAPE.w, A4_LANDSCAPE.h]);
    pages.push(page);
    y = A4_LANDSCAPE.h - MARGIN.top;

    if (primeira) {
      const LOGO_W = 34;
      const logoH = logo ? (logo.height / logo.width) * LOGO_W : 34;
      const meio = y - logoH / 2;
      let textX = contentLeft;
      if (logo) {
        page.drawImage(logo, { x: contentLeft, y: y - logoH, width: LOGO_W, height: logoH });
        textX = contentLeft + LOGO_W + 12;
      }
      page.drawText("AramBI", { x: textX, y: meio + 1, size: 14, font: fontBold, color: C_INK });
      page.drawText("Gestão Agro", { x: textX, y: meio - 10, size: 8, font, color: C_MUTED });
      const titulo = fitOneLine(fontBold, opts.titulo, 11, disponivel - 160);
      const tw = widthOf(fontBold, titulo, 11);
      page.drawText(titulo, { x: contentRight - tw, y: meio - 4, size: 11, font: fontBold, color: C_INK });
      y -= logoH + 30;

      for (const sub of opts.subtitulos ?? []) {
        if (!sub) continue;
        page.drawText(fitOneLine(font, sub, 8, disponivel), { x: contentLeft, y: y - 8, size: 8, font, color: C_MUTED });
        y -= 11;
      }
      y -= 4;
      page.drawLine({ start: { x: contentLeft, y }, end: { x: contentRight, y }, thickness: 0.6, color: C_LINE });
      y -= 10;
      drawResumo();
    }

    drawCabecalhoTabela();
  }

  novaPagina(true);

  let zebra = false;
  function drawLinha(cells: string[], fundo: ReturnType<typeof rgb> | null, negrito: boolean): void {
    const cellLines = cols.map((c, i) =>
      wrapLines(negrito || c.bold ? fontBold : font, cells[i] ?? "", FS, c.width - 8, c.wrap),
    );
    const nLines = Math.max(1, ...cellLines.map((l) => l.length));
    const rowH = nLines * LINE_H + ROW_PAD * 2 - (LINE_H - FS);
    if (y - rowH < MARGIN.bottom + 4) {
      novaPagina(false);
      zebra = false;
    }
    if (fundo) page.drawRectangle({ x: contentLeft, y: y - rowH, width: disponivel, height: rowH, color: fundo });
    cols.forEach((c, i) => {
      const x = colX(i);
      const f = negrito || c.bold ? fontBold : font;
      cellLines[i].forEach((ln, li) => {
        const ty = y - ROW_PAD - FS - li * LINE_H + 1;
        const tw = widthOf(f, ln, FS);
        const tx = c.align === "right" ? x + c.width - 4 - tw : x + 4;
        page.drawText(ln, { x: tx, y: ty, size: FS, font: f, color: C_INK });
      });
    });
    y -= rowH;
    page.drawLine({ start: { x: contentLeft, y }, end: { x: contentRight, y }, thickness: 0.3, color: C_LINE });
  }

  if (opts.linhas.length === 0) {
    page.drawText("Nenhum registro no recorte.", { x: contentLeft + 4, y: y - 14, size: 8.5, font, color: C_MUTED });
    y -= 20;
  }
  for (const r of opts.linhas) {
    const fundo = zebra ? C_ZEBRA : null;
    zebra = !zebra;
    drawLinha(r, fundo, false);
  }
  if (opts.linhaTotais) drawLinha(opts.linhaTotais, C_HEADER_BG, true);

  // ---- Caixa de subtotais / total ----
  const totais = opts.totais ?? [];
  if (totais.length > 0) {
    const totaisH = totais.length * 13 + 16;
    if (y - totaisH < MARGIN.bottom + 4) novaPagina(false);
    y -= 8;
    const boxX = contentRight - 300;
    page.drawLine({ start: { x: boxX, y }, end: { x: contentRight, y }, thickness: 0.6, color: C_LINE });
    y -= 13;
    for (const t of totais) {
      if (t.destaque) {
        page.drawLine({ start: { x: boxX, y: y + 3 }, end: { x: contentRight, y: y + 3 }, thickness: 0.4, color: C_LINE });
        y -= 2;
      }
      const f = t.destaque ? fontBold : font;
      const size = t.destaque ? 9.5 : 8.5;
      page.drawText(fitOneLine(f, t.rotulo, size, 190), { x: boxX, y: y - 8, size, font: f, color: t.destaque ? C_INK : C_MUTED });
      const v = safe(t.valor);
      const vw = widthOf(f, v, size);
      page.drawText(v, { x: contentRight - vw, y: y - 8, size, font: f, color: t.negativo ? C_RED : C_INK });
      y -= 13;
    }
  }

  const totalPages = pages.length;
  pages.forEach((pg, idx) => {
    pg.drawText("AramBI · Gestão Agro", { x: MARGIN.left, y: MARGIN.bottom - 16, size: 7, font, color: C_MUTED });
    if (opts.emitidoPor) {
      const em = safe(opts.emitidoPor);
      const ew = widthOf(font, em, 7);
      pg.drawText(em, { x: (contentLeft + contentRight) / 2 - ew / 2, y: MARGIN.bottom - 16, size: 7, font, color: C_MUTED });
    }
    const pageTxt = `Página ${idx + 1} de ${totalPages}`;
    const pw = widthOf(font, pageTxt, 7);
    pg.drawText(pageTxt, { x: contentRight - pw, y: MARGIN.bottom - 16, size: 7, font, color: C_MUTED });
  });

  return doc.save();
}

/** Gera e baixa o PDF. */
export async function exportarPdfTabela(opts: PdfTabelaOpts, arquivo: string): Promise<void> {
  const bytes = await gerarPdfTabela(opts);
  baixarArquivo(bytes, arquivo, "application/pdf");
}
