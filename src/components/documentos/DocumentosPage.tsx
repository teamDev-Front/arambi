"use client";
import { useState, useMemo } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Pagination } from "@/components/ui/Pagination";
import {
  Search, Plus, Upload, Edit2, Trash2, Download,
  FileText, FileSpreadsheet, File, Image, Eye,
} from "lucide-react";
import { formatDate, formatFileSize } from "@/lib/utils/format";

interface Documento {
  id: string;
  nome: string;
  tipo: string;
  tamanho: number;
  mes_referencia: string;
  descricao: string;
  numero_nota: string;
  created_at: string;
}

function genId() { return Math.random().toString(36).slice(2); }

const TIPOS = ["PDF","Excel","PPT","Imagem","XML","Word","CSV","Outros"];

const INITIAL: Documento[] = [
  { id: genId(), nome: "Contrato de Serviços.pdf", tipo: "PDF", tamanho: 1248000, mes_referencia: "2024-01", descricao: "Contrato principal", numero_nota: "NF-001", created_at: "2024-01-12" },
  { id: genId(), nome: "Relatório Financeiro.xlsx", tipo: "Excel", tamanho: 384000, mes_referencia: "2024-01", descricao: "Relatório mensal", numero_nota: "", created_at: "2024-01-10" },
  { id: genId(), nome: "Apresentação Comercial.ppt", tipo: "PPT", tamanho: 2560000, mes_referencia: "2024-01", descricao: "Apresentação para sócios", numero_nota: "", created_at: "2024-01-08" },
  { id: genId(), nome: "Imagem Produto.jpg", tipo: "Imagem", tamanho: 856000, mes_referencia: "2024-01", descricao: "Foto do produto", numero_nota: "", created_at: "2024-01-03" },
  { id: genId(), nome: "Nota Fiscal 12345.xml", tipo: "XML", tamanho: 48000, mes_referencia: "2024-01", descricao: "NF emitida", numero_nota: "NF-12345", created_at: "2024-01-03" },
  { id: genId(), nome: "Extrato Bancário Fev.pdf", tipo: "PDF", tamanho: 320000, mes_referencia: "2024-02", descricao: "Extrato fevereiro", numero_nota: "", created_at: "2024-02-05" },
];

function tipoIcon(tipo: string) {
  if (tipo === "PDF") return <FileText size={16} className="text-red-500" />;
  if (tipo === "Excel" || tipo === "CSV") return <FileSpreadsheet size={16} className="text-green-600" />;
  if (tipo === "Imagem") return <Image size={16} className="text-blue-500" />;
  return <File size={16} className="text-stone-400" />;
}

const PAGE_SIZE = 8;

export function DocumentosPage() {
  const [docs, setDocs] = useState<Documento[]>(INITIAL);
  const [search, setSearch] = useState("");
  const [filterTipo, setFilterTipo] = useState("");
  const [filterMes, setFilterMes] = useState("");
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editRow, setEditRow] = useState<Documento | null>(null);
  const [form, setForm] = useState({ nome: "", tipo: "PDF", tamanho: "0", mes_referencia: "", descricao: "", numero_nota: "" });

  const meses = [...new Set(docs.map(d => d.mes_referencia))].sort().reverse();

  const filtered = useMemo(() => docs.filter((d) => {
    const q = search.toLowerCase();
    return (
      (!q || d.nome.toLowerCase().includes(q) || d.descricao.toLowerCase().includes(q) || d.numero_nota.toLowerCase().includes(q)) &&
      (!filterTipo || d.tipo === filterTipo) &&
      (!filterMes || d.mes_referencia === filterMes)
    );
  }), [docs, search, filterTipo, filterMes]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function openNew() {
    setEditRow(null);
    setForm({ nome: "", tipo: "PDF", tamanho: "0", mes_referencia: "", descricao: "", numero_nota: "" });
    setModalOpen(true);
  }
  function openEdit(doc: Documento) {
    setEditRow(doc);
    setForm({ nome: doc.nome, tipo: doc.tipo, tamanho: String(doc.tamanho), mes_referencia: doc.mes_referencia, descricao: doc.descricao, numero_nota: doc.numero_nota });
    setModalOpen(true);
  }
  function handleSave() {
    const entry: Documento = { ...form, id: editRow?.id ?? genId(), tamanho: Number(form.tamanho), created_at: editRow?.created_at ?? new Date().toISOString().slice(0,10) };
    if (editRow) setDocs(prev => prev.map(d => d.id === editRow.id ? entry : d));
    else setDocs(prev => [entry, ...prev]);
    setModalOpen(false);
  }
  function handleDelete(id: string) { setDocs(prev => prev.filter(d => d.id !== id)); }

  return (
    <div className="space-y-6 max-w-[1200px]">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#0f1f1c]">Documentos</h1>
          <p className="text-sm text-stone-500">Gestão de arquivos e notas fiscais</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm"><Upload size={14} /> Importar</Button>
          <Button size="sm" onClick={openNew}><Plus size={14} /> Novo Documento</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Arquivos ({filtered.length})</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Buscar por nome, descrição ou nº nota..."
                className="h-8 rounded-lg border border-stone-200 pl-8 pr-3 text-xs w-60 focus:outline-none focus:ring-1 focus:ring-accent-400"
              />
            </div>
            <select value={filterTipo} onChange={(e) => { setFilterTipo(e.target.value); setPage(1); }} className="h-8 rounded-lg border border-stone-200 px-2 text-xs focus:outline-none">
              <option value="">Todos os tipos</option>
              {TIPOS.map(t => <option key={t}>{t}</option>)}
            </select>
            <select value={filterMes} onChange={(e) => { setFilterMes(e.target.value); setPage(1); }} className="h-8 rounded-lg border border-stone-200 px-2 text-xs focus:outline-none">
              <option value="">Todos os meses</option>
              {meses.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-100">
                  {["Nome","Tipo","Tamanho","Mês Ref.","Nº Nota","Descrição","Data","Ações"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-stone-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map((doc) => (
                  <tr key={doc.id} className="border-b border-stone-50 hover:bg-stone-50 transition table-row-alt">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {tipoIcon(doc.tipo)}
                        <span className="text-stone-700 font-medium truncate max-w-[160px]">{doc.nome}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={doc.tipo === "PDF" ? "danger" : doc.tipo === "Excel" ? "success" : "neutral"}>{doc.tipo}</Badge>
                    </td>
                    <td className="px-4 py-3 text-stone-500 text-xs">{formatFileSize(doc.tamanho)}</td>
                    <td className="px-4 py-3 text-stone-500 text-xs">{doc.mes_referencia}</td>
                    <td className="px-4 py-3 text-stone-500 text-xs">{doc.numero_nota || "—"}</td>
                    <td className="px-4 py-3 text-stone-500 text-xs truncate max-w-[140px]">{doc.descricao || "—"}</td>
                    <td className="px-4 py-3 text-stone-500 text-xs whitespace-nowrap">{formatDate(doc.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button className="p-1.5 rounded hover:bg-blue-50 text-stone-400 hover:text-blue-500 transition"><Eye size={13}/></button>
                        <button className="p-1.5 rounded hover:bg-green-50 text-stone-400 hover:text-green-600 transition"><Download size={13}/></button>
                        <button onClick={() => openEdit(doc)} className="p-1.5 rounded hover:bg-primary-50 text-stone-400 hover:text-primary-600 transition"><Edit2 size={13}/></button>
                        <button onClick={() => handleDelete(doc.id)} className="p-1.5 rounded hover:bg-red-50 text-stone-400 hover:text-red-500 transition"><Trash2 size={13}/></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {paged.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-stone-400 text-sm">Nenhum documento encontrado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-t border-stone-100">
            <p className="text-xs text-stone-400">{filtered.length} documento(s)</p>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </CardContent>
      </Card>

      {/* Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editRow ? "Editar Documento" : "Novo Documento"}>
        <div className="p-6 space-y-4">
          <Input label="Nome do arquivo" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex: Contrato de Serviços.pdf" />
          <div className="grid grid-cols-2 gap-4">
            <Select label="Tipo" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
              {TIPOS.map(t => <option key={t}>{t}</option>)}
            </Select>
            <Input label="Mês de referência" type="month" value={form.mes_referencia} onChange={(e) => setForm({ ...form, mes_referencia: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Nº Nota Fiscal" value={form.numero_nota} onChange={(e) => setForm({ ...form, numero_nota: e.target.value })} placeholder="NF-0000" />
            <Input label="Tamanho (bytes)" type="number" value={form.tamanho} onChange={(e) => setForm({ ...form, tamanho: e.target.value })} />
          </div>
          <Textarea label="Descrição" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} rows={3} placeholder="Descrição do documento" />
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave}>{editRow ? "Salvar" : "Adicionar"}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
