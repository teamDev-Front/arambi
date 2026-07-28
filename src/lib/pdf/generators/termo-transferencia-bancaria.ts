import { PdfBuilder } from "../builder";
import { loadTimbreLogo } from "../assets";
import { formatDataCurta, formatMoeda, valorPorExtenso } from "../helpers";
import type { DadosTermoTransferencia } from "../types";

export async function gerarTermoTransferenciaBancaria(d: DadosTermoTransferencia): Promise<Uint8Array> {
  // RF-07 — timbre (marca d'água) da Aramburu em todas as páginas.
  const watermarkJpg = await loadTimbreLogo();
  const pdf = await PdfBuilder.create({ watermarkJpg });

  pdf.space(30);
  pdf.title("TERMO DE TRANSFERÊNCIA BANCÁRIA", { size: 14, spaceAfter: 28 });

  const valorStr = `R$ ${formatMoeda(d.valor)} (${valorPorExtenso(d.valor)})`;
  const nfFrag = d.numero_nota ? `, ref. a NF nº ${d.numero_nota}` : "";

  pdf.rich([
    { text: "A " },
    { text: d.remetente_razao_social, bold: true },
    { text: `, inscrita no CNPJ sob o nº ${d.remetente_documento}, realiza o pagamento no valor de ` },
    { text: valorStr, bold: true },
    { text: ` para a ` },
    { text: d.destinatario_razao_social, bold: true },
    { text: `, inscrito no CNPJ sob o nº ${d.destinatario_documento}, através de transferência bancária, no dia ` },
    // Data em NEGRITO (RF 24-jul) — destaque pedido pela Adri.
    { text: formatDataCurta(d.data_transferencia), bold: true },
    { text: `. Este valor corresponde a ${d.descricao_objeto}${nfFrag}.` },
  ], { align: "justify", lineHeight: 1.5 });

  pdf.space(24);
  pdf.rich([{ text: "REMETENTE", bold: true }], { lineHeight: 1.3 });
  pdf.space(4);
  pdf.fields([
    { label: "Razão Social", value: d.remetente_razao_social },
    { label: "CNPJ",         value: d.remetente_documento },
    { label: "Banco",        value: d.remetente_bancarios.banco },
    { label: "Agência",      value: d.remetente_bancarios.agencia },
    { label: "Conta",        value: d.remetente_bancarios.conta },
  ]);

  pdf.space(18);
  pdf.rich([{ text: "DESTINATÁRIO", bold: true }], { lineHeight: 1.3 });
  pdf.space(4);
  // Agência/Conta só aparecem quando preenchidas — pagamento via Pix pode não
  // ter esses dados (ajuste 28-jul: basta a Chave Pix no destinatário).
  pdf.fields([
    { label: "Razão Social", value: d.destinatario_razao_social },
    { label: "CNPJ/CPF",     value: d.destinatario_documento },
    { label: "Banco",        value: d.destinatario_bancarios.banco },
    ...(d.destinatario_bancarios.agencia.trim()
      ? [{ label: "Agência", value: d.destinatario_bancarios.agencia }]
      : []),
    ...(d.destinatario_bancarios.conta.trim()
      ? [{ label: "Conta", value: d.destinatario_bancarios.conta }]
      : []),
    ...(d.destinatario_bancarios.chave_pix
      ? [{ label: "Chave Pix", value: d.destinatario_bancarios.chave_pix }]
      : []),
  ]);

  return pdf.save();
}
