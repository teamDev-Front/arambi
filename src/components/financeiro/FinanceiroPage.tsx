"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { KpiCard } from "@/components/ui/KpiCard";
import { Modal } from "@/components/ui/Modal";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { MultiSelect } from "@/components/ui/MultiSelect";
import { Pagination } from "@/components/ui/Pagination";
import { RelatorioEscopoModal } from "@/components/financeiro/RelatorioEscopoModal";
import type { ListarTransacoesFiltros } from "@/lib/queries/financeiro";
import {
  Plus, FileText, Search, Edit2, Trash2,
  TrendingUp, TrendingDown, Loader2,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import {
  listarTransacoesEmpresa,
  criarTransacaoEmpresa,
  atualizarTransacaoEmpresa,
  deletarTransacaoEmpresa,
  listarClassificacoes,
  listarContasEmpresa,
  listarMesesDistintos,
  type TransacaoEmpresaRich,
} from "@/lib/queries/financeiro";
import {
  STATUS_ARAMBURU_LABEL,
  FORMA_PGTO_LABEL,
  TIPO_DESPESA_LABEL,
  OBS_OBRA_LABEL,
  STATUS_KIND,
  type StatusAramburu,
  type FormaPgto,
  type TipoDespesa,
  type ObsObra,
  type ClassificacaoFinanceiraRow,
  type ContaBancariaEmpresaRow,
  type TransacaoEmpresaInsert,
} from "@/types";
import { useToast } from "@/components/ui/Toast";

const PAGE_SIZE = 25;

type FormState = {
  data: string;            // Vencimento
  data_emissao: string;    // Emissão (opcional)
  conta_contabil_cod: string;
  centro_custo_cod: string;
  tipo_despesa: TipoDespesa;
  fornecedor_nome: string;
  descricao: string;
  obs_obra: ObsObra;
  ref: string;
  parcelas: string;
  forma_pgto: FormaPgto;
  conta_bancaria_id: string;
  status: StatusAramburu;
  valor: string;
  observacao: string;
};

const EMPTY_FORM: FormState = {
  data: new Date().toISOString().slice(0, 10),
  data_emissao: "",
  conta_contabil_cod: "",
  centro_custo_cod: "",
  tipo_despesa: "sem",
  fornecedor_nome: "",
  descricao: "",
  obs_obra: "sem",
  ref: "",
  parcelas: "",
  forma_pgto: "sem",
  conta_bancaria_id: "",
  status: "pago",
  valor: "",
  observacao: "",
};

export function FinanceiroPage() {
  const toast = useToast();

  // ---- dados ----
  const [rows, setRows] = useState<TransacaoEmpresaRich[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // ---- lookups (carregados uma vez) ----
  const [classificacoes, setClassificacoes] = useState<ClassificacaoFinanceiraRow[]>([]);
  const [bancos, setBancos] = useState<ContaBancariaEmpresaRow[]>([]);
  const [meses, setMeses] = useState<string[]>([]);

  // ---- filtros / UI ----
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<StatusAramburu | "">("");
  const [filterContaContabil, setFilterContaContabil] = useState("");
  const [filterCentroCusto, setFilterCentroCusto] = useState<string[]>([]);
  const [filterMes, setFilterMes] = useState("");
  const [filterBanco, setFilterBanco] = useState("");
  const [page, setPage] = useState(1);

  // ---- seleção manual p/ relatório por escopo (RF-FIN-09) ----
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [escopoOpen, setEscopoOpen] = useState(false);
  const [escopoTipo, setEscopoTipo] = useState<"por_filtros" | "por_selecao">("por_filtros");

  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // ---- derivados ----
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const classificacoesN2 = useMemo(
    () => classificacoes.filter((c) => c.nivel === 2),
    [classificacoes],
  );
  const classificacoesN3 = useMemo(
    () => classificacoes.filter((c) => c.nivel === 3),
    [classificacoes],
  );
  const childrenOf = useCallback(
    (parent: string) => classificacoesN3.filter((c) => c.parent_codigo === parent),
    [classificacoesN3],
  );

  // KPI rápida das linhas exibidas (nem todas as 731 — é "do que tá em tela")
  const kpis = useMemo(() => {
    const r: { entradas: number; saidas: number; aPagar: number } = { entradas: 0, saidas: 0, aPagar: 0 };
    for (const t of rows) {
      const k = STATUS_KIND[t.status];
      if (t.status === "a_pagar" || t.status === "a_repassar" || t.status === "a_aplicar") {
        r.aPagar += -t.valor;
      } else if (k === "entrada") r.entradas += t.valor;
      else if (k === "saida")   r.saidas   += -t.valor;
    }
    return r;
  }, [rows]);

  // ---- seleção (RF-FIN-09) ----
  const allPageSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const togglePageSelection = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (rows.length > 0 && rows.every((r) => next.has(r.id))) rows.forEach((r) => next.delete(r.id));
      else rows.forEach((r) => next.add(r.id));
      return next;
    });
  }, [rows]);
  const toggleOneSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Filtros atuais (para gerar relatório pelo recorte) e competência sugerida.
  const filtrosAtuais: ListarTransacoesFiltros = useMemo(() => ({
    search: search || undefined,
    status: filterStatus || undefined,
    contaContabilCod: filterContaContabil || undefined,
    centroCustoCod: filterCentroCusto.length ? filterCentroCusto : undefined,
    contaBancariaId: filterBanco || undefined,
    mesReferencia: filterMes || undefined,
  }), [search, filterStatus, filterContaContabil, filterCentroCusto, filterBanco, filterMes]);
  const competenciaSugerida = filterMes || new Date().toISOString().slice(0, 7);

  function abrirEscopo() {
    setEscopoTipo(selectedIds.size > 0 ? "por_selecao" : "por_filtros");
    setEscopoOpen(true);
  }

  // ---- effects ----
  // lookups
  useEffect(() => {
    Promise.all([listarClassificacoes(), listarContasEmpresa(), listarMesesDistintos()])
      .then(([cf, cb, m]) => { setClassificacoes(cf); setBancos(cb); setMeses(m); })
      .catch((e: unknown) =>
        toast.error("Erro carregando cadastros", (e as Error).message ?? String(e))
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // dados (refetch sempre que filtros / page mudam)
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { rows, total } = await listarTransacoesEmpresa(
        {
          search: search || undefined,
          status: filterStatus || undefined,
          contaContabilCod: filterContaContabil || undefined,
          centroCustoCod: filterCentroCusto.length ? filterCentroCusto : undefined,
          contaBancariaId: filterBanco || undefined,
          mesReferencia: filterMes || undefined,
        },
        page,
        PAGE_SIZE,
      );
      setRows(rows);
      setTotal(total);
    } catch (e: unknown) {
      toast.error("Erro carregando lançamentos", (e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filterStatus, filterContaContabil, filterCentroCusto, filterBanco, filterMes, page]);
  // fetchData sincroniza a tabela com os filtros/página — o setState interno é intencional.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData(); }, [fetchData]);

  // ---- ações ----
  function openNew() {
    setEditId(null);
    setForm({ ...EMPTY_FORM });
    setModalOpen(true);
  }
  function openEdit(row: TransacaoEmpresaRich) {
    setEditId(row.id);
    setForm({
      data: row.data,
      data_emissao: row.data_emissao ?? "",
      conta_contabil_cod: row.conta_contabil_cod,
      centro_custo_cod: row.centro_custo_cod,
      tipo_despesa: row.tipo_despesa,
      fornecedor_nome: row.fornecedor_nome ?? "",
      descricao: row.descricao ?? "",
      obs_obra: row.obs_obra,
      ref: row.ref ?? "",
      parcelas: row.parcelas ?? "",
      forma_pgto: row.forma_pgto,
      conta_bancaria_id: row.conta_bancaria_id ?? "",
      status: row.status,
      valor: String(row.valor),
      observacao: row.observacao ?? "",
    });
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.data || !form.conta_contabil_cod || !form.centro_custo_cod || !form.valor) return;
    const payload: TransacaoEmpresaInsert = {
      data: form.data,
      data_emissao: form.data_emissao || null,
      conta_contabil_cod: form.conta_contabil_cod,
      centro_custo_cod: form.centro_custo_cod,
      tipo_despesa: form.tipo_despesa,
      fornecedor_id: null,
      fornecedor_nome: form.fornecedor_nome || null,
      descricao: form.descricao || null,
      obs_obra: form.obs_obra,
      ref: form.ref || null,
      parcelas: form.parcelas || null,
      forma_pgto: form.forma_pgto,
      conta_bancaria_id: form.conta_bancaria_id || null,
      status: form.status,
      valor: Number(form.valor),
      observacao: form.observacao || null,
      origem_planilha: null,
      created_by: null,
    };
    setSaving(true);
    try {
      if (editId) {
        await atualizarTransacaoEmpresa(editId, payload);
        toast.success("Lançamento atualizado");
      } else {
        await criarTransacaoEmpresa(payload);
        toast.success("Lançamento criado");
      }
      setModalOpen(false);
      await fetchData();
    } catch (e: unknown) {
      const msg = (e as Error).message ?? String(e);
      toast.error(editId ? "Não foi possível atualizar" : "Não foi possível criar", msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Excluir este lançamento?")) return;
    try {
      await deletarTransacaoEmpresa(id);
      toast.success("Lançamento excluído");
      await fetchData();
    } catch (e: unknown) {
      toast.error("Não foi possível excluir", (e as Error).message ?? String(e));
    }
  }

  // ---- render ----
  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#0f1f1c]">Financeiro</h1>
          <p className="text-sm text-stone-500">
            Lançamentos da Agropecuária Aramburu — espelho da planilha {`"Aramburu_Mensal"`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={abrirEscopo}
            title="Gera o relatório a partir do recorte atual (filtros ou itens selecionados)">
            <FileText size={14} /> {selectedIds.size > 0 ? `Gerar de ${selectedIds.size} selec.` : "Gerar do recorte"}
          </Button>
          <Link href="/dashboard/relatorios">
            <Button variant="ghost" size="sm">Relatórios PDF</Button>
          </Link>
          <Button size="sm" onClick={openNew}><Plus size={14} /> Nova Transação</Button>
        </div>
      </div>

      {/* KPIs (página atual) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard
          label="Entradas (página)"
          value={formatCurrency(kpis.entradas)}
          icon={<TrendingUp size={16}/>}
          helpText="Soma dos lançamentos com status de entrada (Recebido, Resgatado, Aplicação, etc.) APENAS da página atual."
        />
        <KpiCard
          label="Saídas (página)"
          value={formatCurrency(kpis.saidas)}
          icon={<TrendingDown size={16}/>}
          helpText="Soma das saídas realizadas (Pago, Repassado, Aplicado) APENAS da página atual."
        />
        <KpiCard
          label="A pagar (página)"
          value={formatCurrency(kpis.aPagar)}
          icon={<TrendingDown size={16}/>}
          trend="down"
          helpText="Compromissos em aberto (A pagar, A repassar, A aplicar) na página atual. Use os filtros para somar o mês inteiro."
        />
      </div>

      {/* Tabela */}
      <Card>
        <CardHeader className="flex-col items-start gap-3 lg:flex-row lg:items-center lg:gap-2">
          <CardTitle>Lançamentos</CardTitle>
          <div className="flex items-center gap-2 flex-wrap ml-auto">
            <div className="relative" title="Busca por descrição, fornecedor ou referência (NF / recibo / nº contrato)">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Buscar descrição, fornecedor, NF, recibo..."
                className="h-8 rounded-lg border border-stone-200 pl-8 pr-3 text-xs w-72 focus:outline-none focus:ring-1 focus:ring-accent-400"
              />
            </div>
            <select
              value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value as StatusAramburu | ""); setPage(1); }}
              className="h-8 rounded-lg border border-stone-200 px-2 text-xs"
            >
              <option value="">Todos os status</option>
              {(Object.keys(STATUS_ARAMBURU_LABEL) as StatusAramburu[]).map((s) => (
                <option key={s} value={s}>{STATUS_ARAMBURU_LABEL[s]}</option>
              ))}
            </select>
            <select
              value={filterContaContabil}
              onChange={(e) => { setFilterContaContabil(e.target.value); setPage(1); }}
              className="h-8 rounded-lg border border-stone-200 px-2 text-xs"
            >
              <option value="">Todas as contas</option>
              {classificacoesN2.map((c) => (
                <option key={c.codigo} value={c.codigo}>{c.codigo} – {c.nome}</option>
              ))}
            </select>
            <MultiSelect
              className="w-44"
              value={filterCentroCusto}
              onChange={(v) => { setFilterCentroCusto(v); setPage(1); }}
              options={classificacoesN3.map((c) => ({ value: c.codigo, label: `${c.codigo} – ${c.nome}` }))}
              placeholder="Todos os centros de custo"
              searchPlaceholder="Buscar centro de custo…"
              emptyText="Nenhum centro de custo"
              unitLabel="centros"
            />
            <select
              value={filterMes}
              onChange={(e) => { setFilterMes(e.target.value); setPage(1); }}
              className="h-8 rounded-lg border border-stone-200 px-2 text-xs"
            >
              <option value="">Todos os meses</option>
              {meses.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select
              value={filterBanco}
              onChange={(e) => { setFilterBanco(e.target.value); setPage(1); }}
              className="h-8 rounded-lg border border-stone-200 px-2 text-xs"
            >
              <option value="">Todos os bancos</option>
              {bancos.map((b) => <option key={b.id} value={b.id}>{b.apelido ?? b.nome}</option>)}
            </select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-100">
                  <th className="px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todos da página"
                      checked={allPageSelected}
                      onChange={togglePageSelection}
                      className="h-3.5 w-3.5 rounded border-stone-300 accent-accent-500 cursor-pointer"
                    />
                  </th>
                  {["Vencimento","Emissão","Conta","Centro de Custo","Descrição","Fornecedor","Banco","Status","Valor","Ações"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={11} className="px-4 py-12 text-center text-stone-400">
                    <Loader2 size={18} className="inline-block animate-spin mr-2" />
                    Carregando…
                  </td></tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={11} className="px-4 py-12 text-center text-stone-400">
                    Nenhuma transação encontrada.
                  </td></tr>
                )}
                {!loading && rows.map((t) => {
                  const kind = STATUS_KIND[t.status];
                  const selected = selectedIds.has(t.id);
                  return (
                    <tr key={t.id} className={`border-b border-stone-50 transition-colors table-row-alt ${selected ? "bg-accent-50/60" : "hover:bg-stone-50"}`}>
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          aria-label="Selecionar lançamento"
                          checked={selected}
                          onChange={() => toggleOneSelection(t.id)}
                          className="h-3.5 w-3.5 rounded border-stone-300 accent-accent-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3 text-stone-500 text-xs whitespace-nowrap">{formatDate(t.data)}</td>
                      <td className="px-4 py-3 text-stone-500 text-xs whitespace-nowrap">
                        {t.data_emissao ? formatDate(t.data_emissao) : <span className="text-stone-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-stone-700 text-xs">
                        <div className="font-medium text-stone-700">{t.conta_contabil?.nome ?? t.conta_contabil_cod}</div>
                        <div className="text-stone-400 text-[10px]">{t.conta_contabil_cod}</div>
                      </td>
                      <td className="px-4 py-3 text-stone-700 text-xs">
                        <div>{t.centro_custo?.nome ?? t.centro_custo_cod}</div>
                        <div className="text-stone-400 text-[10px]">{t.centro_custo_cod}</div>
                      </td>
                      <td className="px-4 py-3 text-stone-700 max-w-[220px] truncate" title={t.descricao ?? ""}>
                        {t.descricao || <span className="text-stone-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-stone-500 text-xs max-w-[160px] truncate" title={t.fornecedor_nome ?? ""}>
                        {t.fornecedor_nome || <span className="text-stone-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-stone-500 text-xs">
                        {t.conta_bancaria?.apelido ?? t.conta_bancaria?.nome ?? <span className="text-stone-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={t.status} />
                      </td>
                      <td className={`px-4 py-3 font-semibold text-sm whitespace-nowrap ${kind === "entrada" ? "text-green-700" : kind === "saida" ? "text-red-600" : "text-stone-700"}`}>
                        {formatCurrency(t.valor)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEdit(t)} className="p-1.5 rounded hover:bg-primary-50 text-stone-400 hover:text-primary-600 transition" title="Editar">
                            <Edit2 size={13} />
                          </button>
                          <button onClick={() => handleDelete(t.id)} className="p-1.5 rounded hover:bg-red-50 text-stone-400 hover:text-red-500 transition" title="Excluir">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-t border-stone-100 gap-3 flex-wrap">
            <div className="flex items-center gap-3 text-xs text-stone-400">
              <span>{loading ? "…" : `${total} lançamento${total === 1 ? "" : "s"}`}</span>
              {selectedIds.size > 0 && (
                <span className="inline-flex items-center gap-2 text-accent-600 font-medium">
                  {selectedIds.size} selecionado{selectedIds.size === 1 ? "" : "s"}
                  <button onClick={() => setSelectedIds(new Set())} className="text-stone-400 hover:text-stone-600 underline">
                    limpar
                  </button>
                </span>
              )}
            </div>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </CardContent>
      </Card>

      {/* Modal CRUD */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editId ? "Editar Lançamento" : "Novo Lançamento"}
        size="lg"
      >
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Vencimento" type="date" value={form.data}
              onChange={(e) => setForm({ ...form, data: e.target.value })} />
            <Input label="Emissão (opcional)" type="date" value={form.data_emissao}
              onChange={(e) => setForm({ ...form, data_emissao: e.target.value })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Select label="Tipo de Despesa" value={form.tipo_despesa}
              onChange={(e) => setForm({ ...form, tipo_despesa: e.target.value as TipoDespesa })}>
              {Object.entries(TIPO_DESPESA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select label="Status" value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as StatusAramburu })}>
              {Object.entries(STATUS_ARAMBURU_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Select label="Conta Contábil"
              value={form.conta_contabil_cod}
              onChange={(e) => setForm({ ...form, conta_contabil_cod: e.target.value, centro_custo_cod: "" })}>
              <option value="">Selecione…</option>
              {classificacoesN2.map((c) => (
                <option key={c.codigo} value={c.codigo}>{c.codigo} – {c.nome}</option>
              ))}
            </Select>
            <Select label="Centro de Custo"
              value={form.centro_custo_cod}
              disabled={!form.conta_contabil_cod}
              onChange={(e) => setForm({ ...form, centro_custo_cod: e.target.value })}>
              <option value="">Selecione…</option>
              {childrenOf(form.conta_contabil_cod).map((c) => (
                <option key={c.codigo} value={c.codigo}>{c.codigo} – {c.nome}</option>
              ))}
            </Select>
          </div>

          <Input label="Descrição" value={form.descricao}
            onChange={(e) => setForm({ ...form, descricao: e.target.value })}
            placeholder="Descrição do lançamento" />

          <div className="grid grid-cols-2 gap-3">
            <Input label="Fornecedor / contraparte" value={form.fornecedor_nome}
              onChange={(e) => setForm({ ...form, fornecedor_nome: e.target.value })} />
            <Input label="Valor (R$, negativo = saída)" type="number" step="0.01"
              value={form.valor}
              onChange={(e) => setForm({ ...form, valor: e.target.value })} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Select label="Forma de Pgto" value={form.forma_pgto}
              onChange={(e) => setForm({ ...form, forma_pgto: e.target.value as FormaPgto })}>
              {Object.entries(FORMA_PGTO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select label="Banco" value={form.conta_bancaria_id}
              onChange={(e) => setForm({ ...form, conta_bancaria_id: e.target.value })}>
              <option value="">—</option>
              {bancos.map((b) => <option key={b.id} value={b.id}>{b.apelido ?? b.nome}</option>)}
            </Select>
            <Select label="Obs. Obra" value={form.obs_obra}
              onChange={(e) => setForm({ ...form, obs_obra: e.target.value as ObsObra })}>
              {Object.entries(OBS_OBRA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label="Referência (NF / recibo)" value={form.ref}
              onChange={(e) => setForm({ ...form, ref: e.target.value })}
              placeholder='NF 12345 / "AGUARDANDO NF"' />
            <Input label="Parcelas (n/N)" value={form.parcelas}
              onChange={(e) => setForm({ ...form, parcelas: e.target.value })}
              placeholder="2/12" />
          </div>

          <Textarea label="Observação" value={form.observacao}
            onChange={(e) => setForm({ ...form, observacao: e.target.value })}
            rows={2} placeholder="Anotações livres (exceções, regras especiais…)" />

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} loading={saving} disabled={saving}>
              {editId ? "Salvar Alterações" : "Adicionar"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Geração de relatório pelo recorte (RF-FIN-09) */}
      <RelatorioEscopoModal
        open={escopoOpen}
        onClose={() => setEscopoOpen(false)}
        scopeType={escopoTipo}
        filtros={filtrosAtuais}
        transacaoIds={Array.from(selectedIds)}
        mesReferenciaDefault={competenciaSugerida}
      />
    </div>
  );
}
