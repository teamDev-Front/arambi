// Carregamento do timbre (logomarca da Aramburu) para a marca d'água dos PDFs.
// Server-only: lê o arquivo de public/ uma vez e mantém em cache de módulo.
// Fallback gracioso: se o arquivo não existir, devolve null (o PDF é gerado sem timbre).

import { readFile } from "node:fs/promises";
import path from "node:path";

const LOGO_PATH = "logomarga-timbre-aramburu-agropecuaria.jpg";

let cache: Uint8Array | null | undefined;

/** Bytes JPEG do timbre, ou null se indisponível. Resultado é memoizado. */
export async function loadTimbreLogo(): Promise<Uint8Array | null> {
  if (cache !== undefined) return cache;
  try {
    const full = path.join(process.cwd(), "public", LOGO_PATH);
    const buf = await readFile(full);
    cache = new Uint8Array(buf);
  } catch {
    cache = null;
  }
  return cache;
}
