"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Send, Bot, User, ArrowLeft, Settings, Plus, X, AlertTriangle, Info, Paperclip, FileText, ImageIcon } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ConfigPromptModal, loadAgentePromptPublico } from "@/components/assistentes/ConfigPromptModal";
import type { ChatMensagemRow, Json } from "@/types";
import { useModulo } from "@/components/acessos/PermissoesProvider";

/** Item de chat_mensagens.anexos (migration 0062). */
interface AnexoMeta {
  path: string;
  nome: string;
  mime: string;
  tamanho: number;
}

/** Arquivo escolhido e ainda não enviado. */
interface AnexoPendente {
  id: string;
  file: File;
  nome: string;
  mime: string;
  tamanho: number;
  /** Já subiu para o Storage numa tentativa que falhou depois — reaproveita. */
  enviado?: AnexoMeta;
}

interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  pendente?: boolean;
  anexos?: AnexoMeta[];
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
const REQUEST_TIMEOUT_MS = 120_000;

// Anexos — mesmos limites de /api/assistentes/anexos e /api/assistentes/chat.
const BUCKET_ANEXOS          = "chat-anexos";
const MAX_ANEXOS             = 3;
const MAX_ANEXO_BYTES        = 10 * 1024 * 1024;
const MAX_ANEXOS_TOTAL_BYTES = 12 * 1024 * 1024;
const MAX_NOME_ANEXO         = 200;
const TEXTO_PADRAO_ANEXO     = "Analise o(s) documento(s) anexado(s).";
const ACCEPT_ANEXOS          = "application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp";
const EXT_POR_MIME = new Map<string, string>([
  ["application/pdf", "pdf"],
  ["image/png",       "png"],
  ["image/jpeg",      "jpg"],
  ["image/webp",      "webp"],
]);
const MIME_POR_EXT = new Map<string, string>([
  ["pdf", "application/pdf"], ["png", "image/png"], ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["webp", "image/webp"],
]);

function genTempId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}
function formatHora(iso: string): string {
  try { return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
}
function formatTamanho(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

/** Tipo aceito do arquivo; sem tipo reconhecido pelo sistema, decide pela extensão (o servidor confere os bytes). */
function mimeDoArquivo(file: File): string | null {
  if (EXT_POR_MIME.has(file.type)) return file.type;
  if (file.type && file.type !== "application/octet-stream") return null;
  return MIME_POR_EXT.get(file.name.toLowerCase().split(".").pop() ?? "") ?? null;
}

/** Nome exibido/gravado: imagem colada ("image.png") ganha nome com a hora; corta em 200 caracteres. */
function nomeDoArquivo(file: File, mime: string, colado: boolean): string {
  const ext = EXT_POR_MIME.get(mime) ?? "bin";
  let nome = file.name.trim();
  if (!nome || (colado && /^image\.(png|jpe?g|webp)$/i.test(nome))) {
    nome = `imagem-colada-${new Date().toLocaleTimeString("pt-BR").replace(/:/g, "-")}.${ext}`;
  }
  return nome.length > MAX_NOME_ANEXO ? `${nome.slice(0, MAX_NOME_ANEXO - ext.length - 1)}.${ext}` : nome;
}

/** Lê o JSON da resposta; HTML/texto (ex.: 504 da plataforma) → null. */
async function lerJson<T>(res: Response): Promise<T | null> {
  try { return (await res.json()) as T; }
  catch { return null; }
}

/** Rejeita quando o envio é cancelado (ou estoura o tempo). */
function quandoAbortar(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const rejeitar = () => reject(new DOMException("Envio cancelado.", "AbortError"));
    if (signal.aborted) rejeitar();
    else signal.addEventListener("abort", rejeitar, { once: true });
  });
}

type ResultadoUpload = { ok: true; anexo: AnexoMeta } | { ok: false; error: string };

/**
 * Pede o token a /api/assistentes/anexos e sobe o arquivo DIRETO para o Storage
 * (bucket privado chat-anexos) — o arquivo não passa pela API do site.
 */
async function subirAnexo(p: AnexoPendente, signal: AbortSignal): Promise<ResultadoUpload> {
  const res = await fetch("/api/assistentes/anexos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nome: p.nome, mime: p.mime, tamanho: p.tamanho }),
    signal,
  });
  const json = await lerJson<{ path?: string; token?: string; error?: string }>(res);
  if (!res.ok || !json?.path || !json.token) {
    return { ok: false, error: json?.error ?? `Falha ao preparar "${p.nome}" (HTTP ${res.status}).` };
  }
  // O Storage lê o tipo do próprio File: garante o mime aceito pelo bucket.
  const corpo = p.file.type === p.mime ? p.file : new File([p.file], p.nome, { type: p.mime });
  const upload = createClient().storage
    .from(BUCKET_ANEXOS)
    .uploadToSignedUrl(json.path, json.token, corpo, { contentType: p.mime });
  // uploadToSignedUrl não aceita AbortSignal: o "cancelar" solta a tela na hora.
  const { error } = await Promise.race([upload, quandoAbortar(signal)]);
  if (error) return { ok: false, error: `Não foi possível enviar "${p.nome}": ${error.message}` };
  return { ok: true, anexo: { path: json.path, nome: p.nome, mime: p.mime, tamanho: p.tamanho } };
}

type RawMsg = Pick<ChatMensagemRow, "id" | "role" | "conteudo" | "anexos" | "created_at">;

function isUserOrAssistant(role: RawMsg["role"]): role is "user" | "assistant" {
  return role === "user" || role === "assistant";
}

/** chat_mensagens.anexos → chips. Ignora null e formatos antigos (métricas de antes da 0020). */
function lerAnexosExibicao(json: Json | null): AnexoMeta[] | undefined {
  if (!Array.isArray(json)) return undefined;
  const lista: AnexoMeta[] = [];
  for (const item of json) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const { path, nome, mime, tamanho } = item;
    if (typeof path === "string" && typeof nome === "string" && typeof mime === "string" && typeof tamanho === "number") {
      lista.push({ path, nome, mime, tamanho });
    }
  }
  return lista.length ? lista : undefined;
}

function rowToDisplay(row: RawMsg): DisplayMessage {
  // role="system" não tem renderização — chamadores devem filtrar antes.
  return {
    id: row.id,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.conteudo,
    created_at: row.created_at,
    anexos: lerAnexosExibicao(row.anexos),
  };
}

function IconeAnexo({ mime }: { mime: string }) {
  return mime === "application/pdf"
    ? <FileText size={12} className="shrink-0" />
    : <ImageIcon size={12} className="shrink-0" />;
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
  const [pendentes, setPendentes] = useState<AnexoPendente[]>([]);
  const [enviandoAnexos, setEnviandoAnexos] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  // Engrenagem (chaves de API e treinamento): Super Admin ou Edição em Assistentes.
  const { podeEditar } = useModulo("assistentes");
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef  = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      .select("id, role, conteudo, anexos, created_at")
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
    const aEnviar = pendentes;
    if ((!text && !aEnviar.length) || loading || !agenteAtivo) return;

    const tempId = genTempId();
    const nowIso = new Date().toISOString();
    setMessages((prev) => [
      ...prev,
      {
        id: tempId, role: "user", content: text || TEXTO_PADRAO_ANEXO, created_at: nowIso, pendente: true,
        anexos: aEnviar.length
          ? aEnviar.map((p) => ({ path: p.id, nome: p.nome, mime: p.mime, tamanho: p.tamanho }))
          : undefined,
      },
    ]);
    setLoading(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      // 1) Anexos sobem direto para o Storage; o que já subiu numa tentativa
      //    anterior (que falhou depois) é reaproveitado.
      const anexos: AnexoMeta[] = [];
      if (aEnviar.length) setEnviandoAnexos(true);
      for (const p of aEnviar) {
        if (p.enviado) { anexos.push(p.enviado); continue; }
        const up = await subirAnexo(p, ctrl.signal);
        if (!up.ok) {
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          toast.error("Não foi possível enviar o anexo", up.error);
          return;
        }
        anexos.push(up.anexo);
        setPendentes((prev) => prev.map((x) => (x.id === p.id ? { ...x, enviado: up.anexo } : x)));
      }
      setEnviandoAnexos(false);

      // 2) Mensagem + metadados dos anexos para o assistente.
      timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetch("/api/assistentes/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agente_id: agentId,
          content: text,
          session_id: sessionId ?? undefined,
          anexos: anexos.length ? anexos : undefined,
        }),
        signal: ctrl.signal,
      });

      const json = await lerJson<APIResponseOk | APIResponseError>(res);

      if (!res.ok || !json || "error" in json) {
        const errMsg = json && "error" in json
          ? json.error
          : res.status === 504
            ? "O assistente demorou demais para responder. Tente novamente."
            : `HTTP ${res.status}`;
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        toast.error("Não foi possível enviar", errMsg);
        return;
      }

      const ok = json;
      setSessionId(ok.session_id);
      setInput("");                      // só limpa o textarea depois da resposta
      setPendentes([]);
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
      setEnviandoAnexos(false);
      setLoading(false);
    }
  }

  function handleCancelar() {
    abortRef.current?.abort();
  }

  // --------- Anexos (clipe, colar, arrastar) --------------------------------
  const podeAnexar = !loading && agenteAtivo && !historicoCarregando;

  function adicionarArquivos(arquivos: File[], colados = false) {
    if (!arquivos.length || !podeAnexar) return;
    const novos: AnexoPendente[] = [];
    const erros: string[] = [];
    let total = pendentes.reduce((s, p) => s + p.tamanho, 0);
    for (const file of arquivos) {
      if (pendentes.length + novos.length >= MAX_ANEXOS) {
        erros.push(`No máximo ${MAX_ANEXOS} arquivos por mensagem.`);
        break;
      }
      const mime = mimeDoArquivo(file);
      if (!mime) { erros.push(`"${file.name || "arquivo"}" não é PDF, PNG, JPG ou WEBP.`); continue; }
      if (file.size === 0) { erros.push(`"${file.name}" está vazio.`); continue; }
      if (file.size > MAX_ANEXO_BYTES) { erros.push(`"${file.name}" tem mais de 10 MB.`); continue; }
      if (total + file.size > MAX_ANEXOS_TOTAL_BYTES) {
        erros.push(`Os anexos de uma mensagem somam no máximo 12 MB ("${file.name}" ficou de fora).`);
        continue;
      }
      total += file.size;
      novos.push({ id: genTempId(), file, nome: nomeDoArquivo(file, mime, colados), mime, tamanho: file.size });
    }
    if (novos.length) setPendentes((prev) => [...prev, ...novos]);
    if (erros.length) toast.error("Arquivo não anexado", erros.join(" "));
  }

  function removerPendente(id: string) {
    setPendentes((prev) => prev.filter((p) => p.id !== id));
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const arquivos = Array.from(e.clipboardData.files);
    if (!arquivos.length) return;
    // Copiar células do Excel também traz uma imagem: havendo texto, cola o texto.
    if (e.clipboardData.getData("text/plain").trim()) return;
    e.preventDefault();
    adicionarArquivos(arquivos, true);
  }

  function arrastaArquivos(e: React.DragEvent) {
    return Array.from(e.dataTransfer.types).includes("Files");
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!arrastaArquivos(e)) return;
    e.preventDefault();               // sem isso o navegador abre o arquivo e sai do chat
    e.dataTransfer.dropEffect = podeAnexar ? "copy" : "none";
    if (podeAnexar && !arrastando) setArrastando(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    // Só ao sair do card (não ao passar sobre os elementos de dentro).
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setArrastando(false);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    if (!arrastaArquivos(e)) return;
    e.preventDefault();
    setArrastando(false);
    adicionarArquivos(Array.from(e.dataTransfer.files));
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

      {/* Messages — o card inteiro aceita arquivos arrastados */}
      <div
        className="relative flex-1 flex flex-col min-h-0"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {arrastando && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-accent-400 bg-white/90 text-sm font-medium text-stone-700">
            <Paperclip size={16} /> Solte aqui para anexar (PDF ou imagem)
          </div>
        )}
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
                    {msg.anexos && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {msg.anexos.map((a) => {
                          const chip = `inline-flex items-center gap-1.5 max-w-full min-w-0 rounded-lg px-2 py-1 text-xs ${
                            msg.role === "user" ? "bg-white/15 text-white" : "bg-white text-stone-700 border border-stone-200"
                          }`;
                          // Enquanto envia não há caminho no Storage ainda: chip sem link.
                          return msg.pendente ? (
                            <span key={a.path} className={chip} title={a.nome}>
                              <IconeAnexo mime={a.mime} />
                              <span className="truncate">{a.nome}</span>
                            </span>
                          ) : (
                            <a
                              key={a.path}
                              href={`/api/assistentes/anexos?path=${encodeURIComponent(a.path)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`${chip} hover:underline`}
                              title={`Abrir ${a.nome}`}
                            >
                              <IconeAnexo mime={a.mime} />
                              <span className="truncate">{a.nome}</span>
                            </a>
                          );
                        })}
                      </div>
                    )}
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
                  {enviandoAnexos && <span className="text-[11px] text-stone-500">enviando anexo(s)…</span>}
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
            {pendentes.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {pendentes.map((p) => (
                  <span
                    key={p.id}
                    className="inline-flex items-center gap-1.5 max-w-65 min-w-0 rounded-lg border border-stone-200 bg-stone-50 pl-2 pr-1 py-1 text-xs text-stone-700"
                  >
                    <IconeAnexo mime={p.mime} />
                    <span className="truncate" title={p.nome}>{p.nome}</span>
                    <span className="shrink-0 text-stone-400">{formatTamanho(p.tamanho)}</span>
                    <button
                      type="button"
                      onClick={() => removerPendente(p.id)}
                      disabled={loading}
                      className="shrink-0 p-0.5 rounded text-stone-400 hover:text-red-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
                      title="Remover anexo"
                      aria-label={`Remover ${p.nome}`}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                hidden
                multiple
                accept={ACCEPT_ANEXOS}
                onChange={(e) => {
                  adicionarArquivos(Array.from(e.target.files ?? []));
                  e.target.value = "";             // permite escolher o mesmo arquivo de novo
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!podeAnexar || pendentes.length >= MAX_ANEXOS}
                className="shrink-0 h-10 w-10 flex items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-500 hover:text-accent-500 hover:border-accent-500 transition disabled:opacity-40 disabled:cursor-not-allowed"
                title={`Anexar PDF ou imagem (até ${MAX_ANEXOS} por mensagem, 10 MB cada)`}
                aria-label="Anexar arquivo"
              >
                <Paperclip size={14} />
              </button>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
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
                disabled={(!input.trim() && !pendentes.length) || loading || historicoCarregando || !agenteAtivo}
                size="sm"
                className="shrink-0 h-10 px-4"
              >
                <Send size={14} />
              </Button>
            </div>
            <p className="text-[10px] text-stone-400 mt-1.5 text-center">
              Pressione Enter para enviar · Shift+Enter para nova linha · Anexe PDF ou imagem pelo clipe, colando ou arrastando (até {MAX_ANEXOS}, 10 MB cada)
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
