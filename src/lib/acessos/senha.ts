// Regras de senha e gerador de senha provisória — usados na tela (navegador)
// e conferidos de novo nas APIs.

export const REGRAS_SENHA: readonly { id: string; label: string; ok: (s: string) => boolean }[] = [
  { id: "tamanho", label: "Pelo menos 8 caracteres", ok: (s) => s.length >= 8 },
  { id: "letra", label: "Uma letra", ok: (s) => /[a-zA-Z]/.test(s) },
  { id: "numero", label: "Um número", ok: (s) => /\d/.test(s) },
];

/** 72 = limite do bcrypt usado pelo Supabase Auth. */
export function senhaValida(s: string): boolean {
  return s.length <= 72 && REGRAS_SENHA.every((r) => r.ok(s));
}

// Sem 0/O, 1/l/I: a senha é ditada ou digitada a partir do WhatsApp.
const LETRAS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const NUMEROS = "23456789";

function sortear(alfabeto: string, n: number): string[] {
  const a = new Uint32Array(n);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, (v) => alfabeto[v % alfabeto.length]);
}

/** Ex.: "Kp7m-Qx4r-W9tz" — 3 blocos de 4, sempre com letras e números. */
export function gerarSenhaProvisoria(): string {
  const chars = [...sortear(LETRAS, 8), ...sortear(NUMEROS, 4)];
  // Embaralha (Fisher–Yates) para os números não ficarem sempre no fim.
  const idx = new Uint32Array(chars.length);
  globalThis.crypto.getRandomValues(idx);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = idx[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  const s = chars.join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}
