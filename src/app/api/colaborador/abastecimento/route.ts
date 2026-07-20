// POST /api/colaborador/abastecimento
// Body: { cpf, fonte, litros, equipamento_id?, medidor_inicial?, medidor_final?, observacao? }
// Digitaliza as fichas "Consumo Combustível" (tanque diesel / container gasolina).

import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buscarColaboradorAtivo, rateLimitOk } from "@/lib/portal/server";
import type { CombustivelFonte } from "@/types";

const FONTES: CombustivelFonte[] = ["tanque_diesel", "container_gasolina", "posto_externo"];

export async function POST(req: NextRequest) {
  if (!rateLimitOk(req)) {
    return NextResponse.json({ error: "Muitas tentativas. Aguarde um minuto." }, { status: 429 });
  }

  let body: {
    cpf?: string; fonte?: CombustivelFonte; litros?: number;
    equipamento_id?: string | null; medidor_inicial?: number | null;
    medidor_final?: number | null; observacao?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const r = await buscarColaboradorAtivo(body.cpf ?? "");
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  if (!body.fonte || !FONTES.includes(body.fonte)) {
    return NextResponse.json({ error: "Fonte de combustível inválida." }, { status: 400 });
  }
  const litros = Number(body.litros);
  if (!Number.isFinite(litros) || litros <= 0 || litros > 100_000) {
    return NextResponse.json({ error: "Quantidade de litros inválida." }, { status: 400 });
  }

  const medIni = body.medidor_inicial == null ? null : Number(body.medidor_inicial);
  const medFim = body.medidor_final == null ? null : Number(body.medidor_final);
  if (medIni != null && (!Number.isFinite(medIni) || medIni < 0)) {
    return NextResponse.json({ error: "Medidor inicial inválido." }, { status: 400 });
  }
  if (medFim != null && (!Number.isFinite(medFim) || medFim < 0)) {
    return NextResponse.json({ error: "Medidor final inválido." }, { status: 400 });
  }

  const supabase = createAdminClient();

  let equipamentoId: string | null = null;
  if (body.equipamento_id) {
    const { data: eq } = await supabase
      .from("equipamentos")
      .select("id")
      .eq("id", body.equipamento_id)
      .eq("ativo", true)
      .maybeSingle();
    if (!eq) return NextResponse.json({ error: "Equipamento não encontrado." }, { status: 404 });
    equipamentoId = eq.id;
  }

  const { data, error } = await supabase
    .from("abastecimentos")
    .insert({
      colaborador_id: r.colaborador.id,
      equipamento_id: equipamentoId,
      fonte: body.fonte,
      data: new Date().toISOString(),
      medidor_inicial: medIni,
      medidor_final: medFim,
      litros,
      observacao: String(body.observacao ?? "").trim().slice(0, 1000) || null,
    })
    .select()
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Erro ao registrar abastecimento." }, { status: 500 });

  return NextResponse.json({ abastecimento: data });
}
