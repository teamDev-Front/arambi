// Gestão de usuários pelo servidor (service role) — usado só pelas rotas
// /api/acessos/* e /api/auth/*. NÃO importar em client components.
//
// Convites: o Supabase cria o usuário em auth.users; o gatilho da 0058 cria o
// perfil INATIVO e esta camada grava nível/módulos e ativa. Links de convite
// copiados apontam para /definir-senha?token_hash=… (o token só é consumido no
// clique, então o preview do WhatsApp não queima o link).

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserRow } from "@/types";
import { normalizarPermissoes, nivelGeral } from "@/lib/acessos/permissoes";
import type { StatusAcesso, UsuarioAcesso } from "@/lib/acessos/tipos";

export type AdminClient = ReturnType<typeof createAdminClient>;
export type TipoLink = "invite" | "recovery";

export const COLUNAS_PERFIL =
  "id, email, full_name, cargo, setor, role, ativo, permissoes, senha_definida_em, convidado_por, convidado_em, bloqueado_em, bloqueado_por, created_at";

export type PerfilRow = Pick<UserRow,
  | "id" | "email" | "full_name" | "cargo" | "setor" | "role" | "ativo" | "permissoes"
  | "senha_definida_em" | "convidado_por" | "convidado_em" | "bloqueado_em" | "bloqueado_por" | "created_at">;

export const MSG_MIGRATION_PENDENTE =
  "A migration 0058 (Acessos) ainda não foi aplicada no banco. Aplique supabase/migrations/0058_acessos.sql no SQL Editor do Supabase.";

/** Postgres 42703 / PostgREST PGRST204 — coluna da 0058 inexistente. */
export function ehMigrationPendente(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === "42703" || err.code === "PGRST204" || /column .* does not exist/i.test(err.message ?? "");
}

export function urlDefinirSenha(origin: string): string {
  return `${origin}/definir-senha`;
}

export function statusDe(p: Pick<PerfilRow, "ativo" | "senha_definida_em" | "bloqueado_em">): StatusAcesso {
  if (!p.ativo) return p.bloqueado_em ? "bloqueado" : "sem_liberacao";
  return p.senha_definida_em ? "ativo" : "convite_pendente";
}

export function montarUsuario(
  p: PerfilRow,
  auth: Pick<User, "last_sign_in_at" | "email_confirmed_at"> | null,
  nomes: Map<string, string>,
): UsuarioAcesso {
  const permissoes = p.role === "admin" ? {} : normalizarPermissoes(p.permissoes);
  return {
    id: p.id,
    email: p.email,
    nome: p.full_name?.trim() || p.email.split("@")[0],
    cargo: p.cargo,
    setor: p.setor,
    role: p.role,
    superAdmin: p.role === "admin",
    nivel: nivelGeral({ role: p.role, permissoes }),
    permissoes,
    status: statusDe(p),
    emailConfirmado: !!auth?.email_confirmed_at,
    ultimoAcesso: auth?.last_sign_in_at ?? null,
    senhaDefinidaEm: p.senha_definida_em,
    convidadoEm: p.convidado_em,
    convidadoPorNome: p.convidado_por ? nomes.get(p.convidado_por) ?? null : null,
    bloqueadoEm: p.bloqueado_em,
    bloqueadoPorNome: p.bloqueado_por ? nomes.get(p.bloqueado_por) ?? null : null,
    criadoEm: p.created_at,
  };
}

/** Todos os usuários de auth.users, por id (lista paginada da Admin API). */
export async function mapaAuth(admin: AdminClient): Promise<Map<string, User>> {
  const mapa = new Map<string, User>();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Falha ao listar usuários do Auth: ${error.message}`);
    for (const u of data.users) mapa.set(u.id, u);
    if (data.users.length < 200) break;
  }
  return mapa;
}

/** Um usuário já montado (para devolver depois de criar/alterar). */
export async function carregarUsuario(admin: AdminClient, id: string): Promise<UsuarioAcesso | null> {
  const { data: p, error } = await admin.from("users").select(COLUNAS_PERFIL).eq("id", id).maybeSingle();
  if (error || !p) return null;
  const perfil = p as PerfilRow;
  const { data: authData } = await admin.auth.admin.getUserById(id);
  const ids = [perfil.convidado_por, perfil.bloqueado_por].filter((x): x is string => !!x);
  const nomes = new Map<string, string>();
  if (ids.length) {
    const { data: outros } = await admin.from("users").select("id, full_name, email").in("id", ids);
    for (const o of outros ?? []) nomes.set(o.id, o.full_name?.trim() || o.email);
  }
  return montarUsuario(perfil, authData?.user ?? null, nomes);
}

// ---------------------------------------------------------------------------
// E-mails e links
// ---------------------------------------------------------------------------

type ErroAuth = { message?: string; status?: number; code?: string };

/** Falha de ENVIO (SMTP, limite) — o convite pode seguir por link. */
export function ehFalhaDeEnvio(err: ErroAuth | null): boolean {
  if (!err) return false;
  const m = (err.message ?? "").toLowerCase();
  return err.status === 429 || err.status === 500
    || err.code === "over_email_send_rate_limit" || err.code === "email_address_not_authorized"
    || m.includes("rate limit") || m.includes("sending") || m.includes("smtp") || m.includes("not authorized");
}

export function traduzirErroEmail(err: ErroAuth | null): string {
  const m = (err?.message ?? "").toLowerCase();
  if (err?.status === 429 || err?.code === "over_email_send_rate_limit" || m.includes("rate limit")) {
    return "O Supabase atingiu o limite de envio de e-mails por hora. Tente mais tarde ou envie o link de convite pelo WhatsApp.";
  }
  return "O Supabase não conseguiu enviar o e-mail. O serviço de e-mail padrão só entrega para membros da equipe do projeto — configure um SMTP próprio no painel. Enquanto isso, envie o link de convite pelo WhatsApp.";
}

/**
 * Gera o link sem enviar e-mail. Invalida o link anterior do mesmo tipo.
 * invite = ainda não abriu o convite; recovery = já confirmou o e-mail.
 */
export async function gerarLink(
  admin: AdminClient,
  origin: string,
  email: string,
  tipo: TipoLink,
  nome?: string,
): Promise<{ ok: true; link: string; user: User } | { ok: false; erro: string }> {
  const { data, error } = tipo === "invite"
    ? await admin.auth.admin.generateLink({
        type: "invite", email,
        options: { redirectTo: urlDefinirSenha(origin), data: nome ? { full_name: nome } : undefined },
      })
    : await admin.auth.admin.generateLink({
        type: "recovery", email,
        options: { redirectTo: urlDefinirSenha(origin) },
      });
  if (error || !data?.properties?.hashed_token) {
    return { ok: false, erro: error?.message ?? "Falha ao gerar o link." };
  }
  const link = `${urlDefinirSenha(origin)}?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=${tipo}`;
  return { ok: true, link, user: data.user };
}

/** Convite por e-mail (template "Invite user" do Supabase). */
export async function enviarConvite(
  admin: AdminClient,
  origin: string,
  email: string,
  nome: string,
): Promise<{ ok: true; user: User } | { ok: false; erro: ErroAuth }> {
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: urlDefinirSenha(origin),
    data: { full_name: nome },
  });
  if (error || !data?.user) return { ok: false, erro: error ?? { message: "Falha no convite." } };
  return { ok: true, user: data.user };
}

/**
 * E-mail "redefinir senha" (template "Reset password") pelo fluxo implícito:
 * o link funciona em qualquer navegador/aparelho, não só no que pediu.
 */
export async function enviarRedefinicao(
  origin: string,
  email: string,
): Promise<{ ok: true } | { ok: false; erro: ErroAuth }> {
  const sb = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: urlDefinirSenha(origin) });
  return error ? { ok: false, erro: error } : { ok: true };
}

/** Bloqueio também no Supabase Auth (não renova sessão nem entra com senha). */
export async function banirNoAuth(admin: AdminClient, id: string, banir: boolean): Promise<string | null> {
  const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: banir ? "876000h" : "none" });
  return error ? error.message : null;
}
