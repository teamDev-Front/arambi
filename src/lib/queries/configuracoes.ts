// Queries do módulo Configurações (Admin).
// Roda no client (browser). Escrita é protegida por RLS (somente admin —
// policy *_admin com fn_is_admin() em classificacao_financeira).

import { createClient } from "@/lib/supabase/client";
import type { ClassificacaoFinanceiraRow, NaturezaConta, StatusConfigRow } from "@/types";

// ----------------------------------------------------------------------------
// Helpers de código (plano de contas: "1", "1.1", "1.1.3", "2.7.2")
// ----------------------------------------------------------------------------

/** Ordena códigos numericamente por segmento: 1 < 1.1 < 1.1.2 < 1.2 < 2 < 2.10. */
export function compararCodigo(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10));
  const pb = b.split(".").map((n) => parseInt(n, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = Number.isFinite(pa[i]) ? pa[i] : -1;
    const y = Number.isFinite(pb[i]) ? pb[i] : -1;
    if (x !== y) return x - y;
  }
  return 0;
}

/** Deriva nível (qtd de segmentos) e código-pai a partir do código. */
export function derivarNivelParent(codigo: string): { nivel: number; parent: string | null } {
  const segs = codigo.split(".").filter((s) => s.length > 0);
  const nivel = segs.length;
  const parent = nivel > 1 ? segs.slice(0, -1).join(".") : null;
  return { nivel, parent };
}

/** Natureza sugerida pela raiz do código (1 = entrada, 2 = saída). */
export function naturezaSugerida(codigo: string): NaturezaConta {
  return codigo.trim().startsWith("2") ? "saida" : "entrada";
}

const RE_CODIGO = /^\d+(\.\d+){0,2}$/; // 1 a 3 níveis, só dígitos e pontos

/** Valida o formato e a consistência do código. Retorna mensagem de erro ou null. */
export function validarCodigo(codigo: string): string | null {
  const c = codigo.trim();
  if (!c) return "Informe o código.";
  if (!RE_CODIGO.test(c)) return "Código inválido. Use o formato 1, 1.1 ou 1.1.3 (até 3 níveis).";
  if (derivarNivelParent(c).nivel > 3) return "O plano de contas só vai até o 3º nível.";
  return null;
}

// ----------------------------------------------------------------------------
// CRUD de classificações
// ----------------------------------------------------------------------------
export interface ClassificacaoFormPayload {
  codigo: string;
  nome: string;
  natureza: NaturezaConta;
  ordem: number | null;
  ativo: boolean;
}

/** Lista TODAS (ativas + inativas), ordenadas por código numérico. */
export async function listarClassificacoesAdmin(): Promise<ClassificacaoFinanceiraRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from("classificacao_financeira").select("*");
  if (error) throw error;
  return [...((data ?? []) as ClassificacaoFinanceiraRow[])].sort((a, b) => compararCodigo(a.codigo, b.codigo));
}

export async function criarClassificacao(p: ClassificacaoFormPayload): Promise<ClassificacaoFinanceiraRow> {
  const supabase = createClient();
  const codigo = p.codigo.trim();
  const { nivel, parent } = derivarNivelParent(codigo);

  // Garante que o pai exista (FK também barra, mas damos erro mais claro).
  if (parent) {
    const { data: pai } = await supabase.from("classificacao_financeira").select("codigo").eq("codigo", parent).maybeSingle();
    if (!pai) throw new Error(`A conta-pai "${parent}" não existe. Crie-a antes de "${codigo}".`);
  }

  const { data, error } = await supabase
    .from("classificacao_financeira")
    .insert({ codigo, nome: p.nome.trim(), natureza: p.natureza, parent_codigo: parent, nivel, ordem: p.ordem, ativo: p.ativo })
    .select()
    .maybeSingle();
  if (error) {
    if (error.code === "23505") throw new Error(`O código "${codigo}" já existe.`);
    throw error;
  }
  if (!data) throw new Error("Não foi possível criar — sua conta precisa ser administradora.");
  return data as ClassificacaoFinanceiraRow;
}

/** Atualiza o cadastro. NÃO altera o código (é PK + alvo de FKs). */
export async function atualizarClassificacao(
  codigo: string,
  p: { nome: string; natureza: NaturezaConta; ordem: number | null; ativo: boolean },
): Promise<ClassificacaoFinanceiraRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("classificacao_financeira")
    .update({ nome: p.nome.trim(), natureza: p.natureza, ordem: p.ordem, ativo: p.ativo })
    .eq("codigo", codigo)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Não foi possível atualizar — sua conta precisa ser administradora.");
  return data as ClassificacaoFinanceiraRow;
}

export async function setAtivoClassificacao(codigo: string, ativo: boolean): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("classificacao_financeira")
    .update({ ativo })
    .eq("codigo", codigo)
    .select("codigo");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Não foi possível alterar — sua conta precisa ser administradora.");
}

export interface UsoClassificacao { transacoes: number; filhos: number; total: number }

/** Conta quantos lançamentos e quantos filhos referenciam este código. */
export async function contarUsoClassificacao(codigo: string): Promise<UsoClassificacao> {
  const supabase = createClient();
  const [txConta, txCentro, filhos] = await Promise.all([
    supabase.from("transacoes_empresa").select("id", { count: "exact", head: true }).eq("conta_contabil_cod", codigo),
    supabase.from("transacoes_empresa").select("id", { count: "exact", head: true }).eq("centro_custo_cod", codigo),
    supabase.from("classificacao_financeira").select("codigo", { count: "exact", head: true }).eq("parent_codigo", codigo),
  ]);
  const transacoes = (txConta.count ?? 0) + (txCentro.count ?? 0);
  const f = filhos.count ?? 0;
  return { transacoes, filhos: f, total: transacoes + f };
}

/** Exclusão física — só funciona se nada referenciar o código (FK/ON DELETE barra). */
export async function excluirClassificacao(codigo: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("classificacao_financeira")
    .delete()
    .eq("codigo", codigo)
    .select("codigo");
  if (error) {
    if (error.code === "23503") throw new Error("Em uso por lançamentos ou subcategorias — inative em vez de excluir.");
    throw error;
  }
  if (!data || data.length === 0) throw new Error("Não foi possível excluir — em uso ou sem permissão de admin.");
}

// ----------------------------------------------------------------------------
// Status & Cores (tabela status_config — migration 0035)
// ----------------------------------------------------------------------------
export type StatusKind = "entrada" | "saida" | "neutro";

export interface StatusConfigForm {
  label: string;
  kind: StatusKind;
  cor_bg: string;
  cor_text: string;
  ordem: number | null;
  ativo: boolean;
}

/** Slug seguro para virar valor de enum: minúsculas, sem acento, com "_". */
export function slugStatus(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export async function listarStatusConfig(): Promise<StatusConfigRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from("status_config").select("*");
  if (error) throw error;
  return [...((data ?? []) as StatusConfigRow[])].sort(
    (a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || a.codigo.localeCompare(b.codigo),
  );
}

export async function atualizarStatusConfig(codigo: string, p: StatusConfigForm): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("status_config")
    .update({ label: p.label.trim(), kind: p.kind, cor_bg: p.cor_bg, cor_text: p.cor_text, ordem: p.ordem, ativo: p.ativo })
    .eq("codigo", codigo)
    .select("codigo");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Não foi possível salvar — precisa ser admin (ou aplique a migration 0035).");
}

export async function setAtivoStatus(codigo: string, ativo: boolean): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.from("status_config").update({ ativo }).eq("codigo", codigo).select("codigo");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Não foi possível alterar — precisa ser admin.");
}

export interface NovoStatusPayload {
  codigo: string;
  label: string;
  kind: StatusKind;
  cor_bg: string;
  cor_text: string;
  ordem: number | null;
}

/** Adiciona um status novo (ALTER TYPE no enum + linha de apresentação) via RPC. */
export async function adicionarStatus(p: NovoStatusPayload): Promise<void> {
  const supabase = createClient();
  // .rpc tipado como never (Functions é Record<string, never>), igual ao padrão
  // já usado em /api/documentos/gerar.
  const { error } = await supabase.rpc("fn_status_add" as never, {
    p_codigo: p.codigo,
    p_label: p.label,
    p_kind: p.kind,
    p_cor_bg: p.cor_bg,
    p_cor_text: p.cor_text,
    p_ordem: p.ordem,
  } as never);
  if (error) {
    throw new Error(
      (error as { message?: string }).message ??
        "Falha ao adicionar status (precisa ser admin e a migration 0035 aplicada).",
    );
  }
}

// ----------------------------------------------------------------------------
// Configurações gerais (app_config — migration 0047, Configurações → Automações)
// ----------------------------------------------------------------------------
export const CONFIG_RESGATES_SICREDI = "resgates_automaticos_sicredi";

/** Lê uma configuração; retorna o fallback se não existir (ou tabela ausente). */
export async function obterConfigApp(chave: string, fallback: string): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("app_config")
    .select("valor")
    .eq("chave", chave)
    .maybeSingle();
  if (error) {
    // Migration 0047 ainda não aplicada → comporta-se como o padrão.
    if (/does not exist|schema cache|find the table/i.test(error.message)) return fallback;
    throw error;
  }
  return (data as { valor: string } | null)?.valor ?? fallback;
}

export async function salvarConfigApp(chave: string, valor: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("app_config")
    .upsert({ chave, valor })
    .select("chave");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("Não foi possível salvar — sua conta precisa ser administradora (e a migration 0047 aplicada).");
  }
}

// ----------------------------------------------------------------------------
// Papel do usuário atual (para gating de UI). Escrita real é barrada por RLS.
// ----------------------------------------------------------------------------
export async function obterRoleAtual(): Promise<string | null> {
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase.from("users").select("role").eq("id", auth.user.id).maybeSingle();
  return (data?.role as string | undefined) ?? null;
}
