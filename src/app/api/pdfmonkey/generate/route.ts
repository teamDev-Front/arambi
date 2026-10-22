// POST /api/pdfmonkey/generate
//
// Body:
//   {
//     "slug":           "capa_empresa" | "capa_socio" | "relatorio_contabil" | "relatorio_socios",
//     "mes_referencia": "2026-01",                  // obrigatório p/ todos
//     "socio_id":       "<uuid>",                   // só p/ capa_socio
//     "payload":        { ... }                     // opcional — se passado, pula o builder e usa esse JSON direto
//   }
//
// Response 200:
//   {
//     "document_id": "<id>",
//     "status":      "pending" | "success" | "failure",
//     "download_url": "https://..." | null,
//     "geracao_id":  "<uuid>"                       // id da row em pdfmonkey_geracoes
//   }
//
// As credenciais ficam em .env.local (PDFMONKEY_API_KEY + PDFMONKEY_TEMPLATE_*).
// Enquanto não estiverem setadas, retorna 500 com erro de configuração claro.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { autorizarApi } from "@/lib/acessos/servidor";
import type { ModuloKey } from "@/lib/acessos/modulos";
import {
  createDocument, isPdfMonkeyEnabled,
  PdfMonkeyConfigError, PdfMonkeyApiError,
} from "@/lib/pdfmonkey/client";
import {
  buildCapaEmpresa, buildCapaSocio,
  buildRelatorioContabil, buildRelatorioSocios,
} from "@/lib/pdfmonkey/builders";
import type {
  AnyPayload, ContabilObservacao, RelatorioSociosOverrides, ReportScope,
} from "@/lib/pdfmonkey/types";
import type { PdfMonkeySlug, Json } from "@/types";

interface Body {
  slug?: PdfMonkeySlug;
  mes_referencia?: string;
  socio_id?: string;
  payload?: AnyPayload;
  /**
   * Observações livres preenchidas no modal antes de gerar: cartões do
   * relatório contábil e, desde 21-out, o campo `observacoes` das duas capas.
   */
  observacoes?: ContabilObservacao[];
  /** Overrides editáveis do relatório de sócios (saldo inicial e notas dos gráficos). */
  socios_overrides?: RelatorioSociosOverrides;
  /** Recorte (RF-FIN-09): aplica-se a capa_empresa e relatorio_contabil. */
  scope?: ReportScope;
  /**
   * Selo dourado das capas — número informado manualmente (ex.: "7º"). Capa
   * Empresa desde o 4.3; Capa Sócio desde out-2026 ("2º" = 2ª capa do mês).
   */
  numero_lote?: string;
  /** Selo dourado das capas — mês de referência informado manualmente (ex.: "Julho"). */
  mes_referencia_label?: string;
}

// Gerar PDF é "extração de documento": basta VER um destes módulos (0058).
const MODULOS_DO_SLUG: Record<PdfMonkeySlug, ModuloKey[]> = {
  capa_empresa:       ["relatorios", "financeiro"],
  relatorio_contabil: ["relatorios", "financeiro"],
  capa_socio:         ["relatorios", "distribuicao"],
  relatorio_socios:   ["relatorios"],
};

const VALID_SLUGS: PdfMonkeySlug[] = [
  "capa_empresa", "capa_socio", "relatorio_contabil", "relatorio_socios",
];

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  const slug = body.slug;
  if (!slug || !VALID_SLUGS.includes(slug)) {
    return NextResponse.json({ error: "slug obrigatório (capa_empresa | capa_socio | relatorio_contabil | relatorio_socios)" }, { status: 400 });
  }
  if (!body.mes_referencia || !/^\d{4}-\d{2}$/.test(body.mes_referencia)) {
    return NextResponse.json({ error: "mes_referencia (YYYY-MM) obrigatório" }, { status: 400 });
  }
  if (slug === "capa_socio" && !body.socio_id) {
    return NextResponse.json({ error: "socio_id obrigatório para capa_socio" }, { status: 400 });
  }

  if (!isPdfMonkeyEnabled()) {
    return NextResponse.json(
      { error: "PDFMonkey ainda não configurado. Defina PDFMONKEY_API_KEY e PDFMONKEY_TEMPLATE_* no .env.local." },
      { status: 503 },
    );
  }

  const auth = await autorizarApi({ modulos: MODULOS_DO_SLUG[slug] });
  if (!auth.ok) return auth.resposta;
  // Leitura dos dados com a sessão do usuário (RLS); o histórico de gerações é
  // gravado pelo servidor — quem só tem leitura também extrai PDF.
  const supabase = auth.supabase;
  const admin = createAdminClient();

  // 1) Monta o payload — usa o que veio no body se fornecido, senão chama o builder
  let payload: AnyPayload;
  try {
    if (body.payload) {
      payload = body.payload;
    } else if (slug === "capa_empresa") {
      payload = await buildCapaEmpresa(supabase, {
        mesReferencia: body.mes_referencia,
        scope: body.scope,
        numeroLote: body.numero_lote,
        mesReferenciaLabel: body.mes_referencia_label,
        observacoes: body.observacoes,
      });
    } else if (slug === "capa_socio") {
      // Recorte por tags da DL (ajuste 29-jul): aceita seleção manual ou ids
      // dos filtros — mesmo contrato do restante dos escopos.
      const idsScope = body.scope?.scope_type === "por_selecao"
        ? body.scope.transacao_ids
        : body.scope?.filtros?.ids;
      payload = await buildCapaSocio(supabase, {
        mesReferencia: body.mes_referencia,
        socioId: body.socio_id!,
        ids: idsScope,
        numeroCapa: body.numero_lote,
        mesReferenciaLabel: body.mes_referencia_label,
        observacoes: body.observacoes,
      });
    } else if (slug === "relatorio_contabil") {
      payload = await buildRelatorioContabil(supabase, { mesReferencia: body.mes_referencia, scope: body.scope });
      // Sobrescreve observações se vieram do front
      if (body.observacoes && Array.isArray(body.observacoes)) {
        (payload as { observacoes: ContabilObservacao[] }).observacoes = body.observacoes;
      }
    } else {
      payload = await buildRelatorioSocios(supabase, {
        mesReferencia: body.mes_referencia,
        overrides: body.socios_overrides,
      });
    }
  } catch (e) {
    return NextResponse.json({ error: `Erro montando payload: ${(e as Error).message}` }, { status: 500 });
  }

  // 2) Cria registro de geração ("pending") antes de chamar a API
  const { data: geracao, error: insertErr } = await admin
    .from("pdfmonkey_geracoes")
    .insert({
      template_slug: slug,
      mes_referencia: body.mes_referencia,
      socio_id: body.socio_id ?? null,
      pdfmonkey_document_id: null,
      status: "pending",
      payload: payload as unknown as Json,
      // RF-FIN-09: registra o recorte usado (auditoria/reprodutibilidade).
      scope_applied: body.scope ? (body.scope as unknown as Json) : null,
      download_url: null,
      erro: null,
      created_by: auth.user.id,
    })
    .select("id")
    .maybeSingle();
  if (insertErr) {
    return NextResponse.json({ error: `Falha registrando geração: ${insertErr.message}` }, { status: 500 });
  }

  // 3) Chama PDFMonkey
  try {
    const doc = await createDocument(slug, payload, {
      meta: {
        _filename: `${slug}-${body.mes_referencia}${body.socio_id ? "-" + body.socio_id : ""}.pdf`,
        slug, mes_referencia: body.mes_referencia, socio_id: body.socio_id ?? null,
      },
    });

    await admin
      .from("pdfmonkey_geracoes")
      .update({
        pdfmonkey_document_id: doc.id,
        status: doc.status,
        download_url: doc.download_url,
        erro: doc.failure_cause ?? null,
      })
      .eq("id", geracao!.id);

    return NextResponse.json({
      document_id:   doc.id,
      status:        doc.status,
      download_url:  doc.download_url,
      geracao_id:    geracao!.id,
    });
  } catch (e) {
    const msg = e instanceof PdfMonkeyConfigError ? e.message
      : e instanceof PdfMonkeyApiError ? `PDFMonkey ${e.status}: ${JSON.stringify(e.body).slice(0, 500)}`
      : (e as Error).message;
    await admin.from("pdfmonkey_geracoes").update({ status: "failure", erro: msg }).eq("id", geracao!.id);
    return NextResponse.json({ error: msg, geracao_id: geracao!.id }, { status: 502 });
  }
}
