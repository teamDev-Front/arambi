// POST /api/auth/solicitar-senha  { email, senha }
// "Esqueceu sua senha?" da tela de login, SEM e-mail: vira um pedido que o
// Super Admin aprova na tela Acessos. Resposta sempre genérica (202): não
// revela quem tem acesso. A senha pedida é guardada cifrada até a decisão.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { registrarLog } from "@/lib/acessos/servidor";
import { cancelarPedidosPendentes, ipDaRequisicao } from "@/lib/acessos/gestao";
import { cifrar } from "@/lib/acessos/cifra";
import { senhaValida } from "@/lib/acessos/senha";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  senha: z.string().refine(senhaValida),
});

/** Pedidos repetidos da mesma pessoa dentro deste intervalo são ignorados. */
const INTERVALO_MS = 60_000;

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Informe um e-mail válido e uma senha com 8+ caracteres, letras e números." }, { status: 400 });
  }
  const { email, senha } = parsed.data;

  const admin = createAdminClient();
  const { data: perfil } = await admin
    .from("users").select("id, full_name, ativo").eq("email", email).maybeSingle();

  if (perfil?.ativo) {
    const { data: ultimo } = await admin
      .from("solicitacoes_senha").select("criado_em")
      .eq("user_id", perfil.id).eq("status", "pendente").maybeSingle();
    const recente = ultimo && Date.now() - new Date(ultimo.criado_em).getTime() < INTERVALO_MS;
    if (!recente) {
      await cancelarPedidosPendentes(admin, perfil.id);
      const { error } = await admin.from("solicitacoes_senha").insert({
        user_id: perfil.id,
        senha_cifrada: cifrar(senha),
        ip: ipDaRequisicao(req),
        user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
      });
      if (error) {
        console.error("[solicitar-senha]", error.message);
      } else {
        await registrarLog({
          tipo: "auth",
          acao: "SENHA_PEDIDO",
          descricao: `Pediu nova senha pela tela de login (${email}) — aguardando aprovação`,
          usuario: { id: perfil.id, nome: perfil.full_name?.trim() || email },
          req,
        });
      }
    }
  }
  return NextResponse.json({ ok: true }, { status: 202 });
}
