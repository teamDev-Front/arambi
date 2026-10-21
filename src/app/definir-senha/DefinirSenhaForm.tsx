"use client";
// Formulário do primeiro acesso: troca a senha provisória pela própria.

import { useState } from "react";
import { Leaf, Eye, EyeOff, CheckCircle2, Loader2, Check, LogOut } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { REGRAS_SENHA, senhaValida } from "@/lib/acessos/senha";

export function DefinirSenhaForm({ nome, email, primeiroAcesso }: {
  nome: string;
  email: string;
  primeiroAcesso: boolean;
}) {
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [concluido, setConcluido] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const confere = senha.length > 0 && senha === confirmacao;
  const primeiroNome = nome.split(" ")[0];

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!senhaValida(senha)) { setErro("A senha ainda não atende aos requisitos."); return; }
    if (!confere) { setErro("As senhas não conferem."); return; }
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch("/api/auth/definir-senha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senha }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Não foi possível salvar a senha.");
      setConcluido(true);
      // Navegação completa: o servidor relê o perfil já sem a senha provisória.
      window.location.assign("/dashboard");
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível salvar a senha.");
      setSalvando(false);
    }
  }

  const inputCls =
    "h-11 w-full rounded-xl border border-stone-200 bg-stone-50 px-4 pr-11 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#c49830] focus:border-transparent transition";

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
          {concluido ? (
            <div className="flex flex-col items-center text-center gap-3 py-4">
              <CheckCircle2 size={40} className="text-emerald-600" />
              <h2 className="text-lg font-bold text-stone-800">Senha criada!</h2>
              <p className="text-sm text-stone-500">Entrando no sistema...</p>
            </div>
          ) : (
            <form onSubmit={salvar} className="flex flex-col gap-4">
              <div>
                <h2 className="text-xl font-bold text-stone-800 mb-1">
                  {primeiroAcesso ? `Bem-vindo(a), ${primeiroNome}!` : "Crie uma nova senha"}
                </h2>
                <p className="text-sm text-stone-500 leading-relaxed">
                  {primeiroAcesso
                    ? "Este é o seu primeiro acesso. Crie a sua própria senha — a provisória deixa de valer."
                    : "Você entrou com uma senha provisória. Crie a sua própria para continuar."}
                </p>
                <p className="mt-2 text-xs text-stone-400">Conta: <span className="font-medium text-stone-600">{email}</span></p>
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
                  {REGRAS_SENHA.map((r) => (
                    <li key={r.id} className={cn("flex items-center gap-1 text-[11px]", r.ok(senha) ? "text-emerald-700" : "text-stone-400")}>
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

              <button
                type="submit"
                disabled={salvando || !senhaValida(senha) || !confere}
                className="h-12 w-full rounded-xl font-semibold text-sm transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-md active:scale-[0.98] text-white"
                style={{
                  background: "linear-gradient(135deg, #d4a832 0%, #b8861e 50%, #a67c20 100%)",
                  boxShadow: "0 4px 16px rgba(196,152,48,0.45)",
                }}
              >
                {salvando && <Loader2 size={16} className="animate-spin" />}
                {salvando ? "Salvando..." : "Criar senha e entrar"}
              </button>
            </form>
          )}
        </div>

        <form action="/auth/logout" method="POST" className="mt-5 flex justify-center">
          <button type="submit" className="inline-flex items-center gap-1.5 text-xs text-white/60 hover:text-white">
            <LogOut size={12} /> Não é você? Sair
          </button>
        </form>
      </div>
    </div>
  );
}
