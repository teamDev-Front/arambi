"use client";
// Configurações → Colaboradores (Portal do Colaborador).
// Caminho principal: admin PRÉ-CADASTRA (nome + CPF) — o funcionário só digita
// o CPF no portal e entra. Solicitações do portal aparecem aqui para aprovar.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, UserCheck, UserX, X, RotateCcw, Pencil } from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/utils/format";
import {
  listarColaboradores, criarColaborador, atualizarColaborador,
  aprovarColaborador, desativarColaborador, reativarColaborador,
  recusarSolicitacao, formatarCpf, cpfValido, normalizarCpf,
} from "@/lib/queries/colaboradores";
import type { ColaboradorRow, ColaboradorStatus } from "@/types";
import { COLABORADOR_STATUS_LABEL } from "@/types";

const STATUS_VARIANT: Record<ColaboradorStatus, BadgeVariant> = {
  ativo: "success", pendente: "warning", desativado: "neutral",
};

function maskCpf(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
}

export function ColaboradoresTab({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [colaboradores, setColaboradores] = useState<ColaboradorRow[]>([]);
  const [novoModal, setNovoModal] = useState(false);
  const [editando, setEditando] = useState<ColaboradorRow | null>(null);
  const [confirmDesativar, setConfirmDesativar] = useState<ColaboradorRow | null>(null);
  const [busy, setBusy] = useState(false);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      setColaboradores(await listarColaboradores());
    } catch (e) {
      toast.error("Erro ao carregar colaboradores", e instanceof Error ? e.message : "Aplique a migration 0041 no SQL Editor.");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetch_(); }, [fetch_]);

  const pendentes = useMemo(() => colaboradores.filter((c) => c.status === "pendente"), [colaboradores]);

  async function acao(fn: () => Promise<void>, msg: string) {
    try {
      await fn();
      toast.success(msg);
      fetch_();
    } catch (e) {
      toast.error("Erro", e instanceof Error ? e.message : undefined);
    }
  }

  const colunas: Column<ColaboradorRow>[] = [
    { key: "nome", header: "Nome", sortable: true, render: (c) => <span className="font-medium text-stone-800">{c.nome}</span> },
    { key: "cpf", header: "CPF", render: (c) => <span className="tabular-nums">{formatarCpf(c.cpf)}</span> },
    {
      key: "status", header: "Status", align: "center",
      render: (c) => <Badge variant={STATUS_VARIANT[c.status]}>{COLABORADOR_STATUS_LABEL[c.status]}</Badge>,
    },
    { key: "created_at", header: "Cadastro", align: "center", render: (c) => formatDate(c.created_at) },
    {
      key: "acoes", header: "Ações", align: "right",
      render: (c) => canEdit ? (
        <span className="inline-flex gap-1">
          {c.status === "pendente" && (
            <>
              <button title="Aprovar acesso" onClick={() => acao(() => aprovarColaborador(c.id), `${c.nome} aprovado(a)`)} className="p-1.5 rounded hover:bg-emerald-50 text-stone-500 hover:text-emerald-600"><UserCheck size={15} /></button>
              <button title="Recusar solicitação" onClick={() => acao(() => recusarSolicitacao(c.id), "Solicitação recusada")} className="p-1.5 rounded hover:bg-red-50 text-stone-500 hover:text-red-600"><X size={15} /></button>
            </>
          )}
          {c.status === "ativo" && (
            <>
              <button title="Editar nome" onClick={() => setEditando(c)} className="p-1.5 rounded hover:bg-stone-100 text-stone-500"><Pencil size={14} /></button>
              <button title="Desativar acesso" onClick={() => setConfirmDesativar(c)} className="p-1.5 rounded hover:bg-red-50 text-stone-500 hover:text-red-600"><UserX size={15} /></button>
            </>
          )}
          {c.status === "desativado" && (
            <button title="Reativar" onClick={() => acao(() => reativarColaborador(c.id), `${c.nome} reativado(a)`)} className="p-1.5 rounded hover:bg-stone-100 text-stone-500"><RotateCcw size={14} /></button>
          )}
        </span>
      ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-stone-500 max-w-xl leading-relaxed">
          Cadastre nome + CPF e o colaborador já entra no portal (<code className="text-xs bg-stone-100 px-1.5 py-0.5 rounded">/colaborador</code>) digitando o CPF —
          sem senha, como combinado. <b>Desativar não apaga o histórico</b> de talões e abastecimentos.
        </p>
        {canEdit && (
          <Button size="sm" onClick={() => setNovoModal(true)}>
            <Plus size={14} /> Novo Colaborador
          </Button>
        )}
      </div>

      {pendentes.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <b>{pendentes.length} solicitação(ões) de acesso</b> aguardando aprovação — vieram do portal.
        </div>
      )}

      <DataTable columns={colunas} data={colaboradores} loading={loading} emptyMessage="Nenhum colaborador cadastrado. Cadastre o primeiro para liberar o portal." />

      {(novoModal || editando) && (
        <ColaboradorModal
          editando={editando}
          onClose={() => { setNovoModal(false); setEditando(null); }}
          onSaved={() => { setNovoModal(false); setEditando(null); fetch_(); }}
        />
      )}

      <ConfirmDialog
        open={!!confirmDesativar}
        title={`Desativar ${confirmDesativar?.nome}?`}
        description="O acesso ao portal é bloqueado imediatamente, mas TODO o histórico de talões e abastecimentos fica preservado. Dá para reativar depois."
        tone="warning"
        confirmText="Desativar"
        busy={busy}
        onConfirm={async () => {
          if (!confirmDesativar) return;
          setBusy(true);
          try {
            await desativarColaborador(confirmDesativar.id);
            toast.success(`${confirmDesativar.nome} desativado(a) — histórico preservado`);
            setConfirmDesativar(null);
            fetch_();
          } catch (e) {
            toast.error("Erro ao desativar", e instanceof Error ? e.message : undefined);
          } finally {
            setBusy(false);
          }
        }}
        onCancel={() => setConfirmDesativar(null)}
      />
    </div>
  );
}

function ColaboradorModal({ editando, onClose, onSaved }: {
  editando: ColaboradorRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [nome, setNome] = useState(editando?.nome ?? "");
  const [cpf, setCpf] = useState(editando ? formatarCpf(editando.cpf) : "");

  async function salvar() {
    if (nome.trim().length < 3) { toast.warning("Informe o nome completo."); return; }
    if (!editando) {
      if (!cpfValido(normalizarCpf(cpf))) { toast.warning("CPF inválido — confira os dígitos."); return; }
    }
    setBusy(true);
    try {
      if (editando) {
        await atualizarColaborador(editando.id, { nome });
        toast.success("Colaborador atualizado");
      } else {
        await criarColaborador(nome, cpf);
        toast.success("Colaborador cadastrado", "Ele já pode entrar no portal com o CPF.");
      }
      onSaved();
    } catch (e) {
      toast.error("Erro ao salvar", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={editando ? `Editar ${editando.nome}` : "Novo Colaborador"} size="md" closeOnBackdrop={false}>
      <div className="p-6 space-y-4">
        <Input label="Nome completo *" placeholder="João da Silva" value={nome} onChange={(e) => setNome(e.target.value)} />
        <Input
          label="CPF *"
          placeholder="000.000.000-00"
          inputMode="numeric"
          value={cpf}
          disabled={!!editando}
          onChange={(e) => setCpf(maskCpf(e.target.value))}
        />
        {editando && <p className="text-xs text-stone-400">O CPF não pode ser alterado (é a identificação no portal).</p>}
      </div>
      <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-2 bg-stone-50/50">
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button onClick={salvar} loading={busy}>{editando ? "Salvar" : "Cadastrar"}</Button>
      </div>
    </Modal>
  );
}
