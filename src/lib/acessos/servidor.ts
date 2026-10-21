// Guardas de acesso no SERVIDOR (server components e route handlers).
// NÃO importar em client components (usa next/headers via supabase/server).
//
// Camadas: o proxy barra a URL; as páginas chamam exigirModulo() (o layout
// não re-renderiza na navegação, então a checagem fica na página); as APIs
// chamam autorizarApi(); o RLS da 0058 segura o banco.

import { cache } from "react";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { carregarAcesso } from "@/lib/acessos/carregar";
import type { ModuloKey } from "@/lib/acessos/modulos";
import {
  ehSuperAdmin, podeEditar, podeVer, rotaInicial,
  type AcessoUsuario, type NivelModulo,
} from "@/lib/acessos/permissoes";
import type { LogTipo, Json } from "@/types";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export interface SessaoAcesso {
  user: User;
  acesso: AcessoUsuario | null;
  supabase: ServerClient;
}

/** Usuário logado + perfil de acesso (uma consulta por requisição). */
export const obterSessaoAcesso = cache(async (): Promise<SessaoAcesso | null> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const acesso = await carregarAcesso(supabase, user.id);
  return { user, acesso, supabase };
});

// ---------------------------------------------------------------------------
// Páginas
// ---------------------------------------------------------------------------

async function exigirSessaoAtiva(): Promise<AcessoUsuario> {
  const s = await obterSessaoAcesso();
  if (!s) redirect("/login");
  if (!s.acesso || !s.acesso.ativo) redirect("/auth/sair?motivo=bloqueado");
  return s.acesso;
}

/** Topo de cada page.tsx de módulo: sem permissão de ver → "Sem acesso". */
export async function exigirModulo(modulo: ModuloKey): Promise<AcessoUsuario> {
  const acesso = await exigirSessaoAtiva();
  if (!podeVer(acesso, modulo)) {
    redirect(modulo === "home" ? rotaInicial(acesso) : `/dashboard/sem-acesso?modulo=${modulo}`);
  }
  return acesso;
}

/** Páginas exclusivas (Acessos, Configurações). */
export async function exigirSuperAdmin(modulo: ModuloKey): Promise<AcessoUsuario> {
  const acesso = await exigirSessaoAtiva();
  if (!ehSuperAdmin(acesso)) redirect(`/dashboard/sem-acesso?modulo=${modulo}`);
  return acesso;
}

/** Páginas livres para qualquer usuário ativo (Meu Perfil, Sem acesso). */
export async function exigirUsuarioAtivo(): Promise<AcessoUsuario> {
  return exigirSessaoAtiva();
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

export type AutorizacaoApi =
  | { ok: true; user: User; acesso: AcessoUsuario; supabase: ServerClient }
  | { ok: false; resposta: NextResponse };

interface RegraApi {
  /** Basta UM destes módulos no nível pedido. */
  modulos?: ModuloKey[];
  /** Default "leitura" (ver/exportar). */
  nivel?: NivelModulo;
  superAdmin?: boolean;
}

function negar(status: number, error: string): AutorizacaoApi {
  return { ok: false, resposta: NextResponse.json({ error }, { status }) };
}

export async function autorizarApi(regra: RegraApi = {}): Promise<AutorizacaoApi> {
  const s = await obterSessaoAcesso();
  if (!s) return negar(401, "Não autenticado.");
  const { user, acesso, supabase } = s;
  if (!acesso || !acesso.ativo) return negar(403, "Acesso bloqueado. Fale com o administrador.");
  if (regra.superAdmin && !ehSuperAdmin(acesso)) return negar(403, "Apenas o Super Admin pode fazer isso.");
  if (regra.modulos?.length) {
    const nivel = regra.nivel ?? "leitura";
    const permitido = regra.modulos.some((m) => (nivel === "edicao" ? podeEditar(acesso, m) : podeVer(acesso, m)));
    if (!permitido) {
      return negar(403, nivel === "edicao"
        ? "Seu acesso a este módulo é somente leitura."
        : "Você não tem acesso a este módulo.");
    }
  }
  return { ok: true, user, acesso, supabase };
}

// ---------------------------------------------------------------------------
// Auditoria (tabela logs) — gravada pelo servidor, não falha a operação.
// ---------------------------------------------------------------------------

export async function registrarLog(p: {
  tipo: LogTipo;
  acao: string;
  descricao: string;
  usuario?: Pick<AcessoUsuario, "id" | "nome"> | null;
  metadados?: Record<string, unknown>;
  req?: Request;
}): Promise<void> {
  try {
    const ipBruto = p.req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || p.req?.headers.get("x-real-ip")
      || null;
    const ip = ipBruto && /^[0-9a-f.:]+$/i.test(ipBruto) ? ipBruto : null;
    const admin = createAdminClient();
    const { error } = await admin.from("logs").insert({
      tipo: p.tipo,
      acao: p.acao,
      descricao: p.descricao,
      usuario_id: p.usuario?.id ?? null,
      usuario_nome: p.usuario?.nome ?? null,
      metadados: (p.metadados ?? null) as Json,
      ip,
      user_agent: p.req?.headers.get("user-agent")?.slice(0, 300) ?? null,
    });
    if (error) console.warn("[logs] falha ao registrar:", error.message);
  } catch (e) {
    console.warn("[logs] falha ao registrar:", (e as Error).message);
  }
}
