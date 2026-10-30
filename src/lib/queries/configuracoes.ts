// Queries do módulo Configurações (Admin).
// Roda no client (browser). Escrita é protegida por RLS (somente admin —
// policy *_admin com fn_is_admin() em classificacao_financeira).

import { createClient } from "@/lib/supabase/client";
import {
  PAPEIS, PAPEIS_PADRAO, carregarPapeisDetalhado, ehOuDentroDe, papelDoCodigo,
  type MapaPapeis, type Papel,
} from "@/lib/plano/papeis";
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

/**
 * RESERVA da lista de códigos travados — a de verdade vem do banco
 * (fn_classificacao_codigos_sistema, ver carregarCodigosSistema). É a lista
 * das migrations 0057/0063 (os 28 códigos que automações e relatórios
 * procuravam PELO NÚMERO): vale só se a RPC falhar, para a tela nunca
 * destravar antes da 0066. Com a 0066, o sistema procura essas contas pelo
 * PAPEL (src/lib/plano/papeis.ts), a RPC passa a devolver só as raízes 1 e 2
 * e esses códigos podem mudar.
 */
export const CODIGOS_DO_SISTEMA: ReadonlySet<string> = new Set([
  // automações do banco: resgate do Invest (1.8), DL (2.8), par de
  // transferência da DL (1.9.1 ↔ 2.9.1), saldo DV (2.10.3)
  "1.8", "1.8.1", "1.9", "1.9.1", "2.8", "2.8.1", "2.9", "2.9.1", "2.10.3",
  // relatórios PDF (capas, contábil, sócios) e telas de Vendas/Provisionamento
  "1.2", "1.2.1", "1.2.2", "1.3", "1.6", "1.10",
  "2.1", "2.1.6", "2.2", "2.2.2", "2.3", "2.3.2", "2.4", "2.4.5",
  "2.5", "2.6", "2.7", "2.7.2", "2.10",
]);

/**
 * O que a tela do Plano de Contas usa para travar/avisar — lido do BANCO ao
 * abrir (carregarTravasPlano). O servidor (fn_classificacao_trocar_codigo)
 * confere tudo de novo: a tela só reflete.
 */
export interface TravasPlano {
  /** fn_classificacao_codigos_sistema() — com a 0066, só as raízes 1 e 2. */
  codigosSistema: ReadonlySet<string>;
  /** Papel → código (classificacao_papel, 0066; sem ela, o padrão). */
  papeis: MapaPapeis;
  /** Descrição de cada papel, quando a tabela tem. */
  descricoesPapel: Partial<Record<Papel, string>>;
}

/** Antes de o banco responder (ou se ele falhar): tudo travado como hoje. */
export const TRAVAS_RESERVA: TravasPlano = {
  codigosSistema: CODIGOS_DO_SISTEMA,
  papeis: PAPEIS_PADRAO,
  descricoesPapel: {},
};

/** Contas com automação pela CONTA (papéis resgate e DL): centro de custo não entra nem sai delas trocando o código. */
function contasComAutomacao(papeis: MapaPapeis): string[] {
  return [papeis.resgate, papeis.dl];
}

/** Por que o código desta classificação não pode mudar (null = pode). */
export function motivoCodigoTravado(
  c: Pick<ClassificacaoFinanceiraRow, "codigo" | "nivel">,
  codigosSistema: ReadonlySet<string> = CODIGOS_DO_SISTEMA,
): string | null {
  if (c.nivel === 1) return "Os grupos raiz (1 Entradas e 2 Saídas) não mudam de código.";
  if (codigosSistema.has(c.codigo)) {
    return "Código usado pelas automações e relatórios do sistema — não pode ser alterado.";
  }
  const filho = [...codigosSistema].find((s) => s.startsWith(c.codigo + "."));
  if (filho) return `Contém ${filho}, usado pelas automações e relatórios do sistema — não pode ser alterado.`;
  return null;
}

const FIM_DICA_PAPEL = " — ao trocar o código, as automações e os relatórios acompanham.";

/**
 * Dica do modal para classificação com papel (não trava): o sistema a procura
 * pelo papel, então a troca de código não quebra automação nem relatório.
 * Conta sem papel próprio, mas com subcategoria que tem, avisa pela
 * subcategoria. null = nenhum papel envolvido.
 */
export function dicaPapelClassificacao(
  c: Pick<ClassificacaoFinanceiraRow, "codigo">,
  travas: Pick<TravasPlano, "papeis" | "descricoesPapel"> = TRAVAS_RESERVA,
): string | null {
  const proprio = papelDoCodigo(c.codigo, travas.papeis);
  if (proprio) {
    const desc = travas.descricoesPapel[proprio];
    return `Usado pelo sistema${desc ? `: ${desc}` : ""}${FIM_DICA_PAPEL}`;
  }
  const filho = PAPEIS
    .filter((p) => ehOuDentroDe(travas.papeis[p], c.codigo))
    .sort((a, b) => compararCodigo(travas.papeis[a], travas.papeis[b]))[0];
  if (!filho) return null;
  const desc = travas.descricoesPapel[filho];
  return `Contém ${travas.papeis[filho]}${desc ? ` (${desc})` : ""}, usado pelo sistema${FIM_DICA_PAPEL}`;
}

/**
 * Códigos travados, lidos do banco (fn_classificacao_codigos_sistema). Se a
 * RPC falhar ou responder algo inesperado, a reserva CODIGOS_DO_SISTEMA —
 * nunca destrava por engano.
 */
export async function carregarCodigosSistema(): Promise<ReadonlySet<string>> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("fn_classificacao_codigos_sistema" as never);
    if (error) return CODIGOS_DO_SISTEMA;
    const lista = data as unknown;
    if (!Array.isArray(lista) || !lista.every((c) => typeof c === "string")) return CODIGOS_DO_SISTEMA;
    return new Set(lista as string[]);
  } catch {
    return CODIGOS_DO_SISTEMA;
  }
}

/** Travas + papéis para a tela do Plano de Contas. Nunca lança (cai na reserva). */
export async function carregarTravasPlano(): Promise<TravasPlano> {
  const [codigosSistema, p] = await Promise.all([
    carregarCodigosSistema(),
    carregarPapeisDetalhado(createClient()),
  ]);
  return { codigosSistema, papeis: p.papeis, descricoesPapel: p.descricoes };
}

/** Confere a troca de código antes de ir ao banco (a RPC confere tudo de novo). */
export function validarTrocaCodigo(
  atual: ClassificacaoFinanceiraRow,
  novoCodigo: string,
  todas: ClassificacaoFinanceiraRow[],
  travas: Pick<TravasPlano, "codigosSistema" | "papeis"> = TRAVAS_RESERVA,
): string | null {
  const novo = novoCodigo.trim();
  const trava = motivoCodigoTravado(atual, travas.codigosSistema);
  if (trava) return trava;
  const erroFormato = validarCodigo(novo);
  if (erroFormato) return erroFormato;
  const { nivel, parent } = derivarNivelParent(novo);
  if (nivel !== atual.nivel) {
    return atual.nivel === 2
      ? "Precisa continuar como conta contábil (ex.: 1.11)."
      : "Precisa continuar como centro de custo (ex.: 1.11.2).";
  }
  const raiz = atual.codigo.split(".")[0];
  if (novo.split(".")[0] !== raiz) {
    return `Precisa continuar começando por ${raiz} (${raiz === "1" ? "Entradas" : "Saídas"}). Para mudar de grupo, crie uma classificação nova.`;
  }
  if (todas.some((r) => r.codigo === novo)) return `O código ${novo} já existe.`;
  if (parent && !todas.some((r) => r.codigo === parent)) return `A conta ${parent} não existe. Crie-a antes.`;
  const automacao = contasComAutomacao(travas.papeis);
  if (atual.nivel === 3 && parent !== atual.parent_codigo
      && (automacao.includes(atual.parent_codigo ?? "") || automacao.includes(parent ?? ""))) {
    return `Centro de custo não entra nem sai de ${travas.papeis.resgate} (Resgate) ou ${travas.papeis.dl} (DL) trocando o código — essas contas têm automações.`;
  }
  return null;
}

/** De-para que a troca aplica: o próprio código e as subcategorias (1.10.1 → 1.11.1). */
export function deParaTrocaCodigo(
  de: string,
  para: string,
  todas: ClassificacaoFinanceiraRow[],
): { de: string; para: string }[] {
  return todas
    .map((r) => r.codigo)
    .filter((c) => c === de || c.startsWith(de + "."))
    .sort(compararCodigo)
    .map((c) => ({ de: c, para: para + c.slice(de.length) }));
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

/** Atualiza o cadastro. O código muda por trocarCodigoClassificacao (PK + alvo de FKs). */
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

export interface ResultadoTrocaCodigo {
  codigos: { de: string; para: string }[];
  lancamentos: number;
  lixeira: number;
  mudou_conta: boolean;
}

/**
 * Troca o código (RPC da migration 0057): subcategorias renumeradas junto,
 * lançamentos e itens da Lixeira acompanham — tudo ou nada.
 */
export async function trocarCodigoClassificacao(de: string, para: string): Promise<ResultadoTrocaCodigo> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("fn_classificacao_trocar_codigo" as never, {
    p_de: de,
    p_para: para,
  } as never);
  if (error) {
    const e = error as { code?: string; message?: string };
    if (e.code === "PGRST202" || /could not find the function/i.test(e.message ?? "")) {
      throw new Error("Para trocar o código, a migration 0057 precisa estar aplicada no banco.");
    }
    throw new Error(e.message ?? "Não foi possível trocar o código.");
  }
  return data as unknown as ResultadoTrocaCodigo;
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
    if (error.code === "23503") {
      // FK da classificacao_papel (0066): o item é usado pelas automações/relatórios.
      if (/classificacao_papel/.test(`${error.message} ${error.details ?? ""}`)) {
        throw new Error("Usado pelo sistema (automações e relatórios) — não pode ser excluído. Troque o código ou o nome, ou inative.");
      }
      throw new Error("Em uso por lançamentos ou subcategorias — inative em vez de excluir.");
    }
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
/** Teto mensal de Despesas Variáveis — card DV do Financeiro (0048). */
export const CONFIG_LIMITE_DV = "limite_despesa_variavel_mensal";
/** Dia do vencimento da fatura do cartão Sicredi — resgate consolidado (0048). */
export const CONFIG_FATURA_CARTAO_DIA = "fatura_cartao_sicredi_dia";
/**
 * Conta de investimento de onde saem os resgates automáticos NOVOS (0064).
 * Valor = id da conta em Bancos; vazio = SICREDINVEST (padrão).
 */
export const CONFIG_RESGATE_CONTA_ORIGEM = "resgate_conta_origem";

/**
 * Regras dos resgates automáticos (0068 — Sicredinvest Automático, out-2026).
 * Padrão de cada chave = comportamento de antes da 0068.
 */
export const CONFIG_RESGATE = {
  /** Conta da linha mensal "Provisionados". Vazio = a mesma dos resgates do dia a dia. */
  contaProgramacao: "resgate_conta_programacao",
  /** Conta do resgate da fatura do cartão. Vazio = a mesma dos resgates do dia a dia. */
  contaFatura: "resgate_conta_fatura",
  /** "mesmo_dia" | "dia_util_anterior". */
  dataRegra: "resgate_data_regra",
  /** "dia" (um por dia) | "agendamento" (um por leva que foi ao banco junta). */
  agrupamento: "resgate_agrupamento",
  /** Descrição dos resgates do dia a dia. Vazio = texto antigo (obra da sede). */
  descricao: "resgate_descricao",
  /** "on" | "off" — observação automática nas linhas de resgate. */
  observacaoAtiva: "resgate_observacao_ativa",
  /** Texto da observação dos resgates do dia a dia. Vazio = texto antigo. */
  observacao: "resgate_observacao",
  /** "on" | "off" — aviso quando o resgate passa do saldo da conta de investimento. */
  validarSaldo: "resgate_validar_saldo",
} as const;

/**
 * Como `obterConfigApp`, mas devolve `null` quando a chave não existe — é assim
 * que a tela sabe que a migration que cria a chave ainda não foi aplicada.
 */
export async function obterConfigAppSeExistir(chave: string): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("app_config")
    .select("valor")
    .eq("chave", chave)
    .maybeSingle();
  if (error) {
    if (/does not exist|schema cache|find the table/i.test(error.message)) return null;
    throw error;
  }
  return (data as { valor: string } | null)?.valor ?? null;
}

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
