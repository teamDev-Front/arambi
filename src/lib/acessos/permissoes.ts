// Regras de permissão — funções puras, usadas no proxy, no servidor e no
// navegador. Espelham as funções SQL da migration 0058:
//   podeVer    ↔ fn_pode_ver_modulo
//   podeEditar ↔ fn_pode_editar_modulo

import type { UserRole } from "@/types";
import {
  MODULOS, MODULO_POR_KEY, classificarRota, ehModuloConcedivel,
  type ModuloConcedivel, type ModuloKey,
} from "@/lib/acessos/modulos";

export type NivelModulo = "leitura" | "edicao";
export type MapaPermissoes = Partial<Record<ModuloConcedivel, NivelModulo>>;

/** Nível exibido na tela (derivado do papel + mapa). */
export type NivelGeral = "super_admin" | "edicao" | "leitura" | "sem_acesso";

export interface AcessoUsuario {
  id: string;
  email: string;
  nome: string;
  cargo: string | null;
  setor: string | null;
  role: UserRole;
  ativo: boolean;
  permissoes: MapaPermissoes;
  /** Entrou com senha provisória: só libera o sistema depois de criar a própria (0059). */
  trocarSenha: boolean;
}

export const NIVEL_GERAL_LABEL: Record<NivelGeral, string> = {
  super_admin: "Super Admin",
  edicao: "Edição",
  leitura: "Leitura",
  sem_acesso: "Sem módulos",
};

export function ehSuperAdmin(a: AcessoUsuario | null | undefined): boolean {
  return !!a && a.ativo && a.role === "admin";
}

export function podeVer(a: AcessoUsuario | null | undefined, modulo: ModuloKey): boolean {
  if (!a || !a.ativo) return false;
  if (a.role === "admin") return true;
  if (MODULO_POR_KEY[modulo]?.exclusivoSuperAdmin) return false;
  return !!a.permissoes[modulo as ModuloConcedivel];
}

export function podeEditar(a: AcessoUsuario | null | undefined, modulo: ModuloKey): boolean {
  if (!a || !a.ativo) return false;
  if (a.role === "admin") return true;
  if (MODULO_POR_KEY[modulo]?.exclusivoSuperAdmin) return false;
  return a.role === "editor" && a.permissoes[modulo as ModuloConcedivel] === "edicao";
}

export function nivelGeral(a: Pick<AcessoUsuario, "role" | "permissoes">): NivelGeral {
  if (a.role === "admin") return "super_admin";
  const niveis = Object.values(a.permissoes);
  if (niveis.length === 0) return "sem_acesso";
  return niveis.includes("edicao") ? "edicao" : "leitura";
}

/** Papel do banco correspondente ao mapa (o gatilho da 0058 faz o mesmo). */
export function roleDasPermissoes(superAdmin: boolean, permissoes: MapaPermissoes): UserRole {
  if (superAdmin) return "admin";
  return Object.values(permissoes).includes("edicao") ? "editor" : "viewer";
}

/** Limpa o que vier de fora: só chaves concedíveis e níveis válidos. */
export function normalizarPermissoes(entrada: unknown): MapaPermissoes {
  const out: MapaPermissoes = {};
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) return out;
  for (const [k, v] of Object.entries(entrada as Record<string, unknown>)) {
    if (ehModuloConcedivel(k) && (v === "leitura" || v === "edicao")) out[k] = v;
  }
  return out;
}

/** Primeira página liberada, na ordem do menu (destino pós-login). */
export function rotaInicial(a: AcessoUsuario | null | undefined): string {
  const m = MODULOS.find((mod) => podeVer(a, mod.key));
  return m ? m.href : "/dashboard/sem-acesso";
}

export type VereditoRota =
  | { ok: true }
  | { ok: false; motivo: "bloqueado" }
  | { ok: false; motivo: "trocar_senha" }
  | { ok: false; motivo: "sem_permissao"; destino: string };

/** Decide se o usuário pode abrir a URL — usado pelo proxy. */
export function verificarRota(a: AcessoUsuario | null, pathname: string): VereditoRota {
  const rota = classificarRota(pathname);
  if (rota.tipo === "fora") return { ok: true };
  if (!a || !a.ativo) return { ok: false, motivo: "bloqueado" };
  if (a.trocarSenha) return { ok: false, motivo: "trocar_senha" };
  if (rota.tipo === "livre") return { ok: true };
  if (rota.tipo === "desconhecida") {
    return a.role === "admin" ? { ok: true } : { ok: false, motivo: "sem_permissao", destino: "/dashboard/sem-acesso" };
  }
  if (podeVer(a, rota.modulo)) return { ok: true };
  // Home fechada: cai na primeira página liberada (sem tela de erro).
  const destino = rota.modulo === "home"
    ? rotaInicial(a)
    : `/dashboard/sem-acesso?modulo=${rota.modulo}`;
  return { ok: false, motivo: "sem_permissao", destino };
}

/** Destino seguro para o ?next= do login (evita redirecionamento aberto). */
export function destinoSeguro(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith("/dashboard")) return null;
  if (next.startsWith("//") || next.includes("\\")) return null;
  return next;
}
