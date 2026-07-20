// POST /api/colaborador/login
// Body: { cpf: string }
// 200 → { colaborador: { id, nome } }
// Identificação por CPF sem senha (decisão do call de 14/jul/2026).

import { NextResponse, type NextRequest } from "next/server";
import { buscarColaboradorAtivo, rateLimitOk } from "@/lib/portal/server";

export async function POST(req: NextRequest) {
  if (!rateLimitOk(req)) {
    return NextResponse.json({ error: "Muitas tentativas. Aguarde um minuto." }, { status: 429 });
  }

  let body: { cpf?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const r = await buscarColaboradorAtivo(body.cpf ?? "");
  if (!r.ok) {
    return NextResponse.json({ error: r.error, pendente: r.pendente ?? false }, { status: r.status });
  }

  return NextResponse.json({
    colaborador: { id: r.colaborador.id, nome: r.colaborador.nome },
  });
}
