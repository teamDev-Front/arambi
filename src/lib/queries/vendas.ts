// Queries do módulo Vendas Futuras / Provisionamento.

import { createClient } from "@/lib/supabase/client";
import type {
  CulturaSafra,
  VendaProvisionadaRichRow,
  VendaStatus,
  Database,
} from "@/types";

type VpInsert = Database["public"]["Tables"]["vendas_provisionadas"]["Insert"];
type VpUpdate = Database["public"]["Tables"]["vendas_provisionadas"]["Update"];

export interface ListarVendasFiltros {
  search?: string;
  status?: VendaStatus | "";
  cultura?: CulturaSafra | "";
  safra?: string;
  destino?: "empresa" | "socio" | "";
  socioId?: string;
  mesRecebimento?: string;
  trimestre?: string;
}

export async function listarVendas(filtros: ListarVendasFiltros = {}): Promise<VendaProvisionadaRichRow[]> {
  const supabase = createClient();
  let q = supabase
    .from("v_vendas_provisionadas")
    .select("*")
    .order("data_pgto_prevista", { ascending: true });

  if (filtros.search) {
    const s = filtros.search.replace(/[%_,]/g, " ").trim();
    if (s) {
      q = q.or(
        `comprador.ilike.%${s}%,numero_contrato.ilike.%${s}%,nota_fiscal.ilike.%${s}%,aut_fixacao.ilike.%${s}%,observacao.ilike.%${s}%`
      );
    }
  }
  if (filtros.status)         q = q.eq("status", filtros.status);
  if (filtros.cultura)        q = q.eq("cultura", filtros.cultura);
  if (filtros.safra)          q = q.eq("safra", filtros.safra);
  if (filtros.destino === "empresa") q = q.eq("destino_empresa", true);
  if (filtros.destino === "socio")   q = q.eq("destino_empresa", false);
  if (filtros.socioId)        q = q.eq("socio_destino_id", filtros.socioId);
  if (filtros.mesRecebimento) q = q.eq("mes_recebimento", filtros.mesRecebimento);
  if (filtros.trimestre)      q = q.eq("trimestre_recebimento", filtros.trimestre);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as VendaProvisionadaRichRow[];
}

export async function criarVenda(payload: VpInsert): Promise<string> {
  const supabase = createClient();
  const { error, data } = await supabase
    .from("vendas_provisionadas")
    .insert(payload)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Falha ao criar venda (sem permissão?)");
  return (data as { id: string }).id;
}

export async function atualizarVenda(id: string, payload: VpUpdate): Promise<void> {
  const supabase = createClient();
  const { error, data } = await supabase
    .from("vendas_provisionadas")
    .update(payload)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Falha ao atualizar venda");
}

export async function deletarVenda(id: string): Promise<void> {
  const supabase = createClient();
  const { error, data } = await supabase
    .from("vendas_provisionadas")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Venda não encontrada ou sem permissão");
}

/**
 * Muda o status de várias vendas de uma vez (seleção múltipla — ajuste 27-jul).
 * UPDATE único; retorna quantas foram de fato alteradas (RLS pode bloquear).
 */
export async function atualizarStatusVendasEmMassa(ids: string[], status: VendaStatus): Promise<number> {
  if (ids.length === 0) return 0;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("vendas_provisionadas")
    .update({ status })
    .in("id", ids)
    .select("id");
  if (error) throw error;
  const n = data?.length ?? 0;
  if (n === 0) throw new Error("Nenhuma venda atualizada — verifique sua permissão (admin/editor).");
  return n;
}

/**
 * Exclui várias vendas de uma vez (seleção múltipla — ajuste 27-jul).
 * As baixas de estoque vinculadas devem ser desfeitas ANTES pelo chamador
 * (desfazerBaixasVenda), venda a venda.
 */
export async function deletarVendasEmMassa(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("vendas_provisionadas")
    .delete()
    .in("id", ids)
    .select("id");
  if (error) throw error;
  const n = data?.length ?? 0;
  if (n === 0) throw new Error("Nenhuma venda excluída — verifique sua permissão (admin/editor).");
  return n;
}

// ----------------------------------------------------------------------------
// Agregados
// ----------------------------------------------------------------------------
export interface VendasResumo {
  total_valor: number;
  total_sacas: number;
  total_firmadas: number;
  total_liquidadas: number;
  saldo_a_receber: number;     // soma valor onde status != liquidada/cancelada
  por_trimestre: Array<{ trimestre: string; valor: number; sacas: number }>;
  por_mes: Array<{ mes: string; valor: number; sacas: number }>;
  por_safra: Array<{ safra: string; valor: number; sacas: number }>;
}

export function calcularResumo(vendas: VendaProvisionadaRichRow[]): VendasResumo {
  let total_valor = 0, total_sacas = 0, total_firmadas = 0, total_liquidadas = 0, saldo_a_receber = 0;
  const aggTri = new Map<string, { valor: number; sacas: number }>();
  const aggMes = new Map<string, { valor: number; sacas: number }>();
  const aggSaf = new Map<string, { valor: number; sacas: number }>();

  for (const v of vendas) {
    total_valor += v.valor_total ?? 0;
    total_sacas += v.sacas ?? 0;
    if (v.status === "firmada") total_firmadas++;
    if (v.status === "liquidada") total_liquidadas++;
    if (v.status !== "liquidada" && v.status !== "cancelada") saldo_a_receber += v.valor_total ?? 0;

    const t = aggTri.get(v.trimestre_recebimento) ?? { valor: 0, sacas: 0 };
    t.valor += v.valor_total ?? 0; t.sacas += v.sacas ?? 0;
    aggTri.set(v.trimestre_recebimento, t);

    const m = aggMes.get(v.mes_recebimento) ?? { valor: 0, sacas: 0 };
    m.valor += v.valor_total ?? 0; m.sacas += v.sacas ?? 0;
    aggMes.set(v.mes_recebimento, m);

    const s = aggSaf.get(v.safra) ?? { valor: 0, sacas: 0 };
    s.valor += v.valor_total ?? 0; s.sacas += v.sacas ?? 0;
    aggSaf.set(v.safra, s);
  }

  return {
    total_valor, total_sacas, total_firmadas, total_liquidadas, saldo_a_receber,
    por_trimestre: Array.from(aggTri, ([trimestre, x]) => ({ trimestre, ...x }))
      .sort((a, b) => a.trimestre.localeCompare(b.trimestre)),
    por_mes: Array.from(aggMes, ([mes, x]) => ({ mes, ...x }))
      .sort((a, b) => a.mes.localeCompare(b.mes)),
    por_safra: Array.from(aggSaf, ([safra, x]) => ({ safra, ...x }))
      .sort((a, b) => a.safra.localeCompare(b.safra)),
  };
}
