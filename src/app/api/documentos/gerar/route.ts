// POST /api/documentos/gerar
//
// Body:
//   {
//     "tipo":  "<DocumentoGeradoTipo>",
//     "dados": { ... payload do gerador ... }
//   }
//
// Response 200:
//   {
//     "id":          "<uuid>",
//     "pdf_path":    "<path no bucket>",
//     "download_url":"<signed URL temporária>",
//     "filename":    "<sugestão para o navegador>"
//   }

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { gerarDocumentoPdf, resumoDocumento, type DocumentoPayloadMap } from "@/lib/pdf";
import type { DocumentoGeradoTipo, Json } from "@/types";

const TIPOS_VALIDOS: DocumentoGeradoTipo[] = [
  "recibo_vale_combustivel",
  "recibo_aluguel",
  "recibo_pagamento_prestador",
  "termo_autorizacao_pagamento_terceiros",
  "termo_transferencia_bancaria",
  "contrato_prestacao_servicos",
];

const BUCKET = "documentos-gerados";
const DOWNLOAD_TTL_SEC = 60 * 10; // 10 minutos

function slugify(s: string): string {
  return s
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function POST(req: NextRequest) {
  let body: { tipo?: DocumentoGeradoTipo; dados?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  if (!body.tipo || !TIPOS_VALIDOS.includes(body.tipo)) {
    return NextResponse.json(
      { error: `tipo inválido. Use um de: ${TIPOS_VALIDOS.join(", ")}` },
      { status: 400 },
    );
  }
  if (!body.dados || typeof body.dados !== "object") {
    return NextResponse.json({ error: "dados (objeto) obrigatório" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const tipo  = body.tipo;
  const dados = body.dados as DocumentoPayloadMap[typeof tipo];

  // 1) Gera o PDF
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await gerarDocumentoPdf(tipo, dados);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Falha ao gerar PDF: ${msg}` }, { status: 500 });
  }

  // 2) Resumo (campos auxiliares para a tabela)
  const resumo = resumoDocumento(tipo, dados);

  // 3) Caminho no Storage — /yyyy/mm/<uuid>.pdf
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const docUuid = crypto.randomUUID();
  const baseName = slugify(resumo.beneficiario ?? tipo) || tipo;
  const pdfPath = `${y}/${m}/${docUuid}-${baseName}.pdf`;

  // 4) Upload
  const uploadBody = new Blob([pdfBytes as BlobPart], { type: "application/pdf" });
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(pdfPath, uploadBody, { contentType: "application/pdf", upsert: false });
  if (upErr) {
    return NextResponse.json(
      { error: `Falha ao salvar PDF no Storage: ${upErr.message}` },
      { status: 500 },
    );
  }

  // 5) Insere row
  const { data: row, error: insErr } = await supabase
    .from("documentos_gerados")
    .insert({
      tipo,
      numero:         resumo.numero,
      beneficiario:   resumo.beneficiario,
      valor:          resumo.valor,
      descricao:      resumo.descricao,
      mes_referencia: resumo.mes_referencia,
      dados:          dados as unknown as Json,
      pdf_path:       pdfPath,
      pdf_size:       pdfBytes.length,
      created_by:     user.id,
    })
    .select("id, pdf_path")
    .maybeSingle();

  if (insErr || !row) {
    // limpa upload órfão
    await supabase.storage.from(BUCKET).remove([pdfPath]);
    return NextResponse.json(
      { error: `Falha ao registrar documento: ${insErr?.message ?? "desconhecido"}` },
      { status: 500 },
    );
  }

  // 6) Signed URL para download imediato
  const { data: signed, error: sErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(row.pdf_path!, DOWNLOAD_TTL_SEC, {
      download: `${baseName || tipo}.pdf`,
    });

  return NextResponse.json({
    id:           row.id,
    pdf_path:     row.pdf_path,
    download_url: sErr ? null : signed?.signedUrl ?? null,
    filename:     `${baseName || tipo}.pdf`,
  });
}
