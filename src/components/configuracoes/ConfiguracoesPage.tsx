"use client";
import { useEffect, useState } from "react";
import { ListTree, Palette, ShieldAlert, Users, Zap } from "lucide-react";
import { obterRoleAtual } from "@/lib/queries/configuracoes";
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
  const [role, setRole] = useState<string | null>(null);
  const [roleCarregado, setRoleCarregado] = useState(false);

  useEffect(() => {
    obterRoleAtual()
      .then((r) => setRole(r))
      .catch(() => setRole(null))
      .finally(() => setRoleCarregado(true));
  }, []);

  const canEdit = role === "admin";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#0f1f1c]">Configurações</h1>
        <p className="text-sm text-stone-500">
          Gerencie o plano de contas, os status dos lançamentos, suas cores e os colaboradores do portal. Alterações valem para todo o sistema.
        </p>
      </div>

      {roleCarregado && !canEdit && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <ShieldAlert size={18} className="shrink-0 mt-0.5" />
          <span>
            Você está vendo em modo leitura. Apenas usuários <b>administradores</b> podem criar, editar ou excluir.
            {role ? ` (sua função atual: ${role})` : ""}
          </span>
        </div>
      )}

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
