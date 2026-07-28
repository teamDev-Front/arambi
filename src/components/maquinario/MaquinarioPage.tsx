"use client";
// Maquinário & Veículos — status operacional SEM valores financeiros
// (decisão do call de 14/jul/2026). Manutenções e documentação com alertas.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Tractor, Plus, Pencil, Trash2, Wrench, FileBadge, Search,
  CheckCircle2, CircleSlash, AlertTriangle, ClipboardList,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Tabs } from "@/components/ui/Tabs";
import { isoLocalHoje } from "@/components/ui/CalendarioMes";
import { useToast } from "@/components/ui/Toast";
import { UnsavedChangesDialog } from "@/components/ui/UnsavedChangesDialog";
import { useUnsavedGuard } from "@/lib/hooks/useUnsavedGuard";
import { formatDate } from "@/lib/utils/format";
import { obterRoleAtual } from "@/lib/queries/configuracoes";
import {
  listarEquipamentos, criarEquipamento, atualizarEquipamento, excluirEquipamento,
  listarManutencoes, criarManutencao, atualizarManutencao, excluirManutencao,
  listarDocumentosEq, criarDocumentoEq, excluirDocumentoEq,
  type EquipamentoFormPayload, type ManutencaoFormPayload,
} from "@/lib/queries/maquinario";
import type {
  EquipamentoRow, EquipamentoManutencaoRow, EquipamentoDocumentoRow,
  EquipamentoTipo, EquipamentoStatus, MedidorTipo, CombustivelTipo,
} from "@/types";
import {
  EQUIPAMENTO_TIPO_LABEL, EQUIPAMENTO_STATUS_LABEL, MEDIDOR_TIPO_LABEL, COMBUSTIVEL_TIPO_LABEL,
} from "@/types";

type Aba = "equipamentos" | "manutencoes" | "documentacao";

const STATUS_VARIANT: Record<EquipamentoStatus, BadgeVariant> = {
  em_operacao: "success", parado: "danger", em_manutencao: "warning", estragou: "danger",
};

function formatMedidor(eq: EquipamentoRow): string {
  if (eq.medidor_tipo === "nenhum" || eq.medidor_atual == null) return "—";
  const valor = Number(eq.medidor_atual).toLocaleString("pt-BR");
  return eq.medidor_tipo === "horimetro" ? `${valor} h` : `${valor} km`;
}

export function MaquinarioPage() {
  const toast = useToast();
  const [aba, setAba] = useState<Aba>("equipamentos");
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);

  const [equipamentos, setEquipamentos] = useState<EquipamentoRow[]>([]);
  const [manutencoes, setManutencoes] = useState<EquipamentoManutencaoRow[]>([]);
  const [documentos, setDocumentos] = useState<EquipamentoDocumentoRow[]>([]);

  // Filtros
  const [fTipo, setFTipo] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [busca, setBusca] = useState("");

  // Modais
  const [eqModal, setEqModal] = useState<{ open: boolean; editando: EquipamentoRow | null }>({ open: false, editando: null });
  const [manutModal, setManutModal] = useState<{ open: boolean; editando: EquipamentoManutencaoRow | null; equipamentoId?: string }>({ open: false, editando: null });
  const [docModal, setDocModal] = useState<{ open: boolean; equipamentoId?: string }>({ open: false });
  const [confirmExcluir, setConfirmExcluir] = useState<{ tipo: "equipamento" | "manutencao" | "documento"; id: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const hoje = isoLocalHoje();

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [eqs, mans, docs] = await Promise.all([
        listarEquipamentos(), listarManutencoes(), listarDocumentosEq(),
      ]);
      setEquipamentos(eqs);
      setManutencoes(mans);
      setDocumentos(docs);
    } catch (e) {
      toast.error("Erro ao carregar maquinário", e instanceof Error ? e.message : "Aplique a migration 0039 no SQL Editor.");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchAll();
    obterRoleAtual().then((r) => setCanEdit(r === "admin" || r === "editor")).catch(() => {});
  }, [fetchAll]);

  // --------------------------------------------------------------------------
  // Derivados
  // --------------------------------------------------------------------------
  const eqById = useMemo(() => new Map(equipamentos.map((e) => [e.id, e])), [equipamentos]);
  const ativos = useMemo(() => equipamentos.filter((e) => e.ativo), [equipamentos]);

  const contagem = useMemo(() => {
    const c = { total: ativos.length, em_operacao: 0, parado: 0, em_manutencao: 0, estragou: 0 };
    for (const eq of ativos) c[eq.status]++;
    return c;
  }, [ativos]);

  /** Próxima manutenção pendente por equipamento. */
  const proximaManutPorEq = useMemo(() => {
    const map = new Map<string, EquipamentoManutencaoRow>();
    for (const m of manutencoes) {
      if (m.realizada_em) continue;
      const atual = map.get(m.equipamento_id);
      const dataM = m.data_prevista ?? "9999-12-31";
      const dataA = atual?.data_prevista ?? "9999-12-31";
      if (!atual || dataM < dataA) map.set(m.equipamento_id, m);
    }
    return map;
  }, [manutencoes]);

  const equipamentosFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return equipamentos.filter((eq) => {
      if (fTipo && eq.tipo !== fTipo) return false;
      if (fStatus && eq.status !== fStatus) return false;
      if (q) {
        const alvo = `${eq.codigo} ${eq.nome} ${eq.marca_modelo ?? ""} ${eq.localizacao ?? ""}`.toLowerCase();
        if (!alvo.includes(q)) return false;
      }
      return true;
    });
  }, [equipamentos, fTipo, fStatus, busca]);

  const manutPendentes = useMemo(() => manutencoes.filter((m) => !m.realizada_em), [manutencoes]);
  const manutRealizadas = useMemo(() => manutencoes.filter((m) => m.realizada_em), [manutencoes]);

  // --------------------------------------------------------------------------
  // Ações
  // --------------------------------------------------------------------------
  async function handleExcluir() {
    if (!confirmExcluir) return;
    setBusy(true);
    try {
      if (confirmExcluir.tipo === "equipamento") await excluirEquipamento(confirmExcluir.id);
      else if (confirmExcluir.tipo === "manutencao") await excluirManutencao(confirmExcluir.id);
      else await excluirDocumentoEq(confirmExcluir.id);
      toast.success("Excluído com sucesso");
      setConfirmExcluir(null);
      fetchAll();
    } catch (e) {
      toast.error("Erro ao excluir", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function marcarRealizada(m: EquipamentoManutencaoRow) {
    try {
      await atualizarManutencao(m.id, { realizada_em: hoje });
      toast.success("Manutenção marcada como realizada");
      fetchAll();
    } catch (e) {
      toast.error("Erro ao atualizar", e instanceof Error ? e.message : undefined);
    }
  }

  // --------------------------------------------------------------------------
  // Colunas
  // --------------------------------------------------------------------------
  const colunasEq: Column<EquipamentoRow>[] = [
    { key: "codigo", header: "Código", sortable: true, render: (eq) => <span className="font-medium text-stone-800">{eq.codigo}</span> },
    {
      key: "nome", header: "Equipamento",
      render: (eq) => (
        <span className={!eq.ativo ? "text-stone-400 line-through" : undefined}>
          {eq.nome}
          {!eq.ativo && <span className="ml-1 text-[10px] no-underline">(inativo)</span>}
        </span>
      ),
    },
    { key: "tipo", header: "Tipo", align: "center", render: (eq) => EQUIPAMENTO_TIPO_LABEL[eq.tipo] },
    { key: "marca_modelo", header: "Marca/Modelo", render: (eq) => eq.marca_modelo ?? "—" },
    { key: "ano", header: "Ano", align: "center", render: (eq) => eq.ano ?? "—" },
    { key: "medidor", header: "Horímetro/KM", align: "center", render: formatMedidor },
    {
      key: "status", header: "Status", align: "center",
      render: (eq) => <Badge variant={STATUS_VARIANT[eq.status]}>{EQUIPAMENTO_STATUS_LABEL[eq.status]}</Badge>,
    },
    { key: "localizacao", header: "Localização", render: (eq) => eq.localizacao ?? "—" },
    {
      key: "prox_manut", header: "Próx. Manutenção", align: "center",
      render: (eq) => {
        const m = proximaManutPorEq.get(eq.id);
        if (!m) return "—";
        const atrasada = m.data_prevista && m.data_prevista < hoje;
        return (
          <span className={atrasada ? "text-red-600 font-medium" : "text-stone-700"}>
            {m.data_prevista ? formatDate(m.data_prevista) : "—"}
            <span className="block text-[10px] text-stone-400">{m.descricao}</span>
          </span>
        );
      },
    },
    {
      key: "acoes", header: "Ações", align: "right",
      render: (eq) => canEdit ? (
        <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
          <button title="Agendar manutenção" onClick={() => setManutModal({ open: true, editando: null, equipamentoId: eq.id })} className="p-1.5 rounded hover:bg-stone-100 text-stone-500"><Wrench size={14} /></button>
          <button title="Adicionar documento" onClick={() => setDocModal({ open: true, equipamentoId: eq.id })} className="p-1.5 rounded hover:bg-stone-100 text-stone-500"><FileBadge size={14} /></button>
          <button title="Editar" onClick={() => setEqModal({ open: true, editando: eq })} className="p-1.5 rounded hover:bg-stone-100 text-stone-500"><Pencil size={14} /></button>
          <button title="Excluir" onClick={() => setConfirmExcluir({ tipo: "equipamento", id: eq.id, label: `${eq.codigo} ${eq.nome}` })} className="p-1.5 rounded hover:bg-red-50 text-stone-500 hover:text-red-600"><Trash2 size={14} /></button>
        </span>
      ) : null,
    },
  ];

  const colunasManut = (pendente: boolean): Column<EquipamentoManutencaoRow>[] => [
    { key: "equipamento_id", header: "Equipamento", render: (m) => { const eq = eqById.get(m.equipamento_id); return eq ? `${eq.codigo} — ${eq.nome}` : "—"; } },
    { key: "descricao", header: "Manutenção", render: (m) => <span className="font-medium text-stone-800">{m.descricao}</span> },
    {
      key: "data_prevista", header: "Prevista para", align: "center", sortable: true,
      render: (m) => {
        if (!m.data_prevista) return "—";
        if (!pendente) return formatDate(m.data_prevista);
        const dias = Math.round((new Date(m.data_prevista + "T00:00").getTime() - new Date(hoje + "T00:00").getTime()) / 86400000);
        return (
          <span className={dias < 0 ? "text-red-600 font-semibold" : dias <= 15 ? "text-amber-700 font-medium" : undefined}>
            {formatDate(m.data_prevista)}
            <span className="block text-[10px]">{dias < 0 ? `atrasada ${-dias}d` : dias === 0 ? "hoje" : `em ${dias}d`}</span>
          </span>
        );
      },
    },
    { key: "medidor_previsto", header: "No medidor", align: "center", render: (m) => (m.medidor_previsto != null ? Number(m.medidor_previsto).toLocaleString("pt-BR") : "—") },
    ...(pendente ? [] : [{ key: "realizada_em", header: "Realizada em", align: "center" as const, render: (m: EquipamentoManutencaoRow) => (m.realizada_em ? formatDate(m.realizada_em) : "—") }]),
    { key: "observacao", header: "Observação", render: (m) => <span className="text-stone-500 text-xs">{m.observacao ?? "—"}</span> },
    {
      key: "acoes", header: "Ações", align: "right",
      render: (m) => canEdit ? (
        <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
          {pendente && (
            <button title="Marcar como realizada" onClick={() => marcarRealizada(m)} className="p-1.5 rounded hover:bg-emerald-50 text-stone-500 hover:text-emerald-600"><CheckCircle2 size={14} /></button>
          )}
          <button title="Editar" onClick={() => setManutModal({ open: true, editando: m })} className="p-1.5 rounded hover:bg-stone-100 text-stone-500"><Pencil size={14} /></button>
          <button title="Excluir" onClick={() => setConfirmExcluir({ tipo: "manutencao", id: m.id, label: m.descricao })} className="p-1.5 rounded hover:bg-red-50 text-stone-500 hover:text-red-600"><Trash2 size={14} /></button>
        </span>
      ) : null,
    },
  ];

  const colunasDocs: Column<EquipamentoDocumentoRow>[] = [
    { key: "equipamento_id", header: "Equipamento", render: (d) => { const eq = eqById.get(d.equipamento_id); return eq ? `${eq.codigo} — ${eq.nome}` : "—"; } },
    { key: "tipo", header: "Documento", render: (d) => <span className="font-medium text-stone-800">{d.tipo}</span> },
    { key: "descricao", header: "Descrição", render: (d) => d.descricao ?? "—" },
    {
      key: "vencimento", header: "Vencimento", align: "center", sortable: true,
      render: (d) => {
        const dias = Math.round((new Date(d.vencimento + "T00:00").getTime() - new Date(hoje + "T00:00").getTime()) / 86400000);
        const variant: BadgeVariant = dias < 0 ? "danger" : dias <= 30 ? "warning" : "success";
        return (
          <span className="inline-flex flex-col items-center gap-0.5">
            {formatDate(d.vencimento)}
            <Badge variant={variant}>{dias < 0 ? `vencido há ${-dias}d` : dias === 0 ? "vence hoje" : `${dias}d`}</Badge>
          </span>
        );
      },
    },
    {
      key: "acoes", header: "Ações", align: "right",
      render: (d) => canEdit ? (
        <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
          <button title="Excluir" onClick={() => setConfirmExcluir({ tipo: "documento", id: d.id, label: d.tipo })} className="p-1.5 rounded hover:bg-red-50 text-stone-500 hover:text-red-600"><Trash2 size={14} /></button>
        </span>
      ) : null,
    },
  ];

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------
  const pct = (n: number) => (contagem.total > 0 ? `${((n / contagem.total) * 100).toFixed(1).replace(".", ",")}%` : "—");

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#f5ead6] text-[#a67c20] flex items-center justify-center">
            <Tractor size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#0f1f1c]">Maquinário & Veículos</h1>
            <p className="text-sm text-stone-500">Controle e manutenção da frota de máquinas, implementos e veículos.</p>
          </div>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setEqModal({ open: true, editando: null })}>
            <Plus size={14} /> Novo Equipamento
          </Button>
        )}
      </div>

      {/* Cards de status (SEM valor financeiro — decisão do call) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 flex items-center gap-3">
          <span className="w-9 h-9 rounded-lg bg-[#f5ead6] text-[#a67c20] flex items-center justify-center"><Tractor size={18} /></span>
          <div>
            <p className="text-lg font-bold text-stone-900 leading-tight">{contagem.total}</p>
            <p className="text-[11px] text-stone-500">Total de Equipamentos</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 flex items-center gap-3">
          <span className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center"><CheckCircle2 size={18} /></span>
          <div>
            <p className="text-lg font-bold text-stone-900 leading-tight">{contagem.em_operacao}</p>
            <p className="text-[11px] text-stone-500">Em Operação · {pct(contagem.em_operacao)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 flex items-center gap-3">
          <span className="w-9 h-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center"><Wrench size={18} /></span>
          <div>
            <p className="text-lg font-bold text-stone-900 leading-tight">{contagem.em_manutencao}</p>
            <p className="text-[11px] text-stone-500">Em Manutenção · {pct(contagem.em_manutencao)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 flex items-center gap-3">
          <span className="w-9 h-9 rounded-lg bg-red-50 text-red-600 flex items-center justify-center"><CircleSlash size={18} /></span>
          <div>
            <p className="text-lg font-bold text-stone-900 leading-tight">{contagem.parado + contagem.estragou}</p>
            <p className="text-[11px] text-stone-500">Parados / Estragados · {pct(contagem.parado + contagem.estragou)}</p>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-4">
          <div className="w-40">
            <Select label="Tipo" value={fTipo} onChange={(e) => setFTipo(e.target.value)}>
              <option value="">Todos</option>
              {(Object.keys(EQUIPAMENTO_TIPO_LABEL) as EquipamentoTipo[]).map((t) => (
                <option key={t} value={t}>{EQUIPAMENTO_TIPO_LABEL[t]}</option>
              ))}
            </Select>
          </div>
          <div className="w-44">
            <Select label="Status" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
              <option value="">Todos</option>
              {(Object.keys(EQUIPAMENTO_STATUS_LABEL) as EquipamentoStatus[]).map((s) => (
                <option key={s} value={s}>{EQUIPAMENTO_STATUS_LABEL[s]}</option>
              ))}
            </Select>
          </div>
          <div className="flex-1 min-w-52">
            <Input label="Buscar equipamento" placeholder="Nome, código, marca ou local..." icon={<Search size={14} />} value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          {(fTipo || fStatus || busca) && (
            <Button variant="ghost" size="sm" onClick={() => { setFTipo(""); setFStatus(""); setBusca(""); }}>
              Limpar
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Abas */}
      <Tabs<Aba>
        tabs={[
          { id: "equipamentos", label: "Lista de Equipamentos", icon: ClipboardList, count: equipamentosFiltrados.length },
          { id: "manutencoes", label: "Manutenções", icon: Wrench, count: manutPendentes.length },
          { id: "documentacao", label: "Documentação", icon: FileBadge, count: documentos.length },
        ]}
        active={aba}
        onChange={setAba}
      />

      {aba === "equipamentos" && (
        <DataTable columns={colunasEq} data={equipamentosFiltrados} loading={loading} emptyMessage="Nenhum equipamento cadastrado. Clique em “Novo Equipamento” para começar." />
      )}

      {aba === "manutencoes" && (
        <div className="space-y-5">
          {canEdit && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setManutModal({ open: true, editando: null })}>
                <Plus size={14} /> Agendar Manutenção
              </Button>
            </div>
          )}
          <div>
            <h3 className="text-sm font-semibold text-stone-700 mb-2 flex items-center gap-1.5">
              <AlertTriangle size={14} className="text-amber-500" /> Pendentes
            </h3>
            <DataTable columns={colunasManut(true)} data={manutPendentes} loading={loading} emptyMessage="Nenhuma manutenção pendente. 👌" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-stone-700 mb-2 flex items-center gap-1.5">
              <CheckCircle2 size={14} className="text-emerald-500" /> Realizadas
            </h3>
            <DataTable columns={colunasManut(false)} data={manutRealizadas} loading={loading} emptyMessage="Nenhuma manutenção realizada ainda." />
          </div>
        </div>
      )}

      {aba === "documentacao" && (
        <div className="space-y-3">
          {canEdit && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setDocModal({ open: true })}>
                <Plus size={14} /> Novo Documento
              </Button>
            </div>
          )}
          <DataTable columns={colunasDocs} data={documentos} loading={loading} emptyMessage="Nenhum documento cadastrado (licenciamento, seguro, IPVA...)." />
        </div>
      )}

      {/* Modais */}
      {eqModal.open && (
        <EquipamentoModal
          editando={eqModal.editando}
          onClose={() => setEqModal({ open: false, editando: null })}
          onSaved={() => { setEqModal({ open: false, editando: null }); fetchAll(); }}
        />
      )}
      {manutModal.open && (
        <ManutencaoModal
          editando={manutModal.editando}
          equipamentoIdInicial={manutModal.equipamentoId}
          equipamentos={ativos}
          onClose={() => setManutModal({ open: false, editando: null })}
          onSaved={() => { setManutModal({ open: false, editando: null }); fetchAll(); }}
        />
      )}
      {docModal.open && (
        <DocumentoModal
          equipamentoIdInicial={docModal.equipamentoId}
          equipamentos={ativos}
          onClose={() => setDocModal({ open: false })}
          onSaved={() => { setDocModal({ open: false }); fetchAll(); }}
        />
      )}
      <ConfirmDialog
        open={!!confirmExcluir}
        title={`Excluir ${confirmExcluir?.tipo === "equipamento" ? "equipamento" : confirmExcluir?.tipo === "manutencao" ? "manutenção" : "documento"}?`}
        description={`"${confirmExcluir?.label ?? ""}" será excluído permanentemente.${confirmExcluir?.tipo === "equipamento" ? " Manutenções e documentos dele também serão removidos." : ""}`}
        tone="danger"
        confirmText="Excluir"
        busy={busy}
        onConfirm={handleExcluir}
        onCancel={() => setConfirmExcluir(null)}
      />
    </div>
  );
}

// ============================================================================
// Modal — Equipamento
// ============================================================================
function EquipamentoModal({ editando, onClose, onSaved }: {
  editando: EquipamentoRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<EquipamentoFormPayload>({
    codigo: editando?.codigo ?? "",
    nome: editando?.nome ?? "",
    tipo: editando?.tipo ?? "trator",
    marca_modelo: editando?.marca_modelo ?? null,
    ano: editando?.ano ?? null,
    medidor_tipo: editando?.medidor_tipo ?? "horimetro",
    medidor_atual: editando?.medidor_atual != null ? Number(editando.medidor_atual) : null,
    status: editando?.status ?? "em_operacao",
    localizacao: editando?.localizacao ?? null,
    combustivel: editando?.combustivel ?? "diesel",
    observacoes: editando?.observacoes ?? null,
    ativo: editando?.ativo ?? true,
  });
  const guard = useUnsavedGuard(true, form, onClose);

  async function salvar() {
    if (!form.codigo.trim()) { toast.warning("Informe o código."); return; }
    if (!form.nome.trim()) { toast.warning("Informe o nome do equipamento."); return; }
    setBusy(true);
    try {
      if (editando) await atualizarEquipamento(editando.id, form);
      else await criarEquipamento(form);
      toast.success(editando ? "Equipamento atualizado" : "Equipamento criado");
      onSaved();
    } catch (e) {
      toast.error("Erro ao salvar", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={guard.requestClose} title={editando ? `Editar ${editando.codigo}` : "Novo Equipamento"} size="lg" closeOnBackdrop={false}>
      <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input label="Código *" placeholder="TR-001" value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} />
        <Input label="Nome *" placeholder="Trator CBT, Caminhonete S10..." value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
        <Select label="Tipo" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as EquipamentoTipo })}>
          {(Object.keys(EQUIPAMENTO_TIPO_LABEL) as EquipamentoTipo[]).map((t) => (
            <option key={t} value={t}>{EQUIPAMENTO_TIPO_LABEL[t]}</option>
          ))}
        </Select>
        <Input label="Marca/Modelo" placeholder="John Deere 7215" value={form.marca_modelo ?? ""} onChange={(e) => setForm({ ...form, marca_modelo: e.target.value || null })} />
        <Input label="Ano" type="number" min={1900} max={2100} value={form.ano ?? ""} onChange={(e) => setForm({ ...form, ano: e.target.value === "" ? null : Number(e.target.value) })} />
        <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as EquipamentoStatus })}>
          {(Object.keys(EQUIPAMENTO_STATUS_LABEL) as EquipamentoStatus[]).map((s) => (
            <option key={s} value={s}>{EQUIPAMENTO_STATUS_LABEL[s]}</option>
          ))}
        </Select>
        <Select label="Medidor" value={form.medidor_tipo} onChange={(e) => setForm({ ...form, medidor_tipo: e.target.value as MedidorTipo })}>
          {(Object.keys(MEDIDOR_TIPO_LABEL) as MedidorTipo[]).map((m) => (
            <option key={m} value={m}>{MEDIDOR_TIPO_LABEL[m]}</option>
          ))}
        </Select>
        <Input
          label={form.medidor_tipo === "km" ? "KM atual" : "Horímetro atual (h)"}
          type="number" min={0} step="0.1"
          disabled={form.medidor_tipo === "nenhum"}
          value={form.medidor_atual ?? ""}
          onChange={(e) => setForm({ ...form, medidor_atual: e.target.value === "" ? null : Number(e.target.value) })}
        />
        <Select label="Combustível" value={form.combustivel} onChange={(e) => setForm({ ...form, combustivel: e.target.value as CombustivelTipo })}>
          {(Object.keys(COMBUSTIVEL_TIPO_LABEL) as CombustivelTipo[]).map((c) => (
            <option key={c} value={c}>{COMBUSTIVEL_TIPO_LABEL[c]}</option>
          ))}
        </Select>
        <Input label="Localização" placeholder="Sede, Galpão 2, Oficina..." value={form.localizacao ?? ""} onChange={(e) => setForm({ ...form, localizacao: e.target.value || null })} />
        <div className="sm:col-span-2">
          <Textarea label="Observações" rows={3} placeholder="Está operando bem? Tem algum problema? Anotações gerais..." value={form.observacoes ?? ""} onChange={(e) => setForm({ ...form, observacoes: e.target.value || null })} />
        </div>
        {editando && (
          <label className="flex items-center gap-2 text-sm text-stone-700">
            <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} className="rounded border-stone-300" />
            Equipamento ativo (aparece no portal dos colaboradores)
          </label>
        )}
      </div>
      <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-2 bg-stone-50/50">
        <Button variant="ghost" onClick={guard.requestClose} disabled={busy}>Cancelar</Button>
        <Button onClick={salvar} loading={busy}>{editando ? "Salvar" : "Criar Equipamento"}</Button>
      </div>
      <UnsavedChangesDialog open={guard.confirmOpen} onStay={guard.stay} onDiscard={guard.discard} />
    </Modal>
  );
}

// ============================================================================
// Modal — Manutenção
// ============================================================================
function ManutencaoModal({ editando, equipamentoIdInicial, equipamentos, onClose, onSaved }: {
  editando: EquipamentoManutencaoRow | null;
  equipamentoIdInicial?: string;
  equipamentos: EquipamentoRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<ManutencaoFormPayload>({
    equipamento_id: editando?.equipamento_id ?? equipamentoIdInicial ?? (equipamentos[0]?.id ?? ""),
    descricao: editando?.descricao ?? "",
    data_prevista: editando?.data_prevista ?? null,
    medidor_previsto: editando?.medidor_previsto != null ? Number(editando.medidor_previsto) : null,
    realizada_em: editando?.realizada_em ?? null,
    observacao: editando?.observacao ?? null,
  });
  const guard = useUnsavedGuard(true, form, onClose);

  async function salvar() {
    if (!form.equipamento_id) { toast.warning("Selecione o equipamento."); return; }
    if (!form.descricao.trim()) { toast.warning("Descreva a manutenção."); return; }
    setBusy(true);
    try {
      if (editando) await atualizarManutencao(editando.id, form);
      else await criarManutencao(form);
      toast.success(editando ? "Manutenção atualizada" : "Manutenção agendada");
      onSaved();
    } catch (e) {
      toast.error("Erro ao salvar", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={guard.requestClose} title={editando ? "Editar Manutenção" : "Agendar Manutenção"} size="lg" closeOnBackdrop={false}>
      <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <Select label="Equipamento *" value={form.equipamento_id} onChange={(e) => setForm({ ...form, equipamento_id: e.target.value })}>
            {equipamentos.map((eq) => <option key={eq.id} value={eq.id}>{eq.codigo} — {eq.nome}</option>)}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Input label="Descrição *" placeholder="Troca de óleo, revisão dos 250h, bomba hidráulica..." value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
        </div>
        <Input label="Data prevista (gera alerta)" type="date" value={form.data_prevista ?? ""} onChange={(e) => setForm({ ...form, data_prevista: e.target.value || null })} />
        <Input label="Ou no medidor (h/km)" type="number" min={0} step="0.1" value={form.medidor_previsto ?? ""} onChange={(e) => setForm({ ...form, medidor_previsto: e.target.value === "" ? null : Number(e.target.value) })} />
        {editando && (
          <Input label="Realizada em (vazio = pendente)" type="date" value={form.realizada_em ?? ""} onChange={(e) => setForm({ ...form, realizada_em: e.target.value || null })} />
        )}
        <div className={editando ? "" : "sm:col-span-2"}>
          <Textarea label="Observação" rows={2} value={form.observacao ?? ""} onChange={(e) => setForm({ ...form, observacao: e.target.value || null })} />
        </div>
      </div>
      <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-2 bg-stone-50/50">
        <Button variant="ghost" onClick={guard.requestClose} disabled={busy}>Cancelar</Button>
        <Button onClick={salvar} loading={busy}>{editando ? "Salvar" : "Agendar"}</Button>
      </div>
      <UnsavedChangesDialog open={guard.confirmOpen} onStay={guard.stay} onDiscard={guard.discard} />
    </Modal>
  );
}

// ============================================================================
// Modal — Documento
// ============================================================================
function DocumentoModal({ equipamentoIdInicial, equipamentos, onClose, onSaved }: {
  equipamentoIdInicial?: string;
  equipamentos: EquipamentoRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    equipamento_id: equipamentoIdInicial ?? (equipamentos[0]?.id ?? ""),
    tipo: "Licenciamento",
    descricao: null as string | null,
    vencimento: "",
  });
  const guard = useUnsavedGuard(true, form, onClose);

  async function salvar() {
    if (!form.equipamento_id) { toast.warning("Selecione o equipamento."); return; }
    if (!form.tipo.trim()) { toast.warning("Informe o tipo do documento."); return; }
    if (!form.vencimento) { toast.warning("Informe o vencimento."); return; }
    setBusy(true);
    try {
      await criarDocumentoEq(form);
      toast.success("Documento cadastrado");
      onSaved();
    } catch (e) {
      toast.error("Erro ao salvar", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={guard.requestClose} title="Novo Documento" size="md" closeOnBackdrop={false}>
      <div className="p-6 space-y-4">
        <Select label="Equipamento *" value={form.equipamento_id} onChange={(e) => setForm({ ...form, equipamento_id: e.target.value })}>
          {equipamentos.map((eq) => <option key={eq.id} value={eq.id}>{eq.codigo} — {eq.nome}</option>)}
        </Select>
        <Input label="Tipo *" placeholder="Licenciamento, Seguro, IPVA..." value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} />
        <Input label="Descrição" placeholder="Licenciamento anual da caminhonete" value={form.descricao ?? ""} onChange={(e) => setForm({ ...form, descricao: e.target.value || null })} />
        <Input label="Vencimento *" type="date" value={form.vencimento} onChange={(e) => setForm({ ...form, vencimento: e.target.value })} />
      </div>
      <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-2 bg-stone-50/50">
        <Button variant="ghost" onClick={guard.requestClose} disabled={busy}>Cancelar</Button>
        <Button onClick={salvar} loading={busy}>Cadastrar</Button>
      </div>
      <UnsavedChangesDialog open={guard.confirmOpen} onStay={guard.stay} onDiscard={guard.discard} />
    </Modal>
  );
}
