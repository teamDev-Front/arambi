import { OrcamentosPage } from "@/components/orcamentos/OrcamentosPage";
import { exigirModulo } from "@/lib/acessos/servidor";

export const metadata = { title: "Orçamentos – AramBI" };

export default async function Page() {
  await exigirModulo("orcamentos");
  return <OrcamentosPage />;
}
