export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

/**
 * Detecta strings de data "pura" (YYYY-MM-DD, opcionalmente com hora 00:00:00)
 * vindas do Postgres (coluna `date`). Esses valores NÃO têm timezone — tratá-los
 * com `new Date("2026-06-24")` os interpreta como UTC-meia-noite e, ao exibir em
 * horário local (Brasil = UTC-3), recuam um dia (mostra 23/06). Por isso fazemos
 * o parse como data LOCAL, sem conversão de fuso.
 */
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s]00:00(?::00)?(?:\.000)?Z?)?$/;

/**
 * Converte uma string/Date em um Date no fuso LOCAL, sem o "recuo de um dia"
 * típico de datas-puras do banco. Datas com hora real (timestamps) passam direto.
 */
export function parseLocalDate(date: string | Date): Date {
  if (date instanceof Date) return date;
  const m = DATE_ONLY_RE.exec(date.trim());
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  return new Date(date);
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat("pt-BR").format(parseLocalDate(date));
}

export function formatDateTime(date: string | Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(date));
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getMonthName(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(
    new Date(Number(year), Number(month) - 1)
  );
}
