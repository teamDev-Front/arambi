// Exportação do Culturas & Safra — "Detalhe dos Depósitos": XLSX (ajuste 27-jul)
// e PDF (reunião de 20-out).
//
// Espelha as colunas da tabela da tela — quantidades em SACAS (unidade principal
// desde 20-out; kg só nos campos de entrada) e valores de SALDO no cenário de
// venda a terceiros — + linha de TOTAIS, com o contexto Armazém × Cultura ×
// Safra no cabeçalho. Roda 100% no client a partir das linhas já carregadas.

"use client";

import { formatCurrency, formatDate } from "@/lib/utils/format";
import { calcularResumoSafra, sacasDoDeposito, type SafraResumo } from "@/lib/queries/safra";
import { SAFRA_DEP_STATUS_LABEL, type SafraDepositoCalculadoRow } from "@/types";
import { buildXlsx, xtext, xmoney, xnum, type XlsxValue } from "./xlsx";
import { baixarArquivo, exportarPdfTabela, nomeArquivoRelatorio, type PdfColuna } from "./pdf-tabela";

export interface EstoqueExportMeta {
  armazem?: string;
  cultura?: string;
  safra?: string;
  /** Filtros extras humanizados (busca, status…). */
  filtros?: string[];
  /** "Emitido por: Fulano | data às hora" (RF 20-ago) — topo da planilha, rodapé do PDF. */
  emitidoPor?: string;
  /**
   * Resumo da seleção SEM os filtros da tabela — o mesmo dos cards da tela —
   * para os quadros do PDF: o "Armazenado (inicial)" é referência fixa e não
   * encolhe com a busca/status. Ausente = resumo das próprias linhas.
   */
  resumo?: SafraResumo;
  /** Depósito Total Programado (sc) e andamento (%) — só quando configurado. */
  programado?: { sc: number; pct: number };
}

const fmtDec2 = (v: number): string =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtSc = (v: number): string => `${fmtDec2(v)} sc`;
/** Sacas arredondadas a 2 casas (célula numérica da planilha). */
const sc2 = (v: number): number => Math.round(v * 100) / 100;

/** Nenhuma nota com parâmetro salvo (kg por saca nulo) → sacas indisponíveis. */
function semSacas(r: SafraResumo): boolean {
  return r.qtd_depositos > 0 && r.qtd_sem_parametro === r.qtd_depositos;
}

function contexto(meta: EstoqueExportMeta): string {
  return [meta.armazem, meta.cultura, meta.safra].filter(Boolean).join(" · ");
}

export function exportEstoqueXlsx(
  rows: SafraDepositoCalculadoRow[],
  meta: EstoqueExportMeta = {},
): void {
  const n = (v: number | null | undefined): number => Number(v ?? 0);

  const ctx = contexto(meta);
  const titleRows: string[] = ["AramBI — Culturas & Safra — Detalhe dos Depósitos"];
  if (ctx) titleRows.push(ctx);
  if (meta.filtros && meta.filtros.length) titleRows.push(`Filtros: ${meta.filtros.join(" · ")}`);
  // RF 20-ago: o "Gerado em" virou a linha "Emitido por" (quem, data e hora).
  if (meta.emitidoPor) titleRows.push(meta.emitidoPor);

  const dataRows: XlsxValue[][] = rows.map((r) => {
    const s = sacasDoDeposito(r);
    // Nota sem parâmetro salvo não tem kg por saca: "—" em vez de 0.
    const sc = (v: number): XlsxValue => (s.disponivel ? xnum(sc2(v)) : xtext("—"));
    return [
      xtext(formatDate(r.data_deposito)),
      xtext(r.dfe_entrada ?? ""),
      xtext(r.nfp ?? ""),
      sc(s.inicial),
      sc(s.baixadas),
      sc(s.saldo),
      xnum(n(r.dias_percorridos)),
      xnum(n(r.quinzenas)),
      sc(s.quebra),
      sc(s.liquida),
      xmoney(n(r.taxa_armazenagem_saldo ?? r.taxa_armazenagem)),
      xmoney(n(r.taxa_devolucao_saldo ?? r.taxa_devolucao)),
      xmoney(n(r.total_a_descontar_saldo ?? r.total_a_descontar)),
      xmoney(n(r.valor_venda_saldo ?? r.valor_venda_simulado)),
      xtext(SAFRA_DEP_STATUS_LABEL[r.status] ?? r.status),
      xtext(r.observacao ?? ""),
    ];
  });

  // Mesma soma da linha de totais da tela.
  const tot = calcularResumoSafra(rows);
  const scTot = (v: number): XlsxValue =>
    semSacas(tot) ? xtext("—", { bold: true }) : xnum(sc2(v), { bold: true });
  dataRows.push([
    xtext("TOTAIS", { bold: true }),
    xtext(""), xtext(""),
    scTot(tot.total_sc_bruto),
    scTot(tot.total_sc_baixado),
    scTot(tot.total_sc_saldo),
    xtext(""), xtext(""),
    scTot(tot.total_quebra_sc),
    scTot(tot.total_sc_liquida),
    xmoney(tot.total_taxa_armazenagem, { bold: true }),
    xmoney(tot.total_taxa_devolucao, { bold: true }),
    xmoney(tot.total_a_descontar, { bold: true }),
    xmoney(tot.total_valor_venda, { bold: true }),
    xtext(""), xtext(""),
  ]);

  const bytes = buildXlsx({
    sheetName: "Depósitos",
    titleRows,
    columns: [
      { header: "Data", width: 12 },
      { header: "DFe", width: 10 },
      { header: "NFP", width: 12 },
      { header: "Sc Inicial", width: 12 },
      { header: "Sc Baixadas", width: 12 },
      { header: "Sc Saldo", width: 12 },
      { header: "Dias", width: 7 },
      { header: "Quinzenas", width: 10 },
      { header: "Quebra (sc)", width: 12 },
      { header: "Sc Líquidas", width: 12 },
      { header: "Tx Armazenagem", width: 16 },
      { header: "Tx Devolução", width: 14 },
      { header: "Total a Descontar", width: 17 },
      { header: "Valor Venda (sim.)", width: 17 },
      { header: "Status", width: 16 },
      { header: "Observação", width: 30 },
    ],
    rows: dataRows,
  });

  baixarArquivo(
    bytes,
    nomeArquivoRelatorio("culturas-safra", "xlsx"),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}

/**
 * PDF do "Detalhe dos Depósitos" (reunião de 20-out) no motor compartilhado
 * de relatórios: quadros de resumo da seleção (os cards da tela) + a tabela
 * filtrada com totais. Só texto WinAnsi — nada de emoji (Helvetica do pdf-lib).
 */
export async function exportEstoquePdf(
  rows: SafraDepositoCalculadoRow[],
  meta: EstoqueExportMeta = {},
): Promise<void> {
  const n = (v: number | null | undefined): number => Number(v ?? 0);

  // Quadros = seleção inteira (cards); totais = só as linhas exportadas.
  const resumo = meta.resumo ?? calcularResumoSafra(rows);
  const tot = calcularResumoSafra(rows);
  const scResumo = (v: number): string => (semSacas(resumo) ? "—" : fmtSc(v));
  const scTot = (v: number): string => (semSacas(tot) ? "—" : fmtDec2(v));

  const subtitulos: string[] = [];
  const ctx = contexto(meta);
  if (ctx) subtitulos.push(ctx);
  if (meta.filtros && meta.filtros.length) {
    subtitulos.push(
      `Filtros aplicados (só na tabela; o resumo considera a seleção inteira): ${meta.filtros.join(" · ")}`,
    );
  }
  // Dias, quinzenas e quebra dependem da "Data Atual" dos parâmetros.
  const datasRef = Array.from(new Set(rows.map((r) => r.data_atual).filter((d): d is string => !!d)));
  if (datasRef.length === 1) {
    subtitulos.push(`Cálculos na data de referência ${formatDate(datasRef[0])} · cenário de venda a terceiros`);
  }

  const quadros = [
    { rotulo: "Armazenado (inicial)", valor: scResumo(resumo.total_sc_bruto) },
    { rotulo: "Saídas (vendas e baixas)", valor: scResumo(resumo.total_sc_baixado) },
    { rotulo: "Saldo atual", valor: scResumo(resumo.total_sc_saldo) },
    { rotulo: "Quebra técnica (saldo)", valor: scResumo(resumo.total_quebra_sc) },
    { rotulo: "Saldo líquido", valor: scResumo(resumo.total_sc_liquida) },
  ];
  if (meta.programado) {
    quadros.push(
      { rotulo: "Depósito programado", valor: fmtSc(meta.programado.sc) },
      { rotulo: "Andamento do depósito", valor: `${fmtDec2(meta.programado.pct)}%` },
    );
  }

  const colunas: PdfColuna[] = [
    { header: "Data", width: 48 },
    { header: "DFe", width: 44 },
    { header: "NFP", width: 46 },
    { header: "Sc Inicial", width: 52, align: "right" },
    { header: "Sc Baixadas", width: 52, align: "right" },
    { header: "Sc Saldo", width: 52, align: "right", bold: true },
    { header: "Dias", width: 28, align: "right" },
    { header: "Quinz.", width: 30, align: "right" },
    { header: "Quebra (sc)", width: 48, align: "right" },
    { header: "Sc Líq.", width: 52, align: "right" },
    { header: "Tx Armaz.", width: 60, align: "right" },
    { header: "Tx Devol.", width: 60, align: "right" },
    { header: "Total Desc.", width: 66, align: "right" },
    { header: "Valor Venda (sim.)", width: 66, align: "right" },
    { header: "Status", width: 60, wrap: 2, expandir: true },
  ];

  const linhas = rows.map((r) => {
    const s = sacasDoDeposito(r);
    const sc = (v: number): string => (s.disponivel ? fmtDec2(v) : "—");
    return [
      formatDate(r.data_deposito),
      r.dfe_entrada ?? "—",
      r.nfp ?? "—",
      sc(s.inicial),
      s.baixadas > 0 ? sc(s.baixadas) : "—",
      sc(s.saldo),
      String(n(r.dias_percorridos)),
      fmtDec2(n(r.quinzenas)),
      sc(s.quebra),
      sc(s.liquida),
      formatCurrency(n(r.taxa_armazenagem_saldo ?? r.taxa_armazenagem)),
      formatCurrency(n(r.taxa_devolucao_saldo ?? r.taxa_devolucao)),
      formatCurrency(n(r.total_a_descontar_saldo ?? r.total_a_descontar)),
      formatCurrency(n(r.valor_venda_saldo ?? r.valor_venda_simulado)),
      SAFRA_DEP_STATUS_LABEL[r.status] ?? r.status,
    ];
  });

  const linhaTotais = [
    "TOTAIS", "", "",
    scTot(tot.total_sc_bruto),
    tot.total_sc_baixado > 0 ? scTot(tot.total_sc_baixado) : "—",
    scTot(tot.total_sc_saldo),
    "", "",
    scTot(tot.total_quebra_sc),
    scTot(tot.total_sc_liquida),
    formatCurrency(tot.total_taxa_armazenagem),
    formatCurrency(tot.total_taxa_devolucao),
    formatCurrency(tot.total_a_descontar),
    formatCurrency(tot.total_valor_venda),
    "",
  ];

  await exportarPdfTabela(
    {
      titulo: "Culturas & Safra — Detalhe dos Depósitos",
      subtitulos,
      resumo: quadros,
      colunas,
      linhas,
      linhaTotais,
      emitidoPor: meta.emitidoPor,
    },
    nomeArquivoRelatorio("culturas-safra", "pdf"),
  );
}
