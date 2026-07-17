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
  FileDown, FileSpreadsheet, CalendarRange,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import {
  listarTransacoesEmpresa,
  listarTransacoesParaExport,
  criarTransacaoEmpresa,
  atualizarTransacaoEmpresa,
  deletarTransacaoEmpresa,
  listarClassificacoes,
  listarContasEmpresa,
  listarMesesDisponiveis,
  type TransacaoEmpresaRich,
} from "@/lib/queries/financeiro";
import {
  exportFinanceiroPdf,
  exportFinanceiroXlsx,
  type FinanceiroExportMeta,
} from "@/lib/export/financeiro-export";
import {
  criarDetalhado,
  listarSocios,
  listarClassificacoesPessoais,
  listarContasDoSocio,
} from "@/lib/queries/distribuicao";
import { useStatusConfig, getStatusLabel } from "@/lib/utils/status-config";
import {
  FORMA_PGTO_LABEL,
  TIPO_DESPESA_LABEL,
  OBS_OBRA_LABEL,
  STATUS_KIND,
  STATUS_DL_LABEL,
  type StatusAramburu,
  type StatusDL,
  type FormaPgto,
  type TipoDespesa,
  type ObsObra,
  type ClassificacaoFinanceiraRow,
  type ContaBancariaEmpresaRow,
  type TransacaoEmpresaInsert,
  type TransacaoSocioInsert,
  type SocioRow,
  type ClassificacaoPessoalRow,
  type ContaBancariaSocioRow,
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
  const [filterStatus, setFilterStatus] = useState<StatusAramburu[]>([]);
  const [filterContaContabil, setFilterContaContabil] = useState("");
  const [filterCentroCusto, setFilterCentroCusto] = useState<string[]>([]);
  const [filterMes, setFilterMes] = useState("");
  const [filterBanco, setFilterBanco] = useState("");
  // Filtro por período/intervalo de dias (UX-02). Mutuamente exclusivo com o mês.
  const [filterDataDe, setFilterDataDe] = useState("");
  const [filterDataAte, setFilterDataAte] = useState("");
  const [page, setPage] = useState(1);

  // ---- exportação (REL-01/02) ----
  const [exportandoPdf, setExportandoPdf] = useState(false);
  const [exportandoXlsx, setExportandoXlsx] = useState(false);

  // ---- seleção manual p/ relatório por escopo (RF-FIN-09) ----
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [escopoOpen, setEscopoOpen] = useState(false);
  const [escopoTipo, setEscopoTipo] = useState<"por_filtros" | "por_selecao">("por_filtros");

  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // ---- saída global × detalhada (call 24-jun: conta 2.8 Distribuição de Lucro) ----
  // "Global" = lançamento normal da empresa (Cora → Inter). "Detalhada" = linha
  // por sócio, gravada em transacoes_socio (o detalhado da tela Distribuição).
  const [tipoSaida, setTipoSaida] = useState<"global" | "detalhada">("global");
  const [socios, setSocios] = useState<SocioRow[]>([]);
  const [classifsPessoais, setClassifsPessoais] = useState<ClassificacaoPessoalRow[]>([]);
  const [contasSocio, setContasSocio] = useState<ContaBancariaSocioRow[]>([]);
  const [dlSocioId, setDlSocioId] = useState("");
  const [dlClassif, setDlClassif] = useState("");
  const [dlContaSocioId, setDlContaSocioId] = useState("");
  const [dlStatus, setDlStatus] = useState<StatusDL>("provisionado");
  const mostraTipoSaida = form.conta_contabil_cod === "2.8" && !editId;
  const salvandoDetalhada = mostraTipoSaida && tipoSaida === "detalhada";

  // Lookups da saída detalhada — carregados só quando a opção aparece.
  useEffect(() => {
    if (!mostraTipoSaida || socios.length > 0) return;
    Promise.all([listarSocios(), listarClassificacoesPessoais()])
      .then(([s, c]) => { setSocios(s); setClassifsPessoais(c); })
      .catch((e: unknown) => toast.error("Erro carregando sócios", (e as Error).message ?? String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mostraTipoSaida]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset síncrono intencional ao trocar de sócio
    if (!dlSocioId) { setContasSocio([]); return; }
    listarContasDoSocio(dlSocioId)
      .then(setContasSocio)
      .catch((e: unknown) => toast.error("Erro carregando contas do sócio", (e as Error).message ?? String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dlSocioId]);

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

  // Status data-driven (Admin → Status & Cores). Ativos para os filtros/seleções.
  const { entries: statusEntries } = useStatusConfig();
  const statusAtivos = useMemo(() => statusEntries.filter((e) => e.ativo), [statusEntries]);

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
    status: filterStatus.length ? filterStatus : undefined,
    contaContabilCod: filterContaContabil || undefined,
    centroCustoCod: filterCentroCusto.length ? filterCentroCusto : undefined,
    contaBancariaId: filterBanco || undefined,
    mesReferencia: filterMes || undefined,
    dataDe: filterDataDe || undefined,
    dataAte: filterDataAte || undefined,
  }), [search, filterStatus, filterContaContabil, filterCentroCusto, filterBanco, filterMes, filterDataDe, filterDataAte]);
  const competenciaSugerida = filterMes || new Date().toISOString().slice(0, 7);

  function abrirEscopo() {
    setEscopoTipo(selectedIds.size > 0 ? "por_selecao" : "por_filtros");
    setEscopoOpen(true);
  }

  // ---- exportação espelho-da-tela (REL-01/02) ----
  const montarMetaExport = useCallback((): FinanceiroExportMeta => {
    const f: string[] = [];
    if (search) f.push(`Busca: "${search}"`);
    if (filterStatus.length) f.push(`Status: ${filterStatus.map((s) => getStatusLabel(s)).join(", ")}`);
    if (filterContaContabil) {
      const c = classificacoesN2.find((x) => x.codigo === filterContaContabil);
      f.push(`Conta: ${filterContaContabil}${c ? ` – ${c.nome}` : ""}`);
    }
    if (filterCentroCusto.length) {
      f.push(`Centro de custo: ${filterCentroCusto.map((cod) => {
        const c = classificacoesN3.find((x) => x.codigo === cod);
        return c ? `${cod} – ${c.nome}` : cod;
      }).join(", ")}`);
    }
    if (filterBanco) {
      const b = bancos.find((x) => x.id === filterBanco);
      f.push(`Banco: ${b?.apelido ?? b?.nome ?? filterBanco}`);
    }
    if (filterMes) f.push(`Mês: ${filterMes}`);
    if (filterDataDe || filterDataAte) {
      f.push(`Período: ${filterDataDe ? formatDate(filterDataDe) : "…"} a ${filterDataAte ? formatDate(filterDataAte) : "…"}`);
    }
    const escopo = selectedIds.size > 0
      ? `Seleção manual — ${selectedIds.size} lançamento${selectedIds.size === 1 ? "" : "s"}`
      : "Recorte pelos filtros aplicados na tela";
    return { titulo: "Relatório de Lançamentos Financeiros", escopo, filtros: f };
  }, [search, filterStatus, filterContaContabil, filterCentroCusto, filterBanco, filterMes,
      filterDataDe, filterDataAte, selectedIds, classificacoesN2, classificacoesN3, bancos]);

  async function handleExport(formato: "pdf" | "xlsx") {
    const setBusy = formato === "pdf" ? setExportandoPdf : setExportandoXlsx;
    setBusy(true);
    try {
      const { rows: exportRows, total: totalExport, capped } = await listarTransacoesParaExport(
        selectedIds.size > 0
          ? { transacaoIds: Array.from(selectedIds) }
          : { filtros: filtrosAtuais },
      );
      if (exportRows.length === 0) {
        toast.info("Nada para exportar", "Nenhum lançamento no recorte atual.");
        return;
      }
      const meta = montarMetaExport();
      if (capped) meta.aviso = `Exportação limitada às primeiras ${exportRows.length} de ${totalExport} linhas.`;
      if (formato === "pdf") await exportFinanceiroPdf(exportRows, meta);
      else exportFinanceiroXlsx(exportRows, meta);
      toast.success("Exportação concluída", `Arquivo ${formato.toUpperCase()} gerado (${exportRows.length} linha${exportRows.length === 1 ? "" : "s"}).`);
    } catch (e: unknown) {
      toast.error("Falha na exportação", (e as Error).message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  // ---- effects ----
  // lookups
  useEffect(() => {
    Promise.all([listarClassificacoes(), listarContasEmpresa(), listarMesesDisponiveis()])
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
      const { rows, total } = await listarTransacoesEmpresa(filtrosAtuais, page, PAGE_SIZE);
      setRows(rows);
      setTotal(total);
    } catch (e: unknown) {
      toast.error("Erro carregando lançamentos", (e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtrosAtuais, page]);
  // fetchData sincroniza a tabela com os filtros/página — o setState interno é intencional.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData(); }, [fetchData]);

  // ---- ações ----
  function openNew() {
    setEditId(null);
    setForm({ ...EMPTY_FORM });
    setTipoSaida("global");
    setDlSocioId(""); setDlClassif(""); setDlContaSocioId(""); setDlStatus("provisionado");
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
    // Saída DETALHADA (conta 2.8): grava no detalhado por sócio (transacoes_socio),
    // não em transacoes_empresa — o global é consolidado depois na tela Distribuição.
    if (salvandoDetalhada) {
      if (!form.data || !form.valor || !dlSocioId || !dlClassif || !form.descricao) {
        toast.warning("Campos obrigatórios", "Sócio, classificação, descrição, vencimento e valor são obrigatórios na saída detalhada.");
        return;
      }
      const contaSel = contasSocio.find((c) => c.id === dlContaSocioId);
      const payload: TransacaoSocioInsert = {
        data: `${form.data.slice(0, 7)}-01`,      // competência = mês do vencimento
        socio_id: dlSocioId,
        classificacao_pessoal: dlClassif,
        descricao: form.descricao,
        conta_bancaria_socio_id: dlContaSocioId || null,
        conta_bancaria_socio_nome: contaSel?.nome ?? null,
        valor: Math.abs(Number(form.valor)),
        data_vencimento: form.data,
        status: dlStatus,
        observacao: form.observacao || null,
        origem_planilha: null,
        created_by: null,
      };
      setSaving(true);
      try {
        await criarDetalhado(payload);
        toast.success(
          "Saída detalhada criada",
          "Lançada no detalhado por sócio. Acompanhe e consolide o repasse na tela Distribuição de Lucro.",
        );
        setModalOpen(false);
      } catch (e: unknown) {
        toast.error("Não foi possível criar a saída detalhada", (e as Error).message ?? String(e));
      } finally {
        setSaving(false);
      }
      return;
    }

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
          <Button variant="outline" size="sm" onClick={() => handleExport("pdf")}
            loading={exportandoPdf} disabled={exportandoPdf || exportandoXlsx}
            title="Exporta um PDF espelho da tela com os lançamentos selecionados ou filtrados">
            <FileDown size={14} /> {selectedIds.size > 0 ? `Exportar PDF (${selectedIds.size})` : "Exportar PDF"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport("xlsx")}
            loading={exportandoXlsx} disabled={exportandoPdf || exportandoXlsx}
            title="Exporta uma planilha XLSX com os lançamentos selecionados ou filtrados">
            <FileSpreadsheet size={14} /> {selectedIds.size > 0 ? `Exportar XLSX (${selectedIds.size})` : "Exportar XLSX"}
          </Button>
          <Button variant="outline" size="sm" onClick={abrirEscopo}
            title="Gera o relatório (Capa/Contábil via PDFMonkey) a partir dos filtros ou da seleção">
            <FileText size={14} /> {selectedIds.size > 0 ? `Gerar (${selectedIds.size} selecionados)` : "Gerar relatório"}
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
            <MultiSelect
              className="w-40"
              value={filterStatus}
              onChange={(v) => { setFilterStatus(v as StatusAramburu[]); setPage(1); }}
              options={statusAtivos.map((e) => ({ value: e.codigo, label: e.label }))}
              placeholder="Todos os status"
              searchPlaceholder="Buscar status…"
              unitLabel="status"
            />
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
              onChange={(e) => {
                setFilterMes(e.target.value);
                // Mês e período são mutuamente exclusivos (UX-02/3.3).
                if (e.target.value) { setFilterDataDe(""); setFilterDataAte(""); }
                setPage(1);
              }}
              className="h-8 rounded-lg border border-stone-200 px-2 text-xs"
              title="Filtra pelo mês de vencimento. Limpa o filtro por período."
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
            {/* Filtro por período/intervalo de dias (vencimento). Substitui o mês. */}
            <div
              className="flex items-center gap-1"
              title="Filtra por intervalo de datas de vencimento. Substitui o filtro de mês. Use a mesma data nos dois campos para um único dia."
            >
              <CalendarRange size={14} className="text-stone-400 shrink-0" />
              <input
                type="date"
                value={filterDataDe}
                max={filterDataAte || undefined}
                aria-label="Vencimento de"
                onChange={(e) => { setFilterDataDe(e.target.value); if (e.target.value) setFilterMes(""); setPage(1); }}
                className="h-8 rounded-lg border border-stone-200 px-2 text-xs"
              />
              <span className="text-stone-400 text-xs">até</span>
              <input
                type="date"
                value={filterDataAte}
                min={filterDataDe || undefined}
                aria-label="Vencimento até"
                onChange={(e) => { setFilterDataAte(e.target.value); if (e.target.value) setFilterMes(""); setPage(1); }}
                className="h-8 rounded-lg border border-stone-200 px-2 text-xs"
              />
              {(filterDataDe || filterDataAte) && (
                <button
                  type="button"
                  onClick={() => { setFilterDataDe(""); setFilterDataAte(""); setPage(1); }}
                  className="text-stone-400 hover:text-stone-600 px-1 text-sm leading-none"
                  title="Limpar período"
                  aria-label="Limpar período"
                >
                  ×
                </button>
              )}
            </div>
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
            {!salvandoDetalhada && (
              <Input label="Emissão (opcional)" type="date" value={form.data_emissao}
                onChange={(e) => setForm({ ...form, data_emissao: e.target.value })} />
            )}
          </div>

          {!salvandoDetalhada && (
            <div className="grid grid-cols-2 gap-3">
              <Select label="Tipo de Despesa" value={form.tipo_despesa}
                onChange={(e) => setForm({ ...form, tipo_despesa: e.target.value as TipoDespesa })}>
                {Object.entries(TIPO_DESPESA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
              <Select label="Status" value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as StatusAramburu })}>
                {/* Status ativos; inclui o valor atual mesmo se inativado, p/ não perder na edição. */}
                {(statusAtivos.some((e) => e.codigo === form.status)
                  ? statusAtivos
                  : [{ codigo: form.status, label: getStatusLabel(form.status) }, ...statusAtivos]
                ).map((e) => <option key={e.codigo} value={e.codigo}>{e.label}</option>)}
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Select label="Conta Contábil"
              value={form.conta_contabil_cod}
              onChange={(e) => setForm({ ...form, conta_contabil_cod: e.target.value, centro_custo_cod: "" })}>
              <option value="">Selecione…</option>
              {classificacoesN2.map((c) => (
                <option key={c.codigo} value={c.codigo}>{c.codigo} – {c.nome}</option>
              ))}
            </Select>
            {!salvandoDetalhada && (
              <Select label="Centro de Custo"
                value={form.centro_custo_cod}
                disabled={!form.conta_contabil_cod}
                onChange={(e) => setForm({ ...form, centro_custo_cod: e.target.value })}>
                <option value="">Selecione…</option>
                {childrenOf(form.conta_contabil_cod).map((c) => (
                  <option key={c.codigo} value={c.codigo}>{c.codigo} – {c.nome}</option>
                ))}
              </Select>
            )}
          </div>

          {/* Conta 2.8 (Distribuição de Lucro): escolher entre saída global e detalhada (call 24-jun) */}
          {mostraTipoSaida && (
            <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 space-y-2">
              <p className="text-xs font-semibold text-stone-600 uppercase tracking-wide">Tipo de saída</p>
              <div className="flex gap-5 text-sm text-stone-700">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="tipo-saida" checked={tipoSaida === "global"}
                    onChange={() => setTipoSaida("global")}
                    className="h-4 w-4 accent-accent-500" />
                  Saída global <span className="text-xs text-stone-400">(valor total — Cora → Inter)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="tipo-saida" checked={tipoSaida === "detalhada"}
                    onChange={() => setTipoSaida("detalhada")}
                    className="h-4 w-4 accent-accent-500" />
                  Saída detalhada <span className="text-xs text-stone-400">(por sócio — Inter → conta pessoal)</span>
                </label>
              </div>
              {salvandoDetalhada && (
                <p className="text-[11px] text-stone-500">
                  A saída detalhada vai para o detalhado por sócio (tela <b>Distribuição de Lucro</b>), onde você
                  confere, marca {"“A pagar”"} e consolida o valor global — sem duplicar lançamentos.
                </p>
              )}
            </div>
          )}

          {salvandoDetalhada && (
            <div className="grid grid-cols-2 gap-3">
              <Select label="Sócio *" value={dlSocioId}
                onChange={(e) => { setDlSocioId(e.target.value); setDlContaSocioId(""); }}>
                <option value="">Selecione…</option>
                {socios.map((s) => <option key={s.id} value={s.id}>{s.apelido ?? s.nome_completo}</option>)}
              </Select>
              <Select label="Classificação *" value={dlClassif}
                onChange={(e) => setDlClassif(e.target.value)}>
                <option value="">Selecione…</option>
                {classifsPessoais.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} – {c.nome}</option>)}
              </Select>
              <Select label="Conta destino do sócio" value={dlContaSocioId}
                disabled={!dlSocioId}
                onChange={(e) => setDlContaSocioId(e.target.value)}>
                <option value="">—</option>
                {contasSocio.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </Select>
              <Select label="Status" value={dlStatus}
                onChange={(e) => setDlStatus(e.target.value as StatusDL)}>
                {(Object.keys(STATUS_DL_LABEL) as StatusDL[]).map((s) =>
                  <option key={s} value={s}>{STATUS_DL_LABEL[s]}</option>)}
              </Select>
            </div>
          )}

          <Input label="Descrição" value={form.descricao}
            onChange={(e) => setForm({ ...form, descricao: e.target.value })}
            placeholder={salvandoDetalhada ? "IPTU, Folha de pagamento, Energia…" : "Descrição do lançamento"} />

          <div className="grid grid-cols-2 gap-3">
            {!salvandoDetalhada && (
              <Input label="Fornecedor / contraparte" value={form.fornecedor_nome}
                onChange={(e) => setForm({ ...form, fornecedor_nome: e.target.value })} />
            )}
            <Input
              label={salvandoDetalhada ? "Valor (R$)" : "Valor (R$, negativo = saída)"}
              type="number" step="0.01"
              min={salvandoDetalhada ? "0" : undefined}
              value={form.valor}
              onChange={(e) => setForm({ ...form, valor: e.target.value })} />
          </div>

          {!salvandoDetalhada && (
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
          )}

          {!salvandoDetalhada && (
            <div className="grid grid-cols-2 gap-3">
              <Input label="Referência (NF / recibo)" value={form.ref}
                onChange={(e) => setForm({ ...form, ref: e.target.value })}
                placeholder='NF 12345 / "AGUARDANDO NF"' />
              <Input label="Parcelas (n/N)" value={form.parcelas}
                onChange={(e) => setForm({ ...form, parcelas: e.target.value })}
                placeholder="2/12" />
            </div>
          )}

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
