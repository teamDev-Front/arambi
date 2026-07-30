// Parser do "markdown-lite" das Observações do Termo (ajuste 29-jul):
//   **texto**          → negrito
//   "- item" / "• item" → lista com marcador
//   "1. item" / "1) item" → lista numerada (o número digitado é respeitado)
// Cada linha vira uma linha do PDF; linhas em branco viram espaçamento.

import type { Segment } from "./builder";

export interface ObsLinha {
  /** Marcador desenhado antes do texto ("•  ", "1.  ") — "" em linha comum. */
  prefixo: string;
  /** Vazio = linha em branco (espaçamento). */
  segments: Segment[];
}

function parseNegrito(texto: string): Segment[] {
  const segs: Segment[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    if (m.index > last) segs.push({ text: texto.slice(last, m.index) });
    segs.push({ text: m[1], bold: true });
    last = re.lastIndex;
  }
  if (last < texto.length) segs.push({ text: texto.slice(last) });
  return segs.length > 0 ? segs : [{ text: texto }];
}

export function parseObservacoes(md: string): ObsLinha[] {
  const out: ObsLinha[] = [];
  for (const raw of md.replace(/\r\n/g, "\n").split("\n")) {
    const linha = raw.trim();
    if (!linha) { out.push({ prefixo: "", segments: [] }); continue; }
    const bullet = /^[-•*]\s+/.exec(linha);
    const numero = /^(\d{1,3})[.)]\s+/.exec(linha);
    if (bullet) {
      out.push({ prefixo: "•  ", segments: parseNegrito(linha.slice(bullet[0].length)) });
    } else if (numero) {
      out.push({ prefixo: `${numero[1]}.  `, segments: parseNegrito(linha.slice(numero[0].length)) });
    } else {
      out.push({ prefixo: "", segments: parseNegrito(linha) });
    }
  }
  // remove linhas em branco no início/fim
  while (out.length && out[0].segments.length === 0) out.shift();
  while (out.length && out[out.length - 1].segments.length === 0) out.pop();
  return out;
}
