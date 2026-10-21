// POST /api/auth/definir-senha  { senha }
// Primeiro acesso (ou depois de uma senha provisória): a pessoa logada troca
// a provisória pela própria senha. A troca vai pela sessão dela (o Supabase
// recusa repetir a senha atual) e só então o servidor tira a marca
// trocar_senha — que o próprio usuário não consegue alterar pelo banco.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { obterSessaoAcesso, registrarLog } from "@/lib/acessos/servidor";
import { ehMigrationPendente, MSG_MIGRATION_PENDENTE, traduzirErroSenha } from "@/lib/acessos/gestao";
import { senhaValida } from "@/lib/acessos/senha";

export const dynamic = "force-dynamic";

const schema = z.object({ senha: z.string() });

export async function POST(req: NextRequest) {
  const sessao = await obterSessaoAcesso();
  if (!sessao) return NextResponse.json({ error: "Sessão expirada. Entre de novo." }, { status: 401 });
  const { user, acesso, supabase } = sessao;
  if (!acesso?.ativo) return NextResponse.json({ error: "Acesso bloqueado. Fale com o administrador." }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !senhaValida(parsed.data.senha)) {
    return NextResponse.json({ error: "A senha precisa ter 8+ caracteres, com letras e números." }, { status: 400 });
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.senha });
  if (error) return NextResponse.json({ error: traduzirErroSenha(error) }, { status: 400 });

  const admin = createAdminClient();
  const { data: perfil } = await admin.from("users").select("senha_definida_em").eq("id", user.id).maybeSingle();
  const primeiroAcesso = !perfil?.senha_definida_em;
  const { error: errFlag } = await admin.from("users").update({
    trocar_senha: false,
    ...(primeiroAcesso ? { senha_definida_em: new Date().toISOString() } : {}),
  }).eq("id", user.id);
  if (errFlag) {
    return NextResponse.json({ error: ehMigrationPendente(errFlag) ? MSG_MIGRATION_PENDENTE : errFlag.message }, { status: 500 });
  }

  await registrarLog({
    tipo: "auth",
    acao: "SENHA_DEFINIDA",
    descricao: primeiroAcesso ? "Criou a própria senha no primeiro acesso" : "Trocou a senha provisória pela própria senha",
    usuario: acesso,
    req,
  });
  return NextResponse.json({ ok: true });
}
