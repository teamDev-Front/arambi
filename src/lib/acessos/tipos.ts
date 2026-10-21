// Contrato entre as APIs /api/acessos e a tela Acessos.

import type { UserRole } from "@/types";
import type { MapaPermissoes, NivelGeral } from "@/lib/acessos/permissoes";

export type StatusAcesso =
  | "ativo"              // já criou a própria senha
  | "primeiro_acesso"    // recebeu a senha provisória e ainda não entrou para trocar
  | "senha_provisoria"   // o admin gerou uma senha provisória nova (reset)
  | "bloqueado"          // bloqueado na tela Acessos
  | "sem_liberacao";     // perfil criado fora da tela (ex.: cadastro público) — sem acesso até liberar

export const STATUS_ACESSO_LABEL: Record<StatusAcesso, string> = {
  ativo: "Ativo",
  primeiro_acesso: "Aguardando 1º acesso",
  senha_provisoria: "Senha provisória",
  bloqueado: "Bloqueado",
  sem_liberacao: "Aguardando liberação",
};

export interface UsuarioAcesso {
  id: string;
  email: string;
  nome: string;
  cargo: string | null;
  setor: string | null;
  role: UserRole;
  superAdmin: boolean;
  nivel: NivelGeral;
  permissoes: MapaPermissoes;
  status: StatusAcesso;
  ultimoAcesso: string | null;
  senhaDefinidaEm: string | null;
  convidadoEm: string | null;
  convidadoPorNome: string | null;
  bloqueadoEm: string | null;
  bloqueadoPorNome: string | null;
  criadoEm: string;
}

/** Pedido de nova senha feito na tela de login, aguardando o Super Admin. */
export interface PedidoSenha {
  id: string;
  usuarioId: string;
  nome: string;
  email: string;
  criadoEm: string;
  ip: string | null;
  /** "Chrome · Windows" — para reconhecer o aparelho de quem pediu. */
  dispositivo: string | null;
}

export interface ListaAcessos {
  usuarios: UsuarioAcesso[];
  pedidos: PedidoSenha[];
  meuId: string;
}

/** Corpo de criação/edição. */
export interface AcessoPayload {
  nome: string;
  email?: string;            // só na criação
  cargo: string | null;
  setor: string | null;
  superAdmin: boolean;
  permissoes: MapaPermissoes;
  senhaProvisoria?: string;  // só na criação
}

/** E-mail + senha provisória para mandar à pessoa (aparece uma vez só). */
export interface Credenciais {
  email: string;
  senha: string;
}

export interface ResultadoAcesso {
  usuario?: UsuarioAcesso | null;
  credenciais?: Credenciais;
  aviso?: string;
}

export type AcaoAcesso = "bloquear" | "desbloquear" | "senha_provisoria";
export type DecisaoPedido = "aprovar" | "recusar";
