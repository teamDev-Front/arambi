// DELETE /api/documentos/[id]
// Remove o registro + PDF do Storage.

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const BUCKET = "documentos-gerados";

export async function DELETE(
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
    .select("id, pdf_path")
    .eq("id", id)
    .maybeSingle();
  if (error || !row) return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });

  if (row.pdf_path) {
    const { error: stErr } = await supabase.storage.from(BUCKET).remove([row.pdf_path]);
    if (stErr) {
      // segue removendo a row mesmo assim — log no servidor
      console.warn(`[documentos] Falha ao remover PDF "${row.pdf_path}": ${stErr.message}`);
    }
  }

  const { error: delErr } = await supabase
    .from("documentos_gerados")
    .delete()
    .eq("id", id);
  if (delErr) {
    return NextResponse.json({ error: `Falha ao remover registro: ${delErr.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
