"use client";
import { useCallback, useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Input, Select } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { UnsavedChangesDialog } from "@/components/ui/UnsavedChangesDialog";
import { useUnsavedGuard } from "@/lib/hooks/useUnsavedGuard";
import { Plus, Edit2, Eye, EyeOff, Loader2, AlertTriangle } from "lucide-react";
import {
  listarStatusConfig,
  atualizarStatusConfig,
  setAtivoStatus,
  adicionarStatus,
  slugStatus,
  type StatusKind,
} from "@/lib/queries/configuracoes";
import { reloadStatusConfig, useStatusConfig } from "@/lib/utils/status-config";
import type { StatusConfigRow } from "@/types";

const KIND_LABEL: Record<StatusKind, string> = { entrada: "Entrada", saida: "Saída", neutro: "Neutro" };

interface SForm {
  codigo: string;
  label: string;
  kind: StatusKind;
  cor_bg: string;
  cor_text: string;
  ordem: string;
  ativo: boolean;
}
const EMPTY: SForm = { codigo: "", label: "", kind: "neutro", cor_bg: "#6b7280", cor_text: "#ffffff", ordem: "", ativo: true };

function ChipPreview({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <span style={{ backgroundColor: bg, color: fg }} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap">
      {label || "Exemplo"}
    </span>
  );
}

export function StatusCoresTab({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const { entries: fallbackEntries } = useStatusConfig();
  const [rows, setRows] = useState<StatusConfigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tabelaAusente, setTabelaAusente] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editCodigo, setEditCodigo] = useState<string | null>(null);
  const [form, setForm] = useState<SForm>(EMPTY);
  const guard = useUnsavedGuard(modalOpen, form, () => setModalOpen(false));
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listarStatusConfig());
      setTabelaAusente(false);
    } catch {
      // Tabela ainda não existe (migration 0035 não aplicada).
      setTabelaAusente(true);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData(); }, [fetchData]);

  function openNew() {
    setEditCodigo(null);
    setForm({ ...EMPTY });
    setModalOpen(true);
  }
  function openEdit(r: StatusConfigRow) {
    setEditCodigo(r.codigo);
    setForm({ codigo: r.codigo, label: r.label, kind: r.kind, cor_bg: r.cor_bg, cor_text: r.cor_text, ordem: r.ordem == null ? "" : String(r.ordem), ativo: r.ativo });
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.label.trim()) { toast.error("Rótulo obrigatório", "Informe o nome exibível do status."); return; }
    const ordem = form.ordem.trim() === "" ? null : Number(form.ordem);
    if (ordem !== null && !Number.isFinite(ordem)) { toast.error("Ordem inválida", "Use um número ou deixe em branco."); return; }
    setSaving(true);
    try {
      if (editCodigo) {
        await atualizarStatusConfig(editCodigo, { label: form.label, kind: form.kind, cor_bg: form.cor_bg, cor_text: form.cor_text, ordem, ativo: form.ativo });
        toast.success("Status atualizado");
      } else {
        const codigo = slugStatus(form.codigo.trim() || form.label);
        if (!/^[a-z][a-z0-9_]*$/.test(codigo)) {
          toast.error("Código inválido", "O código precisa começar com letra e conter só minúsculas, números e _.");
          setSaving(false);
          return;
        }
        await adicionarStatus({ codigo, label: form.label, kind: form.kind, cor_bg: form.cor_bg, cor_text: form.cor_text, ordem });
        toast.success("Status adicionado", "Já pode ser usado nos lançamentos.");
      }
      setModalOpen(false);
      await reloadStatusConfig();   // atualiza badges em todo o sistema
      await fetchData();
    } catch (e) {
      toast.error("Não foi possível salvar", (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(r: StatusConfigRow) {
    setBusy(r.codigo);
    try {
      await setAtivoStatus(r.codigo, !r.ativo);
      toast.success(r.ativo ? "Status inativado" : "Status reativado");
      await reloadStatusConfig();
      await fetchData();
    } catch (e) {
      toast.error("Não foi possível alterar", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const lista: Array<Pick<StatusConfigRow, "codigo" | "label" | "kind" | "cor_bg" | "cor_text" | "ordem" | "ativo" | "is_sistema">> =
    tabelaAusente ? fallbackEntries : rows;

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-3 lg:flex-row lg:items-center lg:gap-2">
        <div>
          <CardTitle>Status &amp; Cores</CardTitle>
          <p className="text-xs text-stone-500 mt-0.5">
            Rótulo, cor e tipo (entrada/saída/neutro) de cada status. Vale para todas as telas e relatórios.
          </p>
        </div>
        <div className="ml-auto">
          <Button size="sm" onClick={openNew} disabled={!canEdit || tabelaAusente} title={tabelaAusente ? "Aplique a migration 0035" : canEdit ? undefined : "Apenas administradores"}>
            <Plus size={14} /> Novo status
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {tabelaAusente && (
          <div className="m-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <span>
              Edição de status indisponível: a tabela <code className="text-[11px]">status_config</code> ainda não existe.
              Aplique a <b>migration 0035</b> no SQL Editor do Supabase. Abaixo, os status atuais em modo leitura.
            </span>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-100">
                {["Código","Pré-visualização","Tipo","Ordem","Situação","Ações"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-stone-400">
                  <Loader2 size={18} className="inline-block animate-spin mr-2" /> Carregando…
                </td></tr>
              )}
              {!loading && lista.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-stone-400">Nenhum status.</td></tr>
              )}
              {!loading && lista.map((r) => (
                <tr key={r.codigo} className={`border-b border-stone-50 ${r.ativo ? "hover:bg-stone-50" : "bg-stone-50/40"}`}>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-stone-500 whitespace-nowrap">
                    {r.codigo} {r.is_sistema && <span className="ml-1 text-[9px] uppercase tracking-wide text-stone-300">sistema</span>}
                  </td>
                  <td className="px-4 py-2.5"><ChipPreview label={r.label} bg={r.cor_bg} fg={r.cor_text} /></td>
                  <td className="px-4 py-2.5 text-xs text-stone-500">{KIND_LABEL[r.kind]}</td>
                  <td className="px-4 py-2.5 text-xs text-stone-500">{r.ordem ?? "—"}</td>
                  <td className="px-4 py-2.5">{r.ativo ? <Badge variant="info">Ativo</Badge> : <Badge variant="neutral">Inativo</Badge>}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(r as StatusConfigRow)} disabled={!canEdit || tabelaAusente}
                        className="p-1.5 rounded hover:bg-primary-50 text-stone-400 hover:text-primary-600 transition disabled:opacity-40 disabled:cursor-not-allowed" title="Editar">
                        <Edit2 size={13} />
                      </button>
                      <button onClick={() => handleToggle(r as StatusConfigRow)} disabled={!canEdit || tabelaAusente || busy === r.codigo}
                        className="p-1.5 rounded hover:bg-amber-50 text-stone-400 hover:text-amber-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        title={r.ativo ? "Inativar (some das seleções)" : "Reativar"}>
                        {busy === r.codigo ? <Loader2 size={13} className="animate-spin" /> : (r.ativo ? <EyeOff size={13} /> : <Eye size={13} />)}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-3 text-[11px] text-stone-400 border-t border-stone-100">
          Observação: o Postgres não permite <b>apagar</b> um valor de status já existente. Para “remover”, use <b>Inativar</b> — ele some das seleções novas, mas os lançamentos antigos continuam corretos.
        </p>
      </CardContent>

      {/* Modal CRUD */}
      <Modal open={modalOpen} onClose={guard.requestClose} title={editCodigo ? "Editar status" : "Novo status"} size="md">
        <div className="p-6 space-y-4">
          <Input
            label="Rótulo (exibido)"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="ex.: Em negociação"
          />

          {!editCodigo && (
            <div>
              <Input
                label="Código (interno)"
                value={form.codigo}
                onChange={(e) => setForm({ ...form, codigo: e.target.value })}
                onBlur={() => setForm((f) => ({ ...f, codigo: slugStatus(f.codigo || f.label) }))}
                placeholder="gerado do rótulo — ex.: em_negociacao"
              />
              <p className="text-[11px] text-stone-400 mt-1">
                Vira o valor salvo nos lançamentos. Só minúsculas, números e &quot;_&quot;. Não pode ser alterado depois.
              </p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3 items-end">
            <Select label="Tipo" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as StatusKind })}>
              <option value="entrada">Entrada</option>
              <option value="saida">Saída</option>
              <option value="neutro">Neutro</option>
            </Select>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-stone-700">Cor de fundo</label>
              <input type="color" value={form.cor_bg} onChange={(e) => setForm({ ...form, cor_bg: e.target.value })}
                className="h-9 w-full rounded-lg border border-stone-300 bg-white p-1 cursor-pointer" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-stone-700">Cor do texto</label>
              <input type="color" value={form.cor_text} onChange={(e) => setForm({ ...form, cor_text: e.target.value })}
                className="h-9 w-full rounded-lg border border-stone-300 bg-white p-1 cursor-pointer" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 items-end">
            <Input label="Ordem (opcional)" type="number" value={form.ordem}
              onChange={(e) => setForm({ ...form, ordem: e.target.value })} placeholder="ordem de exibição" />
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm text-stone-700 cursor-pointer h-9 select-none">
                <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
                  className="h-4 w-4 rounded border-stone-300 accent-accent-500" disabled={!editCodigo} />
                Ativo
              </label>
              <ChipPreview label={form.label} bg={form.cor_bg} fg={form.cor_text} />
            </div>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={guard.requestClose}>Cancelar</Button>
            <Button onClick={handleSave} loading={saving} disabled={saving || !canEdit}>
              {editCodigo ? "Salvar alterações" : "Adicionar status"}
            </Button>
          </div>
        </div>
      </Modal>
      <UnsavedChangesDialog open={guard.confirmOpen} onStay={guard.stay} onDiscard={guard.discard} />
    </Card>
  );
}
