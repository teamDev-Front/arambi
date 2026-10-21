// GET  /api/acessos  → lista de usuários com status, módulos e último acesso
// POST /api/acessos  → cria o acesso e convida (e-mail e/ou link)
// Só Super Admin. Escrita via service role (o RLS da 0058 não deixa o client
// alterar papel/módulos).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { autorizarApi, registrarLog } from "@/lib/acessos/servidor";
import {
  COLUNAS_PERFIL, MSG_MIGRATION_PENDENTE, carregarUsuario, ehFalhaDeEnvio, ehMigrationPendente,
  enviarConvite, gerarLink, mapaAuth, montarUsuario, traduzirErroEmail, type PerfilRow,
} from "@/lib/acessos/gestao";
import { NIVEL_GERAL_LABEL, nivelGeral, normalizarPermissoes, roleDasPermissoes } from "@/lib/acessos/permissoes";
import { MODULO_POR_KEY, type ModuloKey } from "@/lib/acessos/modulos";
import type { ListaAcessos, ResultadoConvite } from "@/lib/acessos/tipos";

export const dynamic = "force-dynamic";

const textoOpcional = z.string().trim().max(80).nullish().transform((v) => (v ? v : null));

const criarSchema = z.object({
  nome: z.string().trim().min(3, "Informe o nome completo.").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido."),
  cargo: textoOpcional,
  setor: textoOpcional,
  superAdmin: z.boolean(),
  permissoes: z.record(z.string(), z.enum(["leitura", "edicao"])).default({}),
  enviarEmail: z.boolean().default(true),
});

export async function GET() {
  const auth = await autorizarApi({ superAdmin: true });
  if (!auth.ok) return auth.resposta;

  const admin = createAdminClient();
  const { data, error } = await admin.from("users").select(COLUNAS_PERFIL).order("full_name");
  if (error) {
    if (ehMigrationPendente(error)) {
      return NextResponse.json({ error: MSG_MIGRATION_PENDENTE, codigo: "migration_pendente" }, { status: 424 });
    }
    return NextResponse.json({ error: `Falha ao carregar usuários: ${error.message}` }, { status: 500 });
  }

  let authPorId;
  try {
    authPorId = await mapaAuth(admin);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const perfis = (data ?? []) as PerfilRow[];
  const nomes = new Map(perfis.map((p) => [p.id, p.full_name?.trim() || p.email]));
  const corpo: ListaAcessos = {
    usuarios: perfis.map((p) => montarUsuario(p, authPorId.get(p.id) ?? null, nomes)),
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
  const origin = req.nextUrl.origin;

  // Já existe? (perfil = já está em auth.users também)
  const { data: existente, error: errExiste } = await admin
    .from("users").select("id, ativo, bloqueado_em").eq("email", b.email).maybeSingle();
  if (errExiste) {
    if (ehMigrationPendente(errExiste)) {
      return NextResponse.json({ error: MSG_MIGRATION_PENDENTE, codigo: "migration_pendente" }, { status: 424 });
    }
    return NextResponse.json({ error: errExiste.message }, { status: 500 });
  }
  if (existente) {
    return NextResponse.json(
      { error: "Já existe um acesso com este e-mail. Procure-o na lista para editar ou desbloquear." },
      { status: 409 },
    );
  }

  // 1) Cria em auth.users — por e-mail, ou só o link (WhatsApp).
  const resultado: ResultadoConvite = { emailEnviado: false };
  let userId: string | null = null;
  if (b.enviarEmail) {
    const conv = await enviarConvite(admin, origin, b.email, b.nome);
    if (conv.ok) {
      userId = conv.user.id;
      resultado.emailEnviado = true;
    } else if (ehFalhaDeEnvio(conv.erro)) {
      resultado.avisoEmail = traduzirErroEmail(conv.erro);
    } else {
      return NextResponse.json({ error: `Não foi possível criar o acesso: ${conv.erro.message}` }, { status: 400 });
    }
  }
  if (!userId) {
    const gl = await gerarLink(admin, origin, b.email, "invite", b.nome);
    if (!gl.ok) return NextResponse.json({ error: `Não foi possível criar o acesso: ${gl.erro}` }, { status: 400 });
    userId = gl.user.id;
    resultado.link = gl.link;
  }

  // 2) Perfil: o gatilho criou inativo; grava nível/módulos e ativa.
  const role = roleDasPermissoes(b.superAdmin, permissoes);
  const { error: errPerfil } = await admin.from("users").update({
    full_name: b.nome,
    cargo: b.cargo,
    setor: b.setor,
    role,
    permissoes,
    ativo: true,
    convidado_por: auth.user.id,
    convidado_em: new Date().toISOString(),
  }).eq("id", userId);
  if (errPerfil) {
    return NextResponse.json({
      error: ehMigrationPendente(errPerfil) ? MSG_MIGRATION_PENDENTE : `Usuário criado, mas falhou ao gravar o acesso: ${errPerfil.message}`,
    }, { status: 500 });
  }

  const nivel = nivelGeral({ role, permissoes });
  await registrarLog({
    tipo: "auth",
    acao: "ACESSO_CRIADO",
    descricao: `Criou o acesso de ${b.nome} (${b.email}) — ${NIVEL_GERAL_LABEL[nivel]}${resultado.emailEnviado ? ", convite por e-mail" : ", link de convite"}`,
    usuario: auth.acesso,
    metadados: {
      alvo_id: userId, alvo_email: b.email, nivel,
      modulos: Object.entries(permissoes).map(([k, v]) => `${MODULO_POR_KEY[k as ModuloKey].label} (${v})`),
      email_enviado: resultado.emailEnviado,
    },
    req,
  });

  resultado.usuario = (await carregarUsuario(admin, userId)) ?? undefined;
  return NextResponse.json(resultado, { status: 201 });
}
