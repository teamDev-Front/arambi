import { AssistentesHub } from "@/components/assistentes/AssistentesHub";
import { exigirModulo } from "@/lib/acessos/servidor";

export const metadata = { title: "Assistentes IA – AramBI" };

export default async function Page() {
  await exigirModulo("assistentes");
  return <AssistentesHub />;
}
