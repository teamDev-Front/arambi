// Queries do módulo Operação de Campo (dashboard admin — migration 0041):
// talões, abastecimentos, discrepâncias e saldo dos reservatórios.
// Leitura via RLS autenticada; escrita admin+editor.

import { createClient } from "@/lib/supabase/client";
import type {
  TalaoUsoRow, AbastecimentoRow, ReservatorioEntradaRow, CombustivelFonte,
} from "@/types";

export type TalaoRich = TalaoUsoRow & {
  colaboradores: { nome: string } | null;
  equipamentos: { codigo: string; nome: string; medidor_tipo: string } | null;
};

export type AbastecimentoRich = AbastecimentoRow & {
  colaboradores: { nome: string } | null;
  equipamentos: { codigo: string; nome: string } | null;
};

export async function listarTaloes(limite = 200): Promise<TalaoRich[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("talao_usos")
    .select("*, colaboradores(nome), equipamentos(codigo, nome, medidor_tipo)")
    .order("inicio_em", { ascending: false })
    .limit(limite);
  if (error) throw error;
  return (data ?? []) as unknown as TalaoRich[];
}

export async function listarAbastecimentos(limite = 200): Promise<AbastecimentoRich[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("abastecimentos")
    .select("*, colaboradores(nome), equipamentos(codigo, nome)")
    .order("data", { ascending: false })
    .limit(limite);
  if (error) throw error;
  return (data ?? []) as unknown as AbastecimentoRich[];
}

/** Marca a discrepância de um talão como regularizada ("foi meu pai..."). */
export async function regularizarDiscrepancia(talaoId: string, obs: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("talao_usos")
    .update({ discrepancia_regularizada: true, regularizada_obs: obs.trim() || null })
    .eq("id", talaoId)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Não foi possível regularizar — sem permissão de escrita.");
}

// ----------------------------------------------------------------------------
// Reservatórios (saldo = entradas - abastecimentos da fonte)
// ----------------------------------------------------------------------------
export interface SaldoReservatorio {
  fonte: CombustivelFonte;
  entradas: number;
  saidas: number;
  saldo: number;
}

export async function listarEntradasReservatorio(): Promise<ReservatorioEntradaRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("reservatorio_entradas")
    .select("*")
    .order("data", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ReservatorioEntradaRow[];
}

export async function saldosReservatorios(): Promise<SaldoReservatorio[]> {
  const supabase = createClient();
  const [entradasR, saidasR] = await Promise.all([
    supabase.from("reservatorio_entradas").select("fonte, litros"),
    supabase.from("abastecimentos").select("fonte, litros"),
  ]);
  if (entradasR.error) throw entradasR.error;
  if (saidasR.error) throw saidasR.error;

  const fontes: CombustivelFonte[] = ["tanque_diesel", "container_gasolina"];
  return fontes.map((fonte) => {
    const entradas = (entradasR.data ?? [])
      .filter((e) => e.fonte === fonte)
      .reduce((s, e) => s + Number(e.litros), 0);
    const saidas = (saidasR.data ?? [])
      .filter((a) => a.fonte === fonte)
      .reduce((s, a) => s + Number(a.litros), 0);
    return { fonte, entradas, saidas, saldo: entradas - saidas };
  });
}

export async function criarEntradaReservatorio(p: {
  fonte: CombustivelFonte; data: string; litros: number; observacao: string | null;
}): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.from("reservatorio_entradas").insert(p).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Não foi possível registrar — sem permissão de escrita.");
}

export async function excluirEntradaReservatorio(id: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.from("reservatorio_entradas").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Não foi possível excluir — sem permissão de escrita.");
}
