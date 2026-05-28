"use client";
import { useState } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfigIAModal } from "@/components/assistentes/ConfigIAModal";
import {
  Scale, Leaf, Calculator, FileSignature, DollarSign,
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
  { id: "contabilidade", nome: "Assistente de Contabilidade", descricao: "Auxílio contábil, lançamentos e conciliação bancária.", icon: <Calculator size={22}/>, color: "bg-blue-700", area: "Contabilidade", status: "ativo" },
  { id: "adv-trabalhista", nome: "Assistente Adv. Trabalhista", descricao: "Suporte jurídico trabalhista, contratos CLT e legislação.", icon: <Scale size={22}/>, color: "bg-purple-700", area: "Jurídico", status: "ativo" },
  { id: "adv-ambiental", nome: "Assistente Adv. Ambiental", descricao: "Legislação ambiental, licenciamentos e conformidade.", icon: <Leaf size={22}/>, color: "bg-green-700", area: "Jurídico", status: "ativo" },
  { id: "adv-tributarista", nome: "Assistente Adv. Tributarista", descricao: "Impostos, tributos, otimização fiscal e planejamento.", icon: <Receipt size={22}/>, color: "bg-amber-700", area: "Jurídico", status: "ativo" },
  { id: "adv-contratual", nome: "Assistente Adv. Contratual", descricao: "Elaboração e revisão de contratos empresariais.", icon: <FileSignature size={22}/>, color: "bg-rose-700", area: "Jurídico", status: "ativo" },
  { id: "fiscal-notas", nome: "Assistente Fiscal / NF-e", descricao: "Emissão de notas fiscais, SPED e obrigações acessórias.", icon: <Bot size={22}/>, color: "bg-cyan-700", area: "Fiscal", status: "ativo" },
  { id: "estoque", nome: "Assistente de Estoque", descricao: "Controle de inventário, alertas de baixo estoque e consultas.", icon: <Bot size={22}/>, color: "bg-orange-700", area: "Operacional", status: "ativo" },
];

const RECENTES = [
  { session: "joao-adv-trabalhista", agente: "Adv. Trabalhista", ultima: "Qual o prazo para homologação?", tempo: "há 2h" },
  { session: "maria-contabilidade", agente: "Contabilidade", ultima: "Como lançar essa despesa?", tempo: "há 1 dia" },
  { session: "lola-fiscal", agente: "Fiscal / NF-e", ultima: "Confirmando a emissão da NF 256.", tempo: "há 2 dias" },
];

export function AssistentesHub() {
  const [configOpen, setConfigOpen] = useState(false);
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
                  {["Sessão","Agente","Última mensagem","Tempo","Ação"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-stone-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {RECENTES.map((r) => (
                  <tr key={r.session} className="border-b border-stone-50 hover:bg-stone-50 transition table-row-alt">
                    <td className="px-4 py-3 text-stone-700 font-mono text-xs">{r.session}</td>
                    <td className="px-4 py-3">
                      <Badge variant="info">{r.agente}</Badge>
                    </td>
                    <td className="px-4 py-3 text-stone-500 text-xs truncate max-w-[200px]">{r.ultima}</td>
                    <td className="px-4 py-3 text-stone-400 text-xs">{r.tempo}</td>
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/assistentes/contabilidade`}>
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
