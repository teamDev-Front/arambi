"use client";
// Meu Perfil (/dashboard/perfil): dados da pessoa, o que ela pode acessar e
// troca de senha. Só nome é editável aqui — cargo, setor e permissões são
// definidos pelo Super Admin na tela Acessos.

import { useMemo, useState } from "react";
import Link from "next/link";
import { Crown, PencilLine, Eye, KeyRound, Save, Check, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import { GRUPOS_MODULO, MODULOS, MODULOS_EXCLUSIVOS } from "@/lib/acessos/modulos";
import { NIVEL_GERAL_LABEL } from "@/lib/acessos/permissoes";
import { usePermissoes } from "@/components/acessos/PermissoesProvider";

const REGRAS = [
  { label: "8+ caracteres", ok: (s: string) => s.length >= 8 },
  { label: "uma letra", ok: (s: string) => /[a-zA-Z]/.test(s) },
  { label: "um número", ok: (s: string) => /\d/.test(s) },
];

export function MeuPerfilPage() {
  const toast = useToast();
  const router = useRouter();
  const { acesso, superAdmin, nivel, podeVer, podeEditar } = usePermissoes();

  const [nome, setNome] = useState(acesso?.nome ?? "");
  const [salvandoNome, setSalvandoNome] = useState(false);
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [salvandoSenha, setSalvandoSenha] = useState(false);

  const liberados = useMemo(() => MODULOS.filter((m) => !m.exclusivoSuperAdmin && podeVer(m.key)), [podeVer]);
  const senhaOk = REGRAS.every((r) => r.ok(senha)) && senha === confirmacao;

  if (!acesso) return null;

  async function salvarNome() {
    if (!acesso || nome.trim().length < 3) { toast.warning("Informe o nome completo."); return; }
    setSalvandoNome(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("users").update({ full_name: nome.trim() }).eq("id", acesso.id);
      if (error) throw error;
      toast.success("Nome atualizado");
      router.refresh();
    } catch (e) {
      toast.error("Não foi possível salvar", e instanceof Error ? e.message : undefined);
    } finally {
      setSalvandoNome(false);
    }
  }

  async function trocarSenha(e: React.FormEvent) {
    e.preventDefault();
    if (!senhaOk) return;
    setSalvandoSenha(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: senha });
      if (error) {
        const m = error.message.toLowerCase();
        throw new Error(
          m.includes("different from the old") ? "A nova senha precisa ser diferente da atual."
          : m.includes("reauthentication") ? "Por segurança, saia e entre de novo antes de trocar a senha."
          : m.includes("weak") || m.includes("pwned") ? "Essa senha é fraca ou já apareceu em vazamentos. Escolha outra."
          : error.message,
        );
      }
      setSenha("");
      setConfirmacao("");
      toast.success("Senha alterada", "Use a nova senha no próximo login.");
    } catch (err) {
      toast.error("Não foi possível trocar a senha", err instanceof Error ? err.message : undefined);
    } finally {
      setSalvandoSenha(false);
    }
  }

  const NivelIcon = superAdmin ? Crown : nivel === "edicao" ? PencilLine : Eye;

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold text-[#0f1f1c]">Meu Perfil</h1>
        <p className="text-sm text-stone-500">Seus dados, o que você pode acessar no AramBI e a sua senha.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Identificação */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><User size={15} /> Dados pessoais</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Nome completo" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} />
              <Input label="E-mail (login)" value={acesso.email} disabled />
              <Input label="Cargo" value={acesso.cargo ?? "—"} disabled />
              <Input label="Setor" value={acesso.setor ?? "—"} disabled />
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-stone-400">Cargo, setor e permissões são definidos pelo administrador.</p>
              <Button size="sm" onClick={salvarNome} loading={salvandoNome} disabled={nome.trim() === acesso.nome}>
                <Save size={14} /> Salvar nome
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Senha */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRound size={15} /> Trocar senha</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={trocarSenha} className="space-y-3">
              <Input label="Nova senha" type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
              <Input
                label="Confirmar nova senha"
                type="password"
                autoComplete="new-password"
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
                error={confirmacao && senha !== confirmacao ? "As senhas não conferem." : undefined}
              />
              <ul className="flex flex-wrap gap-x-3 gap-y-1">
                {REGRAS.map((r) => (
                  <li key={r.label} className={cn("flex items-center gap-1 text-[11px]", r.ok(senha) ? "text-emerald-700" : "text-stone-400")}>
                    <Check size={11} className={r.ok(senha) ? "" : "opacity-30"} /> {r.label}
                  </li>
                ))}
              </ul>
              <Button type="submit" size="sm" className="w-full" loading={salvandoSenha} disabled={!senhaOk}>
                Alterar senha
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Acessos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <NivelIcon size={15} /> Seu acesso: {NIVEL_GERAL_LABEL[nivel]}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {superAdmin ? (
            <p className="text-sm text-stone-600">
              Você é <b>Super Admin</b>: vê e altera todos os módulos, inclusive{" "}
              {MODULOS_EXCLUSIVOS.map((m, i) => (
                <span key={m.key}>{i > 0 && " e "}<Link href={m.href} className="text-accent-700 hover:underline">{m.label}</Link></span>
              ))}.
            </p>
          ) : liberados.length === 0 ? (
            <p className="text-sm text-stone-600">Nenhum módulo liberado ainda. Fale com o administrador.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {GRUPOS_MODULO.map((g) => {
                const mods = liberados.filter((m) => m.grupo === g.id);
                if (mods.length === 0) return null;
                return (
                  <div key={g.id}>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400">{g.label}</p>
                    <ul className="space-y-1">
                      {mods.map((m) => {
                        const edita = podeEditar(m.key);
                        return (
                          <li key={m.key}>
                            <Link
                              href={m.href}
                              className="flex items-center justify-between gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-700 transition hover:border-accent-300 hover:bg-accent-50/40"
                            >
                              {m.label}
                              <span className={cn(
                                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                                edita ? "bg-emerald-50 text-emerald-800" : "bg-sky-50 text-sky-800",
                              )}>
                                {edita ? <PencilLine size={10} /> : <Eye size={10} />}
                                {edita ? "Edição" : "Leitura"}
                              </span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
