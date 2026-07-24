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
  let body: { tipo?: DocumentoGeradoTipo; dados?: unknown; id?: string; salvar_sem_pdf?: boolean };
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
  // id presente → edição (RF-09): registra uma nova versão do documento existente.
  const editId = typeof body.id === "string" && body.id ? body.id : null;

  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const tipo  = body.tipo;
  const dados = body.dados as DocumentoPayloadMap[typeof tipo];

  // ── SALVAR SEM GERAR PDF (RF 24-jul) — só na edição ─────────────────────
  // Atualiza dados + campos-resumo do documento existente, mantendo o PDF e a
  // versão atuais. Útil para corrigir o cadastro sem emitir novo arquivo.
  if (body.salvar_sem_pdf === true) {
    if (!editId) {
      return NextResponse.json(
        { error: "salvar_sem_pdf só é permitido na edição de um documento existente" },
        { status: 400 },
      );
    }
    const resumoSalvar = resumoDocumento(tipo, dados);
    const { data: upd, error: updErr } = await supabase
      .from("documentos_gerados")
      .update({
        dados:          dados as unknown as Json,
        numero:         resumoSalvar.numero,
        beneficiario:   resumoSalvar.beneficiario,
        valor:          resumoSalvar.valor,
        descricao:      resumoSalvar.descricao,
        mes_referencia: resumoSalvar.mes_referencia,
        updated_at:     new Date().toISOString(),
      })
      .eq("id", editId)
      .select("id, versao_atual, pdf_path")
      .maybeSingle();
    if (updErr || !upd) {
      return NextResponse.json(
        { error: `Falha ao salvar alterações: ${updErr?.message ?? "documento não encontrado (permissão?)"}` },
        { status: 500 },
      );
    }
    return NextResponse.json({
      id:           upd.id,
      pdf_path:     upd.pdf_path,
      versao:       upd.versao_atual ?? 1,
      download_url: null,
      filename:     null,
      salvo_sem_pdf: true,
    });
  }

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

  // 5) Persiste — edição (nova versão) ou criação
  let docId: string;
  let versao: number;

  if (editId) {
    // RF-09 — nova versão atômica (insert versão + update da versão atual).
    // A função não está no Database tipado; chamada via wrapper tipado local.
    const rpcArgs = {
      p_documento_id:   editId,
      p_dados:          dados as unknown as Json,
      p_numero:         resumo.numero,
      p_beneficiario:   resumo.beneficiario,
      p_valor:          resumo.valor,
      p_descricao:      resumo.descricao,
      p_mes_referencia: resumo.mes_referencia,
      p_pdf_path:       pdfPath,
      p_pdf_size:       pdfBytes.length,
      p_created_by:     user.id,
    };
    const rpcRes = await supabase.rpc("fn_registrar_versao_documento" as never, rpcArgs as never);
    const novaVersao = rpcRes.data as number | null;
    const rpcErr = rpcRes.error as { message: string; code?: string } | null;
    if (rpcErr || novaVersao == null) {
      await supabase.storage.from(BUCKET).remove([pdfPath]); // limpa upload órfão
      return NextResponse.json(
        { error: `Falha ao registrar nova versão: ${rpcErr?.message ?? "documento não encontrado"}` },
        { status: rpcErr?.code === "42501" ? 403 : 500 },
      );
    }
    docId = editId;
    versao = novaVersao;
  } else {
    // Criação — insere a linha principal + a versão 1
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
      .select("id")
      .maybeSingle();

    if (insErr || !row) {
      await supabase.storage.from(BUCKET).remove([pdfPath]); // limpa upload órfão
      return NextResponse.json(
        { error: `Falha ao registrar documento: ${insErr?.message ?? "desconhecido"}` },
        { status: 500 },
      );
    }
    docId = row.id;
    versao = 1;

    // Versão 1 no histórico (best-effort: a linha principal é a fonte da verdade)
    const { error: vErr } = await supabase.from("documentos_gerados_versoes").insert({
      documento_id:   docId,
      versao:         1,
      numero:         resumo.numero,
      beneficiario:   resumo.beneficiario,
      valor:          resumo.valor,
      descricao:      resumo.descricao,
      mes_referencia: resumo.mes_referencia,
      dados:          dados as unknown as Json,
      pdf_path:       pdfPath,
      pdf_size:       pdfBytes.length,
      created_by:     user.id,
    });
    if (vErr) console.warn(`[documentos] Falha ao registrar versão 1 de ${docId}: ${vErr.message}`);
  }

  // 6) RF-02 — registra a descrição no histórico (best-effort, não bloqueia)
  if (resumo.descricao && resumo.descricao.trim()) {
    try {
      const r = await supabase.rpc(
        "fn_registrar_descricao_documento" as never,
        { p_tipo: tipo, p_descricao: resumo.descricao } as never,
      );
      if (r.error) console.warn(`[documentos] histórico de descrição: ${r.error.message}`);
    } catch (e) {
      console.warn(`[documentos] histórico de descrição falhou: ${(e as Error).message}`);
    }
  }

  // 7) Signed URL para download imediato
  const { data: signed, error: sErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(pdfPath, DOWNLOAD_TTL_SEC, {
      download: `${baseName || tipo}.pdf`,
    });

  return NextResponse.json({
    id:           docId,
    pdf_path:     pdfPath,
    versao,
    download_url: sErr ? null : signed?.signedUrl ?? null,
    filename:     `${baseName || tipo}.pdf`,
  });
}
