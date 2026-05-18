// GET /api/documentos/[id]/download
// Devolve uma signed URL temporária para baixar o PDF do bucket.

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const BUCKET = "documentos-gerados";
const TTL_SEC = 60 * 10;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { data: row, error } = await supabase
    .from("documentos_gerados")
    .select("id, pdf_path, beneficiario, tipo")
    .eq("id", id)
    .maybeSingle();

  if (error || !row) {
    return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });
  }
  if (!row.pdf_path) {
    return NextResponse.json({ error: "Documento sem PDF associado" }, { status: 410 });
  }

  const base = (row.beneficiario ?? row.tipo).replace(/[^\w-]+/g, "-").slice(0, 60);
  const { data: signed, error: sErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(row.pdf_path, TTL_SEC, { download: `${base || "documento"}.pdf` });

  if (sErr || !signed) {
    return NextResponse.json({ error: `Falha gerando URL: ${sErr?.message}` }, { status: 500 });
  }

  return NextResponse.json({ download_url: signed.signedUrl, filename: `${base || "documento"}.pdf` });
}
