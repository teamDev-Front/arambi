// Carrega o perfil de acesso de um usuário a partir de qualquer client
// Supabase (proxy, server components, route handlers).
//
// Funciona em degraus, conforme as migrations aplicadas: 0059 (senha
// provisória) → 0058 (módulos e níveis) → modelo antigo (admin = tudo;
// editor = todos os módulos em edição; viewer e socio = todos em leitura).
// Assim o deploy do código pode vir antes do SQL.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserRole } from "@/types";
import { MODULOS_CONCEDIVEIS } from "@/lib/acessos/modulos";
import {
  normalizarPermissoes, type AcessoUsuario, type MapaPermissoes, type NivelModulo,
} from "@/lib/acessos/permissoes";

type LinhaPerfil = {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  cargo?: string | null;
  setor?: string | null;
  ativo?: boolean | null;
  permissoes?: unknown;
  trocar_senha?: boolean | null;
};

const DEGRAUS: { colunas: string; legado: boolean }[] = [
  { colunas: "id, email, full_name, role, cargo, setor, ativo, permissoes, trocar_senha", legado: false },
  { colunas: "id, email, full_name, role, cargo, setor, ativo, permissoes", legado: false },
  { colunas: "id, email, full_name, role", legado: true },
];

/** Postgres 42703 (coluna inexistente) / PostgREST PGRST204. */
function faltaColuna(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === "42703" || err.code === "PGRST204" || /column .* does not exist/i.test(err.message ?? "");
}

function todosOsModulos(nivel: NivelModulo): MapaPermissoes {
  return Object.fromEntries(MODULOS_CONCEDIVEIS.map((m) => [m.key, nivel])) as MapaPermissoes;
}

export function paraAcesso(linha: LinhaPerfil, legado = false): AcessoUsuario {
  const permissoes = legado
    ? (linha.role === "admin" ? {} : todosOsModulos(linha.role === "editor" ? "edicao" : "leitura"))
    : normalizarPermissoes(linha.permissoes);
  return {
    id: linha.id,
    email: linha.email,
    nome: linha.full_name?.trim() || linha.email.split("@")[0],
    cargo: linha.cargo ?? null,
    setor: linha.setor ?? null,
    role: linha.role,
    ativo: legado ? true : linha.ativo === true,
    permissoes,
    trocarSenha: linha.trocar_senha === true,
  };
}

/**
 * Perfil do usuário `userId` (o RLS de users deixa cada um ler a própria linha).
 * null = sem perfil — tratado como sem acesso. Falha do banco LANÇA erro: quem
 * chama decide (o proxy deixa passar e a página barra; nunca desconecta por
 * instabilidade).
 */
export async function carregarAcesso(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
): Promise<AcessoUsuario | null> {
  for (const degrau of DEGRAUS) {
    const r = await supabase.from("users").select(degrau.colunas).eq("id", userId).maybeSingle();
    if (!r.error) return r.data ? paraAcesso(r.data as unknown as LinhaPerfil, degrau.legado) : null;
    if (!faltaColuna(r.error)) throw new Error(`Falha ao carregar o perfil de acesso: ${r.error.message}`);
  }
  return null;
}
