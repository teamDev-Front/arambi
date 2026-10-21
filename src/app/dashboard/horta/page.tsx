import { HortaPage } from "@/components/horta/HortaPage";
import { exigirModulo } from "@/lib/acessos/servidor";

export const metadata = { title: "Horta & Canteiros – AramBI" };

export default async function Page() {
  await exigirModulo("horta");
  return <HortaPage />;
}
