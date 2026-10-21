// Gestão de usuários pelo servidor (service role) — usado só pelas rotas
// /api/acessos/* e /api/auth/*. NÃO importar em client components.
//
// Sem e-mail (0059): o Super Admin cria o acesso com senha provisória e manda
// para a pessoa; no 1º acesso ela cria a própria senha. "Esqueceu a senha" vira
// pedido aprovado pelo Super Admin.

import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserRow } from "@/types";
import { normalizarPermissoes, nivelGeral } from "@/lib/acessos/permissoes";
import type { PedidoSenha, StatusAcesso, UsuarioAcesso } from "@/lib/acessos/tipos";

export type AdminClient = ReturnType<typeof createAdminClient>;

export const COLUNAS_PERFIL =
  "id, email, full_name, cargo, setor, role, ativo, permissoes, trocar_senha, senha_definida_em, convidado_por, convidado_em, bloqueado_em, bloqueado_por, created_at";

export type PerfilRow = Pick<UserRow,
  | "id" | "email" | "full_name" | "cargo" | "setor" | "role" | "ativo" | "permissoes" | "trocar_senha"
  | "senha_definida_em" | "convidado_por" | "convidado_em" | "bloqueado_em" | "bloqueado_por" | "created_at">;

export const MSG_MIGRATION_PENDENTE =
  "Falta aplicar no banco a migration 0059_acessos_sem_email.sql (e a 0058, se ainda não aplicada). Rode no SQL Editor do Supabase.";

/** Coluna/tabela das migrations 0058/0059 inexistente. */
export function ehMigrationPendente(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return ["42703", "42P01", "PGRST204", "PGRST205"].includes(err.code ?? "")
    || /(column|relation|table) .* (does not exist|not find)/i.test(err.message ?? "");
}

/** Pedido de nova senha vale por este prazo; depois expira. */
export const PRAZO_PEDIDO_DIAS = 7;

export function statusDe(p: Pick<PerfilRow, "ativo" | "trocar_senha" | "senha_definida_em" | "bloqueado_em">): StatusAcesso {
  if (!p.ativo) return p.bloqueado_em ? "bloqueado" : "sem_liberacao";
  if (p.trocar_senha) return p.senha_definida_em ? "senha_provisoria" : "primeiro_acesso";
  return "ativo";
}

export function montarUsuario(
  p: PerfilRow,
  auth: Pick<User, "last_sign_in_at"> | null,
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
// Senhas
// ---------------------------------------------------------------------------

export function traduzirErroSenha(err: { message?: string; code?: string } | null): string {
  const m = (err?.message ?? "").toLowerCase();
  if (err?.code === "same_password" || m.includes("different from the old")) {
    return "A nova senha precisa ser diferente da senha atual (ou da provisória).";
  }
  if (err?.code === "weak_password" || m.includes("weak") || m.includes("pwned") || m.includes("at least")) {
    return "O Supabase considerou a senha fraca. Escolha outra (mais longa, com letras e números).";
  }
  return err?.message ?? "Não foi possível definir a senha.";
}

/** Troca a senha pela Admin API (sem e-mail). */
export async function definirSenhaPeloAdmin(admin: AdminClient, id: string, senha: string): Promise<string | null> {
  const { error } = await admin.auth.admin.updateUserById(id, { password: senha });
  return error ? traduzirErroSenha(error) : null;
}

/** Bloqueio também no Supabase Auth (não renova sessão nem entra com senha). */
export async function banirNoAuth(admin: AdminClient, id: string, banir: boolean): Promise<string | null> {
  const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: banir ? "876000h" : "none" });
  return error ? error.message : null;
}

// ---------------------------------------------------------------------------
// Pedidos de nova senha
// ---------------------------------------------------------------------------

/** "Chrome · Windows" a partir do user agent (só para reconhecer o aparelho). */
export function descreverDispositivo(ua: string | null): string | null {
  if (!ua) return null;
  const nav = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  const so = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : null;
  return so ? `${nav} · ${so}` : nav;
}

/** Expira os pedidos vencidos e devolve os pendentes (mais antigos primeiro). */
export async function listarPedidosPendentes(admin: AdminClient): Promise<PedidoSenha[]> {
  const limite = new Date(Date.now() - PRAZO_PEDIDO_DIAS * 86_400_000).toISOString();
  await admin.from("solicitacoes_senha")
    .update({ status: "expirada", senha_cifrada: null, decidido_em: new Date().toISOString() })
    .eq("status", "pendente")
    .lt("criado_em", limite);

  const { data, error } = await admin
    .from("solicitacoes_senha")
    .select("id, user_id, criado_em, ip, user_agent")
    .eq("status", "pendente")
    .order("criado_em", { ascending: true });
  if (error) throw error;
  if (!data?.length) return [];

  const { data: perfis } = await admin.from("users").select("id, full_name, email").in("id", data.map((p) => p.user_id));
  const porId = new Map((perfis ?? []).map((u) => [u.id, u]));
  return data.map((p) => {
    const u = porId.get(p.user_id);
    return {
      id: p.id,
      usuarioId: p.user_id,
      nome: u?.full_name?.trim() || u?.email || "—",
      email: u?.email ?? "—",
      criadoEm: p.criado_em,
      ip: p.ip,
      dispositivo: descreverDispositivo(p.user_agent),
    };
  });
}

/** Cancela pendências da pessoa (novo pedido, senha provisória gerada, exclusão). */
export async function cancelarPedidosPendentes(admin: AdminClient, userId: string): Promise<void> {
  await admin.from("solicitacoes_senha")
    .update({ status: "cancelada", senha_cifrada: null, decidido_em: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("status", "pendente");
}

/** IP do pedido (cabeçalhos da Vercel) — só se for um IP válido para coluna inet. */
export function ipDaRequisicao(req: Request): string | null {
  const bruto = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip");
  return bruto && /^[0-9a-f.:]+$/i.test(bruto) ? bruto : null;
}
