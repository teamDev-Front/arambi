// Wrappers finos sobre os SDKs Gemini e OpenAI.
// Server-only: NÃO importar deste arquivo a partir de Client Components.

import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import type { ChatRole, IAProvider } from "@/types";

export interface AIMensagem {
  role: ChatRole;       // "user" | "assistant" | "system"
  content: string;
}

export interface AICallOptions {
  systemPrompt: string;
  temperatura: number;  // 0..1 (Gemini também aceita 0..2, mas normalizamos em 0..1)
  maxOutputTokens?: number;
}

export interface AICallResult {
  content: string;
  tokens_input?: number;
  tokens_output?: number;
}

// Modelos padrão. Mantém em um lugar só pra trocar facilmente quando precisar.
export const GEMINI_MODEL = "gemini-2.5-flash";
export const OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_MAX_TOKENS = 2048;

export function modelForProvider(provider: IAProvider): string {
  return provider === "gemini" ? GEMINI_MODEL : OPENAI_MODEL;
}

// ---------------------------------------------------------------------------
// Gemini — @google/genai
// ---------------------------------------------------------------------------
async function callGemini(
  apiKey: string,
  msgs: AIMensagem[],
  opts: AICallOptions,
): Promise<AICallResult> {
  const ai = new GoogleGenAI({ apiKey });

  // Gemini exige histórico em formato { role: "user" | "model", parts: [{ text }] }.
  // Mensagens "system" do histórico do banco não vão pra cá — system instruction
  // é o segundo argumento de config.systemInstruction.
  const contents = msgs
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents,
    config: {
      systemInstruction: opts.systemPrompt || undefined,
      temperature: opts.temperatura,
      maxOutputTokens: opts.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
    },
  });

  const content = (response.text ?? "").trim();
  const usage = response.usageMetadata;
  return {
    content,
    tokens_input: usage?.promptTokenCount ?? undefined,
    tokens_output: usage?.candidatesTokenCount ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// OpenAI — openai SDK
// ---------------------------------------------------------------------------
async function callOpenAI(
  apiKey: string,
  msgs: AIMensagem[],
  opts: AICallOptions,
): Promise<AICallResult> {
  const client = new OpenAI({ apiKey });

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  if (opts.systemPrompt) {
    messages.push({ role: "system", content: opts.systemPrompt });
  }
  for (const m of msgs) {
    if (m.role === "system") continue;       // system só vem do agente, não do histórico
    messages.push({ role: m.role, content: m.content });
  }

  const completion = await client.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: opts.temperatura,
    max_tokens: opts.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
    messages,
  });

  const content = (completion.choices[0]?.message?.content ?? "").trim();
  return {
    content,
    tokens_input: completion.usage?.prompt_tokens ?? undefined,
    tokens_output: completion.usage?.completion_tokens ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------
export async function callProvider(
  provider: IAProvider,
  apiKey: string,
  msgs: AIMensagem[],
  opts: AICallOptions,
): Promise<AICallResult> {
  switch (provider) {
    case "gemini": return callGemini(apiKey, msgs, opts);
    case "openai": return callOpenAI(apiKey, msgs, opts);
  }
}
