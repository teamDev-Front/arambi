import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { ToastProvider } from "@/components/ui/Toast";
import { PermissoesProvider } from "@/components/acessos/PermissoesProvider";
import { obterSessaoAcesso } from "@/lib/acessos/servidor";
import {
  NIVEL_GERAL_LABEL, ehSuperAdmin, normalizarPermissoes, podeEditar, recusaGestao, type AcessoUsuario,
} from "@/lib/acessos/permissoes";
import { createAdminClient } from "@/lib/supabase/admin";

/** Pedidos de nova senha que esta pessoa pode decidir (contador no menu). */
async function contarPedidosSenha(acesso: AcessoUsuario): Promise<number> {
  const admin = createAdminClient();
  const { data: pedidos, error } = await admin
    .from("solicitacoes_senha")
    .select("user_id")
    .eq("status", "pendente");
  if (error || !pedidos?.length) return 0;
  if (ehSuperAdmin(acesso)) return pedidos.length;

  const { data: perfis } = await admin
    .from("users")
    .select("id, role, permissoes")
    .in("id", pedidos.map((p) => p.user_id));
  const decidiveis = new Set((perfis ?? [])
    .filter((p) => !recusaGestao(acesso, { id: p.id, role: p.role, permissoes: normalizarPermissoes(p.permissoes) }))
    .map((p) => p.id));
  return pedidos.filter((p) => decidiveis.has(p.user_id)).length;
}

// O layout só monta a casca com o perfil do usuário — ele não re-renderiza na
// navegação, então quem barra a URL é o proxy + exigirModulo() em cada página.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const sessao = await obterSessaoAcesso();
  const acesso = sessao?.acesso ?? null;

  const userName = acesso?.nome ?? sessao?.user.email?.split("@")[0] ?? "Usuário";
  // Sob o nome: o cargo. Nível (leitura/edição) não é exibido para a pessoa.
  const userRole = acesso?.cargo || (ehSuperAdmin(acesso) ? NIVEL_GERAL_LABEL.super_admin : "");
  const pedidosSenha = acesso && podeEditar(acesso, "acessos") ? await contarPedidosSenha(acesso) : 0;

  return (
    <ToastProvider>
      <PermissoesProvider acesso={acesso}>
        <div className="flex h-screen overflow-hidden bg-[#f5f0e8]">
          <Sidebar badges={{ acessos: pedidosSenha }} />
          <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
            <Header userName={userName} userRole={userRole} />
            <main className="flex-1 overflow-y-auto p-6">
              {children}
            </main>
          </div>
        </div>
      </PermissoesProvider>
    </ToastProvider>
  );
}
