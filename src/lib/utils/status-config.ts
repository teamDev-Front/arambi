// Cache data-driven dos status (rótulo, tipo, cores), com FALLBACK ao hardcoded.
//
// Por que existe: os status passaram a ser editáveis (Admin → Status & Cores) e
// podem ser ADICIONADOS. A apresentação vem da tabela `status_config`. Para não
// reescrever todo o app de forma assíncrona, mantemos um cache de módulo + um
// store reativo (useSyncExternalStore). Antes do carregamento — ou se a migration
// 0035 ainda não foi aplicada — usamos os valores hardcoded (idênticos aos atuais),
// então NADA quebra: o sistema funciona com ou sem a tabela.

import { useMemo, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { STATUS_ARAMBURU_LABEL, STATUS_KIND, type StatusAramburu } from "@/types";

export interface StatusConfigEntry {
  codigo: string;
  label: string;
  kind: "entrada" | "saida" | "neutro";
  cor_bg: string;
  cor_text: string;
  ordem: number;
  ativo: boolean;
  is_sistema: boolean;
}

// ---- Fallback (legenda do Excel) ----------------------------------------------
const FALLBACK_BG: Record<StatusAramburu, string> = {
  saldo_inicial: "#6b7280",
  recebido: "#29abe2",
  a_receber: "#0071bc",
  pago: "#22b14c", repassado: "#22b14c", aplicado: "#22b14c", resgatado: "#22b14c",
  a_pagar: "#ed1c24", a_repassar: "#ed1c24", a_aplicar: "#ed1c24", a_resgatar: "#ed1c24",
  aplicacao: "#f7b500", resgate: "#f7b500",
  provisionado: "#f7b500", provisionado_dl: "#f7b500", provisionado_dv: "#f7b500",
};

function fallbackEntry(codigo: string): StatusConfigEntry {
  const bg = FALLBACK_BG[codigo as StatusAramburu] ?? "#6b7280";
  return {
    codigo,
    label: STATUS_ARAMBURU_LABEL[codigo as StatusAramburu] ?? codigo,
    kind: STATUS_KIND[codigo as StatusAramburu] ?? "neutro",
    cor_bg: bg,
    cor_text: bg === "#f7b500" ? "#1c1917" : "#ffffff",
    ordem: 0,
    ativo: true,
    is_sistema: true,
  };
}

const FALLBACK_LIST: StatusConfigEntry[] = (Object.keys(STATUS_ARAMBURU_LABEL) as StatusAramburu[])
  .map((c, i) => ({ ...fallbackEntry(c), ordem: i + 1 }));

// ---- Store --------------------------------------------------------------------
let cache: Map<string, StatusConfigEntry> | null = null;
let snapshot: StatusConfigEntry[] = FALLBACK_LIST;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify() { for (const l of listeners) l(); }

function byOrdem(a: StatusConfigEntry, b: StatusConfigEntry): number {
  return (a.ordem - b.ordem) || a.codigo.localeCompare(b.codigo);
}

/** Carrega status_config (idempotente). Degrada para fallback se a tabela faltar. */
export async function ensureStatusConfigLoaded(force = false): Promise<void> {
  if (loadPromise && !force) return loadPromise;
  loadPromise = (async () => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase.from("status_config").select("*");
      if (error) throw error;
      const rows = (data ?? []).map((r): StatusConfigEntry => ({
        codigo: r.codigo,
        label: r.label,
        kind: r.kind,
        cor_bg: r.cor_bg,
        cor_text: r.cor_text,
        ordem: r.ordem ?? 0,
        ativo: r.ativo,
        is_sistema: r.is_sistema,
      }));
      if (rows.length > 0) {
        const sorted = [...rows].sort(byOrdem);
        cache = new Map(sorted.map((e) => [e.codigo, e]));
        snapshot = sorted;
        notify();
      }
    } catch {
      // Migration 0035 ainda não aplicada (tabela ausente) ou sem permissão de
      // leitura → mantém o fallback hardcoded. Não relança: o app continua ok.
    }
  })();
  return loadPromise;
}

/** Recarrega o cache do banco (após editar na tela de Configurações). */
export function reloadStatusConfig(): Promise<void> {
  loadPromise = null;
  return ensureStatusConfigLoaded(true);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  void ensureStatusConfigLoaded(); // dispara o carregamento ao primeiro uso
  return () => { listeners.delete(cb); };
}

// ---- Getters síncronos (uso fora de componentes, ex.: exportação) -------------
export function getStatusEntry(codigo: string): StatusConfigEntry {
  return cache?.get(codigo) ?? fallbackEntry(codigo);
}
export function getStatusLabel(codigo: string): string { return getStatusEntry(codigo).label; }
export function getStatusKind(codigo: string): "entrada" | "saida" | "neutro" { return getStatusEntry(codigo).kind; }
export function getStatusColorStyle(codigo: string): { backgroundColor: string; color: string } {
  const e = getStatusEntry(codigo);
  return { backgroundColor: e.cor_bg, color: e.cor_text };
}

// ---- Hook reativo (componentes) ------------------------------------------------
export function useStatusConfig(): { entries: StatusConfigEntry[]; map: Map<string, StatusConfigEntry> } {
  const entries = useSyncExternalStore(subscribe, () => snapshot, () => FALLBACK_LIST);
  const map = useMemo(() => new Map(entries.map((e) => [e.codigo, e])), [entries]);
  return { entries, map };
}

/** Lista os status ATIVOS, ordenados — para preencher dropdowns/seleções. */
export function useStatusAtivos(): StatusConfigEntry[] {
  const { entries } = useStatusConfig();
  return useMemo(() => entries.filter((e) => e.ativo), [entries]);
}
