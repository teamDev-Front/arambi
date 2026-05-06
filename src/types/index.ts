// Tipos públicos do app (re-export e helpers).
export type {
  Database,
  StatusAramburu,
  StatusDL,
  TipoDespesa,
  FormaPgto,
  ObsObra,
  NaturezaConta,
  UserRole,
  ReciboStatus,
  EstoqueStatus,
  LtsStatus,
  LogTipo,
  ChatRole,
  ClassificacaoFinanceiraRow,
  ClassificacaoPessoalRow,
  SocioRow,
  ContaBancariaEmpresaRow,
  TransacaoEmpresaRow,
  TransacaoEmpresaInsert,
  TransacaoEmpresaUpdate,
  TransacaoSocioRow,
} from "./database";

import type { StatusAramburu, FormaPgto, TipoDespesa, ObsObra } from "./database";

// ----------------------------------------------------------------------------
// Labels em PT-BR para UI (status snake_case → texto humano)
// ----------------------------------------------------------------------------
export const STATUS_ARAMBURU_LABEL: Record<StatusAramburu, string> = {
  saldo_inicial:    "Saldo inicial",
  recebido:         "Recebido",
  a_receber:        "A receber",
  pago:             "Pago",
  a_pagar:          "A pagar",
  repassado:        "Repassado",
  a_repassar:       "A repassar",
  aplicado:         "Aplicado",
  a_aplicar:        "A aplicar",
  aplicacao:        "Aplicação",
  resgatado:        "Resgatado",
  a_resgatar:       "A resgatar",
  resgate:          "Resgate",
  provisionado:     "Provisionado",
  provisionado_dl:  "Provisionado DL",
  provisionado_dv:  "Provisionado DV",
};

export const FORMA_PGTO_LABEL: Record<FormaPgto, string> = {
  boleto:            "Boleto",
  pix:               "Pix",
  cartao_credito:    "Cartão de Crédito",
  cartao_debito:     "Cartão de Débito",
  debito_automatico: "Débito Automático",
  guia:              "Guia",
  transferencia:     "Transferência",
  sem:               "—",
};

export const TIPO_DESPESA_LABEL: Record<TipoDespesa, string> = {
  fixa:      "Despesas Fixas",
  variavel:  "Despesas Variáveis",
  eventual:  "Despesas Eventuais",
  periodica: "Despesas Periódicas",
  sem:       "—",
};

export const OBS_OBRA_LABEL: Record<ObsObra, string> = {
  sem:           "—",
  outras:        "Outras",
  projeto:       "Projeto",
  ordem_compra:  "Ordem de Compra",
  medicao_01:    "Medição 01",
  medicao_02:    "Medição 02",
  medicao_03:    "Medição 03",
  medicao_04:    "Medição 04",
  medicao_05:    "Medição 05",
  medicao_06:    "Medição 06",
  retencao:      "Retenção",
};

// ----------------------------------------------------------------------------
// Categorias de status (para tintar UI)
// ----------------------------------------------------------------------------
export const STATUS_KIND: Record<StatusAramburu, "entrada" | "saida" | "neutro"> = {
  saldo_inicial:    "neutro",
  recebido:         "entrada",
  a_receber:        "entrada",
  resgatado:        "entrada",
  a_resgatar:       "entrada",
  resgate:          "entrada",
  aplicacao:        "entrada",
  pago:             "saida",
  a_pagar:          "saida",
  repassado:        "saida",
  a_repassar:       "saida",
  aplicado:         "saida",
  a_aplicar:        "saida",
  provisionado:     "saida",
  provisionado_dl:  "saida",
  provisionado_dv:  "saida",
};

export interface KpiCard {
  label: string;
  value: string | number;
  change?: number;
  trend?: "up" | "down" | "neutral";
  prefix?: string;
}
