// POST /api/acessos/pedidos/[id]  { decisao: "aprovar" | "recusar" }
// Pedido de nova senha feito na tela de login. Aprovar = a senha que a pessoa
// escolheu passa a valer na hora (Admin API, sem e-mail). Só Super Admin.
// A senha pedida fica cifrada até aqui e é apagada em qualquer desfecho.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { autorizarApi, registrarLog } from "@/lib/acessos/servidor";
import {
  PRAZO_PEDIDO_DIAS, carregarUsuario, definirSenhaPeloAdmin, ehMigrationPendente, MSG_MIGRATION_PENDENTE,
} from "@/lib/acessos/gestao";
import { decifrar } from "@/lib/acessos/cifra";
import type { SolicitacaoSenhaRow } from "@/types";

export const dynamic = "force-dynamic";

const schema = z.object({ decisao: z.enum(["aprovar", "recusar"]) });

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await autorizarApi({ superAdmin: true });
  if (!auth.ok) return auth.resposta;
  const { id } = await ctx.params;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Decisão inválida." }, { status: 400 });
  const { decisao } = parsed.data;

  const admin = createAdminClient();
  const { data: pedido, error } = await admin
    .from("solicitacoes_senha").select("*").eq("id", id).maybeSingle();
  if (error) {
    return NextResponse.json({ error: ehMigrationPendente(error) ? MSG_MIGRATION_PENDENTE : error.message }, { status: 500 });
  }
  if (!pedido) return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
  if (pedido.status !== "pendente") {
    return NextResponse.json({ error: "Este pedido já foi resolvido." }, { status: 409 });
  }

  const { data: alvo } = await admin
    .from("users").select("id, email, full_name, ativo, senha_definida_em").eq("id", pedido.user_id).maybeSingle();
  const nome = alvo?.full_name?.trim() || alvo?.email || "—";

  const fechar = (status: SolicitacaoSenhaRow["status"], motivo?: string) =>
    admin.from("solicitacoes_senha").update({
      status,
      senha_cifrada: null,
      decidido_em: new Date().toISOString(),
      decidido_por: auth.user.id,
      motivo: motivo ?? null,
    }).eq("id", id);

  const log = (acao: string, descricao: string) => registrarLog({
    tipo: "auth", acao, descricao, usuario: auth.acesso, req,
    metadados: { alvo_id: pedido.user_id, alvo_email: alvo?.email, pedido_id: id },
  });

  if (decisao === "recusar") {
    await fechar("recusada");
    await log("SENHA_PEDIDO_RECUSADO", `Recusou o pedido de nova senha de ${nome} (${alvo?.email ?? "—"})`);
    return NextResponse.json({ ok: true });
  }

  // ---- Aprovar ----------------------------------------------------------------
  if (!alvo) {
    await fechar("cancelada", "usuário não existe mais");
    return NextResponse.json({ error: "O usuário deste pedido não existe mais." }, { status: 410 });
  }
  if (!alvo.ativo) {
    return NextResponse.json({ error: "Este acesso está bloqueado. Desbloqueie antes de aprovar." }, { status: 409 });
  }
  if (Date.now() - new Date(pedido.criado_em).getTime() > PRAZO_PEDIDO_DIAS * 86_400_000) {
    await fechar("expirada");
    return NextResponse.json({ error: `Pedido expirado (mais de ${PRAZO_PEDIDO_DIAS} dias). Peça para a pessoa pedir de novo.` }, { status: 410 });
  }
  const senha = decifrar(pedido.senha_cifrada);
  if (!senha) {
    await fechar("expirada", "não foi possível ler a senha do pedido");
    return NextResponse.json({ error: "Não foi possível ler este pedido. Peça para a pessoa pedir de novo." }, { status: 410 });
  }

  const erroSenha = await definirSenhaPeloAdmin(admin, alvo.id, senha);
  if (erroSenha) {
    await fechar("recusada", erroSenha);
    return NextResponse.json({ error: `${erroSenha} O pedido foi encerrado — peça para a pessoa pedir outra senha.` }, { status: 422 });
  }

  // A senha agora é da própria pessoa: sai do modo "senha provisória".
  await admin.from("users").update({
    trocar_senha: false,
    ...(alvo.senha_definida_em ? {} : { senha_definida_em: new Date().toISOString() }),
  }).eq("id", alvo.id);
  await fechar("aprovada");
  await log("SENHA_PEDIDO_APROVADO", `Aprovou o pedido de nova senha de ${nome} (${alvo.email})`);

  return NextResponse.json({ ok: true, usuario: await carregarUsuario(admin, alvo.id) });
}
