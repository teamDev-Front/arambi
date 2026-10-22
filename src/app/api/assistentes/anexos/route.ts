// /api/assistentes/anexos — arquivos que o usuário anexa no chat dos assistentes
//
// O arquivo NÃO passa por aqui (o corpo das Functions da Vercel é limitado a
// 4,5 MB): esta rota só autoriza e devolve um token de upload; o navegador
// sobe direto para o bucket privado `chat-anexos` (migration 0062). O bucket
// não tem política para usuários: subir só com o token emitido aqui, ler só
// pelo servidor (service role) — sempre restrito à pasta do próprio usuário.
//
// POST  { nome, mime, tamanho }
//   → 200 { path, token }   (path = <id do usuário>/<uuid>-<nome>.<ext>)
//   O cliente chama supabase.storage.from("chat-anexos").uploadToSignedUrl(path, token, file)
//   e depois manda { path, nome, mime, tamanho } em `anexos` no POST /api/assistentes/chat.
//
// GET   ?path=<path>
//   → 302 para uma signed URL de 10 min (abre o anexo numa aba nova).
//   Só para caminhos da pasta de quem pede.
//
// Erros: 400 (body/path) · 401 · 403 (sem o módulo / arquivo de outro usuário)
//        404 (anexo não encontrado) · 500 (Storage)

import { NextResponse, type NextRequest } from "next/server";
import { autorizarApi } from "@/lib/acessos/servidor";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET    = "chat-anexos";
const TTL_SEC   = 60 * 10;
// Mesmos limites de /api/assistentes/chat e do ChatPage.
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_NOME  = 200;
const EXT_POR_MIME = new Map<string, string>([
  ["application/pdf", "pdf"],
  ["image/png",       "png"],
  ["image/jpeg",      "jpg"],
  ["image/webp",      "webp"],
]);
// <uuid do usuário>/<uuid>-<slug>.<ext> — exatamente o formato montado no POST.
const RE_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}-[a-z0-9-]{1,80}\.(pdf|png|jpg|webp)$/;

interface UploadRequestBody {
  nome?: unknown;
  mime?: unknown;
  tamanho?: unknown;
}

/** Só caminhos no formato gerado aqui E dentro da pasta do usuário (sem "..", sem pasta alheia). */
function pathDoUsuario(path: string, userId: string): boolean {
  return path.startsWith(`${userId}/`) && RE_PATH.test(path);
}

/** Tira caracteres de controle e espaços repetidos do nome exibido. */
function limparNome(nome: string): string {
  return Array.from(nome)
    .map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? " " : c))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Contrato Arrendamento (v2).pdf" → "contrato-arrendamento-v2" */
function slugNome(nome: string): string {
  const slug = nome
    .replace(/\.[^.]*$/, "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || "arquivo";
}

export async function POST(req: NextRequest) {
  // ---- 1) Body ------------------------------------------------------------
  let body: UploadRequestBody;
  try {
    body = (await req.json()) as UploadRequestBody;
  } catch {
    return NextResponse.json({ error: "Body JSON inválido." }, { status: 400 });
  }

  const nome    = typeof body.nome === "string" ? limparNome(body.nome) : "";
  const mime    = typeof body.mime === "string" ? body.mime : "";
  const tamanho = body.tamanho;

  if (!nome) return NextResponse.json({ error: "nome obrigatório." }, { status: 400 });
  if (nome.length > MAX_NOME) {
    return NextResponse.json({ error: `Nome do arquivo muito longo (máx. ${MAX_NOME} caracteres).` }, { status: 400 });
  }
  const ext = EXT_POR_MIME.get(mime);
  if (!ext) {
    return NextResponse.json({ error: "Tipo de arquivo não permitido. Envie PDF, PNG, JPG ou WEBP." }, { status: 400 });
  }
  if (typeof tamanho !== "number" || !Number.isInteger(tamanho) || tamanho <= 0) {
    return NextResponse.json({ error: "tamanho inválido." }, { status: 400 });
  }
  if (tamanho > MAX_BYTES) {
    return NextResponse.json({ error: "Arquivo maior que 10 MB." }, { status: 400 });
  }

  // ---- 2) Auth — mesmo módulo do chat (conversar é leitura) ---------------
  const auth = await autorizarApi({ modulos: ["assistentes"] });
  if (!auth.ok) return auth.resposta;
  const { user } = auth;

  // ---- 3) Token de upload para um caminho novo na pasta do usuário --------
  const path = `${user.id}/${crypto.randomUUID()}-${slugNome(nome)}.${ext}`;
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error(`[anexos] falha ao gerar upload: ${error?.message}`);
    const semBucket = /bucket not found/i.test(error?.message ?? "");
    return NextResponse.json(
      {
        error: semBucket
          ? "O armazenamento de anexos ainda não foi configurado (migration 0062). Avise o administrador."
          : "Não foi possível preparar o envio do arquivo. Tente novamente.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ path, token: data.token });
}

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path")?.trim() ?? "";
  if (!path) return NextResponse.json({ error: "path obrigatório." }, { status: 400 });

  const auth = await autorizarApi({ modulos: ["assistentes"] });
  if (!auth.ok) return auth.resposta;
  const { user } = auth;

  // A leitura é com service role: a checagem de dono é AQUI.
  if (!pathDoUsuario(path, user.id)) {
    return NextResponse.json({ error: "Este anexo não pertence a você." }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: signed, error } = await admin.storage.from(BUCKET).createSignedUrl(path, TTL_SEC);
  if (error || !signed) {
    return NextResponse.json({ error: "Anexo não encontrado." }, { status: 404 });
  }

  const res = NextResponse.redirect(signed.signedUrl, 302);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
