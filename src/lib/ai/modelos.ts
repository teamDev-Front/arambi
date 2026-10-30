// Catálogo dos modelos que os assistentes podem usar (29-out-2026, migration 0067).
//
// A lista vem AO VIVO da conta de cada provedor (/api/assistentes/modelos): a
// OpenAI lança modelo novo o tempo todo e uma lista fixa no código envelheceria.
// Aqui ficam só as regras:
//   • o padrão de cada provedor (o de sempre, antes da 0067);
//   • o que é modelo de conversa: fora áudio, imagem, embeddings e os que só
//     rodam pela Responses API — o chat usa a Chat Completions;
//   • a ordem e os grupos do seletor (mais novo primeiro).
//
// Isomórfico: usado pela rota (servidor), por providers.ts e pelo modal.

import type { IAProvider } from "@/types";

/** Modelo usado quando nada foi escolhido — o de sempre, antes da 0067. */
export const MODELO_PADRAO: Readonly<Record<IAProvider, string>> = {
  openai: "gpt-4o-mini",
  gemini: "gemini-2.5-flash",
};

/** Formato de um id de modelo. Vem do banco/da requisição: não é confiável. */
const RE_ID_MODELO = /^[a-z0-9][a-z0-9._:-]{1,80}$/i;

export function idModeloValido(id: unknown): id is string {
  return typeof id === "string" && RE_ID_MODELO.test(id);
}

/** Modelo que de fato responde: o escolhido (se válido) ou o padrão do provedor. */
export function modeloEfetivo(provider: IAProvider, escolhido: string | null | undefined): string {
  const m = escolhido?.trim();
  return m && idModeloValido(m) ? m : MODELO_PADRAO[provider];
}

/**
 * Modelo de raciocínio da OpenAI (série "o" e GPT-5 em diante): não aceita
 * `temperature` e gasta parte do orçamento de tokens pensando antes de
 * responder. Os "chat" (ex.: gpt-5-chat-latest) são de conversa comum.
 */
export function ehModeloDeRaciocinioOpenAI(id: string): boolean {
  if (/^o\d/i.test(id)) return true;
  const v = /^gpt-(\d+)/i.exec(id);
  return !!v && Number(v[1]) >= 5 && !/chat/i.test(id);
}

/** Opção do seletor: `grupo` vira o <optgroup>; `nota`, uma dica curta ao lado do nome. */
export interface ModeloOpcao {
  id: string;
  grupo: string;
  nota?: string;
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

// Fora do seletor: não conversam (áudio, voz, imagem, vídeo, embeddings,
// moderação), só rodam pela Responses API (pro, codex, busca, deep research,
// computer use) ou são de completions legado.
const RE_OPENAI_FORA = new RegExp([
  "audio", "realtime", "tts", "transcribe", "whisper", "image", "dall-e", "sora",
  "embedding", "moderation", "search", "codex", "computer-use", "deep-research",
  "instruct", "live", "translate", "-pro\\b", "-16k", "babbage", "davinci",
].join("|"), "i");
// Snapshot datado ("gpt-4o-2024-08-06", "gpt-4-0613"): o nome sem data já aponta
// para o mais novo da linha.
const RE_SNAPSHOT = /-(\d{4}-\d{2}-\d{2}|\d{4})$/;
// Ainda aparecem em /v1/models, mas respondem 404 "has been deprecated" (testado
// ao vivo em 29-out-2026). Um descontinuado depois disso cai no aviso do chat
// ("…foi descontinuado. Escolha outro") — basta acrescentá-lo aqui.
const OPENAI_DESCONTINUADOS = new Set([
  "gpt-3.5-turbo", "gpt-4", "gpt-4-turbo", "gpt-4.1-nano", "o1", "o3-mini", "o4-mini",
]);
// Só raciocinam (reasoning_effort a partir de "low", sem "none") e, raciocinando,
// a Chat Completions não aceita tools — os assistentes consultam o banco por
// tools. Funcionariam pela Responses API (testado ao vivo em 29-out-2026).
const OPENAI_SO_RESPONSES = new Set(["gpt-6-astra", "gpt-6.1-sol"]);

export function ehModeloDeConversaOpenAI(id: string): boolean {
  if (!/^(gpt-|o\d)/i.test(id)) return false;
  const k = id.toLowerCase();
  if (OPENAI_DESCONTINUADOS.has(k) || OPENAI_SO_RESPONSES.has(k)) return false;
  if (RE_OPENAI_FORA.test(id) || RE_SNAPSHOT.test(id)) return false;
  // "*-chat-latest" é o ponteiro do ChatGPT: muda de modelo sem aviso.
  return !/chat-latest$/i.test(id);
}

/** gpt-6.1 → 6.1 · gpt-4o → 4.05 (entre o 4 e o 4.1) · gpt-4-turbo → 4.01. */
function versaoGpt(id: string): number {
  if (/^gpt-4o/i.test(id)) return 4.05;
  if (/^gpt-4-turbo/i.test(id)) return 4.01;
  const v = /^gpt-(\d+(?:\.\d+)?)/i.exec(id);
  return v ? Number(v[1]) : 0;
}

function grupoOpenAI(id: string): string {
  if (/^o\d/i.test(id)) return "Raciocínio (série o)";
  const v = versaoGpt(id);
  if (v >= 6) return "GPT-6";
  if (v >= 5) return "GPT-5";
  if (v >= 4) return "GPT-4";
  return "Mais antigos";
}

const ORDEM_GRUPOS_OPENAI = ["GPT-6", "GPT-5", "GPT-4", "Raciocínio (série o)", "Mais antigos"];

/** Variante dentro da mesma versão: o nome cheio primeiro, depois mini, nano e o resto. */
function pesoVariante(id: string): number {
  if (/-mini$/i.test(id)) return 1;
  if (/-nano$/i.test(id)) return 2;
  return /^(gpt-\d+(\.\d+)?|gpt-4o|o\d)$/i.test(id) ? 0 : 3;
}

export function catalogoOpenAI(ids: string[]): ModeloOpcao[] {
  return Array.from(new Set(ids.filter(ehModeloDeConversaOpenAI)))
    .map((id): ModeloOpcao => ({
      id,
      grupo: grupoOpenAI(id),
      nota: id === MODELO_PADRAO.openai ? "padrão" : undefined,
    }))
    .sort((a, b) =>
      ORDEM_GRUPOS_OPENAI.indexOf(a.grupo) - ORDEM_GRUPOS_OPENAI.indexOf(b.grupo)
      || versaoOuSerieO(b.id) - versaoOuSerieO(a.id)
      || pesoVariante(a.id) - pesoVariante(b.id)
      || a.id.localeCompare(b.id));
}

/** o4-mini → 4 · o3 → 3 (série o: a mais nova primeiro, como no GPT). */
function versaoOuSerieO(id: string): number {
  const o = /^o(\d+)/i.exec(id);
  return o ? Number(o[1]) : versaoGpt(id);
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

const RE_GEMINI_FORA = /(embedding|tts|image|aqa|live|native-audio|computer-use|robotics|vision)/i;

export function catalogoGemini(ids: string[]): ModeloOpcao[] {
  const versao = (id: string) => Number(/^gemini-(\d+(?:\.\d+)?)/i.exec(id)?.[1] ?? 0);
  return Array.from(new Set(ids))
    .filter((id) => /^gemini-/i.test(id) && !RE_GEMINI_FORA.test(id) && !/-\d{3}$/.test(id))
    .map((id): ModeloOpcao => ({
      id,
      grupo: `Gemini ${Math.floor(versao(id)) || ""}`.trim(),
      nota: id === MODELO_PADRAO.gemini ? "padrão" : undefined,
    }))
    .sort((a, b) => versao(b.id) - versao(a.id) || a.id.localeCompare(b.id));
}
