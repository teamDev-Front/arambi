// Cifra da senha pedida em "Esqueceu sua senha?" enquanto o pedido espera a
// aprovação do Super Admin (tabela solicitacoes_senha, migration 0059).
// SÓ SERVIDOR: a chave deriva da service role key, que nunca vai ao navegador.
// AES-256-GCM: sem a chave não dá para ler nem adulterar o pedido.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

function chave(): Buffer {
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurado.");
  return createHash("sha256").update(`arambi:pedido-de-senha:${base}`).digest();
}

/** "v1.<iv>.<tag>.<cifrado>" em base64. */
export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave(), iv);
  const cifrado = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), cifrado.toString("base64")].join(".");
}

/** null = formato desconhecido, adulterado ou chave trocada. */
export function decifrar(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const [versao, iv, tag, cifrado] = valor.split(".");
  if (versao !== "v1" || !iv || !tag || !cifrado) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", chave(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(cifrado, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
