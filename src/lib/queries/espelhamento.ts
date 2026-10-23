// Espelhamento anual — gerar o provisionado do ano seguinte a partir do ano
// corrente (pedido de 17-ago-2026).
//
//   "Criar uma forma automatizada de espelhamento dos lançamentos anuais,
//    principalmente na virada do ano, para gerar o provisionado do ano seguinte
//    sem precisar copiar, lançar e editar item por item.
//    Os lançamentos que precisariam ser espelhados seriam: Despesas fixas;
//    Despesas periódicas. (…) As vendas também não precisam ser copiadas, pois
//    serão lançadas conforme forem realizadas."
//
// Mora no cliente de propósito: o valor da ferramenta está na PRÉVIA — ela
// conferir mês a mês o que vai nascer antes de mandar gravar. Uma função no
// banco resolveria a inserção, mas não a conferência, e a virada do ano é
// exatamente a hora em que ninguém quer descobrir depois.

import { createClient } from "@/lib/supabase/client";
import { obterPapeis } from "@/lib/plano/papeis-client";
import type {
  StatusAramburu,
  TipoDespesa,
  TransacaoEmpresaInsert,
} from "@/types";
import type { TransacaoEmpresaRich } from "./financeiro";

/** Etiqueta que amarra a cópia à origem — é ela que torna a operação repetível. */
export const espelhoTag = (anoDestino: string, origemId: string) =>
  `espelho:${anoDestino}:${origemId}`;

/**
 * Procedências que o sistema mantém sozinho. Espelhá-las criaria linhas órfãs
 * que os gatilhos não reconhecem (e, no caso dos resgates, resgates fantasma):
 * elas nascem de novo naturalmente quando os lançamentos de origem existirem.
 */
const ORIGEM_AUTOMATICA = /^(auto:|dl_auto:|dl_repasse:|dv_auto:|venda_auto:|venda_taxa_auto:|espelho:)/;

/**
 * Contas que se recriam sozinhas e não devem ser copiadas (pelo papel — os
 * códigos vêm do mapa de papéis, 0066):
 *   resgate (1.8) — Resgate de Aplicações (o gatilho do Invest cria conforme os títulos);
 *   dl (2.8)      — Distribuição de Lucro (o SOMASE do detalhado mantém o global).
 */
async function contasExcluidas(): Promise<ReadonlySet<string>> {
  const papeis = await obterPapeis();
  return new Set([papeis.resgate, papeis.dl]);
}

export interface EspelhamentoOpcoes {
  anoOrigem: string;              // "2026"
  anoDestino: string;             // "2027"
  tipos: TipoDespesa[];           // ["fixa", "periodica"] por padrão
  /** Status com que as cópias nascem. Padrão: Provisionado. */
  status: StatusAramburu;
}

export interface EspelhamentoLinha {
  origem: TransacaoEmpresaRich;
  dataDestino: string;            // "AAAA-MM-DD"
  jaExiste: boolean;              // já espelhado numa rodada anterior
}

export interface EspelhamentoPrevia {
  linhas: EspelhamentoLinha[];
  novas: number;
  jaEspelhadas: number;
  totalNovas: number;             // soma (negativa) do que será criado
  porMes: { mes: string; qtd: number; total: number }[];
}

/**
 * Mesma data no ano seguinte. 29/02 de ano bissexto vira 28/02 — o vencimento
 * anda um dia, e é preferível a um lançamento que simplesmente não existe.
 */
export function mesmaDataNoAno(iso: string, anoDestino: string): string {
  const [, m, d] = iso.split("-");
  const ano = Number(anoDestino);
  const ultimoDia = new Date(ano, Number(m), 0).getDate();
  const dia = Math.min(Number(d), ultimoDia);
  return `${anoDestino}-${m}-${String(dia).padStart(2, "0")}`;
}

/** Vale a pena espelhar? (filtros que o servidor não expressa bem). */
function espelhavel(r: TransacaoEmpresaRich, excluidas: ReadonlySet<string>): boolean {
  if (r.origem_planilha && ORIGEM_AUTOMATICA.test(r.origem_planilha)) return false;
  if (excluidas.has(r.conta_contabil_cod)) return false;
  if (r.status === "saldo_inicial") return false;
  return true;
}

export async function montarPreviaEspelhamento(opts: EspelhamentoOpcoes): Promise<EspelhamentoPrevia> {
  const supabase = createClient();
  if (opts.tipos.length === 0) {
    return { linhas: [], novas: 0, jaEspelhadas: 0, totalNovas: 0, porMes: [] };
  }

  const { data, error } = await supabase
    .from("transacoes_empresa")
    .select(`
      *,
      conta_contabil:classificacao_financeira!transacoes_empresa_conta_contabil_cod_fkey(codigo, nome),
      centro_custo:classificacao_financeira!transacoes_empresa_centro_custo_cod_fkey(codigo, nome),
      conta_bancaria:contas_bancarias_empresa(id, nome, apelido)
    `)
    .gte("data", `${opts.anoOrigem}-01-01`)
    .lte("data", `${opts.anoOrigem}-12-31`)
    .in("tipo_despesa", opts.tipos)
    .lt("valor", 0)                       // só DESPESA: receita se lança quando acontece
    .order("data", { ascending: true })
    .range(0, 4999);
  if (error) throw error;

  const excluidas = await contasExcluidas();
  const candidatas = ((data ?? []) as TransacaoEmpresaRich[]).filter((r) => espelhavel(r, excluidas));

  // O que já foi espelhado numa rodada anterior — é o que torna repetir seguro.
  const { data: jaFeitas, error: e2 } = await supabase
    .from("transacoes_empresa")
    .select("origem_planilha")
    .like("origem_planilha", `espelho:${opts.anoDestino}:%`)
    .range(0, 9999);
  if (e2) throw e2;
  const existentes = new Set(
    ((jaFeitas ?? []) as { origem_planilha: string }[]).map((r) => r.origem_planilha),
  );

  const linhas: EspelhamentoLinha[] = candidatas.map((origem) => ({
    origem,
    dataDestino: mesmaDataNoAno(origem.data, opts.anoDestino),
    jaExiste: existentes.has(espelhoTag(opts.anoDestino, origem.id)),
  }));

  const porMesMap = new Map<string, { qtd: number; total: number }>();
  let totalNovas = 0;
  let novas = 0;
  for (const l of linhas) {
    if (l.jaExiste) continue;
    novas += 1;
    const v = Number(l.origem.valor);
    totalNovas += v;
    const mes = l.dataDestino.slice(0, 7);
    const acc = porMesMap.get(mes) ?? { qtd: 0, total: 0 };
    acc.qtd += 1;
    acc.total += v;
    porMesMap.set(mes, acc);
  }

  return {
    linhas,
    novas,
    jaEspelhadas: linhas.length - novas,
    totalNovas,
    porMes: Array.from(porMesMap, ([mes, x]) => ({ mes, ...x })).sort((a, b) => a.mes.localeCompare(b.mes)),
  };
}

export interface EspelhamentoResultado {
  criados: number;
  total: number;
}

/**
 * Grava as cópias. O que NÃO é copiado, e por quê:
 *   • `parcelas` — uma série "2/12" não transpõe para o ano seguinte;
 *   • `data_emissao` e `dispensa_resgate` — dependem de um documento e de um
 *     pagamento que ainda não existem;
 *   • `fornecedor_id`/`ref` seguem, porque identificam o mesmo compromisso.
 *
 * Em lotes: um INSERT único de 400 linhas com os gatilhos de resgate ativos
 * chega a estourar o tempo do PostgREST.
 */
export async function executarEspelhamento(
  opts: EspelhamentoOpcoes,
  previa: EspelhamentoPrevia,
): Promise<EspelhamentoResultado> {
  const supabase = createClient();
  const alvo = previa.linhas.filter((l) => !l.jaExiste);
  if (alvo.length === 0) return { criados: 0, total: 0 };

  const payloads: TransacaoEmpresaInsert[] = alvo.map(({ origem, dataDestino }) => ({
    data: dataDestino,
    data_emissao: null,
    conta_contabil_cod: origem.conta_contabil_cod,
    centro_custo_cod: origem.centro_custo_cod,
    tipo_despesa: origem.tipo_despesa,
    fornecedor_id: origem.fornecedor_id,
    fornecedor_nome: origem.fornecedor_nome,
    descricao: origem.descricao,
    obs_obra: origem.obs_obra,
    ref: origem.ref,
    parcelas: null,
    forma_pgto: origem.forma_pgto,
    conta_bancaria_id: origem.conta_bancaria_id,
    status: opts.status,
    valor: origem.valor,
    observacao:
      `Espelhado do lançamento de ${origem.data.split("-").reverse().join("/")} ` +
      `na virada de ${opts.anoOrigem} para ${opts.anoDestino}. Revise valor e vencimento.` +
      (origem.observacao ? `\n\n${origem.observacao}` : ""),
    origem_planilha: espelhoTag(opts.anoDestino, origem.id),
    created_by: null,
  }));

  let criados = 0;
  const LOTE = 100;
  for (let i = 0; i < payloads.length; i += LOTE) {
    const { data, error } = await supabase
      .from("transacoes_empresa")
      .insert(payloads.slice(i, i + LOTE))
      .select("id");
    if (error) {
      // Erro no meio: o que já entrou fica (e a etiqueta impede duplicar numa
      // nova tentativa). Dizer quantos entraram é mais útil que fingir que nada
      // aconteceu.
      throw new Error(
        `${(error as { message?: string }).message ?? String(error)} ` +
        `(${criados} de ${payloads.length} lançamentos já haviam sido criados — ` +
        `rode de novo para continuar de onde parou).`,
      );
    }
    criados += data?.length ?? 0;
  }
  return { criados, total: payloads.length };
}

/**
 * Gera as 12 linhas de saldo de Despesa Variável do ano (migration 0054) — o
 * "esse valor mensal de 20k precisaria ser lançado no sistema" do documento.
 * Depois de criadas, o banco as mantém iguais ao saldo restante do mês.
 */
export async function gerarLinhasSaldoDvDoAno(ano: string): Promise<number> {
  const supabase = createClient();
  let n = 0;
  for (let m = 1; m <= 12; m++) {
    const mes = `${ano}-${String(m).padStart(2, "0")}`;
    const { error } = await supabase.rpc("fn_dv_gerar_linha" as never, { p_mes: mes } as never);
    if (error) throw error;
    n += 1;
  }
  return n;
}
