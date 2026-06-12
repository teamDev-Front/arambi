// Tipos de payload para cada um dos 4 templates do PDFMonkey
// (espelham exatamente os JSONs em /jsons-pdf-monkey/* aprovados na reunião de 15/05).

import type { Json, PdfMonkeySlug } from "@/types";

// ============================================================================
// Capa Empresa
// ============================================================================
export interface CapaEmpresaItem {
  vencimento: string;
  valor: string;
  descricao: string;
  banco: string;
  pgto?: string;
}

/** Total movimentado em um banco no mês. O template PDFMonkey itera sobre `bancos[]`. */
export interface BancoTotal {
  /** Apelido exibível (ex.: "Cora", "Sicredi MJU") */
  nome: string;
  /** Nome completo / razão (ex.: "Banco Cora (0001)") */
  nome_completo?: string;
  /** Slug em snake-case para CSS opcional no template ("cora", "sicredi", "inter"…) */
  slug?: string;
  /** Total já formatado em BRL (ex.: "R$ 383.184,43") */
  total: string;
}

export interface CapaEmpresaPayload {
  empresa: string;
  cnpj: string;
  fazenda: string;
  mes_referencia: string;
  numero_mes: string;            // "1º"
  realizado_em: string;
  preparado_por: string;
  /** Lista dinâmica de bancos com totais do mês — substituiu o par fixo Cora/Sicredi. */
  bancos: BancoTotal[];
  total_geral: string;
  despesas_fixas: CapaEmpresaItem[];
  total_fixas: string;
  despesas_variaveis: CapaEmpresaItem[];
  total_variaveis: string;
  despesas_eventuais: CapaEmpresaItem[];
  total_eventuais: string;
}

// ============================================================================
// Capa Sócio
// ============================================================================
export interface CapaSocioItem {
  vencimento: string;
  valor: string;
  descricao: string;
  banco: string;
}

export interface CapaSocioContaItem {
  banco: string;
  agencia: string;
  numero: string;
  tipo: string;
}

export interface CapaSocioPayload {
  nome_socio: string;
  cpf_socio: string;
  fazenda: string;
  mes_referencia: string;
  numero_mes: string;
  realizado_em: string;
  preparado_por: string;
  periodo: string;

  imovel: CapaSocioItem[];
  total_imovel: string;

  familia: CapaSocioItem[];
  total_familia: string;

  renda_mensal: CapaSocioItem[];
  total_renda_mensal: string;

  despesas_pessoais: CapaSocioItem[];
  total_despesas_pessoais: string;

  fazenda_aramburu: CapaSocioItem[];
  total_fazenda_aramburu: string;
  obs_fazenda: string;

  contratos_venda: CapaSocioItem[];
  total_contratos_venda: string;

  contas_socio: CapaSocioContaItem[];

  /** Lista dinâmica de bancos com totais do mês — substituiu o par fixo Cora/Sicredi. */
  bancos: BancoTotal[];
  total_geral: string;
}

// ============================================================================
// Relatório Contábil (estrutura recursiva por bloco/banco/categoria)
// ============================================================================
export interface ContabilTransacao {
  data: string;
  nome: string;
  detalhe: string;
  valor: string;
  has_nota: boolean;
  nota: string | null;
}

export interface ContabilSubcategoria {
  codigo: string;
  nome: string;
  total: string;
  transacoes: ContabilTransacao[];
}

export interface ContabilCategoria {
  codigo: string;
  nome: string;
  total: string;
  nota_geral: string | null;
  nota: string | null;
  subcategorias: ContabilSubcategoria[];
}

export interface ContabilBloco {
  tipo_secao: "ENTRADAS" | "SAÍDAS";
  banco: string;
  banco_tipo: string;                  // "cora" | "sicredi" | "inter" | "xp"
  nota_bloco: string | null;
  categorias: ContabilCategoria[];
}

export interface ContabilObservacao {
  titulo: string;
  texto: string;
}

export interface RelatorioContabilPayload {
  empresa: string;
  mes: string;                          // "DEZEMBRO 2025"
  preparado_por: string;
  observacoes: ContabilObservacao[];
  blocos: ContabilBloco[];
}

// ============================================================================
// Relatório Sócios (Canva-style infográfico)
// ============================================================================
export interface DonutSegment { cor: string; dash: number; rot: number }
export interface EntradaItem { label: string; valor: string; cor: string; altura: number }
export interface ReceitaItem {
  cultura: string; emoji: string; valor: string; sacas: string;
  pct: number; pct_txt: string; ring_dash: number; cor: string;
}
export interface SaidaItem {
  label: string; valor: string; pct: string;
  cor_classe: string; cor_hex: string; dash: number; rot: number;
}
export interface ObraCategoria { label: string; valor: string; pct: string; cor: string; icone: string }
export interface ObraBarra { cor: string; altura: number }
export interface SaidaDistItem { label: string; valor: string; pct: number; cor: string; dash: number; rot: number }
export interface DistribCategoria { label: string; valor: string; pct: number; cor: string }
export interface DistribAramburu {
  label: string; sub: string; valor: string; pct: number;
  cor: string; dash: number; rot: number;
}
export interface ArmazenagemItem { cultura: string; emoji: string; valor: string; rotulo: string; cor: string }

export interface RelatorioSociosPayload {
  fazenda: string;
  tipo_relatorio: string;               // "RELATÓRIO FINANCEIRO"
  mes: string;                          // "JANEIRO DE 2026"
  preparado_por: string;
  visao_geral: {
    receita: string;
    resgate: string;
    aplicacao: string;
    total_despesas: string;
    distribuicao_lucro: string;
    fazenda_aramburu: string;
    donut_segments: DonutSegment[];
    donut_r: number;
    donut_cx: number;
    donut_cy: number;
    saldo_inicial_texto: string;
  };
  entradas: { itens: EntradaItem[]; nota: string };
  receitas: ReceitaItem[];
  saidas: { itens: SaidaItem[]; nota: string };
  obra_sede: { categorias: ObraCategoria[]; barra: ObraBarra[]; nota: string };
  despesas_classificacao: {
    fixas:      { valor: string; pct: number; cor: string; dash: number; rot: number };
    variaveis:  { valor: string; pct: number; cor: string; dash: number; rot: number };
    eventuais:  { valor: string; pct: number; cor: string; dash: number; rot: number };
    periodicas: { valor: string; pct: number; cor: string; dash: number; rot: number };
    realizado_pct: number;
    realizado_ring_dash: number;
    saldo: string;
    donut_segs: DonutSegment[];
    nota: string;
  };
  impostos: {
    administrativa: { label: string; sub: string; valor: string };
    folha:          { label: string; sub: string; valor: string };
    realizado: string;
    nota: string;
  };
  armazenagem: ArmazenagemItem[];
  saidas_distribuicao: { itens: SaidaDistItem[] };
  distribuicao_lucro: { categorias: DistribCategoria[]; meses: string[]; nota: string };
  distribuicao_aramburu: DistribAramburu[];
}

/** Subset de `RelatorioSociosPayload` que o front pode sobrescrever no modal de geração. */
export interface RelatorioSociosOverrides {
  saldo_inicial_texto?: string;
  nota_entradas?:            string;
  nota_saidas?:              string;
  nota_obra_sede?:           string;
  nota_despesas_classif?:    string;
  nota_impostos?:            string;
  nota_distribuicao_lucro?:  string;
  obs_fazenda?:              string;
}

// ============================================================================
// Escopo do relatório (RF-FIN-09) — recorte real escolhido pela Lola
// ============================================================================
// O relatório deixa de ser sempre "o mês inteiro": passa a respeitar os filtros
// aplicados na tela Financeiro OU os lançamentos selecionados manualmente.
// Precedência: seleção manual (por_selecao) > filtros (por_filtros) > mês.
export type ReportScopeType = "por_mes" | "por_filtros" | "por_selecao";

export interface ReportScopeFiltros {
  mes_referencia?: string;          // "YYYY-MM"
  search?: string;                  // descrição/fornecedor/ref
  status?: string | string[];       // status_aramburu (1 ou vários)
  conta_contabil_cod?: string;      // "2.7"
  centro_custo_cod?: string[];      // multi-seleção
  conta_bancaria_id?: string;
  data_de?: string;                 // "YYYY-MM-DD"
  data_ate?: string;                // "YYYY-MM-DD"
}

export interface ReportScope {
  scope_type: ReportScopeType;
  filtros?: ReportScopeFiltros;
  /** Ids dos lançamentos selecionados manualmente (têm precedência sobre filtros). */
  transacao_ids?: string[];
  /** Resumo calculado na revisão (somente para auditoria em scope_applied). */
  totais?: {
    qtd_lancamentos?: number;
    total?: number;
    contas?: string[];
    centros?: string[];
    status?: string[];
  };
}

// ============================================================================
// Mapeamento slug → tipo de payload
// ============================================================================
export type PayloadPorSlug = {
  capa_empresa:       CapaEmpresaPayload;
  capa_socio:         CapaSocioPayload;
  relatorio_contabil: RelatorioContabilPayload;
  relatorio_socios:   RelatorioSociosPayload;
};

export type AnyPayload = PayloadPorSlug[PdfMonkeySlug];

// O PDFMonkey aceita JSON arbitrário no campo payload
export function payloadToJson(p: AnyPayload): Json {
  return JSON.parse(JSON.stringify(p)) as Json;
}
