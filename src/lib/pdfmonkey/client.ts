// Cliente do PDFMonkey (server-only).
// Encapsula chamadas REST à API v1 (https://pdfmonkey.io/docs/api).
//
// Credenciais (.env.local):
//   PDFMONKEY_API_KEY=<bearer>
//   PDFMONKEY_TEMPLATE_CAPA_EMPRESA=<uuid>
//   PDFMONKEY_TEMPLATE_CAPA_SOCIO=<uuid>
//   PDFMONKEY_TEMPLATE_RELATORIO_CONTABIL=<uuid>
//   PDFMONKEY_TEMPLATE_RELATORIO_SOCIOS=<uuid>
//
// As variáveis NÃO levam prefixo NEXT_PUBLIC_ — só rodam server-side.

import "server-only";
import type { PdfMonkeySlug } from "@/types";
import type { AnyPayload } from "./types";
import { payloadToJson } from "./types";

const API_BASE = "https://api.pdfmonkey.io/api/v1";

export class PdfMonkeyConfigError extends Error {
  constructor(missing: string) {
    super(`PDFMonkey não configurado: variável ${missing} ausente no .env.local`);
    this.name = "PdfMonkeyConfigError";
  }
}

export class PdfMonkeyApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`PDFMonkey retornou ${status}`);
    this.name = "PdfMonkeyApiError";
  }
}

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new PdfMonkeyConfigError(key);
  return v;
}

export function getTemplateIdForSlug(slug: PdfMonkeySlug): string {
  const map: Record<PdfMonkeySlug, string> = {
    capa_empresa:       "PDFMONKEY_TEMPLATE_CAPA_EMPRESA",
    capa_socio:         "PDFMONKEY_TEMPLATE_CAPA_SOCIO",
    relatorio_contabil: "PDFMONKEY_TEMPLATE_RELATORIO_CONTABIL",
    relatorio_socios:   "PDFMONKEY_TEMPLATE_RELATORIO_SOCIOS",
  };
  return requireEnv(map[slug]);
}

export interface PdfMonkeyDocument {
  id: string;
  status: "draft" | "pending" | "generating" | "success" | "failure";
  document_template_id: string;
  download_url: string | null;
  preview_url: string | null;
  filename: string | null;
  meta: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  app_id: string | null;
  failure_cause: string | null;
}

/**
 * Cria um documento no PDFMonkey já em estado "pending" — a geração é
 * processada de forma assíncrona. O endpoint retorna o documento com seu id;
 * o `download_url` fica null até o status virar "success".
 *
 * Use {@link fetchDocument} para polling do status.
 */
export async function createDocument(
  slug: PdfMonkeySlug,
  payload: AnyPayload,
  opts?: { meta?: Record<string, unknown>; status?: "draft" | "pending" },
): Promise<PdfMonkeyDocument> {
  const apiKey = requireEnv("PDFMONKEY_API_KEY");
  const templateId = getTemplateIdForSlug(slug);
  const body = {
    document: {
      document_template_id: templateId,
      status: opts?.status ?? "pending",
      payload: payloadToJson(payload),
      meta: opts?.meta ?? { _filename: `${slug}.pdf` },
    },
  };
  const res = await fetch(`${API_BASE}/documents`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
      "Accept":        "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new PdfMonkeyApiError(res.status, json);
  return (json?.document ?? json) as PdfMonkeyDocument;
}

/**
 * Recupera um documento previamente criado (útil para polling após "pending").
 */
export async function fetchDocument(documentId: string): Promise<PdfMonkeyDocument> {
  const apiKey = requireEnv("PDFMONKEY_API_KEY");
  const res = await fetch(`${API_BASE}/documents/${documentId}`, {
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Accept":        "application/json",
    },
    cache: "no-store",
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new PdfMonkeyApiError(res.status, json);
  return (json?.document ?? json) as PdfMonkeyDocument;
}

/**
 * Quando NEXT_PUBLIC_PDFMONKEY_DEBUG=1, podemos pular a chamada real e
 * retornar um documento mock — útil enquanto a conta PDFMonkey volta do plano
 * grátis (problema que a Lola relatou na reunião 15/05).
 */
export function isPdfMonkeyEnabled(): boolean {
  return !!process.env.PDFMONKEY_API_KEY;
}
