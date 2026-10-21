import { redirect } from "next/navigation";
import { obterSessaoAcesso } from "@/lib/acessos/servidor";
import { DefinirSenhaForm } from "./DefinirSenhaForm";

export const metadata = { title: "Crie sua senha – AramBI" };

// Primeiro acesso / senha provisória (0059): a pessoa entrou com a senha que o
// Super Admin mandou e precisa criar a própria antes de ver qualquer tela.
export default async function Page() {
  const sessao = await obterSessaoAcesso();
  if (!sessao) redirect("/login");
  const { acesso, supabase, user } = sessao;
  if (!acesso?.ativo) redirect("/auth/sair?motivo=bloqueado");
  if (!acesso.trocarSenha) redirect("/dashboard");

  const { data } = await supabase.from("users").select("senha_definida_em").eq("id", user.id).maybeSingle();
  return <DefinirSenhaForm nome={acesso.nome} email={acesso.email} primeiroAcesso={!data?.senha_definida_em} />;
}
