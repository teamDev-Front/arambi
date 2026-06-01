"use client";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Send, Paperclip, Bot, User, ArrowLeft, Settings } from "lucide-react";
import Link from "next/link";
import { ConfigPromptModal, loadAgentePrompt } from "@/components/assistentes/ConfigPromptModal";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

const AGENT_INFO: Record<string, { nome: string; descricao: string; color: string }> = {
  financeiro:      { nome: "Assistente Financeiro",    descricao: "Relatórios e análise financeira", color: "bg-emerald-700" },
  contabilidade:   { nome: "Assistente de Contabilidade", descricao: "Auxílio contábil",           color: "bg-blue-700" },
  "adv-trabalhista":{ nome: "Adv. Trabalhista",        descricao: "Jurídico trabalhista",           color: "bg-purple-700" },
  "adv-ambiental": { nome: "Adv. Ambiental",           descricao: "Legislação ambiental",           color: "bg-green-700" },
  "adv-tributarista":{ nome: "Adv. Tributarista",      descricao: "Impostos e tributos",            color: "bg-amber-700" },
  "adv-contratual":{ nome: "Adv. Contratual",          descricao: "Contratos empresariais",         color: "bg-rose-700" },
  "fiscal-notas":  { nome: "Assistente Fiscal",        descricao: "Emissão de NF-e",                color: "bg-cyan-700" },
  estoque:         { nome: "Assistente de Estoque",    descricao: "Controle de inventário",         color: "bg-orange-700" },
};

const WELCOME: Record<string, string> = {
  financeiro: "Olá! Sou o Assistente Financeiro. Posso ajudar com relatórios, análise de gastos, receitas e indicadores financeiros. O que você precisa?",
  default:    "Olá! Como posso ajudá-lo hoje?",
};

function genId() { return Math.random().toString(36).slice(2); }

export function ChatPage({ agentId }: { agentId: string }) {
  const agent = AGENT_INFO[agentId] ?? AGENT_INFO["financeiro"];
  const fallbackWelcome = WELCOME[agentId] ?? WELCOME.default;
  const [messages, setMessages] = useState<Message[]>([
    {
      id: genId(),
      role: "assistant",
      content: fallbackWelcome,
      timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Carrega a mensagem de boas-vindas do DB (sobrescreve o mock) — só uma vez por agente.
  useEffect(() => {
    let cancelado = false;
    loadAgentePrompt(agentId).then((row) => {
      if (cancelado) return;
      const vinda = row?.mensagem_boas_vindas?.trim();
      if (!vinda) return;
      setMessages((prev) => {
        if (prev.length !== 1 || prev[0].role !== "assistant") return prev;
        return [{ ...prev[0], content: vinda }];
      });
    });
    return () => { cancelado = true; };
  }, [agentId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");

    const userMsg: Message = {
      id: genId(), role: "user", content: text,
      timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    // Placeholder – will be connected to backend endpoint
    setTimeout(() => {
      const reply: Message = {
        id: genId(), role: "assistant",
        content: `[Aguardando conexão com endpoint do agente "${agent.nome}"]\n\nSua mensagem foi recebida: "${text}"`,
        timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages(prev => [...prev, reply]);
      setLoading(false);
    }, 800);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-8rem)] max-w-[900px]">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link href="/dashboard/assistentes">
          <Button variant="ghost" size="sm"><ArrowLeft size={14} /> Voltar</Button>
        </Link>
        <div className={`w-10 h-10 rounded-xl ${agent.color} flex items-center justify-center text-white shrink-0`}>
          <Bot size={18} />
        </div>
        <div>
          <p className="font-semibold text-stone-800 text-sm">{agent.nome}</p>
          <p className="text-xs text-stone-500">{agent.descricao}</p>
        </div>
        <Badge variant="success" className="ml-auto">Conectado</Badge>
        <button
          type="button"
          onClick={() => setConfigOpen(true)}
          className="p-2 rounded-lg border border-stone-200 bg-white text-stone-500 hover:text-accent-500 hover:border-accent-500 transition"
          title="Configurar treinamento deste assistente"
          aria-label="Configurar treinamento deste assistente"
        >
          <Settings size={14} />
        </button>
      </div>

      <ConfigPromptModal
        open={configOpen}
        agenteId={agentId}
        nomeFallback={agent.nome}
        onClose={() => setConfigOpen(false)}
        onSaved={(saved) => {
          const vinda = saved.mensagem_boas_vindas.trim();
          if (!vinda) return;
          setMessages((prev) => {
            if (prev.length !== 1 || prev[0].role !== "assistant") return prev;
            return [{ ...prev[0], content: vinda }];
          });
        }}
      />

      {/* Messages */}
      <Card className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white text-xs ${
                msg.role === "assistant" ? agent.color : "bg-stone-600"
              }`}>
                {msg.role === "assistant" ? <Bot size={14} /> : <User size={14} />}
              </div>
              <div className={`max-w-[75%] ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col gap-1`}>
                <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-[#3a6230] text-white rounded-tr-sm"
                    : "bg-stone-100 text-stone-800 rounded-tl-sm"
                }`}>
                  {msg.content}
                </div>
                <span className="text-[10px] text-stone-400">{msg.timestamp}</span>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white text-xs ${agent.color}`}>
                <Bot size={14} />
              </div>
              <div className="bg-stone-100 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1">
                {[0,1,2].map(i => (
                  <span key={i} className="w-1.5 h-1.5 bg-stone-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-stone-100">
          <div className="flex items-end gap-2">
            <button className="p-2 rounded-lg hover:bg-stone-100 text-stone-400 transition shrink-0">
              <Paperclip size={16} />
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Digite sua mensagem... (Enter para enviar)"
              rows={1}
              className="flex-1 resize-none rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent transition max-h-32"
              style={{ overflowY: "auto" }}
            />
            <Button onClick={handleSend} disabled={!input.trim() || loading} size="sm" className="shrink-0 h-10 px-4">
              <Send size={14} />
            </Button>
          </div>
          <p className="text-[10px] text-stone-400 mt-1.5 text-center">
            Pressione Enter para enviar · Shift+Enter para nova linha
          </p>
        </div>
      </Card>
    </div>
  );
}
