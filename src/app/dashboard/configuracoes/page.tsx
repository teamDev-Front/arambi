import { ConfiguracoesPage } from "@/components/configuracoes/ConfiguracoesPage";
import { exigirSuperAdmin } from "@/lib/acessos/servidor";

export const metadata = { title: "Configurações – AramBI" };

export default async function Page() {
  await exigirSuperAdmin("configuracoes");
  return <ConfiguracoesPage />;
}
