// GET /api/pdfmonkey/status?document_id=<id>&geracao_id=<uuid>
//
// Faz polling do status do documento no PDFMonkey e, se status mudou,
// atualiza a linha em pdfmonkey_geracoes. Retorna o estado atual.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { autorizarApi } from "@/lib/acessos/servidor";
import { fetchDocument, isPdfMonkeyEnabled, PdfMonkeyApiError } from "@/lib/pdfmonkey/client";

export async function GET(req: NextRequest) {
  // Mesmos módulos que geram PDF (ver /api/pdfmonkey/generate).
  const auth = await autorizarApi({ modulos: ["relatorios", "financeiro", "distribuicao"] });
  if (!auth.ok) return auth.resposta;

  const url = new URL(req.url);
  const documentId = url.searchParams.get("document_id");
  const geracaoId  = url.searchParams.get("geracao_id");
  if (!documentId) {
    return NextResponse.json({ error: "document_id obrigatório" }, { status: 400 });
  }
  if (!isPdfMonkeyEnabled()) {
    return NextResponse.json({ error: "PDFMonkey ainda não configurado" }, { status: 503 });
  }

  try {
    const doc = await fetchDocument(documentId);
    if (geracaoId) {
      // Histórico gravado pelo servidor (quem só tem leitura também acompanha).
      await createAdminClient()
        .from("pdfmonkey_geracoes")
        .update({
          status:       doc.status,
          download_url: doc.download_url,
          erro:         doc.failure_cause ?? null,
        })
        .eq("id", geracaoId);
    }
    return NextResponse.json({
      document_id:  doc.id,
      status:       doc.status,
      download_url: doc.download_url,
      filename:     doc.filename,
      failure_cause: doc.failure_cause,
    });
  } catch (e) {
    const msg = e instanceof PdfMonkeyApiError
      ? `PDFMonkey ${e.status}: ${JSON.stringify(e.body).slice(0, 500)}`
      : (e as Error).message;
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
