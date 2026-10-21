// GET  /api/acessos  → usuários (status, módulos, último acesso) + pedidos de nova senha
// POST /api/acessos  → cria o acesso com SENHA PROVISÓRIA (sem e-mail)
// Só Super Admin. Escrita via service role (o RLS da 0058 não deixa o client
// alterar papel/módulos).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { autorizarApi, registrarLog } from "@/lib/acessos/servidor";
import {
  COLUNAS_PERFIL, MSG_MIGRATION_PENDENTE, carregarUsuario, ehMigrationPendente,
  listarPedidosPendentes, mapaAuth, montarUsuario, traduzirErroSenha, type PerfilRow,
} from "@/lib/acessos/gestao";
import { NIVEL_GERAL_LABEL, nivelGeral, normalizarPermissoes, roleDasPermissoes } from "@/lib/acessos/permissoes";
import { MODULO_POR_KEY, type ModuloKey } from "@/lib/acessos/modulos";
import { senhaValida } from "@/lib/acessos/senha";
import type { ListaAcessos, ResultadoAcesso } from "@/lib/acessos/tipos";

export const dynamic = "force-dynamic";

const textoOpcional = z.string().trim().max(80).nullish().transform((v) => (v ? v : null));

const criarSchema = z.object({
  nome: z.string().trim().min(3, "Informe o nome completo.").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido."),
  cargo: textoOpcional,
  setor: textoOpcional,
  superAdmin: z.boolean(),
  permissoes: z.record(z.string(), z.enum(["leitura", "edicao"])).default({}),
  senhaProvisoria: z.string().refine(senhaValida, "A senha provisória precisa ter 8+ caracteres, com letras e números."),
});

const pendente = () => NextResponse.json({ error: MSG_MIGRATION_PENDENTE, codigo: "migration_pendente" }, { status: 424 });

export async function GET() {
  const auth = await autorizarApi({ superAdmin: true });
  if (!auth.ok) return auth.resposta;

  const admin = createAdminClient();
  const { data, error } = await admin.from("users").select(COLUNAS_PERFIL).order("full_name");
  if (error) {
    if (ehMigrationPendente(error)) return pendente();
    return NextResponse.json({ error: `Falha ao carregar usuários: ${error.message}` }, { status: 500 });
  }

  let pedidos;
  let authPorId;
  try {
    [pedidos, authPorId] = await Promise.all([listarPedidosPendentes(admin), mapaAuth(admin)]);
  } catch (e) {
    if (ehMigrationPendente(e as { code?: string; message?: string })) return pendente();
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const perfis = (data ?? []) as PerfilRow[];
  const nomes = new Map(perfis.map((p) => [p.id, p.full_name?.trim() || p.email]));
  const corpo: ListaAcessos = {
    usuarios: perfis.map((p) => montarUsuario(p, authPorId.get(p.id) ?? null, nomes)),
    pedidos,
    meuId: auth.user.id,
  };
  return NextResponse.json(corpo);
}

export async function POST(req: NextRequest) {
  const auth = await autorizarApi({ superAdmin: true });
  if (!auth.ok) return auth.resposta;

  const parsed = criarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  }
  const b = parsed.data;
  const permissoes = b.superAdmin ? {} : normalizarPermissoes(b.permissoes);
  if (!b.superAdmin && Object.keys(permissoes).length === 0) {
    return NextResponse.json({ error: "Libere ao menos um módulo (ou marque Super Admin)." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: existente, error: errExiste } = await admin
    .from("users").select("id, trocar_senha").eq("email", b.email).maybeSingle();
  if (errExiste) {
    if (ehMigrationPendente(errExiste)) return pendente();
    return NextResponse.json({ error: errExiste.message }, { status: 500 });
  }
  if (existente) {
    return NextResponse.json(
      { error: "Já existe um acesso com este e-mail. Procure-o na lista para editar ou desbloquear." },
      { status: 409 },
    );
  }

  // 1) Usuário no Supabase Auth já confirmado e com a senha provisória — nenhum e-mail sai.
  const { data: criado, error: errCriar } = await admin.auth.admin.createUser({
    email: b.email,
    password: b.senhaProvisoria,
    email_confirm: true,
    user_metadata: { full_name: b.nome },
  });
  if (errCriar || !criado?.user) {
    const jaExiste = /already|registered|exists/i.test(errCriar?.message ?? "");
    return NextResponse.json(
      { error: jaExiste ? "Este e-mail já está cadastrado no Supabase Auth." : `Não foi possível criar o acesso: ${traduzirErroSenha(errCriar)}` },
      { status: jaExiste ? 409 : 400 },
    );
  }
  const userId = criado.user.id;

  // 2) Perfil: o gatilho criou inativo; grava nível/módulos, ativa e exige trocar a senha.
  const role = roleDasPermissoes(b.superAdmin, permissoes);
  const { error: errPerfil } = await admin.from("users").update({
    full_name: b.nome,
    cargo: b.cargo,
    setor: b.setor,
    role,
    permissoes,
    ativo: true,
    trocar_senha: true,
    convidado_por: auth.user.id,
    convidado_em: new Date().toISOString(),
  }).eq("id", userId);
  if (errPerfil) {
    // Sem perfil válido o usuário não serve para nada: desfaz a criação.
    await admin.auth.admin.deleteUser(userId);
    return NextResponse.json({
      error: ehMigrationPendente(errPerfil) ? MSG_MIGRATION_PENDENTE : `Falhou ao gravar o acesso: ${errPerfil.message}`,
    }, { status: 500 });
  }

  const nivel = nivelGeral({ role, permissoes });
  await registrarLog({
    tipo: "auth",
    acao: "ACESSO_CRIADO",
    descricao: `Criou o acesso de ${b.nome} (${b.email}) — ${NIVEL_GERAL_LABEL[nivel]}, com senha provisória`,
    usuario: auth.acesso,
    metadados: {
      alvo_id: userId, alvo_email: b.email, nivel,
      modulos: Object.entries(permissoes).map(([k, v]) => `${MODULO_POR_KEY[k as ModuloKey].label} (${v})`),
    },
    req,
  });

  const corpo: ResultadoAcesso = {
    usuario: await carregarUsuario(admin, userId),
    credenciais: { email: b.email, senha: b.senhaProvisoria },
  };
  return NextResponse.json(corpo, { status: 201 });
}
