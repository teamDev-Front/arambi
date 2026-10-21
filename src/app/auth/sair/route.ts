// GET /auth/sair?motivo=bloqueado
// Saída forçada: usada pelas guardas de página quando o perfil foi bloqueado
// (server component não consegue apagar cookie). O logout normal é o POST
// em /auth/logout.

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MOTIVOS = new Set(["bloqueado", "sessao"]);

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  const motivo = req.nextUrl.searchParams.get("motivo");
  const destino = new URL("/login", req.url);
  if (motivo && MOTIVOS.has(motivo)) destino.searchParams.set("motivo", motivo);
  return NextResponse.redirect(destino);
}
