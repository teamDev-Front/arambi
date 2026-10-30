// POST /api/assistentes/chat
//
// Envia uma mensagem para o assistente, persiste user+assistant no banco e
// devolve a resposta. Mantém UMA sessão "viva" por (usuario, agente) — o índice
// único parcial uniq_cs_open na migration 0020 garante isso a nível de DB.
//
// Body:
//   {
//     "agente_id":  "contabilidade",
//     "content":    "Como lanço esta despesa?",   (opcional quando há anexo)
//     "session_id": "<uuid opcional — força reuso de uma sessão específica do próprio usuário>",
//     "anexos":     [{ "path", "nome", "mime", "tamanho" }]   (opcional, até 3 — subidos via /api/assistentes/anexos)
//   }
//
// Response 200:
//   {
//     "session_id":        "<uuid>",
//     "provider":          "gemini" | "openai",
//     "user_message":      { id, role, conteudo, anexos, created_at },
//     "assistant_message": { id, role, conteudo, anexos, created_at }
//   }
//
// Anexos (migration 0062): o arquivo já está no bucket privado chat-anexos; aqui
// chegam só os metadados. O servidor baixa com service role, então o `path`
// TEM de estar na pasta do próprio usuário — checado no body e de novo em cada
// linha do histórico (o dono pode editar as próprias mensagens pelo RLS).
//
// Erros:
//   400 (body) · 401 (não autenticado) · 403 (sem o módulo / anexo alheio) · 424 (chave/treinamento ausente)
//   500 (Supabase) · 502 (provedor IA falhou) · 504 (request abortado / demorou demais)

import { NextResponse, type NextRequest } from "next/server";
import type { createClient } from "@/lib/supabase/server";
import { autorizarApi } from "@/lib/acessos/servidor";
import { podeVer } from "@/lib/acessos/permissoes";
import { MODULO_POR_KEY } from "@/lib/acessos/modulos";
import { createAdminClient } from "@/lib/supabase/admin";
import { callProvider, modelForProvider, type AIAnexo, type AIMensagem } from "@/lib/ai/providers";
import { toolsParaAgente, executarTool, modulosBloqueadosDoAgente } from "@/lib/ai/tools";
import type { ChatRole, IAProvider, Json } from "@/types";

// PDF + provedor passam fácil do limite padrão; o corte da resposta é PRAZO_RESPOSTA_MS.
export const maxDuration = 60;

interface ChatRequestBody {
  agente_id?: string;
  content?: string;
  session_id?: string;
  anexos?: unknown;
}

const MAX_HISTORICO     = 30;       // mensagens enviadas ao LLM como contexto
const MAX_CONTENT_CHARS = 8000;     // proteção básica contra payloads gigantes
const PRAZO_RESPOSTA_MS = 55_000;   // < maxDuration: sobra tempo para gravar ou desfazer

// Anexos — mesmos limites de /api/assistentes/anexos e do ChatPage.
const BUCKET_ANEXOS        = "chat-anexos";
const MAX_ANEXOS_POR_MSG   = 3;
const MAX_ANEXO_BYTES      = 10 * 1024 * 1024;
// Soma dos anexos mandados ao provedor por chamada. 12 MB viram ~16 MB em base64:
// cabe no limite de ~20 MB por requisição de dados inline do Gemini (provedor padrão).
const MAX_REENVIO_BYTES    = 12 * 1024 * 1024;
const MAX_NOME_ANEXO       = 200;
const MAX_TOKENS_COM_ANEXO = 8192;
const TEXTO_PADRAO_ANEXO   = "Analise o(s) documento(s) anexado(s).";
const EXT_POR_MIME = new Map<string, string>([
  ["application/pdf", "pdf"],
  ["image/png",       "png"],
  ["image/jpeg",      "jpg"],
  ["image/webp",      "webp"],
]);
// <uuid do usuário>/<uuid>-<slug>.<ext> — o formato montado por /api/assistentes/anexos.
const RE_PATH_ANEXO = /^[0-9a-f-]{36}\/[0-9a-f-]{36}-[a-z0-9-]{1,80}\.(pdf|png|jpg|webp)$/;

/** Item de chat_mensagens.anexos (migration 0062). */
type AnexoChat = { path: string; nome: string; mime: string; tamanho: number };

// Mapeamento de erros conhecidos do SDK para mensagens amigáveis em PT-BR.
// Roda contra `e.message` (case-insensitive).
function friendlyProviderError(provider: IAProvider, raw: string, comAnexos = false, modelo = ""): string {
  const m = raw.toLowerCase();
  const nomeProv = provider === "gemini" ? "Google Gemini" : "OpenAI";
  // Modelo escolhido na engrenagem (0067) que não serve ao chat.
  const naoSuporta = m.includes("does not support") || m.includes("not supported") || m.includes("unsupported");
  if (comAnexos && naoSuporta && m.includes("model") && (m.includes("image") || m.includes("file") || m.includes("pdf"))) {
    return `O modelo ${modelo || "escolhido"} não lê anexos (PDF ou imagem). Escolha outro em Assistentes → engrenagem ou envie sem anexo.`;
  }
  // Só roda pela Responses API, não é de conversa ou não aceita as ferramentas do assistente.
  if (m.includes("v1/responses") || m.includes("not a chat model") || (naoSuporta && m.includes("model") && !comAnexos)) {
    return `O modelo ${modelo || "escolhido"} não funciona com os assistentes. Escolha outro em Assistentes → engrenagem.`;
  }
  if (m.includes("api key") || m.includes("invalid_api_key") || m.includes("api_key_invalid") || m.includes("permission") || m.includes("unauthorized") || m.includes("401")) {
    return `A chave de API do ${nomeProv} foi recusada. Abra Assistentes → engrenagem e revise.`;
  }
  if (comAnexos && (m.includes("payload size") || m.includes("too large") || m.includes("413") || m.includes("exceeds the limit") || m.includes("context length") || m.includes("context_length") || m.includes("token count"))) {
    return `Os anexos ficaram grandes demais para o ${nomeProv}. Envie arquivos menores (ou menos páginas) ou comece uma nova conversa (botão +).`;
  }
  if (m.includes("quota") || m.includes("rate") || m.includes("429") || m.includes("resource_exhausted")) {
    return `Cota do ${nomeProv} esgotada ou muitas requisições em pouco tempo. Tente novamente em instantes.`;
  }
  if (m.includes("timeout") || m.includes("etimedout") || m.includes("network") || m.includes("fetch failed")) {
    return `Não foi possível alcançar o ${nomeProv} agora. Verifique a conexão e tente novamente.`;
  }
  if (m.includes("deprecated")) {
    return `O modelo ${modelo || "configurado"} foi descontinuado pelo ${nomeProv}. Escolha outro em Assistentes → engrenagem.`;
  }
  if (m.includes("model") && (m.includes("not found") || m.includes("not_found") || m.includes("does not exist"))) {
    return `O modelo ${modelo || "configurado"} não está disponível na conta do ${nomeProv}. Escolha outro em Assistentes → engrenagem.`;
  }
  if (m.includes("safety") || m.includes("blocked")) {
    return `A resposta foi bloqueada pelo filtro de segurança do ${nomeProv}.`;
  }
  if (comAnexos && (m.includes("invalid_argument") || m.includes("invalid argument") || m.includes("unsupported") || m.includes("unable to process") || m.includes("no pages") || m.includes("password") || m.includes("encrypt") || m.includes("400"))) {
    return `O ${nomeProv} não conseguiu ler um dos anexos (arquivo corrompido, protegido por senha ou formato não suportado). Remova-o e tente de novo.`;
  }
  return `Não foi possível obter resposta do ${nomeProv} agora. Tente novamente em instantes.`;
}

export async function POST(req: NextRequest) {
  const inicio = Date.now();

  // ---- 1) Body validation -------------------------------------------------
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: "Body JSON inválido." }, { status: 400 });
  }

  const agenteId = body.agente_id?.trim();
  const textoDigitado = body.content?.trim() ?? "";
  const sessionIdHint = body.session_id?.trim() || null;

  const anexosRes = validarAnexos(body.anexos);
  if (!anexosRes.ok) return NextResponse.json({ error: anexosRes.error }, { status: 400 });
  const anexos = anexosRes.anexos;

  if (!agenteId) return NextResponse.json({ error: "agente_id obrigatório." }, { status: 400 });
  if (!textoDigitado && !anexos.length) {
    return NextResponse.json({ error: "content obrigatório." }, { status: 400 });
  }
  if (textoDigitado.length > MAX_CONTENT_CHARS) {
    return NextResponse.json(
      { error: `Mensagem muito longa (máx. ${MAX_CONTENT_CHARS} caracteres).` },
      { status: 400 },
    );
  }
  // Só anexo, sem texto: grava (e manda ao modelo) um pedido padrão.
  const content = textoDigitado || TEXTO_PADRAO_ANEXO;

  // ---- 2) Auth + perfil do usuário ----------------------------------------
  // Módulo Assistentes liberado (0058); conversar é leitura.
  const auth = await autorizarApi({ modulos: ["assistentes"] });
  if (!auth.ok) return auth.resposta;
  const { supabase, user, acesso } = auth;

  // O servidor baixa os anexos com service role: só a pasta do próprio usuário.
  if (anexos.some((a) => !a.path.startsWith(`${user.id}/`))) {
    return NextResponse.json(
      { error: "Anexo inválido: só é possível enviar arquivos que você mesmo carregou." },
      { status: 403 },
    );
  }

  // ---- 3) Lê config_ia (admin, bypass RLS) + agente_prompt + perfil ------
  // config_ia tem SELECT restrito a admin/editor (migration 0020). Aqui
  // usamos o admin client porque o callante pode ser um sócio (role=socio).
  const admin = createAdminClient();

  const [cfgRes, promptRes, userRowRes] = await Promise.all([
    // select * (0067): com ou sem as colunas de modelo, a leitura não quebra.
    admin
      .from("config_ia")
      .select("*")
      .eq("id", 1)
      .maybeSingle(),
    admin
      .from("agente_prompts")
      .select("nome, system_prompt, temperatura, ativo")
      .eq("agente_id", agenteId)
      .maybeSingle(),
    supabase
      .from("users")
      .select("full_name, email")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  if (cfgRes.error)    return NextResponse.json({ error: `Falha ao ler configuração das IAs: ${cfgRes.error.message}` },    { status: 500 });
  if (promptRes.error) return NextResponse.json({ error: `Falha ao ler treinamento do agente: ${promptRes.error.message}` }, { status: 500 });

  const cfg = cfgRes.data;
  if (!cfg) {
    return NextResponse.json(
      { error: "Configuração das IAs não encontrada. Abra Assistentes → engrenagem e cadastre uma chave." },
      { status: 424 },
    );
  }

  const provider: IAProvider = cfg.provider_ativo;
  const apiKey = provider === "gemini" ? cfg.gemini_api_key : cfg.openai_api_key;
  // Modelo escolhido na engrenagem (0067); vazio ou inválido = padrão do provedor.
  const modelo = modelForProvider(provider, provider === "gemini" ? cfg.gemini_model : cfg.openai_model);
  if (!apiKey) {
    return NextResponse.json(
      { error: `Provedor ativo é "${provider}" mas a chave correspondente não foi cadastrada. Abra Assistentes → engrenagem.` },
      { status: 424 },
    );
  }

  const prompt = promptRes.data;
  if (!prompt) {
    return NextResponse.json(
      { error: `Agente "${agenteId}" não tem treinamento cadastrado. Abra o chat dele → engrenagem.` },
      { status: 424 },
    );
  }
  if (!prompt.ativo) {
    return NextResponse.json(
      { error: `O assistente "${prompt.nome}" está em manutenção (inativo).` },
      { status: 424 },
    );
  }

  const usuarioNome =
    userRowRes.data?.full_name ??
    userRowRes.data?.email?.split("@")[0] ??
    user.email?.split("@")[0] ??
    "Usuário";

  // ---- 4) Resolve sessão (own + open) -------------------------------------
  // Conversa aberta só com anexo ganha o nome do arquivo como título.
  const titulo = textoDigitado
    || `${anexos.length > 1 ? "Anexos" : "Anexo"}: ${anexos.map((a) => a.nome).join(", ")}`;
  const sessionId = await resolveSessionId({
    supabase, admin,
    userId: user.id, usuarioNome,
    agenteId, agenteNome: prompt.nome,
    sessionIdHint, primeiroConteudo: titulo,
  });

  if (!sessionId.ok) return NextResponse.json({ error: sessionId.error }, { status: 500 });

  // ---- 5) Persiste a mensagem do usuário ----------------------------------
  const { data: userMsg, error: userMsgErr } = await supabase
    .from("chat_mensagens")
    .insert({
      session_id: sessionId.id,
      role:       "user",
      conteudo:   content,
      anexos:     anexos.length ? anexos : null,
    })
    .select("id, session_id, role, conteudo, anexos, created_at")
    .single();
  if (userMsgErr || !userMsg) {
    return NextResponse.json(
      { error: `Falha ao salvar mensagem: ${userMsgErr?.message ?? "desconhecido"}` },
      { status: 500 },
    );
  }

  // ---- 6) Carrega histórico (com a msg recém-inserida no final) -----------
  const { data: historicoDesc, error: histErr } = await supabase
    .from("chat_mensagens")
    .select("role, conteudo, anexos, created_at")
    .eq("session_id", sessionId.id)
    .order("created_at", { ascending: false })
    .limit(MAX_HISTORICO);
  if (histErr) {
    // Rollback da mensagem que acabou de entrar pra não ficar órfã.
    await supabase.from("chat_mensagens").delete().eq("id", userMsg.id);
    return NextResponse.json({ error: `Falha ao ler histórico: ${histErr.message}` }, { status: 500 });
  }
  // Baixa os anexos da janela (teto de MAX_REENVIO_BYTES); falha vira aviso no texto.
  const { mensagens: historico, anexosEnviados } = await montarHistorico(
    admin,
    (historicoDesc ?? []).slice().reverse(),
    user.id,
  );

  // ---- 7) Chama o provedor com tools do agente -----------------------------
  // A IA só consulta os módulos que o usuário enxerga; o resto é avisado no prompt.
  const ver = (m: Parameters<typeof podeVer>[1]) => podeVer(acesso, m);
  const tools = toolsParaAgente(agenteId, ver);
  const bloqueados = modulosBloqueadosDoAgente(agenteId, ver);
  const avisoPermissao = bloqueados.length
    ? `

[Permissões do usuário] Ele NÃO tem acesso aos módulos: ${bloqueados.map((m) => MODULO_POR_KEY[m].label).join(", ")}. `
      + "Você não tem ferramentas para consultar esses dados. Se ele pedir algo desses módulos, explique com educação "
      + "que o acesso não está liberado para ele e que pode pedir ao administrador na tela Acessos. Nunca invente esses números."
    : "";
  const avisoAnexos = anexosEnviados
    ? `

[Documentos anexados] O usuário anexou arquivos (PDF ou imagem) nesta conversa; eles vêm junto das mensagens dele. `
      + "Analise o conteúdo deles para responder e, quando possível, cite a cláusula, o item ou a página de onde tirou cada informação. "
      + "Se algum arquivo estiver ilegível (digitalização ruim, página em branco, imagem cortada), diga isso claramente em vez de supor o conteúdo."
    : "";
  let resposta;
  try {
    if (req.signal.aborted) throw new DOMException("Request cancelado.", "AbortError");
    resposta = await comPrazo(
      callProvider(provider, apiKey, historico, {
        model: modelo,
        systemPrompt: (prompt.system_prompt ?? "") + avisoPermissao + avisoAnexos,
        temperatura:  Number(prompt.temperatura ?? 0.3),
        maxOutputTokens: anexosEnviados ? MAX_TOKENS_COM_ANEXO : undefined,
        tools,
        onToolCall: async (name, args) => {
          const res = await executarTool(tools, name, args, { admin, userId: user.id });
          // O LLM lê o objeto inteiro — incluindo { ok, error } no caso de falha.
          return res;
        },
      }),
      PRAZO_RESPOSTA_MS - (Date.now() - inicio),
    );
  } catch (e) {
    // Compensa o INSERT do user — assim a próxima conversa não fica com
    // mensagem solta sem resposta correspondente.
    await supabase.from("chat_mensagens").delete().eq("id", userMsg.id);

    if (e instanceof DOMException && e.name === "AbortError") {
      return NextResponse.json({ error: "Envio cancelado." }, { status: 504 });
    }
    if (e instanceof PrazoEsgotado) {
      console.error(`[chat] provider ${provider} passou de ${PRAZO_RESPOSTA_MS} ms (anexos: ${anexosEnviados})`);
      return NextResponse.json(
        { error: "O assistente demorou demais para responder. Tente de novo — com anexos grandes, pergunte sobre menos páginas por vez." },
        { status: 504 },
      );
    }
    const rawMsg = e instanceof Error ? e.message : String(e);
    console.error(`[chat] provider ${provider} (${modelo}) falhou: ${rawMsg}`);
    return NextResponse.json(
      { error: friendlyProviderError(provider, rawMsg, anexosEnviados > 0, modelo) },
      { status: 502 },
    );
  }

  const conteudoResposta = resposta.content || "(O modelo não retornou texto.)";

  // ---- 8) Persiste a resposta --------------------------------------------
  const { data: assistantMsg, error: asstErr } = await supabase
    .from("chat_mensagens")
    .insert({
      session_id:   sessionId.id,
      role:         "assistant",
      conteudo:     conteudoResposta,
      tokens:       resposta.tokens_output ?? null,
      tokens_input: resposta.tokens_input  ?? null,
      provider,
      model:        modelo,
    })
    .select("id, session_id, role, conteudo, anexos, model, created_at")
    .single();

  if (asstErr || !assistantMsg) {
    // Rollback do user para manter o histórico consistente.
    await supabase.from("chat_mensagens").delete().eq("id", userMsg.id);
    console.error(`[chat] falha ao salvar resposta: ${asstErr?.message}`);
    return NextResponse.json(
      { error: "Falha ao salvar a resposta do assistente." },
      { status: 500 },
    );
  }

  // (chat_sessions.updated_at agora é atualizado por trigger AFTER INSERT.)

  return NextResponse.json({
    session_id: sessionId.id,
    provider,
    user_message:      userMsg,
    assistant_message: assistantMsg,
  });
}

// ============================================================================
// Helpers
// ============================================================================

type SessionResolution = { ok: true; id: string } | { ok: false; error: string };

interface ResolveArgs {
  supabase:     Awaited<ReturnType<typeof createClient>>;
  admin:        ReturnType<typeof createAdminClient>;
  userId:       string;
  usuarioNome:  string;
  agenteId:     string;
  agenteNome:   string;
  sessionIdHint: string | null;
  primeiroConteudo: string;
}

async function resolveSessionId(a: ResolveArgs): Promise<SessionResolution> {
  // 1) Se o cliente sugeriu uma session_id, só aceita se for do PRÓPRIO usuário
  //    E do MESMO agente. Caso contrário, ignora e segue o fluxo normal.
  if (a.sessionIdHint) {
    const { data: forced } = await a.supabase
      .from("chat_sessions")
      .select("id, fechada, usuario_id, agente_id")
      .eq("id", a.sessionIdHint)
      .maybeSingle();
    if (
      forced &&
      !forced.fechada &&
      forced.usuario_id === a.userId &&
      forced.agente_id === a.agenteId
    ) {
      return { ok: true, id: forced.id };
    }
    // hint inválido → cai pro fluxo normal (sem erro)
  }

  // 2) Procura sessão viva existente.
  const { data: existing } = await a.supabase
    .from("chat_sessions")
    .select("id")
    .eq("usuario_id", a.userId)
    .eq("agente_id", a.agenteId)
    .eq("fechada", false)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return { ok: true, id: existing.id };

  // 3) Tenta criar — o índice único parcial uniq_cs_open evita corrida.
  const { data: created, error: createErr } = await a.supabase
    .from("chat_sessions")
    .insert({
      agente_id:    a.agenteId,
      agente_nome:  a.agenteNome,
      usuario_id:   a.userId,
      usuario_nome: a.usuarioNome,
      titulo:       a.primeiroConteudo.slice(0, 60),
    })
    .select("id")
    .single();

  if (!createErr && created) return { ok: true, id: created.id };

  // 4) Se duplicou (código Postgres 23505 — unique_violation), outro request
  //    do mesmo usuário/agente já criou a sessão; relê e retorna.
  if (createErr?.code === "23505") {
    const { data: retry } = await a.supabase
      .from("chat_sessions")
      .select("id")
      .eq("usuario_id", a.userId)
      .eq("agente_id", a.agenteId)
      .eq("fechada", false)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (retry) return { ok: true, id: retry.id };
  }

  return { ok: false, error: `Falha ao criar sessão de chat: ${createErr?.message ?? "desconhecido"}` };
}

// ---------------------------------------------------------------------------
// Anexos
// ---------------------------------------------------------------------------

type ValidacaoAnexos = { ok: true; anexos: AnexoChat[] } | { ok: false; error: string };

/** `anexos` do body: lista opcional, até 3, formato e limites de /api/assistentes/anexos. */
function validarAnexos(raw: unknown): ValidacaoAnexos {
  if (raw === undefined || raw === null) return { ok: true, anexos: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "anexos deve ser uma lista." };
  if (raw.length > MAX_ANEXOS_POR_MSG) {
    return { ok: false, error: `Máximo de ${MAX_ANEXOS_POR_MSG} anexos por mensagem.` };
  }
  const anexos: AnexoChat[] = [];
  for (const item of raw) {
    const a = lerAnexo(item);
    if (!a) return { ok: false, error: "Anexo inválido. Remova o arquivo e anexe de novo." };
    if (anexos.some((x) => x.path === a.path)) return { ok: false, error: "O mesmo anexo foi enviado duas vezes." };
    anexos.push(a);
  }
  if (anexos.reduce((s, a) => s + a.tamanho, 0) > MAX_REENVIO_BYTES) {
    return { ok: false, error: "Os anexos de uma mensagem podem somar no máximo 12 MB." };
  }
  return { ok: true, anexos };
}

/** Valida UM anexo (do body ou do jsonb salvo). null = formato inválido. */
function lerAnexo(item: unknown): AnexoChat | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const o = item as Record<string, unknown>;
  const { path, mime, tamanho } = o;
  if (typeof path !== "string" || !RE_PATH_ANEXO.test(path)) return null;
  const ext = typeof mime === "string" ? EXT_POR_MIME.get(mime) : undefined;
  if (typeof mime !== "string" || !ext || !path.endsWith(`.${ext}`)) return null;
  if (typeof tamanho !== "number" || !Number.isInteger(tamanho) || tamanho <= 0 || tamanho > MAX_ANEXO_BYTES) return null;
  const nome = typeof o.nome === "string" ? limparNome(o.nome) : "";
  if (!nome || nome.length > MAX_NOME_ANEXO) return null;
  return { path, nome, mime, tamanho };
}

/** Tira caracteres de controle e espaços repetidos do nome exibido. */
function limparNome(nome: string): string {
  return Array.from(nome)
    .map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? " " : c))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Anexos válidos de uma linha do histórico. null/formato antigo (métricas de
 * antes da 0020) → nenhum. Caminho fora da pasta do usuário é IGNORADO: o
 * dono pode editar as próprias linhas pelo RLS (cm_write) e o download aqui é
 * com service role — sem esta checagem daria para ler arquivo de outra pessoa.
 */
function anexosSalvos(json: Json | null, userId: string): AnexoChat[] {
  if (!Array.isArray(json)) return [];
  const lista: AnexoChat[] = [];
  for (const item of json.slice(0, MAX_ANEXOS_POR_MSG)) {
    const a = lerAnexo(item);
    if (!a || !a.path.startsWith(`${userId}/`) || lista.some((x) => x.path === a.path)) continue;
    lista.push(a);
  }
  return lista;
}

interface LinhaHistorico {
  role:     ChatRole;
  conteudo: string;
  anexos:   Json | null;
}

/**
 * Histórico (ordem cronológica) → mensagens do provedor, com os anexos das
 * mensagens do usuário em base64. Reparte MAX_REENVIO_BYTES da mais nova para
 * a mais antiga (a atual é a última, entra primeiro); o que não couber vira
 * "[Anexo anterior não reenviado: X]" e o que não baixar vira aviso — nunca
 * derruba o chat.
 */
async function montarHistorico(
  admin: ReturnType<typeof createAdminClient>,
  linhas: LinhaHistorico[],
  userId: string,
): Promise<{ mensagens: AIMensagem[]; anexosEnviados: number }> {
  const mensagens: AIMensagem[] = linhas.map((l) => ({ role: l.role, content: l.conteudo }));
  let restante = MAX_REENVIO_BYTES;
  let anexosEnviados = 0;

  for (let i = linhas.length - 1; i >= 0; i--) {
    if (linhas[i].role !== "user") continue;
    const lista = anexosSalvos(linhas[i].anexos, userId);
    if (!lista.length) continue;

    // Conta pelo tamanho declarado; baixarAnexo recusa arquivo maior que isso.
    const cabe = lista.map((a) => {
      if (a.tamanho > restante) return false;
      restante -= a.tamanho;
      return true;
    });
    const baixados = await Promise.all(
      lista.map((a, j) => (cabe[j] ? baixarAnexo(admin, a) : Promise.resolve(null))),
    );

    const anexos: AIAnexo[] = [];
    const avisos: string[] = [];
    lista.forEach((a, j) => {
      const r = baixados[j];
      if (!r) avisos.push(`[Anexo anterior não reenviado: ${a.nome}]`);
      else if (!r.ok) avisos.push(`[Não foi possível abrir o anexo: ${a.nome}]`);
      else anexos.push({ nome: a.nome, mime: r.mime, base64: r.base64 });
    });
    anexosEnviados += anexos.length;

    // Os nomes ajudam o modelo a citar/comparar ("o contrato X diz…").
    const cabecalho = anexos.length
      ? `[Arquivos anexados nesta mensagem: ${anexos.map((a) => a.nome).join("; ")}]\n\n`
      : "";
    const rodape = avisos.length ? `\n\n${avisos.join("\n")}` : "";
    mensagens[i] = {
      role: "user",
      content: cabecalho + linhas[i].conteudo + rodape,
      anexos: anexos.length ? anexos : undefined,
    };
  }

  return { mensagens, anexosEnviados };
}

type AnexoBaixado = { ok: true; mime: string; base64: string } | { ok: false };

async function baixarAnexo(
  admin: ReturnType<typeof createAdminClient>,
  a: AnexoChat,
): Promise<AnexoBaixado> {
  try {
    const { data, error } = await admin.storage.from(BUCKET_ANEXOS).download(a.path);
    if (error || !data) {
      console.warn(`[chat] anexo ${a.path} não baixou: ${error?.message ?? "vazio"}`);
      return { ok: false };
    }
    if (data.size === 0 || data.size > a.tamanho || data.size > MAX_ANEXO_BYTES) {
      console.warn(`[chat] anexo ${a.path} com tamanho inesperado (${data.size} B; declarado ${a.tamanho} B)`);
      return { ok: false };
    }
    const bytes = Buffer.from(await data.arrayBuffer());
    const mime = mimePelosBytes(bytes);
    if (!mime) {
      console.warn(`[chat] anexo ${a.path} não é PDF/PNG/JPEG/WEBP de verdade`);
      return { ok: false };
    }
    return { ok: true, mime, base64: bytes.toString("base64") };
  } catch (e) {
    console.warn(`[chat] anexo ${a.path} falhou: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false };
  }
}

const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Tipo pela assinatura do arquivo — não confia no mime declarado pelo navegador. */
function mimePelosBytes(b: Buffer): string | null {
  if (b.subarray(0, 1024).includes("%PDF-")) return "application/pdf";
  if (b.subarray(0, 8).equals(ASSINATURA_PNG)) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

class PrazoEsgotado extends Error {}

/** Corta a espera antes do maxDuration da Function, para dar tempo de desfazer o INSERT. */
function comPrazo<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PrazoEsgotado()), Math.max(ms, 0));
  });
  return Promise.race([p, prazo]).finally(() => clearTimeout(timer));
}
