"use client";
// Permissões do usuário logado no navegador. O layout do dashboard carrega o
// perfil no servidor e entrega aqui; as telas perguntam com useModulo().
//
// Isto só decide o que APARECE (menu, botões). Quem barra de verdade são o
// proxy, as páginas (exigirModulo), as APIs e o RLS.
//
// Receita para uma tela:
//   const { podeEditar } = useModulo("financeiro");
//   {podeEditar && <Button>Novo lançamento</Button>}
// ou, em JSX longo:
//   <SeEditar modulo="financeiro"> ...ações... </SeEditar>

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ModuloKey } from "@/lib/acessos/modulos";
import {
  ehSuperAdmin, nivelGeral, podeEditar, podeVer,
  type AcessoUsuario, type NivelGeral,
} from "@/lib/acessos/permissoes";

const PermissoesContext = createContext<AcessoUsuario | null>(null);

export function PermissoesProvider({ acesso, children }: { acesso: AcessoUsuario | null; children: ReactNode }) {
  return <PermissoesContext.Provider value={acesso}>{children}</PermissoesContext.Provider>;
}

/** Perfil completo (null fora do dashboard ou sem perfil). */
export function useAcesso(): AcessoUsuario | null {
  return useContext(PermissoesContext);
}

export interface PermissoesApi {
  acesso: AcessoUsuario | null;
  superAdmin: boolean;
  nivel: NivelGeral;
  podeVer: (modulo: ModuloKey) => boolean;
  podeEditar: (modulo: ModuloKey) => boolean;
}

export function usePermissoes(): PermissoesApi {
  const acesso = useAcesso();
  return useMemo(() => ({
    acesso,
    superAdmin: ehSuperAdmin(acesso),
    nivel: acesso ? nivelGeral(acesso) : "sem_acesso",
    podeVer: (m: ModuloKey) => podeVer(acesso, m),
    podeEditar: (m: ModuloKey) => podeEditar(acesso, m),
  }), [acesso]);
}

export interface PermissaoModulo {
  podeVer: boolean;
  podeEditar: boolean;
  /** Vê o módulo mas não altera nada (só consulta e exportação). */
  somenteLeitura: boolean;
}

export function useModulo(modulo: ModuloKey): PermissaoModulo {
  const acesso = useAcesso();
  const ver = podeVer(acesso, modulo);
  const editar = podeEditar(acesso, modulo);
  return { podeVer: ver, podeEditar: editar, somenteLeitura: ver && !editar };
}

/** Mostra os filhos só para quem pode editar o módulo. */
export function SeEditar({ modulo, children, senao = null }: {
  modulo: ModuloKey;
  children: ReactNode;
  senao?: ReactNode;
}) {
  const { podeEditar: editar } = useModulo(modulo);
  return <>{editar ? children : senao}</>;
}
