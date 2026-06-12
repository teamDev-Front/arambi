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
  created_at: string;
  updated_at: string;
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
  origem_planilha: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

export type TransacaoEmpresaInsert = Omit<TransacaoEmpresaRow, "id" | "mes_referencia" | "created_at" | "updated_at">;
export type TransacaoEmpresaUpdate = Partial<TransacaoEmpresaInsert>;

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
  data_vencimento: string | null;
  status: StatusDL;
  observacao: string | null;
  origem_planilha: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

export type TransacaoSocioInsert = Omit<TransacaoSocioRow, "id" | "mes_referencia" | "created_at" | "updated_at">;

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
  carencia_dias: number;
  kg_por_saca: number;
  data_atual: string;                       // "YYYY-MM-DD"
  cotacao_simulada_sc: number | null;
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
  updated_at: string;
  updated_by: string | null;
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
        Insert: Omit<UserRow, "created_at" | "updated_at">;
        Update: Partial<Omit<UserRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      classificacao_financeira: {
        Row: ClassificacaoFinanceiraRow;
        Insert: Omit<ClassificacaoFinanceiraRow, "created_at">;
        Update: Partial<ClassificacaoFinanceiraRow>;
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
        Insert: Omit<ContaBancariaEmpresaRow, "id" | "created_at" | "updated_at" | "numero_banco" | "tipo_instituicao">
          & { numero_banco?: string | null; tipo_instituicao?: string };
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
        Update: Partial<TransacaoSocioInsert>;
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
        Insert: Omit<SafraParametrosRow, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<SafraParametrosRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      safra_depositos: {
        Row: SafraDepositoRow;
        Insert: Omit<SafraDepositoRow, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<SafraDepositoRow, "id" | "created_at" | "updated_at">>;
        Relationships: EmptyRels;
      };
      vendas_provisionadas: {
        Row: VendaProvisionadaRow;
        Insert: Omit<VendaProvisionadaRow, "id" | "created_at" | "updated_at">;
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
    };
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
