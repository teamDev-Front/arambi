// Queries agro transversais: chuvas (0040) + Central de Alertas da Home.
// Os alertas são COMPUTADOS por query (sem tabela própria) a partir de:
//   animal_eventos.proxima_data, equipamento_manutencoes pendentes,
//   equipamento_documentos.vencimento, animal_ocorrencias críticas abertas
//   e talao_usos com discrepância não regularizada (0041).

import { createClient } from "@/lib/supabase/client";
import type {
  ChuvaRow,
  AnimalEventoRow,
  AnimalOcorrenciaRow,
  EquipamentoManutencaoRow,
  EquipamentoDocumentoRow,
} from "@/types";

// ----------------------------------------------------------------------------
// Chuvas
// ----------------------------------------------------------------------------
export async function listarChuvasPeriodo(deIso: string, ateIso: string): Promise<ChuvaRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("chuvas")
    .select("*")
    .gte("data", deIso)
    .lte("data", ateIso)
    .order("data");
  if (error) throw error;
  return (data ?? []) as ChuvaRow[];
}

/** Cria/atualiza o registro do dia (data é única). milimetros null = remover. */
export async function salvarChuvaDia(dataIso: string, milimetros: number | null, observacao?: string | null): Promise<void> {
  const supabase = createClient();
  if (milimetros == null) {
    const { error } = await supabase.from("chuvas").delete().eq("data", dataIso);
    if (error) throw error;
    return;
  }
  const { data, error } = await supabase
    .from("chuvas")
    .upsert({ data: dataIso, milimetros, observacao: observacao ?? null }, { onConflict: "data" })
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Não foi possível salvar — sem permissão de escrita.");
}

// ----------------------------------------------------------------------------
// Central de Alertas (computada)
// ----------------------------------------------------------------------------
export type AlertaTipo = "vacinacao" | "manutencao" | "documento" | "ocorrencia" | "discrepancia";

export interface AlertaItem {
  id: string;
  tipo: AlertaTipo;
  titulo: string;
  detalhe: string;
  /** Data ISO de referência (vencimento/prevista), quando houver. */
  data: string | null;
  /** Dias até a data (negativo = atrasado). null = sem data. */
  dias: number | null;
  /** Rota para onde o clique navega. */
  href: string;
  severidade: "info" | "atencao" | "critico";
}

function isoHoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function diffDias(deIso: string, ateIso: string): number {
  return Math.round((new Date(ateIso + "T00:00").getTime() - new Date(deIso + "T00:00").getTime()) / 86400000);
}

/**
 * Monta a central de alertas. Horizonte padrão: vacinações 15 dias,
 * manutenções 15 dias, documentos 30 dias (+ tudo que já venceu).
 */
export async function listarAlertas(): Promise<AlertaItem[]> {
  const supabase = createClient();
  const hoje = isoHoje();

  const [eventosR, manutR, docsR, ocorrR, discrepR] = await Promise.all([
    supabase.from("animal_eventos").select("*, animal_lotes(codigo)").not("proxima_data", "is", null).order("proxima_data"),
    supabase.from("equipamento_manutencoes").select("*, equipamentos(codigo, nome)").is("realizada_em", null),
    supabase.from("equipamento_documentos").select("*, equipamentos(codigo, nome)").order("vencimento"),
    supabase.from("animal_ocorrencias").select("*, animal_lotes(codigo)").eq("resolvida", false).eq("severidade", "critico"),
    supabase.from("talao_usos").select("id, discrepancia, discrepancia_regularizada, equipamentos(codigo, nome)")
      .eq("discrepancia_regularizada", false).neq("discrepancia", 0),
  ]);

  const alertas: AlertaItem[] = [];

  // Vacinações próximas (≤15 dias) ou vencidas
  type EvJoin = AnimalEventoRow & { animal_lotes: { codigo: string } | null };
  for (const ev of ((eventosR.data ?? []) as unknown as EvJoin[])) {
    if (!ev.proxima_data) continue;
    const dias = diffDias(hoje, ev.proxima_data);
    if (dias > 15) continue;
    alertas.push({
      id: `vac-${ev.id}`,
      tipo: "vacinacao",
      titulo: `${ev.nome} — ${ev.animal_lotes?.codigo ?? "lote"}`,
      detalhe: dias < 0 ? `Atrasada há ${-dias} dia(s)` : dias === 0 ? "É hoje!" : `Em ${dias} dia(s)`,
      data: ev.proxima_data,
      dias,
      href: "/dashboard/animais",
      severidade: dias < 0 ? "critico" : dias <= 5 ? "atencao" : "info",
    });
  }

  // Manutenções pendentes com data (≤15 dias) ou vencidas
  type ManJoin = EquipamentoManutencaoRow & { equipamentos: { codigo: string; nome: string } | null };
  for (const m of ((manutR.data ?? []) as unknown as ManJoin[])) {
    if (!m.data_prevista) continue;
    const dias = diffDias(hoje, m.data_prevista);
    if (dias > 15) continue;
    alertas.push({
      id: `man-${m.id}`,
      tipo: "manutencao",
      titulo: `${m.descricao} — ${m.equipamentos?.codigo ?? ""} ${m.equipamentos?.nome ?? ""}`.trim(),
      detalhe: dias < 0 ? `Atrasada há ${-dias} dia(s)` : dias === 0 ? "É hoje!" : `Em ${dias} dia(s)`,
      data: m.data_prevista,
      dias,
      href: "/dashboard/maquinario",
      severidade: dias < 0 ? "critico" : dias <= 5 ? "atencao" : "info",
    });
  }

  // Documentação vencendo (≤30 dias) ou vencida
  type DocJoin = EquipamentoDocumentoRow & { equipamentos: { codigo: string; nome: string } | null };
  for (const d of ((docsR.data ?? []) as unknown as DocJoin[])) {
    const dias = diffDias(hoje, d.vencimento);
    if (dias > 30) continue;
    alertas.push({
      id: `doc-${d.id}`,
      tipo: "documento",
      titulo: `${d.tipo} — ${d.equipamentos?.codigo ?? ""} ${d.equipamentos?.nome ?? ""}`.trim(),
      detalhe: dias < 0 ? `Vencido há ${-dias} dia(s)` : dias === 0 ? "Vence hoje!" : `Vence em ${dias} dia(s)`,
      data: d.vencimento,
      dias,
      href: "/dashboard/maquinario",
      severidade: dias < 0 ? "critico" : dias <= 10 ? "atencao" : "info",
    });
  }

  // Ocorrências críticas de animais em aberto
  type OcJoin = AnimalOcorrenciaRow & { animal_lotes: { codigo: string } | null };
  for (const oc of ((ocorrR.data ?? []) as unknown as OcJoin[])) {
    alertas.push({
      id: `oco-${oc.id}`,
      tipo: "ocorrencia",
      titulo: `Saúde crítica — ${oc.animal_lotes?.codigo ?? "lote"}`,
      detalhe: oc.descricao,
      data: oc.data,
      dias: null,
      href: "/dashboard/animais",
      severidade: "critico",
    });
  }

  // Discrepâncias de KM não regularizadas (tabela existe a partir da 0041 —
  // se a migration ainda não foi aplicada, o Supabase retorna erro e ignoramos).
  if (!discrepR.error) {
    type DiscJoin = { id: string; discrepancia: number; equipamentos: { codigo: string; nome: string } | null };
    for (const t of ((discrepR.data ?? []) as unknown as DiscJoin[])) {
      alertas.push({
        id: `dis-${t.id}`,
        tipo: "discrepancia",
        titulo: `KM não bateu — ${t.equipamentos?.codigo ?? ""} ${t.equipamentos?.nome ?? ""}`.trim(),
        detalhe: `${Math.abs(Number(t.discrepancia)).toLocaleString("pt-BR")} sem registro — regularizar`,
        data: null,
        dias: null,
        href: "/dashboard/operacao",
        severidade: "atencao",
      });
    }
  }

  // Ordena: críticos primeiro, depois por proximidade de data
  const peso = { critico: 0, atencao: 1, info: 2 } as const;
  alertas.sort((a, b) => peso[a.severidade] - peso[b.severidade] || (a.dias ?? 999) - (b.dias ?? 999));
  return alertas;
}

/** Eventos de vacinação com próxima data (para o calendário da Home). */
export async function listarEventosVacinacao(): Promise<(AnimalEventoRow & { lote_codigo: string | null })[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("animal_eventos")
    .select("*, animal_lotes(codigo)")
    .not("proxima_data", "is", null);
  if (error) throw error;
  type EvJoin = AnimalEventoRow & { animal_lotes: { codigo: string } | null };
  return ((data ?? []) as unknown as EvJoin[]).map((ev) => ({
    ...ev,
    lote_codigo: ev.animal_lotes?.codigo ?? null,
  }));
}
