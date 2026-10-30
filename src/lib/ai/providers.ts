// Wrappers finos sobre os SDKs Gemini e OpenAI — agora com suporte a
// function calling (tools). O loop de chamada de ferramenta acontece dentro
// destes wrappers: o caller só fornece o conjunto de tools e um onToolCall.
//
// Server-only: NÃO importar deste arquivo a partir de Client Components.

import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import type { ChatRole, IAProvider } from "@/types";
import type { ToolDefinition } from "@/lib/ai/tools";
import { MODELO_PADRAO, ehModeloDeRaciocinioOpenAI, modeloEfetivo } from "@/lib/ai/modelos";

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
  /** Modelo do provedor (config_ia, 0067). Ausente = padrão (MODELO_PADRAO). */
  model?: string;
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

// Modelos padrão — os de sempre. Desde a 0067 a engrenagem dos Assistentes
// escolhe outro; a regra (padrão, formato válido) mora em lib/ai/modelos.ts.
export const GEMINI_MODEL = MODELO_PADRAO.gemini;
export const OPENAI_MODEL = MODELO_PADRAO.openai;
const DEFAULT_MAX_TOKENS  = 2048;
const DEFAULT_MAX_ITERS   = 5;
// Modelo de raciocínio pensa dentro do mesmo orçamento da resposta: com 2048
// tokens ele pode gastar tudo pensando e devolver texto vazio. Paga-se só o usado.
const ORCAMENTO_RACIOCINIO = 16_000;
// Pensam em esforço "médio" por padrão — lento demais para um chat com
// consultas ao banco (tools). Os mais novos já vêm rápidos e ficam como estão.
const RE_ESFORCO_PADRAO_MEDIO = /^(o1|o3|o3-mini|o4-mini|gpt-5|gpt-5-mini|gpt-5-nano)$/i;
// Na Chat Completions, só aceitam tools com reasoning_effort "none" (testado ao
// vivo em 29-out-2026: "To use function tools, use /v1/responses or set
// reasoning_effort to 'none'"). Modelo novo com a mesma regra é pego pela
// recusa em criarCompletion — esta lista só poupa a primeira chamada perdida.
const RE_TOOLS_SO_SEM_RACIOCINIO = /^gpt-(6|5\.6)/i;

/** Modelo que responde: o escolhido em config_ia (0067), se válido, senão o padrão. */
export function modelForProvider(provider: IAProvider, escolhido?: string | null): string {
  return modeloEfetivo(provider, escolhido);
}

/**
 * Ids dos modelos que a chave enxerga — GET /models do provedor, sem custo.
 * O filtro do que serve ao chat fica em lib/ai/modelos.ts (catalogo*).
 */
export async function listarModelosDoProvedor(provider: IAProvider, apiKey: string): Promise<string[]> {
  const ids: string[] = [];
  if (provider === "openai") {
    for await (const m of new OpenAI({ apiKey }).models.list()) ids.push(m.id);
    return ids;
  }
  const pager = await new GoogleGenAI({ apiKey }).models.list({ config: { pageSize: 200 } });
  for await (const m of pager) {
    if (!m.name || (m.supportedActions && !m.supportedActions.includes("generateContent"))) continue;
    ids.push(m.name.replace(/^models\//, ""));
  }
  return ids;
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
    const response = await ai.models.generateContent({
      model: opts.model || GEMINI_MODEL,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  const model = opts.model || OPENAI_MODEL;
  const raciocinio = ehModeloDeRaciocinioOpenAI(model);
  const limite = opts.maxOutputTokens ?? DEFAULT_MAX_TOKENS;
  // Parâmetros que nem todo modelo aceita (0067): o de raciocínio recusa
  // temperature; o esforço vai "low" para quem pensa "médio" por padrão e
  // "none" para quem só aceita tools assim. Se o modelo recusar algum, ele sai
  // e a chamada é refeita (criarCompletion).
  const opcionais: Record<string, unknown> = {};
  if (!raciocinio) opcionais.temperature = opts.temperatura;
  if (RE_ESFORCO_PADRAO_MEDIO.test(model)) opcionais.reasoning_effort = "low";
  if (tools && RE_TOOLS_SO_SEM_RACIOCINIO.test(model)) opcionais.reasoning_effort = "none";

  for (let iter = 0; iter < maxIters; iter++) {
    const completion = await criarCompletion(client, {
      model,
      // max_tokens está obsoleto e os modelos de raciocínio o recusam.
      max_completion_tokens: raciocinio ? Math.max(limite, ORCAMENTO_RACIOCINIO) : limite,
      messages,
      tools,
      tool_choice: tools ? "auto" : undefined,
    }, opcionais);

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

/**
 * chat.completions.create com os parâmetros opcionais, adaptando-se ao modelo:
 *   • pediu reasoning_effort "none" para usar tools (GPT-6 e cia.) → manda e refaz;
 *   • recusou um opcional (400 que cita o parâmetro — ex.: "Unsupported value:
 *     'temperature'") → tira e refaz.
 * `opcionais` guarda o ajuste para as próximas voltas do loop de tools; qualquer
 * outro erro sobe como antes. No máximo 3 ajustes por chamada.
 */
async function criarCompletion(
  client: OpenAI,
  base: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  opcionais: Record<string, unknown>,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  for (let ajustes = 0; ; ajustes++) {
    try {
      return await client.chat.completions.create(
        { ...base, ...opcionais } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      );
    } catch (e) {
      if (ajustes >= 3) throw e;
      if (pedeEsforcoNone(e) && opcionais.reasoning_effort !== "none") {
        opcionais.reasoning_effort = "none";
        continue;
      }
      const recusado = parametroRecusado(e, Object.keys(opcionais));
      if (!recusado) throw e;
      delete opcionais[recusado];
    }
  }
}

/** 400 "…use /v1/responses or set reasoning_effort to 'none'" (e não o "does not support 'none'"). */
function pedeEsforcoNone(e: unknown): boolean {
  if (!(e instanceof OpenAI.APIError) || e.status !== 400) return false;
  return (e.message ?? "").toLowerCase().includes("set reasoning_effort to 'none'");
}

function parametroRecusado(e: unknown, candidatos: string[]): string | null {
  if (!(e instanceof OpenAI.APIError) || e.status !== 400) return null;
  const msg = (e.message ?? "").toLowerCase();
  return candidatos.find((c) => e.param === c || msg.includes(`'${c}'`) || msg.includes(`"${c}"`)) ?? null;
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
