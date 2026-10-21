import { LogsPage } from "@/components/logs/LogsPage";
import { exigirModulo } from "@/lib/acessos/servidor";

export const metadata = { title: "Logs do Sistema – AramBI" };

export default async function Page() {
  await exigirModulo("logs");
  return <LogsPage />;
}
