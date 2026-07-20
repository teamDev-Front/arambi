// PDF "Programação da Semana" — bônus do pacote jul/2026.
// Gerado 100% no CLIENT (mesmo padrão do export do Financeiro): agrega a
// Central de Alertas (vacinações, manutenções, documentação) num PDF simples
// com o timbre, para a Lola imprimir e entregar aos funcionários se quiser.

import { PdfBuilder } from "@/lib/pdf/builder";
import { listarAlertas, type AlertaItem } from "@/lib/queries/agro";
import { formatDate } from "@/lib/utils/format";
import { rgb } from "pdf-lib";

const VERDE = rgb(0.14, 0.30, 0.19);   // #244d30 aprox — identidade AramBI
const CINZA = rgb(0.35, 0.33, 0.31);

function baixar(bytes: Uint8Array, filename: string): void {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const blob = new Blob([ab], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Busca o timbre de public/ via fetch (client-side; fallback sem timbre). */
async function carregarTimbre(): Promise<Uint8Array | null> {
  try {
    const res = await fetch("/logomarga-timbre-aramburu-agropecuaria.jpg");
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function secao(b: PdfBuilder, titulo: string, itens: AlertaItem[], vazio: string): void {
  b.space(10);
  b.paragraph(titulo, { size: 12, font: "bold", color: VERDE });
  b.hr({ width: 467, align: "left", thickness: 0.8 });
  b.space(4);
  if (itens.length === 0) {
    b.paragraph(vazio, { size: 10, color: CINZA });
    return;
  }
  for (const item of itens) {
    const data = item.data ? formatDate(item.data) : "—";
    b.rich(
      [
        { text: `[ ${data} ]  `, bold: true },
        { text: item.titulo },
        { text: `  —  ${item.detalhe}` },
      ],
      { size: 10.5, lineHeight: 1.45 },
    );
  }
}

/** Gera e baixa o PDF da programação (alertas dos próximos dias). */
export async function gerarProgramacaoPdf(): Promise<void> {
  const [alertas, timbre] = await Promise.all([listarAlertas(), carregarTimbre()]);

  const hoje = new Date();
  const dataFmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(hoje);

  const b = await PdfBuilder.create({ watermarkJpg: timbre });

  b.title("PROGRAMAÇÃO DE ATIVIDADES", { size: 15, spaceAfter: 2 });
  b.paragraph("Agropecuária Aramburu — AramBI Gestão Agro", { size: 10, align: "center", color: CINZA });
  b.paragraph(`Emitida em ${dataFmt}`, { size: 9, align: "center", color: CINZA });
  b.space(8);

  const vacinacoes = alertas.filter((a) => a.tipo === "vacinacao");
  const manutencoes = alertas.filter((a) => a.tipo === "manutencao");
  const documentos = alertas.filter((a) => a.tipo === "documento");
  const saude = alertas.filter((a) => a.tipo === "ocorrencia");

  secao(b, "VACINAÇÕES E VERMIFUGAÇÕES", vacinacoes, "Nenhuma vacinação nos próximos 15 dias.");
  secao(b, "MANUTENÇÕES DE MAQUINÁRIO E VEÍCULOS", manutencoes, "Nenhuma manutenção prevista nos próximos 15 dias.");
  secao(b, "DOCUMENTAÇÃO A VENCER", documentos, "Nenhum documento vencendo nos próximos 30 dias.");
  if (saude.length > 0) {
    secao(b, "ATENÇÃO — SAÚDE DOS ANIMAIS", saude, "");
  }

  b.space(18);
  b.paragraph(
    "Documento gerado automaticamente pelo AramBI a partir dos calendários de vacinação, manutenção e documentação.",
    { size: 8.5, color: CINZA, align: "center" },
  );

  const bytes = await b.save();
  const stamp = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  baixar(bytes, `programacao-arambi-${stamp}.pdf`);
}
