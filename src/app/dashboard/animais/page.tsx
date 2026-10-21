import { AnimaisPage } from "@/components/animais/AnimaisPage";
import { exigirModulo } from "@/lib/acessos/servidor";

export const metadata = { title: "Estoque de Animais – AramBI" };

export default async function Page() {
  await exigirModulo("animais");
  return <AnimaisPage />;
}
