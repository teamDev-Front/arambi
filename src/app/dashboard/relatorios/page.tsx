import { RelatoriosPage } from "@/components/relatorios/RelatoriosPage";
import { exigirModulo } from "@/lib/acessos/servidor";

export const metadata = { title: "Relatórios PDF – AramBI" };

export default async function Page() {
  await exigirModulo("relatorios");
  return <RelatoriosPage />;
}
