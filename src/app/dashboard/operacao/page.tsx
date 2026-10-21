import { OperacaoPage } from "@/components/operacao/OperacaoPage";
import { exigirModulo } from "@/lib/acessos/servidor";

export const metadata = { title: "Operação de Campo – AramBI" };

export default async function Page() {
  await exigirModulo("operacao");
  return <OperacaoPage />;
}
