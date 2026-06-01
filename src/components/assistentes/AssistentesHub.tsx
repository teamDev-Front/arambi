"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { ConfigIAModal } from "@/components/assistentes/ConfigIAModal";
import { createClient } from "@/lib/supabase/client";
import type { ChatSessaoRecenteRow } from "@/types";
import {
  Scale, Leaf, Calculator, FileSignature,
  Receipt, Bot, MessageSquare, Clock, Settings,
} from "lucide-react";

interface Agent {
  id: string;
  nome: string;
  descricao: string;
  icon: React.ReactNode;
  color: string;
  area: string;
  status: "ativo" | "em_breve";
}

// Decisão de produto 15/05/2026: o Assistente Financeiro foi escondido por
// enquanto (volume de dados grande demais para um único agente). Mantemos a
// definição comentada para reativar quando o pipeline estiver pronto.
//   { id: "financeiro", nome: "Assistente Financeiro", ... }
const AGENTS: Agent[] = [
  { id: "contabilidade",     nome: "Assistente de Contabilidade",  descricao: "Auxílio contábil, lançamentos e conciliação bancária.",          icon: <Calculator size={22}/>,     color: "bg-blue-700",   area: "Contabilidade", status: "ativo" },
  { id: "adv-trabalhista",   nome: "Assistente Adv. Trabalhista",  descricao: "Suporte jurídico trabalhista, contratos CLT e legislação.",      icon: <Scale size={22}/>,          color: "bg-purple-700", area: "Jurídico",      status: "ativo" },
  { id: "adv-ambiental",     nome: "Assistente Adv. Ambiental",    descricao: "Legislação ambiental, licenciamentos e conformidade.",           icon: <Leaf size={22}/>,           color: "bg-green-700",  area: "Jurídico",      status: "ativo" },
  { id: "adv-tributarista",  nome: "Assistente Adv. Tributarista", descricao: "Impostos, tributos, otimização fiscal e planejamento.",          icon: <Receipt size={22}/>,        color: "bg-amber-700",  area: "Jurídico",      status: "ativo" },
  { id: "adv-contratual",    nome: "Assistente Adv. Contratual",   descricao: "Elaboração e revisão de contratos empresariais.",                icon: <FileSignature size={22}/>,  color: "bg-rose-700",   area: "Jurídico",      status: "ativo" },
  { id: "fiscal-notas",      nome: "Assistente Fiscal / NF-e",     descricao: "Emissão de notas fiscais, SPED e obrigações acessórias.",        icon: <Bot size={22}/>,            color: "bg-cyan-700",   area: "Fiscal",        status: "ativo" },
  { id: "estoque",           nome: "Assistente de Estoque",        descricao: "Controle de inventário, alertas de baixo estoque e consultas.",  icon: <Bot size={22}/>,            color: "bg-orange-700", area: "Operacional",   status: "ativo" },
];

const LIMITE_RECENTES = 10;

function tempoRelativo(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return "agora";
  const min = Math.floor(diffMs / 60000);
  if (min < 1)  return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `há ${h}h`;
  const dias = Math.floor(h / 24);
  if (dias < 7) return `há ${dias} ${dias === 1 ? "dia" : "dias"}`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function AssistentesHub() {
  const toast = useToast();
  const [configOpen, setConfigOpen] = useState(false);
  const [recentes, setRecentes] = useState<ChatSessaoRecenteRow[]>([]);
  const [carregandoRecentes, setCarregandoRecentes] = useState(true);

  useEffect(() => {
    let cancelado = false;
    const supabase = createClient();
    (async () => {
      // Só mostra conversas do PRÓPRIO usuário: o link 'Abrir' leva pro chat
      // dele com aquele agente, e o ChatPage só carrega sessões do auth.uid()
      // (RLS de escrita também é por dono). Mostrar conversas de outros aqui
      // só causava cliques perdidos.
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id ?? null;
      if (!userId) {
        if (!cancelado) {
          setRecentes([]);
          setCarregandoRecentes(false);
        }
        return;
      }

      const { data, error } = await supabase
        .from("v_chat_sessoes_recentes")
        .select("*")
        .eq("usuario_id", userId)
        .order("updated_at", { ascending: false })
        .limit(LIMITE_RECENTES);
      if (cancelado) return;
      if (error) {
        toast.error("Erro ao carregar conversas recentes", error.message);
        setRecentes([]);
      } else {
        setRecentes(data ?? []);
      }
      setCarregandoRecentes(false);
    })();
    return () => { cancelado = true; };
  }, [toast]);

  return (
    <div className="space-y-6 max-w-[1200px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#0f1f1c]">Central de Assistentes IA</h1>
          <p className="text-sm text-stone-500">Escolha um assistente para iniciar uma conversa</p>
        </div>
        <button
          type="button"
          onClick={() => setConfigOpen(true)}
          className="shrink-0 p-2 rounded-lg border border-stone-200 bg-white text-stone-500 hover:text-accent-500 hover:border-accent-500 transition"
          title="Configurar chaves de API"
          aria-label="Configurar chaves de API"
        >
          <Settings size={16} />
        </button>
      </div>

      <ConfigIAModal open={configOpen} onClose={() => setConfigOpen(false)} />

      {/* Agent grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {AGENTS.map((agent) => (
          <Card key={agent.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div className={`w-12 h-12 rounded-xl ${agent.color} flex items-center justify-center text-white shrink-0`}>
                  {agent.icon}
                </div>
                <Badge variant={agent.status === "ativo" ? "success" : "neutral"}>
                  {agent.status === "ativo" ? "Ativo" : "Em breve"}
                </Badge>
              </div>
              <div>
                <p className="font-semibold text-sm text-stone-800">{agent.nome}</p>
                <p className="text-xs text-stone-500 mt-1 leading-relaxed">{agent.descricao}</p>
              </div>
              <Badge variant="info" className="self-start">{agent.area}</Badge>
              <Link href={`/dashboard/assistentes/${agent.id}`}>
                <Button variant="secondary" size="sm" className="w-full">
                  <MessageSquare size={13} /> Acessar
                </Button>
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Conversas recentes */}
      <Card>
        <CardHeader>
          <CardTitle>Conversas Recentes</CardTitle>
          <Clock size={16} className="text-stone-400" />
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-100">
                  {["Usuário", "Agente", "Última mensagem", "Tempo", "Ação"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-stone-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {carregandoRecentes && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-xs text-stone-400">
                      Carregando…
                    </td>
                  </tr>
                )}
                {!carregandoRecentes && recentes.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-xs text-stone-400">
                      Nenhuma conversa ainda. Escolha um assistente acima para começar.
                    </td>
                  </tr>
                )}
                {recentes.map((r) => (
                  <tr key={r.session_id} className="border-b border-stone-50 hover:bg-stone-50 transition table-row-alt">
                    <td className="px-4 py-3 text-stone-700 text-xs">{r.usuario_nome}</td>
                    <td className="px-4 py-3">
                      <Badge variant="info">{r.agente_nome}</Badge>
                    </td>
                    <td className="px-4 py-3 text-stone-500 text-xs truncate max-w-[260px]">
                      {r.ultima_mensagem ?? <span className="italic text-stone-300">sem mensagens</span>}
                    </td>
                    <td className="px-4 py-3 text-stone-400 text-xs whitespace-nowrap">
                      {tempoRelativo(r.updated_at)}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/assistentes/${r.agente_id}`}>
                        <Button variant="ghost" size="sm">Abrir</Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
