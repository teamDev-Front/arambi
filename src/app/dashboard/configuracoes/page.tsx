import { ConfiguracoesPage } from "@/components/configuracoes/ConfiguracoesPage";
import { exigirModulo } from "@/lib/acessos/servidor";

export const metadata = { title: "Configurações – AramBI" };

export default async function Page() {
  await exigirModulo("configuracoes");
  return <ConfiguracoesPage />;
}
