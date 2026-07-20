// POST /api/colaborador/solicitar-acesso
// Body: { nome: string, cpf: string }
// Plano B do fluxo (caminho principal é o pré-cadastro pelo admin):
// cria colaborador com status 'pendente' para aprovação em Configurações.

import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cpfValido, normalizarCpf, rateLimitOk } from "@/lib/portal/server";

export async function POST(req: NextRequest) {
  if (!rateLimitOk(req)) {
    return NextResponse.json({ error: "Muitas tentativas. Aguarde um minuto." }, { status: 429 });
  }

  let body: { nome?: string; cpf?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const nome = String(body.nome ?? "").trim();
  const cpf = normalizarCpf(body.cpf ?? "");
  if (nome.length < 3) return NextResponse.json({ error: "Informe o nome completo." }, { status: 400 });
  if (nome.length > 120) return NextResponse.json({ error: "Nome muito longo." }, { status: 400 });
  if (!cpfValido(cpf)) return NextResponse.json({ error: "CPF inválido." }, { status: 400 });

  const supabase = createAdminClient();

  const { data: existente } = await supabase
    .from("colaboradores")
    .select("id, status")
    .eq("cpf", cpf)
    .maybeSingle();

  if (existente) {
    if (existente.status === "pendente") {
      return NextResponse.json({ error: "Solicitação já enviada — aguarde a aprovação." }, { status: 409 });
    }
    if (existente.status === "desativado") {
      return NextResponse.json({ error: "Cadastro desativado. Fale com a administração." }, { status: 403 });
    }
    return NextResponse.json({ error: "CPF já cadastrado — é só entrar." }, { status: 409 });
  }

  const { error } = await supabase
    .from("colaboradores")
    .insert({ nome, cpf, status: "pendente" });
  if (error) {
    return NextResponse.json({ error: "Erro ao registrar solicitação." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
