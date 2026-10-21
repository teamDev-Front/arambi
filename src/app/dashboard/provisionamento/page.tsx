import { ProvisionamentoPage } from "@/components/provisionamento/ProvisionamentoPage";
import { exigirModulo } from "@/lib/acessos/servidor";

export const metadata = { title: "Provisionamento Anual – AramBI" };

export default async function Page() {
  await exigirModulo("provisionamento");
  return <ProvisionamentoPage />;
}
