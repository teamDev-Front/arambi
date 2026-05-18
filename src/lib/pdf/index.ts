// Roteador central: recebe `tipo` + payload e devolve o Uint8Array do PDF.

import type { DocumentoGeradoTipo } from "@/types";
import type { AnyDocumentoPayload, DocumentoPayloadMap } from "./types";

import { gerarReciboValeCombustivel }     from "./generators/recibo-vale-combustivel";
import { gerarReciboAluguel }             from "./generators/recibo-aluguel";
import { gerarReciboPagamentoPrestador }  from "./generators/recibo-pagamento-prestador";
import { gerarTermoAutorizacaoTerceiros } from "./generators/termo-autorizacao-terceiros";
import { gerarTermoTransferenciaBancaria } from "./generators/termo-transferencia-bancaria";
import { gerarContratoPrestacaoServicos } from "./generators/contrato-prestacao-servicos";

export type { AnyDocumentoPayload, DocumentoPayloadMap } from "./types";

const GERADORES = {
  recibo_vale_combustivel:               gerarReciboValeCombustivel,
  recibo_aluguel:                        gerarReciboAluguel,
  recibo_pagamento_prestador:            gerarReciboPagamentoPrestador,
  termo_autorizacao_pagamento_terceiros: gerarTermoAutorizacaoTerceiros,
  termo_transferencia_bancaria:          gerarTermoTransferenciaBancaria,
  contrato_prestacao_servicos:           gerarContratoPrestacaoServicos,
} as const;

export async function gerarDocumentoPdf<T extends DocumentoGeradoTipo>(
  tipo: T,
  dados: DocumentoPayloadMap[T],
): Promise<Uint8Array> {
  const fn = GERADORES[tipo] as (d: AnyDocumentoPayload) => Promise<Uint8Array>;
  if (!fn) throw new Error(`Gerador não encontrado para tipo "${tipo}"`);
  return fn(dados);
}

/**
 * Resumos curtos para preencher os campos auxiliares da row em `documentos_gerados`
 * (beneficiario, valor, descricao, numero) — usados nas buscas e na tabela do front.
 */
export function resumoDocumento<T extends DocumentoGeradoTipo>(
  tipo: T,
  dados: DocumentoPayloadMap[T],
): {
  numero: string | null;
  beneficiario: string | null;
  valor: number | null;
  descricao: string | null;
  mes_referencia: string | null;
} {
  switch (tipo) {
    case "recibo_vale_combustivel": {
      const d = dados as DocumentoPayloadMap["recibo_vale_combustivel"];
      return {
        numero: null,
        beneficiario: d.beneficiario.nome,
        valor: d.valor,
        descricao: `Vale combustível – competência ${d.competencia} (${d.periodo})`,
        mes_referencia: d.competencia,
      };
    }
    case "recibo_aluguel": {
      const d = dados as DocumentoPayloadMap["recibo_aluguel"];
      return {
        numero: d.numero,
        beneficiario: d.proprietario_nome,
        valor: d.valor,
        descricao: `Aluguel ${d.imovel_nome} – ${d.competencia}`,
        mes_referencia: d.competencia,
      };
    }
    case "recibo_pagamento_prestador": {
      const d = dados as DocumentoPayloadMap["recibo_pagamento_prestador"];
      return {
        numero: null,
        beneficiario: d.prestador.nome,
        valor: d.valor,
        descricao: d.descricao_servico,
        mes_referencia: d.data_emissao ? d.data_emissao.slice(0, 7) : null,
      };
    }
    case "termo_autorizacao_pagamento_terceiros": {
      const d = dados as DocumentoPayloadMap["termo_autorizacao_pagamento_terceiros"];
      return {
        numero: d.numero_nota ? `NF ${d.numero_nota}` : null,
        beneficiario: d.beneficiario_nome,
        valor: d.valor_pagamento,
        descricao: `Autorização pgto. NF ${d.numero_nota} – ${d.autorizante_razao_social}`,
        mes_referencia: d.data_emissao.slice(0, 7),
      };
    }
    case "termo_transferencia_bancaria": {
      const d = dados as DocumentoPayloadMap["termo_transferencia_bancaria"];
      return {
        numero: d.numero_nota ? `NF ${d.numero_nota}` : null,
        beneficiario: d.destinatario_razao_social,
        valor: d.valor,
        descricao: d.descricao_objeto,
        mes_referencia: d.data_transferencia.slice(0, 7),
      };
    }
    case "contrato_prestacao_servicos": {
      const d = dados as DocumentoPayloadMap["contrato_prestacao_servicos"];
      return {
        numero: null,
        beneficiario: d.contratado_nome,
        valor: d.valor_total,
        descricao: d.objeto.length > 200 ? d.objeto.slice(0, 197) + "..." : d.objeto,
        mes_referencia: d.data_emissao.slice(0, 7),
      };
    }
  }
}
