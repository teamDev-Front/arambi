// Leitura ANALÍTICA dos resgates do Sicredi Invest (pedido da Adri, 04-ago-2026).
//
// Contexto do pedido: o resgate automático não é por título — é uma linha só
// por DIA (e, desde a 0048, uma por FATURA no caso do cartão) somando todos os
// títulos daquele recorte. Só que a soma não aparecia em lugar nenhum: ela via
// um resgate de R$ 3.209,03, não encontrava o título de R$ 51,00 dentro dele e
// lançava um resgate manual — criando duplicidade. Era o que ela resolvia na
// planilha com tabela dinâmica.
//
// Este módulo entrega as duas leituras que faltavam:
//   • composição de um resgate (quais títulos formam a soma) e o caminho
//     inverso (dado um título, qual resgate o cobre);
//   • conferência "o Sicredi tem que zerar": toda saída da conta corrente tem
//     um resgate equivalente entrando do Invest, então o líquido é zero. O que
//     não fecha é justamente o que ela precisa olhar.

import { createClient } from "@/lib/supabase/client";
import { obterPapeis } from "@/lib/plano/papeis-client";
import type { TransacaoEmpresaRich } from "./financeiro";

const SELECT_RICH = `
  *,
  conta_contabil:classificacao_financeira!transacoes_empresa_conta_contabil_cod_fkey(codigo, nome),
  centro_custo:classificacao_financeira!transacoes_empresa_centro_custo_cod_fkey(codigo, nome),
  conta_bancaria:contas_bancarias_empresa(id, nome, apelido)
`;

/**
 * Uma linha é resgate automático do Invest? (diário 0044 ou de fatura 0048)
 * `contaResgate` = código da conta do papel `resgate` (1.8 hoje) — vem do mapa
 * de papéis (usePapeis/obterPapeis), para acompanhar a troca de código.
 */
export function ehResgateAutomatico(
  r: { conta_contabil_cod: string; origem_planilha: string | null },
  contaResgate: string,
): boolean {
  return r.conta_contabil_cod === contaResgate
    && !!r.origem_planilha
    && r.origem_planilha.startsWith("auto:resgate_invest")
    && !r.origem_planilha.startsWith("auto:resgate_invest_saida");
}

/** Rótulo do tipo de agrupamento, para a tela explicar o critério da soma. */
export function tipoDoResgate(origem: string | null): "provisionado" | "fatura" | "diario" | "manual" {
  if (!origem) return "manual";
  // 0053: a linha amarela mensal, que soma o que ainda está só programado.
  if (origem.startsWith("auto:resgate_invest_prov:")) return "provisionado";
  if (origem.startsWith("auto:resgate_invest_fatura:")) return "fatura";
  if (origem.startsWith("auto:resgate_invest:")) return "diario";
  return "manual";
}

export interface ComposicaoResgate {
  resgate: TransacaoEmpresaRich;
  titulos: TransacaoEmpresaRich[];
  somaTitulos: number;   // magnitude positiva (títulos são negativos)
  valorResgate: number;  // magnitude positiva
  /** Diferença entre o resgate e a soma dos títulos (deve ser 0). */
  diferenca: number;
  tipo: "provisionado" | "fatura" | "diario" | "manual";
}

/**
 * Composição de um resgate: todos os títulos que o alimentam.
 * `somaTitulos` deve bater com `valorResgate` — quando não bate, alguém editou
 * o resgate à mão ou o recálculo não rodou, e a tela avisa.
 */
export async function obterComposicaoResgate(resgateId: string): Promise<ComposicaoResgate | null> {
  const supabase = createClient();
  const [resR, titR] = await Promise.all([
    supabase.from("transacoes_empresa").select(SELECT_RICH).eq("id", resgateId).maybeSingle(),
    supabase.from("transacoes_empresa").select(SELECT_RICH)
      .eq("resgate_auto_id", resgateId)
      .order("data", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);
  if (resR.error) throw resR.error;
  if (titR.error) throw titR.error;
  const resgate = resR.data as unknown as TransacaoEmpresaRich | null;
  if (!resgate) return null;

  const titulos = (titR.data ?? []) as unknown as TransacaoEmpresaRich[];
  const somaTitulos = titulos.reduce((s, t) => s + Math.abs(Number(t.valor)), 0);
  const valorResgate = Math.abs(Number(resgate.valor));
  return {
    resgate,
    titulos,
    somaTitulos,
    valorResgate,
    diferenca: valorResgate - somaTitulos,
    tipo: tipoDoResgate(resgate.origem_planilha),
  };
}

// ----------------------------------------------------------------------------
// Conferência "o Sicredi zera"
// ----------------------------------------------------------------------------
export interface LinhaConferenciaSicredi {
  mes: string;            // "YYYY-MM"
  saidas: number;         // magnitude das despesas da corrente Sicredi
  resgates: number;       // magnitude dos resgates entrando do Invest
  diferenca: number;      // resgates − saídas (0 = fechou)
  qtdSaidas: number;
  qtdSemResgate: number;  // saídas sem resgate vinculado (só as criadas no sistema)
  aplicacoes: number;     // dinheiro indo da corrente PARA o Invest (não é despesa)
  pagasPeloSaldo: number; // tarifas bancadas pelo saldo próprio da conta (0049)
}

export interface ConferenciaSicredi {
  contaEncontrada: boolean;
  linhas: LinhaConferenciaSicredi[];
  totalSaidas: number;
  totalResgates: number;
  /**
   * Saídas sem resgate vinculado criadas NO SISTEMA — é o que ela pode agir.
   * As importadas da planilha ficam fora (ver `qtdHistoricoSemResgate`).
   */
  semResgate: TransacaoEmpresaRich[];
  /**
   * Quantas saídas sem resgate vieram da importação da planilha. Não são erro:
   * são anteriores à automação e já foram conferidas por extrato bancário.
   */
  qtdHistoricoSemResgate: number;
  /** Resgates automáticos que ficaram sem nenhum título (linha órfã). */
  semTitulo: TransacaoEmpresaRich[];
}

/** Status que representam movimento JÁ REALIZADO (bate com o extrato). */
const STATUS_REALIZADO = ["pago", "recebido", "repassado", "resgatado", "aplicado", "aplicacao"];

/**
 * Linha que NÃO precisa ser cobrada de resgate: veio da importação da planilha
 * E já está realizada — ou seja, é passado que a Adri já conferiu contra o
 * extrato bancário ("se o saldo está batendo, o para trás está certo").
 *
 * Cuidado que custou uma versão: importado + AINDA EM ABERTO (A pagar) não é
 * histórico, é despesa futura de verdade. Foi assim que apareceram os R$ 156,50
 * mensais (Integralização de Capital R$ 100 + Cesta Relacionamento R$ 56,50) que
 * se repetem até dezembro sem resgate nenhum.
 */
function ehHistoricoConferido(r: { origem_planilha: string | null; status: string }): boolean {
  return !!r.origem_planilha
    && r.origem_planilha.startsWith("aramburu_mensal:")
    && STATUS_REALIZADO.includes(r.status);
}

/**
 * Conferência da conta corrente Sicredi no ano informado.
 *
 * Regra do negócio (palavras dela): "tudo que está saindo como despesa não deve
 * somar lá nas despesas, porque a gente está fazendo resgate — então zera".
 * Ou seja: saídas e resgates se anulam. Uma diferença ≠ 0 no mês é sinal de
 * título sem resgate (falta dinheiro entrando) ou resgate sobrando.
 *
 * `saldo_inicial` fica de fora: é foto de saldo, não movimento.
 */
export async function obterConferenciaSicredi(ano: string): Promise<ConferenciaSicredi> {
  const supabase = createClient();

  const { data: conta, error: eConta } = await supabase
    .from("contas_bancarias_empresa")
    .select("id")
    .eq("nome", "Cooperativa Sicredi (0913)")
    .maybeSingle();
  if (eConta) throw eConta;

  const vazio: ConferenciaSicredi = {
    contaEncontrada: false, linhas: [], totalSaidas: 0, totalResgates: 0,
    semResgate: [], qtdHistoricoSemResgate: 0, semTitulo: [],
  };
  const contaId = (conta as { id: string } | null)?.id;
  if (!contaId) return vazio;

  const { data, error } = await supabase
    .from("transacoes_empresa")
    .select(SELECT_RICH)
    .eq("conta_bancaria_id", contaId)
    .neq("status", "saldo_inicial")
    .gte("data", `${ano}-01-01`)
    .lte("data", `${ano}-12-31`)
    .order("data", { ascending: true })
    .range(0, 9999);
  if (error) throw error;

  const rows = (data ?? []) as unknown as TransacaoEmpresaRich[];
  // Conta do resgate pelo papel (0066) — 1.8 hoje.
  const contaResgate = (await obterPapeis()).resgate;
  const porMes = new Map<string, LinhaConferenciaSicredi>();
  const linha = (mes: string): LinhaConferenciaSicredi => {
    let l = porMes.get(mes);
    if (!l) {
      l = { mes, saidas: 0, resgates: 0, diferenca: 0, qtdSaidas: 0, qtdSemResgate: 0, aplicacoes: 0, pagasPeloSaldo: 0 };
      porMes.set(mes, l);
    }
    return l;
  };

  const semResgate: TransacaoEmpresaRich[] = [];
  const comTitulo = new Set<string>();
  const resgates: TransacaoEmpresaRich[] = [];
  let qtdHistoricoSemResgate = 0;

  for (const r of rows) {
    const l = linha(r.mes_referencia);
    const valor = Number(r.valor);

    if (ehResgateAutomatico(r, contaResgate)) {
      l.resgates += Math.abs(valor);
      resgates.push(r);
      continue;
    }
    // Resgate lançado à mão (conta do resgate sem etiqueta) também é entrada de resgate.
    if (r.conta_contabil_cod === contaResgate && valor > 0) {
      l.resgates += valor;
      continue;
    }
    // APLICAÇÃO não é despesa: é dinheiro saindo da corrente para o próprio
    // Invest. Contá-la como saída fazia janeiro parecer R$ 300 mil "sem
    // resgate" — o oposto do que a conferência precisa mostrar.
    if (r.status === "aplicado" || r.status === "aplicacao") {
      if (valor < 0) l.aplicacoes += Math.abs(valor);
      continue;
    }
    // Tarifas bancadas pelo saldo próprio da conta (0049): saem da comparação.
    // A Adri transferiu R$ 1.878,00 do Cora em jan/2026 — 12 × R$ 156,50 — justo
    // para cobrir essas taxas o ano todo, então elas não devem puxar resgate.
    if (r.dispensa_resgate && valor < 0) {
      l.pagasPeloSaldo += Math.abs(valor);
      continue;
    }
    if (valor < 0) {
      l.saidas += Math.abs(valor);
      l.qtdSaidas += 1;
      if (r.resgate_auto_id) {
        comTitulo.add(r.resgate_auto_id);
      } else if (ehHistoricoConferido(r)) {
        // Passado importado da planilha e já batido no extrato — não é pendência.
        qtdHistoricoSemResgate += 1;
      } else {
        l.qtdSemResgate += 1;
        semResgate.push(r);
      }
    }
  }

  for (const l of porMes.values()) l.diferenca = l.resgates - l.saidas;

  return {
    contaEncontrada: true,
    linhas: Array.from(porMes.values()).sort((a, b) => a.mes.localeCompare(b.mes)),
    totalSaidas: Array.from(porMes.values()).reduce((s, l) => s + l.saidas, 0),
    totalResgates: Array.from(porMes.values()).reduce((s, l) => s + l.resgates, 0),
    semResgate,
    qtdHistoricoSemResgate,
    semTitulo: resgates.filter((g) => !comTitulo.has(g.id)),
  };
}
