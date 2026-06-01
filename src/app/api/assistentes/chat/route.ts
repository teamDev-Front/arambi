// POST /api/assistentes/chat
//
// Envia uma mensagem para o assistente, persiste user+assistant no banco e
// devolve a resposta. Mantém UMA sessão "viva" por (usuario, agente) — o índice
// único parcial uniq_cs_open na migration 0020 garante isso a nível de DB.
//
// Body:
//   {
//     "agente_id":  "contabilidade",
//     "content":    "Como lanço esta despesa?",
//     "session_id": "<uuid opcional — força reuso de uma sessão específica do próprio usuário>"
//   }
//
// Response 200:
//   {
//     "session_id":        "<uuid>",
//     "provider":          "gemini" | "openai",
//     "user_message":      { id, role, conteudo, created_at },
//     "assistant_message": { id, role, conteudo, created_at }
//   }
//
// Erros:
//   400 (body) · 401 (não autenticado) · 424 (chave/treinamento ausente)
//   500 (Supabase) · 502 (provedor IA falhou) · 504 (request abortado)

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callProvider, modelForProvider, type AIMensagem } from "@/lib/ai/providers";
import { toolsParaAgente, executarTool } from "@/lib/ai/tools";
import type { IAProvider } from "@/types";

interface ChatRequestBody {
  agente_id?: string;
  content?: string;
  session_id?: string;
}

const MAX_HISTORICO     = 30;       // mensagens enviadas ao LLM como contexto
const MAX_CONTENT_CHARS = 8000;     // proteção básica contra payloads gigantes

// Mapeamento de erros conhecidos do SDK para mensagens amigáveis em PT-BR.
// Roda contra `e.message` (case-insensitive).
function friendlyProviderError(provider: IAProvider, raw: string): string {
  const m = raw.toLowerCase();
  const nomeProv = provider === "gemini" ? "Google Gemini" : "OpenAI";
  if (m.includes("api key") || m.includes("invalid_api_key") || m.includes("api_key_invalid") || m.includes("permission") || m.includes("unauthorized") || m.includes("401")) {
    return `A chave de API do ${nomeProv} foi recusada. Abra Assistentes → engrenagem e revise.`;
  }
  if (m.includes("quota") || m.includes("rate") || m.includes("429") || m.includes("resource_exhausted")) {
    return `Cota do ${nomeProv} esgotada ou muitas requisições em pouco tempo. Tente novamente em instantes.`;
  }
  if (m.includes("timeout") || m.includes("etimedout") || m.includes("network") || m.includes("fetch failed")) {
    return `Não foi possível alcançar o ${nomeProv} agora. Verifique a conexão e tente novamente.`;
  }
  if (m.includes("model") && (m.includes("not found") || m.includes("not_found"))) {
    return `Modelo configurado para o ${nomeProv} não está disponível. Avise o admin.`;
  }
  if (m.includes("safety") || m.includes("blocked")) {
    return `A resposta foi bloqueada pelo filtro de segurança do ${nomeProv}.`;
  }
  return `Não foi possível obter resposta do ${nomeProv} agora. Tente novamente em instantes.`;
}

export async function POST(req: NextRequest) {
  // ---- 1) Body validation -------------------------------------------------
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: "Body JSON inválido." }, { status: 400 });
  }

  const agenteId = body.agente_id?.trim();
  const content  = body.content?.trim();
  const sessionIdHint = body.session_id?.trim() || null;

  if (!agenteId) return NextResponse.json({ error: "agente_id obrigatório." }, { status: 400 });
  if (!content)  return NextResponse.json({ error: "content obrigatório." },   { status: 400 });
  if (content.length > MAX_CONTENT_CHARS) {
    return NextResponse.json(
      { error: `Mensagem muito longa (máx. ${MAX_CONTENT_CHARS} caracteres).` },
      { status: 400 },
    );
  }

  // ---- 2) Auth + perfil do usuário ----------------------------------------
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  // ---- 3) Lê config_ia (admin, bypass RLS) + agente_prompt + perfil ------
  // config_ia tem SELECT restrito a admin/editor (migration 0020). Aqui
  // usamos o admin client porque o callante pode ser um sócio (role=socio).
  const admin = createAdminClient();

  const [cfgRes, promptRes, userRowRes] = await Promise.all([
    admin
      .from("config_ia")
      .select("provider_ativo, gemini_api_key, openai_api_key")
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
  const sessionId = await resolveSessionId({
    supabase, admin,
    userId: user.id, usuarioNome,
    agenteId, agenteNome: prompt.nome,
    sessionIdHint, primeiroConteudo: content,
  });

  if (!sessionId.ok) return NextResponse.json({ error: sessionId.error }, { status: 500 });

  // ---- 5) Persiste a mensagem do usuário ----------------------------------
  const { data: userMsg, error: userMsgErr } = await supabase
    .from("chat_mensagens")
    .insert({ session_id: sessionId.id, role: "user", conteudo: content })
    .select("id, session_id, role, conteudo, created_at")
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
    .select("role, conteudo, created_at")
    .eq("session_id", sessionId.id)
    .order("created_at", { ascending: false })
    .limit(MAX_HISTORICO);
  if (histErr) {
    // Rollback da mensagem que acabou de entrar pra não ficar órfã.
    await supabase.from("chat_mensagens").delete().eq("id", userMsg.id);
    return NextResponse.json({ error: `Falha ao ler histórico: ${histErr.message}` }, { status: 500 });
  }
  const historico: AIMensagem[] = (historicoDesc ?? [])
    .slice()
    .reverse()
    .map((m) => ({ role: m.role, content: m.conteudo }));

  // ---- 7) Chama o provedor com tools do agente -----------------------------
  const tools = toolsParaAgente(agenteId);
  let resposta;
  try {
    if (req.signal.aborted) throw new DOMException("Request cancelado.", "AbortError");
    resposta = await callProvider(provider, apiKey, historico, {
      systemPrompt: prompt.system_prompt ?? "",
      temperatura:  Number(prompt.temperatura ?? 0.3),
      tools,
      onToolCall: async (name, args) => {
        const res = await executarTool(tools, name, args, { admin, userId: user.id });
        // O LLM lê o objeto inteiro — incluindo { ok, error } no caso de falha.
        return res;
      },
    });
  } catch (e) {
    // Compensa o INSERT do user — assim a próxima conversa não fica com
    // mensagem solta sem resposta correspondente.
    await supabase.from("chat_mensagens").delete().eq("id", userMsg.id);

    if (e instanceof DOMException && e.name === "AbortError") {
      return NextResponse.json({ error: "Envio cancelado." }, { status: 504 });
    }
    const rawMsg = e instanceof Error ? e.message : String(e);
    console.error(`[chat] provider ${provider} falhou: ${rawMsg}`);
    return NextResponse.json(
      { error: friendlyProviderError(provider, rawMsg) },
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
      model:        modelForProvider(provider),
    })
    .select("id, session_id, role, conteudo, created_at")
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
