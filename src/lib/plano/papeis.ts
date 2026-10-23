// Papéis do Plano de Contas — o sistema procura as contas pela FUNÇÃO, não
// pelo número (out-2026).
//
// Até aqui, 28 códigos do Plano de Contas não podiam mudar: automações do
// banco e relatórios procuravam "2.8" (DL), "1.8" (resgate), "2.7.2" (obra)…
// pelo NÚMERO. A migration 0066 cria `classificacao_papel` (papel → código,
// FK com ON UPDATE CASCADE): trocar o código de uma conta leva o papel junto,
// e quem procura pelo papel acompanha sozinho.
//
// Este módulo é o lado TypeScript disso:
//   • `Papel` — as chaves (contrato com a 0066; não renomear);
//   • `PAPEIS_PADRAO` — os códigos de hoje, os mesmos que a 0066 semeia;
//   • `carregarPapeis(supabase)` — o mapa do banco, completado pelo padrão.
// Sem a tabela (0066 ainda não aplicada) a leitura devolve o padrão, então o
// sistema se comporta igual antes e depois do SQL.
//
// Isomórfico: os builders de PDF (servidor) passam o client da sessão; as
// telas usam o cache/hook de ./papeis-client (usePapeis, obterPapeis).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/** Chaves dos papéis — mesmas da tabela `classificacao_papel` (0066). */
export const PAPEIS = [
  "receita_parceria",
  "venda_soja",
  "venda_milho",
  "receita_subprodutos",
  "estorno",
  "resgate",
  "resgate_sicredi",
  "transf_recebidas_conta",
  "transf_recebidas",
  "outros_recebimentos",
  "desp_administrativas",
  "taxas_impostos",
  "desp_pessoal",
  "encargos_sociais",
  "operacao",
  "energia",
  "servicos_terceiros",
  "taxa_armazenagem",
  "financeiras",
  "investimento_capital",
  "imobilizado",
  "obra",
  "dl",
  "dl_lucros",
  "transf_enviadas_conta",
  "transf_enviadas",
  "outras_saidas",
  "dv_saldo",
] as const;

export type Papel = (typeof PAPEIS)[number];

/** Mapa papel → código (o resolvido para a geração/tela em curso). */
export type MapaPapeis = Readonly<Record<Papel, string>>;

/**
 * Códigos de hoje (plano alinhado à VS4, migration 0063) — reserva enquanto a
 * 0066 não estiver aplicada e base do que ela semeia.
 */
export const PAPEIS_PADRAO: MapaPapeis = Object.freeze({
  receita_parceria:       "1.2",
  venda_soja:             "1.2.1",
  venda_milho:            "1.2.2",
  receita_subprodutos:    "1.3",
  estorno:                "1.6",
  resgate:                "1.8",
  resgate_sicredi:        "1.8.1",
  transf_recebidas_conta: "1.9",
  transf_recebidas:       "1.9.1",
  outros_recebimentos:    "1.10",
  desp_administrativas:   "2.1",
  taxas_impostos:         "2.1.6",
  desp_pessoal:           "2.2",
  encargos_sociais:       "2.2.2",
  operacao:               "2.3",
  energia:                "2.3.2",
  servicos_terceiros:     "2.4",
  taxa_armazenagem:       "2.4.5",
  financeiras:            "2.5",
  investimento_capital:   "2.6",
  imobilizado:            "2.7",
  obra:                   "2.7.2",
  dl:                     "2.8",
  dl_lucros:              "2.8.1",
  transf_enviadas_conta:  "2.9",
  transf_enviadas:        "2.9.1",
  outras_saidas:          "2.10",
  dv_saldo:               "2.10.3",
});

const CONJUNTO_PAPEIS: ReadonlySet<string> = new Set(PAPEIS);

export function ehPapel(v: unknown): v is Papel {
  return typeof v === "string" && CONJUNTO_PAPEIS.has(v);
}

/** Papel é sempre conta (1.2) ou centro de custo (1.2.1) — nunca a raiz. */
const RE_CODIGO_PAPEL = /^\d+(\.\d+){1,2}$/;

/**
 * Erro do PostgREST/Postgres de "tabela não existe" — a 0066 ainda não foi
 * aplicada. Mesmo critério de obterConfigApp (Configurações → Automações).
 */
export function ehTabelaAusente(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  if (e.code === "PGRST205" || e.code === "42P01") return true;
  return /does not exist|schema cache|find the table/i.test(e.message ?? "");
}

export interface PapeisCarregados {
  /** Papel → código: o do banco, completado pelo padrão no que faltar. */
  papeis: Record<Papel, string>;
  /**
   * "banco": veio de classificacao_papel; "padrao": tabela ausente (0066 não
   * aplicada), vazia ou ilegível — o mapa é o PAPEIS_PADRAO.
   */
  origem: "banco" | "padrao";
  /** Descrição de cada papel (coluna `descricao`), quando a tabela tem. */
  descricoes: Partial<Record<Papel, string>>;
  /** Falha de leitura que NÃO é "tabela ausente" (o mapa caiu no padrão). */
  erro: string | null;
}

type LinhaPapel = { papel: unknown; codigo: unknown; descricao: unknown };

/**
 * Lê `classificacao_papel` e devolve o mapa completo + a origem. Nunca lança:
 * sem a tabela (ou com falha de leitura) devolve o padrão — com `erro`
 * preenchido quando a falha não for a tabela ausente.
 */
export async function carregarPapeisDetalhado(supabase: SupabaseClient<Database>): Promise<PapeisCarregados> {
  const papeis: Record<Papel, string> = { ...PAPEIS_PADRAO };
  const descricoes: Partial<Record<Papel, string>> = {};
  let data: LinhaPapel[] | null = null;
  try {
    const r = await supabase.from("classificacao_papel").select("papel, codigo, descricao");
    if (r.error) {
      if (ehTabelaAusente(r.error)) return { papeis, origem: "padrao", descricoes, erro: null };
      return { papeis, origem: "padrao", descricoes, erro: r.error.message || "Falha ao ler classificacao_papel." };
    }
    data = (r.data ?? []) as LinhaPapel[];
  } catch (e) {
    return { papeis, origem: "padrao", descricoes, erro: (e as Error)?.message ?? String(e) };
  }

  let lidos = 0;
  for (const r of data) {
    if (!ehPapel(r.papel)) continue; // papel que esta versão do app não conhece
    const codigo = typeof r.codigo === "string" ? r.codigo.trim() : "";
    if (!RE_CODIGO_PAPEL.test(codigo)) continue;
    papeis[r.papel] = codigo;
    if (typeof r.descricao === "string" && r.descricao.trim()) descricoes[r.papel] = r.descricao.trim();
    lidos += 1;
  }
  return { papeis, origem: lidos > 0 ? "banco" : "padrao", descricoes, erro: null };
}

/** Papel → código, do banco (0066) ou o padrão sem ela. Nunca lança. */
export async function carregarPapeis(supabase: SupabaseClient<Database>): Promise<Record<Papel, string>> {
  return (await carregarPapeisDetalhado(supabase)).papeis;
}

/** `codigo` é `base` ou está dentro dela por segmento: 2.8 → 2.8 e 2.8.1, nunca 2.80. */
export function ehOuDentroDe(codigo: string | null | undefined, base: string): boolean {
  if (!codigo || !base) return false;
  return codigo === base || codigo.startsWith(base + ".");
}

/** Papel do código (cada código tem no máximo um — `codigo` é único na tabela). */
export function papelDoCodigo(codigo: string, papeis: MapaPapeis): Papel | null {
  for (const p of PAPEIS) if (papeis[p] === codigo) return p;
  return null;
}

/** Os dois mapas apontam os mesmos códigos? */
export function mesmosPapeis(a: MapaPapeis, b: MapaPapeis): boolean {
  return PAPEIS.every((p) => a[p] === b[p]);
}
