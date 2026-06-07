import { PdfBuilder } from "../builder";
import { formatDataCurta, formatDataPorExtenso, formatMoeda, fraseInscricao, rotuloDocumento, valorPorExtenso } from "../helpers";
import type { DadosReciboPagamentoPrestador } from "../types";

const MESES_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export async function gerarReciboPagamentoPrestador(d: DadosReciboPagamentoPrestador): Promise<Uint8Array> {
  const pdf = await PdfBuilder.create();

  pdf.space(40);
  pdf.title("RECIBO", { size: 14, spaceAfter: 8 });
  pdf.title(`R$ ${formatMoeda(d.valor)}`, { size: 13, spaceAfter: 20 });

  pdf.rich([
    { text: "Eu, " },
    { text: d.prestador.nome, bold: true },
    { text: `, ${fraseInscricao(d.prestador.tipo, d.prestador.documento)}, declaro para os devidos fins que recebi de ` },
    { text: d.pagador.nome, bold: true },
    { text: `, ${fraseInscricao(d.pagador.tipo, d.pagador.documento)}, a quantia de ` },
    { text: `R$ ${formatMoeda(d.valor)} (${valorPorExtenso(d.valor)})`, bold: true },
    { text: `, referente ao pagamento do serviço prestado de ${d.descricao_servico}${d.propriedade ? ` na propriedade ${d.propriedade}` : ""}.` },
  ], { align: "justify", lineHeight: 1.5 });

  pdf.space(16);
  pdf.rich([{ text: "Dados do Pagamento", bold: true }], { lineHeight: 1.3 });
  pdf.space(6);

  // Data: se vazia, mantém placeholder igual ao template original
  const dataPagamentoStr = d.data_pagamento
    ? formatDataCurta(d.data_pagamento)
    : "_____/_____/" + new Date().getFullYear();
  pdf.fields([
    { label: "Data do Pagamento", value: dataPagamentoStr },
    { label: "Forma de Pagamento", value: d.forma_pagamento },
  ]);

  pdf.space(18);
  if (d.data_emissao) {
    pdf.paragraph(`${d.cidade}, ${formatDataPorExtenso(d.data_emissao)}`);
  } else {
    const anoAtual = new Date().getFullYear();
    pdf.paragraph(`${d.cidade}, ______ de _______________ de ${anoAtual}`);
  }

  pdf.space(60);
  pdf.hr({ width: 320, align: "center" });
  pdf.paragraph(d.prestador.nome, { align: "center", size: 11 });
  pdf.paragraph(`${rotuloDocumento(d.prestador.tipo)} nº ${d.prestador.documento}`, { align: "center", size: 11 });

  void MESES_PT;

  return pdf.save();
}
