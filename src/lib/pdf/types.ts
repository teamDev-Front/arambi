// Shapes dos dados de entrada dos 6 geradores de PDF.
// Cada tipo corresponde a um valor do enum `documento_gerado_tipo` no Postgres.

export interface PessoaSimples {
  nome: string;
  documento: string;            // CPF ou CNPJ (texto livre, com máscara)
  tipo?: "pf" | "pj";           // default "pf" (compat. com documentos antigos sem o campo)
}

export interface DadosBancarios {
  banco?: string;
  agencia?: string;
  conta?: string;
  chave_pix?: string;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 1. Recibo de Vale Combustível                                              */
/* ────────────────────────────────────────────────────────────────────────── */
export interface DadosReciboValeCombustivel {
  beneficiario: PessoaSimples;        // quem RECEBE o auxílio
  pagador: PessoaSimples;             // quem paga
  valor: number;                      // em reais (decimal)
  competencia: string;                // "YYYY-MM"
  periodo: string;                    // ex: "02 a 31/03"
  cidade: string;                     // "Campo Grande - MS"
  data_emissao: string;               // "YYYY-MM-DD"
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 2. Recibo de Aluguel                                                       */
/* ────────────────────────────────────────────────────────────────────────── */
export interface DadosReciboAluguel {
  numero: string;                     // ex: "022/2026"
  proprietario_nome: string;
  imovel_nome: string;                // "Atmosphera – Saúde, Esportes e Recreação Ltda"
  imovel_endereco: string;
  locatario_nome: string;             // "Agropecuária Aramburu Ltda"
  locatario_cnpj: string;
  valor: number;
  competencia: string;                // "YYYY-MM"
  data_pagamento: string;             // "YYYY-MM-DD"
  forma_pagamento: string;            // texto livre
  tipo_servico?: string;              // "Coworking"
  cidade: string;
  data_emissao: string;
  // Rodapé (empresa que emite o recibo)
  emissor_razao_social: string;       // "Atmosphera – Saúde, Esportes e Recreação Ltda"
  emissor_cnpj: string;
  emissor_signatario: string;         // "Pedro Henrique Ponte Fragelli"
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 3. Recibo de Pagamento a Prestador                                         */
/* ────────────────────────────────────────────────────────────────────────── */
export interface DadosReciboPagamentoPrestador {
  prestador: PessoaSimples;
  pagador: PessoaSimples;
  valor: number;
  descricao_servico: string;          // "troca de disjuntor..."
  propriedade?: string;               // "Fazenda Aramburu" (opcional)
  data_pagamento?: string;            // "YYYY-MM-DD" ou em branco (template original tem placeholders)
  forma_pagamento: string;
  cidade: string;
  data_emissao?: string;              // "YYYY-MM-DD"; se vazio, deixa placeholders como no template
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 4. Termo de Autorização de Pagamento a Terceiros                           */
/* ────────────────────────────────────────────────────────────────────────── */
export interface DadosTermoAutorizacaoTerceiros {
  // Parte que autoriza (geralmente o fornecedor)
  autorizante_razao_social: string;
  autorizante_tipo: "pj" | "pf";
  autorizante_documento: string;      // CNPJ ou CPF
  autorizante_endereco: string;
  // Parte autorizada (a Aramburu, geralmente)
  autorizada_razao_social: string;
  autorizada_documento: string;
  autorizada_endereco: string;
  // Detalhes da NF/operação
  numero_nota: string;
  valor_pagamento: number;            // valor que está sendo autorizado pagar
  valor_total_nota: number;
  titulo_pagamento?: string;          // "entrada", "saldo", "parcela 1/3" — opcional
  saldo_remanescente?: number;        // se aplicável
  // Beneficiário do pagamento (terceiro)
  beneficiario_nome: string;
  beneficiario_cpf: string;           // CPF ou CNPJ (nome histórico) — o PDF rotula pelo número
  beneficiario_dados_bancarios: Required<Pick<DadosBancarios, "banco" | "agencia" | "conta">> & {
    chave_pix?: string;
  };
  parentesco?: string;                // "filha", "cônjuge", etc. — opcional
  cidade: string;
  data_emissao: string;
  // Assinante (no rodapé)
  signatario_nome: string;
  signatario_documento_label?: string; // "CNPJ" ou "CPF"
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 5. Termo de Transferência Bancária                                         */
/* ────────────────────────────────────────────────────────────────────────── */
export interface DadosTermoTransferencia {
  remetente_razao_social: string;
  remetente_documento: string;
  remetente_bancarios: Required<Pick<DadosBancarios, "banco" | "agencia" | "conta">>;
  destinatario_razao_social: string;
  destinatario_documento: string;
  destinatario_bancarios: Required<Pick<DadosBancarios, "banco" | "agencia" | "conta">> & {
    chave_pix?: string;
  };
  valor: number;
  data_transferencia: string;         // "YYYY-MM-DD"
  numero_nota?: string;
  descricao_objeto: string;           // resumo do motivo da transferência
  // Saldo remanescente (RF 24-jul): campos do formulário usados para montar a
  // frase padrão dentro de descricao_objeto. Guardados no snapshot para a
  // edição/duplicação reabrir com os valores preenchidos. O gerador não os lê.
  saldo_remanescente?: number;
  saldo_parcelado?: boolean;
  saldo_parcelas?: number;
  // Templates de fornecedor (ajuste 29-jul):
  /** Título do documento; default "TERMO DE TRANSFERÊNCIA BANCÁRIA". */
  titulo_documento?: string;
  /** Nome por extenso do favorecido no 1º parágrafo, quando difere da razão social. */
  destinatario_nome_paragrafo?: string;
  /** CNPJ/CPF citado no 1º parágrafo quando difere do destinatário — NF emitida por
   *  uma empresa e paga na conta de outra (ajuste 02-out). Default: destinatario_documento. */
  destinatario_documento_paragrafo?: string;
  /** Bloco de observações (markdown-lite: **negrito**, "- " bullet, "1. " numerada). */
  observacoes?: string;
  /** Id do template de fornecedor usado (reabre a edição com o modelo marcado). */
  template_fornecedor_id?: string;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 6. Contrato de Prestação de Serviços                                       */
/* ────────────────────────────────────────────────────────────────────────── */
export interface ContratoParcela {
  data: string;                       // "YYYY-MM-DD"
  valor: number;
  descricao?: string;                 // "entrada", "intermediário", "final"
  forma_pagamento?: string;
}

export interface DadosContratoPrestacaoServicos {
  // Contratante
  contratante_razao_social: string;
  contratante_cnpj: string;
  contratante_inscricao_estadual?: string;
  contratante_endereco: string;
  contratante_telefone?: string;
  contratante_email?: string;
  contratante_representantes: string; // texto livre: "Cláudio Luiz Resta Fragelli e Ana Beatriz Ponte Fragelli"
  // Contratado
  contratado_nome: string;
  contratado_nacionalidade?: string;  // "brasileiro" por padrão
  contratado_nascimento?: string;     // "YYYY-MM-DD"
  contratado_naturalidade?: string;
  contratado_cpf: string;
  contratado_rg?: string;
  contratado_endereco: string;
  // Cláusulas variáveis
  objeto: string;                     // texto da cláusula 1
  valor_total: number;
  pagamento_texto: string;            // texto livre da cláusula 2 (parcelas e formas)
  prazo_texto: string;                // texto da cláusula 3
  multa_percentual?: number;          // default 10
  foro_comarca: string;               // "Maracaju/MS"
  cidade: string;
  data_emissao: string;
}

/* ────────────────────────────────────────────────────────────────────────── */

import type { DocumentoGeradoTipo } from "@/types";

export type DocumentoPayloadMap = {
  recibo_vale_combustivel:               DadosReciboValeCombustivel;
  recibo_aluguel:                        DadosReciboAluguel;
  recibo_pagamento_prestador:            DadosReciboPagamentoPrestador;
  termo_autorizacao_pagamento_terceiros: DadosTermoAutorizacaoTerceiros;
  termo_transferencia_bancaria:          DadosTermoTransferencia;
  contrato_prestacao_servicos:           DadosContratoPrestacaoServicos;
};

export type AnyDocumentoPayload = DocumentoPayloadMap[DocumentoGeradoTipo];
