import { FinanceiroPage } from "@/components/financeiro/FinanceiroPage";
import { exigirModulo } from "@/lib/acessos/servidor";

export const metadata = { title: "Financeiro – AramBI" };

export default async function Page() {
  await exigirModulo("financeiro");
  return <FinanceiroPage />;
}
