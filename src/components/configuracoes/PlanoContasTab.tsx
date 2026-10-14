"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Input, Select } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { UnsavedChangesDialog } from "@/components/ui/UnsavedChangesDialog";
import { useUnsavedGuard } from "@/lib/hooks/useUnsavedGuard";
import { Plus, Edit2, Trash2, Search, Loader2, Eye, EyeOff } from "lucide-react";
import {
  listarClassificacoesAdmin,
  criarClassificacao,
  atualizarClassificacao,
  setAtivoClassificacao,
  contarUsoClassificacao,
  excluirClassificacao,
  derivarNivelParent,
  naturezaSugerida,
  validarCodigo,
  motivoCodigoTravado,
  validarTrocaCodigo,
  deParaTrocaCodigo,
  trocarCodigoClassificacao,
  type UsoClassificacao,
} from "@/lib/queries/configuracoes";
import type { ClassificacaoFinanceiraRow, NaturezaConta } from "@/types";

const TIPO_NIVEL: Record<number, string> = { 1: "Grupo", 2: "Conta contábil", 3: "Centro de custo" };

interface FormState {
  codigo: string;
  nome: string;
  natureza: NaturezaConta;
  ordem: string;
  ativo: boolean;
}
const EMPTY: FormState = { codigo: "", nome: "", natureza: "entrada", ordem: "", ativo: true };

export function PlanoContasTab({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const [rows, setRows] = useState<ClassificacaoFinanceiraRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [mostrarInativas, setMostrarInativas] = useState(false);
  const [filtroNatureza, setFiltroNatureza] = useState<"" | NaturezaConta>("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editCodigo, setEditCodigo] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const guard = useUnsavedGuard(modalOpen, form, () => setModalOpen(false));
  const [saving, setSaving] = useState(false);
  const [busyCodigo, setBusyCodigo] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listarClassificacoesAdmin());
    } catch (e) {
      toast.error("Erro carregando classificações", (e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData(); }, [fetchData]);

  const filtradas = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!mostrarInativas && !r.ativo) return false;
      if (filtroNatureza && r.natureza !== filtroNatureza) return false;
      if (s && !(`${r.codigo} ${r.nome}`.toLowerCase().includes(s))) return false;
      return true;
    });
  }, [rows, search, mostrarInativas, filtroNatureza]);

  const { nivel: nivelForm, parent: parentForm } = derivarNivelParent(form.codigo.trim());

  // Edição: o código pode mudar (RPC 0057), menos os que o sistema procura pelo número.
  const editRow = editCodigo ? rows.find((r) => r.codigo === editCodigo) ?? null : null;
  const travaCodigo = editRow ? motivoCodigoTravado(editRow) : null;
  const codigoNovo = form.codigo.trim();
  const trocandoCodigo = !!editRow && codigoNovo !== editRow.codigo;
  const erroTroca = editRow && trocandoCodigo ? validarTrocaCodigo(editRow, codigoNovo, rows) : null;
  const deParaTroca = editRow && trocandoCodigo && !erroTroca ? deParaTrocaCodigo(editRow.codigo, codigoNovo, rows) : [];
  const mudaConta = !!editRow && editRow.nivel === 3 && deParaTroca.length > 0 && parentForm !== editRow.parent_codigo;

  function openNew() {
    setEditCodigo(null);
    setForm({ ...EMPTY });
    setModalOpen(true);
  }
  function openEdit(r: ClassificacaoFinanceiraRow) {
    setEditCodigo(r.codigo);
    setForm({ codigo: r.codigo, nome: r.nome, natureza: r.natureza, ordem: r.ordem == null ? "" : String(r.ordem), ativo: r.ativo });
    setModalOpen(true);
  }

  // Ao digitar o código (novo), sugere a natureza pela raiz (1=entrada, 2=saída).
  // Na edição a natureza fica como está (a troca de código não muda de grupo).
  function onCodigoChange(v: string) {
    setForm((f) => ({ ...f, codigo: v, natureza: !editCodigo && v.trim() ? naturezaSugerida(v) : f.natureza }));
  }

  async function handleSave() {
    if (!editCodigo) {
      const err = validarCodigo(form.codigo);
      if (err) { toast.error("Código inválido", err); return; }
    }
    if (!form.nome.trim()) { toast.error("Nome obrigatório", "Informe o nome da classificação."); return; }
    const ordem = form.ordem.trim() === "" ? null : Number(form.ordem);
    if (ordem !== null && !Number.isFinite(ordem)) { toast.error("Ordem inválida", "Use um número ou deixe em branco."); return; }

    // Troca de código: confere e confirma antes de mexer nos lançamentos.
    if (editRow && trocandoCodigo) {
      if (erroTroca) { toast.error("Código inválido", erroTroca); return; }
      let uso: UsoClassificacao;
      try {
        uso = await contarUsoClassificacao(editRow.codigo);
      } catch (e) {
        toast.error("Não foi possível conferir o uso do código", (e as Error).message);
        return;
      }
      const subcategorias = deParaTroca.slice(1).map((d) => `${d.de} → ${d.para}`).join(", ");
      const ok = window.confirm(
        `Trocar o código ${editRow.codigo} → ${codigoNovo}?\n\n` +
        (subcategorias ? `Subcategorias renumeradas junto: ${subcategorias}.\n` : "") +
        (uso.transacoes > 0
          ? `${uso.transacoes} lançamento${uso.transacoes === 1 ? "" : "s"} passa${uso.transacoes === 1 ? "" : "m"} a usar o código novo` +
            (mudaConta ? ` e a conta ${parentForm}.` : ".")
          : "Nenhum lançamento usa este código."),
      );
      if (!ok) return;
    }

    setSaving(true);
    let trocou = false;
    try {
      if (editCodigo) {
        let codigo = editCodigo;
        let resumoTroca: string | null = null;
        if (trocandoCodigo) {
          const r = await trocarCodigoClassificacao(editCodigo, codigoNovo);
          trocou = true;
          codigo = codigoNovo;
          // Se o resto falhar, a próxima tentativa já parte do código novo.
          setEditCodigo(codigoNovo);
          resumoTroca = r.codigos.map((d) => `${d.de} → ${d.para}`).join(", ") +
            (r.lancamentos > 0 ? ` · ${r.lancamentos} lançamento${r.lancamentos === 1 ? "" : "s"} atualizado${r.lancamentos === 1 ? "" : "s"}` : "");
        }
        await atualizarClassificacao(codigo, { nome: form.nome, natureza: form.natureza, ordem, ativo: form.ativo });
        if (resumoTroca) toast.success("Código alterado", resumoTroca);
        else toast.success("Classificação atualizada");
      } else {
        await criarClassificacao({ codigo: form.codigo.trim(), nome: form.nome, natureza: form.natureza, ordem, ativo: form.ativo });
        toast.success("Classificação criada");
      }
      setModalOpen(false);
      await fetchData();
    } catch (e) {
      toast.error("Não foi possível salvar", (e as Error).message);
      // O código já mudou no banco: a lista precisa mostrar o novo.
      if (trocou) await fetchData();
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleAtivo(r: ClassificacaoFinanceiraRow) {
    setBusyCodigo(r.codigo);
    try {
      await setAtivoClassificacao(r.codigo, !r.ativo);
      toast.success(r.ativo ? "Classificação inativada" : "Classificação reativada");
      await fetchData();
    } catch (e) {
      toast.error("Não foi possível alterar", (e as Error).message);
    } finally {
      setBusyCodigo(null);
    }
  }

  async function handleDelete(r: ClassificacaoFinanceiraRow) {
    setBusyCodigo(r.codigo);
    try {
      const uso = await contarUsoClassificacao(r.codigo);
      if (uso.total > 0) {
        const partes = [
          uso.transacoes > 0 ? `${uso.transacoes} lançamento${uso.transacoes === 1 ? "" : "s"}` : "",
          uso.filhos > 0 ? `${uso.filhos} subcategoria${uso.filhos === 1 ? "" : "s"}` : "",
        ].filter(Boolean).join(" e ");
        const ok = window.confirm(
          `"${r.codigo} – ${r.nome}" está em uso (${partes}).\n\n` +
          `Não pode ser excluída sem perder histórico. Deseja INATIVAR? ` +
          `(some das seleções novas, mas preserva os lançamentos antigos.)`,
        );
        if (ok) {
          await setAtivoClassificacao(r.codigo, false);
          toast.success("Classificação inativada");
          await fetchData();
        }
        return;
      }
      if (!window.confirm(`Excluir definitivamente "${r.codigo} – ${r.nome}"? Não há nada usando ela.`)) return;
      await excluirClassificacao(r.codigo);
      toast.success("Classificação excluída");
      await fetchData();
    } catch (e) {
      toast.error("Não foi possível excluir", (e as Error).message);
    } finally {
      setBusyCodigo(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-3 lg:flex-row lg:items-center lg:gap-2">
        <div>
          <CardTitle>Plano de Contas</CardTitle>
          <p className="text-xs text-stone-500 mt-0.5">
            Conta contábil (nível 2) e centro de custo (nível 3). Ex.: adicionar <b>1.1.3 Inter</b> e <b>1.1.4 XP</b>.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap ml-auto">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar código ou nome…"
              className="h-8 rounded-lg border border-stone-200 pl-8 pr-3 text-xs w-56 focus:outline-none focus:ring-1 focus:ring-accent-400"
            />
          </div>
          <select
            value={filtroNatureza}
            onChange={(e) => setFiltroNatureza(e.target.value as "" | NaturezaConta)}
            className="h-8 rounded-lg border border-stone-200 px-2 text-xs"
          >
            <option value="">Entradas e saídas</option>
            <option value="entrada">Só entradas</option>
            <option value="saida">Só saídas</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-stone-600 cursor-pointer select-none">
            <input type="checkbox" checked={mostrarInativas} onChange={(e) => setMostrarInativas(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-stone-300 accent-accent-500" />
            Mostrar inativas
          </label>
          <Button size="sm" onClick={openNew} disabled={!canEdit} title={canEdit ? undefined : "Apenas administradores"}>
            <Plus size={14} /> Nova classificação
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-100">
                {["Código","Nome","Tipo","Natureza","Situação","Ações"].map((h) => (
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
              {!loading && filtradas.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-stone-400">Nenhuma classificação encontrada.</td></tr>
              )}
              {!loading && filtradas.map((r) => (
                <tr key={r.codigo} className={`border-b border-stone-50 transition-colors ${r.ativo ? "hover:bg-stone-50" : "bg-stone-50/40 text-stone-400"}`}>
                  <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap" style={{ paddingLeft: `${16 + (r.nivel - 1) * 18}px` }}>
                    {r.codigo}
                  </td>
                  <td className={`px-4 py-2.5 ${r.nivel === 1 ? "font-semibold text-stone-700" : r.nivel === 2 ? "font-medium text-stone-700" : "text-stone-600"} ${!r.ativo ? "line-through text-stone-400" : ""}`}>
                    {r.nome}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-stone-500 whitespace-nowrap">{TIPO_NIVEL[r.nivel] ?? `Nível ${r.nivel}`}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant={r.natureza === "entrada" ? "success" : "danger"}>{r.natureza === "entrada" ? "Entrada" : "Saída"}</Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    {r.ativo ? <Badge variant="info">Ativa</Badge> : <Badge variant="neutral">Inativa</Badge>}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(r)} disabled={!canEdit}
                        className="p-1.5 rounded hover:bg-primary-50 text-stone-400 hover:text-primary-600 transition disabled:opacity-40 disabled:cursor-not-allowed" title="Editar">
                        <Edit2 size={13} />
                      </button>
                      <button onClick={() => handleToggleAtivo(r)} disabled={!canEdit || busyCodigo === r.codigo}
                        className="p-1.5 rounded hover:bg-amber-50 text-stone-400 hover:text-amber-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        title={r.ativo ? "Inativar" : "Reativar"}>
                        {busyCodigo === r.codigo ? <Loader2 size={13} className="animate-spin" /> : (r.ativo ? <EyeOff size={13} /> : <Eye size={13} />)}
                      </button>
                      <button onClick={() => handleDelete(r)} disabled={!canEdit || busyCodigo === r.codigo}
                        className="p-1.5 rounded hover:bg-red-50 text-stone-400 hover:text-red-500 transition disabled:opacity-40 disabled:cursor-not-allowed" title="Excluir">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>

      {/* Modal CRUD */}
      <Modal open={modalOpen} onClose={guard.requestClose} title={editCodigo ? "Editar classificação" : "Nova classificação"} size="md">
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Input
                label="Código"
                value={form.codigo}
                disabled={!!travaCodigo}
                onChange={(e) => onCodigoChange(e.target.value)}
                placeholder="ex.: 1.1.3"
              />
              {((!editCodigo && form.codigo.trim()) || deParaTroca.length > 0) && (
                <p className="text-[11px] text-stone-400 mt-1">
                  {TIPO_NIVEL[nivelForm] ?? `Nível ${nivelForm}`}
                  {parentForm ? ` · dentro de ${parentForm}` : " · raiz"}
                </p>
              )}
            </div>
            <Select label="Natureza" value={form.natureza}
              onChange={(e) => setForm({ ...form, natureza: e.target.value as NaturezaConta })}>
              <option value="entrada">Entrada</option>
              <option value="saida">Saída</option>
            </Select>
          </div>

          <Input label="Nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })}
            placeholder="ex.: Banco Inter" />

          <div className="grid grid-cols-2 gap-3 items-end">
            <Input label="Ordem (opcional)" type="number" value={form.ordem}
              onChange={(e) => setForm({ ...form, ordem: e.target.value })}
              placeholder="ordem de exibição" />
            <label className="flex items-center gap-2 text-sm text-stone-700 cursor-pointer h-9 select-none">
              <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
                className="h-4 w-4 rounded border-stone-300 accent-accent-500" />
              Ativa (aparece nos filtros e seleções)
            </label>
          </div>

          {editRow && (
            travaCodigo ? (
              <p className="text-[11px] text-stone-400">{travaCodigo}</p>
            ) : erroTroca ? (
              <p className="text-[11px] text-red-600">{erroTroca}</p>
            ) : deParaTroca.length > 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 space-y-0.5">
                <p>Ao salvar: {deParaTroca.map((d) => `${d.de} → ${d.para}`).join(" · ")}</p>
                <p>
                  {mudaConta
                    ? `Os lançamentos deste centro de custo passam para a conta ${parentForm}.`
                    : "Os lançamentos acompanham a troca automaticamente."}
                </p>
              </div>
            ) : (
              <p className="text-[11px] text-stone-400">
                {editRow.nivel === 2
                  ? "Ao trocar o código, as subcategorias são renumeradas junto e os lançamentos acompanham automaticamente."
                  : "Ao trocar o código, os lançamentos acompanham automaticamente — inclusive se o centro de custo mudar de conta."}
              </p>
            )
          )}

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={guard.requestClose}>Cancelar</Button>
            <Button onClick={handleSave} loading={saving} disabled={saving || !canEdit}>
              {editCodigo ? "Salvar alterações" : "Adicionar"}
            </Button>
          </div>
        </div>
      </Modal>
      <UnsavedChangesDialog open={guard.confirmOpen} onStay={guard.stay} onDiscard={guard.discard} />
    </Card>
  );
}
