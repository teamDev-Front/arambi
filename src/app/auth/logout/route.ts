import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    // Auditoria (Logs do Sistema). O RLS da 0058 aceita insert de usuário ativo.
    const { data: perfil } = await supabase.from("users").select("full_name").eq("id", user.id).maybeSingle();
    await supabase.from("logs").insert({
      tipo: "auth",
      acao: "LOGOUT",
      descricao: "Saiu do sistema",
      usuario_id: user.id,
      usuario_nome: perfil?.full_name ?? user.email ?? null,
    });
  }
  await supabase.auth.signOut();
  redirect("/login");
}
