// Wrappers finos sobre os SDKs Gemini e OpenAI — agora com suporte a
// function calling (tools). O loop de chamada de ferramenta acontece dentro
// destes wrappers: o caller só fornece o conjunto de tools e um onToolCall.
//
// Server-only: NÃO importar deste arquivo a partir de Client Components.

import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import type { ChatRole, IAProvider } from "@/types";
import type { ToolDefinition } from "@/lib/ai/tools";

/** Arquivo que vai junto com uma mensagem do usuário (PDF ou imagem). */
export interface AIAnexo {
  nome:   string;       // nome original — vira o filename do PDF na OpenAI
  mime:   string;       // application/pdf | image/png | image/jpeg | image/webp
  base64: string;       // conteúdo cru em base64, sem o prefixo "data:"
}

export interface AIMensagem {
  role: ChatRole;       // "user" | "assistant" | "system"
  content: string;
  /** Só em mensagens do usuário. Vai ao modelo antes do texto. */
  anexos?: AIAnexo[];
}

export interface AICallOptions {
  systemPrompt: string;
  temperatura:  number;
  maxOutputTokens?: number;
  /** Catálogo de tools disponíveis. Vazio = chat puro. */
  tools?: ToolDefinition[];
  /** Executor das tools — recebe (name, args) e devolve um valor JSON-serializável (ou { error: string }). */
  onToolCall?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Limite de iterações de tool calling por turno (proteção contra loops). */
  maxIterations?: number;
}

export interface AICallResult {
  content: string;
  tokens_input?:  number;
  tokens_output?: number;
}

// Modelos padrão. Mantém em um lugar só pra trocar facilmente quando precisar.
export const GEMINI_MODEL = "gemini-2.5-flash";
export const OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_MAX_TOKENS  = 2048;
const DEFAULT_MAX_ITERS   = 5;

export function modelForProvider(provider: IAProvider): string {
  return provider === "gemini" ? GEMINI_MODEL : OPENAI_MODEL;
}

// ===========================================================================
// Gemini — @google/genai
// ===========================================================================
// O SDK retorna response.functionCalls quando o modelo decide chamar uma tool.
// Devolvemos o resultado como um Content com role:"user" e parts:[{functionResponse}].
// O modelo continua até retornar text puro ou batermos no maxIterations.

interface GeminiContent {
  role: "user" | "model";
  parts: Array<
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
    | { functionCall: { name: string; args?: Record<string, unknown>; id?: string } }
    | { functionResponse: { name: string; response: Record<string, unknown>; id?: string } }
  >;
}

async function callGemini(
  apiKey: string,
  msgs: AIMensagem[],
  opts: AICallOptions,
): Promise<AICallResult> {
  const ai = new GoogleGenAI({ apiKey });

  // History: só user/assistant. System vai como systemInstruction.
  // Anexos (PDF/imagem) entram como inlineData ANTES do texto da mensagem.
  const contents: GeminiContent[] = msgs
    .filter(m => m.role === "user" || m.role === "assistant")
    .map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [
        ...(m.role === "user" ? m.anexos ?? [] : []).map(a => ({
          inlineData: { mimeType: a.mime, data: a.base64 },
        })),
        { text: m.content },
      ],
    }));

  const tools = opts.tools && opts.tools.length
    ? [{
        functionDeclarations: opts.tools.map(t => ({
          name: t.name,
          description: t.description,
          parametersJsonSchema: t.parameters,
        })),
      }]
    : undefined;

  let tokensIn  = 0;
  let tokensOut = 0;
  const maxIters = opts.maxIterations ?? DEFAULT_MAX_ITERS;

  for (let iter = 0; iter < maxIters; iter++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: contents as any,
      config: {
        systemInstruction: opts.systemPrompt || undefined,
        temperature: opts.temperatura,
        maxOutputTokens: opts.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: tools as any,
      },
    });

    const usage = response.usageMetadata;
    if (usage?.promptTokenCount)     tokensIn  += usage.promptTokenCount;
    if (usage?.candidatesTokenCount) tokensOut += usage.candidatesTokenCount;

    const fnCalls = response.functionCalls ?? [];
    if (!fnCalls.length || !opts.onToolCall) {
      // Sem mais chamadas — retorna o texto final.
      const text = (response.text ?? "").trim();
      return { content: text, tokens_input: tokensIn, tokens_output: tokensOut };
    }

    // Acumula o "model" turn (com as chamadas) e o "user" turn (com as respostas).
    contents.push({
      role: "model",
      parts: fnCalls.map(fc => ({
        functionCall: { name: fc.name ?? "", args: fc.args ?? {}, id: fc.id },
      })),
    });

    const responseParts: GeminiContent["parts"] = [];
    for (const fc of fnCalls) {
      const args = (fc.args ?? {}) as Record<string, unknown>;
      let resultado: unknown;
      try {
        resultado = await opts.onToolCall(fc.name ?? "", args);
      } catch (e) {
        resultado = { error: e instanceof Error ? e.message : String(e) };
      }
      responseParts.push({
        functionResponse: {
          name: fc.name ?? "",
          response: wrapResponse(resultado),
          id: fc.id,
        },
      });
    }
    contents.push({ role: "user", parts: responseParts });
  }

  // Estourou maxIterations sem o modelo concluir.
  return {
    content: "Não consegui finalizar a resposta dentro do limite de consultas. Reformule a pergunta.",
    tokens_input: tokensIn,
    tokens_output: tokensOut,
  };
}

// Gemini exige que functionResponse.response seja um Record<string, unknown>.
// Se o handler devolveu primitive/array, embrulhamos em { result: ... }.
function wrapResponse(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return { result: v };
}

// ===========================================================================
// OpenAI — openai SDK
// ===========================================================================
async function callOpenAI(
  apiKey: string,
  msgs: AIMensagem[],
  opts: AICallOptions,
): Promise<AICallResult> {
  const client = new OpenAI({ apiKey });

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  if (opts.systemPrompt) messages.push({ role: "system", content: opts.systemPrompt });
  for (const m of msgs) {
    if (m.role === "system") continue;
    if (m.role === "user" && m.anexos?.length) {
      messages.push({ role: "user", content: [...m.anexos.map(parteOpenAI), { type: "text", text: m.content }] });
      continue;
    }
    messages.push({ role: m.role, content: m.content });
  }

  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined =
    opts.tools && opts.tools.length
      ? opts.tools.map(t => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            parameters: t.parameters as any,
          },
        }))
      : undefined;

  let tokensIn  = 0;
  let tokensOut = 0;
  const maxIters = opts.maxIterations ?? DEFAULT_MAX_ITERS;

  for (let iter = 0; iter < maxIters; iter++) {
    const completion = await client.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: opts.temperatura,
      max_tokens: opts.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
      messages,
      tools,
      tool_choice: tools ? "auto" : undefined,
    });

    if (completion.usage) {
      tokensIn  += completion.usage.prompt_tokens     ?? 0;
      tokensOut += completion.usage.completion_tokens ?? 0;
    }

    const choice = completion.choices[0];
    const assistantMsg = choice?.message;
    if (!assistantMsg) {
      return { content: "", tokens_input: tokensIn, tokens_output: tokensOut };
    }

    const toolCalls = assistantMsg.tool_calls ?? [];
    if (!toolCalls.length || !opts.onToolCall) {
      return {
        content: (assistantMsg.content ?? "").trim(),
        tokens_input: tokensIn,
        tokens_output: tokensOut,
      };
    }

    // Append assistant turn (sem content, só tool_calls).
    messages.push({
      role: "assistant",
      content: assistantMsg.content ?? null,
      tool_calls: toolCalls,
    });

    for (const tc of toolCalls) {
      if (tc.type !== "function") continue;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      let resultado: unknown;
      try {
        resultado = await opts.onToolCall(tc.function.name, args);
      } catch (e) {
        resultado = { error: e instanceof Error ? e.message : String(e) };
      }
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(resultado),
      });
    }
  }

  return {
    content: "Não consegui finalizar a resposta dentro do limite de consultas. Reformule a pergunta.",
    tokens_input: tokensIn,
    tokens_output: tokensOut,
  };
}

// PDF vai como `file` (base64 em data URL, com filename); imagem como `image_url`.
function parteOpenAI(a: AIAnexo): OpenAI.Chat.Completions.ChatCompletionContentPart {
  const dataUrl = `data:${a.mime};base64,${a.base64}`;
  if (a.mime === "application/pdf") {
    const filename = /\.pdf$/i.test(a.nome) ? a.nome : `${a.nome}.pdf`;
    return { type: "file", file: { filename, file_data: dataUrl } };
  }
  return { type: "image_url", image_url: { url: dataUrl } };
}

// ===========================================================================
// Dispatcher
// ===========================================================================
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
