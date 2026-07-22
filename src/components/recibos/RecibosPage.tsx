"use client";
import { useState, useMemo } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Pagination } from "@/components/ui/Pagination";
import { UnsavedChangesDialog } from "@/components/ui/UnsavedChangesDialog";
import { useUnsavedGuard } from "@/lib/hooks/useUnsavedGuard";
import { Plus, Search, Edit2, Trash2, Download, Eye, FileText } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils/format";

type ReciboStatus = "rascunho" | "emitido" | "cancelado";
type ReciboModelo = "simples" | "prestacao_servico" | "aluguel" | "emprestimo" | "declaracao";

interface Recibo {
  id: string;
  numero: string;
  modelo: ReciboModelo;
  beneficiario: string;
  descricao: string;
  valor: number;
  data: string;
  status: ReciboStatus;
}

function genId() { return Math.random().toString(36).slice(2); }

const statusBadge: Record<ReciboStatus, { variant: "success"|"warning"|"neutral"; label: string }> = {
  rascunho:  { variant: "warning", label: "Rascunho" },
  emitido:   { variant: "success", label: "Emitido" },
  cancelado: { variant: "neutral", label: "Cancelado" },
};

const MODELOS: { value: ReciboModelo; label: string }[] = [
  { value: "simples",           label: "Recibo Simples" },
  { value: "prestacao_servico", label: "Prestação de Serviço" },
  { value: "aluguel",           label: "Recibo de Aluguel" },
  { value: "emprestimo",        label: "Empréstimo" },
  { value: "declaracao",        label: "Declaração" },
];

const INITIAL: Recibo[] = [
  { id: genId(), numero: "REC-001", modelo: "prestacao_servico", beneficiario: "João da Silva", descricao: "Prestação de serviços de manutenção", valor: 3500, data: "2024-01-10", status: "emitido" },
  { id: genId(), numero: "REC-002", modelo: "aluguel",           beneficiario: "Maria Santos", descricao: "Aluguel referente a janeiro/2024", valor: 2800, data: "2024-01-15", status: "emitido" },
  { id: genId(), numero: "REC-003", modelo: "simples",           beneficiario: "Pedro Oliveira", descricao: "Compra de insumos agrícolas", valor: 1200, data: "2024-01-20", status: "rascunho" },
  { id: genId(), numero: "REC-004", modelo: "declaracao",        beneficiario: "Ana Costa",    descricao: "Declaração de quitação", valor: 0, data: "2024-01-25", status: "emitido" },
];

const PAGE_SIZE = 8;

function ReciboPreview({ recibo }: { recibo: Recibo }) {
  return (
    <div className="p-6 font-serif text-sm leading-relaxed">
      <div className="text-center mb-6">
        <h2 className="text-lg font-bold uppercase tracking-widest">RECIBO</h2>
        <p className="text-xs text-stone-500">Nº {recibo.numero}</p>
      </div>
      {recibo.valor > 0 && (
        <p className="mb-4">
          <strong>Valor:</strong> {formatCurrency(recibo.valor)}
          {" "}({recibo.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} reais)
        </p>
      )}
      <p className="mb-4">
        Recebi(emos) de <strong>{recibo.beneficiario}</strong> a importância referente a:
      </p>
      <p className="mb-6 p-3 bg-stone-50 rounded border-l-4 border-accent-400 italic">
        {recibo.descricao}
      </p>
      <p className="mb-8">
        Para maior clareza firmo(amos) o presente recibo, declarando que fico(amos) quite(os)
        e satisfeito(os) com a referida importância.
      </p>
      <div className="mt-12 flex justify-between text-xs">
        <div className="text-center">
          <div className="border-t border-stone-400 pt-1 w-40">Assinatura</div>
        </div>
        <div className="text-right">
          <p>{formatDate(recibo.data)}</p>
        </div>
      </div>
    </div>
  );
}

export function RecibosPage() {
  const [recibos, setRecibos] = useState<Recibo[]>(INITIAL);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<ReciboStatus | "">("");
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState<Recibo | null>(null);
  const [editRow, setEditRow] = useState<Recibo | null>(null);
  const [form, setForm] = useState<Omit<Recibo, "id">>({
    numero: "", modelo: "simples", beneficiario: "", descricao: "", valor: 0, data: "", status: "rascunho",
  });
  const guard = useUnsavedGuard(modalOpen, form, () => setModalOpen(false));

  const filtered = useMemo(() => recibos.filter((r) => {
    const q = search.toLowerCase();
    return (
      (!q || r.beneficiario.toLowerCase().includes(q) || r.numero.toLowerCase().includes(q) || r.descricao.toLowerCase().includes(q)) &&
      (!filterStatus || r.status === filterStatus)
    );
  }), [recibos, search, filterStatus]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function openNew() {
    setEditRow(null);
    const next = `REC-${String(recibos.length + 1).padStart(3, "0")}`;
    setForm({ numero: next, modelo: "simples", beneficiario: "", descricao: "", valor: 0, data: new Date().toISOString().slice(0,10), status: "rascunho" });
    setModalOpen(true);
  }
  function openEdit(r: Recibo) {
    setEditRow(r);
    setForm({ numero: r.numero, modelo: r.modelo, beneficiario: r.beneficiario, descricao: r.descricao, valor: r.valor, data: r.data, status: r.status });
    setModalOpen(true);
  }
  function openPreview(r: Recibo) { setPreviewItem(r); setPreviewOpen(true); }
  function handleSave() {
    const entry: Recibo = { ...form, id: editRow?.id ?? genId() };
    if (editRow) setRecibos(prev => prev.map(r => r.id === editRow.id ? entry : r));
    else setRecibos(prev => [entry, ...prev]);
    setModalOpen(false);
  }
  function handleDelete(id: string) { setRecibos(prev => prev.filter(r => r.id !== id)); }

  return (
    <div className="space-y-6 max-w-[1100px]">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#0f1f1c]">Recibos & Termos</h1>
          <p className="text-sm text-stone-500">Templates de recibos, declarações e contratos</p>
        </div>
        <Button size="sm" onClick={openNew}><Plus size={14} /> Novo Recibo</Button>
      </div>

      {/* Modelos rápidos */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {MODELOS.map((m) => (
          <button
            key={m.value}
            onClick={() => {
              setEditRow(null);
              const next = `REC-${String(recibos.length + 1).padStart(3, "0")}`;
              setForm({ numero: next, modelo: m.value, beneficiario: "", descricao: "", valor: 0, data: new Date().toISOString().slice(0,10), status: "rascunho" });
              setModalOpen(true);
            }}
            className="flex flex-col items-center gap-2 p-4 bg-white rounded-xl border border-stone-200 hover:border-accent-400 hover:shadow-sm transition text-center"
          >
            <FileText size={20} className="text-accent-600" />
            <span className="text-xs font-medium text-stone-700">{m.label}</span>
          </button>
        ))}
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Todos os Recibos</CardTitle>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Buscar recibo..."
                className="h-8 rounded-lg border border-stone-200 pl-8 pr-3 text-xs w-48 focus:outline-none focus:ring-1 focus:ring-accent-400"
              />
            </div>
            <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value as ReciboStatus | ""); setPage(1); }} className="h-8 rounded-lg border border-stone-200 px-2 text-xs focus:outline-none">
              <option value="">Todos status</option>
              <option value="rascunho">Rascunho</option>
              <option value="emitido">Emitido</option>
              <option value="cancelado">Cancelado</option>
            </select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-100">
                  {["Nº","Modelo","Beneficiário","Descrição","Valor","Data","Status","Ações"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-stone-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => (
                  <tr key={r.id} className="border-b border-stone-50 hover:bg-stone-50 transition table-row-alt">
                    <td className="px-4 py-3 font-mono text-xs text-stone-600">{r.numero}</td>
                    <td className="px-4 py-3 text-xs text-stone-500">{MODELOS.find(m => m.value === r.modelo)?.label}</td>
                    <td className="px-4 py-3 font-medium text-stone-700">{r.beneficiario}</td>
                    <td className="px-4 py-3 text-stone-500 text-xs truncate max-w-[160px]">{r.descricao}</td>
                    <td className="px-4 py-3 font-semibold text-stone-700">{r.valor > 0 ? formatCurrency(r.valor) : "—"}</td>
                    <td className="px-4 py-3 text-stone-500 text-xs">{formatDate(r.data)}</td>
                    <td className="px-4 py-3">
                      <Badge variant={statusBadge[r.status].variant}>{statusBadge[r.status].label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openPreview(r)} className="p-1.5 rounded hover:bg-blue-50 text-stone-400 hover:text-blue-500 transition"><Eye size={13}/></button>
                        <button className="p-1.5 rounded hover:bg-green-50 text-stone-400 hover:text-green-600 transition"><Download size={13}/></button>
                        <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-primary-50 text-stone-400 hover:text-primary-600 transition"><Edit2 size={13}/></button>
                        <button onClick={() => handleDelete(r.id)} className="p-1.5 rounded hover:bg-red-50 text-stone-400 hover:text-red-500 transition"><Trash2 size={13}/></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {paged.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-stone-400">Nenhum recibo encontrado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-t border-stone-100">
            <p className="text-xs text-stone-400">{filtered.length} recibo(s)</p>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </CardContent>
      </Card>

      {/* Form modal */}
      <Modal open={modalOpen} onClose={guard.requestClose} title={editRow ? "Editar Recibo" : "Novo Recibo"} size="lg">
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Número" value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} />
            <Select label="Modelo" value={form.modelo} onChange={(e) => setForm({ ...form, modelo: e.target.value as ReciboModelo })}>
              {MODELOS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
          </div>
          <Input label="Beneficiário / Pagador" value={form.beneficiario} onChange={(e) => setForm({ ...form, beneficiario: e.target.value })} placeholder="Nome completo" />
          <Textarea label="Descrição / Cláusulas" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} rows={4} placeholder="Descreva o objeto do recibo..." />
          <div className="grid grid-cols-3 gap-4">
            <Input label="Valor (R$)" type="number" value={String(form.valor)} onChange={(e) => setForm({ ...form, valor: Number(e.target.value) })} />
            <Input label="Data" type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} />
            <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ReciboStatus })}>
              <option value="rascunho">Rascunho</option>
              <option value="emitido">Emitido</option>
              <option value="cancelado">Cancelado</option>
            </Select>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={guard.requestClose}>Cancelar</Button>
            <Button variant="outline" onClick={() => { handleSave(); }}><Download size={14}/>Salvar e Gerar PDF</Button>
            <Button onClick={handleSave}>{editRow ? "Salvar" : "Criar Recibo"}</Button>
          </div>
        </div>
      </Modal>
      <UnsavedChangesDialog open={guard.confirmOpen} onStay={guard.stay} onDiscard={guard.discard} />

      {/* Preview modal */}
      {previewItem && (
        <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title={`Prévia – ${previewItem.numero}`} size="md">
          <ReciboPreview recibo={previewItem} />
          <div className="px-6 pb-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPreviewOpen(false)}>Fechar</Button>
            <Button><Download size={14}/> Exportar PDF</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
