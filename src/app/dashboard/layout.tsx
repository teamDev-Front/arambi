import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { ToastProvider } from "@/components/ui/Toast";
import { PermissoesProvider } from "@/components/acessos/PermissoesProvider";
import { ModoLeituraBanner } from "@/components/acessos/ModoLeituraBanner";
import { obterSessaoAcesso } from "@/lib/acessos/servidor";
import { NIVEL_GERAL_LABEL, nivelGeral } from "@/lib/acessos/permissoes";

// O layout só monta a casca com o perfil do usuário — ele não re-renderiza na
// navegação, então quem barra a URL é o proxy + exigirModulo() em cada página.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const sessao = await obterSessaoAcesso();
  const acesso = sessao?.acesso ?? null;

  const userName = acesso?.nome ?? sessao?.user.email?.split("@")[0] ?? "Usuário";
  const userRole = acesso
    ? (acesso.role === "admin" ? NIVEL_GERAL_LABEL.super_admin : acesso.cargo || NIVEL_GERAL_LABEL[nivelGeral(acesso)])
    : "";

  return (
    <ToastProvider>
      <PermissoesProvider acesso={acesso}>
        <div className="flex h-screen overflow-hidden bg-[#f5f0e8]">
          <Sidebar />
          <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
            <Header userName={userName} userRole={userRole} />
            <main className="flex-1 overflow-y-auto p-6">
              <ModoLeituraBanner />
              {children}
            </main>
          </div>
        </div>
      </PermissoesProvider>
    </ToastProvider>
  );
}
