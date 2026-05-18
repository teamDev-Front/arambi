// Queries do módulo Documentos (recibos e termos gerados via código).
// Lista paginada com busca/filtros + helpers para gerar e baixar PDFs.

import { createClient } from "@/lib/supabase/client";
import type { DocumentoGeradoRow, DocumentoGeradoTipo } from "@/types";
import type { DocumentoPayloadMap } from "@/lib/pdf";

export interface ListarDocumentosFiltros {
  search?: string;
  tipo?: DocumentoGeradoTipo | "";
  mes?: string;        // "YYYY-MM"
  page?: number;
  pageSize?: number;
}

export interface ListarDocumentosResult {
  rows: DocumentoGeradoRow[];
  total: number;
}

export async function listarDocumentosGerados(f: ListarDocumentosFiltros = {}): Promise<ListarDocumentosResult> {
  const supabase = createClient();
  const page     = f.page     ?? 1;
  const pageSize = f.pageSize ?? 10;
  const from = (page - 1) * pageSize;
  const to   = from + pageSize - 1;

  let q = supabase
    .from("documentos_gerados")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (f.tipo) q = q.eq("tipo", f.tipo);
  if (f.mes)  q = q.eq("mes_referencia", f.mes);
  if (f.search && f.search.trim()) {
    const term = f.search.trim().replace(/[%_]/g, "\\$&");
    q = q.or(
      `beneficiario.ilike.%${term}%,descricao.ilike.%${term}%,numero.ilike.%${term}%`
    );
  }

  const { data, count, error } = await q;
  if (error) throw error;

  return {
    rows: (data ?? []) as DocumentoGeradoRow[],
    total: count ?? 0,
  };
}

export async function listarMesesDistintos(): Promise<string[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("documentos_gerados")
    .select("mes_referencia")
    .not("mes_referencia", "is", null);
  if (error) throw error;
  const set = new Set<string>();
  for (const r of data ?? []) if (r.mes_referencia) set.add(r.mes_referencia);
  return [...set].sort().reverse();
}

export interface GerarDocumentoResponse {
  id: string;
  pdf_path: string;
  download_url: string | null;
  filename: string;
}

export async function gerarDocumento<T extends DocumentoGeradoTipo>(
  tipo: T,
  dados: DocumentoPayloadMap[T],
): Promise<GerarDocumentoResponse> {
  const res = await fetch("/api/documentos/gerar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tipo, dados }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Falha ao gerar (${res.status})`);
  }
  return res.json();
}

export async function obterUrlDownload(id: string): Promise<{ download_url: string; filename: string }> {
  const res = await fetch(`/api/documentos/${id}/download`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Falha ao obter URL (${res.status})`);
  }
  return res.json();
}

export async function excluirDocumento(id: string): Promise<void> {
  const res = await fetch(`/api/documentos/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Falha ao excluir (${res.status})`);
  }
}
