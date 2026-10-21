"use client";
import { useState } from "react";
import { ListTree, Palette, Users, Zap } from "lucide-react";
import { usePermissoes } from "@/components/acessos/PermissoesProvider";
import { PlanoContasTab } from "./PlanoContasTab";
import { StatusCoresTab } from "./StatusCoresTab";
import { ColaboradoresTab } from "./ColaboradoresTab";
import { AutomacoesTab } from "./AutomacoesTab";

type Aba = "plano" | "status" | "colaboradores" | "automacoes";

const ABAS: { id: Aba; label: string; icon: typeof ListTree }[] = [
  { id: "plano", label: "Plano de Contas", icon: ListTree },
  { id: "status", label: "Status & Cores", icon: Palette },
  { id: "colaboradores", label: "Colaboradores", icon: Users },
  { id: "automacoes", label: "Automações", icon: Zap },
];

export function ConfiguracoesPage() {
  const [aba, setAba] = useState<Aba>("plano");
  // Tela exclusiva do Super Admin (a página barra os demais no servidor).
  const { superAdmin: canEdit } = usePermissoes();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#0f1f1c]">Configurações</h1>
        <p className="text-sm text-stone-500">
          Gerencie o plano de contas, os status dos lançamentos, suas cores e os colaboradores do portal. Alterações valem para todo o sistema.
        </p>
      </div>

      {/* Abas */}
      <div className="flex gap-1 border-b border-stone-200">
        {ABAS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setAba(id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              aba === id
                ? "border-accent-500 text-accent-700"
                : "border-transparent text-stone-500 hover:text-stone-700"
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {aba === "plano" && <PlanoContasTab canEdit={canEdit} />}
      {aba === "status" && <StatusCoresTab canEdit={canEdit} />}
      {aba === "colaboradores" && <ColaboradoresTab canEdit={canEdit} />}
      {aba === "automacoes" && <AutomacoesTab canEdit={canEdit} />}
    </div>
  );
}
