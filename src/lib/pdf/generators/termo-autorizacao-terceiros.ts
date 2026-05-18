import { PdfBuilder } from "../builder";
import { formatDataPorExtenso, formatMoeda, valorPorExtenso } from "../helpers";
import type { DadosTermoAutorizacaoTerceiros } from "../types";

export async function gerarTermoAutorizacaoTerceiros(d: DadosTermoAutorizacaoTerceiros): Promise<Uint8Array> {
  const pdf = await PdfBuilder.create();

  pdf.space(20);
  pdf.title("TERMO DE AUTORIZAÇÃO DE PAGAMENTO A TERCEIRO", { size: 13, spaceAfter: 22 });

  // ── AUTORIZANTE ────────────────────────────────────────────────────────────
  const docLabelAutorizante = d.autorizante_tipo === "pj" ? "CNPJ" : "CPF";
  const naturezaAutorizante = d.autorizante_tipo === "pj"
    ? "pessoa jurídica"
    : "pessoa física";
  pdf.rich([
    { text: "AUTORIZANTE: ", bold: true },
    { text: `A empresa ` },
    { text: d.autorizante_razao_social, bold: true },
    { text: `, ${naturezaAutorizante}, inscrita no ${docLabelAutorizante} sob nº ${d.autorizante_documento}, com sede em ${d.autorizante_endereco}, neste ato representada por seu representante legal, conforme seus atos constitutivos.` },
  ], { align: "justify", lineHeight: 1.5 });

  pdf.space(10);

  // ── AUTORIZADA ─────────────────────────────────────────────────────────────
  pdf.rich([
    { text: "AUTORIZADA: ", bold: true },
    { text: `A empresa ` },
    { text: d.autorizada_razao_social, bold: true },
    { text: `, pessoa jurídica inscrita no CNPJ sob nº ${d.autorizada_documento}, sito a ${d.autorizada_endereco}.` },
  ], { align: "justify", lineHeight: 1.5 });

  pdf.space(14);

  // ── PARÁGRAFO PRINCIPAL ────────────────────────────────────────────────────
  const valorPgtoStr = `R$ ${formatMoeda(d.valor_pagamento)} (${valorPorExtenso(d.valor_pagamento)})`;
  const valorTotalStr = `R$ ${formatMoeda(d.valor_total_nota)} (${valorPorExtenso(d.valor_total_nota)})`;
  const tituloFrag = d.titulo_pagamento ? `, a título de ${d.titulo_pagamento}` : "";
  const saldoFrag = (d.saldo_remanescente !== undefined && d.saldo_remanescente > 0)
    ? ` O saldo remanescente de R$ ${formatMoeda(d.saldo_remanescente)} (${valorPorExtenso(d.saldo_remanescente)}) será pago posteriormente, na mesma conta bancária informada neste termo, em favor de:`
    : " O valor será pago na conta bancária informada neste termo, em favor de:";

  pdf.rich([
    { text: `Por meio do presente instrumento, a ` },
    { text: "AUTORIZANTE", bold: true },
    { text: ` declara e autoriza expressamente que a ` },
    { text: "AUTORIZADA", bold: true },
    { text: ` realize o pagamento referente à Nota Fiscal nº ${d.numero_nota}, no valor de ` },
    { text: valorPgtoStr, bold: true },
    { text: `${tituloFrag}, sendo que o valor total da Nota Fiscal é de ${valorTotalStr}.${saldoFrag}` },
  ], { align: "justify", lineHeight: 1.5 });

  pdf.space(12);

  // ── DADOS DO BENEFICIÁRIO ──────────────────────────────────────────────────
  pdf.fields([
    { label: "Nome",       value: d.beneficiario_nome },
    { label: "CPF",        value: d.beneficiario_cpf },
    { label: "Banco",      value: d.beneficiario_dados_bancarios.banco },
    { label: "Agência",    value: d.beneficiario_dados_bancarios.agencia },
    { label: "Conta",      value: d.beneficiario_dados_bancarios.conta },
    ...(d.beneficiario_dados_bancarios.chave_pix
      ? [{ label: "Chave Pix", value: d.beneficiario_dados_bancarios.chave_pix }]
      : []),
  ]);

  // ── PARENTESCO ─────────────────────────────────────────────────────────────
  if (d.parentesco) {
    pdf.space(10);
    pdf.paragraph(
      `Declara, ainda, que a pessoa acima indicada é ${d.parentesco} do representante da AUTORIZANTE, estando expressamente autorizada a receber o referido valor em seu nome.`,
      { align: "justify", lineHeight: 1.5 }
    );
  }

  pdf.space(10);
  pdf.paragraph(
    "A AUTORIZANTE reconhece e concorda que, após a realização do pagamento conforme autorizado " +
    "neste documento, a obrigação financeira referente à Nota Fiscal mencionada será considerada " +
    "plenamente quitada, não restando qualquer valor pendente junto à AUTORIZADA.",
    { align: "justify", lineHeight: 1.5 }
  );

  pdf.space(8);
  pdf.paragraph(
    "Por ser a expressão da verdade, firma o presente termo para os devidos fins.",
    { align: "justify", lineHeight: 1.5 }
  );

  pdf.space(14);
  pdf.rich([
    { text: "Local e data: ", bold: true },
    { text: `${d.cidade}, ${formatDataPorExtenso(d.data_emissao)}` },
  ]);

  // ── ASSINATURA ─────────────────────────────────────────────────────────────
  pdf.space(56);
  pdf.hr({ width: 320, align: "center" });
  pdf.paragraph(d.signatario_nome.toUpperCase(), { align: "center", size: 11 });
  pdf.paragraph(`${d.signatario_documento_label ?? docLabelAutorizante}: ${d.autorizante_documento}`, { align: "center", size: 11 });

  return pdf.save();
}
