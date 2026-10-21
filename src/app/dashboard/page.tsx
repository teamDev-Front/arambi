import { DashboardHome } from "@/components/dashboard/DashboardHome";
import { exigirModulo } from "@/lib/acessos/servidor";

export const metadata = { title: "Home – AramBI" };

export default async function DashboardPage() {
  await exigirModulo("home");
  return <DashboardHome />;
}
