"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { UnsavedChangesDialog } from "@/components/ui/UnsavedChangesDialog";
import { useUnsavedGuard } from "@/lib/hooks/useUnsavedGuard";
import {
  Plus, Search, Edit2, Trash2, Loader2, HandCoins, CheckCheck,
  ArrowRightLeft, Undo2, CalendarCheck, PiggyBank, Landmark, AlertTriangle, FilterX,
  Copy, Tag, X, FileDown, FileSpreadsheet, FileText,
} from "lucide-react";
import { gerarPdfBloqueante } from "@/lib/pdfmonkey/frontend";
import type { ReportScope } from "@/lib/pdfmonkey/types";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { StatusSelect } from "@/components/ui/StatusSelect";
import {
  listarDetalhado, criarDetalhado, atualizarDetalhado, deletarDetalhado,
  atualizarDetalhadoEmMassa, deletarDetalhadoEmMassa, obterResumoMensal, obterGlobalEmpresaMes,
  listarRepassesDoMes, consolidarRepasse, desfazerRepasse, concluirRepasse,
  listarSocios, listarClassificacoesPessoais, listarContasDoSocio, listarMesesDetalhado,
  type TransacaoSocioRich, type GlobalEmpresaMes, type RepasseConsolidado,
} from "@/lib/queries/distribuicao";
import { exportDistribuicaoPdf, exportDistribuicaoXlsx } from "@/lib/export/distribuicao-export";
import {
  STATUS_DL_LABEL, STATUS_DL_COLOR,
  type StatusDL, type SocioRow, type ClassificacaoPessoalRow,
  type ContaBancariaSocioRow, type DlMensalResumoRow, type TransacaoSocioInsert,
} from "@/types";

// Cores padronizadas com o Financeiro (RF 23-jul): Provisionado amarelo,
// A repassar vermelho, Repassado verde.
const DL_BADGE: Record<StatusDL, BadgeVariant> = {
  provisionado: "warning",
  a_pagar:      "danger",
  realizado:    "success",
};

const DL_SELECT_OPTIONS = (Object.keys(STATUS_DL_LABEL) as StatusDL[]).map((s) => ({
  value: s,
  label: STATUS_DL_LABEL[s],
  bg: STATUS_DL_COLOR[s].bg,
  text: STATUS_DL_COLOR[s].text,
}));

const STATUS_EMPRESA_LABEL: Record<string, string> = {
  a_pagar: "A pagar",
  a_repassar: "A repassar",
  repassado: "Repassado",
  pago: "Pago",
  recebido: "Recebido",
  a_receber: "A receber",
};

type FormState = {
  socio_id: string;
  classificacao_pessoal: string;
  descricao: string;
  conta_bancaria_socio_id: string;
  competencia: string;        // "YYYY-MM" → grava data = YYYY-MM-01
  data_vencimento: string;            // Data do Repasse (RF 23-jul)
  data_vencimento_despesa: string;    // Vencimento da despesa/fatura (RF 23-jul)
  valor: string;
  status: StatusDL;
  observacao: string;
};

const mesCorrente = () => {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}`;
};

/**
 * TAG do dia (ajuste 27-jul — idem ao Financeiro): o "pintar de amarelo" da
 * planilha, para marcar os lançamentos sendo trabalhados hoje. Persistida no
 * NAVEGADOR (localStorage) com snapshot leve para o painel flutuante.
 */
type TagSnapshot = {
  id: string;
  socio: string | null;
  descricao: string | null;
  valor: number;
};

const DL_TAGS_STORAGE_KEY = "arambi.distribuicao.tags.v1";

function carregarTagsDL(): Map<string, TagSnapshot> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = window.localStorage.getItem(DL_TAGS_STORAGE_KEY);
    if (!raw) return new Map();
    const arr = JSON.parse(raw) as TagSnapshot[];
    if (!Array.isArray(arr)) return new Map();
    return new Map(
      arr
        .filter((t) => t && typeof t.id === "string")
        .map((t) => [t.id, { ...t, valor: Number(t.valor) || 0 }]),
    );
  } catch {
    return new Map();
  }
}

export function DistribuicaoPage() {
  const toast = useToast();

  // ---- competência (KPIs / consolidação / repasses do mês) ----
  const [mes, setMes] = useState(mesCorrente());
  const [meses, setMeses] = useState<string[]>([]);

  // ---- filtros da listagem (RF 23-jul: períodos em vez de mês) ----
  const [filterSocio, setFilterSocio] = useState("");
  const [filterClassif, setFilterClassif] = useState("");
  const [filterStatus, setFilterStatus] = useState<StatusDL | "">("");
  const [search, setSearch] = useState("");
  const [filterRepasseDe, setFilterRepasseDe] = useState("");
  const [filterRepasseAte, setFilterRepasseAte] = useState("");
  const [filterVencDe, setFilterVencDe] = useState("");
  const [filterVencAte, setFilterVencAte] = useState("");
  // Faixa de valor R$ (RF 24-jul — espelha o padrão do Financeiro).
  const [filterValorMin, setFilterValorMin] = useState("");
  const [filterValorMax, setFilterValorMax] = useState("");

  // ---- TAGs do dia (ajuste 27-jul — idem ao Financeiro) ----
  const [tags, setTags] = useState<Map<string, TagSnapshot>>(new Map());
  const [tagsCarregadas, setTagsCarregadas] = useState(false);
  const [tagPanelOpen, setTagPanelOpen] = useState(false);
  const [mostrarSoTagueados, setMostrarSoTagueados] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hidratação do localStorage pós-mount
    setTags(carregarTagsDL());
    setTagsCarregadas(true);
  }, []);
  useEffect(() => {
    if (!tagsCarregadas) return;
    try {
      window.localStorage.setItem(DL_TAGS_STORAGE_KEY, JSON.stringify(Array.from(tags.values())));
    } catch {
      // localStorage indisponível — tags seguem em memória.
    }
  }, [tags, tagsCarregadas]);
  useEffect(() => {
    if (tags.size === 0 && mostrarSoTagueados) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMostrarSoTagueados(false);
    }
  }, [tags, mostrarSoTagueados]);

  const toggleTag = useCallback((row: TransacaoSocioRich) => {
    setTags((prev) => {
      const next = new Map(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.set(row.id, {
        id: row.id,
        socio: row.socio?.apelido ?? row.socio?.nome_completo ?? null,
        descricao: row.descricao ?? null,
        valor: Number(row.valor),
      });
      return next;
    });
  }, []);

  const removerTag = useCallback((id: string) => {
    setTags((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const somaTags = useMemo(() => {
    let s = 0;
    tags.forEach((t) => { s += t.valor; });
    return s;
  }, [tags]);

  function limparTags() {
    if (!confirm(`Limpar ${tags.size === 1 ? "a tag" : `as ${tags.size} tags`} do dia? Os lançamentos em si não são alterados.`)) return;
    setTags(new Map());
    setTagPanelOpen(false);
  }

  // Há algum filtro aplicado? (visibilidade do "Limpar todos os filtros")
  const temFiltrosAtivos = Boolean(
    search || filterSocio || filterClassif || filterStatus ||
    filterRepasseDe || filterRepasseAte || filterVencDe || filterVencAte ||
    filterValorMin || filterValorMax || mostrarSoTagueados,
  );

  // "Limpar todos os filtros" (RF 24-jul) — não mexe na competência do header.
  function limparTodosFiltros() {
    setSearch("");
    setFilterSocio("");
    setFilterClassif("");
    setFilterStatus("");
    setFilterRepasseDe("");
    setFilterRepasseAte("");
    setFilterVencDe("");
    setFilterVencAte("");
    setFilterValorMin("");
    setFilterValorMax("");
    setMostrarSoTagueados(false);
  }

  // ---- dados ----
  const [rows, setRows] = useState<TransacaoSocioRich[]>([]);
  const [resumo, setResumo] = useState<DlMensalResumoRow | null>(null);
  const [globalMes, setGlobalMes] = useState<GlobalEmpresaMes | null>(null);
  const [repasses, setRepasses] = useState<RepasseConsolidado[]>([]);
  const [loading, setLoading] = useState(true);

  // ---- lookups ----
  const [socios, setSocios] = useState<SocioRow[]>([]);
  const [classifs, setClassifs] = useState<ClassificacaoPessoalRow[]>([]);
  const [contasSocio, setContasSocio] = useState<ContaBancariaSocioRow[]>([]);

  // ---- seleção / ações em massa ----
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkVencimento, setBulkVencimento] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  // Status genérico + exclusão em lote (ajuste 27-jul — idem ao Financeiro).
  const [bulkStatusSel, setBulkStatusSel] = useState("");
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  // ---- exportação (ajuste 27-jul) ----
  const [exportandoPdf, setExportandoPdf] = useState(false);
  const [exportandoXlsx, setExportandoXlsx] = useState(false);

  // ---- modal CRUD ----
  const [modalOpen, setModalOpen] = useState(false);
  const [editRow, setEditRow] = useState<TransacaoSocioRich | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const guard = useUnsavedGuard(modalOpen, form, () => setModalOpen(false));
  const [saving, setSaving] = useState(false);

  // ---- modal Consolidar ----
  const [consolidarOpen, setConsolidarOpen] = useState(false);
  const [consolidarData, setConsolidarData] = useState(new Date().toISOString().slice(0, 10));
  const [incluirTransferencia, setIncluirTransferencia] = useState(true);
  const [consolidando, setConsolidando] = useState(false);

  // ---- modal Capa do repasse do sócio (PDFMonkey — ajuste 29-jul) ----
  const [capaOpen, setCapaOpen] = useState(false);
  const [capaSocioId, setCapaSocioId] = useState("");
  const [capaSoTagueados, setCapaSoTagueados] = useState(false);
  const [capaGerando, setCapaGerando] = useState(false);

  // ---- lookups (uma vez) ----
  useEffect(() => {
    Promise.all([listarSocios(), listarClassificacoesPessoais(), listarMesesDetalhado()])
      .then(([s, c, m]) => { setSocios(s); setClassifs(c); setMeses(m); })
      .catch((e: unknown) => toast.error("Erro carregando cadastros", (e as Error).message ?? String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // contas do sócio selecionado no formulário
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset síncrono intencional ao trocar de sócio
    if (!form?.socio_id) { setContasSocio([]); return; }
    listarContasDoSocio(form.socio_id)
      .then(setContasSocio)
      .catch((e: unknown) => toast.error("Erro carregando contas do sócio", (e as Error).message ?? String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.socio_id]);

  // ---- dados ----
  // A LISTAGEM segue os filtros de período (Data do Repasse / Vencimento) —
  // sem o modo de pesquisa por mês (RF 23-jul, "idem ao Financeiro"). KPIs,
  // repasses consolidados e consolidação seguem a COMPETÊNCIA do seletor.
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [r, res, glob, reps] = await Promise.all([
        listarDetalhado({
          // A LISTAGEM segue a COMPETÊNCIA do header (ajuste 28-jul: um único
          // seletor comanda KPIs, repasses, consolidação E a tabela).
          mesReferencia: mes,
          socioId: filterSocio || undefined,
          classificacao: filterClassif || undefined,
          status: filterStatus || undefined,
          search: search || undefined,
          repasseDe: filterRepasseDe || undefined,
          repasseAte: filterRepasseAte || undefined,
          vencimentoDe: filterVencDe || undefined,
          vencimentoAte: filterVencAte || undefined,
          valorMin: filterValorMin ? Math.abs(Number(filterValorMin)) || undefined : undefined,
          valorMax: filterValorMax ? Math.abs(Number(filterValorMax)) || undefined : undefined,
        }),
        obterResumoMensal(mes),
        obterGlobalEmpresaMes(mes),
        listarRepassesDoMes(mes),
      ]);
      setRows(r);
      setResumo(res);
      setGlobalMes(glob);
      setRepasses(reps);
    } catch (e: unknown) {
      toast.error("Erro carregando distribuição", (e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes, filterSocio, filterClassif, filterStatus, search,
      filterRepasseDe, filterRepasseAte, filterVencDe, filterVencAte,
      filterValorMin, filterValorMax]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData(); setSelectedIds(new Set()); }, [fetchData]);

  // ---- derivados ----
  // Consolidáveis exibidos no modal: recorte da COMPETÊNCIA (a listagem pode
  // estar mostrando outros meses agora que o filtro é por período).
  const consolidaveis = useMemo(
    () => rows.filter((r) => r.status === "a_pagar" && !r.repasse_id && r.mes_referencia === mes),
    [rows, mes],
  );
  // Total consolidável do MÊS (independe dos filtros de sócio/classificação da tela)
  const totalConsolidavel = resumo?.a_pagar_sem_repasse ?? 0;
  const qtdConsolidavel = resumo?.qtd_a_pagar_sem_repasse ?? 0;

  const porSocioConsolidavel = useMemo(() => {
    const m = new Map<string, { nome: string; total: number; qtd: number }>();
    for (const r of consolidaveis) {
      const nome = r.socio?.apelido ?? r.socio?.nome_completo ?? "—";
      const e = m.get(nome) ?? { nome, total: 0, qtd: 0 };
      e.total += Number(r.valor);
      e.qtd += 1;
      m.set(nome, e);
    }
    return Array.from(m.values()).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [consolidaveis]);

  // Recorte "só tagueados" (ajuste 27-jul) — filtra a tabela no client.
  const rowsVisiveis = useMemo(
    () => (mostrarSoTagueados && tags.size > 0 ? rows.filter((r) => tags.has(r.id)) : rows),
    [rows, mostrarSoTagueados, tags],
  );

  const selecionaveis = useMemo(() => rowsVisiveis.filter((r) => !r.repasse_id), [rowsVisiveis]);
  const allSelected = selecionaveis.length > 0 && selecionaveis.every((r) => selectedIds.has(r.id));

  // Autossoma dos selecionados (ajuste 27-jul — idem ao Financeiro).
  const somaSelecionados = useMemo(() => {
    let s = 0;
    for (const r of rows) if (selectedIds.has(r.id)) s += Number(r.valor);
    return s;
  }, [rows, selectedIds]);

  const divergenciaProvisionado = useMemo(() => {
    if (!resumo || !globalMes) return null;
    if (!globalMes.temProvisionadoManual) return null;
    const diff = Math.abs(globalMes.provisionadoGlobal - resumo.provisionado);
    return diff > 0.005 ? diff : null;
  }, [resumo, globalMes]);

  // ---- seleção ----
  const toggleAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selecionaveis.every((r) => next.has(r.id))) selecionaveis.forEach((r) => next.delete(r.id));
      else selecionaveis.forEach((r) => next.add(r.id));
      return next;
    });
  };
  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ---- ações em massa ----
  async function aplicarEmMassa(payload: { status?: StatusDL; data_vencimento?: string }, rotulo: string) {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      const n = await atualizarDetalhadoEmMassa(Array.from(selectedIds), payload);
      toast.success(rotulo, `${n} lançamento${n === 1 ? "" : "s"} atualizado${n === 1 ? "" : "s"}.`);
      setSelectedIds(new Set());
      await fetchData();
    } catch (e: unknown) {
      toast.error("Não foi possível atualizar", (e as Error).message ?? String(e));
    } finally {
      setBulkBusy(false);
    }
  }

  // ---- exclusão em lote (ajuste 27-jul) ----
  async function excluirSelecionados() {
    const n = selectedIds.size;
    if (n === 0) return;
    if (!confirm(`Excluir DEFINITIVAMENTE ${n === 1 ? "o lançamento selecionado" : `os ${n} lançamentos selecionados`}? Essa ação não pode ser desfeita.`)) return;
    setBulkDeleteBusy(true);
    try {
      const excluidos = await deletarDetalhadoEmMassa(Array.from(selectedIds));
      if (excluidos < n) {
        toast.warning("Exclusão parcial", `${excluidos} de ${n} lançamentos excluídos — os demais podem estar vinculados a repasse ou protegidos.`);
      } else {
        toast.success("Lançamentos excluídos", `${excluidos} lançamento${excluidos === 1 ? "" : "s"} excluído${excluidos === 1 ? "" : "s"} de uma vez.`);
      }
      // Remove os excluídos das tags (se estavam tagueados).
      setTags((prev) => {
        let mudou = false;
        const next = new Map(prev);
        selectedIds.forEach((id) => { if (next.delete(id)) mudou = true; });
        return mudou ? next : prev;
      });
      setSelectedIds(new Set());
      await fetchData();
    } catch (e: unknown) {
      toast.error("Não foi possível excluir os selecionados", (e as Error).message ?? String(e));
    } finally {
      setBulkDeleteBusy(false);
    }
  }

  // ---- exportação PDF/XLSX do recorte da tela (ajuste 27-jul) ----
  function montarFiltrosExport(): string[] {
    const f: string[] = [];
    f.push(`Competência: ${mes}`);
    if (search) f.push(`Busca: "${search}"`);
    if (filterSocio) {
      const s = socios.find((x) => x.id === filterSocio);
      f.push(`Sócio: ${s?.apelido ?? s?.nome_completo ?? filterSocio}`);
    }
    if (filterClassif) f.push(`Classificação: ${filterClassif}`);
    if (filterStatus) f.push(`Status: ${STATUS_DL_LABEL[filterStatus]}`);
    if (filterRepasseDe || filterRepasseAte) {
      f.push(`Repasse: ${filterRepasseDe ? formatDate(filterRepasseDe) : "…"} a ${filterRepasseAte ? formatDate(filterRepasseAte) : "…"}`);
    }
    if (filterVencDe || filterVencAte) {
      f.push(`Vencimento: ${filterVencDe ? formatDate(filterVencDe) : "…"} a ${filterVencAte ? formatDate(filterVencAte) : "…"}`);
    }
    if (filterValorMin || filterValorMax) {
      f.push(`Valor: ${filterValorMin ? formatCurrency(Number(filterValorMin)) : "…"} a ${filterValorMax ? formatCurrency(Number(filterValorMax)) : "…"}`);
    }
    if (mostrarSoTagueados && tags.size > 0) f.push(`Apenas lançamentos tagueados (${tags.size})`);
    return f;
  }

  async function handleExport(formato: "pdf" | "xlsx") {
    // Seleção manual tem precedência sobre os filtros (idem ao Financeiro).
    const selecionadas = rows.filter((r) => selectedIds.has(r.id));
    const alvo = selecionadas.length > 0 ? selecionadas : rowsVisiveis;
    if (alvo.length === 0) {
      toast.info("Nada para exportar", "Nenhum lançamento no recorte atual.");
      return;
    }
    const filtros = selecionadas.length > 0
      ? [`Seleção manual — ${selecionadas.length} lançamento${selecionadas.length === 1 ? "" : "s"}`]
      : montarFiltrosExport();
    const setBusy = formato === "pdf" ? setExportandoPdf : setExportandoXlsx;
    setBusy(true);
    try {
      if (formato === "pdf") await exportDistribuicaoPdf(alvo, { filtros });
      else exportDistribuicaoXlsx(alvo, { filtros });
      toast.success("Exportação concluída", `Arquivo ${formato.toUpperCase()} gerado (${alvo.length} linha${alvo.length === 1 ? "" : "s"}).`);
    } catch (e: unknown) {
      toast.error("Falha na exportação", (e as Error).message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  // ---- capa do repasse do sócio (PDFMonkey — ajuste 29-jul) ----
  // Responde "onde vou para gerar a capa do repasse do sócio?": direto daqui,
  // com opção de recortar pelos lançamentos TAGUEADOS do dia.
  function abrirCapa() {
    if (socios.length === 0) {
      toast.warning("Nenhum sócio cadastrado", "Cadastre os sócios para gerar a capa do repasse.");
      return;
    }
    setCapaSocioId(filterSocio || socios[0]?.id || "");
    setCapaSoTagueados(tags.size > 0);
    setCapaOpen(true);
  }

  async function handleGerarCapa() {
    if (!capaSocioId) return;
    setCapaGerando(true);
    try {
      const scope: ReportScope | undefined = capaSoTagueados && tags.size > 0
        ? { scope_type: "por_selecao", transacao_ids: Array.from(tags.keys()) }
        : undefined;
      const res = await gerarPdfBloqueante({
        slug: "capa_socio",
        mes_referencia: mes,
        socio_id: capaSocioId,
        scope,
      });
      if (res.status === "success" && res.download_url) {
        toast.success("Capa do repasse gerada", "O PDF abriu em outra aba e fica no histórico da tela Relatórios.");
        window.open(res.download_url, "_blank");
        setCapaOpen(false);
      } else if (res.status === "failure") {
        toast.error("Geração falhou", res.failure_cause ?? "Verifique o template capa_socio no PDFMonkey.");
      } else {
        toast.info("Geração em andamento", "Acompanhe pelo histórico da tela Relatórios — o link aparece lá.");
        setCapaOpen(false);
      }
    } catch (e: unknown) {
      toast.error("Não foi possível gerar a capa", (e as Error).message ?? String(e));
    } finally {
      setCapaGerando(false);
    }
  }

  // ---- status inline (1 linha) ----
  async function mudarStatus(row: TransacaoSocioRich, status: StatusDL) {
    try {
      await atualizarDetalhado(row.id, { status });
      toast.success("Status atualizado", `${row.descricao}: ${STATUS_DL_LABEL[status]}.`);
      await fetchData();
    } catch (e: unknown) {
      toast.error("Não foi possível mudar o status", (e as Error).message ?? String(e));
    }
  }

  // ---- CRUD ----
  function openNew() {
    setEditRow(null);
    setForm({
      socio_id: filterSocio || "",
      classificacao_pessoal: filterClassif || "",
      descricao: "",
      conta_bancaria_socio_id: "",
      competencia: mes,
      data_vencimento: "",
      data_vencimento_despesa: "",
      valor: "",
      status: "provisionado",
      observacao: "",
    });
    setModalOpen(true);
  }
  function openEdit(row: TransacaoSocioRich) {
    setEditRow(row);
    setForm({
      socio_id: row.socio_id,
      classificacao_pessoal: row.classificacao_pessoal,
      descricao: row.descricao,
      conta_bancaria_socio_id: row.conta_bancaria_socio_id ?? "",
      competencia: row.mes_referencia,
      data_vencimento: row.data_vencimento ?? "",
      data_vencimento_despesa: row.data_vencimento_despesa ?? "",
      valor: String(row.valor),
      status: row.status,
      observacao: row.observacao ?? "",
    });
    setModalOpen(true);
  }
  // Copiar lançamento (ajuste 27-jul — idem ao Financeiro): abre o modal de
  // NOVO já preenchido; ajusta o que precisar e salva.
  function openDuplicate(row: TransacaoSocioRich) {
    setEditRow(null);
    setForm({
      socio_id: row.socio_id,
      classificacao_pessoal: row.classificacao_pessoal,
      descricao: row.descricao,
      conta_bancaria_socio_id: row.conta_bancaria_socio_id ?? "",
      competencia: row.mes_referencia,
      data_vencimento: row.data_vencimento ?? "",
      data_vencimento_despesa: row.data_vencimento_despesa ?? "",
      valor: String(row.valor),
      status: row.status,
      observacao: row.observacao ?? "",
    });
    setModalOpen(true);
    toast.info("Copiando lançamento", "Revise os campos (ex.: descrição e competência) e clique em Adicionar.");
  }

  async function handleSave() {
    if (!form) return;
    if (!form.socio_id || !form.classificacao_pessoal || !form.descricao || !form.valor || !form.competencia) {
      toast.warning("Campos obrigatórios", "Sócio, classificação, descrição, competência e valor são obrigatórios.");
      return;
    }
    const contaSel = contasSocio.find((c) => c.id === form.conta_bancaria_socio_id);
    const payload: TransacaoSocioInsert = {
      data: `${form.competencia}-01`,
      socio_id: form.socio_id,
      classificacao_pessoal: form.classificacao_pessoal,
      descricao: form.descricao,
      conta_bancaria_socio_id: form.conta_bancaria_socio_id || null,
      conta_bancaria_socio_nome: contaSel?.nome ?? (editRow?.conta_bancaria_socio_nome ?? null),
      valor: Number(form.valor),
      data_vencimento: form.data_vencimento || null,
      data_vencimento_despesa: form.data_vencimento_despesa || null,
      status: form.status,
      observacao: form.observacao || null,
      origem_planilha: null,
      created_by: null,
    };
    setSaving(true);
    try {
      if (editRow) {
        await atualizarDetalhado(editRow.id, payload);
        toast.success("Lançamento atualizado");
      } else {
        await criarDetalhado(payload);
        toast.success("Lançamento detalhado criado");
      }
      setModalOpen(false);
      await fetchData();
    } catch (e: unknown) {
      toast.error(editRow ? "Não foi possível atualizar" : "Não foi possível criar", (e as Error).message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row: TransacaoSocioRich) {
    if (row.repasse_id) {
      toast.warning("Lançamento vinculado a repasse", "Desfaça o repasse antes de excluir esta linha.");
      return;
    }
    if (!confirm(`Excluir "${row.descricao}" (${formatCurrency(Number(row.valor))})?`)) return;
    try {
      await deletarDetalhado(row.id);
      removerTag(row.id);
      toast.success("Lançamento excluído");
      await fetchData();
    } catch (e: unknown) {
      toast.error("Não foi possível excluir", (e as Error).message ?? String(e));
    }
  }

  // ---- consolidar / desfazer / concluir ----
  async function handleConsolidar() {
    setConsolidando(true);
    try {
      await consolidarRepasse(mes, consolidarData, incluirTransferencia);
      toast.success(
        "Repasse consolidado",
        `O valor global de ${formatCurrency(totalConsolidavel)} foi lançado no Financeiro da empresa.`,
      );
      setConsolidarOpen(false);
      await fetchData();
    } catch (e: unknown) {
      toast.error("Não foi possível consolidar", (e as Error).message ?? String(e));
    } finally {
      setConsolidando(false);
    }
  }

  async function handleDesfazer(rep: RepasseConsolidado) {
    if (!confirm(`Desfazer o repasse de ${formatCurrency(-rep.valor)}? Os lançamentos globais serão removidos e o detalhado volta a ficar disponível.`)) return;
    try {
      await desfazerRepasse(rep.id);
      toast.success("Repasse desfeito");
      await fetchData();
    } catch (e: unknown) {
      toast.error("Não foi possível desfazer", (e as Error).message ?? String(e));
    }
  }

  async function handleConcluir(rep: RepasseConsolidado) {
    if (!confirm(`Dar baixa no repasse de ${formatCurrency(-rep.valor)}? O global "A repassar" vira "Repassado", a transferência Cora → Inter vira "Pago/Recebido" e o detalhado vinculado vira "Repassado".`)) return;
    try {
      await concluirRepasse(rep.id);
      toast.success("Baixa registrada", "Repasse concluído — saldos do Cora e do Inter atualizados.");
      await fetchData();
    } catch (e: unknown) {
      toast.error("Não foi possível concluir", (e as Error).message ?? String(e));
    }
  }

  // ---- render ----
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#0f1f1c]">Distribuição de Lucro</h1>
          <p className="text-sm text-stone-500">
            Detalhado por sócio — espelho da planilha {`"Distribuição de Lucro_Mensal"`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs text-stone-500" title="Competência da tela toda: KPIs, repasses consolidados, consolidação e a tabela detalhada seguem o mês selecionado aqui.">
            Competência
            <select
              value={mes}
              onChange={(e) => setMes(e.target.value)}
              className="h-8 rounded-lg border border-stone-200 px-2 text-xs bg-white">
              {(meses.includes(mes) ? meses : [mes, ...meses]).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <Button variant="outline" size="sm" onClick={() => handleExport("pdf")}
            loading={exportandoPdf} disabled={exportandoPdf || exportandoXlsx}
            title="Exporta um PDF espelho da tela com os lançamentos selecionados ou filtrados">
            <FileDown size={14} /> Exportar PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport("xlsx")}
            loading={exportandoXlsx} disabled={exportandoPdf || exportandoXlsx}
            title="Exporta uma planilha XLSX (Data do Repasse, Sócio, Classificação, Descrição, Conta Destino, Valor, Vencimento, Status)">
            <FileSpreadsheet size={14} /> Exportar XLSX
          </Button>
          <Button variant="outline" size="sm" onClick={abrirCapa}
            title="Gera a capa do repasse do sócio (PDFMonkey) — com opção de usar só os lançamentos tagueados">
            <FileText size={14} /> Capa do sócio
          </Button>
          <Button
            size="sm"
            onClick={() => setConsolidarOpen(true)}
            disabled={qtdConsolidavel === 0}
            title={qtdConsolidavel === 0
              ? 'Marque lançamentos como "A repassar" para liberar a consolidação'
              : "Cria o lançamento global no Financeiro a partir do detalhado marcado como A repassar"}
          >
            <ArrowRightLeft size={14} />
            Consolidar repasse{totalConsolidavel > 0 ? ` (${formatCurrency(totalConsolidavel)})` : ""}
          </Button>
          <Button variant="outline" size="sm" onClick={openNew}>
            <Plus size={14} /> Novo lançamento detalhado
          </Button>
        </div>
      </div>

      {/* Passo a passo (para quem vem da planilha) */}
      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-stone-600 flex flex-wrap gap-x-6 gap-y-1">
        <span><b className="text-stone-800">1.</b> Confira o detalhado do mês (valores, faturas, vencimentos) e marque item a item como <b>A repassar</b>.</span>
        <span><b className="text-stone-800">2.</b> Clique em <b>Consolidar repasse</b> — o sistema cria o valor global no Financeiro (Cora → Inter) automaticamente.</span>
        <span><b className="text-stone-800">3.</b> Feito o repasse aos sócios, clique em <b>Dar baixa</b> — tudo vira Repassado de uma vez.</span>
      </div>

      {/* KPIs do mês — mesmo padrão visual dos cards do Financeiro (ajuste 27-jul) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {([
          {
            key: "prov",
            label: "Provisionado (mês)",
            valor: resumo?.provisionado ?? 0,
            icon: <PiggyBank size={15} />,
            iconClass: "bg-emerald-50 text-emerald-600",
            labelClass: "text-emerald-700",
            valorClass: "text-emerald-700",
            help: "Soma do detalhado com status Provisionado neste mês. É o que ainda falta conferir/marcar.",
          },
          {
            key: "arep",
            label: "A repassar (pronto p/ repasse)",
            valor: resumo?.a_pagar ?? 0,
            icon: <CalendarCheck size={15} />,
            iconClass: "bg-orange-50 text-orange-600",
            labelClass: "text-orange-700",
            valorClass: "text-orange-600",
            help: "Soma do detalhado marcado como A repassar. A parte ainda não consolidada aparece no botão Consolidar.",
          },
          {
            key: "rep",
            label: "Repassado (mês)",
            valor: resumo?.realizado ?? 0,
            icon: <CheckCheck size={15} />,
            iconClass: "bg-amber-50 text-amber-700",
            labelClass: "text-amber-700",
            valorClass: "text-amber-700",
            help: "Detalhado já baixado (repassado às contas pessoais dos sócios).",
          },
          {
            key: "glob",
            label: "Global na empresa (2.8.1)",
            valor: globalMes?.totalCentro281 ?? 0,
            icon: <Landmark size={15} />,
            iconClass: "bg-emerald-50 text-emerald-700",
            labelClass: "text-emerald-800",
            valorClass: "text-emerald-700",
            help: "Soma dos lançamentos do centro de custo 2.8.1 (Distribuição de Lucros) no Financeiro da empresa neste mês — provisionado + a repassar + repassado. Deve bater com o detalhado.",
          },
        ]).map((c) => (
          <div
            key={c.key}
            title={c.help}
            className="rounded-xl border border-stone-200 bg-white shadow-sm px-3.5 py-2.5 flex items-center gap-3"
          >
            <span className={`h-8 w-8 shrink-0 rounded-full flex items-center justify-center ${c.iconClass}`}>
              {c.icon}
            </span>
            <span className="leading-tight min-w-0">
              <p className={`text-[10px] font-semibold uppercase tracking-wide truncate ${c.labelClass}`}>
                {c.label}
              </p>
              <p className={`text-sm font-bold tabular-nums whitespace-nowrap ${c.valorClass}`}>
                {formatCurrency(c.valor)}
              </p>
            </span>
          </div>
        ))}
      </div>

      {/* Divergência entre global manual e detalhado */}
      {divergenciaProvisionado !== null && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            O provisionado global lançado à mão no Financeiro ({formatCurrency(globalMes?.provisionadoGlobal ?? 0)}) difere
            da soma do detalhado ({formatCurrency(resumo?.provisionado ?? 0)}) em {formatCurrency(divergenciaProvisionado)}.
            Enquanto existir lançamento provisionado manual no centro 2.8.1 (Distribuição de Lucros) deste mês, o sistema
            não sincroniza o global automaticamente — ajuste ou exclua a linha manual no{" "}
            <Link href="/dashboard/financeiro" className="underline font-medium">Financeiro</Link> para
            ativar a sincronização automática.
          </span>
        </div>
      )}

      {/* Repasses consolidados do mês */}
      {repasses.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Repasses consolidados do mês</CardTitle>
            <HandCoins size={16} className="text-stone-400" />
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-100">
                  {["Data", "Descrição", "Detalhados", "Valor", "Status", "Ações"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-stone-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {repasses.map((rep) => (
                  <tr key={rep.id} className="border-b border-stone-50">
                    <td className="px-4 py-2.5 text-xs text-stone-500 whitespace-nowrap">{formatDate(rep.data)}</td>
                    <td className="px-4 py-2.5 text-stone-700">{rep.descricao}</td>
                    <td className="px-4 py-2.5 text-xs text-stone-500">{rep.qtd_detalhados} lançamento{rep.qtd_detalhados === 1 ? "" : "s"}</td>
                    <td className="px-4 py-2.5 font-semibold text-red-600 whitespace-nowrap">{formatCurrency(rep.valor)}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant={rep.status === "repassado" ? "success" : "danger"}>
                        {STATUS_EMPRESA_LABEL[rep.status] ?? rep.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      {(rep.status === "a_pagar" || rep.status === "a_repassar") && (
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => handleConcluir(rep)}
                            title="Marca global, transferência e detalhado como repassados/pagos de uma vez">
                            <CheckCheck size={13} /> Dar baixa
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDesfazer(rep)}
                            title="Remove os lançamentos globais e libera o detalhado novamente">
                            <Undo2 size={13} /> Desfazer
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Tabela detalhada */}
      <Card>
        <CardHeader className="flex-col items-start gap-3 lg:flex-row lg:items-center lg:gap-2">
          <CardTitle>Detalhado por sócio</CardTitle>
          <div className="flex items-center gap-2 flex-wrap ml-auto">
            <div className="relative" title="Busca por descrição ou observação">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar descrição…"
                className="h-8 rounded-lg border border-stone-200 pl-8 pr-3 text-xs w-52 focus:outline-none focus:ring-1 focus:ring-accent-400"
              />
            </div>
            <select value={filterSocio} onChange={(e) => setFilterSocio(e.target.value)}
              className="h-8 rounded-lg border border-stone-200 px-2 text-xs">
              <option value="">Todos os sócios</option>
              {socios.map((s) => <option key={s.id} value={s.id}>{s.apelido ?? s.nome_completo}</option>)}
            </select>
            <select value={filterClassif} onChange={(e) => setFilterClassif(e.target.value)}
              className="h-8 rounded-lg border border-stone-200 px-2 text-xs">
              <option value="">Todas as classificações</option>
              {classifs.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} – {c.nome}</option>)}
            </select>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as StatusDL | "")}
              className="h-8 rounded-lg border border-stone-200 px-2 text-xs">
              <option value="">Todos os status</option>
              {(Object.keys(STATUS_DL_LABEL) as StatusDL[]).map((s) =>
                <option key={s} value={s}>{STATUS_DL_LABEL[s]}</option>)}
            </select>
            {/* Período pela DATA DO REPASSE (RF 23-jul — substitui a pesquisa por mês) */}
            <div className="flex items-center gap-1" title="Período pela Data do Repasse.">
              <span className="text-[10px] uppercase text-stone-400 font-medium">Repasse</span>
              <input type="date" value={filterRepasseDe} max={filterRepasseAte || undefined}
                aria-label="Data do repasse de"
                onChange={(e) => setFilterRepasseDe(e.target.value)}
                className="h-8 rounded-lg border border-stone-200 px-2 text-xs" />
              <span className="text-stone-400 text-xs">até</span>
              <input type="date" value={filterRepasseAte} min={filterRepasseDe || undefined}
                aria-label="Data do repasse até"
                onChange={(e) => setFilterRepasseAte(e.target.value)}
                className="h-8 rounded-lg border border-stone-200 px-2 text-xs" />
              {(filterRepasseDe || filterRepasseAte) && (
                <button type="button" onClick={() => { setFilterRepasseDe(""); setFilterRepasseAte(""); }}
                  className="text-stone-400 hover:text-stone-600 px-1 text-sm leading-none"
                  title="Limpar período de repasse" aria-label="Limpar período de repasse">×</button>
              )}
            </div>
            {/* Período pelo VENCIMENTO da despesa (RF 23-jul) */}
            <div className="flex items-center gap-1" title="Período pelo Vencimento da despesa/fatura.">
              <span className="text-[10px] uppercase text-stone-400 font-medium">Venc.</span>
              <input type="date" value={filterVencDe} max={filterVencAte || undefined}
                aria-label="Vencimento de"
                onChange={(e) => setFilterVencDe(e.target.value)}
                className="h-8 rounded-lg border border-stone-200 px-2 text-xs" />
              <span className="text-stone-400 text-xs">até</span>
              <input type="date" value={filterVencAte} min={filterVencDe || undefined}
                aria-label="Vencimento até"
                onChange={(e) => setFilterVencAte(e.target.value)}
                className="h-8 rounded-lg border border-stone-200 px-2 text-xs" />
              {(filterVencDe || filterVencAte) && (
                <button type="button" onClick={() => { setFilterVencDe(""); setFilterVencAte(""); }}
                  className="text-stone-400 hover:text-stone-600 px-1 text-sm leading-none"
                  title="Limpar período de vencimento" aria-label="Limpar período de vencimento">×</button>
              )}
            </div>
            {/* Faixa de VALOR em R$ (RF 24-jul — espelha o Financeiro) */}
            <div className="flex items-center gap-1" title="Filtra pela faixa de valor (em R$).">
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
                onChange={(e) => setFilterValorMin(e.target.value)}
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
                onChange={(e) => setFilterValorMax(e.target.value)}
                className="h-8 w-20 rounded-lg border border-stone-200 px-2 text-xs"
              />
              {(filterValorMin || filterValorMax) && (
                <button type="button" onClick={() => { setFilterValorMin(""); setFilterValorMax(""); }}
                  className="text-stone-400 hover:text-stone-600 px-1 text-sm leading-none"
                  title="Limpar filtro de valor" aria-label="Limpar filtro de valor">×</button>
              )}
            </div>
            {/* Recorte "só tagueados" ativo — chip visível junto dos filtros (27-jul) */}
            {mostrarSoTagueados && (
              <span
                className="h-8 inline-flex items-center gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-2 text-xs font-medium text-amber-800"
                title="A tabela está mostrando apenas os lançamentos tagueados"
              >
                <Tag size={12} fill="currentColor" /> Só tagueados
                <button
                  type="button"
                  onClick={() => setMostrarSoTagueados(false)}
                  className="text-amber-400 hover:text-amber-700 cursor-pointer"
                  aria-label="Mostrar todos os lançamentos"
                  title="Voltar a mostrar todos"
                >
                  ×
                </button>
              </span>
            )}
            {/* Limpar todos os filtros de uma vez (RF 24-jul) */}
            {temFiltrosAtivos && (
              <button
                type="button"
                onClick={limparTodosFiltros}
                className="h-8 px-2 rounded-lg text-xs font-medium text-stone-500 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-100 transition-colors inline-flex items-center gap-1 cursor-pointer"
                title="Remove todos os filtros da listagem de uma vez (competência, busca, sócio, classificação, status, períodos e valor)"
              >
                <FilterX size={13} /> Limpar todos os filtros
              </button>
            )}
          </div>
        </CardHeader>

        {/* Barra de ações em massa */}
        {selectedIds.size > 0 && (
          <div className="mx-4 mb-1 rounded-lg bg-accent-50 border border-accent-200 px-3 py-2 flex items-center gap-2 flex-wrap text-xs">
            <span className="font-medium text-stone-700">{selectedIds.size} selecionado{selectedIds.size === 1 ? "" : "s"}:</span>
            <input
              type="date"
              value={bulkVencimento}
              onChange={(e) => setBulkVencimento(e.target.value)}
              className="h-7 rounded-lg border border-stone-200 px-2 text-xs"
              title="Data do Repasse a aplicar nos selecionados"
            />
            <Button size="sm" variant="outline" disabled={!bulkVencimento || bulkBusy || bulkDeleteBusy}
              onClick={() => aplicarEmMassa({ data_vencimento: bulkVencimento }, "Data do repasse aplicada")}>
              Aplicar data do repasse
            </Button>
            {/* Status genérico em massa (27-jul — idem ao Financeiro) */}
            <select
              value={bulkStatusSel}
              onChange={(e) => setBulkStatusSel(e.target.value)}
              className="h-7 rounded-lg border border-stone-200 px-2 text-xs bg-white"
              title="Status a aplicar em todos os selecionados"
            >
              <option value="">Escolher status…</option>
              {(Object.keys(STATUS_DL_LABEL) as StatusDL[]).map((s) =>
                <option key={s} value={s}>{STATUS_DL_LABEL[s]}</option>)}
            </select>
            <Button size="sm" variant="outline" disabled={!bulkStatusSel || bulkBusy || bulkDeleteBusy}
              onClick={() => {
                const status = bulkStatusSel as StatusDL;
                setBulkStatusSel("");
                aplicarEmMassa(
                  bulkVencimento ? { status, data_vencimento: bulkVencimento } : { status },
                  `Status "${STATUS_DL_LABEL[status]}" aplicado`,
                );
              }}
              title="Aplica o status escolhido em todos os selecionados de uma vez (aplica também a data do repasse, se preenchida)">
              Aplicar status
            </Button>
            {/* Exclusão em lote (27-jul) */}
            <Button size="sm" variant="outline" disabled={bulkBusy || bulkDeleteBusy}
              loading={bulkDeleteBusy}
              onClick={excluirSelecionados}
              className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
              title="Exclui DE UMA VEZ todos os lançamentos selecionados (pede confirmação)">
              <Trash2 size={13} /> Excluir selecionados
            </Button>
            {/* Soma dos selecionados (27-jul) */}
            <span
              className="ml-auto inline-flex items-center gap-1.5 font-semibold text-stone-700 tabular-nums bg-white border border-accent-200 rounded-lg px-2.5 py-1"
              title="Soma dos valores dos lançamentos selecionados"
            >
              Soma: <span className="text-stone-800">{formatCurrency(somaSelecionados)}</span>
            </span>
            <button onClick={() => setSelectedIds(new Set())} className="text-stone-400 hover:text-stone-600 underline">
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
                    <input type="checkbox" aria-label="Selecionar todos" checked={allSelected} onChange={toggleAll}
                      className="h-3.5 w-3.5 rounded border-stone-300 accent-accent-500 cursor-pointer" />
                  </th>
                  <th className="px-1 py-3 w-8" title="Tag do dia — o 'pintar de amarelo' da planilha: marque o que está sendo trabalhado hoje">
                    <Tag size={12} className="text-amber-400 mx-auto" />
                  </th>
                  {["Data do Repasse","Sócio","Classificação","Descrição","Conta destino","Vencimento","Valor","Status","Repasse","Ações"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={12} className="px-4 py-12 text-center text-stone-400">
                    <Loader2 size={18} className="inline-block animate-spin mr-2" /> Carregando…
                  </td></tr>
                )}
                {!loading && rowsVisiveis.length === 0 && (
                  <tr><td colSpan={12} className="px-4 py-12 text-center text-stone-400">
                    Nenhum lançamento detalhado no recorte. Clique em {"“Novo lançamento detalhado”"} para começar
                    — ou lance pelo Financeiro escolhendo {"“Saída detalhada”"} na conta 2.8.
                  </td></tr>
                )}
                {!loading && rowsVisiveis.map((r) => {
                  const vinculado = !!r.repasse_id;
                  const selected = selectedIds.has(r.id);
                  const tagueado = tags.has(r.id);
                  return (
                    <tr key={r.id} className={`border-b border-stone-50 transition-colors table-row-alt ${tagueado ? "bg-amber-50/80" : selected ? "bg-accent-50/60" : "hover:bg-stone-50"}`}>
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          aria-label="Selecionar lançamento"
                          checked={selected}
                          disabled={vinculado}
                          onChange={() => toggleOne(r.id)}
                          className="h-3.5 w-3.5 rounded border-stone-300 accent-accent-500 cursor-pointer disabled:opacity-30"
                        />
                      </td>
                      <td className="px-1 py-3 text-center">
                        <button
                          type="button"
                          onClick={() => toggleTag(r)}
                          className={`p-1 rounded transition cursor-pointer ${tagueado ? "text-amber-500 hover:text-amber-600" : "text-stone-200 hover:text-amber-400"}`}
                          title={tagueado
                            ? "Remover a tag deste lançamento"
                            : "Taguear este lançamento (o 'pintar de amarelo' da planilha — a marcação fica salva mesmo trocando filtros ou recarregando)"}
                          aria-label={tagueado ? "Remover tag" : "Taguear lançamento"}
                        >
                          <Tag size={13} fill={tagueado ? "currentColor" : "none"} />
                        </button>
                      </td>
                      <td className="px-4 py-3 text-stone-500 text-xs whitespace-nowrap">
                        {r.data_vencimento ? formatDate(r.data_vencimento) : <span className="text-stone-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-stone-700 text-xs font-medium whitespace-nowrap">
                        {r.socio?.apelido ?? r.socio?.nome_completo ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-stone-700 text-xs">
                        <div>{r.classificacao?.nome ?? r.classificacao_pessoal}</div>
                        <div className="text-stone-400 text-[10px]">{r.classificacao_pessoal}</div>
                      </td>
                      <td className="px-4 py-3 text-stone-700 max-w-[240px] truncate" title={r.descricao}>{r.descricao}</td>
                      <td className="px-4 py-3 text-stone-500 text-xs max-w-[160px] truncate"
                        title={r.conta_bancaria_socio?.nome ?? r.conta_bancaria_socio_nome ?? ""}>
                        {r.conta_bancaria_socio?.nome ?? r.conta_bancaria_socio_nome ?? <span className="text-stone-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-stone-500 text-xs whitespace-nowrap">
                        {r.data_vencimento_despesa ? formatDate(r.data_vencimento_despesa) : <span className="text-stone-300">—</span>}
                      </td>
                      <td className="px-4 py-3 font-semibold text-sm whitespace-nowrap text-stone-800">
                        {formatCurrency(Number(r.valor))}
                      </td>
                      <td className="px-4 py-3">
                        {vinculado ? (
                          <Badge variant={DL_BADGE[r.status]}>{STATUS_DL_LABEL[r.status]}</Badge>
                        ) : (
                          <StatusSelect
                            value={r.status}
                            options={DL_SELECT_OPTIONS}
                            onChange={(v) => mudarStatus(r, v as StatusDL)}
                            title="Mudar status deste lançamento"
                            aria-label={`Status de ${r.descricao}`}
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {vinculado
                          ? <Badge variant="success" className="whitespace-nowrap">✓ consolidado</Badge>
                          : <span className="text-stone-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-primary-50 text-stone-400 hover:text-primary-600 transition" title="Editar">
                            <Edit2 size={13} />
                          </button>
                          <button onClick={() => openDuplicate(r)} className="p-1.5 rounded hover:bg-accent-50 text-stone-400 hover:text-accent-600 transition" title="Copiar (abre um novo lançamento já preenchido)">
                            <Copy size={13} />
                          </button>
                          <button onClick={() => handleDelete(r)} className="p-1.5 rounded hover:bg-red-50 text-stone-400 hover:text-red-500 transition" title="Excluir">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {!loading && rowsVisiveis.length > 0 && (
                <tfoot>
                  <tr className="bg-stone-100 border-t-2 border-stone-200 font-semibold text-stone-700 text-xs">
                    <td colSpan={8} className="px-4 py-2.5 uppercase tracking-wide">Total do recorte</td>
                    <td className="px-4 py-2.5">{formatCurrency(rowsVisiveis.reduce((s, r) => s + Number(r.valor), 0))}</td>
                    <td colSpan={3}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <div className="px-4 py-3 border-t border-stone-100 text-xs text-stone-400 flex items-center gap-3 flex-wrap">
            <span>{loading ? "…" : `${rowsVisiveis.length} lançamento${rowsVisiveis.length === 1 ? "" : "s"} no recorte`}</span>
            {selectedIds.size > 0 && (
              <span className="inline-flex items-center gap-2 text-accent-600 font-medium">
                {selectedIds.size} selecionado{selectedIds.size === 1 ? "" : "s"}
                <span className="text-stone-500 tabular-nums" title="Soma dos selecionados">
                  · Soma: {formatCurrency(somaSelecionados)}
                </span>
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Modal CRUD detalhado */}
      <Modal open={modalOpen} onClose={guard.requestClose}
        title={editRow ? "Editar Lançamento Detalhado" : "Novo Lançamento Detalhado"} size="lg">
        {form && (
          <div className="p-6 space-y-4">
            {editRow?.repasse_id && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                Este lançamento já foi consolidado em um repasse global. Alterações de valor não atualizam o
                global automaticamente — desfaça o repasse se precisar mexer no valor.
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Select label="Sócio *" value={form.socio_id}
                onChange={(e) => setForm({ ...form, socio_id: e.target.value, conta_bancaria_socio_id: "" })}>
                <option value="">Selecione…</option>
                {socios.map((s) => <option key={s.id} value={s.id}>{s.apelido ?? s.nome_completo}</option>)}
              </Select>
              <Select label="Classificação *" value={form.classificacao_pessoal}
                onChange={(e) => setForm({ ...form, classificacao_pessoal: e.target.value })}>
                <option value="">Selecione…</option>
                {classifs.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} – {c.nome}</option>)}
              </Select>
            </div>
            <Input label="Descrição *" value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              placeholder="IPTU, Folha de pagamento, Energia…" />
            <div className="grid grid-cols-2 gap-3">
              <Select label="Conta destino do sócio" value={form.conta_bancaria_socio_id}
                disabled={!form.socio_id}
                onChange={(e) => setForm({ ...form, conta_bancaria_socio_id: e.target.value })}>
                <option value="">—</option>
                {contasSocio.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </Select>
              <Input label="Valor (R$) *" type="number" step="0.01" min="0" value={form.valor}
                onChange={(e) => setForm({ ...form, valor: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Competência (mês) *" type="month" value={form.competencia}
                onChange={(e) => setForm({ ...form, competencia: e.target.value })} />
              <Input label="Data do Repasse" type="date" value={form.data_vencimento}
                title="Data programada para a realização do repasse ao sócio"
                onChange={(e) => setForm({ ...form, data_vencimento: e.target.value })} />
              <Input label="Vencimento" type="date" value={form.data_vencimento_despesa}
                title="Data de vencimento da despesa/fatura"
                onChange={(e) => setForm({ ...form, data_vencimento_despesa: e.target.value })} />
              <Select label="Status" value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as StatusDL })}>
                {(Object.keys(STATUS_DL_LABEL) as StatusDL[]).map((s) =>
                  <option key={s} value={s}>{STATUS_DL_LABEL[s]}</option>)}
              </Select>
            </div>
            <Textarea label="Observação" rows={2} value={form.observacao}
              onChange={(e) => setForm({ ...form, observacao: e.target.value })} />
            <div className="flex gap-3 justify-end pt-2">
              <Button variant="ghost" onClick={guard.requestClose}>Cancelar</Button>
              <Button onClick={handleSave} loading={saving} disabled={saving}>
                {editRow ? "Salvar Alterações" : "Adicionar"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
      <UnsavedChangesDialog open={guard.confirmOpen} onStay={guard.stay} onDiscard={guard.discard} />

      {/* Modal Consolidar */}
      <Modal open={consolidarOpen} onClose={() => setConsolidarOpen(false)}
        title="Consolidar repasse global" size="lg" closeOnBackdrop={false}>
        <div className="p-6 space-y-4">
          <p className="text-sm text-stone-600">
            Serão consolidados <b>{qtdConsolidavel}</b> lançamento{qtdConsolidavel === 1 ? "" : "s"} detalhado{qtdConsolidavel === 1 ? "" : "s"} de <b>{mes}</b> com
            status {"“A repassar”"} — total de <b className="text-stone-800">{formatCurrency(totalConsolidavel)}</b>.
          </p>

          {porSocioConsolidavel.length > 0 && (
            <div className="rounded-lg border border-stone-200 divide-y divide-stone-100 text-sm">
              {porSocioConsolidavel.map((s) => (
                <div key={s.nome} className="flex items-center justify-between px-3 py-2">
                  <span className="text-stone-600">{s.nome} <span className="text-stone-400 text-xs">({s.qtd})</span></span>
                  <span className="font-semibold text-stone-800">{formatCurrency(s.total)}</span>
                </div>
              ))}
            </div>
          )}
          {consolidaveis.length < qtdConsolidavel && (
            <p className="text-xs text-stone-400">
              (O resumo acima considera só o recorte filtrado na tela; a consolidação usa TODOS os lançamentos
              {" “A repassar”"} do mês, totalizando {formatCurrency(totalConsolidavel)}.)
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Input label="Data do repasse" type="date" value={consolidarData}
              onChange={(e) => setConsolidarData(e.target.value)} />
            <label className="flex items-center gap-2 text-sm text-stone-700 mt-6 cursor-pointer">
              <input type="checkbox" checked={incluirTransferencia}
                onChange={(e) => setIncluirTransferencia(e.target.checked)}
                className="h-4 w-4 rounded border-stone-300 accent-accent-500" />
              Incluir transferência Cora → Inter
            </label>
          </div>

          <div className="rounded-lg bg-stone-50 border border-stone-200 px-4 py-3 text-xs text-stone-600 space-y-1">
            <p className="font-semibold text-stone-700">O que será criado no Financeiro:</p>
            {incluirTransferencia && (
              <>
                <p>• Saída no <b>Cora</b> de {formatCurrency(totalConsolidavel)} (Transf. Entre Contas — 2.9)</p>
                <p>• Entrada no <b>Inter</b> de {formatCurrency(totalConsolidavel)} (Transf. Entre Contas — 1.9)</p>
              </>
            )}
            <p>• Saída global no <b>Inter</b> de {formatCurrency(totalConsolidavel)} (Distribuição de Lucro — 2.8), status {"“A repassar”"}</p>
            <p className="text-stone-400 pt-1">
              O global nasce {"“A repassar”"} (é um repasse de distribuição de lucros) e a transferência {"“A pagar/A receber”"}.
              Depois de efetivar o repasse aos sócios, use {"“Dar baixa”"} aqui nesta tela para marcar tudo como
              Pago/Recebido/Repassado de uma vez.
            </p>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={() => setConsolidarOpen(false)}>Cancelar</Button>
            <Button onClick={handleConsolidar} loading={consolidando} disabled={consolidando || qtdConsolidavel === 0}>
              <ArrowRightLeft size={14} /> Consolidar {formatCurrency(totalConsolidavel)}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal Capa do repasse do sócio (PDFMonkey — ajuste 29-jul) */}
      <Modal open={capaOpen} onClose={() => { if (!capaGerando) setCapaOpen(false); }}
        title="Capa do repasse do sócio" size="md" closeOnBackdrop={false}>
        <div className="p-6 space-y-4">
          <p className="text-sm text-stone-600">
            Gera a capa em PDF (template do PDFMonkey) do repasse de <b>{mes}</b> para o sócio escolhido —
            a mesma capa da tela Relatórios, agora direto daqui.
          </p>

          <Select label="Sócio" value={capaSocioId} onChange={(e) => setCapaSocioId(e.target.value)}>
            {socios.map((s) => (
              <option key={s.id} value={s.id}>{s.apelido || s.nome_completo}</option>
            ))}
          </Select>

          <label className={`flex items-start gap-2 text-sm ${tags.size > 0 ? "text-stone-700 cursor-pointer" : "text-stone-400"}`}>
            <input
              type="checkbox"
              checked={capaSoTagueados && tags.size > 0}
              disabled={tags.size === 0}
              onChange={(e) => setCapaSoTagueados(e.target.checked)}
              className="h-4 w-4 mt-0.5 rounded border-stone-300 accent-accent-500"
            />
            <span>
              Usar somente os lançamentos <b>tagueados do dia</b> ({tags.size})
              <span className="block text-xs text-stone-400">
                Entram na capa apenas os tagueados deste sócio e desta competência.
                {tags.size === 0 ? " Não há tags no momento — a capa sai com o mês completo." : ""}
              </span>
            </span>
          </label>

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={() => setCapaOpen(false)} disabled={capaGerando}>Cancelar</Button>
            <Button onClick={handleGerarCapa} loading={capaGerando} disabled={capaGerando || !capaSocioId}>
              <FileText size={14} /> Gerar capa
            </Button>
          </div>
        </div>
      </Modal>

      {/* Painel flutuante das TAGs do dia (ajuste 27-jul — idem ao Financeiro) */}
      {tags.size > 0 && (
        <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-2">
          {tagPanelOpen && (
            <div className="w-80 max-w-[calc(100vw-2.5rem)] rounded-xl border border-amber-200 bg-white shadow-xl overflow-hidden">
              <div className="px-3 py-2 bg-amber-50 border-b border-amber-100 flex items-center justify-between">
                <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                  <Tag size={12} /> Tagueados do dia ({tags.size})
                </p>
                <button
                  type="button"
                  onClick={() => setTagPanelOpen(false)}
                  className="text-amber-400 hover:text-amber-600 cursor-pointer"
                  aria-label="Fechar painel de tags"
                >
                  <X size={14} />
                </button>
              </div>
              <ul className="max-h-64 overflow-y-auto divide-y divide-stone-50 text-xs">
                {Array.from(tags.values()).map((t) => (
                  <li key={t.id} className="px-3 py-2 flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-stone-700" title={t.descricao ?? undefined}>
                        {t.descricao || "(sem descrição)"}
                      </p>
                      <p className="text-[10px] text-stone-400 truncate">{t.socio ?? ""}</p>
                    </div>
                    <span className="font-semibold tabular-nums whitespace-nowrap text-stone-800">
                      {formatCurrency(t.valor)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removerTag(t.id)}
                      className="text-stone-300 hover:text-red-500 cursor-pointer shrink-0"
                      title="Remover tag"
                      aria-label="Remover tag"
                    >
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="px-3 py-2 border-t border-stone-100 flex items-center justify-between text-xs">
                <span className="text-stone-500">Soma:</span>
                <span className="font-bold tabular-nums text-stone-800">{formatCurrency(somaTags)}</span>
              </div>
              <div className="px-3 pb-3 pt-1 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setMostrarSoTagueados((v) => !v)}
                  title="Filtra a tabela para mostrar apenas os lançamentos tagueados"
                >
                  {mostrarSoTagueados ? "Mostrar todos" : "Ver só tagueados"}
                </Button>
                <button
                  type="button"
                  onClick={limparTags}
                  className="text-stone-400 hover:text-red-500 underline ml-auto text-xs cursor-pointer"
                >
                  limpar tags
                </button>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => setTagPanelOpen((v) => !v)}
            className="rounded-full bg-amber-500 hover:bg-amber-600 text-white shadow-lg px-4 h-10 flex items-center gap-2 text-sm font-semibold cursor-pointer transition-colors"
            title="Lançamentos tagueados do dia — clique para abrir o painel"
          >
            <Tag size={15} fill="currentColor" />
            {tags.size} · {formatCurrency(somaTags)}
          </button>
        </div>
      )}
    </div>
  );
}
