"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Send, Bot, User, ArrowLeft, Settings, Plus, X, AlertTriangle, Info } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ConfigPromptModal, loadAgentePromptPublico } from "@/components/assistentes/ConfigPromptModal";
import type { ChatMensagemRow } from "@/types";
import { useModulo } from "@/components/acessos/PermissoesProvider";

interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  pendente?: boolean;
}

const AGENT_INFO: Record<string, { nome: string; descricao: string; color: string }> = {
  financeiro:        { nome: "Assistente Financeiro",        descricao: "Relatórios e análise financeira",  color: "bg-emerald-700" },
  contabilidade:     { nome: "Assistente de Contabilidade",  descricao: "Auxílio contábil",                 color: "bg-blue-700" },
  "adv-trabalhista": { nome: "Adv. Trabalhista",             descricao: "Jurídico trabalhista",             color: "bg-purple-700" },
  "adv-ambiental":   { nome: "Adv. Ambiental",               descricao: "Legislação ambiental",             color: "bg-green-700" },
  "adv-tributarista":{ nome: "Adv. Tributarista",            descricao: "Impostos e tributos",              color: "bg-amber-700" },
  "adv-contratual":  { nome: "Adv. Contratual",              descricao: "Contratos empresariais",           color: "bg-rose-700" },
  "fiscal-notas":    { nome: "Assistente Fiscal",            descricao: "Emissão de NF-e",                  color: "bg-cyan-700" },
  estoque:           { nome: "Assistente de Estoque & Safra", descricao: "Insumos, safra armazenada e vendas futuras", color: "bg-orange-700" },
};

const FALLBACK_WELCOME = "Olá! Como posso ajudá-lo hoje?";
const REQUEST_TIMEOUT_MS = 90_000;

function genTempId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}
function formatHora(iso: string): string {
  try { return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
}

type RawMsg = Pick<ChatMensagemRow, "id" | "role" | "conteudo" | "created_at">;

function isUserOrAssistant(role: RawMsg["role"]): role is "user" | "assistant" {
  return role === "user" || role === "assistant";
}

function rowToDisplay(row: RawMsg): DisplayMessage {
  // role="system" não tem renderização — chamadores devem filtrar antes.
  return {
    id: row.id,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.conteudo,
    created_at: row.created_at,
  };
}

interface APIResponseOk {
  session_id: string;
  provider: "gemini" | "openai";
  user_message: RawMsg;
  assistant_message: RawMsg;
}
interface APIResponseError { error: string }

export function ChatPage({ agentId }: { agentId: string }) {
  const toast = useToast();
  const searchParams = useSearchParams();
  const sessionParam = searchParams.get("session");
  const agentFallback = AGENT_INFO[agentId] ?? { nome: agentId, descricao: "Assistente IA", color: "bg-stone-700" };

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessaoFechada, setSessaoFechada] = useState(false);
  const [welcome, setWelcome] = useState<string>(FALLBACK_WELCOME);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historicoCarregando, setHistoricoCarregando] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [confirmNovaConversa, setConfirmNovaConversa] = useState(false);
  const [agenteAtivo, setAgenteAtivo] = useState<boolean>(true);
  const [agenteNome, setAgenteNome]  = useState<string>(agentFallback.nome);
  // Engrenagem (chaves de API e treinamento): Super Admin ou Edição em Assistentes.
  const { podeEditar } = useModulo("assistentes");
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef  = useRef<AbortController | null>(null);

  // --------- Carrega tudo na entrada: user/role, agente público, sessão, msgs
  const carregarHistorico = useCallback(async () => {
    setHistoricoCarregando(true);
    const supabase = createClient();

    const [{ data: userData }, prompt] = await Promise.all([
      supabase.auth.getUser(),
      loadAgentePromptPublico(agentId),
    ]);

    const user = userData?.user ?? null;
    setAgenteNome(prompt?.nome ?? agentFallback.nome);
    setAgenteAtivo(prompt?.ativo ?? true);
    setWelcome(prompt?.mensagem_boas_vindas?.trim() || FALLBACK_WELCOME);

    if (!user) {
      setMessages([]);
      setHistoricoCarregando(false);
      return;
    }

    // Resolve a sessão: 1º tenta o ?session=<uuid> da URL (qualquer status,
    // desde que pertença ao usuário e ao agente); senão pega a sessão viva.
    let sess: { id: string; fechada: boolean } | null = null;

    if (sessionParam) {
      const { data } = await supabase
        .from("chat_sessions")
        .select("id, fechada, usuario_id, agente_id")
        .eq("id", sessionParam)
        .maybeSingle();
      if (data && data.usuario_id === user.id && data.agente_id === agentId) {
        sess = { id: data.id, fechada: data.fechada };
      }
    }

    if (!sess) {
      const { data } = await supabase
        .from("chat_sessions")
        .select("id, fechada")
        .eq("usuario_id", user.id)
        .eq("agente_id", agentId)
        .eq("fechada", false)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) sess = data;
    }

    if (!sess) {
      setSessionId(null);
      setSessaoFechada(false);
      setMessages([]);
      setHistoricoCarregando(false);
      return;
    }

    setSessionId(sess.id);
    setSessaoFechada(sess.fechada);
    const { data: msgs, error: msgsErr } = await supabase
      .from("chat_mensagens")
      .select("id, role, conteudo, created_at")
      .eq("session_id", sess.id)
      .order("created_at", { ascending: true })
      .limit(500);

    if (msgsErr) {
      toast.error("Erro ao carregar histórico", msgsErr.message);
      setMessages([]);
    } else {
      setMessages((msgs ?? []).filter((m) => isUserOrAssistant(m.role)).map(rowToDisplay));
    }
    setHistoricoCarregando(false);
  }, [agentId, agentFallback.nome, sessionParam, toast]);

  useEffect(() => { void carregarHistorico(); }, [carregarHistorico]);

  // Cancela request pendente ao desmontar.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // --------- Envia mensagem -------------------------------------------------
  async function handleSend() {
    const text = input.trim();
    if (!text || loading || !agenteAtivo) return;

    const tempId = genTempId();
    const nowIso = new Date().toISOString();
    setMessages((prev) => [
      ...prev,
      { id: tempId, role: "user", content: text, created_at: nowIso, pendente: true },
    ]);
    setLoading(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch("/api/assistentes/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agente_id: agentId,
          content: text,
          session_id: sessionId ?? undefined,
        }),
        signal: ctrl.signal,
      });

      const json = (await res.json()) as APIResponseOk | APIResponseError;

      if (!res.ok || "error" in json) {
        const errMsg = "error" in json ? json.error : `HTTP ${res.status}`;
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        toast.error("Não foi possível enviar", errMsg);
        return;
      }

      const ok = json;
      setSessionId(ok.session_id);
      setInput("");                      // só limpa o textarea depois da resposta
      setMessages((prev) => {
        const semTemp = prev.filter((m) => m.id !== tempId);
        return [...semTemp, rowToDisplay(ok.user_message), rowToDisplay(ok.assistant_message)];
      });
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      if (e instanceof DOMException && e.name === "AbortError") {
        toast.warning("Envio cancelado", "Sua mensagem não foi enviada.");
      } else {
        const msg = e instanceof Error ? e.message : "Erro de rede";
        toast.error("Falha de rede", msg);
      }
    } finally {
      clearTimeout(timer);
      abortRef.current = null;
      setLoading(false);
    }
  }

  function handleCancelar() {
    abortRef.current?.abort();
  }

  // --------- Nova conversa --------------------------------------------------
  function pedirNovaConversa() {
    if (loading) return;
    if (!sessionId || messages.length === 0 || sessaoFechada) {
      toast.info("Já é uma nova conversa", "Não há conversa ativa para arquivar.");
      return;
    }
    setConfirmNovaConversa(true);
  }

  async function confirmarNovaConversa() {
    if (!sessionId) {
      setConfirmNovaConversa(false);
      return;
    }
    const supabase = createClient();
    const { error } = await supabase
      .from("chat_sessions")
      .update({ fechada: true })
      .eq("id", sessionId);
    setConfirmNovaConversa(false);
    if (error) {
      toast.error("Não foi possível encerrar a conversa", error.message);
      return;
    }
    setSessionId(null);
    setSessaoFechada(false);
    setMessages([]);
    toast.info("Nova conversa", "A conversa anterior fica salva em Conversas Recentes.");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  // --------- Render ---------------------------------------------------------
  const mostrarBoasVindas = !historicoCarregando && messages.length === 0 && agenteAtivo;
  const podeFazerNovaConversa = !!sessionId && !sessaoFechada && messages.length > 0 && !loading;

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-8rem)] max-w-[900px]">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link href="/dashboard/assistentes">
          <Button variant="ghost" size="sm"><ArrowLeft size={14} /> Voltar</Button>
        </Link>
        <div className={`w-10 h-10 rounded-xl ${agentFallback.color} flex items-center justify-center text-white shrink-0`}>
          <Bot size={18} />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-stone-800 text-sm truncate">{agenteNome}</p>
          <p className="text-xs text-stone-500 truncate">{agentFallback.descricao}</p>
        </div>
        {agenteAtivo
          ? <Badge variant="success" className="ml-auto">Conectado</Badge>
          : <Badge variant="warning" className="ml-auto">Inativo</Badge>}
        <button
          type="button"
          onClick={pedirNovaConversa}
          disabled={!podeFazerNovaConversa}
          className="p-2 rounded-lg border border-stone-200 bg-white text-stone-500 hover:text-accent-500 hover:border-accent-500 transition disabled:opacity-40 disabled:cursor-not-allowed"
          title={podeFazerNovaConversa ? "Encerrar este chat e começar um novo" : "Já é uma nova conversa"}
          aria-label="Nova conversa"
        >
          <Plus size={14} />
        </button>
        {podeEditar && (
          <button
            type="button"
            onClick={() => setConfigOpen(true)}
            className="p-2 rounded-lg border border-stone-200 bg-white text-stone-500 hover:text-accent-500 hover:border-accent-500 transition"
            title="Configurar treinamento deste assistente"
            aria-label="Configurar treinamento deste assistente"
          >
            <Settings size={14} />
          </button>
        )}
      </div>

      {podeEditar && (
        <ConfigPromptModal
          open={configOpen}
          agenteId={agentId}
          nomeFallback={agentFallback.nome}
          onClose={() => setConfigOpen(false)}
          onSaved={(saved) => {
            setWelcome(saved.mensagem_boas_vindas.trim() || FALLBACK_WELCOME);
            if (saved.nome.trim()) setAgenteNome(saved.nome.trim());
          }}
        />
      )}

      {!agenteAtivo && !historicoCarregando && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2 text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <p className="text-xs leading-relaxed">
            Este assistente está marcado como <strong>inativo</strong> no banco e não responde no momento.
            {podeEditar
              ? " Abra a engrenagem para reativá-lo."
              : " Solicite ao administrador a reativação."}
          </p>
        </div>
      )}

      {sessaoFechada && agenteAtivo && !historicoCarregando && (
        <div className="mb-3 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 flex items-start gap-2 text-stone-700">
          <Info size={16} className="mt-0.5 shrink-0 text-stone-400" />
          <p className="text-xs leading-relaxed">
            Você está visualizando uma <strong>conversa arquivada</strong>. Se enviar uma nova mensagem,
            uma <strong>conversa nova</strong> será iniciada automaticamente.
          </p>
        </div>
      )}

      <ConfirmDialog
        open={confirmNovaConversa}
        title="Encerrar este chat e começar um novo?"
        description="A conversa atual fica salva e acessível em Conversas Recentes. Você pode reabrir a qualquer momento — mas a partir dessa nova conversa o histórico do assistente recomeça do zero."
        confirmText="Encerrar e começar novo"
        cancelText="Continuar nesta"
        tone="warning"
        onConfirm={confirmarNovaConversa}
        onCancel={() => setConfirmNovaConversa(false)}
      />

      {/* Messages */}
      <Card className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {historicoCarregando && (
            <div className="text-xs text-stone-400 text-center py-6">Carregando histórico…</div>
          )}

          {mostrarBoasVindas && (
            <div className="flex gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white text-xs ${agentFallback.color}`}>
                <Bot size={14} />
              </div>
              <div className="flex flex-col gap-1">
                <div className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap bg-stone-100 text-stone-800 max-w-[75%]">
                  {welcome}
                </div>
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white text-xs ${
                msg.role === "assistant" ? agentFallback.color : "bg-stone-600"
              }`}>
                {msg.role === "assistant" ? <Bot size={14} /> : <User size={14} />}
              </div>
              <div className={`max-w-[75%] ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col gap-1`}>
                <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-[#3a6230] text-white rounded-tr-sm"
                    : "bg-stone-100 text-stone-800 rounded-tl-sm"
                } ${msg.pendente ? "opacity-70" : ""}`}>
                  {msg.content}
                </div>
                <span className="text-[10px] text-stone-400">{formatHora(msg.created_at)}</span>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white text-xs ${agentFallback.color}`}>
                <Bot size={14} />
              </div>
              <div className="bg-stone-100 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-1.5 h-1.5 bg-stone-400 rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
                <button
                  type="button"
                  onClick={handleCancelar}
                  className="ml-2 text-[11px] text-stone-500 hover:text-red-600 transition flex items-center gap-1"
                  title="Cancelar envio"
                >
                  <X size={12} /> cancelar
                </button>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-stone-100">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                !agenteAtivo
                  ? "Este assistente está inativo."
                  : historicoCarregando
                  ? "Carregando histórico…"
                  : "Digite sua mensagem... (Enter para enviar)"
              }
              rows={1}
              disabled={loading || !agenteAtivo}
              className="flex-1 resize-none rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent transition max-h-32 disabled:opacity-60"
              style={{ overflowY: "auto" }}
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || loading || historicoCarregando || !agenteAtivo}
              size="sm"
              className="shrink-0 h-10 px-4"
            >
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
