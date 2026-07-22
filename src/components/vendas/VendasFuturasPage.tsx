"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { KpiCard } from "@/components/ui/KpiCard";
import { Modal } from "@/components/ui/Modal";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/ui/Toast";
import { UnsavedChangesDialog } from "@/components/ui/UnsavedChangesDialog";
import { useUnsavedGuard } from "@/lib/hooks/useUnsavedGuard";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from "recharts";
import {
  Plus, Search, Edit2, Trash2, Loader2, Download, Sprout,
  Wallet, CalendarClock, ArrowDownToLine, HandCoins,
} from "lucide-react";
import {
  listarVendas, criarVenda, atualizarVenda, deletarVenda, calcularResumo,
  type ListarVendasFiltros,
} from "@/lib/queries/vendas";
import { listarSocios } from "@/lib/queries/bancos";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import {
  CULTURA_LABEL, CULTURA_EMOJI, VENDA_STATUS_LABEL,
  type VendaProvisionadaRichRow, type SocioRow,
  type CulturaSafra, type VendaStatus, type Database,
} from "@/types";

const PAGE_SIZE = 12;
const CORES_TRIM = ["#a67c20", "#3a6230", "#5a9485", "#c49830"];

type Form = {
  data_venda: string;
  comprador: string;
  cultura: CulturaSafra;
  safra: string;
  aut_fixacao: string;
  numero_contrato: string;
  nota_fiscal: string;
  kg: string;
  preco_sc: string;
  kg_por_saca: string;
  data_pgto_prevista: string;
  destino_empresa: boolean;
  socio_destino_id: string;
  taxa_armazenagem: string;
  observacao: string;
  status: VendaStatus;
};
const EMPTY: Form = {
  data_venda: new Date().toISOString().slice(0, 10),
  comprador: "",
  cultura: "soja",
  safra: "",
  aut_fixacao: "",
  numero_contrato: "",
  nota_fiscal: "",
  kg: "",
  preco_sc: "",
  kg_por_saca: "60",
  data_pgto_prevista: "",
  destino_empresa: true,
  socio_destino_id: "",
  taxa_armazenagem: "0",
  observacao: "",
  status: "firmada",
};

function statusBadge(s: VendaStatus): BadgeVariant {
  switch (s) {
    case "liquidada": return "success";
    case "firmada":   return "info";
    case "parcial":   return "warning";
    case "cancelada": return "danger";
  }
}

export function VendasFuturasPage() {
  const toast = useToast();

  const [rows, setRows] = useState<VendaProvisionadaRichRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [socios, setSocios] = useState<SocioRow[]>([]);

  // filtros
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<VendaStatus | "">("");
  const [filterCultura, setFilterCultura] = useState<CulturaSafra | "">("");
  const [filterSafra, setFilterSafra] = useState("");
  const [filterDestino, setFilterDestino] = useState<"empresa" | "socio" | "">("");
  const [filterMes, setFilterMes] = useState("");
  const [page, setPage] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const guard = useUnsavedGuard(modalOpen, form, () => setModalOpen(false));
  const [saving, setSaving] = useState(false);

  // ---- load ----
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const filtros: ListarVendasFiltros = {
        search: search || undefined,
        status: filterStatus || undefined,
        cultura: filterCultura || undefined,
        safra: filterSafra || undefined,
        destino: filterDestino || undefined,
        mesRecebimento: filterMes || undefined,
      };
      const data = await listarVendas(filtros);
      setRows(data);
    } catch (e: unknown) {
      toast.error("Erro carregando vendas", (e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filterStatus, filterCultura, filterSafra, filterDestino, filterMes]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    listarSocios().then(setSocios).catch((e) => toast.error("Erro carregando sócios", (e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- derivados ----
  const resumo = useMemo(() => calcularResumo(rows), [rows]);
  const safrasDistintas = useMemo(() => Array.from(new Set(rows.map((r) => r.safra))).sort(), [rows]);
  const mesesDistintos = useMemo(() => Array.from(new Set(rows.map((r) => r.mes_recebimento))).sort(), [rows]);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // ---- handlers ----
  function openNova() {
    setEditId(null);
    setForm({ ...EMPTY });
    setModalOpen(true);
  }
  function openEdit(v: VendaProvisionadaRichRow) {
    setEditId(v.id);
    setForm({
      data_venda: v.data_venda,
      comprador: v.comprador,
      cultura: v.cultura,
      safra: v.safra,
      aut_fixacao: v.aut_fixacao ?? "",
      numero_contrato: v.numero_contrato ?? "",
      nota_fiscal: v.nota_fiscal ?? "",
      kg: String(v.kg),
      preco_sc: String(v.preco_sc),
      kg_por_saca: String(v.kg_por_saca),
      data_pgto_prevista: v.data_pgto_prevista,
      destino_empresa: v.destino_empresa,
      socio_destino_id: v.socio_destino_id ?? "",
      taxa_armazenagem: String(v.taxa_armazenagem),
      observacao: v.observacao ?? "",
      status: v.status,
    });
    setModalOpen(true);
  }
  async function save() {
    if (!form.comprador.trim() || !form.kg || !form.preco_sc || !form.data_pgto_prevista || !form.safra) {
      toast.warning("Campos obrigatórios", "Preencha comprador, safra, quantidade, preço e data prevista.");
      return;
    }
    if (!form.destino_empresa && !form.socio_destino_id) {
      toast.warning("Sócio obrigatório", "Quando o destino é um sócio, é preciso selecioná-lo.");
      return;
    }
    setSaving(true);
    type P = Database["public"]["Tables"]["vendas_provisionadas"]["Insert"];
    const payload: P = {
      data_venda: form.data_venda,
      comprador: form.comprador.trim(),
      cultura: form.cultura,
      safra: form.safra.trim(),
      aut_fixacao: form.aut_fixacao.trim() || null,
      numero_contrato: form.numero_contrato.trim() || null,
      nota_fiscal: form.nota_fiscal.trim() || null,
      kg: Number(form.kg),
      preco_sc: Number(form.preco_sc),
      kg_por_saca: Number(form.kg_por_saca) || 60,
      data_pgto_prevista: form.data_pgto_prevista,
      destino_empresa: form.destino_empresa,
      socio_destino_id: form.destino_empresa ? null : form.socio_destino_id,
      taxa_armazenagem: Number(form.taxa_armazenagem) || 0,
      observacao: form.observacao.trim() || null,
      status: form.status,
      transacao_empresa_id: null,
      origem_planilha: null,
      created_by: null,
    };
    try {
      if (editId) {
        await atualizarVenda(editId, payload);
        toast.success("Venda atualizada");
      } else {
        await criarVenda(payload);
        toast.success("Venda registrada");
      }
      setModalOpen(false);
      await fetchData();
    } catch (e: unknown) {
      toast.error("Não foi possível salvar", (e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function remove(v: VendaProvisionadaRichRow) {
    if (!confirm(`Excluir a venda de ${v.comprador} (${v.numero_contrato ?? "sem contrato"})?`)) return;
    try {
      await deletarVenda(v.id);
      toast.success("Venda excluída");
      await fetchData();
    } catch (e: unknown) {
      toast.error("Não foi possível excluir", (e as Error).message);
    }
  }

  // ---- render ----
  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#0f1f1c]">Vendas Futuras</h1>
          <p className="text-sm text-stone-500">
            Provisionamento de receitas — contratos firmados aguardando pagamento
          </p>
        </div>
        <Button size="sm" onClick={openNova}><Plus size={14} /> Nova Venda</Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Saldo Futuro a Receber"
          value={formatCurrency(resumo.saldo_a_receber)}
          icon={<HandCoins size={16}/>}
          trend="up"
          helpText="Soma dos valores totais das vendas firmadas ou parciais ainda não liquidadas. Define a 'gordurinha' de caixa esperada nos próximos meses."
        />
        <KpiCard
          label="Volume Total Contratado"
          value={formatCurrency(resumo.total_valor)}
          icon={<Wallet size={16}/>}
          helpText="Valor total de TODAS as vendas no filtro atual, incluindo liquidadas e canceladas."
        />
        <KpiCard
          label="Sacas Vendidas"
          value={`${resumo.total_sacas.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} sc`}
          icon={<Sprout size={16}/>}
          helpText="Total de sacas (60kg) já comprometidas em contratos no filtro."
        />
        <KpiCard
          label="Contratos firmados"
          value={`${resumo.total_firmadas} firmadas / ${resumo.total_liquidadas} liquidadas`}
          icon={<CalendarClock size={16}/>}
          helpText="Quantidade de contratos por status. 'Firmada' aguarda pagamento; 'Liquidada' já caiu em caixa."
        />
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Receita por Trimestre</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={resumo.por_trimestre} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" />
                <XAxis dataKey="trimestre" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <RTooltip
                  contentStyle={{ borderRadius: 8, border: "1px solid #e7e5e4", fontSize: 12 }}
                  formatter={(v: unknown) => formatCurrency(Number(v) || 0)}
                />
                <Bar dataKey="valor" name="Receita" radius={[4, 4, 0, 0]}>
                  {resumo.por_trimestre.map((_, i) => (
                    <Cell key={i} fill={CORES_TRIM[i % CORES_TRIM.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Distribuição por Safra</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={resumo.por_safra}
                  dataKey="valor"
                  nameKey="safra"
                  cx="50%" cy="50%"
                  innerRadius={45}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {resumo.por_safra.map((_, i) => (
                    <Cell key={i} fill={CORES_TRIM[i % CORES_TRIM.length]} />
                  ))}
                </Pie>
                <RTooltip formatter={(v: unknown) => formatCurrency(Number(v) || 0)} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Tabela */}
      <Card>
        <CardHeader className="flex-col items-start gap-3 lg:flex-row lg:items-center">
          <CardTitle>Contratos de Venda</CardTitle>
          <div className="flex items-center gap-2 flex-wrap ml-auto">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Comprador, contrato, NF..."
                className="h-8 rounded-lg border border-stone-200 pl-8 pr-3 text-xs w-56 focus:outline-none focus:ring-1 focus:ring-accent-400"
              />
            </div>
            <select value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value as VendaStatus | ""); setPage(1); }}
              className="h-8 rounded-lg border border-stone-200 px-2 text-xs">
              <option value="">Todos status</option>
              {(Object.keys(VENDA_STATUS_LABEL) as VendaStatus[]).map((s) =>
                <option key={s} value={s}>{VENDA_STATUS_LABEL[s]}</option>)}
            </select>
            <select value={filterCultura}
              onChange={(e) => { setFilterCultura(e.target.value as CulturaSafra | ""); setPage(1); }}
              className="h-8 rounded-lg border border-stone-200 px-2 text-xs">
              <option value="">Todas culturas</option>
              {(Object.keys(CULTURA_LABEL) as CulturaSafra[]).map((c) =>
                <option key={c} value={c}>{CULTURA_LABEL[c]}</option>)}
            </select>
            <select value={filterSafra}
              onChange={(e) => { setFilterSafra(e.target.value); setPage(1); }}
              className="h-8 rounded-lg border border-stone-200 px-2 text-xs">
              <option value="">Todas safras</option>
              {safrasDistintas.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={filterDestino}
              onChange={(e) => { setFilterDestino(e.target.value as "empresa" | "socio" | ""); setPage(1); }}
              className="h-8 rounded-lg border border-stone-200 px-2 text-xs">
              <option value="">Todos destinos</option>
              <option value="empresa">Empresa Aramburu</option>
              <option value="socio">Sócios (direto)</option>
            </select>
            <select value={filterMes}
              onChange={(e) => { setFilterMes(e.target.value); setPage(1); }}
              className="h-8 rounded-lg border border-stone-200 px-2 text-xs">
              <option value="">Todos meses</option>
              {mesesDistintos.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-100">
                  {["Cultura","Safra","Comprador","Contrato/NF","Sacas","R$/sc","Valor Total","Pgto Previsto","Destino","Status","Ações"].map((h) => (
                    <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={11} className="px-4 py-12 text-center text-stone-400">
                    <Loader2 size={18} className="inline-block animate-spin mr-2" /> Carregando…
                  </td></tr>
                )}
                {!loading && paged.length === 0 && (
                  <tr><td colSpan={11} className="px-4 py-12 text-center text-stone-400">
                    Nenhuma venda encontrada.
                  </td></tr>
                )}
                {!loading && paged.map((v) => (
                  <tr key={v.id} className="border-b border-stone-50 hover:bg-stone-50 transition-colors table-row-alt">
                    <td className="px-3 py-3 text-stone-700 whitespace-nowrap">
                      <span className="mr-1">{CULTURA_EMOJI[v.cultura]}</span>
                      {CULTURA_LABEL[v.cultura]}
                    </td>
                    <td className="px-3 py-3 text-stone-700 text-xs">{v.safra}</td>
                    <td className="px-3 py-3 text-stone-700 font-medium">{v.comprador}</td>
                    <td className="px-3 py-3 text-stone-500 text-xs font-mono">
                      {v.numero_contrato && <div>#{v.numero_contrato}</div>}
                      {v.nota_fiscal && <div>NF {v.nota_fiscal}</div>}
                    </td>
                    <td className="px-3 py-3 text-stone-700 text-right">{v.sacas.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}</td>
                    <td className="px-3 py-3 text-stone-700 text-right text-xs">{formatCurrency(v.preco_sc)}</td>
                    <td className="px-3 py-3 font-semibold text-emerald-700 whitespace-nowrap text-right">{formatCurrency(v.valor_total)}</td>
                    <td className="px-3 py-3 text-stone-500 text-xs whitespace-nowrap">
                      <div>{formatDate(v.data_pgto_prevista)}</div>
                      <div className="text-stone-400 text-[10px]">{v.trimestre_recebimento}</div>
                    </td>
                    <td className="px-3 py-3 text-stone-700 text-xs">
                      {v.destino_empresa
                        ? <Badge variant="info">Aramburu</Badge>
                        : <Badge variant="accent">{v.socio_destino_apelido ?? v.socio_destino_nome ?? "Sócio"}</Badge>}
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant={statusBadge(v.status)}>{VENDA_STATUS_LABEL[v.status]}</Badge>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(v)} className="p-1.5 rounded hover:bg-primary-50 text-stone-400 hover:text-primary-600 transition" title="Editar"><Edit2 size={13}/></button>
                        <button onClick={() => remove(v)} className="p-1.5 rounded hover:bg-red-50 text-stone-400 hover:text-red-500 transition" title="Excluir"><Trash2 size={13}/></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              {!loading && rows.length > 0 && (
                <tfoot>
                  <tr className="bg-stone-50 border-t-2 border-stone-200 font-semibold text-stone-700">
                    <td colSpan={4} className="px-3 py-3 text-xs uppercase tracking-wide">Total</td>
                    <td className="px-3 py-3 text-right text-xs">{resumo.total_sacas.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} sc</td>
                    <td></td>
                    <td className="px-3 py-3 text-right text-emerald-700">{formatCurrency(resumo.total_valor)}</td>
                    <td colSpan={4}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-t border-stone-100">
            <p className="text-xs text-stone-400">
              {loading ? "…" : `${rows.length} venda${rows.length === 1 ? "" : "s"}`}
            </p>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </CardContent>
      </Card>

      {/* Modal CRUD */}
      <Modal open={modalOpen} onClose={guard.requestClose}
        title={editId ? "Editar Venda" : "Nova Venda"} size="lg">
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Input label="Data da Venda *" type="date" value={form.data_venda}
              onChange={(e) => setForm({ ...form, data_venda: e.target.value })} />
            <Input label="Comprador *" placeholder="Copasul" value={form.comprador}
              onChange={(e) => setForm({ ...form, comprador: e.target.value })} />
            <Select label="Status" value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as VendaStatus })}>
              {(Object.keys(VENDA_STATUS_LABEL) as VendaStatus[]).map((s) =>
                <option key={s} value={s}>{VENDA_STATUS_LABEL[s]}</option>)}
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Select label="Cultura *" value={form.cultura}
              onChange={(e) => setForm({ ...form, cultura: e.target.value as CulturaSafra })}>
              {(Object.keys(CULTURA_LABEL) as CulturaSafra[]).map((c) =>
                <option key={c} value={c}>{CULTURA_EMOJI[c]} {CULTURA_LABEL[c]}</option>)}
            </Select>
            <Input label="Safra *" placeholder="24/25" value={form.safra}
              onChange={(e) => setForm({ ...form, safra: e.target.value })} />
            <Input label="Data Prevista do Pgto *" type="date" value={form.data_pgto_prevista}
              onChange={(e) => setForm({ ...form, data_pgto_prevista: e.target.value })} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Input label="Quantidade (kg) *" type="number" step="0.001"
              value={form.kg} onChange={(e) => setForm({ ...form, kg: e.target.value })} />
            <Input label="Preço por Saca (R$) *" type="number" step="0.0001"
              value={form.preco_sc} onChange={(e) => setForm({ ...form, preco_sc: e.target.value })} />
            <Input label="kg por Saca" type="number" step="0.01"
              value={form.kg_por_saca} onChange={(e) => setForm({ ...form, kg_por_saca: e.target.value })} />
          </div>

          {form.kg && form.preco_sc && (
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-2 text-xs text-emerald-700 flex items-center gap-3">
              <ArrowDownToLine size={14} />
              <span>
                <strong>{(Number(form.kg) / (Number(form.kg_por_saca) || 60)).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} sacas</strong>
                {" × "}
                <strong>{formatCurrency(Number(form.preco_sc))}</strong>
                {" = "}
                <strong>{formatCurrency((Number(form.kg) / (Number(form.kg_por_saca) || 60)) * Number(form.preco_sc))}</strong>
              </span>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <Input label="Autorização de Fixação" placeholder="153076" value={form.aut_fixacao}
              onChange={(e) => setForm({ ...form, aut_fixacao: e.target.value })} />
            <Input label="Nº Contrato" value={form.numero_contrato}
              onChange={(e) => setForm({ ...form, numero_contrato: e.target.value })} />
            <Input label="Nota Fiscal" placeholder="8066969" value={form.nota_fiscal}
              onChange={(e) => setForm({ ...form, nota_fiscal: e.target.value })} />
          </div>

          <div className="rounded-lg border border-stone-200 p-3 space-y-3">
            <p className="text-xs font-semibold text-stone-600 uppercase tracking-wide">Destino do recebimento</p>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={form.destino_empresa}
                  onChange={() => setForm({ ...form, destino_empresa: true })} />
                <span className="text-sm">Empresa Aramburu</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={!form.destino_empresa}
                  onChange={() => setForm({ ...form, destino_empresa: false })} />
                <span className="text-sm">Sócio direto</span>
              </label>
            </div>
            {!form.destino_empresa && (
              <Select label="Sócio destinatário *" value={form.socio_destino_id}
                onChange={(e) => setForm({ ...form, socio_destino_id: e.target.value })}>
                <option value="">Selecione…</option>
                {socios.map((s) => <option key={s.id} value={s.id}>{s.nome_completo}</option>)}
              </Select>
            )}
          </div>

          <Input label="Taxa de Armazenagem (R$)" type="number" step="0.01"
            value={form.taxa_armazenagem}
            onChange={(e) => setForm({ ...form, taxa_armazenagem: e.target.value })}
          />

          <Textarea label="Observações" rows={2}
            value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })}
            placeholder="Ex: pagamento em 4 parcelas (jan/mar/mar/jul)" />

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={guard.requestClose}>Cancelar</Button>
            <Button onClick={save} loading={saving} disabled={saving}>
              {editId ? "Salvar Alterações" : "Adicionar"}
            </Button>
          </div>
        </div>
      </Modal>
      <UnsavedChangesDialog open={guard.confirmOpen} onStay={guard.stay} onDiscard={guard.discard} />
    </div>
  );
}
