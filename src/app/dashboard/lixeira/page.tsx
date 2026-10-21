import { LixeiraPage } from "@/components/lixeira/LixeiraPage";
import { exigirModulo } from "@/lib/acessos/servidor";

export const metadata = { title: "Lixeira – AramBI" };

export default async function Page() {
  await exigirModulo("lixeira");
  return <LixeiraPage />;
}
