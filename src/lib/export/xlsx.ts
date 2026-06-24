// Gerador de XLSX (Office Open XML / SpreadsheetML) SEM dependências externas.
//
// Por que escrever à mão em vez de usar uma lib (SheetJS/ExcelJS)?
//  • Segurança: zero superfície de supply-chain; só PRODUZIMOS arquivos, nunca
//    parseamos entrada não confiável (onde moram os CVEs dessas libs).
//  • Performance/tamanho: nenhum bundle extra no client.
//  • Controle: schema fixo e conhecido (1 aba, cabeçalho + linhas + totais).
//
// O .xlsx é um ZIP de XMLs. Usamos o método "store" (sem compressão) para não
// precisar de deflate — só CRC-32 + montagem do ZIP. Strings vão como inlineStr
// (dispensa sharedStrings) e valores monetários como número real (Excel soma).

// ---------------------------------------------------------------------------
// Tipos de célula
// ---------------------------------------------------------------------------
export type XlsxValue =
  | { kind: "text"; value: string; bold?: boolean }
  | { kind: "number"; value: number; money?: boolean; bold?: boolean };

export const xtext = (value: string, opts?: { bold?: boolean }): XlsxValue =>
  ({ kind: "text", value: value ?? "", bold: opts?.bold });
export const xmoney = (value: number, opts?: { bold?: boolean }): XlsxValue =>
  ({ kind: "number", value: Number(value) || 0, money: true, bold: opts?.bold });
export const xnum = (value: number, opts?: { bold?: boolean }): XlsxValue =>
  ({ kind: "number", value: Number(value) || 0, bold: opts?.bold });

export interface XlsxColumn {
  header: string;
  /** Largura aproximada em caracteres. */
  width?: number;
}

export interface XlsxBuildOptions {
  sheetName?: string;
  columns: XlsxColumn[];
  /** Linhas de título/contexto acima do cabeçalho (col A, texto livre). */
  titleRows?: string[];
  /** Linhas de dados; cada linha é um array de células do tamanho das colunas. */
  rows: XlsxValue[][];
}

// ---------------------------------------------------------------------------
// CRC-32 (polinômio padrão do ZIP)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// ZIP (método "store") — monta um arquivo .zip a partir de entradas em memória
// ---------------------------------------------------------------------------
interface ZipEntry { name: string; data: Uint8Array }

function u16(n: number): number[] { return [n & 0xff, (n >>> 8) & 0xff]; }
function u32(n: number): number[] { return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]; }

function zipStore(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: number[][] = [];
  const central: number[][] = [];
  let offset = 0;
  // Data DOS fixa (1980-01-01) — evita depender de Date.now() e mantém builds estáveis.
  const dosTime = 0;
  const dosDate = 0x21; // (1980-1980)<<9 | 1<<5 | 1

  for (const e of entries) {
    const nameBytes = Array.from(enc.encode(e.name));
    const crc = crc32(e.data);
    const size = e.data.length;
    const flags = 0x0800; // bit 11 = nomes em UTF-8

    // Local file header
    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(flags), ...u16(0),
      ...u16(dosTime), ...u16(dosDate),
      ...u32(crc), ...u32(size), ...u32(size),
      ...u16(nameBytes.length), ...u16(0),
      ...nameBytes,
    ];
    chunks.push(local);
    chunks.push(Array.from(e.data));

    // Central directory header
    central.push([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(flags), ...u16(0),
      ...u16(dosTime), ...u16(dosDate),
      ...u32(crc), ...u32(size), ...u32(size),
      ...u16(nameBytes.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0),
      ...u32(offset),
      ...nameBytes,
    ]);

    offset += local.length + size;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const c of central) centralSize += c.length;

  const eocd = [
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(entries.length), ...u16(entries.length),
    ...u32(centralSize), ...u32(centralStart), ...u16(0),
  ];

  // Concatena tudo num único Uint8Array.
  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  for (const c of central) { out.set(c, p); p += c.length; }
  out.set(eocd, p);
  return out;
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------
const XML_CTRL = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]", "g");

function xmlEsc(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;")
    .replace(XML_CTRL, ""); // remove caracteres de controle inválidos em XML 1.0
}

function colLetter(n: number): string {
  // 0 -> A, 25 -> Z, 26 -> AA …
  let s = "";
  let x = n;
  do { s = String.fromCharCode(65 + (x % 26)) + s; x = Math.floor(x / 26) - 1; } while (x >= 0);
  return s;
}

// Estilos (cellXfs) referenciados por índice `s` nas células:
//   0 = normal | 1 = cabeçalho (negrito + fundo) | 2 = moeda | 3 = moeda negrito
//   4 = texto negrito
const STYLE = { NORMAL: 0, HEADER: 1, MONEY: 2, MONEY_BOLD: 3, TEXT_BOLD: 4 } as const;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;R$&quot;\\ #,##0.00;[Red]\\-&quot;R$&quot;\\ #,##0.00"/></numFmts>
<fonts count="2">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEDEAE3"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FFB8B2A6"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

function workbookXml(sheetName: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${xmlEsc(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
}

const WORKBOOK_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

function cellXml(ref: string, v: XlsxValue): string {
  if (v.kind === "number") {
    const s = v.money ? (v.bold ? STYLE.MONEY_BOLD : STYLE.MONEY) : (v.bold ? STYLE.TEXT_BOLD : STYLE.NORMAL);
    const num = Number.isFinite(v.value) ? v.value : 0;
    return `<c r="${ref}" s="${s}"><v>${num}</v></c>`;
  }
  const s = v.bold ? STYLE.TEXT_BOLD : STYLE.NORMAL;
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v.value)}</t></is></c>`;
}

function sheetXml(opts: XlsxBuildOptions): string {
  const ncols = opts.columns.length;
  const titleRows = opts.titleRows ?? [];
  const rowsXml: string[] = [];
  let rowIdx = 1; // 1-based

  // Linhas de título (texto livre na coluna A; primeira em negrito).
  for (let i = 0; i < titleRows.length; i++) {
    const c = cellXml(`A${rowIdx}`, xtext(titleRows[i], { bold: i === 0 }));
    rowsXml.push(`<row r="${rowIdx}">${c}</row>`);
    rowIdx++;
  }

  // Cabeçalho da tabela.
  {
    const cells = opts.columns.map((col, ci) =>
      `<c r="${colLetter(ci)}${rowIdx}" s="${STYLE.HEADER}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(col.header)}</t></is></c>`,
    ).join("");
    rowsXml.push(`<row r="${rowIdx}">${cells}</row>`);
    rowIdx++;
  }

  // Linhas de dados.
  for (const row of opts.rows) {
    const cells: string[] = [];
    for (let ci = 0; ci < ncols; ci++) {
      const v = row[ci] ?? xtext("");
      cells.push(cellXml(`${colLetter(ci)}${rowIdx}`, v));
    }
    rowsXml.push(`<row r="${rowIdx}">${cells.join("")}</row>`);
    rowIdx++;
  }

  const cols = opts.columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${(c.width ?? 14).toFixed(2)}" customWidth="1"/>`)
    .join("");
  const dim = `A1:${colLetter(Math.max(ncols - 1, 0))}${Math.max(rowIdx - 1, 1)}`;
  const freeze = titleRows.length + 1; // congela título + cabeçalho

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="${dim}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${rowsXml.join("")}</sheetData>
</worksheet>`;
}

function sanitizeSheetName(name: string): string {
  // Excel: máx 31 chars, sem : \ / ? * [ ]
  const clean = (name || "Planilha").replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31);
  return clean || "Planilha";
}

/** Monta o .xlsx e devolve os bytes. */
export function buildXlsx(opts: XlsxBuildOptions): Uint8Array {
  const enc = new TextEncoder();
  const sheetName = sanitizeSheetName(opts.sheetName ?? "Planilha");
  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: enc.encode(CONTENT_TYPES_XML) },
    { name: "_rels/.rels", data: enc.encode(RELS_XML) },
    { name: "xl/workbook.xml", data: enc.encode(workbookXml(sheetName)) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(WORKBOOK_RELS_XML) },
    { name: "xl/styles.xml", data: enc.encode(STYLES_XML) },
    { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheetXml(opts)) },
  ];
  return zipStore(entries);
}
