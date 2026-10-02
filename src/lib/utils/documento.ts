// Validação e formatação central de CPF / CNPJ (PF / PJ).
// Usado pelos formulários de documentos (recibos/termos) e pelos geradores de PDF.
// A spec exige centralizar essas regras (evitar duplicação de PF/PJ).

export type PessoaTipo = "pf" | "pj";

/** Remove tudo que não for dígito. */
export function soDigitos(valor: string): string {
  return (valor ?? "").replace(/\D/g, "");
}

/** Valida CPF por dígitos verificadores (aceita com ou sem máscara). */
export function isValidCPF(valor: string): boolean {
  const c = soDigitos(valor);
  if (c.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(c)) return false; // todos iguais

  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number(c[i]) * (10 - i);
  let d1 = (soma * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== Number(c[9])) return false;

  soma = 0;
  for (let i = 0; i < 10; i++) soma += Number(c[i]) * (11 - i);
  let d2 = (soma * 10) % 11;
  if (d2 === 10) d2 = 0;
  return d2 === Number(c[10]);
}

/** Valida CNPJ por dígitos verificadores (aceita com ou sem máscara). */
export function isValidCNPJ(valor: string): boolean {
  const c = soDigitos(valor);
  if (c.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(c)) return false;

  const calcDigito = (len: number): number => {
    const pesos = len === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < len; i++) soma += Number(c[i]) * pesos[i];
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  if (calcDigito(12) !== Number(c[12])) return false;
  return calcDigito(13) === Number(c[13]);
}

/** Valida o documento conforme o tipo de pessoa. */
export function validarDocumento(tipo: PessoaTipo, valor: string): boolean {
  return tipo === "pj" ? isValidCNPJ(valor) : isValidCPF(valor);
}

/** Rótulo do campo de documento conforme o tipo. */
export function documentoLabel(tipo: PessoaTipo): "CPF" | "CNPJ" {
  return tipo === "pj" ? "CNPJ" : "CPF";
}

/**
 * Tipo de pessoa pelo próprio número: 11 dígitos → CPF; 14 posições → CNPJ
 * (aceita também o CNPJ alfanumérico da Receita: 12 letras/dígitos + 2 dígitos).
 * null quando o número não fecha com nenhum dos dois.
 */
export function detectarTipoDocumento(valor: string): PessoaTipo | null {
  const c = (valor ?? "").replace(/[^0-9a-z]/gi, "").toUpperCase();
  if (/^\d{11}$/.test(c)) return "pf";
  if (/^[0-9A-Z]{12}\d{2}$/.test(c)) return "pj";
  return null;
}

/** Rótulo para campos que aceitam CNPJ ou CPF: o do número digitado, ou "CNPJ/CPF" se não der para saber. */
export function rotuloDocumento(valor: string): "CPF" | "CNPJ" | "CNPJ/CPF" {
  const tipo = detectarTipoDocumento(valor);
  return tipo ? documentoLabel(tipo) : "CNPJ/CPF";
}

/** Formata CPF: 00000000000 → 000.000.000-00. Se incompleto, devolve original. */
export function formatCPF(valor: string): string {
  const c = soDigitos(valor).slice(0, 11);
  if (c.length !== 11) return valor;
  return `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
}

/** Formata CNPJ: 00000000000000 → 00.000.000/0000-00. Se incompleto, devolve original. */
export function formatCNPJ(valor: string): string {
  const c = soDigitos(valor).slice(0, 14);
  if (c.length !== 14) return valor;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

/** Formata o documento conforme o tipo (mantém entrada se incompleta). */
export function formatDocumento(tipo: PessoaTipo, valor: string): string {
  return tipo === "pj" ? formatCNPJ(valor) : formatCPF(valor);
}

/** Mensagem de erro padronizada para documento inválido. */
export function mensagemDocumentoInvalido(tipo: PessoaTipo): string {
  return tipo === "pj" ? "CNPJ inválido" : "CPF inválido";
}
