import { ChatPage } from "@/components/assistentes/ChatPage";

interface Props {
  params: Promise<{ agentId: string }>;
}

export default async function Page({ params }: Props) {
  const { agentId } = await params;
  return <ChatPage agentId={agentId} />;
}
