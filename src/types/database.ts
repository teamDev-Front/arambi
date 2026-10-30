// Tipos da database. Espelham o schema em supabase/migrations/.
// Mantenha sincronizado com qualquer mudança de schema.

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

// ============================================================================
// Enums (espelham public.* enums no Postgres)
// ============================================================================
export type TipoDespesa     = "fixa" | "variavel" | "eventual" | "periodica" | "sem";
export type FormaPgto       = "boleto" | "pix" | "cartao_credito" | "cartao_debito"
                              | "debito_automatico" | "guia" | "transferencia" | "sem";
export type ObsObra         = "sem" | "outras" | "projeto" | "ordem_compra"
                              | "medicao_01" | "medicao_02" | "medicao_03"
                              | "medicao_04" | "medicao_05" | "medicao_06" | "retencao";
export type StatusAramburu  = "saldo_inicial" | "recebido" | "a_receber"
                              | "pago" | "a_pagar"
                              | "repassado" | "a_repassar"
                              | "aplicado" | "a_aplicar" | "aplicacao"
                              | "resgatado" | "a_resgatar" | "resgate"
                              | "provisionado" | "provisionado_dl" | "provisionado_dv";
export type StatusDL        = "provisionado" | "realizado" | "a_pagar";
export type NaturezaConta   = "entrada" | "saida";
export type UserRole        = "admin" | "editor" | "socio" | "viewer";
export type ReciboStatus    = "rascunho" | "emitido" | "cancelado";
export type EstoqueStatus   = "em_estoque" | "baixo_estoque" | "critico" | "esgotado";
export type LtsStatus       = "pago" | "em_aberto" | "vence_hoje" | "vencido" | "cancelado";
export type LogTipo         = "auth" | "chat" | "import" | "export" | "crud" | "system";
export type ChatRole        = "user" | "assistant" | "system";

// Novos enums — vendas/safra/pdfmonkey
export type CulturaSafra    = "soja" | "milho" | "sorgo" | "girassol" | "algodao" | "feijao" | "trigo";
export type VendaStatus     = "firmada" | "parcial" | "liquidada" | "cancelada";
export type SafraDepositoStatus = "armazenado" | "vendido_parcial" | "vendido_total" | "retirado" | "baixa";
export type PdfMonkeySlug   = "capa_empresa" | "capa_socio" | "relatorio_contabil" | "relatorio_socios";
export type DocumentoGeradoTipo =
  | "recibo_vale_combustivel"
  | "recibo_aluguel"
  | "recibo_pagamento_prestador"
  | "termo_autorizacao_pagamento_terceiros"
  | "termo_transferencia_bancaria"
  | "contrato_prestacao_servicos";

export type IAProvider = "gemini" | "openai";

// Enums — módulos agro jul/2026 (animais, maquinário, portal do colaborador, horta)
export type AnimalLoteStatus     = "ativo" | "vendido" | "abatido" | "inativo";
export type AnimalEventoTipo     = "vacina" | "vermifugo" | "outro";
export type OcorrenciaSeveridade = "info" | "atencao" | "critico";
export type EquipamentoTipo      = "trator" | "implemento" | "veiculo" | "outro";
export type EquipamentoStatus    = "em_operacao" | "parado" | "em_manutencao" | "estragou";
export type MedidorTipo          = "horimetro" | "km" | "nenhum";
export type CombustivelTipo      = "diesel" | "gasolina" | "nenhum";
export type ColaboradorStatus    = "ativo" | "pendente" | "desativado";
export type TalaoStatus          = "aberto" | "fechado";
export type CombustivelFonte     = "tanque_diesel" | "container_gasolina" | "posto_externo";
export type CanteiroCicloStatus  = "plantado" | "crescimento" | "colheita" | "finalizado";

// ============================================================================
// Tabelas
// ============================================================================
// IMPORTANTE: Use `type` (não `interface`) — o postgrest-js exige que cada
// Row/Insert/Update satisfaça `Record<string, unknown>`. Interfaces são
// "open" e não satisfazem essa constraint, viram `never` no QueryBuilder.

type WithTimestamps = {
  created_at: string;
  updated_at: string;
};

export type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  avatar_url: string | null;
  // Tela Acessos (migration 0058)
  cargo: string | null;
  setor: string | null;
  /** {"<modulo>": "leitura" | "edicao"} — ver src/lib/acessos/modulos.ts. */
  permissoes: Record<string, "leitura" | "edicao">;
  /** false = bloqueado ou convite ainda não ativado. */
  ativo: boolean;
  senha_definida_em: string | null;
  convidado_por: string | null;
  convidado_em: string | null;
  bloqueado_em: string | null;
  bloqueado_por: string | null;
  /** Senha provisória: precisa criar a própria no próximo acesso (0059). */
  trocar_senha: boolean;
  created_at: string;
  updated_at: string;
};

/** Colunas da 0058 com default no banco (opcionais no insert). */
type UserColunas0058 =
  | "cargo" | "setor" | "permissoes" | "ativo" | "senha_definida_em"
  | "convidado_por" | "convidado_em" | "bloqueado_em" | "bloqueado_por" | "trocar_senha";

/** Pedido de nova senha (tela de login → aprovação na tela Acessos, 0059). */
export type SolicitacaoSenhaRow = {
  id: string;
  user_id: string;
  /** AES-GCM (src/lib/acessos/cifra.ts); NULL depois de decidido. */
  senha_cifrada: string | null;
  status: "pendente" | "aprovada" | "recusada" | "cancelada" | "expirada";
  ip: string | null;
  user_agent: string | null;
  criado_em: string;
  decidido_em: string | null;
  decidido_por: string | null;
  motivo: string | null;
};

export type LogRow = {
  id: string;
  tipo: LogTipo;
  acao: string;
  descricao: string | null;
  usuario_id: string | null;
  usuario_nome: string | null;
  metadados: Json | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
};

export type ClassificacaoFinanceiraRow = {
  codigo: string;                           // "1.1.1", "2.7.2"
  nome: string;
  natureza: NaturezaConta;
  parent_codigo: string | null;
  nivel: number;                            // 1 | 2 | 3
  ordem: number | null;
  ativo: boolean;
  created_at: string;
};

// Papel de uma classificação no sistema (migration 0066): as automações e os
// relatórios procuram a conta pelo papel ("dl", "resgate"…), não pelo número.
// `codigo` acompanha a troca de código (FK com ON UPDATE CASCADE). Chaves e
// leitura: src/lib/plano/papeis.ts.
export type ClassificacaoPapelRow = {
  papel: string;
  codigo: string;
  descricao: string | null;
};

// Apresentação configurável de cada status (Admin → Status & Cores). Espelha o
// enum status_aramburu; `codigo` é o valor do enum em texto.
export type StatusConfigRow = {
  codigo: string;
  label: string;
  kind: "entrada" | "saida" | "neutro";
  cor_bg: string;                           // hex (#rrggbb)
  cor_text: string;
  ordem: number | null;
  ativo: boolean;
  is_sistema: boolean;
  created_at: string;
  updated_at: string;
};

export type ClassificacaoPessoalRow = {
  codigo: string;                           // "1.01" .. "1.06"
  nome: string;
  ordem: number | null;
  ativo: boolean;
  created_at: string;
};

export type SocioRow = WithTimestamps & {
  id: string;
  nome_completo: string;
  apelido: string | null;
  email: string | null;
  user_id: string | null;
  ativo: boolean;
};

export type ContaBancariaEmpresaRow = WithTimestamps & {
  id: string;
  nome: string;
  apelido: string | null;
  banco: string | null;
  numero_banco: string | null;        // código BACEN: 403 Cora, 748 Sicredi, 077 Inter, 348 XP
  tipo_instituicao: string;           // "banco" | "cooperativa" — rótulo do card
  agencia: string | null;
  conta: string | null;
  tipo: string | null;
  numero_conta: string | null;
  digito: string | null;
  ativa: boolean;
  ordem: number | null;
  /** Soma no "Saldo Fluxo de Caixa" da Home (migration 0060). */
  compoe_fluxo_caixa: boolean;
};

/** v_fluxo_caixa_planilha — linhas da aba "Saldo Disponível" da VS4 (0060). */
export type FluxoPlanilhaRow = {
  mes_referencia: string;
  saldo_inicial: number;
  vendas: number;
  resgates_entrada: number;
  outras_entradas: number;
  entradas: number;
  despesas_aramburu: number;
  distribuicao_lucro: number;
  despesas_obra: number;
  aplicacoes: number;
  resgates_saida: number;
  transferencias: number;
  saidas: number;
  resultado: number;
  saldo_contas_fluxo: number;
  saldo_menos_proximo_mes: number;
  saldo_todas_contas: number;
  dv_limite: number;
  dv_utilizado: number;
  dv_provisionado: number;
  dv_saldo: number;
  /** Realizado × provisionado (0061). Ausentes enquanto a 0061 não for aplicada. */
  entradas_realizadas?: number;
  entradas_provisionadas?: number;
  saidas_realizadas?: number;
  saidas_provisionadas?: number;
};

/** v_fluxo_caixa_contas — saldo projetado por conta e mês (0060). */
export type FluxoContaRow = {
  mes_referencia: string;
  conta_bancaria_id: string;
  banco_nome: string;
  banco_apelido: string | null;
  banco_instituicao: string | null;
  banco_numero: string | null;
  banco_tipo_instituicao: string | null;
  banco_tipo: string | null;
  banco_ordem: number | null;
  ativa: boolean;
  compoe_fluxo_caixa: boolean;
  saldo_inicial: number;
  movimento_mes: number;
  saldo_final: number;
};

export type ContaBancariaSocioRow = WithTimestamps & {
  id: string;
  socio_id: string;
  nome: string;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  tipo: string | null;
  numero_conta: string | null;
  digito: string | null;
  email_chave: string | null;
  ativa: boolean;
  ordem: number | null;
};

export type DespesaRecorrenteSocioRow = WithTimestamps & {
  id: string;
  socio_id: string;
  classificacao_pessoal: string;
  descricao: string;
  conta_bancaria_socio_id: string | null;
  validado: boolean | null;
  observacao: string | null;
  ordem: number | null;
};

export type FornecedorRow = WithTimestamps & {
  id: string;
  nome: string;
  cnpj: string | null;
  apelido: string | null;
  observacao: string | null;
  ativo: boolean;
};

export type TransacaoEmpresaRow = {
  id: string;
  data: string;                              // "YYYY-MM-DD" — VENCIMENTO
  data_emissao: string | null;              // "YYYY-MM-DD" — EMISSÃO da NF/documento (RF-FIN-06); null em lançamentos antigos
  mes_referencia: string;                    // "YYYY-MM"
  conta_contabil_cod: string;
  centro_custo_cod: string;
  tipo_despesa: TipoDespesa;
  fornecedor_id: string | null;
  fornecedor_nome: string | null;
  descricao: string | null;
  obs_obra: ObsObra;
  ref: string | null;
  parcelas: string | null;
  forma_pgto: FormaPgto;
  conta_bancaria_id: string | null;
  status: StatusAramburu;
  valor: number;
  observacao: string | null;
  /** Resgate automático Sicredi Invest que cobre este título (triggers da migration 0044). */
  resgate_auto_id: string | null;
  /**
   * Despesa paga pelo SALDO DA PRÓPRIA CONTA, sem resgate do Invest (0049).
   * Caso concreto: a Adri transferiu R$ 1.878,00 do Cora para o Sicredi em
   * janeiro/2026 — exatamente 12 × R$ 156,50 — para bancar as tarifas do ano.
   */
  dispensa_resgate: boolean;
  /**
   * Origem do recurso (0068): conta de investimento que cobre esta saída da
   * corrente Sicredi. null = conta padrão dos resgates (gera o par automático);
   * outra conta = resgate feito à parte (ex.: Fundo Empresarial), sem par.
   * Opcional: ausente antes da migration 0068.
   */
  resgate_origem_id?: string | null;
  origem_planilha: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

export type TransacaoEmpresaInsert =
  Omit<TransacaoEmpresaRow, "id" | "mes_referencia" | "created_at" | "updated_at" | "resgate_auto_id" | "dispensa_resgate">
  & { resgate_auto_id?: string | null; dispensa_resgate?: boolean };
export type TransacaoEmpresaUpdate = Partial<TransacaoEmpresaInsert>;

// Resumo mensal da Distribuição de Lucro (view v_dl_mensal_resumo — migration 0036)
export type DlMensalResumoRow = {
  mes_referencia: string;
  provisionado: number;
  a_pagar: number;
  a_pagar_sem_repasse: number;
  realizado: number;
  qtd_provisionado: number;
  qtd_a_pagar: number;
  qtd_a_pagar_sem_repasse: number;
  qtd_realizado: number;
};

// Provisionamento anual da empresa (view v_provisionamento_anual — migration 0036)
export type ProvisionamentoAnualRow = {
  mes_referencia: string;
  ano: string;
  conta_contabil_cod: string;
  conta_contabil_nome: string;
  natureza: NaturezaConta;
  realizado: number;
  em_aberto: number;
  provisionado: number;
  qtd_lancamentos: number;
};

export type TransacaoSocioRow = {
  id: string;
  data: string;
  mes_referencia: string;
  socio_id: string;
  classificacao_pessoal: string;
  descricao: string;
  conta_bancaria_socio_id: string | null;
  conta_bancaria_socio_nome: string | null;
  valor: number;
  /** "Data do Repasse" na UI — data programada do repasse ao sócio. */
  data_vencimento: string | null;
  /** "Vencimento" na UI — vencimento da despesa/fatura (migration 0044). */
  data_vencimento_despesa: string | null;
  status: StatusDL;
  /** Lançamento global (transacoes_empresa) que consolidou esta linha — migration 0036. */
  repasse_id: string | null;
  observacao: string | null;
  origem_planilha: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

export type TransacaoSocioInsert =
  Omit<TransacaoSocioRow, "id" | "mes_referencia" | "created_at" | "updated_at" | "repasse_id" | "data_vencimento_despesa">
  & { repasse_id?: string | null; data_vencimento_despesa?: string | null };
export type TransacaoSocioUpdate = Partial<TransacaoSocioInsert>;

// ============================================================================
// Tabelas Vendas Futuras + Safra (migrations 0014/0015)
// ============================================================================

export type ArmazemRow = WithTimestamps & {
  id: string;
  nome: string;
  apelido: string | null;
  cnpj: string | null;
  cidade: string | null;
  uf: string | null;
  observacao: string | null;
  ativo: boolean;
  ordem: number | null;
};

export type SafraParametrosRow = WithTimestamps & {
  id: string;
  armazem_id: string;
  cultura: CulturaSafra;
  safra: string;
  quebra_quinzena_pct: number;
  armazenagem_por_kg_quinzena: number;
  devolucao_por_saca: number;
  carencia_dias: number;                    // carência p/ venda a TERCEIROS (migration 0037)
  carencia_armazem_dias: number;            // carência p/ venda ao PRÓPRIO ARMAZÉM (migration 0037)
  /**
   * Data-limite da armazenagem gratuita na venda ao próprio armazém — normativa
   * da safra (ex.: milho 25/25 Copasul: 2026-05-31). Migration 0051.
   * Quando preenchida PREVALECE sobre carencia_armazem_dias: a cobrança começa
   * nesta data para todas as notas. null = contagem em dias por nota.
   */
  carencia_armazem_ate: string | null;      // "YYYY-MM-DD"
  taxa_recepcao_por_saca: number;           // R$/saca — só terceiros; 0 = isenta (migration 0037)
  kg_por_saca: number;
  data_atual: string;                       // "YYYY-MM-DD"
  cotacao_simulada_sc: number | null;
  /** Depósito Total Programado da safra em kg — painel de andamento (migration 0047). 0 = não configurado. */
  deposito_total_programado_kg: number;
  observacao: string | null;
};

export type SafraDepositoRow = WithTimestamps & {
  id: string;
  armazem_id: string;
  cultura: CulturaSafra;
  safra: string;
  data_deposito: string;
  dfe_entrada: string | null;
  nfp: string | null;
  kg_bruto: number;
  status: SafraDepositoStatus;
  observacao: string | null;
  origem_planilha: string | null;
  created_by: string | null;
};

/** Livro-razão de saídas de grão por nota — migration 0043 (baixa por volume FIFO). */
export type SafraBaixaRow = {
  id: string;
  deposito_id: string;
  /** Venda que consumiu o volume (null p/ retirada/perda/quebra ou venda excluída). */
  venda_id: string | null;
  data_baixa: string;
  kg: number;
  /** "quebra_tecnica" = ajuste que zera o saldo residual do bruto × líquido fixado (migration 0051). */
  motivo: "venda" | "retirada" | "perda" | "quebra_tecnica";
  observacao: string | null;
  created_at: string;
  created_by: string | null;
};

export type SafraDepositoCalculadoRow = {
  id: string;
  armazem_id: string;
  armazem_nome: string;
  armazem_apelido: string | null;
  cultura: CulturaSafra;
  safra: string;
  data_deposito: string;
  dfe_entrada: string | null;
  nfp: string | null;
  kg_bruto: number;
  status: SafraDepositoStatus;
  observacao: string | null;
  created_at: string;
  updated_at: string;
  parametros_id: string | null;
  quebra_quinzena_pct: number | null;
  armazenagem_por_kg_quinzena: number | null;
  devolucao_por_saca: number | null;
  carencia_dias: number | null;
  kg_por_saca: number | null;
  data_atual: string | null;
  cotacao_simulada_sc: number | null;
  sc_bruto: number;
  dias_percorridos: number;
  quinzenas: number;
  quebra_kg: number;
  kg_liquido: number;
  sc_liquida: number;
  taxa_armazenagem: number;
  taxa_devolucao: number;
  total_a_descontar: number;
  valor_venda_simulado: number;
  // Cenário "venda ao próprio armazém" + recepção (migration 0037)
  carencia_armazem_dias: number | null;
  taxa_recepcao_por_saca: number | null;
  taxa_recepcao: number;
  dias_percorridos_armazem: number;
  quinzenas_armazem: number;
  quebra_kg_armazem: number;
  kg_liquido_armazem: number;
  sc_liquida_armazem: number;
  taxa_armazenagem_armazem: number;
  total_a_descontar_armazem: number;
  valor_venda_armazem: number;
  // Volume remanescente após baixas por volume (migration 0043).
  // Mesmos cálculos dos dois cenários aplicados só ao saldo da nota.
  kg_baixado: number;
  kg_saldo: number;
  sc_saldo: number;
  quebra_kg_saldo: number;
  kg_liquido_saldo: number;
  sc_liquida_saldo: number;
  taxa_armazenagem_saldo: number;
  taxa_devolucao_saldo: number;
  taxa_recepcao_saldo: number;
  total_a_descontar_saldo: number;
  valor_venda_saldo: number;
  quebra_kg_saldo_armazem: number;
  kg_liquido_saldo_armazem: number;
  sc_liquida_saldo_armazem: number;
  taxa_armazenagem_saldo_armazem: number;
  total_a_descontar_saldo_armazem: number;
  valor_venda_saldo_armazem: number;
  /** Data-limite da carência do armazém em vigor nesta safra (migration 0051). */
  carencia_armazem_ate: string | null;
};

export type VendaProvisionadaRow = WithTimestamps & {
  id: string;
  data_venda: string;
  comprador: string;
  cultura: CulturaSafra;
  safra: string;
  aut_fixacao: string | null;
  numero_contrato: string | null;
  nota_fiscal: string | null;
  kg: number;
  preco_sc: number;
  kg_por_saca: number;
  data_pgto_prevista: string;
  destino_empresa: boolean;
  socio_destino_id: string | null;
  taxa_armazenagem: number;
  /** Taxa de Armazenagem — data de pagamento / ND / banco (migration 0047). */
  taxa_data_pgto: string | null;
  taxa_nd: string | null;
  taxa_banco_id: string | null;
  /** Despesa a pagar gerada no Financeiro para a taxa (migration 0047). */
  taxa_transacao_id: string | null;
  observacao: string | null;
  status: VendaStatus;
  transacao_empresa_id: string | null;
  origem_planilha: string | null;
  created_by: string | null;
};

export type VendaProvisionadaRichRow = VendaProvisionadaRow & {
  sacas: number;
  valor_total: number;
  socio_destino_nome: string | null;
  socio_destino_apelido: string | null;
  mes_recebimento: string;
  trimestre_recebimento: string;
};

export type VendaPorPeriodoRow = {
  destino_empresa: boolean;
  socio_destino_id: string | null;
  cultura: CulturaSafra;
  safra: string;
  qtd: number;
  sacas_total: number;
  valor_total: number;
  // discriminantes (uma view tem mes, outra tem tri)
  mes_recebimento?: string;
  trimestre_recebimento?: string;
};

export type PdfMonkeyTemplateRow = WithTimestamps & {
  slug: PdfMonkeySlug;
  nome: string;
  descricao: string | null;
  template_id: string | null;
  ativo: boolean;
  exemplo_payload: Json | null;
};

export type PdfMonkeyGeracaoRow = {
  id: string;
  template_slug: PdfMonkeySlug;
  mes_referencia: string | null;
  socio_id: string | null;
  pdfmonkey_document_id: string | null;
  status: string | null;
  download_url: string | null;
  payload: Json | null;
  scope_applied: Json | null;          // recorte usado na geração (RF-FIN-09): filtros/ids/contas/totais
  erro: string | null;
  created_at: string;
  created_by: string | null;
};

export type EstoqueRow = {
  id: string;
  produto: string;
  categoria: string | null;
  quantidade: number;
  unidade: string;
  valor_unitario: number;
  status: EstoqueStatus;
  fornecedor_id: string | null;
  fornecedor_nome: string | null;
  observacao: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

export type DocumentoRow = {
  id: string;
  nome: string;
  tipo: string | null;
  tamanho_bytes: number | null;
  storage_path: string | null;
  url_publica: string | null;
  mes_referencia: string | null;
  numero_nota: string | null;
  descricao: string | null;
  vinculado_a_transacao_empresa_id: string | null;
  vinculado_a_transacao_socio_id: string | null;
  vinculado_a_obra_lts_item_id: string | null;
  observacao: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

export type ObraLtsItemRow = {
  id: string;
  oc_numero: string | null;
  data_compra: string | null;
  loja: string | null;
  nf: string | null;
  forma_pagamento: string | null;
  valor: number;
  vencimento: string | null;
  status: LtsStatus;
  contrato: string | null;
  parcela: string | null;
  observacao: string | null;
  origem_planilha: string | null;
  created_at: string;
  updated_at: string;
};

export type ObraPendenciaRow = {
  id: string;
  categoria: string | null;
  subcategoria: string | null;
  descricao: string;
  empresa: string | null;
  condicao_pgto: string | null;
  valor: number | null;
  observacao: string | null;
  resolvida: boolean;
  resolvida_at: string | null;
  ordem: number | null;
  created_at: string;
  updated_at: string;
};

export type NotaEmGrupoRow = {
  id: string;
  data: string | null;
  mes_referencia: string | null;
  referencia: string | null;
  valor: number | null;
  parcelas: string | null;
  conta_bancaria_id: string | null;
  observacao: string | null;
  created_at: string;
  updated_at: string;
};

export type ObraParametroRow = {
  chave: string;
  valor_numerico: number | null;
  valor_texto: string | null;
  data_referencia: string | null;
  observacao: string | null;
  updated_at: string;
};

export type DocumentoGeradoRow = {
  id: string;
  tipo: DocumentoGeradoTipo;
  numero: string | null;
  beneficiario: string | null;
  valor: number | null;
  descricao: string | null;
  mes_referencia: string | null;
  dados: Json;
  pdf_path: string | null;
  pdf_size: number | null;
  versao_atual: number;          // RF-09 — versão atual (1 = nunca editado)
  updated_at: string | null;
  created_at: string;
  created_by: string | null;
};

export type DocumentoGeradoVersaoRow = {
  id: string;
  documento_id: string;
  versao: number;
  numero: string | null;
  beneficiario: string | null;
  valor: number | null;
  descricao: string | null;
  mes_referencia: string | null;
  dados: Json;
  pdf_path: string | null;
  pdf_size: number | null;
  created_at: string;
  created_by: string | null;
};

export type DocumentDescriptionHistoryRow = {
  id: string;
  document_type: DocumentoGeradoTipo;
  description: string;
  usage_count: number;
  last_used_at: string;
  created_at: string;
  updated_at: string;
};

export type ConfigIARow = {
  id: number;                                // sempre 1 (singleton)
  provider_ativo: IAProvider;
  gemini_api_key: string | null;
  openai_api_key: string | null;
  /** Modelo escolhido por provedor (0067). Opcional: ausente antes da migration; null = padrão. */
  openai_model?: string | null;
  gemini_model?: string | null;
  updated_at: string;
  updated_by: string | null;
};

/** Configurações gerais do sistema (chave/valor) — migration 0047. */
export type AppConfigRow = {
  chave: string;
  valor: string;
  descricao: string | null;
  updated_at: string;
};

export type AgentePromptRow = {
  agente_id: string;                         // slug — "contabilidade", "adv-trabalhista"
  nome: string;
  system_prompt: string;
  mensagem_boas_vindas: string | null;
  temperatura: number;                       // 0.00 .. 1.00
  ativo: boolean;
  updated_at: string;
  updated_by: string | null;
};

export type ChatSessionRow = {
  id: string;
  agente_id: string;
  agente_nome: string;
  usuario_id: string;
  usuario_nome: string;
  titulo: string | null;
  fechada: boolean;
  metadata: Json | null;
  created_at: string;
  updated_at: string;
};

export type ChatMensagemRow = {
  id: string;
  session_id: string;
  role: ChatRole;
  conteudo: string;
  anexos: Json | null;
  tokens: number | null;             // = tokens_output (mantido por compat com migration 0007)
  tokens_input: number | null;
  model: string | null;
  provider: IAProvider | null;
  created_at: string;
};

export type AgentePromptPublicoRow = {
  agente_id: string;
  nome: string;
  mensagem_boas_vindas: string | null;
  ativo: boolean;
};

export type OrcamentoMensalRow = {
  id: string;
  mes_referencia: string;                    // "YYYY-MM"
  tipo_despesa: TipoDespesa;
  valor_orcado: number;
  observacao: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
};

export type ObraLtsStatusCalculadoRow = {
  id: string;
  oc_numero: string | null;
  data_compra: string | null;
  loja: string | null;
  nf: string | null;
  forma_pagamento: string | null;
  valor: number;
  vencimento: string | null;
  status_cadastrado: LtsStatus;
  status_calculado: LtsStatus;
  contrato: string | null;
  parcela: string | null;
  observacao: string | null;
  origem_planilha: string | null;
  created_at: string;
  updated_at: string;
};

export type DistribuicaoLucroYtdRow = {
  ano: number;
  classificacao_pessoal: string;
  classificacao_nome: string;
  socio_id: string;
  socio_nome: string;
  socio_apelido: string | null;
  valor_acumulado: number;
  qtd_lancamentos: number;
};

export type FazendaAramburuYtdRow = {
  ano: number;
  socio_id: string;
  socio_nome: string;
  valor_acumulado: number;
  qtd_lancamentos: number;
};

export type ValidacaoConsistenciaRow = {
  codigo: string;
  descricao: string;
  severidade: "aviso" | "erro";
  esperado: number | null;
  realizado: number | null;
  diferenca: number | null;
  detalhes: string | null;
};

export type ChatSessaoRecenteRow = {
  session_id: string;
  agente_id: string;
  agente_nome: string;
  usuario_id: string;
  usuario_nome: string;
  titulo: string | null;
  fechada: boolean;
  created_at: string;
  updated_at: string;
  ultima_mensagem: string | null;
  ultima_mensagem_role: ChatRole | null;
  ultima_mensagem_at: string | null;
};

// ============================================================================
// Rows — módulos agro jul/2026 (migrations 0038–0042)
// ============================================================================

export type AnimalEspecieRow = WithTimestamps & {
  id: string;
  nome: string;
  icone: string;                            // emoji do card ("🐄")
  ordem: number | null;
  ativo: boolean;
};

export type AnimalLoteRow = WithTimestamps & {
  id: string;
  codigo: string;                           // "LOTE-01"
  especie_id: string;
  categoria: string | null;                 // "Matriz", "Leiteiras"
  raca: string | null;
  idade_meses: number | null;
  quantidade: number;
  status: AnimalLoteStatus;
  observacoes: string | null;
};

export type AnimalEventoRow = WithTimestamps & {
  id: string;
  lote_id: string;
  tipo: AnimalEventoTipo;
  nome: string;                             // "Brucelose"
  data_aplicacao: string | null;
  proxima_data: string | null;              // alimenta calendário + alertas
  observacao: string | null;
};

export type AnimalOcorrenciaRow = WithTimestamps & {
  id: string;
  lote_id: string;
  data: string;
  descricao: string;
  severidade: OcorrenciaSeveridade;
  resolvida: boolean;
};

export type EquipamentoRow = WithTimestamps & {
  id: string;
  codigo: string;                           // "TR-001"
  nome: string;                             // "Trator CBT"
  tipo: EquipamentoTipo;
  marca_modelo: string | null;
  ano: number | null;
  medidor_tipo: MedidorTipo;
  medidor_atual: number | null;             // último horímetro/KM conhecido
  status: EquipamentoStatus;
  localizacao: string | null;
  combustivel: CombustivelTipo;
  observacoes: string | null;
  ativo: boolean;
};

export type EquipamentoManutencaoRow = WithTimestamps & {
  id: string;
  equipamento_id: string;
  descricao: string;                        // "Troca de óleo"
  data_prevista: string | null;
  medidor_previsto: number | null;          // ex.: aos 2.900h
  realizada_em: string | null;              // null = pendente
  observacao: string | null;
};

export type EquipamentoDocumentoRow = WithTimestamps & {
  id: string;
  equipamento_id: string;
  tipo: string;                             // "Licenciamento", "Seguro"
  descricao: string | null;
  vencimento: string;
};

export type ChuvaRow = WithTimestamps & {
  id: string;
  data: string;                             // única por dia
  milimetros: number;
  observacao: string | null;
};

export type ColaboradorRow = WithTimestamps & {
  id: string;
  nome: string;
  cpf: string;                              // só dígitos (11)
  status: ColaboradorStatus;
  desativado_em: string | null;
};

export type TalaoUsoRow = WithTimestamps & {
  id: string;
  colaborador_id: string;
  equipamento_id: string;
  inicio_em: string;
  medidor_inicial: number;
  medidor_inicial_sugerido: number | null;  // o que o sistema sugeriu (último final)
  discrepancia: number;                     // inicial - sugerido (≠0 → alerta)
  discrepancia_regularizada: boolean;
  regularizada_obs: string | null;
  fim_em: string | null;
  medidor_final: number | null;
  equipamento_seguranca: boolean | null;
  observacoes: string | null;
  defeitos: string | null;
  status: TalaoStatus;
};

export type AbastecimentoRow = WithTimestamps & {
  id: string;
  colaborador_id: string;
  equipamento_id: string | null;            // null = abasteceu veículo externo
  fonte: CombustivelFonte;
  data: string;                             // timestamptz
  medidor_inicial: number | null;           // medidor da bomba/reservatório
  medidor_final: number | null;
  litros: number;
  observacao: string | null;
};

export type ReservatorioEntradaRow = WithTimestamps & {
  id: string;
  fonte: CombustivelFonte;                  // tanque_diesel | container_gasolina
  data: string;
  litros: number;
  observacao: string | null;
};

export type HortaCulturaRow = WithTimestamps & {
  id: string;
  nome: string;                             // "Alface"
  ciclo_dias_padrao: number | null;         // 45 — pré-preenche a previsão
  ativo: boolean;
};

export type CanteiroRow = WithTimestamps & {
  id: string;
  numero: number;                           // Canteiro 1, 2, 3...
  area_m2: number | null;
  ativo: boolean;
};

export type CanteiroCicloRow = WithTimestamps & {
  id: string;
  canteiro_id: string;
  cultura_id: string;
  data_plantio: string;
  previsao_colheita: string | null;         // manual (decisão do call)
  status: CanteiroCicloStatus;
  colhido_em: string | null;
  observacao: string | null;
};

// ============================================================================
// Database type (formato esperado pelo @supabase/postgrest-js)
// ============================================================================
// Cada Tabela precisa de Row + Insert + Update + Relationships (mesmo vazio).
// Cada View precisa de Row + Relationships.
// Schema precisa de Tables + Views + Functions.

type EmptyRels = [];

export interface Database {
  public: {
    Tables: {
      users: {
        Row: UserRow;
        Insert: Omit<UserRow, "created_at" | "updated_at" | UserColunas0058> & Partial<Pick<UserRow, UserColunas0058>>;
        Update: Partial<Omit<UserRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      solicitacoes_senha: {
        Row: SolicitacaoSenhaRow;
        Insert: Pick<SolicitacaoSenhaRow, "user_id"> & Partial<Omit<SolicitacaoSenhaRow, "id" | "user_id">>;
        Update: Partial<Omit<SolicitacaoSenhaRow, "id">>;
        Relationships: EmptyRels;
      };
      logs: {
        Row: LogRow;
        Insert: Pick<LogRow, "tipo" | "acao"> & Partial<Omit<LogRow, "id" | "created_at" | "tipo" | "acao">>;
        Update: Partial<Omit<LogRow, "id">>;
        Relationships: EmptyRels;
      };
      classificacao_financeira: {
        Row: ClassificacaoFinanceiraRow;
        Insert: Omit<ClassificacaoFinanceiraRow, "created_at">;
        Update: Partial<ClassificacaoFinanceiraRow>;
        Relationships: EmptyRels;
      };
      classificacao_papel: {
        Row: ClassificacaoPapelRow;
        Insert: Pick<ClassificacaoPapelRow, "papel" | "codigo"> & Partial<Pick<ClassificacaoPapelRow, "descricao">>;
        Update: Partial<ClassificacaoPapelRow>;
        Relationships: EmptyRels;
      };
      status_config: {
        Row: StatusConfigRow;
        Insert: Omit<StatusConfigRow, "created_at" | "updated_at"> & { created_at?: string; updated_at?: string };
        Update: Partial<Omit<StatusConfigRow, "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      classificacao_pessoal: {
        Row: ClassificacaoPessoalRow;
        Insert: Omit<ClassificacaoPessoalRow, "created_at">;
        Update: Partial<ClassificacaoPessoalRow>;
        Relationships: EmptyRels;
      };
      socios: {
        Row: SocioRow;
        Insert: Omit<SocioRow, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<SocioRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      contas_bancarias_empresa: {
        Row: ContaBancariaEmpresaRow;
        // numero_banco é nullable e tipo_instituicao tem default 'banco' no banco → opcionais no insert.
        Insert: Omit<ContaBancariaEmpresaRow, "id" | "created_at" | "updated_at" | "numero_banco" | "tipo_instituicao" | "compoe_fluxo_caixa">
          & { numero_banco?: string | null; tipo_instituicao?: string; compoe_fluxo_caixa?: boolean };
        Update: Partial<Omit<ContaBancariaEmpresaRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      contas_bancarias_socio: {
        Row: ContaBancariaSocioRow;
        Insert: Omit<ContaBancariaSocioRow, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<ContaBancariaSocioRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      despesas_recorrentes_socio: {
        Row: DespesaRecorrenteSocioRow;
        Insert: Omit<DespesaRecorrenteSocioRow, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<DespesaRecorrenteSocioRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      fornecedores: {
        Row: FornecedorRow;
        Insert: Omit<FornecedorRow, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<FornecedorRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      estoque: {
        Row: EstoqueRow;
        Insert: Omit<EstoqueRow, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<EstoqueRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      documentos: {
        Row: DocumentoRow;
        Insert: Omit<DocumentoRow, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<DocumentoRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      obra_lts_itens: {
        Row: ObraLtsItemRow;
        Insert: Omit<ObraLtsItemRow, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<ObraLtsItemRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      obra_pendencias: {
        Row: ObraPendenciaRow;
        Insert: Omit<ObraPendenciaRow, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<ObraPendenciaRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      notas_em_grupo: {
        Row: NotaEmGrupoRow;
        Insert: Omit<NotaEmGrupoRow, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<NotaEmGrupoRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      obra_parametros: {
        Row: ObraParametroRow;
        Insert: Omit<ObraParametroRow, "updated_at">;
        Update: Partial<Omit<ObraParametroRow, "chave" | "updated_at">>;
        Relationships: EmptyRels;
      };
      transacoes_empresa: {
        Row: TransacaoEmpresaRow;
        Insert: TransacaoEmpresaInsert;
        Update: TransacaoEmpresaUpdate;
        Relationships: EmptyRels;
      };
      transacoes_socio: {
        Row: TransacaoSocioRow;
        Insert: TransacaoSocioInsert;
        Update: TransacaoSocioUpdate;
        Relationships: EmptyRels;
      };
      armazens: {
        Row: ArmazemRow;
        Insert: Omit<ArmazemRow, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<ArmazemRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      safra_parametros: {
        Row: SafraParametrosRow;
        // carencia_armazem_dias / carencia_armazem_ate / taxa_recepcao_por_saca /
        // deposito_total_programado_kg têm default (ou null) no banco → opcionais.
        Insert: Omit<SafraParametrosRow, "id" | "created_at" | "updated_at" | "carencia_armazem_dias" | "carencia_armazem_ate" | "taxa_recepcao_por_saca" | "deposito_total_programado_kg">
          & { carencia_armazem_dias?: number; carencia_armazem_ate?: string | null; taxa_recepcao_por_saca?: number; deposito_total_programado_kg?: number };
        Update: Partial<Omit<SafraParametrosRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      safra_depositos: {
        Row: SafraDepositoRow;
        Insert: Omit<SafraDepositoRow, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<SafraDepositoRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      safra_baixas: {
        Row: SafraBaixaRow;
        // data_baixa/motivo têm default no banco → opcionais no insert.
        Insert: Omit<SafraBaixaRow, "id" | "created_at" | "data_baixa" | "motivo">
          & { data_baixa?: string; motivo?: SafraBaixaRow["motivo"] };
        Update: Partial<Omit<SafraBaixaRow, "id" | "created_at">>;
        Relationships: EmptyRels;
      };
      vendas_provisionadas: {
        Row: VendaProvisionadaRow;
        // Campos da Taxa de Armazenagem (migration 0047) têm default null → opcionais.
        Insert: Omit<VendaProvisionadaRow, "id" | "created_at" | "updated_at" | "taxa_data_pgto" | "taxa_nd" | "taxa_banco_id" | "taxa_transacao_id">
          & { taxa_data_pgto?: string | null; taxa_nd?: string | null; taxa_banco_id?: string | null; taxa_transacao_id?: string | null };
        Update: Partial<Omit<VendaProvisionadaRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      pdfmonkey_templates: {
        Row: PdfMonkeyTemplateRow;
        Insert: Omit<PdfMonkeyTemplateRow, "created_at" | "updated_at">;
        Update: Partial<Omit<PdfMonkeyTemplateRow, "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      pdfmonkey_geracoes: {
        Row: PdfMonkeyGeracaoRow;
        // scope_applied é nullable no banco → opcional no insert (preenchido pela geração por escopo, RF-FIN-09).
        Insert: Omit<PdfMonkeyGeracaoRow, "id" | "created_at" | "scope_applied"> & { scope_applied?: Json | null };
        Update: Partial<Omit<PdfMonkeyGeracaoRow, "id" | "created_at">>;
        Relationships: EmptyRels;
      };
      documentos_gerados: {
        Row: DocumentoGeradoRow;
        Insert: Omit<DocumentoGeradoRow, "id" | "created_at" | "updated_at" | "versao_atual"> & { versao_atual?: number };
        Update: Partial<Omit<DocumentoGeradoRow, "id" | "created_at">>;
        Relationships: EmptyRels;
      };
      documentos_gerados_versoes: {
        Row: DocumentoGeradoVersaoRow;
        Insert: Omit<DocumentoGeradoVersaoRow, "id" | "created_at">;
        Update: Partial<Omit<DocumentoGeradoVersaoRow, "id" | "created_at">>;
        Relationships: EmptyRels;
      };
      document_description_history: {
        Row: DocumentDescriptionHistoryRow;
        Insert: Omit<DocumentDescriptionHistoryRow, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<DocumentDescriptionHistoryRow, "id" | "created_at">>;
        Relationships: EmptyRels;
      };
      config_ia: {
        Row: ConfigIARow;
        Insert: Partial<ConfigIARow>;
        Update: Partial<ConfigIARow>;
        Relationships: EmptyRels;
      };
      app_config: {
        Row: AppConfigRow;
        Insert: Pick<AppConfigRow, "chave" | "valor"> & Partial<Omit<AppConfigRow, "chave" | "valor">>;
        Update: Partial<Omit<AppConfigRow, "chave">>;
        Relationships: EmptyRels;
      };
      agente_prompts: {
        Row: AgentePromptRow;
        // Obrigatórios no schema: agente_id, nome, system_prompt.
        // Demais campos têm default/permitem null no Postgres.
        Insert:
          Pick<AgentePromptRow, "agente_id" | "nome" | "system_prompt"> &
          Partial<Omit<AgentePromptRow, "agente_id" | "nome" | "system_prompt">>;
        Update: Partial<Omit<AgentePromptRow, "agente_id">>;
        Relationships: EmptyRels;
      };
      chat_sessions: {
        Row: ChatSessionRow;
        Insert:
          Pick<ChatSessionRow, "agente_id" | "agente_nome" | "usuario_id" | "usuario_nome"> &
          Partial<Omit<ChatSessionRow, "agente_id" | "agente_nome" | "usuario_id" | "usuario_nome">>;
        Update: Partial<Omit<ChatSessionRow, "id" | "created_at">>;
        Relationships: EmptyRels;
      };
      chat_mensagens: {
        Row: ChatMensagemRow;
        Insert:
          Pick<ChatMensagemRow, "session_id" | "role" | "conteudo"> &
          Partial<Omit<ChatMensagemRow, "session_id" | "role" | "conteudo">>;
        Update: Partial<Omit<ChatMensagemRow, "id" | "created_at">>;
        Relationships: EmptyRels;
      };
      orcamentos_mensais: {
        Row: OrcamentoMensalRow;
        Insert:
          Pick<OrcamentoMensalRow, "mes_referencia" | "tipo_despesa" | "valor_orcado"> &
          Partial<Omit<OrcamentoMensalRow, "id" | "created_at" | "updated_at">>;
        Update: Partial<Omit<OrcamentoMensalRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      // ---- Módulos agro jul/2026 (migrations 0038–0042) ----
      animal_especies: {
        Row: AnimalEspecieRow;
        Insert: Pick<AnimalEspecieRow, "nome"> & Partial<Omit<AnimalEspecieRow, "id" | "created_at" | "updated_at">>;
        Update: Partial<Omit<AnimalEspecieRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      animal_lotes: {
        Row: AnimalLoteRow;
        Insert: Pick<AnimalLoteRow, "codigo" | "especie_id" | "quantidade"> & Partial<Omit<AnimalLoteRow, "id" | "created_at" | "updated_at">>;
        Update: Partial<Omit<AnimalLoteRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      animal_eventos: {
        Row: AnimalEventoRow;
        Insert: Pick<AnimalEventoRow, "lote_id" | "nome"> & Partial<Omit<AnimalEventoRow, "id" | "created_at" | "updated_at">>;
        Update: Partial<Omit<AnimalEventoRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      animal_ocorrencias: {
        Row: AnimalOcorrenciaRow;
        Insert: Pick<AnimalOcorrenciaRow, "lote_id" | "descricao"> & Partial<Omit<AnimalOcorrenciaRow, "id" | "created_at" | "updated_at">>;
        Update: Partial<Omit<AnimalOcorrenciaRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      equipamentos: {
        Row: EquipamentoRow;
        Insert: Pick<EquipamentoRow, "codigo" | "nome" | "tipo"> & Partial<Omit<EquipamentoRow, "id" | "created_at" | "updated_at">>;
        Update: Partial<Omit<EquipamentoRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      equipamento_manutencoes: {
        Row: EquipamentoManutencaoRow;
        Insert: Pick<EquipamentoManutencaoRow, "equipamento_id" | "descricao"> & Partial<Omit<EquipamentoManutencaoRow, "id" | "created_at" | "updated_at">>;
        Update: Partial<Omit<EquipamentoManutencaoRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      equipamento_documentos: {
        Row: EquipamentoDocumentoRow;
        Insert: Pick<EquipamentoDocumentoRow, "equipamento_id" | "tipo" | "vencimento"> & Partial<Omit<EquipamentoDocumentoRow, "id" | "created_at" | "updated_at">>;
        Update: Partial<Omit<EquipamentoDocumentoRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      chuvas: {
        Row: ChuvaRow;
        Insert: Pick<ChuvaRow, "data" | "milimetros"> & Partial<Omit<ChuvaRow, "id" | "created_at" | "updated_at">>;
        Update: Partial<Omit<ChuvaRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      colaboradores: {
        Row: ColaboradorRow;
        Insert: Pick<ColaboradorRow, "nome" | "cpf"> & Partial<Omit<ColaboradorRow, "id" | "created_at" | "updated_at">>;
        Update: Partial<Omit<ColaboradorRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      talao_usos: {
        Row: TalaoUsoRow;
        Insert: Pick<TalaoUsoRow, "colaborador_id" | "equipamento_id" | "inicio_em" | "medidor_inicial"> & Partial<Omit<TalaoUsoRow, "id" | "created_at" | "updated_at">>;
        Update: Partial<Omit<TalaoUsoRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      abastecimentos: {
        Row: AbastecimentoRow;
        Insert: Pick<AbastecimentoRow, "colaborador_id" | "fonte" | "data" | "litros"> & Partial<Omit<AbastecimentoRow, "id" | "created_at" | "updated_at">>;
        Update: Partial<Omit<AbastecimentoRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      reservatorio_entradas: {
        Row: ReservatorioEntradaRow;
        Insert: Pick<ReservatorioEntradaRow, "fonte" | "data" | "litros"> & Partial<Omit<ReservatorioEntradaRow, "id" | "created_at" | "updated_at">>;
        Update: Partial<Omit<ReservatorioEntradaRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      horta_culturas: {
        Row: HortaCulturaRow;
        Insert: Pick<HortaCulturaRow, "nome"> & Partial<Omit<HortaCulturaRow, "id" | "created_at" | "updated_at">>;
        Update: Partial<Omit<HortaCulturaRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      canteiros: {
        Row: CanteiroRow;
        Insert: Pick<CanteiroRow, "numero"> & Partial<Omit<CanteiroRow, "id" | "created_at" | "updated_at">>;
        Update: Partial<Omit<CanteiroRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      canteiro_ciclos: {
        Row: CanteiroCicloRow;
        Insert: Pick<CanteiroCicloRow, "canteiro_id" | "cultura_id" | "data_plantio"> & Partial<Omit<CanteiroCicloRow, "id" | "created_at" | "updated_at">>;
        Update: Partial<Omit<CanteiroCicloRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
    };
    Views: {
      v_kpi_mensal: {
        Row: {
          mes_referencia: string;
          entradas_realizadas: number;
          entradas_a_receber: number;
          saidas_realizadas: number;
          saidas_a_pagar: number;
          saidas_provisionadas: number;
          saldo_movimentacao: number;
        };
        Relationships: EmptyRels;
      };
      v_fluxo_caixa_mensal: {
        Row: {
          mes_referencia: string;
          saldo_final_acumulado: number;
          saidas_mes: number;
          resgate_mes: number;
          outros_entradas_mes: number;
          vendas_mes: number;
          saidas_proximo_mes: number;
          entradas_garantidas_proximo_mes: number;
          saldo_menos_proximo_mes: number;
        };
        Relationships: EmptyRels;
      };
      // Fluxo de Caixa no formato da aba "Saldo Disponível" da VS4 (migration 0060).
      v_fluxo_caixa_planilha: {
        Row: FluxoPlanilhaRow;
        Relationships: EmptyRels;
      };
      // Saldo inicial/final PROJETADO por conta e mês (migration 0060).
      v_fluxo_caixa_contas: {
        Row: FluxoContaRow;
        Relationships: EmptyRels;
      };
      // Saldo inicial/final realizado por banco por mês (migration 0044).
      v_fluxo_caixa_bancos: {
        Row: {
          mes_referencia: string;
          conta_bancaria_id: string;
          banco_nome: string;
          banco_apelido: string | null;
          banco_instituicao: string | null;
          banco_ordem: number | null;
          saldo_inicial: number;
          movimento_mes: number;
          saldo_final: number;
        };
        Relationships: EmptyRels;
      };
      v_por_conta_contabil_mensal: {
        Row: {
          mes_referencia: string;
          conta_contabil_cod: string;
          conta_contabil_nome: string;
          natureza: NaturezaConta;
          valor_total: number;
          qtd_lancamentos: number;
        };
        Relationships: EmptyRels;
      };
      v_por_centro_custo_mensal: {
        Row: {
          mes_referencia: string;
          centro_custo_cod: string;
          centro_custo_nome: string;
          parent_codigo: string | null;
          natureza: NaturezaConta;
          valor_total: number;
          qtd_lancamentos: number;
        };
        Relationships: EmptyRels;
      };
      v_saldo_por_banco_mensal: {
        Row: {
          mes_referencia: string;
          conta_bancaria_id: string | null;
          conta_bancaria_nome: string | null;
          variacao_no_mes: number;
          saldo_inicial_no_mes: number;
          entradas: number;
          saidas: number;
        };
        Relationships: EmptyRels;
      };
      v_capinha_socio_mensal: {
        Row: {
          socio_id: string;
          socio_nome: string;
          mes_referencia: string;
          classificacao_pessoal: string;
          classificacao_nome: string;
          status: StatusDL;
          valor_total: number;
          qtd_lancamentos: number;
        };
        Relationships: EmptyRels;
      };
      v_saldo_atual_por_banco: {
        Row: {
          conta_bancaria_id: string;
          banco_nome: string;
          banco_apelido: string | null;
          banco_instituicao: string | null;
          banco_numero: string | null;
          banco_tipo_instituicao: string | null;
          banco_agencia: string | null;
          banco_numero_conta: string | null;
          banco_digito: string | null;
          banco_tipo: string | null;
          banco_ordem: number | null;
          saldo_atual: number;
          a_pagar: number;
          a_receber: number;
          a_repassar: number;
          a_resgatar: number;
          provisionado: number;
          entradas_realizadas: number;
          saidas_realizadas: number;
          saldo_projetado: number;
          total_lancamentos: number;
        };
        Relationships: EmptyRels;
      };
      v_safra_depositos_calculado: {
        Row: SafraDepositoCalculadoRow;
        Relationships: EmptyRels;
      };
      v_vendas_provisionadas: {
        Row: VendaProvisionadaRichRow;
        Relationships: EmptyRels;
      };
      v_vendas_por_trimestre: {
        Row: Required<Pick<VendaPorPeriodoRow, "destino_empresa" | "socio_destino_id" | "cultura" | "safra" | "qtd" | "sacas_total" | "valor_total" | "trimestre_recebimento">>;
        Relationships: EmptyRels;
      };
      v_vendas_por_mes: {
        Row: Required<Pick<VendaPorPeriodoRow, "destino_empresa" | "socio_destino_id" | "cultura" | "safra" | "qtd" | "sacas_total" | "valor_total" | "mes_recebimento">>;
        Relationships: EmptyRels;
      };
      v_distribuicao_lucro_mensal: {
        Row: {
          mes_referencia: string;
          classificacao_pessoal: string;
          classificacao_nome: string;
          valor_total: number;
        };
        Relationships: EmptyRels;
      };
      v_dl_mensal_resumo: {
        Row: DlMensalResumoRow;
        Relationships: EmptyRels;
      };
      v_provisionamento_anual: {
        Row: ProvisionamentoAnualRow;
        Relationships: EmptyRels;
      };
      v_chat_sessoes_recentes: {
        Row: ChatSessaoRecenteRow;
        Relationships: EmptyRels;
      };
      v_agente_prompts_publico: {
        Row: AgentePromptPublicoRow;
        Relationships: EmptyRels;
      };
      v_obra_totais: {
        Row: {
          pago_oc_projeto: number | null;
          pago_medicoes: number | null;
          pago_outras: number | null;
          a_pagar_outras: number | null;
          provisionado_medicoes: number | null;
          provisionado_outras: number | null;
          provisionado_retencao: number | null;
        };
        Relationships: EmptyRels;
      };
      v_memoria_calculo_mensal: {
        Row: TransacaoEmpresaRow;
        Relationships: EmptyRels;
      };
      v_obra_lts_status_calculado: {
        Row: ObraLtsStatusCalculadoRow;
        Relationships: EmptyRels;
      };
      v_distribuicao_lucro_ytd: {
        Row: DistribuicaoLucroYtdRow;
        Relationships: EmptyRels;
      };
      v_fazenda_aramburu_ytd: {
        Row: FazendaAramburuYtdRow;
        Relationships: EmptyRels;
      };
      /** Itens recuperáveis da Lixeira (migration 0054). */
      v_lixeira: {
        Row: {
          id: string;
          tabela: string;
          registro_id: string;
          resumo: string | null;
          dados: Json;
          excluido_em: string;
          expira_em: string;
          dias_restantes: number;
          excluido_por_nome: string | null;
        };
        Relationships: EmptyRels;
      };
    };
    // IMPORTANTE: manter Record<string, never> — tipar Functions "de verdade" faz o
    // postgrest-js entrar no modo estrito de inferência e quebrar os joins existentes
    // (as tabelas usam Relationships vazios). As RPCs de 0036 são chamadas com um
    // wrapper tipado local em src/lib/queries/distribuicao.ts.
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
