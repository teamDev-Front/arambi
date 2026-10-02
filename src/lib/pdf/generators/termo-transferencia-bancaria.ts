import { PdfBuilder } from "../builder";
import { loadTimbreLogo } from "../assets";
import { formatDataCurta, formatMoeda, valorPorExtenso } from "../helpers";
import { parseObservacoes } from "../obs-rich";
import type { DadosTermoTransferencia } from "../types";
import { rotuloDocumento } from "@/lib/utils/documento";

export async function gerarTermoTransferenciaBancaria(d: DadosTermoTransferencia): Promise<Uint8Array> {
  // RF-07 — timbre (marca d'água) da Aramburu em todas as páginas.
  const watermarkJpg = await loadTimbreLogo();
  const pdf = await PdfBuilder.create({ watermarkJpg });

  pdf.space(30);
  // Título editável pelo template do fornecedor (ex.: "HISTÓRICO DE PAGAMENTO").
  pdf.title(d.titulo_documento?.trim() || "TERMO DE TRANSFERÊNCIA BANCÁRIA", { size: 14, spaceAfter: 28 });

  const valorStr = `R$ ${formatMoeda(d.valor)} (${valorPorExtenso(d.valor)})`;
  const nfFrag = d.numero_nota ? `, ref. a NF nº ${d.numero_nota}` : "";
  // "Este valor corresponde a {descricao}" — se a descrição já começa com
  // a/à/ao/aos/às, o "a" do quadro sai para não duplicar ("corresponde a à…").
  const descricao = d.descricao_objeto.trim();
  const corresponde = /^(a|à|ao|aos|às)\s/i.test(descricao)
    ? `. Este valor corresponde ${descricao}${nfFrag}.`
    : `. Este valor corresponde a ${descricao}${nfFrag}.`;
  // Nome por extenso do favorecido no parágrafo (pode diferir da razão social
  // do bloco DESTINATÁRIO — padrão dos termos dos fornecedores). O CNPJ/CPF
  // também pode diferir (ajuste 02-out): NF emitida pela empresa A e paga na
  // conta da empresa B — o parágrafo cita a A; o bloco DESTINATÁRIO, a B.
  const favorecido = d.destinatario_nome_paragrafo?.trim() || d.destinatario_razao_social;
  const docFavorecido = d.destinatario_documento_paragrafo?.trim() || d.destinatario_documento;

  pdf.rich([
    { text: "A " },
    { text: d.remetente_razao_social, bold: true },
    { text: `, inscrita no CNPJ sob o nº ${d.remetente_documento}, realiza o pagamento no valor de ` },
    { text: valorStr, bold: true },
    { text: ` para a ` },
    { text: favorecido, bold: true },
    { text: `, inscrito no ${rotuloDocumento(docFavorecido)} sob o nº ${docFavorecido}, através de transferência bancária, no dia ` },
    // Data em NEGRITO (RF 24-jul) — destaque pedido pela Adri.
    { text: formatDataCurta(d.data_transferencia), bold: true },
    { text: corresponde },
  ], { align: "justify", lineHeight: 1.5 });

  // Bloco de observações (ajuste 29-jul) — parcelamentos, retenções etc.,
  // com **negrito**, bullets e listas numeradas, como nos termos originais.
  if (d.observacoes?.trim()) {
    pdf.space(16);
    for (const linha of parseObservacoes(d.observacoes)) {
      if (linha.segments.length === 0) { pdf.space(7); continue; }
      const segs = linha.prefixo
        ? [{ text: linha.prefixo }, ...linha.segments]
        : linha.segments;
      pdf.rich(segs, { lineHeight: 1.35, indentLeft: linha.prefixo ? 16 : 0 });
    }
  }

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
