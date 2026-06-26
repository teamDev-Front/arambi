// Mapa centralizado: status financeiro (Aramburu) → cor (RF-FIN-05).
//
// As cores reproduzem a LEGENDA DO EXCEL da Lola (PDF "Considerações 12 jun"):
//   cinza      → Saldo inicial
//   azul-claro → Recebido
//   verde      → Pago, Repassado, Aplicado, Resgatado
//   azul       → A receber
//   vermelho   → A pagar, A repassar, A aplicar, A resgatar
//   amarelo    → Provisionado, Aplicação, Resgate, Provisionado DV, Provisionado DL
//
// Centralizado aqui para o MESMO status ter a MESMA cor em tabela, modais e
// qualquer badge. INDEPENDENTE da paleta lateral (RF-FIN-04 não as afeta).

import { type StatusAramburu } from "@/types";
import { getStatusKind } from "@/lib/utils/status-config";

// Paleta do Excel (aprovada pela cliente)
const C = {
  cinza:    "bg-[#6b7280] text-white",   // Saldo inicial
  ciano:    "bg-[#29abe2] text-white",   // Recebido
  verde:    "bg-[#22b14c] text-white",   // realizados (Pago/Repassado/Aplicado/Resgatado)
  azul:     "bg-[#0071bc] text-white",   // A receber
  vermelho: "bg-[#ed1c24] text-white",   // A pagar/repassar/aplicar/resgatar
  amarelo:  "bg-[#f7b500] text-stone-900", // Provisionado* / Aplicação / Resgate
} as const;

const STATUS_BADGE_CLASS: Record<StatusAramburu, string> = {
  saldo_inicial:   C.cinza,
  recebido:        C.ciano,
  a_receber:       C.azul,
  pago:            C.verde,
  repassado:       C.verde,
  aplicado:        C.verde,
  resgatado:       C.verde,
  a_pagar:         C.vermelho,
  a_repassar:      C.vermelho,
  a_aplicar:       C.vermelho,
  a_resgatar:      C.vermelho,
  aplicacao:       C.amarelo,
  resgate:         C.amarelo,
  provisionado:    C.amarelo,
  provisionado_dl: C.amarelo,
  provisionado_dv: C.amarelo,
};

/** Classes (bg + text) do badge de status, conforme a legenda do Excel. */
export function statusBadgeClassName(status: StatusAramburu): string {
  return STATUS_BADGE_CLASS[status] ?? C.cinza;
}

/**
 * Cor de TEXTO para o valor monetário, coerente com a natureza do lançamento
 * (entrada = verde, saída = vermelho, neutro = cinza). Usada em tabelas/modais.
 */
export function valorTextColor(status: StatusAramburu | string): string {
  const k = getStatusKind(status); // data-driven (suporta status novos), com fallback
  if (k === "entrada") return "text-emerald-700";
  if (k === "saida") return "text-red-600";
  return "text-stone-700";
}
