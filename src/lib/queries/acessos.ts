// Chamadas da tela Acessos às rotas /api/acessos (toda escrita é no servidor).

import type {
  AcaoAcesso, AcessoPayload, ListaAcessos, ResultadoConvite, UsuarioAcesso,
} from "@/lib/acessos/tipos";

export class ErroAcessos extends Error {
  constructor(message: string, public codigo?: string) {
    super(message);
  }
}

async function chamar<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const corpo = await res.json().catch(() => ({}));
  if (!res.ok) throw new ErroAcessos(corpo.error ?? `Erro ${res.status}`, corpo.codigo);
  return corpo as T;
}

export function listarAcessos(): Promise<ListaAcessos> {
  return chamar<ListaAcessos>("/api/acessos", { cache: "no-store" });
}

export function criarAcesso(p: AcessoPayload): Promise<ResultadoConvite> {
  return chamar<ResultadoConvite>("/api/acessos", { method: "POST", body: JSON.stringify(p) });
}

export function atualizarAcesso(id: string, p: AcessoPayload): Promise<{ usuario: UsuarioAcesso | null }> {
  return chamar(`/api/acessos/${id}`, { method: "PATCH", body: JSON.stringify(p) });
}

export function cancelarConvite(id: string): Promise<{ ok: true }> {
  return chamar(`/api/acessos/${id}`, { method: "DELETE" });
}

export function executarAcao(
  id: string,
  acao: AcaoAcesso,
): Promise<ResultadoConvite & { usuario?: UsuarioAcesso | null; aviso?: string }> {
  return chamar(`/api/acessos/${id}/acoes`, { method: "POST", body: JSON.stringify({ acao }) });
}
