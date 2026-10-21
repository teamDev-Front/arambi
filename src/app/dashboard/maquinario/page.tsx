import { MaquinarioPage } from "@/components/maquinario/MaquinarioPage";
import { exigirModulo } from "@/lib/acessos/servidor";

export const metadata = { title: "Maquinário & Veículos – AramBI" };

export default async function Page() {
  await exigirModulo("maquinario");
  return <MaquinarioPage />;
}
