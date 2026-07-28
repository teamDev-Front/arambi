// Exportação XLSX do Estoque & Safra — "Detalhe dos Depósitos" (ajuste 27-jul).
//
// Espelha as colunas da tabela da tela (valores de SALDO, cenário de venda a
// terceiros) + linha de TOTAIS, com o contexto Armazém × Cultura × Safra no
// cabeçalho. Roda 100% no client a partir das linhas já carregadas.

"use client";

import { formatDate } from "@/lib/utils/format";
import { SAFRA_DEP_STATUS_LABEL, type SafraDepositoCalculadoRow } from "@/types";
import { buildXlsx, xtext, xmoney, xnum, type XlsxValue } from "./xlsx";

export interface EstoqueExportMeta {
  armazem?: string;
  cultura?: string;
  safra?: string;
  /** Filtros extras humanizados (busca, status…). */
  filtros?: string[];
}

function baixar(bytes: Uint8Array, filename: string): void {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const blob = new Blob([ab], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function exportEstoqueXlsx(
  rows: SafraDepositoCalculadoRow[],
  meta: EstoqueExportMeta = {},
): void {
  const n = (v: number | null | undefined): number => Number(v ?? 0);

  const contexto = [meta.armazem, meta.cultura, meta.safra].filter(Boolean).join(" · ");
  const titleRows: string[] = ["AramBI — Estoque & Safra — Detalhe dos Depósitos"];
  if (contexto) titleRows.push(contexto);
  if (meta.filtros && meta.filtros.length) titleRows.push(`Filtros: ${meta.filtros.join(" · ")}`);
  titleRows.push(`Gerado em ${formatDate(new Date())} · ${rows.length} depósito${rows.length === 1 ? "" : "s"}`);

  const tot = {
    kgBruto: 0, kgBaixado: 0, kgSaldo: 0, quebra: 0, kgLiq: 0, scLiq: 0,
    txArmaz: 0, txDevol: 0, desc: 0, venda: 0,
  };

  const dataRows: XlsxValue[][] = rows.map((r) => {
    const kgSaldo = n(r.kg_saldo ?? r.kg_bruto);
    const quebra = n(r.quebra_kg_saldo ?? r.quebra_kg);
    const kgLiq = n(r.kg_liquido_saldo ?? r.kg_liquido);
    const scLiq = n(r.sc_liquida_saldo ?? r.sc_liquida);
    const txArmaz = n(r.taxa_armazenagem_saldo ?? r.taxa_armazenagem);
    const txDevol = n(r.taxa_devolucao_saldo ?? r.taxa_devolucao);
    const desc = n(r.total_a_descontar_saldo ?? r.total_a_descontar);
    const venda = n(r.valor_venda_saldo ?? r.valor_venda_simulado);

    tot.kgBruto += n(r.kg_bruto);
    tot.kgBaixado += n(r.kg_baixado);
    tot.kgSaldo += kgSaldo;
    tot.quebra += quebra;
    tot.kgLiq += kgLiq;
    tot.scLiq += scLiq;
    tot.txArmaz += txArmaz;
    tot.txDevol += txDevol;
    tot.desc += desc;
    tot.venda += venda;

    return [
      xtext(formatDate(r.data_deposito)),
      xtext(r.dfe_entrada ?? ""),
      xtext(r.nfp ?? ""),
      xnum(n(r.kg_bruto)),
      xnum(n(r.kg_baixado)),
      xnum(kgSaldo),
      xnum(n(r.dias_percorridos)),
      xnum(n(r.quinzenas)),
      xnum(Math.round(quebra)),
      xnum(Math.round(kgLiq)),
      xnum(Math.round(scLiq * 100) / 100),
      xmoney(txArmaz),
      xmoney(txDevol),
      xmoney(desc),
      xmoney(venda),
      xtext(SAFRA_DEP_STATUS_LABEL[r.status] ?? r.status),
      xtext(r.observacao ?? ""),
    ];
  });

  dataRows.push([
    xtext("TOTAIS", { bold: true }),
    xtext(""), xtext(""),
    xnum(tot.kgBruto, { bold: true }),
    xnum(tot.kgBaixado, { bold: true }),
    xnum(tot.kgSaldo, { bold: true }),
    xtext(""), xtext(""),
    xnum(Math.round(tot.quebra), { bold: true }),
    xnum(Math.round(tot.kgLiq), { bold: true }),
    xnum(Math.round(tot.scLiq * 100) / 100, { bold: true }),
    xmoney(tot.txArmaz, { bold: true }),
    xmoney(tot.txDevol, { bold: true }),
    xmoney(tot.desc, { bold: true }),
    xmoney(tot.venda, { bold: true }),
    xtext(""), xtext(""),
  ]);

  const bytes = buildXlsx({
    sheetName: "Depósitos",
    titleRows,
    columns: [
      { header: "Data", width: 12 },
      { header: "DFe", width: 10 },
      { header: "NFP", width: 12 },
      { header: "kg Bruto", width: 12 },
      { header: "kg Baixado", width: 12 },
      { header: "kg Saldo", width: 12 },
      { header: "Dias", width: 7 },
      { header: "Quinzenas", width: 10 },
      { header: "Quebra (kg)", width: 12 },
      { header: "kg Líquido", width: 12 },
      { header: "Sacas Líq.", width: 11 },
      { header: "Tx Armazenagem", width: 16 },
      { header: "Tx Devolução", width: 14 },
      { header: "Total a Descontar", width: 17 },
      { header: "Valor Venda (sim.)", width: 17 },
      { header: "Status", width: 16 },
      { header: "Observação", width: 30 },
    ],
    rows: dataRows,
  });

  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  baixar(bytes, `arambi-estoque-safra-${ymd}.xlsx`);
}
