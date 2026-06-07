// Helpers para geração de PDF — número por extenso (R$), datas em PT-BR
// e sanitização de caracteres para WinAnsi (encoding das fontes padrão pdf-lib).

const UNIDADES = [
  "", "um", "dois", "três", "quatro", "cinco",
  "seis", "sete", "oito", "nove", "dez",
  "onze", "doze", "treze", "catorze", "quinze",
  "dezesseis", "dezessete", "dezoito", "dezenove",
];
const DEZENAS  = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

function ateMil(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (c > 0) partes.push(CENTENAS[c]);
  if (resto > 0) {
    if (resto < 20) {
      partes.push(UNIDADES[resto]);
    } else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      if (u === 0) partes.push(DEZENAS[d]);
      else partes.push(`${DEZENAS[d]} e ${UNIDADES[u]}`);
    }
  }
  return partes.join(" e ");
}

function inteiroPorExtenso(n: number): string {
  if (n === 0) return "zero";

  const grupos: number[] = [];
  let x = n;
  while (x > 0) {
    grupos.push(x % 1000);
    x = Math.floor(x / 1000);
  }

  const sufixos: Array<[string, string]> = [
    ["", ""],
    ["mil", "mil"],
    ["milhão", "milhões"],
    ["bilhão", "bilhões"],
    ["trilhão", "trilhões"],
  ];

  const partes: string[] = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i];
    if (g === 0) continue;
    const txt = ateMil(g);
    const [sing, plur] = sufixos[i] ?? ["", ""];
    if (i === 0) {
      partes.push(txt);
    } else if (i === 1) {
      if (g === 1) partes.push("mil");
      else partes.push(`${txt} mil`);
    } else {
      partes.push(`${txt} ${g === 1 ? sing : plur}`);
    }
  }

  if (partes.length > 1) {
    const ultimoIdx = partes.length - 1;
    const ultimo = grupos[0];
    const conector = (ultimo > 0 && (ultimo < 100 || ultimo % 100 === 0)) ? " e " : ", ";
    return partes.slice(0, ultimoIdx).join(", ") + conector + partes[ultimoIdx];
  }
  return partes[0] ?? "";
}

/**
 * Converte valor monetário em reais para extenso completo.
 * Exemplo: 1234.56 → "um mil, duzentos e trinta e quatro reais e cinquenta e seis centavos"
 */
export function valorPorExtenso(valor: number): string {
  const arred = Math.round(valor * 100) / 100;
  const reais     = Math.floor(arred);
  const centavos  = Math.round((arred - reais) * 100);

  const partes: string[] = [];
  if (reais > 0) {
    partes.push(`${inteiroPorExtenso(reais)} ${reais === 1 ? "real" : "reais"}`);
  }
  if (centavos > 0) {
    if (reais > 0) partes.push("e");
    partes.push(`${inteiroPorExtenso(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`);
  }
  if (partes.length === 0) return "zero real";
  return partes.join(" ");
}

const MESES_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** Recebe "YYYY-MM-DD" → "10 de março de 2026". */
export function formatDataPorExtenso(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dia = String(d).padStart(2, "0");
  return `${dia} de ${MESES_PT[m - 1]} de ${y}`;
}

/** Recebe "YYYY-MM-DD" → "10/03/2026". */
export function formatDataCurta(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

/** "YYYY-MM" → "Março/2026". */
export function formatCompetencia(mesRef: string): string {
  const [y, m] = mesRef.split("-").map(Number);
  const mes = MESES_PT[m - 1] ?? "";
  return `${mes.charAt(0).toUpperCase()}${mes.slice(1)}/${y}`;
}

/** Formata como moeda BR (apenas valor, sem prefixo R$). */
export function formatMoeda(valor: number): string {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valor);
}

// ────────────────────────────────────────────────────────────────────────────
// Concordância PF/PJ — geração textual centralizada (RF-01 / RF-04)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Frase de inscrição conforme o tipo de pessoa.
 *   pf → "inscrito(a) no CPF sob o nº 000.000.000-00"
 *   pj → "inscrita no CNPJ sob o nº 00.000.000/0000-00"
 */
export function fraseInscricao(tipo: "pf" | "pj" | undefined, documento: string): string {
  return tipo === "pj"
    ? `inscrita no CNPJ sob o nº ${documento}`
    : `inscrito(a) no CPF sob o nº ${documento}`;
}

/** Rótulo curto do documento (assinaturas/rodapés). */
export function rotuloDocumento(tipo: "pf" | "pj" | undefined): "CPF" | "CNPJ" {
  return tipo === "pj" ? "CNPJ" : "CPF";
}

// ────────────────────────────────────────────────────────────────────────────
// Sanitização para WinAnsi (fontes Times/Helvetica do pdf-lib)
// ────────────────────────────────────────────────────────────────────────────
// Regexes construídos via RegExp() — usar literal /.../ com caracteres como
// U+2028 (line separator) quebra o lexer JS.

const RE_NBSP        = new RegExp("\\u00A0", "g");
const RE_ZERO_WIDTH  = new RegExp("[\\u200B-\\u200F\\u202A-\\u202E\\uFEFF]", "g");
const RE_LINE_SEP    = new RegExp("[\\u2028\\u2029]", "g");
const RE_ARROW       = new RegExp("\\u2192", "g");
const RE_SOFT_HYPHEN = new RegExp("\\u00AD", "g");
// Controle exceto \n (U+000A) e \t (U+0009).
const RE_CONTROL     = new RegExp("[\\u0000-\\u0008\\u000B-\\u001F\\u007F]", "g");

export function sanitizeWinAnsi(input: string): string {
  if (!input) return "";
  return input
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(RE_NBSP, " ")
    .replace(RE_ZERO_WIDTH, "")
    .replace(RE_LINE_SEP, "\n")
    .replace(RE_ARROW, "->")
    .replace(RE_SOFT_HYPHEN, "")
    .replace(RE_CONTROL, "");
}
