"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { KpiCard } from "@/components/ui/KpiCard";
import { Modal } from "@/components/ui/Modal";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { MultiSelect } from "@/components/ui/MultiSelect";
import { ComboBox } from "@/components/ui/ComboBox";
import { StatusSelect } from "@/components/ui/StatusSelect";
import { BankLogo } from "@/components/ui/BankLogo";
import { Pagination } from "@/components/ui/Pagination";
import { RelatorioEscopoModal } from "@/components/financeiro/RelatorioEscopoModal";
import type { ListarTransacoesFiltros } from "@/lib/queries/financeiro";
import {
  Plus, FileText, Search, Edit2, Trash2, Copy,
  TrendingUp, TrendingDown, Loader2,
  FileDown, FileSpreadsheet, CalendarRange,
  ChevronUp, ChevronDown, Wallet,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import {
  listarTransacoesEmpresa,
  listarTransacoesParaExport,
  criarTransacaoEmpresa,
  criarTransacoesEmpresaLote,
  atualizarTransacaoEmpresa,
  atualizarStatusEmMassa,
  deletarTransacaoEmpresa,
  listarClassificacoes,
  listarContasEmpresa,
  listarFornecedores,
  garantirFornecedor,
  type TransacaoEmpresaRich,
} from "@/lib/queries/financeiro";
import { getSaldoAtualPorBanco, type SaldoAtualBanco } from "@/lib/queries/dashboard";
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
  type FornecedorRow,
  type TransacaoEmpresaInsert,
  type TransacaoSocioInsert,
  type SocioRow,
  type ClassificacaoPessoalRow,
  type ContaBancariaSocioRow,
} from "@/types";
import { useToast } from "@/components/ui/Toast";
import { UnsavedChangesDialog } from "@/components/ui/UnsavedChangesDialog";
import { useUnsavedGuard } from "@/lib/hooks/useUnsavedGuard";

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

/**
 * Interpreta o campo Parcelas para a geração automática (RF 23-jul):
 *   "6"   → parcelas 1/6..6/6   (quantidade informada)
 *   "2/6" → parcelas 2/6..6/6   (série começando no meio)
 * Qualquer outro texto (livre, ex.: "6x cartão") não gera série.
 */
function parseParcelas(texto: string): { inicio: number; total: number } | null {
  const t = texto.trim();
  if (!t) return null;
  let m = t.match(/^(\d{1,3})\s*\/\s*(\d{1,3})$/);
  if (m) {
    const inicio = Number(m[1]), total = Number(m[2]);
    if (inicio >= 1 && total >= inicio && total <= 120) return { inicio, total };
    return null;
  }
  m = t.match(/^(\d{1,3})$/);
  if (m) {
    const total = Number(m[1]);
    if (total >= 1 && total <= 120) return { inicio: 1, total };
  }
  return null;
}

/** Soma meses a uma data ISO preservando o dia (trava no fim do mês curto). */
function addMeses(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const totalMeses = (m - 1) + n;
  const ano = y + Math.floor(totalMeses / 12);
  const mes = (totalMeses % 12) + 1;
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const dia = Math.min(d, ultimoDia);
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

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
  const [fornecedores, setFornecedores] = useState<FornecedorRow[]>([]);

  // ---- resumo dos saldos bancários no cabeçalho (RF 23-jul) ----
  const [saldosBanco, setSaldosBanco] = useState<SaldoAtualBanco[]>([]);

  // ---- filtros / UI (todos multi-seleção — RF 23-jul) ----
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<StatusAramburu[]>([]);
  const [filterContaContabil, setFilterContaContabil] = useState<string[]>([]);
  const [filterCentroCusto, setFilterCentroCusto] = useState<string[]>([]);
  const [filterBanco, setFilterBanco] = useState<string[]>([]);
  // Períodos: vencimento E emissão (o filtro de mês saiu — RF 23-jul).
  const [filterDataDe, setFilterDataDe] = useState("");
  const [filterDataAte, setFilterDataAte] = useState("");
  const [filterEmissaoDe, setFilterEmissaoDe] = useState("");
  const [filterEmissaoAte, setFilterEmissaoAte] = useState("");
  // Filtro por valor (magnitude R$ — ignora o sinal).
  const [filterValorMin, setFilterValorMin] = useState("");
  const [filterValorMax, setFilterValorMax] = useState("");
  const [page, setPage] = useState(1);
  // Ordenação por vencimento — alternada pelo clique no cabeçalho da coluna.
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // ---- exportação (REL-01/02) ----
  const [exportandoPdf, setExportandoPdf] = useState(false);
  const [exportandoXlsx, setExportandoXlsx] = useState(false);

  // ---- seleção manual p/ relatório por escopo (RF-FIN-09) ----
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [escopoOpen, setEscopoOpen] = useState(false);
  const [escopoTipo, setEscopoTipo] = useState<"por_filtros" | "por_selecao">("por_filtros");

  // ---- status em massa dos selecionados (RF 23-jul) ----
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const guard = useUnsavedGuard(modalOpen, form, () => setModalOpen(false));
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
  const { entries: statusEntries, map: statusMap } = useStatusConfig();
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
    contaContabilCod: filterContaContabil.length ? filterContaContabil : undefined,
    centroCustoCod: filterCentroCusto.length ? filterCentroCusto : undefined,
    contaBancariaId: filterBanco.length ? filterBanco : undefined,
    dataDe: filterDataDe || undefined,
    dataAte: filterDataAte || undefined,
    emissaoDe: filterEmissaoDe || undefined,
    emissaoAte: filterEmissaoAte || undefined,
    valorMin: filterValorMin ? Math.abs(Number(filterValorMin)) || undefined : undefined,
    valorMax: filterValorMax ? Math.abs(Number(filterValorMax)) || undefined : undefined,
  }), [search, filterStatus, filterContaContabil, filterCentroCusto, filterBanco,
       filterDataDe, filterDataAte, filterEmissaoDe, filterEmissaoAte, filterValorMin, filterValorMax]);
  const competenciaSugerida = filterDataDe?.slice(0, 7) || new Date().toISOString().slice(0, 7);

  function abrirEscopo() {
    setEscopoTipo(selectedIds.size > 0 ? "por_selecao" : "por_filtros");
    setEscopoOpen(true);
  }

  // ---- exportação espelho-da-tela (REL-01/02) ----
  const montarMetaExport = useCallback((): FinanceiroExportMeta => {
    const f: string[] = [];
    if (search) f.push(`Busca: "${search}"`);
    if (filterStatus.length) f.push(`Status: ${filterStatus.map((s) => getStatusLabel(s)).join(", ")}`);
    if (filterContaContabil.length) {
      f.push(`Conta: ${filterContaContabil.map((cod) => {
        const c = classificacoesN2.find((x) => x.codigo === cod);
        return c ? `${cod} – ${c.nome}` : cod;
      }).join(", ")}`);
    }
    if (filterCentroCusto.length) {
      f.push(`Centro de custo: ${filterCentroCusto.map((cod) => {
        const c = classificacoesN3.find((x) => x.codigo === cod);
        return c ? `${cod} – ${c.nome}` : cod;
      }).join(", ")}`);
    }
    if (filterBanco.length) {
      f.push(`Banco: ${filterBanco.map((id) => {
        const b = bancos.find((x) => x.id === id);
        return b?.apelido ?? b?.nome ?? id;
      }).join(", ")}`);
    }
    if (filterDataDe || filterDataAte) {
      f.push(`Vencimento: ${filterDataDe ? formatDate(filterDataDe) : "…"} a ${filterDataAte ? formatDate(filterDataAte) : "…"}`);
    }
    if (filterEmissaoDe || filterEmissaoAte) {
      f.push(`Emissão: ${filterEmissaoDe ? formatDate(filterEmissaoDe) : "…"} a ${filterEmissaoAte ? formatDate(filterEmissaoAte) : "…"}`);
    }
    if (filterValorMin || filterValorMax) {
      f.push(`Valor: ${filterValorMin ? formatCurrency(Number(filterValorMin)) : "…"} a ${filterValorMax ? formatCurrency(Number(filterValorMax)) : "…"}`);
    }
    const escopo = selectedIds.size > 0
      ? `Seleção manual — ${selectedIds.size} lançamento${selectedIds.size === 1 ? "" : "s"}`
      : "Recorte pelos filtros aplicados na tela";
    return { titulo: "Relatório de Lançamentos Financeiros", escopo, filtros: f };
  }, [search, filterStatus, filterContaContabil, filterCentroCusto, filterBanco,
      filterDataDe, filterDataAte, filterEmissaoDe, filterEmissaoAte,
      filterValorMin, filterValorMax, selectedIds, classificacoesN2, classificacoesN3, bancos]);

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
    Promise.all([listarClassificacoes(), listarContasEmpresa(), listarFornecedores()])
      .then(([cf, cb, forn]) => { setClassificacoes(cf); setBancos(cb); setFornecedores(forn); })
      .catch((e: unknown) =>
        toast.error("Erro carregando cadastros", (e as Error).message ?? String(e))
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resumo dos saldos bancários no cabeçalho — recarregado após cada mutação.
  const fetchSaldos = useCallback(async () => {
    try {
      setSaldosBanco(await getSaldoAtualPorBanco());
    } catch {
      // silencioso: o resumo é informativo; a tabela continua funcionando.
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchSaldos(); }, [fetchSaldos]);

  // dados (refetch sempre que filtros / page mudam)
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { rows, total } = await listarTransacoesEmpresa(filtrosAtuais, page, PAGE_SIZE, sortDir);
      setRows(rows);
      setTotal(total);
    } catch (e: unknown) {
      toast.error("Erro carregando lançamentos", (e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtrosAtuais, page, sortDir]);
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
  function rowToForm(row: TransacaoEmpresaRich): FormState {
    return {
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
    };
  }
  function openEdit(row: TransacaoEmpresaRich) {
    setEditId(row.id);
    setForm(rowToForm(row));
    setModalOpen(true);
  }
  // Duplicar lançamento (RF 23-jul): abre o modal de NOVO já preenchido com os
  // dados do existente — a Lola ajusta só a descrição (ou o que precisar) e salva.
  function openDuplicate(row: TransacaoEmpresaRich) {
    setEditId(null);
    setTipoSaida("global");
    setForm(rowToForm(row));
    setModalOpen(true);
    toast.info("Duplicando lançamento", "Revise os campos (ex.: descrição) e clique em Adicionar.");
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
        // O campo "Vencimento" do modal é o vencimento da DESPESA; a Data do
        // Repasse é definida depois, na tela Distribuição (ajuste 23-jul).
        data_vencimento: null,
        data_vencimento_despesa: form.data,
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
    setSaving(true);
    try {
      // Fornecedor digitado vira cadastro (id) automaticamente (RF 23-jul).
      let fornecedorId: string | null = null;
      let fornecedorNome: string | null = form.fornecedor_nome.trim() || null;
      if (fornecedorNome) {
        const f = await garantirFornecedor(fornecedorNome, fornecedores);
        if (f) {
          fornecedorId = f.id;
          fornecedorNome = f.nome;
          if (!fornecedores.some((x) => x.id === f.id)) {
            setFornecedores(await listarFornecedores().catch(() => fornecedores));
          }
        }
      }

      const payload: TransacaoEmpresaInsert = {
        data: form.data,
        data_emissao: form.data_emissao || null,
        conta_contabil_cod: form.conta_contabil_cod,
        centro_custo_cod: form.centro_custo_cod,
        tipo_despesa: form.tipo_despesa,
        fornecedor_id: fornecedorId,
        fornecedor_nome: fornecedorNome,
        descricao: form.descricao || null,
        obs_obra: form.obs_obra,
        ref: form.ref || null,
        parcelas: form.parcelas.trim() || null,
        forma_pgto: form.forma_pgto,
        conta_bancaria_id: form.conta_bancaria_id || null,
        status: form.status,
        valor: Number(form.valor),
        observacao: form.observacao || null,
        origem_planilha: null,
        created_by: null,
      };

      if (editId) {
        await atualizarTransacaoEmpresa(editId, payload);
        toast.success("Lançamento atualizado");
      } else {
        // LANÇAMENTOS PARCELADOS (RF 23-jul): "3" gera 1/3..3/3; "2/6" gera
        // 2/6..6/6 — uma parcela por mês, mesmo valor, vencimentos mensais.
        const serie = parseParcelas(form.parcelas);
        if (serie && serie.total > serie.inicio) {
          const lote: TransacaoEmpresaInsert[] = [];
          for (let i = serie.inicio; i <= serie.total; i++) {
            lote.push({
              ...payload,
              data: addMeses(form.data, i - serie.inicio),
              parcelas: `${i}/${serie.total}`,
            });
          }
          await criarTransacoesEmpresaLote(lote);
          toast.success(
            `${lote.length} parcelas geradas`,
            `Parcelas ${serie.inicio}/${serie.total} a ${serie.total}/${serie.total}, vencendo mês a mês a partir de ${formatDate(form.data)}.`,
          );
        } else {
          await criarTransacaoEmpresa({
            ...payload,
            parcelas: serie ? `${serie.inicio}/${serie.total}` : payload.parcelas,
          });
          toast.success("Lançamento criado");
        }
      }
      setModalOpen(false);
      await fetchData();
      await fetchSaldos();
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
      await fetchSaldos();
    } catch (e: unknown) {
      toast.error("Não foi possível excluir", (e as Error).message ?? String(e));
    }
  }

  // ---- status direto na tela (1 linha) — padrão da Distribuição (RF 23-jul) ----
  async function mudarStatusInline(row: TransacaoEmpresaRich, status: StatusAramburu) {
    try {
      await atualizarTransacaoEmpresa(row.id, { status });
      toast.success("Status atualizado", `${row.descricao ?? "Lançamento"}: ${getStatusLabel(status)}.`);
      await fetchData();
      await fetchSaldos();
    } catch (e: unknown) {
      toast.error("Não foi possível mudar o status", (e as Error).message ?? String(e));
      await fetchData(); // recarrega para o select voltar ao status real
    }
  }

  // ---- status em massa dos selecionados (RF 23-jul) ----
  async function aplicarStatusEmMassa() {
    if (!bulkStatus || selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      const n = await atualizarStatusEmMassa(Array.from(selectedIds), bulkStatus as StatusAramburu);
      toast.success("Status aplicado", `${n} lançamento${n === 1 ? "" : "s"} atualizado${n === 1 ? "" : "s"} para "${getStatusLabel(bulkStatus)}".`);
      setSelectedIds(new Set());
      setBulkStatus("");
      await fetchData();
      await fetchSaldos();
    } catch (e: unknown) {
      toast.error("Não foi possível aplicar o status", (e as Error).message ?? String(e));
    } finally {
      setBulkBusy(false);
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

      {/* Resumo dos saldos bancários (RF 23-jul) */}
      {saldosBanco.length > 0 && (
        <div className="rounded-xl border border-stone-200 bg-white shadow-sm px-4 py-3">
          <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide mb-2 flex items-center gap-1">
            <Wallet size={11} /> Saldos por banco
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {saldosBanco.map((b) => {
              const saldo = Number(b.saldo_atual);
              return (
                <div key={b.conta_bancaria_id} className="flex items-center gap-2" title={b.banco_nome}>
                  <BankLogo banco={b.banco_instituicao} apelido={b.banco_apelido} size={22} />
                  <div className="leading-tight">
                    <p className="text-[10px] text-stone-400">{b.banco_apelido ?? b.banco_nome}</p>
                    <p className={`text-sm font-bold tabular-nums ${saldo > 0 ? "text-emerald-700" : saldo < 0 ? "text-red-600" : "text-stone-400"}`}>
                      {formatCurrency(saldo)}
                    </p>
                  </div>
                </div>
              );
            })}
            <div className="flex items-center gap-2 pl-4 border-l border-stone-100 ml-auto">
              <div className="leading-tight text-right">
                <p className="text-[10px] text-stone-400 uppercase">Total geral</p>
                <p className="text-sm font-bold tabular-nums text-stone-800">
                  {formatCurrency(saldosBanco.reduce((s, b) => s + Number(b.saldo_atual), 0))}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

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
            <MultiSelect
              className="w-40"
              value={filterContaContabil}
              onChange={(v) => { setFilterContaContabil(v); setPage(1); }}
              options={classificacoesN2.map((c) => ({ value: c.codigo, label: `${c.codigo} – ${c.nome}` }))}
              placeholder="Todas as contas"
              searchPlaceholder="Buscar conta…"
              emptyText="Nenhuma conta"
              unitLabel="contas"
            />
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
            <MultiSelect
              className="w-36"
              value={filterBanco}
              onChange={(v) => { setFilterBanco(v); setPage(1); }}
              options={bancos.map((b) => ({ value: b.id, label: b.apelido ?? b.nome }))}
              placeholder="Todos os bancos"
              searchPlaceholder="Buscar banco…"
              emptyText="Nenhum banco"
              unitLabel="bancos"
            />
            {/* Período por VENCIMENTO (RF 23-jul: substitui o filtro de mês) */}
            <div
              className="flex items-center gap-1"
              title="Período pelo VENCIMENTO. Use a mesma data nos dois campos para um único dia."
            >
              <CalendarRange size={14} className="text-stone-400 shrink-0" />
              <span className="text-[10px] uppercase text-stone-400 font-medium">Venc.</span>
              <input
                type="date"
                value={filterDataDe}
                max={filterDataAte || undefined}
                aria-label="Vencimento de"
                onChange={(e) => { setFilterDataDe(e.target.value); setPage(1); }}
                className="h-8 rounded-lg border border-stone-200 px-2 text-xs"
              />
              <span className="text-stone-400 text-xs">até</span>
              <input
                type="date"
                value={filterDataAte}
                min={filterDataDe || undefined}
                aria-label="Vencimento até"
                onChange={(e) => { setFilterDataAte(e.target.value); setPage(1); }}
                className="h-8 rounded-lg border border-stone-200 px-2 text-xs"
              />
              {(filterDataDe || filterDataAte) && (
                <button
                  type="button"
                  onClick={() => { setFilterDataDe(""); setFilterDataAte(""); setPage(1); }}
                  className="text-stone-400 hover:text-stone-600 px-1 text-sm leading-none"
                  title="Limpar período de vencimento"
                  aria-label="Limpar período de vencimento"
                >
                  ×
                </button>
              )}
            </div>
            {/* Período por EMISSÃO (RF 23-jul) */}
            <div
              className="flex items-center gap-1"
              title="Período pela EMISSÃO da NF/documento."
            >
              <CalendarRange size={14} className="text-stone-400 shrink-0" />
              <span className="text-[10px] uppercase text-stone-400 font-medium">Emissão</span>
              <input
                type="date"
                value={filterEmissaoDe}
                max={filterEmissaoAte || undefined}
                aria-label="Emissão de"
                onChange={(e) => { setFilterEmissaoDe(e.target.value); setPage(1); }}
                className="h-8 rounded-lg border border-stone-200 px-2 text-xs"
              />
              <span className="text-stone-400 text-xs">até</span>
              <input
                type="date"
                value={filterEmissaoAte}
                min={filterEmissaoDe || undefined}
                aria-label="Emissão até"
                onChange={(e) => { setFilterEmissaoAte(e.target.value); setPage(1); }}
                className="h-8 rounded-lg border border-stone-200 px-2 text-xs"
              />
              {(filterEmissaoDe || filterEmissaoAte) && (
                <button
                  type="button"
                  onClick={() => { setFilterEmissaoDe(""); setFilterEmissaoAte(""); setPage(1); }}
                  className="text-stone-400 hover:text-stone-600 px-1 text-sm leading-none"
                  title="Limpar período de emissão"
                  aria-label="Limpar período de emissão"
                >
                  ×
                </button>
              )}
            </div>
            {/* Filtro por VALOR (magnitude R$ — RF 23-jul) */}
            <div className="flex items-center gap-1" title="Filtra pelo valor (em R$, ignora se é entrada ou saída).">
              <span className="text-[10px] uppercase text-stone-400 font-medium">R$</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                placeholder="de"
                value={filterValorMin}
                aria-label="Valor mínimo"
                onWheel={(e) => e.currentTarget.blur()}
                onChange={(e) => { setFilterValorMin(e.target.value); setPage(1); }}
                className="h-8 w-20 rounded-lg border border-stone-200 px-2 text-xs"
              />
              <span className="text-stone-400 text-xs">até</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                placeholder="até"
                value={filterValorMax}
                aria-label="Valor máximo"
                onWheel={(e) => e.currentTarget.blur()}
                onChange={(e) => { setFilterValorMax(e.target.value); setPage(1); }}
                className="h-8 w-20 rounded-lg border border-stone-200 px-2 text-xs"
              />
              {(filterValorMin || filterValorMax) && (
                <button
                  type="button"
                  onClick={() => { setFilterValorMin(""); setFilterValorMax(""); setPage(1); }}
                  className="text-stone-400 hover:text-stone-600 px-1 text-sm leading-none"
                  title="Limpar filtro de valor"
                  aria-label="Limpar filtro de valor"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        </CardHeader>

        {/* Barra de ações em massa — status dos selecionados (RF 23-jul) */}
        {selectedIds.size > 0 && (
          <div className="mx-4 mb-1 rounded-lg bg-accent-50 border border-accent-200 px-3 py-2 flex items-center gap-2 flex-wrap text-xs">
            <span className="font-medium text-stone-700">
              {selectedIds.size} selecionado{selectedIds.size === 1 ? "" : "s"}:
            </span>
            <select
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value)}
              className="h-7 rounded-lg border border-stone-200 px-2 text-xs bg-white"
              title="Status a aplicar em todos os selecionados"
            >
              <option value="">Escolher status…</option>
              {statusAtivos.map((e) => <option key={e.codigo} value={e.codigo}>{e.label}</option>)}
            </select>
            <Button size="sm" variant="outline" disabled={!bulkStatus || bulkBusy}
              loading={bulkBusy}
              onClick={aplicarStatusEmMassa}
              title="Aplica o status escolhido em todos os lançamentos selecionados de uma vez">
              Aplicar status
            </Button>
            <button onClick={() => setSelectedIds(new Set())} className="text-stone-400 hover:text-stone-600 underline ml-auto">
              limpar seleção
            </button>
          </div>
        )}
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
                  <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => { setSortDir((d) => (d === "asc" ? "desc" : "asc")); setPage(1); }}
                      title={sortDir === "asc" ? "Mais antigos primeiro — clique para inverter" : "Mais recentes primeiro — clique para inverter"}
                      className="inline-flex items-center gap-1 uppercase tracking-wide font-semibold text-stone-500 hover:text-stone-800 transition-colors cursor-pointer select-none"
                    >
                      Vencimento
                      {sortDir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                  </th>
                  {["Emissão","Conta","Centro de Custo","Descrição","Fornecedor","Ref.","Banco","Status","Valor","Ações"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={12} className="px-4 py-12 text-center text-stone-400">
                    <Loader2 size={18} className="inline-block animate-spin mr-2" />
                    Carregando…
                  </td></tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={12} className="px-4 py-12 text-center text-stone-400">
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
                      <td className="px-4 py-3 text-stone-500 text-xs max-w-[120px] truncate" title={t.ref ?? ""}>
                        {t.ref || <span className="text-stone-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-stone-500 text-xs">
                        {t.conta_bancaria?.apelido ?? t.conta_bancaria?.nome ?? <span className="text-stone-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <StatusSelect
                          value={t.status}
                          onChange={(v) => mudarStatusInline(t, v as StatusAramburu)}
                          options={(statusAtivos.some((e) => e.codigo === t.status)
                            ? statusAtivos
                            : [statusMap.get(t.status) ?? { codigo: t.status, label: getStatusLabel(t.status), cor_bg: "#6b7280", cor_text: "#ffffff", kind: "neutro" as const, ordem: 0, ativo: false, is_sistema: true }, ...statusAtivos]
                          ).map((e) => ({ value: e.codigo, label: e.label, bg: e.cor_bg, text: e.cor_text }))}
                          title="Mudar o status deste lançamento direto na tela"
                          aria-label={`Status de ${t.descricao ?? "lançamento"}`}
                        />
                      </td>
                      <td className={`px-4 py-3 font-semibold text-sm whitespace-nowrap ${kind === "entrada" ? "text-green-700" : kind === "saida" ? "text-red-600" : "text-stone-700"}`}>
                        {formatCurrency(t.valor)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEdit(t)} className="p-1.5 rounded hover:bg-primary-50 text-stone-400 hover:text-primary-600 transition" title="Editar">
                            <Edit2 size={13} />
                          </button>
                          <button onClick={() => openDuplicate(t)} className="p-1.5 rounded hover:bg-accent-50 text-stone-400 hover:text-accent-600 transition" title="Duplicar (abre um novo lançamento já preenchido)">
                            <Copy size={13} />
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
        onClose={guard.requestClose}
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
              <ComboBox
                label="Fornecedor / contraparte"
                value={form.fornecedor_nome}
                onChange={(v) => setForm({ ...form, fornecedor_nome: v })}
                options={fornecedores.map((f) => ({ value: f.id, label: f.nome }))}
                placeholder="Digite para buscar o cadastrado…"
              />
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
              <div className="flex flex-col gap-1.5">
                <Input label="Parcelas (quantidade ou n/N)" value={form.parcelas}
                  onChange={(e) => setForm({ ...form, parcelas: e.target.value })}
                  placeholder={editId ? "2/12" : "ex.: 6 (gera 1/6 a 6/6) ou 2/12"} />
                {!editId && (() => {
                  const serie = parseParcelas(form.parcelas);
                  if (!serie || serie.total <= serie.inicio) return null;
                  const qtd = serie.total - serie.inicio + 1;
                  return (
                    <p className="text-[11px] text-accent-700 bg-accent-50 border border-accent-200 rounded-lg px-2 py-1">
                      Ao adicionar, serão geradas <b>{qtd} parcelas</b> ({serie.inicio}/{serie.total} a {serie.total}/{serie.total}),
                      uma por mês a partir de {form.data ? formatDate(form.data) : "…"} — cada uma com o valor informado.
                    </p>
                  );
                })()}
              </div>
            </div>
          )}

          <Textarea label="Observação" value={form.observacao}
            onChange={(e) => setForm({ ...form, observacao: e.target.value })}
            rows={2} placeholder="Anotações livres (exceções, regras especiais…)" />

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={guard.requestClose}>Cancelar</Button>
            <Button onClick={handleSave} loading={saving} disabled={saving}>
              {editId ? "Salvar Alterações" : "Adicionar"}
            </Button>
          </div>
        </div>
      </Modal>
      <UnsavedChangesDialog open={guard.confirmOpen} onStay={guard.stay} onDiscard={guard.discard} />

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
