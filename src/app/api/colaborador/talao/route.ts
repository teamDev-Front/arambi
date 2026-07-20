// POST  /api/colaborador/talao  → ABRE um talão de uso
//   Body: { cpf, equipamento_id, medidor_inicial, corrigiu? }
//   O sistema sugere o medidor (último final do equipamento). Se o operador
//   corrigiu o valor, a diferença fica gravada como discrepância pendente de
//   regularização (decisão do call: "alguém andou 10 km sem marcar").
//
// PATCH /api/colaborador/talao  → FECHA o talão
//   Body: { cpf, talao_id, medidor_final, equipamento_seguranca?, observacoes?, defeitos? }

import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buscarColaboradorAtivo, rateLimitOk } from "@/lib/portal/server";
import type { EquipamentoRow, TalaoUsoRow } from "@/types";

function numOk(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 10_000_000;
}

export async function POST(req: NextRequest) {
  if (!rateLimitOk(req)) {
    return NextResponse.json({ error: "Muitas tentativas. Aguarde um minuto." }, { status: 429 });
  }

  let body: { cpf?: string; equipamento_id?: string; medidor_inicial?: number; corrigiu?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const r = await buscarColaboradorAtivo(body.cpf ?? "");
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  if (!body.equipamento_id || typeof body.equipamento_id !== "string") {
    return NextResponse.json({ error: "Selecione o equipamento." }, { status: 400 });
  }
  if (!numOk(body.medidor_inicial)) {
    return NextResponse.json({ error: "Medidor inicial inválido." }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: eqData, error: eqErr } = await supabase
    .from("equipamentos")
    .select("*")
    .eq("id", body.equipamento_id)
    .eq("ativo", true)
    .maybeSingle();
  if (eqErr || !eqData) return NextResponse.json({ error: "Equipamento não encontrado." }, { status: 404 });
  const eq = eqData as EquipamentoRow;

  // Equipamento já em uso por outra pessoa?
  const { data: abertoData } = await supabase
    .from("talao_usos")
    .select("id, colaborador_id, colaboradores(nome)")
    .eq("equipamento_id", eq.id)
    .eq("status", "aberto")
    .maybeSingle();
  if (abertoData) {
    type Aberto = { id: string; colaborador_id: string; colaboradores: { nome: string } | null };
    const aberto = abertoData as unknown as Aberto;
    if (aberto.colaborador_id === r.colaborador.id) {
      return NextResponse.json({ error: "Você já tem um talão aberto para este equipamento — finalize-o primeiro." }, { status: 409 });
    }
    return NextResponse.json({ error: `Equipamento em uso por ${aberto.colaboradores?.nome ?? "outro colaborador"} (talão aberto).` }, { status: 409 });
  }

  // Sugerido = último medidor conhecido do equipamento
  const sugerido = eq.medidor_atual != null ? Number(eq.medidor_atual) : null;
  const inicial = Number(body.medidor_inicial);
  const discrepancia = sugerido != null ? Number((inicial - sugerido).toFixed(1)) : 0;

  const { data: novo, error: insErr } = await supabase
    .from("talao_usos")
    .insert({
      colaborador_id: r.colaborador.id,
      equipamento_id: eq.id,
      inicio_em: new Date().toISOString(),
      medidor_inicial: inicial,
      medidor_inicial_sugerido: sugerido,
      discrepancia,
      discrepancia_regularizada: discrepancia === 0,
    })
    .select()
    .maybeSingle();
  if (insErr || !novo) return NextResponse.json({ error: "Erro ao abrir o talão." }, { status: 500 });

  return NextResponse.json({ talao: novo as TalaoUsoRow, discrepancia });
}

export async function PATCH(req: NextRequest) {
  if (!rateLimitOk(req)) {
    return NextResponse.json({ error: "Muitas tentativas. Aguarde um minuto." }, { status: 429 });
  }

  let body: {
    cpf?: string; talao_id?: string; medidor_final?: number;
    equipamento_seguranca?: boolean; observacoes?: string; defeitos?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const r = await buscarColaboradorAtivo(body.cpf ?? "");
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  if (!body.talao_id || typeof body.talao_id !== "string") {
    return NextResponse.json({ error: "Talão não informado." }, { status: 400 });
  }
  if (!numOk(body.medidor_final)) {
    return NextResponse.json({ error: "Medidor final inválido." }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: talaoData } = await supabase
    .from("talao_usos")
    .select("*")
    .eq("id", body.talao_id)
    .eq("colaborador_id", r.colaborador.id)   // só o dono fecha
    .eq("status", "aberto")
    .maybeSingle();
  if (!talaoData) return NextResponse.json({ error: "Talão não encontrado ou já finalizado." }, { status: 404 });
  const talao = talaoData as TalaoUsoRow;

  const final = Number(body.medidor_final);
  if (final < Number(talao.medidor_inicial)) {
    return NextResponse.json(
      { error: `Medidor final (${final}) não pode ser menor que o inicial (${talao.medidor_inicial}).` },
      { status: 400 },
    );
  }

  const { data: fechado, error: updErr } = await supabase
    .from("talao_usos")
    .update({
      fim_em: new Date().toISOString(),
      medidor_final: final,
      equipamento_seguranca: typeof body.equipamento_seguranca === "boolean" ? body.equipamento_seguranca : null,
      observacoes: String(body.observacoes ?? "").trim().slice(0, 2000) || null,
      defeitos: String(body.defeitos ?? "").trim().slice(0, 2000) || null,
      status: "fechado",
    })
    .eq("id", talao.id)
    .select()
    .maybeSingle();
  if (updErr || !fechado) return NextResponse.json({ error: "Erro ao finalizar o talão." }, { status: 500 });

  return NextResponse.json({ talao: fechado as TalaoUsoRow });
}
