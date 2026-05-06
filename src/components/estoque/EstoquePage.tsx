"use client";
import { useState, useMemo } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { KpiCard } from "@/components/ui/KpiCard";
import { Modal } from "@/components/ui/Modal";
import { Input, Select } from "@/components/ui/Input";
import { Pagination } from "@/components/ui/Pagination";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Plus, Search, Edit2, Trash2, Package, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { formatCurrency } from "@/lib/utils/format";

type EstoqueStatus = "em_estoque" | "baixo_estoque" | "critico" | "esgotado";

interface Produto {
  id: string;
  produto: string;
  categoria: string;
  quantidade: number;
  unidade: string;
  valor_unitario: number;
  status: EstoqueStatus;
  fornecedor: string;
}

const CATEGORIAS_EST = ["Eletrônicos","Móveis","Acessórios","Periféricos","Insumos","Maquinário","Sementes","Fertilizantes"];

function genId() { return Math.random().toString(36).slice(2); }

const statusMeta: Record<EstoqueStatus, { label: string; variant: BadgeVariant; icon: React.ReactNode }> = {
  em_estoque:   { label: "Em Estoque",   variant: "success",  icon: <CheckCircle2 size={12}/> },
  baixo_estoque:{ label: "Baixo Estoque",variant: "warning",  icon: <AlertTriangle size={12}/> },
  critico:      { label: "Crítico",      variant: "danger",   icon: <AlertTriangle size={12}/> },
  esgotado:     { label: "Esgotado",     variant: "neutral",  icon: <XCircle size={12}/> },
};

const INITIAL: Produto[] = [
  { id: genId(), produto: "Notebook Dell XPS", categoria: "Eletrônicos", quantidade: 15, unidade: "un", valor_unitario: 8500, status: "em_estoque", fornecedor: "Dell Brasil" },
  { id: genId(), produto: "Smartphone Samsung S21", categoria: "Eletrônicos", quantidade: 30, unidade: "un", valor_unitario: 3200, status: "em_estoque", fornecedor: "Samsung" },
  { id: genId(), produto: "Cadeira Office Ergonômica", categoria: "Móveis", quantidade: 5, unidade: "un", valor_unitario: 1200, status: "baixo_estoque", fornecedor: "Ergos" },
  { id: genId(), produto: "Fone de Ouvido JBL", categoria: "Acessórios", quantidade: 30, unidade: "un", valor_unitario: 350, status: "em_estoque", fornecedor: "JBL" },
  { id: genId(), produto: "Impressora HP LaserJet", categoria: "Periféricos", quantidade: 12, unidade: "un", valor_unitario: 2800, status: "critico", fornecedor: "HP" },
  { id: genId(), produto: "Sementes Milho HB", categoria: "Sementes", quantidade: 200, unidade: "kg", valor_unitario: 45, status: "em_estoque", fornecedor: "Syngenta" },
  { id: genId(), produto: "Fertilizante NPK 10-10-10", categoria: "Fertilizantes", quantidade: 3, unidade: "saco 50kg", valor_unitario: 180, status: "baixo_estoque", fornecedor: "Yara" },
];

const barData = CATEGORIAS_EST.slice(0, 6).map((c) => ({
  categoria: c.split(" ")[0],
  quantidade: Math.floor(Math.random() * 50) + 5,
}));

const PAGE_SIZE = 6;

export function EstoquePage() {
  const [produtos, setProdutos] = useState<Produto[]>(INITIAL);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<EstoqueStatus | "">("");
  const [filterCat, setFilterCat] = useState("");
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editRow, setEditRow] = useState<Produto | null>(null);
  const [form, setForm] = useState<Omit<Produto, "id">>({
    produto: "", categoria: CATEGORIAS_EST[0], quantidade: 0, unidade: "un",
    valor_unitario: 0, status: "em_estoque", fornecedor: "",
  });

  const filtered = useMemo(() => produtos.filter((p) => {
    const q = search.toLowerCase();
    return (
      (!q || p.produto.toLowerCase().includes(q) || p.fornecedor.toLowerCase().includes(q)) &&
      (!filterStatus || p.status === filterStatus) &&
      (!filterCat || p.categoria === filterCat)
    );
  }), [produtos, search, filterStatus, filterCat]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const totais = {
    total: produtos.length,
    emEstoque: produtos.filter(p => p.status === "em_estoque").length,
    criticos: produtos.filter(p => p.status === "critico" || p.status === "baixo_estoque").length,
    valorTotal: produtos.reduce((s, p) => s + p.quantidade * p.valor_unitario, 0),
  };

  function openNew() {
    setEditRow(null);
    setForm({ produto: "", categoria: CATEGORIAS_EST[0], quantidade: 0, unidade: "un", valor_unitario: 0, status: "em_estoque", fornecedor: "" });
    setModalOpen(true);
  }
  function openEdit(row: Produto) {
    setEditRow(row);
    setForm({ produto: row.produto, categoria: row.categoria, quantidade: row.quantidade, unidade: row.unidade, valor_unitario: row.valor_unitario, status: row.status, fornecedor: row.fornecedor });
    setModalOpen(true);
  }
  function handleSave() {
    const entry: Produto = { ...form, id: editRow?.id ?? genId() };
    if (editRow) {
      setProdutos(prev => prev.map(p => p.id === editRow.id ? entry : p));
    } else {
      setProdutos(prev => [entry, ...prev]);
    }
    setModalOpen(false);
  }
  function handleDelete(id: string) { setProdutos(prev => prev.filter(p => p.id !== id)); }

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#0f1f1c]">Estoque</h1>
          <p className="text-sm text-stone-500">Controle de inventário</p>
        </div>
        <Button size="sm" onClick={openNew}><Plus size={14} /> Adicionar Produto</Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total de Itens" value={String(totais.total)} icon={<Package size={16}/>} />
        <KpiCard label="Em Estoque" value={String(totais.emEstoque)} trend="up" icon={<CheckCircle2 size={16}/>} />
        <KpiCard label="Críticos/Baixos" value={String(totais.criticos)} trend={totais.criticos > 0 ? "down" : "neutral"} icon={<AlertTriangle size={16}/>} />
        <KpiCard label="Valor Total" value={formatCurrency(totais.valorTotal)} trend="up" icon={<Package size={16}/>} />
      </div>

      {/* Chart */}
      <Card>
        <CardHeader><CardTitle>Quantidade por Categoria</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={barData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" />
              <XAxis dataKey="categoria" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e7e5e4", fontSize: 12 }} />
              <Bar dataKey="quantidade" name="Qtd" fill="#22c55e" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Produtos</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Buscar produto..."
                className="h-8 rounded-lg border border-stone-200 pl-8 pr-3 text-xs w-44 focus:outline-none focus:ring-1 focus:ring-accent-400"
              />
            </div>
            <select
              value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value as EstoqueStatus | ""); setPage(1); }}
              className="h-8 rounded-lg border border-stone-200 px-2 text-xs focus:outline-none"
            >
              <option value="">Todos status</option>
              <option value="em_estoque">Em Estoque</option>
              <option value="baixo_estoque">Baixo Estoque</option>
              <option value="critico">Crítico</option>
              <option value="esgotado">Esgotado</option>
            </select>
            <select
              value={filterCat}
              onChange={(e) => { setFilterCat(e.target.value); setPage(1); }}
              className="h-8 rounded-lg border border-stone-200 px-2 text-xs focus:outline-none"
            >
              <option value="">Todas categorias</option>
              {CATEGORIAS_EST.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-100">
                  {["Produto","Categoria","Qtd","Un.","Valor Unit.","Total","Fornecedor","Status","Ações"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-stone-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map((p) => {
                  const meta = statusMeta[p.status];
                  return (
                    <tr key={p.id} className="border-b border-stone-50 hover:bg-stone-50 transition table-row-alt">
                      <td className="px-4 py-3 font-medium text-stone-700">{p.produto}</td>
                      <td className="px-4 py-3 text-stone-500 text-xs">{p.categoria}</td>
                      <td className="px-4 py-3 font-semibold text-stone-800">{p.quantidade}</td>
                      <td className="px-4 py-3 text-stone-500 text-xs">{p.unidade}</td>
                      <td className="px-4 py-3 text-stone-700">{formatCurrency(p.valor_unitario)}</td>
                      <td className="px-4 py-3 font-semibold text-stone-700">{formatCurrency(p.quantidade * p.valor_unitario)}</td>
                      <td className="px-4 py-3 text-stone-500 text-xs">{p.fornecedor}</td>
                      <td className="px-4 py-3">
                        <Badge variant={meta.variant}>
                          <span className="flex items-center gap-1">{meta.icon}{meta.label}</span>
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEdit(p)} className="p-1.5 rounded hover:bg-primary-50 text-stone-400 hover:text-primary-600 transition"><Edit2 size={13}/></button>
                          <button onClick={() => handleDelete(p.id)} className="p-1.5 rounded hover:bg-red-50 text-stone-400 hover:text-red-500 transition"><Trash2 size={13}/></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {paged.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-stone-400 text-sm">Nenhum produto encontrado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-t border-stone-100">
            <p className="text-xs text-stone-400">{filtered.length} produto(s)</p>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </CardContent>
      </Card>

      {/* Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editRow ? "Editar Produto" : "Novo Produto"}>
        <div className="p-6 space-y-4">
          <Input label="Produto" value={form.produto} onChange={(e) => setForm({ ...form, produto: e.target.value })} placeholder="Nome do produto" />
          <div className="grid grid-cols-2 gap-4">
            <Select label="Categoria" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>
              {CATEGORIAS_EST.map(c => <option key={c}>{c}</option>)}
            </Select>
            <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as EstoqueStatus })}>
              <option value="em_estoque">Em Estoque</option>
              <option value="baixo_estoque">Baixo Estoque</option>
              <option value="critico">Crítico</option>
              <option value="esgotado">Esgotado</option>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Input label="Quantidade" type="number" value={String(form.quantidade)} onChange={(e) => setForm({ ...form, quantidade: Number(e.target.value) })} />
            <Input label="Unidade" value={form.unidade} onChange={(e) => setForm({ ...form, unidade: e.target.value })} />
            <Input label="Valor Unit. (R$)" type="number" value={String(form.valor_unitario)} onChange={(e) => setForm({ ...form, valor_unitario: Number(e.target.value) })} />
          </div>
          <Input label="Fornecedor" value={form.fornecedor} onChange={(e) => setForm({ ...form, fornecedor: e.target.value })} />
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave}>{editRow ? "Salvar" : "Adicionar"}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
