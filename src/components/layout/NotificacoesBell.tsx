"use client";
// Sininho do Header — antes decorativo, agora mostra a Central de Alertas
// (vacinações, manutenções, documentos, discrepâncias) computada por query.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CheckCircle2 } from "lucide-react";
import { listarAlertas, type AlertaItem } from "@/lib/queries/agro";
import { formatDate } from "@/lib/utils/format";
import { usePermissoes } from "@/components/acessos/PermissoesProvider";
import { classificarRota } from "@/lib/acessos/modulos";

export function NotificacoesBell() {
  const [open, setOpen] = useState(false);
  const [todos, setAlertas] = useState<AlertaItem[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const { podeVer } = usePermissoes();

  // Só alertas de módulos que a pessoa vê (tela Acessos).
  const alertas = useMemo(() => todos.filter((a) => {
    const rota = classificarRota(a.href);
    return rota.tipo !== "modulo" || podeVer(rota.modulo);
  }), [todos, podeVer]);

  useEffect(() => {
    listarAlertas().then(setAlertas).catch(() => setAlertas([]));
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const criticos = alertas.filter((a) => a.severidade === "critico").length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-lg hover:bg-stone-100 text-stone-500 transition"
        title="Alertas"
      >
        <Bell size={18} />
        {alertas.length > 0 && (
          <span className={`absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full text-[9px] font-bold text-white flex items-center justify-center ${
            criticos > 0 ? "bg-red-500" : "bg-amber-500"
          }`}>
            {alertas.length > 9 ? "9+" : alertas.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 bg-white border border-stone-200 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-stone-100 flex items-center justify-between">
            <p className="text-xs font-semibold text-stone-700">Alertas</p>
            <span className="text-[10px] text-stone-400">{alertas.length} pendente(s)</span>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {alertas.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 py-8">
                <CheckCircle2 size={22} className="text-emerald-400" />
                <p className="text-xs text-stone-500">Tudo em dia!</p>
              </div>
            ) : (
              alertas.slice(0, 12).map((a) => (
                <Link
                  key={a.id}
                  href={a.href}
                  onClick={() => setOpen(false)}
                  className="flex items-start gap-2 px-4 py-2.5 hover:bg-stone-50 border-b border-stone-50 last:border-0"
                >
                  <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                    a.severidade === "critico" ? "bg-red-500" : a.severidade === "atencao" ? "bg-amber-500" : "bg-sky-500"
                  }`} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs text-stone-800 truncate">{a.titulo}</span>
                    <span className="block text-[10px] text-stone-400">
                      {a.detalhe}{a.data ? ` · ${formatDate(a.data)}` : ""}
                    </span>
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
