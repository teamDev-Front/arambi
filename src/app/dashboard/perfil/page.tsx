import { MeuPerfilPage } from "@/components/acessos/MeuPerfilPage";
import { exigirUsuarioAtivo } from "@/lib/acessos/servidor";

export const metadata = { title: "Meu Perfil – AramBI" };

export default async function Page() {
  await exigirUsuarioAtivo();
  return <MeuPerfilPage />;
}
