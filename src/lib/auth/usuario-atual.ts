// Nome do usuário logado, para o rodapé "Emitido por:" dos relatórios (RF 20-ago).
//
// Roda no client (as exportações de PDF/XLSX são client-side). Espelha a mesma
// regra do dashboard/layout.tsx: full_name da tabela `users` e, na falta dele,
// o começo do e-mail. O resultado fica em cache no módulo — o nome não muda
// dentro de uma sessão e não vale uma ida ao banco por relatório.

"use client";

import { createClient } from "@/lib/supabase/client";

let cache: string | null = null;

/** Nome exibível do usuário logado ("Usuário" quando não dá para descobrir). */
export async function getNomeUsuarioAtual(): Promise<string> {
  if (cache) return cache;
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return "Usuário";
    let nome = user.email?.split("@")[0] ?? "Usuário";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: profile } = await (supabase as any)
      .from("users")
      .select("full_name")
      .eq("id", user.id)
      .single() as { data: { full_name?: string | null } | null };
    if (profile?.full_name) nome = profile.full_name;
    cache = nome;
    return nome;
  } catch {
    return "Usuário";
  }
}

/**
 * Linha pronta do rodapé: "Emitido por: Fulano  |  20/08/2026 às 13:20".
 * O `quando` entra como parâmetro para PDF e XLSX do mesmo clique saírem com
 * o mesmo horário.
 */
export function linhaEmissao(nome: string, quando: Date = new Date()): string {
  const data = new Intl.DateTimeFormat("pt-BR").format(quando);
  const hora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(quando);
  return `Emitido por: ${nome}  |  ${data} às ${hora}`;
}
