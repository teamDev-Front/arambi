import { redirect } from "next/navigation";
import { ChatPage } from "@/components/assistentes/ChatPage";

// Lista de agentes desativados temporariamente (reunião 15/05/2026).
// Acessos diretos via URL são redirecionados para o hub.
const AGENTES_DESATIVADOS = new Set(["financeiro"]);

interface Props {
  params: Promise<{ agentId: string }>;
}

export default async function Page({ params }: Props) {
  const { agentId } = await params;
  if (AGENTES_DESATIVADOS.has(agentId)) {
    redirect("/dashboard/assistentes");
  }
  return <ChatPage agentId={agentId} />;
}
