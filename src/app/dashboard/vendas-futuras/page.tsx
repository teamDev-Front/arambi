import { VendasFuturasPage } from "@/components/vendas/VendasFuturasPage";
import { exigirModulo } from "@/lib/acessos/servidor";

export const metadata = { title: "Vendas Futuras – AramBI" };

export default async function Page() {
  await exigirModulo("vendas");
  return <VendasFuturasPage />;
}
