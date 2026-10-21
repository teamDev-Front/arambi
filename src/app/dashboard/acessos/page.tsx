import { AcessosPage } from "@/components/acessos/AcessosPage";
import { exigirSuperAdmin } from "@/lib/acessos/servidor";

export const metadata = { title: "Acessos – AramBI" };

export default async function Page() {
  await exigirSuperAdmin("acessos");
  return <AcessosPage />;
}
