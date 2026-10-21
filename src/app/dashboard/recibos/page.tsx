import { RecibosPage } from "@/components/recibos/RecibosPage";
import { exigirModulo } from "@/lib/acessos/servidor";

export const metadata = { title: "Recibos & Termos – AramBI" };

export default async function Page() {
  await exigirModulo("recibos");
  return <RecibosPage />;
}
