// GET /api/assistentes/modelos?provider=openai|gemini
//
// Modelos de conversa que a chave SALVA do provedor enxerga — alimenta o
// seletor de modelo do modal "Configuração das IAs" (29-out-2026, migration
// 0067). A lista vem ao vivo do provedor (GET /models, sem custo), filtrada e
// ordenada por lib/ai/modelos.ts: a OpenAI lança modelo novo o tempo todo.
//
// Só quem EDITA os Assistentes: a chave é lida com service role, como no chat.
//
// Response 200: { provider, padrao, modelos: [{ id, grupo, nota? }] }
// Erros: 400 provider inválido · 401/403 acesso · 424 sem chave · 500 Supabase · 502 provedor

import { NextResponse, type NextRequest } from "next/server";
import { autorizarApi } from "@/lib/acessos/servidor";
import { createAdminClient } from "@/lib/supabase/admin";
import { listarModelosDoProvedor } from "@/lib/ai/providers";
import { MODELO_PADRAO, catalogoGemini, catalogoOpenAI } from "@/lib/ai/modelos";
import type { IAProvider } from "@/types";

export async function GET(req: NextRequest) {
  const param = req.nextUrl.searchParams.get("provider");
  if (param !== "openai" && param !== "gemini") {
    return NextResponse.json({ error: "provider deve ser openai ou gemini." }, { status: 400 });
  }
  const provider: IAProvider = param;

  const auth = await autorizarApi({ modulos: ["assistentes"], nivel: "edicao" });
  if (!auth.ok) return auth.resposta;

  const { data, error } = await createAdminClient()
    .from("config_ia")
    .select("gemini_api_key, openai_api_key")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: `Falha ao ler configuração das IAs: ${error.message}` }, { status: 500 });
  }

  const apiKey = provider === "gemini" ? data?.gemini_api_key : data?.openai_api_key;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Salve a chave deste provedor para ver os modelos da conta." },
      { status: 424 },
    );
  }

  try {
    const ids = await listarModelosDoProvedor(provider, apiKey);
    return NextResponse.json({
      provider,
      padrao: MODELO_PADRAO[provider],
      modelos: provider === "openai" ? catalogoOpenAI(ids) : catalogoGemini(ids),
    });
  } catch (e) {
    console.error(`[modelos] ${provider} falhou: ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json(
      { error: "Não foi possível consultar os modelos agora. Confira a chave e tente de novo." },
      { status: 502 },
    );
  }
}
