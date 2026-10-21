"use client";
// Faixa "Modo leitura" no topo de qualquer módulo que o usuário só consulta.
// Fica no layout do dashboard: nenhuma tela precisa se lembrar dela.

import { usePathname } from "next/navigation";
import { Eye } from "lucide-react";
import { MODULO_POR_KEY, classificarRota } from "@/lib/acessos/modulos";
import { useModulo } from "@/components/acessos/PermissoesProvider";

export function ModoLeituraBanner() {
  const pathname = usePathname();
  const rota = classificarRota(pathname);
  const modulo = rota.tipo === "modulo" ? rota.modulo : "home";
  const { somenteLeitura } = useModulo(modulo);
  if (rota.tipo !== "modulo" || !somenteLeitura) return null;

  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl border border-sky-200 bg-sky-50/80 px-4 py-2.5 text-sm text-sky-900">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
        <Eye size={15} />
      </span>
      <span>
        <b>Modo leitura</b> em {MODULO_POR_KEY[modulo].label} — você pode consultar, filtrar e exportar, mas não alterar dados.
      </span>
    </div>
  );
}
