import { DocumentosPage } from "@/components/documentos/DocumentosPage";
import { exigirModulo } from "@/lib/acessos/servidor";

export const metadata = { title: "Documentos – AramBI" };

export default async function Page() {
  await exigirModulo("documentos");
  return <DocumentosPage />;
}
