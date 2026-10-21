import { DistribuicaoPage } from "@/components/distribuicao/DistribuicaoPage";
import { exigirModulo } from "@/lib/acessos/servidor";

export const metadata = { title: "Distribuição de Lucro – AramBI" };

export default async function Page() {
  await exigirModulo("distribuicao");
  return <DistribuicaoPage />;
}
