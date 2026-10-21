import { BancosPage } from "@/components/bancos/BancosPage";
import { exigirModulo } from "@/lib/acessos/servidor";

export const metadata = { title: "Bancos – AramBI" };

export default async function Page() {
  await exigirModulo("bancos");
  return <BancosPage />;
}
