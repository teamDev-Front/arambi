// Tipos públicos do app (re-export e helpers).
export type {
  Database,
  Json,
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
  CulturaSafra,
  VendaStatus,
  SafraDepositoStatus,
  PdfMonkeySlug,
  UserRow,
  SolicitacaoSenhaRow,
  LogRow,
  ClassificacaoFinanceiraRow,
  StatusConfigRow,
  ClassificacaoPessoalRow,
  SocioRow,
  FornecedorRow,
  ContaBancariaEmpresaRow,
  ContaBancariaSocioRow,
  TransacaoEmpresaRow,
  TransacaoEmpresaInsert,
  TransacaoEmpresaUpdate,
  TransacaoSocioRow,
  TransacaoSocioInsert,
  TransacaoSocioUpdate,
  DlMensalResumoRow,
  ProvisionamentoAnualRow,
  ArmazemRow,
  SafraParametrosRow,
  SafraDepositoRow,
  SafraBaixaRow,
  SafraDepositoCalculadoRow,
  VendaProvisionadaRow,
  VendaProvisionadaRichRow,
  VendaPorPeriodoRow,
  PdfMonkeyTemplateRow,
  PdfMonkeyGeracaoRow,
  DocumentoGeradoTipo,
  DocumentoGeradoRow,
  DocumentoGeradoVersaoRow,
  DocumentDescriptionHistoryRow,
  IAProvider,
  ConfigIARow,
  AppConfigRow,
  AgentePromptRow,
  ChatSessionRow,
  ChatMensagemRow,
  ChatSessaoRecenteRow,
  AgentePromptPublicoRow,
  OrcamentoMensalRow,
  ObraLtsStatusCalculadoRow,
  DistribuicaoLucroYtdRow,
  FazendaAramburuYtdRow,
  ValidacaoConsistenciaRow,
  // Módulos agro jul/2026
  AnimalLoteStatus,
  AnimalEventoTipo,
  OcorrenciaSeveridade,
  EquipamentoTipo,
  EquipamentoStatus,
  MedidorTipo,
  CombustivelTipo,
  ColaboradorStatus,
  TalaoStatus,
  CombustivelFonte,
  CanteiroCicloStatus,
  AnimalEspecieRow,
  AnimalLoteRow,
  AnimalEventoRow,
  AnimalOcorrenciaRow,
  EquipamentoRow,
  EquipamentoManutencaoRow,
  EquipamentoDocumentoRow,
  ChuvaRow,
  ColaboradorRow,
  TalaoUsoRow,
  AbastecimentoRow,
  ReservatorioEntradaRow,
  HortaCulturaRow,
  CanteiroRow,
  CanteiroCicloRow,
} from "./database";

import type {
  StatusAramburu, StatusDL, FormaPgto, TipoDespesa, ObsObra,
  CulturaSafra, VendaStatus, SafraDepositoStatus, PdfMonkeySlug,
  DocumentoGeradoTipo,
  AnimalLoteStatus, AnimalEventoTipo, OcorrenciaSeveridade,
  EquipamentoTipo, EquipamentoStatus, MedidorTipo, CombustivelTipo,
  ColaboradorStatus, TalaoStatus, CombustivelFonte, CanteiroCicloStatus,
} from "./database";

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

// Status da Distribuição de Lucro (detalhado por sócio). Na linguagem da
// planilha da Adriane: Provisionado → A repassar → Repassado. (O código
// 'a_pagar' permanece no banco; só o rótulo mudou — ajuste 23-jul-2026.)
export const STATUS_DL_LABEL: Record<StatusDL, string> = {
  provisionado: "Provisionado",
  a_pagar:      "A repassar",
  realizado:    "Repassado",
};

// Cores dos status da DL — mesma paleta do módulo Financeiro (legenda do
// Excel / status_config): Provisionado amarelo, A repassar vermelho,
// Repassado verde. Usadas no select inline e nos badges da tela.
export const STATUS_DL_COLOR: Record<StatusDL, { bg: string; text: string }> = {
  provisionado: { bg: "#f7b500", text: "#1c1917" },
  a_pagar:      { bg: "#ed1c24", text: "#ffffff" },
  realizado:    { bg: "#22b14c", text: "#ffffff" },
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

// ----------------------------------------------------------------------------
// Labels — Cultura / Safra / Vendas (módulo Provisionamento)
// ----------------------------------------------------------------------------
export const CULTURA_LABEL: Record<CulturaSafra, string> = {
  soja:      "Soja",
  milho:     "Milho",
  sorgo:     "Sorgo",
  girassol:  "Girassol",
  algodao:   "Algodão",
  feijao:    "Feijão",
  trigo:     "Trigo",
};

export const CULTURA_EMOJI: Record<CulturaSafra, string> = {
  soja:      "🫛",
  milho:     "🌽",
  sorgo:     "🌾",
  girassol:  "🌻",
  algodao:   "🪺",
  feijao:    "🫘",
  trigo:     "🌾",
};

export const VENDA_STATUS_LABEL: Record<VendaStatus, string> = {
  firmada:    "Firmada",
  parcial:    "Parcial",
  liquidada:  "Liquidada",
  cancelada:  "Cancelada",
};

export const SAFRA_DEP_STATUS_LABEL: Record<SafraDepositoStatus, string> = {
  armazenado:      "Armazenado",
  vendido_parcial: "Vendido (parcial)",
  vendido_total:   "Vendido (total)",
  retirado:        "Retirado",
  baixa:           "Baixa",
};

export const PDFMONKEY_LABEL: Record<PdfMonkeySlug, string> = {
  capa_empresa:        "Capa Empresa",
  capa_socio:          "Capa Sócio",
  relatorio_contabil:  "Relatório Contábil",
  relatorio_socios:    "Relatório Sócios",
};

// ----------------------------------------------------------------------------
// Labels — Documentos gerados via código (recibos & termos)
// ----------------------------------------------------------------------------
export const DOCUMENTO_GERADO_LABEL: Record<DocumentoGeradoTipo, string> = {
  recibo_vale_combustivel:               "Recibo de Vale Combustível",
  recibo_aluguel:                        "Recibo de Aluguel",
  recibo_pagamento_prestador:            "Recibo de Pagamento a Prestador",
  termo_autorizacao_pagamento_terceiros: "Termo de Autorização de Pagamento a Terceiros",
  termo_transferencia_bancaria:          "Termo de Transferência Bancária",
  contrato_prestacao_servicos:           "Contrato de Prestação de Serviços",
};

export const DOCUMENTO_GERADO_LABEL_CURTO: Record<DocumentoGeradoTipo, string> = {
  recibo_vale_combustivel:               "Vale Combustível",
  recibo_aluguel:                        "Aluguel",
  recibo_pagamento_prestador:            "Pagamento a Prestador",
  termo_autorizacao_pagamento_terceiros: "Autorização a Terceiros",
  termo_transferencia_bancaria:          "Transferência Bancária",
  contrato_prestacao_servicos:           "Contrato de Serviços",
};

// ----------------------------------------------------------------------------
// Labels — Módulos agro jul/2026 (animais, maquinário, colaboradores, horta)
// ----------------------------------------------------------------------------
export const ANIMAL_LOTE_STATUS_LABEL: Record<AnimalLoteStatus, string> = {
  ativo:    "Ativo",
  vendido:  "Vendido",
  abatido:  "Abatido",
  inativo:  "Inativo",
};

export const ANIMAL_EVENTO_TIPO_LABEL: Record<AnimalEventoTipo, string> = {
  vacina:    "Vacina",
  vermifugo: "Vermífugo",
  outro:     "Outro",
};

export const OCORRENCIA_SEVERIDADE_LABEL: Record<OcorrenciaSeveridade, string> = {
  info:    "Informativo",
  atencao: "Atenção",
  critico: "Crítico",
};

export const EQUIPAMENTO_TIPO_LABEL: Record<EquipamentoTipo, string> = {
  trator:     "Trator",
  implemento: "Implemento",
  veiculo:    "Veículo",
  outro:      "Outro",
};

export const EQUIPAMENTO_STATUS_LABEL: Record<EquipamentoStatus, string> = {
  em_operacao:   "Em Operação",
  parado:        "Parado",
  em_manutencao: "Em Manutenção",
  estragou:      "Estragou",
};

export const MEDIDOR_TIPO_LABEL: Record<MedidorTipo, string> = {
  horimetro: "Horímetro (h)",
  km:        "Quilometragem (km)",
  nenhum:    "Sem medidor",
};

export const COMBUSTIVEL_TIPO_LABEL: Record<CombustivelTipo, string> = {
  diesel:   "Diesel",
  gasolina: "Gasolina",
  nenhum:   "—",
};

export const COLABORADOR_STATUS_LABEL: Record<ColaboradorStatus, string> = {
  ativo:      "Ativo",
  pendente:   "Aguardando aprovação",
  desativado: "Desativado",
};

export const TALAO_STATUS_LABEL: Record<TalaoStatus, string> = {
  aberto:  "Em uso",
  fechado: "Finalizado",
};

export const COMBUSTIVEL_FONTE_LABEL: Record<CombustivelFonte, string> = {
  tanque_diesel:      "Tanque de Diesel",
  container_gasolina: "Container de Gasolina",
  posto_externo:      "Posto Externo",
};

export const CANTEIRO_CICLO_STATUS_LABEL: Record<CanteiroCicloStatus, string> = {
  plantado:    "Plantado",
  crescimento: "Em Crescimento",
  colheita:    "Pronto p/ Colheita",
  finalizado:  "Finalizado",
};
