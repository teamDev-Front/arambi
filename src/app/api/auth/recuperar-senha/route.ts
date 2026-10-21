// POST /api/auth/recuperar-senha  { email }
// "Esqueceu sua senha?" do login. Resposta sempre genérica (202): não revela
// quem tem acesso. Só envia para perfil existente e ativo; o link usa o fluxo
// implícito e abre em qualquer aparelho (o PKCE só funcionaria no mesmo
// navegador que pediu).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { registrarLog } from "@/lib/acessos/servidor";
import { enviarRedefinicao } from "@/lib/acessos/gestao";

export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().trim().toLowerCase().email() });

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Informe um e-mail válido." }, { status: 400 });
  const { email } = parsed.data;

  const admin = createAdminClient();
  const { data: perfil } = await admin
    .from("users").select("id, full_name, ativo").eq("email", email).maybeSingle();

  if (perfil?.ativo) {
    const envio = await enviarRedefinicao(req.nextUrl.origin, email);
    await registrarLog({
      tipo: "auth",
      acao: envio.ok ? "SENHA_RECUPERACAO_SOLICITADA" : "EMAIL_FALHOU",
      descricao: envio.ok
        ? `Pediu redefinição de senha pela tela de login (${email})`
        : `Redefinição de senha pedida no login não foi enviada (${email}): ${envio.erro.message}`,
      usuario: { id: perfil.id, nome: perfil.full_name?.trim() || email },
      req,
    });
  }
  return NextResponse.json({ ok: true }, { status: 202 });
}
