import { AcessosPage } from "@/components/acessos/AcessosPage";
import { exigirModulo } from "@/lib/acessos/servidor";

export const metadata = { title: "Acessos – AramBI" };

export default async function Page() {
  await exigirModulo("acessos");
  return <AcessosPage />;
}
