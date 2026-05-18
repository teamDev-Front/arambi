// PDF Builder — wrapper sobre pdf-lib com utilitários para layout A4 brasileiro
// (texto justificado básico, wrap em largura, múltiplas páginas, fontes Times).

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, type RGB } from "pdf-lib";
import { sanitizeWinAnsi } from "./helpers";

export const PAGE = {
  width: 595.276,
  height: 841.890,
  margin: {
    top: 56,      // ~2cm
    bottom: 56,
    left: 64,     // ~2.3cm
    right: 64,
  },
} as const;

export interface DrawTextOptions {
  size?: number;
  font?: "regular" | "bold";
  color?: RGB;
  align?: "left" | "center" | "right" | "justify";
  lineHeight?: number;
  /** se true, não pula linha após o texto (escreve inline) */
  inline?: boolean;
  /** override de largura (default = largura útil) */
  width?: number;
  /** indent da primeira linha */
  indent?: number;
}

interface Segment {
  text: string;
  bold?: boolean;
}

export class PdfBuilder {
  private doc!: PDFDocument;
  private page!: PDFPage;
  private fontRegular!: PDFFont;
  private fontBold!: PDFFont;
  private y: number;
  private readonly defaultSize = 11;
  private readonly defaultLineHeight = 1.4;
  public readonly contentWidth: number;

  private constructor() {
    this.y = PAGE.height - PAGE.margin.top;
    this.contentWidth = PAGE.width - PAGE.margin.left - PAGE.margin.right;
  }

  static async create(): Promise<PdfBuilder> {
    const b = new PdfBuilder();
    b.doc = await PDFDocument.create();
    b.fontRegular = await b.doc.embedFont(StandardFonts.TimesRoman);
    b.fontBold    = await b.doc.embedFont(StandardFonts.TimesRomanBold);
    b.page = b.doc.addPage([PAGE.width, PAGE.height]);
    return b;
  }

  /** Pula N pontos verticalmente (ou abre página nova se necessário). */
  space(pt: number): this {
    this.y -= pt;
    this.ensureRoom(0);
    return this;
  }

  private ensureRoom(needed: number): void {
    if (this.y - needed < PAGE.margin.bottom) {
      this.page = this.doc.addPage([PAGE.width, PAGE.height]);
      this.y = PAGE.height - PAGE.margin.top;
    }
  }

  private font(kind?: "regular" | "bold"): PDFFont {
    return kind === "bold" ? this.fontBold : this.fontRegular;
  }

  private measure(text: string, size: number, font: PDFFont): number {
    return font.widthOfTextAtSize(text, size);
  }

  /**
   * Quebra texto puro em linhas que cabem em `width` pt, considerando uma fonte/size.
   * Preserva quebras de linha explícitas (\n).
   */
  private wrap(text: string, width: number, size: number, font: PDFFont): string[] {
    const lines: string[] = [];
    const paragraphs = text.split("\n");
    for (const par of paragraphs) {
      if (par.length === 0) { lines.push(""); continue; }
      const palavras = par.split(/\s+/);
      let linhaAtual = "";
      for (const palavra of palavras) {
        const tentativa = linhaAtual ? `${linhaAtual} ${palavra}` : palavra;
        if (this.measure(tentativa, size, font) <= width) {
          linhaAtual = tentativa;
        } else {
          if (linhaAtual) lines.push(linhaAtual);
          // se a palavra sozinha é maior que a width, deixa estourar
          linhaAtual = palavra;
        }
      }
      if (linhaAtual) lines.push(linhaAtual);
    }
    return lines;
  }

  /** Escreve um título centralizado em negrito. */
  title(text: string, opts: { size?: number; spaceAfter?: number } = {}): this {
    const size = opts.size ?? 14;
    const sanitized = sanitizeWinAnsi(text);
    const lineHeightPt = size * 1.3;
    const lines = this.wrap(sanitized, this.contentWidth, size, this.fontBold);
    for (const line of lines) {
      this.ensureRoom(lineHeightPt);
      const w = this.measure(line, size, this.fontBold);
      const x = PAGE.margin.left + (this.contentWidth - w) / 2;
      this.page.drawText(line, { x, y: this.y - size, size, font: this.fontBold, color: rgb(0, 0, 0) });
      this.y -= lineHeightPt;
    }
    this.y -= opts.spaceAfter ?? size * 0.6;
    return this;
  }

  /** Escreve parágrafo de texto puro. Suporta align justified. */
  paragraph(text: string, opts: DrawTextOptions = {}): this {
    const size = opts.size ?? this.defaultSize;
    const font = this.font(opts.font);
    const color = opts.color ?? rgb(0, 0, 0);
    const lineHeightPt = size * (opts.lineHeight ?? this.defaultLineHeight);
    const width = opts.width ?? this.contentWidth;
    const sanitized = sanitizeWinAnsi(text);
    const lines = this.wrap(sanitized, width, size, font);
    const align = opts.align ?? "left";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isLast = i === lines.length - 1;
      this.ensureRoom(lineHeightPt);
      let x = PAGE.margin.left;
      if (opts.indent && i === 0) x += opts.indent;
      const w = this.measure(line, size, font);
      const lineWidth = width - (opts.indent && i === 0 ? opts.indent : 0);

      if (align === "center") x = PAGE.margin.left + (width - w) / 2;
      else if (align === "right") x = PAGE.margin.left + width - w;

      if (align === "justify" && !isLast && line.includes(" ")) {
        // distribui espaço extra entre as palavras
        const palavras = line.split(" ");
        const espacoNatural = this.measure(" ", size, font);
        const larguraSemEspacos = palavras.reduce((acc, p) => acc + this.measure(p, size, font), 0);
        const gaps = palavras.length - 1;
        const extra = (lineWidth - larguraSemEspacos - gaps * espacoNatural) / gaps;
        let cursor = x;
        for (let k = 0; k < palavras.length; k++) {
          this.page.drawText(palavras[k], { x: cursor, y: this.y - size, size, font, color });
          if (k < palavras.length - 1) cursor += this.measure(palavras[k], size, font) + espacoNatural + extra;
        }
      } else {
        this.page.drawText(line, { x, y: this.y - size, size, font, color });
      }
      this.y -= lineHeightPt;
    }
    return this;
  }

  /**
   * Escreve um parágrafo com partes em negrito ("rich text" minimalista) e
   * quebras automáticas de linha. Suporta align left ou justify.
   */
  rich(segments: Segment[], opts: Omit<DrawTextOptions, "font"> = {}): this {
    const size = opts.size ?? this.defaultSize;
    const color = opts.color ?? rgb(0, 0, 0);
    const lineHeightPt = size * (opts.lineHeight ?? this.defaultLineHeight);
    const width = opts.width ?? this.contentWidth;
    const align = opts.align ?? "left";

    // Tokeniza em pedaços {token, bold} preservando espaços como tokens separados.
    type Token = { text: string; bold: boolean; isSpace: boolean; isBreak: boolean };
    const tokens: Token[] = [];
    for (const seg of segments) {
      const sanitized = sanitizeWinAnsi(seg.text);
      const partes = sanitized.split(/(\s+|\n)/);
      for (const p of partes) {
        if (!p) continue;
        if (p === "\n") tokens.push({ text: "", bold: !!seg.bold, isSpace: false, isBreak: true });
        else if (/^\s+$/.test(p)) tokens.push({ text: " ", bold: !!seg.bold, isSpace: true, isBreak: false });
        else tokens.push({ text: p, bold: !!seg.bold, isSpace: false, isBreak: false });
      }
    }

    type Line = { tokens: Token[]; hasBreak: boolean };
    const lines: Line[] = [];
    let current: Token[] = [];
    let currentWidth = 0;

    const tokenWidth = (t: Token): number => this.measure(t.text, size, this.font(t.bold ? "bold" : "regular"));

    for (const tk of tokens) {
      if (tk.isBreak) {
        lines.push({ tokens: current, hasBreak: true });
        current = []; currentWidth = 0; continue;
      }
      const w = tokenWidth(tk);
      if (currentWidth + w > width && current.length > 0) {
        // se token atual é espaço, ignora; senão fecha linha aqui
        if (tk.isSpace) continue;
        // tira espaço final pendente
        while (current.length && current[current.length - 1].isSpace) {
          const popped = current.pop()!;
          currentWidth -= tokenWidth(popped);
        }
        lines.push({ tokens: current, hasBreak: false });
        current = [tk]; currentWidth = w;
      } else {
        current.push(tk); currentWidth += w;
      }
    }
    if (current.length) lines.push({ tokens: current, hasBreak: true });

    for (let i = 0; i < lines.length; i++) {
      const { tokens: ltok, hasBreak } = lines[i];
      this.ensureRoom(lineHeightPt);

      // largura medida da linha sem ajuste
      const rawWidth = ltok.reduce((acc, t) => acc + tokenWidth(t), 0);
      // remove espaço final na renderização
      while (ltok.length && ltok[ltok.length - 1].isSpace) ltok.pop();

      let x = PAGE.margin.left;
      let extraPorEspaco = 0;
      const isLastVisualLine = i === lines.length - 1 || hasBreak;

      if (align === "center") {
        x = PAGE.margin.left + (width - rawWidth) / 2;
      } else if (align === "right") {
        x = PAGE.margin.left + width - rawWidth;
      } else if (align === "justify" && !isLastVisualLine) {
        const espacos = ltok.filter(t => t.isSpace).length;
        if (espacos > 0) {
          const sem = ltok.filter(t => !t.isSpace).reduce((a, t) => a + tokenWidth(t), 0);
          const ocupado = sem + espacos * tokenWidth({ text: " ", bold: false, isSpace: true, isBreak: false });
          extraPorEspaco = (width - ocupado) / espacos;
        }
      }

      for (const tk of ltok) {
        const f = this.font(tk.bold ? "bold" : "regular");
        const w = tokenWidth(tk);
        if (tk.text) this.page.drawText(tk.text, { x, y: this.y - size, size, font: f, color });
        x += w + (tk.isSpace ? extraPorEspaco : 0);
      }
      this.y -= lineHeightPt;
    }
    return this;
  }

  /** Linha horizontal decorativa (assinatura). */
  hr(opts: { width?: number; align?: "left" | "center"; thickness?: number } = {}): this {
    const width = opts.width ?? this.contentWidth * 0.6;
    const thickness = opts.thickness ?? 0.6;
    const align = opts.align ?? "center";
    const x = align === "center"
      ? PAGE.margin.left + (this.contentWidth - width) / 2
      : PAGE.margin.left;
    this.ensureRoom(thickness + 2);
    this.page.drawLine({
      start: { x, y: this.y },
      end:   { x: x + width, y: this.y },
      thickness,
      color: rgb(0, 0, 0),
    });
    this.y -= thickness + 2;
    return this;
  }

  /** Escreve linha em formato "label: value" (label em negrito), uma por chamada. */
  fieldLine(label: string, value: string, opts: { size?: number; spaceAfter?: number } = {}): this {
    this.rich([
      { text: `${label}: `, bold: true },
      { text: value },
    ], { size: opts.size, lineHeight: 1.3 });
    if (opts.spaceAfter !== undefined) this.space(opts.spaceAfter);
    return this;
  }

  /** Bloco de campos (vários "label: value"), com pouco espaço entre eles. */
  fields(items: Array<{ label: string; value: string }>, opts: { size?: number } = {}): this {
    for (const it of items) {
      this.rich([
        { text: `${it.label}: `, bold: true },
        { text: it.value },
      ], { size: opts.size ?? this.defaultSize, lineHeight: 1.25 });
    }
    return this;
  }

  /** Move cursor para uma altura específica (a partir do topo). */
  setY(yFromTop: number): this {
    this.y = PAGE.height - yFromTop;
    return this;
  }

  /** Y atual (para debug). */
  get cursor(): number { return this.y; }

  /** Finaliza e retorna Uint8Array (Buffer-ish) para upload. */
  async save(): Promise<Uint8Array> {
    return this.doc.save();
  }
}
