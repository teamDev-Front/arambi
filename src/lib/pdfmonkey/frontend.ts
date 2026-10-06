// Cliente browser-side para os endpoints /api/pdfmonkey/*

import type { PdfMonkeySlug } from "@/types";
import type { ContabilObservacao, RelatorioSociosOverrides, ReportScope } from "./types";

export interface GerarPdfArgs {
  slug: PdfMonkeySlug;
  mes_referencia: string;        // "YYYY-MM"
  socio_id?: string;             // só p/ capa_socio
  observacoes?: ContabilObservacao[];        // só p/ relatorio_contabil
  socios_overrides?: RelatorioSociosOverrides; // só p/ relatorio_socios
  /** Recorte (RF-FIN-09): capa_empresa e relatorio_contabil respeitam filtros/seleção. */
  scope?: ReportScope;
  /** Selo dourado — número informado manualmente, ex.: "7º" (capa_empresa e capa_socio). */
  numero_lote?: string;
  /** Selo dourado — mês de referência informado manualmente, ex.: "Julho" (capa_empresa e capa_socio). */
  mes_referencia_label?: string;
}

export interface GerarPdfResult {
  document_id: string;
  status: "draft" | "pending" | "generating" | "success" | "failure";
  download_url: string | null;
  geracao_id: string;
}

export async function gerarPdf(args: GerarPdfArgs): Promise<GerarPdfResult> {
  const res = await fetch("/api/pdfmonkey/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return json as GerarPdfResult;
}

export async function consultarStatus(documentId: string, geracaoId?: string): Promise<GerarPdfResult & { failure_cause: string | null }> {
  const u = new URL("/api/pdfmonkey/status", window.location.origin);
  u.searchParams.set("document_id", documentId);
  if (geracaoId) u.searchParams.set("geracao_id", geracaoId);
  const res = await fetch(u.toString());
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return json;
}

/**
 * Gera um PDF e faz polling até concluir (sucesso/falha) ou timeout.
 * Útil pro botão "baixar agora" — o usuário fica esperando o link.
 */
export async function gerarPdfBloqueante(
  args: GerarPdfArgs,
  opts?: { timeoutMs?: number; intervalMs?: number },
): Promise<GerarPdfResult & { failure_cause?: string | null }> {
  const timeoutMs  = opts?.timeoutMs  ?? 60_000;
  const intervalMs = opts?.intervalMs ?? 2_000;
  const inicio = await gerarPdf(args);
  if (inicio.status === "success" || inicio.status === "failure") return inicio;

  const t0 = Date.now();
  let last: GerarPdfResult & { failure_cause?: string | null } = inicio;
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
    last = await consultarStatus(inicio.document_id, inicio.geracao_id);
    if (last.status === "success" || last.status === "failure") return last;
  }
  return last;
}
