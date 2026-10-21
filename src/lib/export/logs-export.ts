// Exportação XLSX dos Logs do Sistema (filtro aplicado na tela).

import { buildXlsx, xtext } from "@/lib/export/xlsx";
import { formatDateTime } from "@/lib/utils/format";
import type { LogLinha } from "@/lib/queries/logs";

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

export function exportLogsXlsx(rows: LogLinha[], rotuloTipo: (t: LogLinha["tipo"]) => string, rodape: string): void {
  const bytes = buildXlsx({
    sheetName: "Logs",
    titleRows: ["AramBI — Logs do Sistema", rodape],
    columns: [
      { header: "Data/Hora", width: 18 },
      { header: "Tipo", width: 12 },
      { header: "Ação", width: 26 },
      { header: "Descrição", width: 70 },
      { header: "Usuário", width: 26 },
      { header: "IP", width: 16 },
    ],
    rows: rows.map((l) => [
      xtext(formatDateTime(l.created_at)),
      xtext(rotuloTipo(l.tipo)),
      xtext(l.acao),
      xtext(l.descricao ?? ""),
      xtext(l.usuario_nome ?? "Sistema"),
      xtext(l.ip ?? ""),
    ]),
  });
  const ymd = new Date().toISOString().slice(0, 10);
  baixar(bytes, `arambi-logs-${ymd}.xlsx`);
}
