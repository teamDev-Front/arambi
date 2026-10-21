import { SaldosPage } from "@/components/saldos/SaldosPage";
import { exigirModulo } from "@/lib/acessos/servidor";

export const metadata = { title: "Saldos Mensais – AramBI" };

export default async function Page() {
  await exigirModulo("saldos");
  return <SaldosPage />;
}
