// Contrato entre as APIs /api/acessos e a tela Acessos.

import type { UserRole } from "@/types";
import type { MapaPermissoes, NivelGeral } from "@/lib/acessos/permissoes";

export type StatusAcesso =
  | "ativo"              // entrou e definiu a senha
  | "convite_pendente"   // liberado, ainda não criou a senha
  | "bloqueado"          // bloqueado na tela Acessos
  | "sem_liberacao";     // perfil criado fora da tela (ex.: cadastro público) — sem acesso até liberar

export const STATUS_ACESSO_LABEL: Record<StatusAcesso, string> = {
  ativo: "Ativo",
  convite_pendente: "Convite pendente",
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
  /** O e-mail do convite já foi aberto (link clicado). */
  emailConfirmado: boolean;
  ultimoAcesso: string | null;
  senhaDefinidaEm: string | null;
  convidadoEm: string | null;
  convidadoPorNome: string | null;
  bloqueadoEm: string | null;
  bloqueadoPorNome: string | null;
  criadoEm: string;
}

export interface ListaAcessos {
  usuarios: UsuarioAcesso[];
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
  enviarEmail?: boolean;     // só na criação
}

/** Resultado de operações que podem gerar link/e-mail. */
export interface ResultadoConvite {
  usuario?: UsuarioAcesso;
  emailEnviado: boolean;
  /** Link para enviar por WhatsApp (só quando pedido ou quando o e-mail falhou). */
  link?: string;
  /** Por que o e-mail não saiu (SMTP, limite de envio...). */
  avisoEmail?: string;
}

export type AcaoAcesso =
  | "bloquear"
  | "desbloquear"
  | "reenviar_convite"
  | "gerar_link"
  | "redefinir_senha";
