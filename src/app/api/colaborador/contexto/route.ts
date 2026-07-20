// POST /api/colaborador/contexto
// Body: { cpf: string }
// Carrega tudo que o portal precisa numa chamada só (menos round-trips no
// celular): equipamentos ativos com último medidor + talões abertos do
// colaborador + fontes de combustível.

import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buscarColaboradorAtivo, rateLimitOk } from "@/lib/portal/server";
import type { EquipamentoRow, TalaoUsoRow } from "@/types";

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

  const supabase = createAdminClient();
  const [eqR, taloesR, abertosEqR] = await Promise.all([
    supabase.from("equipamentos").select("*").eq("ativo", true).order("codigo"),
    supabase.from("talao_usos").select("*").eq("colaborador_id", r.colaborador.id).eq("status", "aberto"),
    supabase.from("talao_usos").select("equipamento_id, colaboradores(nome)").eq("status", "aberto"),
  ]);

  if (eqR.error || taloesR.error) {
    return NextResponse.json({ error: "Erro ao carregar dados." }, { status: 500 });
  }

  const equipamentos = ((eqR.data ?? []) as EquipamentoRow[]).map((eq) => ({
    id: eq.id,
    codigo: eq.codigo,
    nome: eq.nome,
    tipo: eq.tipo,
    medidor_tipo: eq.medidor_tipo,
    medidor_atual: eq.medidor_atual,
    combustivel: eq.combustivel,
    status: eq.status,
  }));

  // Equipamentos com talão aberto de OUTRA pessoa (aparecem como "em uso")
  type AbertoJoin = { equipamento_id: string; colaboradores: { nome: string } | null };
  const emUsoPor = new Map<string, string>();
  for (const t of ((abertosEqR.data ?? []) as unknown as AbertoJoin[])) {
    emUsoPor.set(t.equipamento_id, t.colaboradores?.nome ?? "outro colaborador");
  }

  return NextResponse.json({
    colaborador: { id: r.colaborador.id, nome: r.colaborador.nome },
    equipamentos,
    taloesAbertos: (taloesR.data ?? []) as TalaoUsoRow[],
    emUsoPor: Object.fromEntries(emUsoPor),
  });
}
