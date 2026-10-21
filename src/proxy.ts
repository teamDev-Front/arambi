import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { carregarAcesso } from "@/lib/acessos/carregar";
import { verificarRota } from "@/lib/acessos/permissoes";

// 1ª camada das guardas de acesso (0058): toda URL do /dashboard pertence a
// um módulo (src/lib/acessos/modulos.ts). Sem o módulo → tela "Sem acesso";
// rota fora do catálogo → só Super Admin; usuário bloqueado → desconectado.
// As páginas repetem a checagem no servidor (exigirModulo) e as APIs têm a
// própria (o matcher abaixo não passa por /api).
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

  // Redireciona sem perder os cookies que o getUser/signOut acabaram de gravar.
  const redirecionar = (destino: string) => {
    const res = NextResponse.redirect(new URL(destino, request.url));
    supabaseResponse.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  };

  const isAuthRoute = pathname.startsWith("/login");
  const isDashRoute = pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  // Primeiro acesso / senha provisória (0059).
  const isDefinirSenha = pathname === "/definir-senha";

  if (!user && isDashRoute) {
    const next = pathname === "/dashboard" ? "" : `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
    return redirecionar(`/login${next}`);
  }
  if (!user && isDefinirSenha) {
    return redirecionar("/login");
  }
  if (user && isAuthRoute) {
    return redirecionar("/dashboard");
  }

  if (user && (isDashRoute || isDefinirSenha)) {
    let acesso;
    try {
      acesso = await carregarAcesso(supabase, user.id);
    } catch (e) {
      // Instabilidade do banco: não desconecta ninguém; a página (exigirModulo)
      // repete a checagem e, se falhar de novo, mostra erro sem renderizar dados.
      console.error("[proxy]", (e as Error).message);
      return supabaseResponse;
    }
    if (isDefinirSenha) {
      // Só faz sentido com senha provisória; quem já tem a própria segue para o sistema.
      if (acesso?.ativo && !acesso.trocarSenha) return redirecionar("/dashboard");
      if (acesso?.ativo) return supabaseResponse;
    }
    const veredito = verificarRota(acesso, isDefinirSenha ? "/dashboard" : pathname);
    if (!veredito.ok) {
      if (veredito.motivo === "bloqueado") {
        await supabase.auth.signOut({ scope: "local" });
        return redirecionar("/login?motivo=bloqueado");
      }
      if (veredito.motivo === "trocar_senha") return redirecionar("/definir-senha");
      return redirecionar(veredito.destino);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
