// POST /api/assistentes/chat
//
// Encaminha uma mensagem do usuário para o provedor de IA configurado
// (Gemini ou OpenAI), lendo a chave de API server-side em public.config_ia.
// O front nunca enxerga a chave: só envia mensagem + agente e recebe a resposta.
//
// Body:
//   {
//     "agente_id":  "contabilidade",
//     "mensagens": [
//       { "role": "user" | "assistant" | "system", "content": "..." }
//     ]
//   }
//
// Response 200:
//   {
//     "provider": "gemini" | "openai",
//     "content":  "<resposta do assistente>"
//   }
//
// ⚠️  Esqueleto: a chamada efetiva ao Gemini/OpenAI ainda não foi plugada.
//     Hoje devolve 501 quando há chave configurada e 400/424 quando não há.
//     Quando for tirar o mock do ChatPage:
//       1. Adicionar o SDK do provedor (@google/genai e/ou openai)
//       2. Implementar callGemini() / callOpenAI() abaixo
//       3. Trocar o 501 por NextResponse.json({ provider, content })

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ChatRole, IAProvider } from "@/types";

interface ChatMensagemIn {
  role: ChatRole;
  content: string;
}

interface ChatRequestBody {
  agente_id?: string;
  mensagens?: ChatMensagemIn[];
}

export async function POST(req: NextRequest) {
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  if (!body.agente_id || typeof body.agente_id !== "string") {
    return NextResponse.json({ error: "agente_id obrigatório" }, { status: 400 });
  }
  if (!Array.isArray(body.mensagens) || body.mensagens.length === 0) {
    return NextResponse.json({ error: "mensagens (array não vazio) obrigatório" }, { status: 400 });
  }

  const supabase = await createClient();

  // 1) Auth
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  // 2) Lê config_ia (RLS permite SELECT para qualquer autenticado)
  const { data: cfg, error: cfgErr } = await supabase
    .from("config_ia")
    .select("provider_ativo, gemini_api_key, openai_api_key")
    .eq("id", 1)
    .maybeSingle();

  if (cfgErr) {
    return NextResponse.json(
      { error: `Falha ao ler configuração das IAs: ${cfgErr.message}` },
      { status: 500 },
    );
  }
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
      {
        error: `Provedor ativo é "${provider}" mas a chave correspondente não foi cadastrada. Abra Assistentes → engrenagem.`,
      },
      { status: 424 },
    );
  }

  // 3) TODO: chamar o provedor. Por enquanto devolve 501 informando o que falta.
  return NextResponse.json(
    {
      error: "Integração com o provedor ainda não foi plugada. Veja TODO em src/app/api/assistentes/chat/route.ts.",
      provider,
      agente_id: body.agente_id,
    },
    { status: 501 },
  );

  // ---------------------------------------------------------------------------
  // Esqueleto das implementações — descomentar quando for tirar o mock.
  // ---------------------------------------------------------------------------
  //
  // const content = provider === "gemini"
  //   ? await callGemini(apiKey, body.agente_id, body.mensagens)
  //   : await callOpenAI(apiKey, body.agente_id, body.mensagens);
  //
  // return NextResponse.json({ provider, content });
}

// ---------------------------------------------------------------------------
// async function callGemini(apiKey: string, agenteId: string, msgs: ChatMensagemIn[]): Promise<string> {
//   // npm i @google/genai
//   // import { GoogleGenAI } from "@google/genai";
//   // const ai = new GoogleGenAI({ apiKey });
//   // const r = await ai.models.generateContent({
//   //   model: "gemini-2.0-flash",
//   //   contents: msgs.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
//   //   config: { systemInstruction: SYSTEM_PROMPT[agenteId] },
//   // });
//   // return r.text ?? "";
//   throw new Error("not implemented");
// }
//
// async function callOpenAI(apiKey: string, agenteId: string, msgs: ChatMensagemIn[]): Promise<string> {
//   // npm i openai
//   // import OpenAI from "openai";
//   // const client = new OpenAI({ apiKey });
//   // const r = await client.chat.completions.create({
//   //   model: "gpt-4o-mini",
//   //   messages: [{ role: "system", content: SYSTEM_PROMPT[agenteId] }, ...msgs],
//   // });
//   // return r.choices[0]?.message?.content ?? "";
//   throw new Error("not implemented");
// }
