// POST /api/acessos/[id]/acoes  { acao }
//   bloquear          → perfil inativo (corte imediato no RLS) + ban no Auth
//   desbloquear       → reativa (também "libera" perfil sem liberação)
//   reenviar_convite  → novo e-mail para quem ainda não criou a senha
//   gerar_link        → link para WhatsApp (invalida o link anterior)
//   redefinir_senha   → e-mail de redefinição para quem já tem senha
// Só Super Admin; ninguém bloqueia a si mesmo.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { autorizarApi, registrarLog } from "@/lib/acessos/servidor";
import {
  banirNoAuth, carregarUsuario, ehFalhaDeEnvio, ehMigrationPendente, enviarConvite, enviarRedefinicao,
  gerarLink, MSG_MIGRATION_PENDENTE, statusDe, traduzirErroEmail,
} from "@/lib/acessos/gestao";
import type { ResultadoConvite } from "@/lib/acessos/tipos";

export const dynamic = "force-dynamic";

const schema = z.object({
  acao: z.enum(["bloquear", "desbloquear", "reenviar_convite", "gerar_link", "redefinir_senha"]),
});

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
    .select("id, email, full_name, ativo, senha_definida_em, bloqueado_em")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: ehMigrationPendente(error) ? MSG_MIGRATION_PENDENTE : error.message }, { status: 500 });
  }
  if (!alvo) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });

  const nome = alvo.full_name?.trim() || alvo.email;
  const origin = req.nextUrl.origin;
  const log = (acaoLog: string, descricao: string, extra?: Record<string, unknown>) =>
    registrarLog({
      tipo: "auth", acao: acaoLog, descricao, usuario: auth.acesso, req,
      metadados: { alvo_id: id, alvo_email: alvo.email, ...extra },
    });

  // ---- Bloquear / desbloquear -------------------------------------------
  if (acao === "bloquear" || acao === "desbloquear") {
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
    const liberacao = !bloquear && !alvo.bloqueado_em;   // perfil que nunca foi liberado
    await log(
      bloquear ? "ACESSO_BLOQUEADO" : liberacao ? "ACESSO_LIBERADO" : "ACESSO_DESBLOQUEADO",
      `${bloquear ? "Bloqueou" : liberacao ? "Liberou" : "Desbloqueou"} o acesso de ${nome} (${alvo.email})`,
      avisoAuth ? { aviso_auth: avisoAuth } : undefined,
    );
    return NextResponse.json({ usuario: await carregarUsuario(admin, id), aviso: avisoAuth ?? undefined });
  }

  // ---- Convites e senha ---------------------------------------------------
  if (!alvo.ativo) {
    return NextResponse.json({ error: "Desbloqueie o acesso antes de enviar convite ou senha." }, { status: 409 });
  }
  const { data: authData, error: errAuth } = await admin.auth.admin.getUserById(id);
  if (errAuth || !authData?.user) {
    return NextResponse.json({ error: `Usuário não encontrado no Auth: ${errAuth?.message ?? ""}` }, { status: 404 });
  }
  // Convite já aberto (e-mail confirmado) não aceita novo "invite": vai como recuperação.
  const tipoLink = authData.user.email_confirmed_at ? "recovery" : "invite";
  const pendente = statusDe({ ativo: alvo.ativo, senha_definida_em: alvo.senha_definida_em, bloqueado_em: alvo.bloqueado_em }) === "convite_pendente";

  if (acao === "gerar_link") {
    const gl = await gerarLink(admin, origin, alvo.email, tipoLink, nome);
    if (!gl.ok) return NextResponse.json({ error: `Falha ao gerar o link: ${gl.erro}` }, { status: 500 });
    await log("LINK_GERADO", `Gerou link de ${pendente ? "convite" : "redefinição de senha"} para ${nome} (${alvo.email})`);
    const corpo: ResultadoConvite = { emailEnviado: false, link: gl.link };
    return NextResponse.json(corpo);
  }

  if (acao === "reenviar_convite" && !pendente) {
    return NextResponse.json({ error: "Este usuário já criou a senha. Use \"Enviar redefinição de senha\"." }, { status: 409 });
  }

  const envio = tipoLink === "invite"
    ? await enviarConvite(admin, origin, alvo.email, nome)
    : await enviarRedefinicao(origin, alvo.email);
  if (!envio.ok) {
    if (!ehFalhaDeEnvio(envio.erro)) {
      return NextResponse.json({ error: `Falha ao enviar: ${envio.erro.message}` }, { status: 500 });
    }
    // E-mail não saiu: já devolve um link para mandar por outro canal.
    const gl = await gerarLink(admin, origin, alvo.email, tipoLink, nome);
    const corpo: ResultadoConvite = {
      emailEnviado: false,
      avisoEmail: traduzirErroEmail(envio.erro),
      link: gl.ok ? gl.link : undefined,
    };
    await log("EMAIL_FALHOU", `E-mail para ${nome} (${alvo.email}) não foi enviado; link gerado`, { motivo: envio.erro.message });
    return NextResponse.json(corpo);
  }

  await log(
    acao === "reenviar_convite" ? "CONVITE_REENVIADO" : "SENHA_REDEFINICAO_ENVIADA",
    `${acao === "reenviar_convite" ? "Reenviou o convite" : "Enviou redefinição de senha"} para ${nome} (${alvo.email})`,
  );
  const corpo: ResultadoConvite = { emailEnviado: true };
  return NextResponse.json(corpo);
}
