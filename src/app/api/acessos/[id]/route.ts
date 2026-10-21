// PATCH  /api/acessos/[id] → altera dados, nível e módulos
// DELETE /api/acessos/[id] → cancela convite pendente (apaga o usuário)
// Só Super Admin. Ninguém rebaixa nem apaga a si mesmo; o banco (0058)
// recusa deixar o sistema sem Super Admin ativo.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { autorizarApi, registrarLog } from "@/lib/acessos/servidor";
import { carregarUsuario, ehMigrationPendente, MSG_MIGRATION_PENDENTE } from "@/lib/acessos/gestao";
import {
  NIVEL_GERAL_LABEL, nivelGeral, normalizarPermissoes, roleDasPermissoes, type MapaPermissoes,
} from "@/lib/acessos/permissoes";
import { MODULO_POR_KEY, type ModuloKey } from "@/lib/acessos/modulos";

export const dynamic = "force-dynamic";

const textoOpcional = z.string().trim().max(80).nullish().transform((v) => (v ? v : null));

const editarSchema = z.object({
  nome: z.string().trim().min(3, "Informe o nome completo.").max(120),
  cargo: textoOpcional,
  setor: textoOpcional,
  superAdmin: z.boolean(),
  permissoes: z.record(z.string(), z.enum(["leitura", "edicao"])).default({}),
});

type Ctx = { params: Promise<{ id: string }> };

function rotulo(k: string): string {
  return MODULO_POR_KEY[k as ModuloKey]?.label ?? k;
}

/** "Financeiro: leitura → edição; + Bancos (leitura); − Horta" */
function resumoMudancas(antes: MapaPermissoes, depois: MapaPermissoes): string[] {
  const nomeNivel = (n?: string) => (n === "edicao" ? "edição" : "leitura");
  const out: string[] = [];
  for (const [k, v] of Object.entries(depois)) {
    const a = antes[k as keyof MapaPermissoes];
    if (!a) out.push(`+ ${rotulo(k)} (${nomeNivel(v)})`);
    else if (a !== v) out.push(`${rotulo(k)}: ${nomeNivel(a)} → ${nomeNivel(v)}`);
  }
  for (const k of Object.keys(antes)) {
    if (!(k in depois)) out.push(`− ${rotulo(k)}`);
  }
  return out;
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await autorizarApi({ superAdmin: true });
  if (!auth.ok) return auth.resposta;
  const { id } = await ctx.params;

  const parsed = editarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  }
  const b = parsed.data;
  const permissoes = b.superAdmin ? {} : normalizarPermissoes(b.permissoes);
  if (!b.superAdmin && Object.keys(permissoes).length === 0) {
    return NextResponse.json({ error: "Libere ao menos um módulo (ou marque Super Admin)." }, { status: 400 });
  }
  if (id === auth.user.id && !b.superAdmin) {
    return NextResponse.json({ error: "Você não pode tirar o seu próprio acesso de Super Admin." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: atual, error: errAtual } = await admin
    .from("users").select("id, email, full_name, role, permissoes").eq("id", id).maybeSingle();
  if (errAtual) {
    return NextResponse.json({ error: ehMigrationPendente(errAtual) ? MSG_MIGRATION_PENDENTE : errAtual.message }, { status: 500 });
  }
  if (!atual) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });

  // Sócio (papel legado) continua sócio, salvo se virar Super Admin.
  const role = b.superAdmin ? "admin" : atual.role === "socio" ? "socio" : roleDasPermissoes(false, permissoes);
  const { error } = await admin.from("users").update({
    full_name: b.nome,
    cargo: b.cargo,
    setor: b.setor,
    role,
    permissoes,
  }).eq("id", id);
  if (error) {
    const ultimoAdmin = /Super Admin/i.test(error.message);
    return NextResponse.json(
      { error: ultimoAdmin ? "Não dá para rebaixar: o sistema ficaria sem nenhum Super Admin ativo." : error.message },
      { status: ultimoAdmin ? 409 : 500 },
    );
  }
  // Nome também nos metadados do Auth (templates de e-mail usam {{ .Data.full_name }}).
  await admin.auth.admin.updateUserById(id, { user_metadata: { full_name: b.nome } });

  const antesPerm = atual.role === "admin" ? {} : normalizarPermissoes(atual.permissoes);
  const nivelAntes = nivelGeral({ role: atual.role, permissoes: antesPerm });
  const nivelDepois = nivelGeral({ role, permissoes });
  const mudancas = resumoMudancas(antesPerm, permissoes);
  await registrarLog({
    tipo: "auth",
    acao: "ACESSO_ALTERADO",
    descricao: `Alterou o acesso de ${b.nome} (${atual.email})`
      + (nivelAntes !== nivelDepois ? ` — ${NIVEL_GERAL_LABEL[nivelAntes]} → ${NIVEL_GERAL_LABEL[nivelDepois]}` : ""),
    usuario: auth.acesso,
    metadados: { alvo_id: id, alvo_email: atual.email, nivel_antes: nivelAntes, nivel_depois: nivelDepois, mudancas },
    req,
  });

  const usuario = await carregarUsuario(admin, id);
  return NextResponse.json({ usuario });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await autorizarApi({ superAdmin: true });
  if (!auth.ok) return auth.resposta;
  const { id } = await ctx.params;
  if (id === auth.user.id) {
    return NextResponse.json({ error: "Você não pode apagar o seu próprio acesso." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: alvo, error } = await admin
    .from("users").select("id, email, full_name, senha_definida_em").eq("id", id).maybeSingle();
  if (error) {
    return NextResponse.json({ error: ehMigrationPendente(error) ? MSG_MIGRATION_PENDENTE : error.message }, { status: 500 });
  }
  if (!alvo) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
  // Só convite que ainda não virou conta; quem já usou o sistema é BLOQUEADO
  // (preserva o histórico de quem lançou o quê).
  if (alvo.senha_definida_em) {
    return NextResponse.json(
      { error: "Este usuário já ativou a conta. Use Bloquear para tirar o acesso (o histórico fica preservado)." },
      { status: 409 },
    );
  }

  const { error: errDel } = await admin.auth.admin.deleteUser(id);
  if (errDel) {
    const ultimoAdmin = /Super Admin/i.test(errDel.message);
    return NextResponse.json(
      { error: ultimoAdmin ? "O sistema ficaria sem nenhum Super Admin ativo." : `Falha ao cancelar o convite: ${errDel.message}` },
      { status: ultimoAdmin ? 409 : 500 },
    );
  }

  await registrarLog({
    tipo: "auth",
    acao: "CONVITE_CANCELADO",
    descricao: `Cancelou o convite de ${alvo.full_name ?? alvo.email} (${alvo.email})`,
    usuario: auth.acesso,
    metadados: { alvo_id: id, alvo_email: alvo.email },
    req,
  });
  return NextResponse.json({ ok: true });
}
