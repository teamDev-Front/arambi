// Regras de permissão — funções puras, usadas no proxy, no servidor e no
// navegador. Espelham as funções SQL da migration 0058:
//   podeVer    ↔ fn_pode_ver_modulo
//   podeEditar ↔ fn_pode_editar_modulo

import type { UserRole } from "@/types";
import {
  MODULOS, classificarRota, ehModulo, ehModuloSensivel, type ModuloKey,
} from "@/lib/acessos/modulos";

export type NivelModulo = "leitura" | "edicao";
export type MapaPermissoes = Partial<Record<ModuloKey, NivelModulo>>;

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
  return !!a.permissoes[modulo];
}

export function podeEditar(a: AcessoUsuario | null | undefined, modulo: ModuloKey): boolean {
  if (!a || !a.ativo) return false;
  if (a.role === "admin") return true;
  return a.role === "editor" && a.permissoes[modulo] === "edicao";
}

// ---------------------------------------------------------------------------
// Delegação: quem tem o módulo Acessos sem ser Super Admin
// ---------------------------------------------------------------------------
// O módulo não pode virar atalho para mais poder. Sem estas regras, quem edita
// Acessos se promoveria, geraria uma senha para o Super Admin e entraria como
// ele, ou criaria uma segunda conta com mais módulos do que tem. Valem nas rotas
// /api/acessos; a tela só as usa para não oferecer o que seria recusado.

type AlvoAcesso = { id: string; role: UserRole; permissoes: MapaPermissoes };

function nivelCobre(teto: NivelModulo | null | undefined, nivel: NivelModulo): boolean {
  return teto === "edicao" || (teto === "leitura" && nivel === "leitura");
}

/** Até que nível o ator libera este módulo; null = não pode liberar nem retirar. */
export function tetoDeConcessao(ator: AcessoUsuario | null | undefined, modulo: ModuloKey): NivelModulo | null {
  if (!ator || !ator.ativo) return null;
  if (ator.role === "admin") return "edicao";
  if (ehModuloSensivel(modulo)) return null;
  return ator.permissoes[modulo] ?? null;
}

/**
 * Por que o ator NÃO pode mexer neste acesso (null = pode). Cobre editar, bloquear,
 * gerar senha, excluir e decidir pedido de senha: entrar com a senha de quem tem mais
 * módulos seria ganhar esses módulos.
 */
export function recusaGestao(ator: AcessoUsuario | null | undefined, alvo: AlvoAcesso): string | null {
  if (ehSuperAdmin(ator)) return null;
  if (!ator || !podeEditar(ator, "acessos")) return "Seu acesso a este módulo é somente leitura.";
  if (alvo.id === ator.id) return "Só um Super Admin pode alterar o seu próprio acesso.";
  if (alvo.role === "admin") return "Só um Super Admin pode alterar o acesso de outro Super Admin.";
  const temMaisQueOAtor = (Object.entries(alvo.permissoes) as [ModuloKey, NivelModulo][])
    .some(([modulo, nivel]) => !nivelCobre(ator.permissoes[modulo], nivel));
  if (temMaisQueOAtor) return "Esta pessoa tem módulos ou níveis acima dos seus. Só um Super Admin pode alterar este acesso.";
  return null;
}

/** Por que o ator NÃO pode deixar o acesso desse jeito (null = pode). */
export function recusaConcessao(
  ator: AcessoUsuario | null | undefined,
  antes: MapaPermissoes,
  depois: MapaPermissoes,
  superAdmin: boolean,
): string | null {
  if (ehSuperAdmin(ator)) return null;
  if (superAdmin) return "Só um Super Admin pode criar outro Super Admin.";
  for (const m of MODULOS) {
    const de = antes[m.key];
    const para = depois[m.key];
    if (de === para) continue;
    if (ehModuloSensivel(m.key)) return `Só um Super Admin pode liberar ou retirar ${m.label}.`;
    const teto = tetoDeConcessao(ator, m.key);
    if (!nivelCobre(teto, de ?? "leitura") || !nivelCobre(teto, para ?? "leitura")) {
      return `Você não pode liberar ${m.label} acima do seu próprio acesso.`;
    }
  }
  return null;
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

/** Limpa o que vier de fora: só módulos do catálogo e níveis válidos. */
export function normalizarPermissoes(entrada: unknown): MapaPermissoes {
  const out: MapaPermissoes = {};
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) return out;
  for (const [k, v] of Object.entries(entrada as Record<string, unknown>)) {
    if (ehModulo(k) && (v === "leitura" || v === "edicao")) out[k] = v;
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
