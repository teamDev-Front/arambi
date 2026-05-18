import { PdfBuilder } from "../builder";
import { formatDataCurta, formatDataPorExtenso, formatMoeda, valorPorExtenso } from "../helpers";
import type { DadosContratoPrestacaoServicos } from "../types";

const PCT_EXTENSO: Record<number, string> = {
  5:  "cinco", 10: "dez", 15: "quinze", 20: "vinte",
  25: "vinte e cinco", 30: "trinta", 50: "cinquenta", 100: "cem",
};
function pctPorExtenso(p: number): string {
  return PCT_EXTENSO[p] ?? String(p);
}

export async function gerarContratoPrestacaoServicos(d: DadosContratoPrestacaoServicos): Promise<Uint8Array> {
  const pdf = await PdfBuilder.create();

  pdf.space(20);
  pdf.title("CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE CONSTRUÇÃO CIVIL", { size: 14, spaceAfter: 26 });

  pdf.paragraph(
    "Pelo presente instrumento particular de contrato de prestação de serviços, de um lado:",
    { align: "justify", lineHeight: 1.5 }
  );

  pdf.space(8);

  // ── CONTRATANTE ────────────────────────────────────────────────────────────
  const ieFrag       = d.contratante_inscricao_estadual ? `, Inscrição Estadual nº ${d.contratante_inscricao_estadual}` : "";
  const telFrag      = d.contratante_telefone ? `, telefone ${d.contratante_telefone}` : "";
  const emailFrag    = d.contratante_email    ? `, e-mail: ${d.contratante_email}`     : "";
  pdf.rich([
    { text: "CONTRATANTE", bold: true },
    { text: ", " },
    { text: d.contratante_razao_social, bold: true },
    { text: `, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ${d.contratante_cnpj}${ieFrag}, com sede na ${d.contratante_endereco}${telFrag}${emailFrag}, neste ato representada por seus sócios administradores ${d.contratante_representantes}, doravante denominada simplesmente ` },
    { text: "CONTRATANTE.", bold: true },
  ], { align: "justify", lineHeight: 1.5 });

  pdf.space(10);
  pdf.paragraph("E de outro lado:", { align: "justify" });
  pdf.space(8);

  // ── CONTRATADO ─────────────────────────────────────────────────────────────
  const nac        = d.contratado_nacionalidade ?? "brasileiro";
  const nascFrag   = d.contratado_nascimento    ? `, nascido em ${formatDataCurta(d.contratado_nascimento)}` : "";
  const naturFrag  = d.contratado_naturalidade  ? `, natural de ${d.contratado_naturalidade}` : "";
  const rgFrag     = d.contratado_rg            ? ` e portador do RG nº ${d.contratado_rg}` : "";
  pdf.rich([
    { text: "CONTRATADO", bold: true },
    { text: ": " },
    { text: d.contratado_nome.toUpperCase(), bold: true },
    { text: `, ${nac}${nascFrag}${naturFrag}, inscrito no CPF sob o nº ${d.contratado_cpf}${rgFrag}, residente e domiciliado na ${d.contratado_endereco}, doravante denominado simplesmente ` },
    { text: "CONTRATADO.", bold: true },
  ], { align: "justify", lineHeight: 1.5 });

  // ── CLÁUSULAS ──────────────────────────────────────────────────────────────
  const clausulas: Array<{ titulo: string; corpo: string | (() => void) }> = [
    {
      titulo: "CLÁUSULA PRIMEIRA – OBJETO DO CONTRATO",
      corpo:  d.objeto,
    },
    {
      titulo: "CLÁUSULA SEGUNDA – DO PAGAMENTO",
      corpo:  () => {
        pdf.rich([
          { text: "Pelos serviços ora contratados, o " },
          { text: "CONTRATANTE", bold: true },
          { text: " pagará ao " },
          { text: "CONTRATADO", bold: true },
          { text: ` o valor total de ` },
          { text: `R$ ${formatMoeda(d.valor_total)} (${valorPorExtenso(d.valor_total)})`, bold: true },
          { text: `. ${d.pagamento_texto}` },
        ], { align: "justify", lineHeight: 1.5 });
      },
    },
    {
      titulo: "CLÁUSULA TERCEIRA – PRAZO DE EXECUÇÃO",
      corpo:  d.prazo_texto,
    },
    {
      titulo: "CLÁUSULA QUARTA – OBRIGAÇÕES DO CONTRATADO",
      corpo:  () => {
        pdf.paragraph("I – Executar os serviços com zelo e qualidade, seguindo as normas técnicas aplicáveis;", { align: "justify", lineHeight: 1.4 });
        pdf.paragraph("II – Providenciar as ferramentas e equipamentos necessários à execução;",                { align: "justify", lineHeight: 1.4 });
        pdf.paragraph("III – Reparar, às suas expensas, eventuais defeitos que decorram de má execução.",       { align: "justify", lineHeight: 1.4 });
      },
    },
    {
      titulo: "CLÁUSULA QUINTA – OBRIGAÇÕES DO CONTRATANTE",
      corpo:  () => {
        pdf.paragraph("I – Fornecer acesso ao local da obra;",                                              { align: "justify", lineHeight: 1.4 });
        pdf.paragraph("II – Efetuar o pagamento na forma e prazo estipulados;",                             { align: "justify", lineHeight: 1.4 });
        pdf.paragraph("III – Comunicar imediatamente ao CONTRATADO qualquer irregularidade observada.",     { align: "justify", lineHeight: 1.4 });
      },
    },
    {
      titulo: "CLÁUSULA SEXTA – RESCISÃO E MULTA",
      corpo:  (() => {
        const p = d.multa_percentual ?? 10;
        return `Em caso de descumprimento de quaisquer cláusulas, a parte infratora pagará à parte inocente multa compensatória de ${p}% (${pctPorExtenso(p)} por cento) sobre o valor total do contrato, nos termos do art. 408 e seguintes do Código Civil.`;
      })(),
    },
    {
      titulo: "CLÁUSULA SÉTIMA – QUITAÇÃO E ENCERRAMENTO CONTRATUAL",
      corpo:  "Com a conclusão integral dos serviços contratados e a quitação total dos valores estabelecidos neste instrumento, dar-se-ão por plenamente cumpridas todas as obrigações entre as partes, ficando o presente contrato automaticamente encerrado, nada mais tendo uma parte a reclamar da outra, a qualquer título.",
    },
    {
      titulo: "CLÁUSULA OITAVA – FORO",
      corpo:  `Para dirimir quaisquer controvérsias oriundas do presente contrato, as partes elegem o foro da comarca de ${d.foro_comarca}, com renúncia de qualquer outro por mais privilegiado que seja.`,
    },
  ];

  for (const c of clausulas) {
    pdf.space(14);
    pdf.rich([{ text: c.titulo, bold: true }], { lineHeight: 1.3 });
    pdf.space(6);
    if (typeof c.corpo === "string") {
      pdf.paragraph(c.corpo, { align: "justify", lineHeight: 1.5 });
    } else {
      c.corpo();
    }
  }

  // ── FECHAMENTO ─────────────────────────────────────────────────────────────
  pdf.space(14);
  pdf.paragraph(
    "E, por estarem assim justas e contratadas, firmam o presente contrato em 2 (duas) vias de igual teor e forma, juntamente com duas testemunhas.",
    { align: "justify", lineHeight: 1.5 }
  );

  pdf.space(16);
  pdf.paragraph(`${d.cidade}, ${formatDataPorExtenso(d.data_emissao)}`, { align: "left" });

  // ── ASSINATURAS ────────────────────────────────────────────────────────────
  pdf.space(56);
  pdf.hr({ width: 380, align: "center" });
  pdf.paragraph(`${d.contratante_razao_social.toUpperCase()} - CONTRATANTE`, { align: "center", size: 11 });
  pdf.space(40);
  pdf.hr({ width: 380, align: "center" });
  pdf.paragraph(`${d.contratado_nome.toUpperCase()} – CONTRATADO`, { align: "center", size: 11 });

  return pdf.save();
}
