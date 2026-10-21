"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Leaf, Eye, EyeOff, ShieldAlert, Clock, ArrowLeft, Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { REGRAS_SENHA, senhaValida } from "@/lib/acessos/senha";

interface LoginFormProps {
  /** ?motivo= vindo das guardas (bloqueado | sessao). */
  motivo?: string | null;
  /** Página que a pessoa tentou abrir antes do login (já validada). */
  next?: string | null;
}

const MOTIVOS: Record<string, string> = {
  bloqueado: "Seu acesso está bloqueado. Fale com o administrador do sistema.",
  sessao: "Sua sessão terminou. Entre novamente.",
};

type Modo = "entrar" | "pedir" | "pedido-enviado";

export function LoginForm({ motivo, next }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>("entrar");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setError(/banned/i.test(authError.message)
        ? MOTIVOS.bloqueado
        : "E-mail ou senha inválidos. Tente novamente.");
      setLoading(false);
      return;
    }

    // Auditoria do login. (Bloqueado: o RLS recusa o insert e o proxy desconecta a seguir.)
    const { data: perfil } = await supabase.from("users").select("full_name").eq("id", data.user.id).maybeSingle();
    await supabase.from("logs").insert({
      tipo: "auth",
      acao: "LOGIN",
      descricao: "Entrou no sistema",
      usuario_id: data.user.id,
      usuario_nome: perfil?.full_name ?? data.user.email ?? null,
      user_agent: navigator.userAgent.slice(0, 300),
    });

    // Com senha provisória, o proxy leva para /definir-senha.
    router.push(next ?? "/dashboard");
    router.refresh();
  }

  async function handlePedido(e: React.FormEvent) {
    e.preventDefault();
    if (!senhaValida(novaSenha)) { setError("A nova senha ainda não atende aos requisitos."); return; }
    if (novaSenha !== confirmacao) { setError("As senhas não conferem."); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/solicitar-senha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, senha: novaSenha }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Não foi possível enviar o pedido agora.");
      }
      setNovaSenha("");
      setConfirmacao("");
      setModo("pedido-enviado");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar o pedido agora.");
    } finally {
      setLoading(false);
    }
  }

  function trocarModo(m: Modo) {
    setModo(m);
    setError(null);
    setShowPw(false);
  }

  const inputCls =
    "h-11 w-full rounded-xl border border-stone-200 bg-stone-50 px-4 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#c49830] focus:border-transparent transition";

  const olho = (
    <button
      type="button"
      onClick={() => setShowPw(!showPw)}
      className="absolute right-3 inset-y-0 flex items-center text-stone-400 hover:text-stone-600"
      aria-label={showPw ? "Ocultar senha" : "Mostrar senha"}
    >
      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
    </button>
  );

  return (
    <div
      className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{
        backgroundImage: "url('/bg-login.png')",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* Multi-layer overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#1a2e1b]/80 via-[#2c3e2d]/60 to-[#0e1f0f]/85" />
      {/* Subtle texture dots */}
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "radial-gradient(circle, #fff 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      {/* Card */}
      <div className="relative z-10 w-full max-w-[400px] mx-4">
        {/* Logo above card */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-[#a67c20] flex items-center justify-center shadow-lg shadow-black/30 mb-3">
            <Leaf size={26} className="text-white" />
          </div>
          <span className="text-3xl font-bold text-white tracking-tight">AramBI</span>
          <span className="text-sm text-white/50 mt-0.5">Gestão Agro</span>
        </div>

        {/* Glass card */}
        <div
          className="rounded-3xl p-8 shadow-2xl"
          style={{
            background: "rgba(255,255,255,0.92)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.6)",
          }}
        >
          {modo === "pedido-enviado" ? (
            <div className="flex flex-col items-center text-center gap-3">
              <span className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center">
                <Clock size={22} className="text-amber-600" />
              </span>
              <h2 className="text-lg font-bold text-stone-800">Pedido enviado</h2>
              <p className="text-sm text-stone-600 leading-relaxed">
                Assim que o administrador aprovar, você já pode entrar com a <b>nova senha</b>.
                Se tiver pressa, avise o administrador.
              </p>
              <button
                type="button"
                onClick={() => trocarModo("entrar")}
                className="mt-2 text-sm font-medium text-[#a67c20] hover:underline"
              >
                Voltar para o login
              </button>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-bold text-stone-800 mb-1">
                {modo === "entrar" ? "Bem-vindo de volta" : "Esqueceu sua senha?"}
              </h2>
              <p className="text-sm text-stone-500 mb-6">
                {modo === "entrar"
                  ? "Acesse o painel de gestão"
                  : "Escolha uma nova senha. Ela passa a valer quando o administrador aprovar o pedido."}
              </p>

              {modo === "entrar" && motivo && MOTIVOS[motivo] && !error && (
                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 flex items-start gap-2">
                  <ShieldAlert size={16} className="shrink-0 mt-0.5" />
                  {MOTIVOS[motivo]}
                </div>
              )}

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                  {error}
                </div>
              )}

              <form onSubmit={modo === "entrar" ? handleLogin : handlePedido} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-stone-700">E-mail</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="seu@email.com"
                    className={inputCls}
                  />
                </div>

                {modo === "entrar" ? (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-medium text-stone-700">Senha</label>
                      <div className="relative">
                        <input
                          type={showPw ? "text" : "password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          autoComplete="current-password"
                          placeholder="••••••••"
                          className={`${inputCls} pr-11`}
                        />
                        {olho}
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => trocarModo("pedir")}
                        className="text-xs text-[#a67c20] hover:underline"
                      >
                        Esqueceu sua senha?
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-medium text-stone-700">Nova senha</label>
                      <div className="relative">
                        <input
                          type={showPw ? "text" : "password"}
                          value={novaSenha}
                          onChange={(e) => setNovaSenha(e.target.value)}
                          required
                          autoComplete="new-password"
                          className={`${inputCls} pr-11`}
                        />
                        {olho}
                      </div>
                      <ul className="mt-1 grid grid-cols-3 gap-1">
                        {REGRAS_SENHA.map((r) => (
                          <li key={r.id} className={cn("flex items-center gap-1 text-[11px]", r.ok(novaSenha) ? "text-emerald-700" : "text-stone-400")}>
                            <Check size={11} className={r.ok(novaSenha) ? "opacity-100" : "opacity-30"} /> {r.label}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-medium text-stone-700">Confirmar nova senha</label>
                      <input
                        type={showPw ? "text" : "password"}
                        value={confirmacao}
                        onChange={(e) => setConfirmacao(e.target.value)}
                        required
                        autoComplete="new-password"
                        className={inputCls}
                      />
                      {confirmacao.length > 0 && confirmacao !== novaSenha && (
                        <p className="text-xs text-red-600">As senhas não conferem.</p>
                      )}
                    </div>
                  </>
                )}

                {/* Golden button */}
                <button
                  type="submit"
                  disabled={loading}
                  className="h-12 w-full rounded-xl font-semibold text-sm transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-md active:scale-[0.98]"
                  style={{
                    background: loading
                      ? "#c49830"
                      : "linear-gradient(135deg, #d4a832 0%, #b8861e 50%, #a67c20 100%)",
                    color: "#fff",
                    boxShadow: "0 4px 16px rgba(196,152,48,0.45)",
                  }}
                >
                  {loading && (
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {modo === "entrar"
                    ? (loading ? "Entrando..." : "Entrar")
                    : (loading ? "Enviando..." : "Enviar pedido ao administrador")}
                </button>

                {modo === "pedir" && (
                  <button
                    type="button"
                    onClick={() => trocarModo("entrar")}
                    className="inline-flex items-center justify-center gap-1.5 text-xs text-stone-500 hover:text-[#a67c20]"
                  >
                    <ArrowLeft size={12} /> Voltar para o login
                  </button>
                )}
              </form>
            </>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-white/30 mt-6">
          AramBI © 2024 · Gestão para o Agronegócio
        </p>
      </div>
    </div>
  );
}
