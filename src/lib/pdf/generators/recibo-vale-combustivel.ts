import { PdfBuilder } from "../builder";
import { formatCompetencia, formatDataPorExtenso, formatMoeda, fraseInscricao, valorPorExtenso } from "../helpers";
import type { DadosReciboValeCombustivel } from "../types";

export async function gerarReciboValeCombustivel(d: DadosReciboValeCombustivel): Promise<Uint8Array> {
  const pdf = await PdfBuilder.create();

  pdf.space(40);
  pdf.title("RECIBO – AUXÍLIO COMBUSTÍVEL", { size: 14, spaceAfter: 28 });

  pdf.rich([{ text: `Valor de R$ ${formatMoeda(d.valor)}`, bold: true }], {
    size: 12, align: "left", lineHeight: 1.3,
  });
  pdf.space(14);

  pdf.rich([
    { text: "Eu, " },
    { text: d.beneficiario.nome, bold: true },
    { text: `, ${fraseInscricao(d.beneficiario.tipo, d.beneficiario.documento)}, recebi de ` },
    { text: d.pagador.nome, bold: true },
    { text: `, devidamente ${fraseInscricao(d.pagador.tipo, d.pagador.documento)} a importância de ` },
    { text: `R$ ${formatMoeda(d.valor)} (${valorPorExtenso(d.valor)})`, bold: true },
    { text: `, referente ao auxílio combustível da competência ` },
    { text: formatCompetencia(d.competencia), bold: true },
    { text: ` – período de ${d.periodo}.` },
  ], { align: "justify", lineHeight: 1.5 });

  pdf.space(10);
  pdf.paragraph(
    "Declaro ainda que o valor recebido possui caráter indenizatório, destinado exclusivamente " +
    "ao custeio parcial de despesas com deslocamento, não possuindo natureza salarial ou " +
    "incorporando-se à remuneração para quaisquer efeitos trabalhistas ou previdenciários.",
    { align: "justify", lineHeight: 1.5 }
  );

  pdf.space(14);
  pdf.paragraph(`${d.cidade}, ${formatDataPorExtenso(d.data_emissao)}.`, { align: "left" });

  pdf.space(70);
  pdf.hr({ width: 280, align: "center" });
  pdf.paragraph(d.beneficiario.nome, { align: "center", size: 11 });

  return pdf.save();
}
