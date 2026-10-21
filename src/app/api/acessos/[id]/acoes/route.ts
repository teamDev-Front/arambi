// POST /api/acessos/[id]/acoes  { acao }
//   bloquear          → perfil inativo (corte imediato no RLS) + ban no Auth
//   desbloquear       → reativa (também "libera" perfil sem liberação)
//   senha_provisoria  → nova senha provisória (sem e-mail); a pessoa troca no próximo acesso
// Só Super Admin; ninguém bloqueia nem reseta a si mesmo.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { autorizarApi, registrarLog } from "@/lib/acessos/servidor";
import {
  banirNoAuth, cancelarPedidosPendentes, carregarUsuario, definirSenhaPeloAdmin, ehMigrationPendente,
  MSG_MIGRATION_PENDENTE,
} from "@/lib/acessos/gestao";
import { gerarSenhaProvisoria } from "@/lib/acessos/senha";
import type { ResultadoAcesso } from "@/lib/acessos/tipos";

export const dynamic = "force-dynamic";

const schema = z.object({ acao: z.enum(["bloquear", "desbloquear", "senha_provisoria"]) });

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await autorizarApi({ superAdmin: true });
  if (!auth.ok) return auth.resposta;
  const { id } = await ctx.params;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  const { acao } = parsed.data;

  const admin = createAdminClient();
  const { data: alvo, error } = await admin
    .from("users")
    .select("id, email, full_name, ativo, bloqueado_em")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: ehMigrationPendente(error) ? MSG_MIGRATION_PENDENTE : error.message }, { status: 500 });
  }
  if (!alvo) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });

  const nome = alvo.full_name?.trim() || alvo.email;
  const log = (acaoLog: string, descricao: string, extra?: Record<string, unknown>) =>
    registrarLog({
      tipo: "auth", acao: acaoLog, descricao, usuario: auth.acesso, req,
      metadados: { alvo_id: id, alvo_email: alvo.email, ...extra },
    });

  // ---- Senha provisória ----------------------------------------------------
  if (acao === "senha_provisoria") {
    if (id === auth.user.id) {
      return NextResponse.json({ error: "Para trocar a sua própria senha, use Meu Perfil." }, { status: 400 });
    }
    if (!alvo.ativo) {
      return NextResponse.json({ error: "Desbloqueie o acesso antes de gerar uma senha." }, { status: 409 });
    }
    const senha = gerarSenhaProvisoria();
    const erroSenha = await definirSenhaPeloAdmin(admin, id, senha);
    if (erroSenha) return NextResponse.json({ error: erroSenha }, { status: 400 });
    const { error: errFlag } = await admin.from("users").update({ trocar_senha: true }).eq("id", id);
    if (errFlag) {
      return NextResponse.json({ error: ehMigrationPendente(errFlag) ? MSG_MIGRATION_PENDENTE : errFlag.message }, { status: 500 });
    }
    // Pedido que estivesse esperando perde o sentido.
    await cancelarPedidosPendentes(admin, id);
    await log("SENHA_PROVISORIA_GERADA", `Gerou nova senha provisória para ${nome} (${alvo.email})`);
    const corpo: ResultadoAcesso = { usuario: await carregarUsuario(admin, id), credenciais: { email: alvo.email, senha } };
    return NextResponse.json(corpo);
  }

  // ---- Bloquear / desbloquear ----------------------------------------------
  const bloquear = acao === "bloquear";
  if (bloquear && id === auth.user.id) {
    return NextResponse.json({ error: "Você não pode bloquear o seu próprio acesso." }, { status: 400 });
  }
  const { error: errUpd } = await admin.from("users").update(
    bloquear
      ? { ativo: false, bloqueado_em: new Date().toISOString(), bloqueado_por: auth.user.id }
      : { ativo: true, bloqueado_em: null, bloqueado_por: null },
  ).eq("id", id);
  if (errUpd) {
    const ultimoAdmin = /Super Admin/i.test(errUpd.message);
    return NextResponse.json(
      { error: ultimoAdmin ? "Não dá para bloquear: o sistema ficaria sem nenhum Super Admin ativo." : errUpd.message },
      { status: ultimoAdmin ? 409 : 500 },
    );
  }
  const avisoAuth = await banirNoAuth(admin, id, bloquear);
  if (bloquear) await cancelarPedidosPendentes(admin, id);
  const liberacao = !bloquear && !alvo.bloqueado_em;   // perfil que nunca foi liberado
  await log(
    bloquear ? "ACESSO_BLOQUEADO" : liberacao ? "ACESSO_LIBERADO" : "ACESSO_DESBLOQUEADO",
    `${bloquear ? "Bloqueou" : liberacao ? "Liberou" : "Desbloqueou"} o acesso de ${nome} (${alvo.email})`,
    avisoAuth ? { aviso_auth: avisoAuth } : undefined,
  );
  const corpo: ResultadoAcesso = { usuario: await carregarUsuario(admin, id), aviso: avisoAuth ?? undefined };
  return NextResponse.json(corpo);
}
