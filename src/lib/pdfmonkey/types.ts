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
  /**
   * Só nas compras no cartão de crédito (21-out): a linha aparece para
   * conferência, mas NÃO soma no subtotal da seção, nas caixas de banco nem no
   * total geral — sai na fatura, coberta pelo resgate "Fatura Cartão". Ausente
   * nas demais linhas.
   */
  informativo?: boolean;
}

/**
 * Caixa colorida do resumo por banco — contrato NOVO dos templates do
 * Humberley (DOCUMENTACAO_JSON.md, 04-set-2026): o template itera sobre
 * `totais_bancos[]`; o `label` vira o nome da caixa E escolhe cor + logo por
 * palavra-chave (cora, sicredi, bradesco, brasil, nubank, inter, xp, safra).
 * `valor` já vem formatado "R$ X.XXX,XX".
 */
export interface BancoTotalBox {
  label: string;
  valor: string;
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
  mes_referencia: string;        // "Julho" (manual 4.3 ou auto)
  numero_mes: string;            // "7º"   (lote manual 4.3 ou auto)
  realizado_em: string;
  preparado_por: string;
  /** "01/04 a 30/04/2026" — linha abaixo do badge dourado (template agendamento.html, 04-set). */
  periodo: string;
  /** Caixas coloridas do resumo por banco (template novo, 04-set). */
  totais_bancos: BancoTotalBox[];
  /** Lista dinâmica de bancos com totais do mês — substituiu o par fixo Cora/Sicredi. */
  bancos: BancoTotal[];
  // Subtotais por banco (4.6). Campos PLANOS reemitidos p/ compatibilidade com o
  // template CAPAS atual; `subtotais_bancos` é a versão genérica/escalável.
  banco_principal?: string;      // "CORA"
  banco_secundario?: string;     // "SICREDI"
  total_cora?: string;
  total_sicredi?: string;
  subtotais_bancos?: BancoTotal[];
  total_geral: string;
  despesas_fixas: CapaEmpresaItem[];
  total_fixas: string;
  despesas_variaveis: CapaEmpresaItem[];
  total_variaveis: string;
  despesas_eventuais: CapaEmpresaItem[];
  total_eventuais: string;
  /**
   * Seção 10 do DOCUMENTACAO_JSON.md (out-2026): saídas de Distribuição de
   * Lucro do recorte — a DL em si (2.8) e as pernas de saída do repasse
   * consolidado ("Transf. Entre Contas_Distribuição de Lucro": centro 2.9.3
   * antes da migration 0063, 2.9.1 depois — reconhecidas pela etiqueta).
   */
  distribuicao_lucro: CapaEmpresaItem[];
  total_distribuicao_lucro: string;
  /** Seção 10: resgates do Invest — só a SAÍDA da conta Invest (1.8 negativo). */
  resgates: CapaEmpresaItem[];
  total_resgates: string;
  /** Tipo de despesa "periódica" (29-out) — até aqui ficava fora da capa. */
  despesas_periodicas: CapaEmpresaItem[];
  total_periodicas: string;
  /**
   * Transferências entre as contas da empresa (29-out): uma linha por
   * transferência, pela perna que SAI (2.9), com `banco` "ORIGEM » DESTINO".
   * Somam na caixa do banco de origem e no total geral, como o resgate.
   */
  transferencias: CapaEmpresaItem[];
  total_transferencias: string;
  /** Saídas sem tipo de despesa fora de DL, resgate e transferência (29-out) — ex.: aplicações. */
  outras_saidas: CapaEmpresaItem[];
  total_outras_saidas: string;
  /**
   * Soma das compras no cartão de crédito listadas nas seções (itens com
   * `informativo: true`) — "R$ 0,00" quando não há. Fica FORA de total_geral.
   */
  total_cartao_informativo?: string;
  /** Texto explicando o cartão — vazio ("") quando não há compra no cartão. */
  nota_cartao?: string;
  /** Observações digitadas no modal da capa (uma por linha). Vazio = []. */
  observacoes?: ContabilObservacao[];
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

  /** Caixas coloridas do resumo por banco (template novo, 04-set). */
  totais_bancos: BancoTotalBox[];
  /** Lista dinâmica de bancos com totais do mês — substituiu o par fixo Cora/Sicredi. */
  bancos: BancoTotal[];
  total_geral: string;
  /** Observações digitadas no modal da capa (uma por linha). Vazio = []. */
  observacoes?: ContabilObservacao[];
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

/**
 * Observação livre do PDF: cartão do Relatório Contábil e, desde 21-out,
 * campo `observacoes` das capas (lá cada linha digitada vira um item com
 * `titulo` vazio).
 */
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

// Espelha ListarTransacoesFiltros (queries/financeiro.ts): a capa tem que sair
// com EXATAMENTE o recorte do relatório "Exportar PDF" da tela (out-2026 — sem
// competência em lista, tipo, forma de pgto e "só negativos" a capa recebia
// lançamentos que o relatório não lista, e o total geral não fechava).
export interface ReportScopeFiltros {
  mes_referencia?: string | string[]; // "YYYY-MM" — 1 ou várias (seletor multi desde 17-ago)
  search?: string;                  // descrição/fornecedor/ref
  status?: string | string[];       // status_aramburu (1 ou vários)
  conta_contabil_cod?: string | string[]; // "2.7" (1 ou várias — 23-jul)
  centro_custo_cod?: string[];      // multi-seleção
  conta_bancaria_id?: string | string[];  // 1 banco ou vários (23-jul)
  tipo_despesa?: string | string[]; // fixa/variavel/eventual/periodica (RF 31-jul)
  forma_pgto?: string | string[];   // RF 31-jul
  /** "Apenas o lado que sai" (17-ago) — separa a saída do Invest do crédito no SICREDI. */
  somente_negativos?: boolean;
  data_de?: string;                 // "YYYY-MM-DD" (vencimento)
  data_ate?: string;                // "YYYY-MM-DD"
  emissao_de?: string;              // "YYYY-MM-DD" (emissão — 23-jul)
  emissao_ate?: string;             // "YYYY-MM-DD"
  valor_min?: number;               // magnitude em R$ (ignora o sinal — 23-jul)
  valor_max?: number;
  /**
   * Recorte por ids explícitos — os lançamentos TAGUEADOS quando "Ver só
   * tagueados" está ativo (fix 28-jul: sem isso a capa/relatório "pelos
   * filtros" ignorava as tags e saía com tudo).
   */
  ids?: string[];
}

/**
 * Itens DESMARCADOS no modal "Gerar relatório" (29-out): a linha do recorte
 * que bater em qualquer um deles sai do relatório. Lançamento sem banco ou sem
 * centro de custo entra como "" (opção "Sem banco"/"Sem centro").
 */
export interface ReportScopeDesmarcados {
  conta_bancaria_id?: string[];
  centro_custo_cod?: string[];
  status?: string[];
  tipo_despesa?: string[];
}

export interface ReportScope {
  scope_type: ReportScopeType;
  filtros?: ReportScopeFiltros;
  /** Ids dos lançamentos selecionados manualmente (têm precedência sobre filtros). */
  transacao_ids?: string[];
  /** Refino do modal por cima da seleção/filtros (29-out). Ausente = tudo marcado. */
  desmarcados?: ReportScopeDesmarcados;
  /** Resumo calculado na revisão (somente para auditoria em scope_applied). */
  totais?: {
    qtd_lancamentos?: number;
    total?: number;
    contas?: string[];
    centros?: string[];
    status?: string[];
    tipos?: string[];
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
