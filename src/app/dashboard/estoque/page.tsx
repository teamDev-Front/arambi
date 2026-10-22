import { EstoquePage } from "@/components/estoque/EstoquePage";
import { exigirModulo } from "@/lib/acessos/servidor";

export const metadata = { title: "Culturas & Safra – AramBI" };

export default async function Page() {
  await exigirModulo("estoque");
  return <EstoquePage />;
}
