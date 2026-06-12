// Configuração central das instituições financeiras (RF-FIN-02).
// Centraliza a identidade visual (cor + monograma) de cada banco para os cards,
// sem depender de imagens remotas instáveis. O monograma serve de logo robusto
// e fallback. O rótulo da conta (Cc./Inv.) também vem daqui, pois correlaciona
// com a instituição (XP é corretora de investimento) e não com o tipo da conta —
// é o que reproduz fielmente o painel pedido pela Lola.

export interface BancoBrand {
  /** substrings (lowercase) que casam com o campo `banco`/`apelido` da conta */
  match: string[];
  /** cor de fundo do selo */
  bg: string;
  /** cor do texto/ícone do selo */
  fg: string;
  /** monograma exibido no selo */
  monograma: string;
  /** prefixo do número da conta no card: "Cc." (corrente) ou "Inv." (investimento) */
  contaLabel: "Cc." | "Inv.";
}

const BRANDS: BancoBrand[] = [
  { match: ["cora"],    bg: "#E6457A", fg: "#ffffff", monograma: "C",  contaLabel: "Cc." }, // Cora — rosa
  { match: ["sicredi"], bg: "#3FA535", fg: "#ffffff", monograma: "S",  contaLabel: "Cc." }, // Sicredi — verde
  { match: ["inter"],   bg: "#FF7A00", fg: "#ffffff", monograma: "I",  contaLabel: "Cc." }, // Inter — laranja
  { match: ["xp"],      bg: "#0F0F0F", fg: "#ffffff", monograma: "XP", contaLabel: "Inv." }, // XP — preto
];

function iniciais(s: string): string {
  const parts = s.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "$";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function getBancoBrand(banco?: string | null, apelido?: string | null): BancoBrand {
  const hay = `${banco ?? ""} ${apelido ?? ""}`.toLowerCase();
  const hit = BRANDS.find((b) => b.match.some((m) => hay.includes(m)));
  if (hit) return hit;
  return { match: [], bg: "#57534e", fg: "#ffffff", monograma: iniciais(apelido ?? banco ?? "?"), contaLabel: "Cc." };
}

export interface IdentificacaoBancariaInput {
  banco?: string | null;
  apelido?: string | null;
  tipoInstituicao?: string | null;   // "banco" | "cooperativa"
  numeroBanco?: string | null;       // 403, 748, 077, 348
  agencia?: string | null;
  tipo?: string | null;              // "corrente" | "investimento"
  numeroConta?: string | null;
  digito?: string | null;
}

/**
 * Monta a linha de identificação do card, ex.:
 *   "Banco 403 · Ag. 0001 · Cc. 2347942-2"
 *   "Cooperativa 748 · Ag. 0913 · Cc. 29945-3"
 *   "Banco 348 · Ag. 0001 · Inv. 5740321"
 * Só inclui as partes existentes (fallback claro quando faltam dados).
 */
export function formatIdentificacaoBancaria(conta: IdentificacaoBancariaInput): string {
  const inst = (conta.tipoInstituicao ?? "banco").toLowerCase() === "cooperativa" ? "Cooperativa" : "Banco";
  const brand = getBancoBrand(conta.banco, conta.apelido);
  const partes: string[] = [];
  if (conta.numeroBanco) partes.push(`${inst} ${conta.numeroBanco}`);
  if (conta.agencia) partes.push(`Ag. ${conta.agencia}`);
  if (conta.numeroConta) {
    const numero = conta.digito ? `${conta.numeroConta}-${conta.digito}` : conta.numeroConta;
    partes.push(`${brand.contaLabel} ${numero}`);
  }
  return partes.join(" · ");
}
