"use client";
// Página pública onde a pessoa convidada (ou que pediu "Esqueci minha senha")
// cria a senha. Aceita os três formatos de link do Supabase:
//   ?token_hash=...&type=invite|recovery → link copiado na tela Acessos ou
//       template de e-mail personalizado. O token só é usado no CLIQUE em
//       "Continuar" — o preview do WhatsApp/antivírus de e-mail não queima o link;
//   #access_token=...&refresh_token=...   → template padrão do Supabase;
//   ?code=...                              → fluxo PKCE (mesmo navegador).

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { Leaf, Eye, EyeOff, CheckCircle2, AlertTriangle, Loader2, Check } from "lucide-react";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils/cn";

type Tipo = "invite" | "recovery";
type Etapa =
  | { fase: "carregando" }
  | { fase: "confirmar"; tokenHash: string; tipo: Tipo }
  | { fase: "senha"; email: string; tipo: Tipo }
  | { fase: "concluido" }
  | { fase: "erro"; mensagem: string };

const MSG_LINK_INVALIDO =
  "Este link expirou ou já foi usado. Peça ao administrador um novo convite (ou use \"Esqueceu sua senha?\" na tela de login).";

function criarClient() {
  // Client próprio, sem detectar a sessão na URL sozinho: esta página trata
  // cada formato de link explicitamente (o automático do PKCE recusa o
  // formato com #access_token do template padrão).
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { isSingleton: false, auth: { detectSessionInUrl: false } },
  );
}

function traduzirErro(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("expired") || m.includes("invalid") || m.includes("otp")) return MSG_LINK_INVALIDO;
  if (m.includes("different from the old")) return "A nova senha precisa ser diferente da anterior.";
  if (m.includes("at least")) return "A senha precisa ter pelo menos 8 caracteres.";
  if (m.includes("weak") || m.includes("pwned") || m.includes("leaked")) {
    return "Essa senha é fraca ou já apareceu em vazamentos. Escolha outra.";
  }
  if (m.includes("reauthentication")) return "Por segurança, entre de novo pelo link do e-mail e tente outra vez.";
  return msg;
}

function lerTipo(v: string | null | undefined): Tipo {
  return v === "recovery" ? "recovery" : "invite";
}

const REGRAS = [
  { id: "tamanho", label: "Pelo menos 8 caracteres", ok: (s: string) => s.length >= 8 },
  { id: "letra", label: "Uma letra", ok: (s: string) => /[a-zA-Z]/.test(s) },
  { id: "numero", label: "Um número", ok: (s: string) => /\d/.test(s) },
];

export default function DefinirSenhaPage() {
  const [supabase] = useState(criarClient);
  const [etapa, setEtapa] = useState<Etapa>({ fase: "carregando" });

  useEffect(() => {
    let cancelado = false;

    async function iniciar() {
      const url = new URL(window.location.href);
      const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
      const q = url.searchParams;
      let tipo = lerTipo(q.get("type") ?? hash.get("type"));
      let proxima: Etapa | null = null;

      if (hash.get("error") || q.get("error")) {
        proxima = { fase: "erro", mensagem: MSG_LINK_INVALIDO };
      } else if (q.get("token_hash")) {
        proxima = { fase: "confirmar", tokenHash: q.get("token_hash")!, tipo };
      } else if (hash.get("access_token") && hash.get("refresh_token")) {
        const { error } = await supabase.auth.setSession({
          access_token: hash.get("access_token")!,
          refresh_token: hash.get("refresh_token")!,
        });
        if (error) proxima = { fase: "erro", mensagem: traduzirErro(error.message) };
      } else if (q.get("code")) {
        const { error } = await supabase.auth.exchangeCodeForSession(q.get("code")!);
        if (error) proxima = { fase: "erro", mensagem: MSG_LINK_INVALIDO };
        else tipo = "recovery";
      }

      if (!proxima) {
        const { data: { user } } = await supabase.auth.getUser();
        proxima = user?.email
          ? { fase: "senha", email: user.email, tipo }
          : { fase: "erro", mensagem: "Abra esta página pelo link do convite ou do e-mail de redefinição de senha." };
      }
      // Tira os tokens da barra de endereço (não ficam no histórico).
      if (url.hash || q.get("code")) window.history.replaceState(null, "", url.pathname);
      if (!cancelado) setEtapa(proxima);
    }

    void iniciar();
    return () => { cancelado = true; };
  }, [supabase]);

  async function confirmarLink(tokenHash: string, tipo: Tipo) {
    setEtapa({ fase: "carregando" });
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: tipo });
    window.history.replaceState(null, "", window.location.pathname);
    if (error || !data.user?.email) {
      setEtapa({ fase: "erro", mensagem: traduzirErro(error?.message ?? "invalid") });
      return;
    }
    setEtapa({ fase: "senha", email: data.user.email, tipo });
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ backgroundImage: "url('/bg-login.png')", backgroundSize: "cover", backgroundPosition: "center" }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-[#1a2e1b]/80 via-[#2c3e2d]/60 to-[#0e1f0f]/85" />
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{ backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)", backgroundSize: "28px 28px" }}
      />

      <div className="relative z-10 w-full max-w-[420px] mx-4">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-[#a67c20] flex items-center justify-center shadow-lg shadow-black/30 mb-3">
            <Leaf size={26} className="text-white" />
          </div>
          <span className="text-3xl font-bold text-white tracking-tight">AramBI</span>
          <span className="text-sm text-white/50 mt-0.5">Gestão Agro</span>
        </div>

        <div
          className="rounded-3xl p-8 shadow-2xl"
          style={{
            background: "rgba(255,255,255,0.92)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.6)",
          }}
        >
          {etapa.fase === "carregando" && (
            <div className="flex flex-col items-center gap-3 py-8 text-sm text-stone-500">
              <Loader2 size={22} className="animate-spin text-[#a67c20]" />
              Validando o link...
            </div>
          )}

          {etapa.fase === "confirmar" && (
            <div>
              <h2 className="text-xl font-bold text-stone-800 mb-1">
                {etapa.tipo === "invite" ? "Você foi convidado(a)" : "Redefinir senha"}
              </h2>
              <p className="text-sm text-stone-500 mb-6">
                {etapa.tipo === "invite"
                  ? "Seu acesso ao AramBI está pronto. Continue para criar a sua senha."
                  : "Continue para escolher uma nova senha."}
              </p>
              <BotaoDourado onClick={() => void confirmarLink(etapa.tokenHash, etapa.tipo)}>
                Continuar
              </BotaoDourado>
            </div>
          )}

          {etapa.fase === "senha" && (
            <FormSenha
              supabase={supabase}
              email={etapa.email}
              tipo={etapa.tipo}
              onConcluido={() => setEtapa({ fase: "concluido" })}
            />
          )}

          {etapa.fase === "concluido" && (
            <div className="flex flex-col items-center text-center gap-3 py-4">
              <CheckCircle2 size={40} className="text-emerald-600" />
              <h2 className="text-lg font-bold text-stone-800">Senha definida!</h2>
              <p className="text-sm text-stone-500">Entrando no sistema...</p>
            </div>
          )}

          {etapa.fase === "erro" && (
            <div className="flex flex-col items-center text-center gap-3">
              <span className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center">
                <AlertTriangle size={22} className="text-amber-600" />
              </span>
              <h2 className="text-lg font-bold text-stone-800">Não foi possível continuar</h2>
              <p className="text-sm text-stone-600 leading-relaxed">{etapa.mensagem}</p>
              <a href="/login" className="mt-2 text-sm font-medium text-[#a67c20] hover:underline">
                Ir para o login
              </a>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-white/30 mt-6">
          AramBI © 2024 · Gestão para o Agronegócio
        </p>
      </div>
    </div>
  );
}

function FormSenha({ supabase, email, tipo, onConcluido }: {
  supabase: ReturnType<typeof criarClient>;
  email: string;
  tipo: Tipo;
  onConcluido: () => void;
}) {
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const regrasOk = REGRAS.every((r) => r.ok(senha));
  const confere = senha.length > 0 && senha === confirmacao;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!regrasOk) { setErro("A senha ainda não atende aos requisitos."); return; }
    if (!confere) { setErro("As senhas não conferem."); return; }
    setSalvando(true);
    setErro(null);
    const { data, error } = await supabase.auth.updateUser({ password: senha });
    if (error) {
      setErro(traduzirErro(error.message));
      setSalvando(false);
      return;
    }
    // Convite aceito (status na tela Acessos) + auditoria. Falha aqui não
    // desfaz a senha — só não marca.
    await supabase.rpc("fn_marcar_senha_definida" as never);
    if (data.user) {
      const { data: perfil } = await supabase.from("users").select("full_name").eq("id", data.user.id).maybeSingle();
      await supabase.from("logs").insert({
        tipo: "auth",
        acao: tipo === "invite" ? "CONVITE_ACEITO" : "SENHA_REDEFINIDA",
        descricao: tipo === "invite" ? "Aceitou o convite e criou a senha" : "Redefiniu a senha pelo link do e-mail",
        usuario_id: data.user.id,
        usuario_nome: perfil?.full_name ?? email,
      });
    }
    onConcluido();
    // Navegação completa: o servidor precisa ver os cookies da sessão nova.
    window.location.assign("/dashboard");
  }

  const inputCls =
    "h-11 w-full rounded-xl border border-stone-200 bg-stone-50 px-4 pr-11 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#c49830] focus:border-transparent transition";

  return (
    <form onSubmit={salvar} className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-bold text-stone-800 mb-1">
          {tipo === "invite" ? "Crie sua senha" : "Defina uma nova senha"}
        </h2>
        <p className="text-sm text-stone-500">
          Conta: <span className="font-medium text-stone-700">{email}</span>
        </p>
      </div>

      {erro && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{erro}</div>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-stone-700" htmlFor="nova-senha">Nova senha</label>
        <div className="relative">
          <input
            id="nova-senha"
            type={mostrar ? "text" : "password"}
            autoComplete="new-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            className={inputCls}
            autoFocus
          />
          <button
            type="button"
            onClick={() => setMostrar(!mostrar)}
            className="absolute right-3 inset-y-0 flex items-center text-stone-400 hover:text-stone-600"
            aria-label={mostrar ? "Ocultar senha" : "Mostrar senha"}
          >
            {mostrar ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <ul className="mt-1 grid grid-cols-3 gap-1">
          {REGRAS.map((r) => (
            <li
              key={r.id}
              className={cn(
                "flex items-center gap-1 text-[11px]",
                r.ok(senha) ? "text-emerald-700" : "text-stone-400",
              )}
            >
              <Check size={11} className={r.ok(senha) ? "opacity-100" : "opacity-30"} /> {r.label}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-stone-700" htmlFor="confirmar-senha">Confirmar senha</label>
        <input
          id="confirmar-senha"
          type={mostrar ? "text" : "password"}
          autoComplete="new-password"
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
          className={inputCls}
        />
        {confirmacao.length > 0 && !confere && (
          <p className="text-xs text-red-600">As senhas não conferem.</p>
        )}
      </div>

      <BotaoDourado type="submit" disabled={salvando || !regrasOk || !confere} loading={salvando}>
        {salvando ? "Salvando..." : tipo === "invite" ? "Criar senha e entrar" : "Salvar nova senha"}
      </BotaoDourado>
    </form>
  );
}

function BotaoDourado({ children, loading, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className="h-12 w-full rounded-xl font-semibold text-sm transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-md active:scale-[0.98] text-white"
      style={{
        background: "linear-gradient(135deg, #d4a832 0%, #b8861e 50%, #a67c20 100%)",
        boxShadow: "0 4px 16px rgba(196,152,48,0.45)",
      }}
    >
      {loading && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  );
}
