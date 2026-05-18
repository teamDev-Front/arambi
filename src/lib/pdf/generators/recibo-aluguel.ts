import { PdfBuilder } from "../builder";
import { formatCompetencia, formatDataCurta, formatDataPorExtenso, formatMoeda, valorPorExtenso } from "../helpers";
import type { DadosReciboAluguel } from "../types";

export async function gerarReciboAluguel(d: DadosReciboAluguel): Promise<Uint8Array> {
  const pdf = await PdfBuilder.create();

  pdf.space(40);
  pdf.title("RECIBO DE PAGAMENTO DE ALUGUEL", { size: 14, spaceAfter: 8 });
  pdf.paragraph(`Nº: ${d.numero}`, { align: "center", size: 11 });
  pdf.space(24);

  pdf.rich([
    { text: "Eu, " },
    { text: d.proprietario_nome, bold: true },
    { text: `, na qualidade de proprietário do imóvel ` },
    { text: d.imovel_nome, bold: true },
    { text: `, situado na ${d.imovel_endereco}, declaro para os devidos fins que recebi da ` },
    { text: d.locatario_nome, bold: true },
    { text: `, inscrita no CNPJ nº ${d.locatario_cnpj}, a quantia de ` },
    { text: `R$ ${formatMoeda(d.valor)} (${valorPorExtenso(d.valor)})`, bold: true },
    { text: `, referente ao pagamento do aluguel do mês de ${formatCompetencia(d.competencia).toLowerCase()}, conforme contrato de locação celebrado entre as partes.` },
  ], { align: "justify", lineHeight: 1.5 });

  pdf.space(14);
  pdf.rich([{ text: "Dados do Pagamento:", bold: true }], { lineHeight: 1.3 });
  pdf.space(6);
  pdf.fields([
    { label: "Valor Mensal", value: `R$ ${formatMoeda(d.valor)}` },
    { label: "Data do Pagamento", value: formatDataCurta(d.data_pagamento) },
    { label: "Forma de Pagamento", value: d.forma_pagamento },
    ...(d.tipo_servico ? [{ label: "Tipo do Serviço", value: d.tipo_servico }] : []),
  ]);

  pdf.space(20);
  pdf.paragraph(`${d.cidade}, ${formatDataPorExtenso(d.data_emissao)}`, { align: "left" });

  pdf.space(60);
  pdf.hr({ width: 320, align: "center" });
  pdf.paragraph(d.emissor_razao_social, { align: "center", size: 11 });
  pdf.paragraph(`CNPJ nº ${d.emissor_cnpj}`, { align: "center", size: 11 });
  pdf.paragraph(d.emissor_signatario, { align: "center", size: 11 });

  return pdf.save();
}
