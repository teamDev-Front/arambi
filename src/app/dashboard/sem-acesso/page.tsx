import Link from "next/link";
import { Lock, ArrowRight } from "lucide-react";
import { exigirUsuarioAtivo } from "@/lib/acessos/servidor";
import { MODULOS, MODULO_POR_KEY, type ModuloKey } from "@/lib/acessos/modulos";
import { ehSuperAdmin, podeEditar, podeVer, rotaInicial } from "@/lib/acessos/permissoes";

export const metadata = { title: "Sem acesso – AramBI" };

interface Props {
  searchParams: Promise<{ modulo?: string }>;
}

export default async function Page({ searchParams }: Props) {
  const acesso = await exigirUsuarioAtivo();
  const { modulo } = await searchParams;
  const alvo = modulo && modulo in MODULO_POR_KEY ? MODULO_POR_KEY[modulo as ModuloKey] : null;
  const liberados = MODULOS.filter((m) => podeVer(acesso, m.key));
  const inicio = rotaInicial(acesso);

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="w-full max-w-lg rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-accent-600">
          <Lock size={26} />
        </div>
        <h1 className="text-center text-lg font-bold text-[#0f1f1c]">
          {alvo ? `Você não tem acesso a ${alvo.label}` : "Você não tem acesso a esta página"}
        </h1>
        <p className="mt-2 text-center text-sm leading-relaxed text-stone-500">
          {alvo?.exclusivoSuperAdmin
            ? "Esta área é exclusiva do Super Admin."
            : "Se precisar dela, peça ao administrador para liberar o módulo na tela Acessos."}
        </p>

        {liberados.length > 0 ? (
          <>
            <p className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
              Seus módulos
            </p>
            <div className="flex flex-wrap gap-2">
              {liberados.map((m) => (
                <Link
                  key={m.key}
                  href={m.href}
                  className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-medium text-stone-700 transition hover:border-accent-300 hover:bg-accent-50 hover:text-accent-700"
                >
                  {m.label}
                  {!ehSuperAdmin(acesso) && !podeEditar(acesso, m.key) && (
                    <span className="text-[10px] font-normal text-stone-400">· leitura</span>
                  )}
                </Link>
              ))}
            </div>
            <div className="mt-6 flex justify-center">
              <Link
                href={inicio}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#a67c20] px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#836016]"
              >
                Ir para {MODULOS.find((m) => m.href === inicio)?.label ?? "o início"} <ArrowRight size={14} />
              </Link>
            </div>
          </>
        ) : (
          <p className="mt-6 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-center text-sm text-stone-600">
            Seu usuário ainda não tem nenhum módulo liberado.
          </p>
        )}
      </div>
    </div>
  );
}
