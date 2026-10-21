// Carrega o perfil de acesso de um usuário a partir de qualquer client
// Supabase (proxy, server components, route handlers).
//
// Funciona com OU sem a migration 0058 aplicada: sem as colunas novas, cai no
// modelo antigo (admin = tudo; editor = todos os módulos em edição; viewer e
// socio = todos em leitura) — o deploy do código pode vir antes do SQL.

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
};

const COLUNAS_0058 = "id, email, full_name, role, cargo, setor, ativo, permissoes";
const COLUNAS_LEGADO = "id, email, full_name, role";

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
  const r = await supabase.from("users").select(COLUNAS_0058).eq("id", userId).maybeSingle();
  if (!r.error) return r.data ? paraAcesso(r.data as LinhaPerfil) : null;
  if (!faltaColuna(r.error)) throw new Error(`Falha ao carregar o perfil de acesso: ${r.error.message}`);
  const legado = await supabase.from("users").select(COLUNAS_LEGADO).eq("id", userId).maybeSingle();
  if (legado.error) throw new Error(`Falha ao carregar o perfil de acesso: ${legado.error.message}`);
  return legado.data ? paraAcesso(legado.data as LinhaPerfil, true) : null;
}
