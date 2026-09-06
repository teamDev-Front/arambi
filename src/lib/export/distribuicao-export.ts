// Exportação "espelho da tela" da Distribuição de Lucro em XLSX e PDF
// (ajuste 27-jul — mesmas praticidades do Financeiro).
//
// 19-ago: ganhou a tela de seleção de campos ("Campos do relatório"), no mesmo
// padrão do Financeiro (RF 31-jul de lá) — catálogo único de campos que
// alimenta o modal, o PDF e o XLSX, com linha de filtros e subtotais opcionais.
//
// Roda 100% no client a partir das linhas já carregadas (o recorte filtrado da
// tela).

"use client";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { sanitizeWinAnsi } from "@/lib/pdf/helpers";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import type { TransacaoSocioRich } from "@/lib/queries/distribuicao";
import { STATUS_DL_LABEL } from "@/types";
import { buildXlsx, xtext, xmoney, type XlsxValue } from "./xlsx";

// ---------------------------------------------------------------------------
// Modelo de linha "achatado" — fonte única para PDF e XLSX (mesmas colunas da
// tela: Data do Repasse, Competência, Sócio, Classificação, Descrição, Conta
// Destino, Vencimento, Valor, Status — mais os extras Repasse e Observação).
// ---------------------------------------------------------------------------
interface DlExportRow {
  dataRepasse: string;
  competencia: string;
  socio: string;
  classificacao: string;
  descricao: string;
  contaDestino: string;
  vencimento: string;
  valorNum: number;
  valorStr: string;
  status: string;
  repasse: string;     // "Consolidado" quando vinculado a repasse global
  observacao: string;
}

export interface DistribuicaoExportMeta {
  titulo?: string;
  /**
   * Linha curta sobre o recorte (ex.: "Seleção manual — 12 lançamentos").
   * RF 20-ago: não sai mais no arquivo — quem ainda a exibe é a tela de
   * seleção de campos. Mantida para não quebrar quem já monta a meta.
   */
  escopo?: string;
  /** Filtros humanizados aplicados (ex.: ["Sócio: Cláudio", "Status: Provisionado"]). */
  filtros?: string[];
  /**
   * Campos escolhidos na tela de seleção (19-ago). Ausente = layout padrão.
   * A ORDEM do relatório é sempre a do catálogo, não a de clique — assim dois
   * relatórios com os mesmos campos saem idênticos.
   */
  campos?: CampoExportDl[];
  /** Incluir a linha "Filtros aplicados" no cabeçalho. */
  incluirFiltros?: boolean;
  /** Incluir os subtotais por sócio e o total geral. */
  incluirTotais?: boolean;
  /** Rodapé "Emitido por: Fulano | data às hora" (RF 20-ago). */
  emitidoPor?: string;
}

// ---------------------------------------------------------------------------
// Catálogo de campos exportáveis — fonte única do modal de seleção, do PDF e
// do XLSX. Acrescentar um campo aqui o faz aparecer nos três lugares.
// ---------------------------------------------------------------------------
export type CampoExportDl =
  | "dataRepasse" | "competencia" | "socio" | "classificacao" | "descricao"
  | "contaDestino" | "vencimento" | "valor" | "status" | "repasse" | "observacao";

export interface CampoExportDlDef {
  key: CampoExportDl;
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

export const CAMPOS_EXPORT_DL: CampoExportDlDef[] = [
  { key: "dataRepasse",   label: "Data do Repasse", padrao: true,  larguraPdf: 62,  larguraXlsx: 15, align: "left",  wrap: 1 },
  { key: "competencia",   label: "Competência",     padrao: false, larguraPdf: 52,  larguraXlsx: 12, align: "left",  wrap: 1 },
  { key: "socio",         label: "Sócio",           padrao: true,  larguraPdf: 88,  larguraXlsx: 22, align: "left",  wrap: 2 },
  { key: "classificacao", label: "Classificação",   padrao: true,  larguraPdf: 108, larguraXlsx: 30, align: "left",  wrap: 2 },
  { key: "descricao",     label: "Descrição",       padrao: true,  larguraPdf: 170, larguraXlsx: 46, align: "left",  wrap: 3 },
  { key: "contaDestino",  label: "Conta Destino",   padrao: true,  larguraPdf: 108, larguraXlsx: 28, align: "left",  wrap: 2 },
  { key: "vencimento",    label: "Vencimento",      padrao: true,  larguraPdf: 56,  larguraXlsx: 13, align: "left",  wrap: 1 },
  { key: "valor",         label: "Valor",           padrao: true,  larguraPdf: 68,  larguraXlsx: 16, align: "right", wrap: 1 },
  { key: "status",        label: "Status",          padrao: true,  larguraPdf: 58,  larguraXlsx: 14, align: "left",  wrap: 1 },
  { key: "repasse",       label: "Repasse",         padrao: false, larguraPdf: 56,  larguraXlsx: 13, align: "left",  wrap: 1 },
  { key: "observacao",    label: "Observação",      padrao: false, larguraPdf: 100, larguraXlsx: 36, align: "left",  wrap: 3 },
];

export const CAMPOS_EXPORT_DL_PADRAO: CampoExportDl[] =
  CAMPOS_EXPORT_DL.filter((c) => c.padrao).map((c) => c.key);

/** Campos pedidos → definições, na ordem do catálogo. Vazio cai no padrão. */
function resolverCampos(campos?: CampoExportDl[]): CampoExportDlDef[] {
  if (!campos || campos.length === 0) {
    return CAMPOS_EXPORT_DL.filter((c) => c.padrao);
  }
  const escolhidos = new Set(campos);
  const sel = CAMPOS_EXPORT_DL.filter((c) => escolhidos.has(c.key));
  return sel.length > 0 ? sel : CAMPOS_EXPORT_DL.filter((c) => c.padrao);
}

/** Valor da célula (o "valor" tem versão numérica e formatada). */
function celula(r: DlExportRow, key: CampoExportDl): string {
  return key === "valor" ? r.valorStr : r[key];
}

/** "2026-08" → "08/2026". */
function mesHumano(m: string): string {
  return m?.length === 7 ? `${m.slice(5)}/${m.slice(0, 4)}` : m || "";
}

function toRows(rows: TransacaoSocioRich[]): DlExportRow[] {
  return rows.map((r) => ({
    dataRepasse: r.data_vencimento ? formatDate(r.data_vencimento) : "",
    competencia: mesHumano(r.mes_referencia),
    socio: r.socio?.apelido ?? r.socio?.nome_completo ?? "",
    classificacao: r.classificacao
      ? `${r.classificacao_pessoal} ${r.classificacao.nome}`
      : r.classificacao_pessoal,
    descricao: r.descricao ?? "",
    contaDestino: r.conta_bancaria_socio?.nome ?? r.conta_bancaria_socio_nome ?? "",
    vencimento: r.data_vencimento_despesa ? formatDate(r.data_vencimento_despesa) : "",
    valorNum: Number(r.valor) || 0,
    valorStr: formatCurrency(Number(r.valor) || 0),
    status: STATUS_DL_LABEL[r.status] ?? r.status,
    repasse: r.repasse_id ? "Consolidado" : "",
    observacao: r.observacao ?? "",
  }));
}

/** Subtotais por sócio (apenas sócios presentes) + total geral. */
function calcularTotais(rows: DlExportRow[]): {
  porSocio: { socio: string; total: number }[];
  totalGeral: number;
} {
  const mapa = new Map<string, number>();
  let totalGeral = 0;
  for (const r of rows) {
    const k = r.socio || "Sem sócio";
    mapa.set(k, (mapa.get(k) ?? 0) + r.valorNum);
    totalGeral += r.valorNum;
  }
  const porSocio = Array.from(mapa, ([socio, total]) => ({ socio, total }))
    .sort((a, b) => a.socio.localeCompare(b.socio));
  return { porSocio, totalGeral };
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
// XLSX
// ===========================================================================
export function exportDistribuicaoXlsx(
  rowsRich: TransacaoSocioRich[],
  meta: DistribuicaoExportMeta = {},
): void {
  const rows = toRows(rowsRich);
  const { porSocio, totalGeral } = calcularTotais(rows);

  // Campos escolhidos na tela de seleção (19-ago); sem escolha = padrão.
  const cols = resolverCampos(meta.campos);
  const incluirTotais = meta.incluirTotais !== false;

  const titleRows: string[] = [meta.titulo ?? "AramBI — Distribuição de Lucro (detalhado por sócio)"];
  // RF 20-ago: escopo, contagem e "Gerado em" saíram do cabeçalho; a
  // identificação da emissão virou a linha "Emitido por".
  if (meta.incluirFiltros !== false && meta.filtros?.length) {
    titleRows.push(`Filtros: ${meta.filtros.join(" · ")}`);
  }
  if (meta.emitidoPor) titleRows.push(meta.emitidoPor);

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
    for (const s of porSocio) dataRows.push(rotulo(`Subtotal ${s.socio}`, s.total));
    dataRows.push(rotulo("TOTAL GERAL", totalGeral));
  }

  const bytes = buildXlsx({
    sheetName: "Distribuição de Lucro",
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
// PDF (paisagem A4 — mesmo visual do export do Financeiro)
// ===========================================================================
const A4_LANDSCAPE = { w: 841.89, h: 595.28 };
const MARGIN = { top: 40, bottom: 38, left: 32, right: 32 };

interface ColDef {
  key: CampoExportDl;
  header: string;
  width: number;
  align: "left" | "right";
  wrap: number;
}

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
  const { porSocio, totalGeral } = calcularTotais(rows);
  const incluirTotais = meta.incluirTotais !== false;

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await carregarLogo(doc);

  const contentLeft = MARGIN.left;
  const contentRight = A4_LANDSCAPE.w - MARGIN.right;
  const disponivel = contentRight - contentLeft;

  // Colunas escolhidas na tela de seleção (19-ago), na ordem do catálogo.
  const cols: ColDef[] = resolverCampos(meta.campos).map((c) => ({
    key: c.key,
    header: c.label,
    width: c.larguraPdf,
    align: c.align,
    wrap: c.wrap,
  }));

  // Ajuste de largura à página: sobra vai para a Descrição (ou para a maior
  // coluna, se Descrição não foi escolhida); falta é rateada proporcionalmente.
  // A falta era o defeito de alinhamento apontado em 19-ago: as colunas fixas
  // somavam mais que a página e a tabela estourava a margem direita.
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

  const FS = 7.5;
  const FS_HEAD = 7.5;
  const LINE_H = 9.2;
  const ROW_PAD = 4;

  let page!: PDFPage;
  let y = 0;
  const pages: PDFPage[] = [];

  const colX = (i: number): number => contentLeft + cols.slice(0, i).reduce((s, c) => s + c.width, 0);

  // Cabeçalho quebra em até 2 linhas; se um título não couber inteiro, a fonte
  // do cabeçalho encolhe até caber (mesma solução do Financeiro, 17-ago).
  const HEAD_WRAP = 2;
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
      // Bloco da logotipo (ajuste 04-set-2026): o timbre é alto (traz
      // "AGROPECUÁRIA ARAMBURU" embaixo do A) e, com o recuo fixo de 34pt que
      // valia até aqui, ele encostava na linha "Filtros aplicados". Agora o
      // recuo é a altura real do timbre mais um respiro de 30pt, e os textos
      // ao lado (AramBI / Gestão Agro / título) ficam centralizados nele —
      // modelo do print enviado pela Adri, padronizado no Financeiro e na DL.
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
      const titulo = safe(meta.titulo ?? "Distribuição de Lucro — Detalhado por Sócio");
      const tw = widthOf(fontBold, titulo, 11);
      page.drawText(titulo, { x: contentRight - tw, y: meio - 4, size: 11, font: fontBold, color: C_INK });
      // RF 20-ago: o "Gerado em" saiu do cabeçalho — a emissão agora é o rodapé.
      y -= logoH + 30;

      // RF 20-ago: ficou só a linha de filtros (escopo e contagem saíram).
      const linhasMeta: string[] = [];
      if (meta.incluirFiltros !== false && meta.filtros && meta.filtros.length) {
        linhasMeta.push(`Filtros aplicados: ${meta.filtros.join("  ·  ")}`);
      }
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

  // ---- Totais (subtotais por sócio + total geral) ----
  if (incluirTotais) {
    const totaisH = (porSocio.length + 1) * 13 + 14;
    if (y - totaisH < MARGIN.bottom + 4) novaPagina(false);
    y -= 8;
    const boxX = contentRight - 260;
    page.drawLine({ start: { x: boxX, y }, end: { x: contentRight, y }, thickness: 0.6, color: C_LINE });
    y -= 13;
    for (const s of porSocio) {
      const lbl = fitOneLine(font, `Subtotal ${s.socio}`, 8.5, 170);
      page.drawText(lbl, { x: boxX, y: y - 8, size: 8.5, font, color: C_MUTED });
      const v = formatCurrency(s.total);
      const vw = widthOf(font, v, 8.5);
      page.drawText(v, { x: contentRight - vw, y: y - 8, size: 8.5, font, color: C_INK });
      y -= 13;
    }
    page.drawLine({ start: { x: boxX, y: y - 1 }, end: { x: contentRight, y: y - 1 }, thickness: 0.4, color: C_LINE });
    y -= 3;
    page.drawText("TOTAL DO RECORTE", { x: boxX, y: y - 9, size: 9.5, font: fontBold, color: C_INK });
    const tg = formatCurrency(totalGeral);
    const tgw = widthOf(fontBold, tg, 9.5);
    page.drawText(tg, { x: contentRight - tgw, y: y - 9, size: 9.5, font: fontBold, color: totalGeral < 0 ? C_RED : C_INK });
  }

  const totalPages = pages.length;
  pages.forEach((pg, idx) => {
    pg.drawText("AramBI · Gestão Agro", { x: MARGIN.left, y: MARGIN.bottom - 16, size: 7, font, color: C_MUTED });
    // RF 20-ago: quem emitiu + data e hora, ao centro do rodapé de toda página.
    if (meta.emitidoPor) {
      const em = safe(meta.emitidoPor);
      const ew = widthOf(font, em, 7);
      pg.drawText(em, { x: (contentLeft + contentRight) / 2 - ew / 2, y: MARGIN.bottom - 16, size: 7, font, color: C_MUTED });
    }
    const pageTxt = `Página ${idx + 1} de ${totalPages}`;
    const pw = widthOf(font, pageTxt, 7);
    pg.drawText(pageTxt, { x: contentRight - pw, y: MARGIN.bottom - 16, size: 7, font, color: C_MUTED });
  });

  const bytes = await doc.save();
  baixar(bytes, nomeArquivo("pdf"), "application/pdf");
}
