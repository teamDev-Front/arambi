import type { DocumentoGeradoTipo } from "@/types";
import { ReciboValeForm }          from "./ReciboValeForm";
import { ReciboAluguelForm }       from "./ReciboAluguelForm";
import { ReciboPrestadorForm }     from "./ReciboPrestadorForm";
import { TermoAutorizacaoForm }    from "./TermoAutorizacaoForm";
import { TermoTransferenciaForm }  from "./TermoTransferenciaForm";
import { ContratoForm }            from "./ContratoForm";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const FORM_BY_TIPO: Record<DocumentoGeradoTipo, React.ComponentType<any>> = {
  recibo_vale_combustivel:               ReciboValeForm,
  recibo_aluguel:                        ReciboAluguelForm,
  recibo_pagamento_prestador:            ReciboPrestadorForm,
  termo_autorizacao_pagamento_terceiros: TermoAutorizacaoForm,
  termo_transferencia_bancaria:          TermoTransferenciaForm,
  contrato_prestacao_servicos:           ContratoForm,
};
