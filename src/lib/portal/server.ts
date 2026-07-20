// Utilitários SERVER-SIDE do Portal do Colaborador.
// Usado apenas pelos route handlers /api/colaborador/* (service-role).
// NÃO importar em client components.

import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ColaboradorRow } from "@/types";

// ----------------------------------------------------------------------------
// CPF
// ----------------------------------------------------------------------------
export function normalizarCpf(cpf: string): string {
  return String(cpf ?? "").replace(/\D/g, "");
}

/** Valida CPF com dígitos verificadores (rejeita sequências repetidas). */
export function cpfValido(cpf: string): boolean {
  const c = normalizarCpf(cpf);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (base: string, fator: number) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (fator - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return dv(c.slice(0, 9), 10) === Number(c[9]) && dv(c.slice(0, 10), 11) === Number(c[10]);
}

// ----------------------------------------------------------------------------
// Rate limit simples por IP (in-memory — suficiente para o volume da fazenda).
// ----------------------------------------------------------------------------
const hits = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_HITS = 30;

export function rateLimitOk(req: NextRequest): boolean {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local";
  const now = Date.now();
  const cur = hits.get(ip);
  if (!cur || now > cur.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  cur.count++;
  if (hits.size > 1000) {
    // higiene: descarta janelas vencidas
    for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
  }
  return cur.count <= MAX_HITS;
}

// ----------------------------------------------------------------------------
// Colaborador
// ----------------------------------------------------------------------------
export type ResultadoColaborador =
  | { ok: true; colaborador: ColaboradorRow }
  | { ok: false; status: number; error: string; pendente?: boolean };

/** Busca colaborador ATIVO pelo CPF. Erros já vêm com status HTTP adequado. */
export async function buscarColaboradorAtivo(cpfBruto: string): Promise<ResultadoColaborador> {
  const cpf = normalizarCpf(cpfBruto);
  if (!cpfValido(cpf)) return { ok: false, status: 400, error: "CPF inválido." };

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("colaboradores")
    .select("*")
    .eq("cpf", cpf)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: "Erro ao consultar cadastro." };
  if (!data) return { ok: false, status: 404, error: "CPF não cadastrado. Solicite acesso à administração." };

  const colab = data as ColaboradorRow;
  if (colab.status === "pendente") {
    return { ok: false, status: 403, error: "Cadastro aguardando aprovação da administração.", pendente: true };
  }
  if (colab.status === "desativado") {
    return { ok: false, status: 403, error: "Acesso desativado. Fale com a administração." };
  }
  return { ok: true, colaborador: colab };
}
