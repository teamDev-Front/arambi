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
  ArrowRightLeft, Undo2, CalendarCheck, CalendarDays, Users, Landmark, AlertTriangle, FilterX,
  Copy, Tag, X, FileDown, FileText, RefreshCw,
} from "lucide-react";
import { gerarPdfBloqueante } from "@/lib/pdfmonkey/frontend";
import type { ReportScope } from "@/lib/pdfmonkey/types";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { StatusSelect } from "@/components/ui/StatusSelect";
import { CompetenciaMultiSelect } from "@/components/ui/CompetenciaMultiSelect";
import { MultiSelect } from "@/components/ui/MultiSelect";
import { Pagination } from "@/components/ui/Pagination";
import { SelectAllHeader } from "@/components/ui/SelectAllHeader";
import {
  listarDetalhado, criarDetalhado, atualizarDetalhado, deletarDetalhado,
  atualizarDetalhadoEmMassa, deletarDetalhadoEmMassa, obterResumoMensal, obterGlobalEmpresaMes,
  listarRepassesDoMes, consolidarRepasse, desfazerRepasse, concluirRepasse, religarSyncDl,
  listarSocios, listarClassificacoesPessoais, listarContasDoSocio, listarContasAtivasSocios,
  listarMesesDetalhado,
  type TransacaoSocioRich, type GlobalEmpresaMes, type RepasseConsolidado,
} from "@/lib/queries/distribuicao";
import {
  desfazerCriacao, desfazerEdicao, desfazerExclusao, desfazerStatusEmMassa,
} from "@/lib/queries/desfazer";
import { exportDistribuicaoPdf, exportDistribuicaoXlsx } from "@/lib/export/distribuicao-export";
import { CamposExportDlModal, type CamposExportDlEscolha } from "./CamposExportDlModal";
import { getNomeUsuarioAtual, linhaEmissao } from "@/lib/auth/usuario-atual";
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

/** "2026-08" → "08/2026" (rótulo da competência na tabela). */
const mesHumano = (m: string) => (m?.length === 7 ? `${m.slice(5)}/${m.slice(0, 4)}` : m || "—");

/** Linhas por página do detalhado (04-set-2026) — o mesmo limite do Financeiro. */
const PAGE_SIZE = 25;

/** "2026-09" → "30/09" (último dia do mês, para os rótulos dos cards). */
const ultimoDiaCurto = (mes: string) => {
  const [y, m] = mes.split("-").map(Number);
  return formatDate(new Date(y, m, 0)).slice(0, 5);
};

/** Minúsculas e sem acento — "Cláudio" e "claudio" se encontram na busca. */
const normalizarBusca = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/**
 * A COMPETÊNCIA da Distribuição de Lucro é um campo próprio (grava
 * `data = AAAA-MM-01`) e NÃO acompanha a Data do Repasse / o Vencimento — ao
 * contrário do Financeiro, onde a competência É o mês do vencimento. Isso é
 * proposital (folha de abril paga em maio continua sendo competência de abril),
 * mas gerava confusão: um lançamento com as duas datas em 30/08 seguia
 * aparecendo na consulta de julho, sem nada na tela explicando o porquê
 * (apontamento de 31-jul-2026).
 *
 * Esta função devolve o mês que as DATAS do lançamento sugerem, quando ele
 * diverge da competência — a tabela então marca a linha e oferece mover.
 */
function competenciaSugerida(r: TransacaoSocioRich): string | null {
  const base = r.data_vencimento ?? r.data_vencimento_despesa;
  if (!base) return null;
  const mes = base.slice(0, 7);
  return mes !== r.mes_referencia ? mes : null;
}

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

  // ---- competência (tabela / consolidação) ----
  // Competência multi-seleção (17-ago). Lista vazia = TODAS as competências —
  // "colocar a opção TODAS, idem do FINANCEIRO".
  //
  // 04-set-2026: ao abrir, o filtro vem como "Todas" (era o mês vigente) —
  // padronização com o Financeiro. Os CARDS deixaram de seguir este seletor:
  // mostram sempre o mês vigente (ver mesVigente abaixo).
  const [mesesSel, setMesesSel] = useState<string[]>([]);
  const [meses, setMeses] = useState<string[]>([]);
  /**
   * Mês vigente — competência fixa dos cards-botão (04-set: "independentemente
   * da competência selecionada no filtro, os atalhos devem apresentar as
   * informações referentes ao mês vigente", idem aos cards do Financeiro).
   */
  const mesVigente = mesCorrente();
  const ateDia = ultimoDiaCurto(mesVigente);
  /**
   * A CONSOLIDAÇÃO é sempre de um mês só: ela gera um lançamento global com
   * uma competência. Com "Todas" (ou várias) marcadas, o botão fica desligado
   * e explica o motivo — melhor que consolidar meses juntos por engano.
   */
  const mesFoco = mesesSel.length === 1 ? mesesSel[0] : null;

  // ---- filtros da listagem (RF 23-jul: períodos em vez de mês) ----
  // Sócios, Classificações e Status com caixa de seleção múltipla (04-set —
  // "idem ao financeiro"); lista vazia = todos. Conta Destino é filtro novo.
  const [filterSocios, setFilterSocios] = useState<string[]>([]);
  const [filterClassifs, setFilterClassifs] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<StatusDL[]>([]);
  const [filterContas, setFilterContas] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  // Paginação do detalhado (04-set) — mesmo limite por página do Financeiro.
  const [page, setPage] = useState(1);
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
    search || filterSocios.length || filterClassifs.length || filterStatus.length || filterContas.length ||
    filterRepasseDe || filterRepasseAte || filterVencDe || filterVencAte ||
    filterValorMin || filterValorMax || mostrarSoTagueados,
  );

  // "Limpar todos os filtros" (RF 24-jul) — não mexe na competência do header.
  function limparTodosFiltros() {
    setSearch("");
    setFilterSocios([]);
    setFilterClassifs([]);
    setFilterStatus([]);
    setFilterContas([]);
    setFilterRepasseDe("");
    setFilterRepasseAte("");
    setFilterVencDe("");
    setFilterVencAte("");
    setFilterValorMin("");
    setFilterValorMax("");
    setMostrarSoTagueados(false);
    setPage(1);
  }

  // ---- dados ----
  const [rows, setRows] = useState<TransacaoSocioRich[]>([]);
  // Resumo / global / repasses do MÊS VIGENTE — alimentam os cards (04-set).
  const [resumo, setResumo] = useState<DlMensalResumoRow | null>(null);
  const [globalMes, setGlobalMes] = useState<GlobalEmpresaMes | null>(null);
  const [repasses, setRepasses] = useState<RepasseConsolidado[]>([]);
  /**
   * Resumo / global da competência EM FOCO (a única marcada no filtro; sem
   * foco, o mês vigente). É o que a consolidação e a conferência do
   * provisionado global usam — elas são de UM mês, e não seguem os cards.
   */
  const [foco, setFoco] = useState<{ mes: string; resumo: DlMensalResumoRow | null; global: GlobalEmpresaMes | null }>({
    mes: mesVigente, resumo: null, global: null,
  });
  /**
   * Modal "Repasses consolidados": o card mostra o mês vigente; dentro do
   * modal dá para trocar o mês (para dar baixa / desfazer um repasse antigo,
   * já que o filtro Competência da tela não comanda mais os cards).
   */
  const [repassesMesSel, setRepassesMesSel] = useState<string>(mesVigente);
  const [repassesOutroMes, setRepassesOutroMes] = useState<RepasseConsolidado[]>([]);
  const [repassesOutroLoading, setRepassesOutroLoading] = useState(false);
  const [repassesTick, setRepassesTick] = useState(0);
  const repassesModal = repassesMesSel === mesVigente ? repasses : repassesOutroMes;
  /**
   * RF 20-ago: a coluna "Ações" do modal de repasses consolidados só aparece
   * quando há algo a fazer. Com tudo já repassado (o caso comum) ela ficava
   * como uma coluna vazia — foi isso que a Adri pediu para tirar. Os botões
   * "Dar baixa" / "Desfazer" continuam disponíveis quando há repasse pendente.
   */
  const temAcoesRepasse = repassesModal.some((r) => r.status === "a_pagar" || r.status === "a_repassar");
  /**
   * Total de lançamentos DETALHADOS da competência (todos os status) — é o que
   * a tabela mostra quando se clica no card "Global na empresa (2.8.1)", que
   * não filtra status nenhum. Vem do mesmo resumo dos outros cards para as
   * quatro contagens fecharem entre si (RF 20-ago).
   */
  const qtdDetalhadoMes =
    Number(resumo?.qtd_provisionado ?? 0) +
    Number(resumo?.qtd_a_pagar ?? 0) +
    Number(resumo?.qtd_realizado ?? 0);
  const [loading, setLoading] = useState(true);

  // ---- lookups ----
  const [socios, setSocios] = useState<SocioRow[]>([]);
  const [classifs, setClassifs] = useState<ClassificacaoPessoalRow[]>([]);
  const [contasSocio, setContasSocio] = useState<ContaBancariaSocioRow[]>([]);
  // Todas as contas ativas dos sócios — filtro "Conta Destino" (04-set).
  const [contasTodas, setContasTodas] = useState<ContaBancariaSocioRow[]>([]);
  /**
   * Contas oferecidas no filtro Conta Destino: com sócio(s) marcado(s), só as
   * contas deles; sem sócio, todas as contas ativas (regra do docx 04-set).
   */
  const contasFiltraveis = useMemo(
    () => (filterSocios.length ? contasTodas.filter((c) => filterSocios.includes(c.socio_id)) : contasTodas),
    [contasTodas, filterSocios],
  );
  const nomeSocio = useCallback((id: string) => {
    const s = socios.find((x) => x.id === id);
    return s?.apelido ?? s?.nome_completo ?? "";
  }, [socios]);

  // ---- seleção / ações em massa ----
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkVencimento, setBulkVencimento] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  // Status genérico + exclusão em lote (ajuste 27-jul — idem ao Financeiro).
  const [bulkStatusSel, setBulkStatusSel] = useState("");
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  // ---- exportação (ajuste 27-jul; 19-ago: tela de seleção de campos) ----
  const [exportandoPdf, setExportandoPdf] = useState(false);
  const [exportandoXlsx, setExportandoXlsx] = useState(false);
  const [camposExportOpen, setCamposExportOpen] = useState(false);
  // ---- modal Repasses consolidados (19-ago: saiu da tela fixa, virou card) ----
  const [repassesOpen, setRepassesOpen] = useState(false);

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
    Promise.all([listarSocios(), listarClassificacoesPessoais(), listarMesesDetalhado(), listarContasAtivasSocios()])
      .then(([s, c, m, ct]) => { setSocios(s); setClassifs(c); setMeses(m); setContasTodas(ct); })
      .catch((e: unknown) => toast.error("Erro carregando cadastros", (e as Error).message ?? String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Repasses de OUTRO mês no modal (04-set) — só quando o modal está aberto
  // num mês diferente do vigente; o vigente já vem com os cards.
  useEffect(() => {
    if (!repassesOpen || repassesMesSel === mesVigente) return;
    let cancelado = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- liga o spinner antes da consulta
    setRepassesOutroLoading(true);
    listarRepassesDoMes(repassesMesSel)
      .then((r) => { if (!cancelado) setRepassesOutroMes(r); })
      .catch((e: unknown) => { if (!cancelado) toast.error("Erro carregando repasses", (e as Error).message ?? String(e)); })
      .finally(() => { if (!cancelado) setRepassesOutroLoading(false); });
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repassesOpen, repassesMesSel, mesVigente, repassesTick]);

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
      // Cards = mês vigente, sempre (04-set). Consolidação/conferência = mês
      // em foco (a única competência marcada) — quando é o próprio vigente,
      // reaproveita as consultas dos cards em vez de repetir.
      const alvo = mesFoco ?? mesVigente;
      const [r, resV, globV, repsV, resA, globA] = await Promise.all([
        listarDetalhado({
          // A LISTAGEM segue a COMPETÊNCIA do header (ajuste 28-jul).
          mesReferencia: mesesSel,
          socioId: filterSocios,
          classificacao: filterClassifs,
          status: filterStatus,
          contaSocioId: filterContas,
          // A busca é aplicada no CLIENT (19-ago): a arte pede "Buscar
          // descrição, sócio, conta…", e sócio/classificação/conta são joins —
          // o ilike do servidor só alcançava descrição/observação.
          repasseDe: filterRepasseDe || undefined,
          repasseAte: filterRepasseAte || undefined,
          vencimentoDe: filterVencDe || undefined,
          vencimentoAte: filterVencAte || undefined,
          valorMin: filterValorMin ? Math.abs(Number(filterValorMin)) || undefined : undefined,
          valorMax: filterValorMax ? Math.abs(Number(filterValorMax)) || undefined : undefined,
        }),
        obterResumoMensal(mesVigente),
        obterGlobalEmpresaMes(mesVigente),
        listarRepassesDoMes(mesVigente),
        alvo === mesVigente ? Promise.resolve(null) : obterResumoMensal(alvo),
        alvo === mesVigente ? Promise.resolve(null) : obterGlobalEmpresaMes(alvo),
      ]);
      setRows(r);
      setResumo(resV);
      setGlobalMes(globV);
      setRepasses(repsV);
      setFoco({ mes: alvo, resumo: alvo === mesVigente ? resV : resA, global: alvo === mesVigente ? globV : globA });
    } catch (e: unknown) {
      toast.error("Erro carregando distribuição", (e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesesSel, mesFoco, mesVigente, filterSocios, filterClassifs, filterStatus, filterContas,
      filterRepasseDe, filterRepasseAte, filterVencDe, filterVencAte,
      filterValorMin, filterValorMax]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData(); setSelectedIds(new Set()); }, [fetchData]);

  // ---- derivados ----
  // Consolidáveis exibidos no modal: recorte da COMPETÊNCIA (a listagem pode
  // estar mostrando outros meses agora que o filtro é por período).
  const consolidaveis = useMemo(
    () => rows.filter((r) => r.status === "a_pagar" && !r.repasse_id && r.mes_referencia === mesFoco),
    [rows, mesFoco],
  );
  // Total consolidável do MÊS EM FOCO (independe dos filtros de sócio/
  // classificação da tela). Sem competência única marcada não há o que
  // consolidar — e o botão não deve exibir o valor do mês vigente por engano.
  const totalConsolidavel = mesFoco ? (foco.resumo?.a_pagar_sem_repasse ?? 0) : 0;
  const qtdConsolidavel = mesFoco ? (foco.resumo?.qtd_a_pagar_sem_repasse ?? 0) : 0;

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

  // Busca ampliada (19-ago, conforme a arte): além de descrição/observação,
  // alcança sócio, classificação e conta destino. Roda no client, sem acento e
  // sem caixa — o recorte já vem inteiro do servidor (filtros de competência,
  // períodos etc.), então buscar aqui não perde nenhuma linha.
  const rowsBuscados = useMemo(() => {
    const termo = normalizarBusca(search);
    if (!termo) return rows;
    return rows.filter((r) => {
      const campos = [
        r.descricao,
        r.observacao,
        r.socio?.apelido,
        r.socio?.nome_completo,
        r.classificacao_pessoal,
        r.classificacao?.nome,
        r.conta_bancaria_socio?.nome ?? r.conta_bancaria_socio_nome,
      ];
      return campos.some((c) => c && normalizarBusca(c).includes(termo));
    });
  }, [rows, search]);

  // Recorte "só tagueados" (ajuste 27-jul) — filtra a tabela no client.
  const rowsVisiveis = useMemo(
    () => (mostrarSoTagueados && tags.size > 0 ? rowsBuscados.filter((r) => tags.has(r.id)) : rowsBuscados),
    [rowsBuscados, mostrarSoTagueados, tags],
  );

  /**
   * Paginação (04-set-2026): o detalhado deixou de vir numa página só. O
   * recorte inteiro continua no client (rowsVisiveis — é ele que a exportação,
   * o total do rodapé e "selecionar todos do filtro" usam); a tabela mostra
   * PAGE_SIZE linhas por vez, com a numeração de páginas do Financeiro.
   */
  const totalPages = Math.max(1, Math.ceil(rowsVisiveis.length / PAGE_SIZE));
  const pageAtual = Math.min(page, totalPages);
  const rowsPagina = useMemo(
    () => rowsVisiveis.slice((pageAtual - 1) * PAGE_SIZE, pageAtual * PAGE_SIZE),
    [rowsVisiveis, pageAtual],
  );

  /**
   * 17-ago: "permitir SELECIONAR (individual e todos) e TAG DO DIA (individual
   * e todos), mesmo após consolidados e repassados".
   *
   * Selecionar deixou de excluir o que já foi consolidado — a seleção serve
   * para relatório, capa e exportação tanto quanto para ação em massa. O que
   * continua protegido é a ESCRITA: as ações em massa pulam os consolidados e
   * dizem quantos pularam (mudar valor ou status de um lançamento já repassado
   * não atualizaria o global, e a Distribuição sairia do lugar).
   */
  // O checkbox do cabeçalho seleciona a PÁGINA (como no Financeiro); "todos
  // os registros do filtro" é a segunda opção, pela setinha ao lado (04-set).
  const allPageSelected = rowsPagina.length > 0 && rowsPagina.every((r) => selectedIds.has(r.id));
  const allPageTagged = rowsPagina.length > 0 && rowsPagina.every((r) => tags.has(r.id));
  /** Selecionados que podem ser ALTERADOS (fora os já consolidados). */
  const selecionadosEditaveis = useMemo(
    () => rows.filter((r) => selectedIds.has(r.id) && !r.repasse_id),
    [rows, selectedIds],
  );
  const selecionadosBloqueados = selectedIds.size - selecionadosEditaveis.length;

  // Autossoma dos selecionados (ajuste 27-jul — idem ao Financeiro).
  const somaSelecionados = useMemo(() => {
    let s = 0;
    for (const r of rows) if (selectedIds.has(r.id)) s += Number(r.valor);
    return s;
  }, [rows, selectedIds]);

  /**
   * Por que "Consolidar repasse" está desligado — null = está liberado.
   *
   * São DUAS condições, e a tela só falava de uma. A confusão de 18-ago foi
   * essa: com uma competência escolhida, ela concluiu que o problema era a
   * competência, quando na verdade não havia nada marcado como "A repassar"
   * naquele mês (já estava tudo consolidado).
   */
  const motivoConsolidarBloqueado = useMemo<string | null>(() => {
    if (!mesFoco) {
      return "A consolidação gera um lançamento global de UMA competência — deixe só uma marcada no filtro Competência acima.";
    }
    if (qtdConsolidavel === 0) {
      return `Nenhum lançamento de ${mesHumano(mesFoco)} está aguardando repasse. ` +
        `A consolidação só pega o que está com status "A repassar" e ainda não foi consolidado — ` +
        `marque os lançamentos na coluna Status da tabela abaixo (ou selecione vários e use a ação em massa).`;
    }
    return null;
  }, [mesFoco, qtdConsolidavel]);

  // Conferência do provisionado global × detalhado — do MÊS EM FOCO (a
  // competência única marcada; sem ela, o mês vigente).
  const divergenciaProvisionado = useMemo(() => {
    if (!foco.resumo || !foco.global) return null;
    if (!foco.global.temProvisionadoManual) return null;
    const diff = Math.abs(foco.global.provisionadoGlobal - foco.resumo.provisionado);
    return diff > 0.005 ? diff : null;
  }, [foco]);

  // Religar a sincronização automática do Provisionado DL (migration 0052).
  // A etiqueta `dl_auto:` que amarra o SOMASE não é campo de formulário — sem
  // este botão, um mês que perdeu a etiqueta só voltava a sincronizar com
  // intervenção no banco.
  const [religando, setReligando] = useState(false);
  async function handleReligarSync() {
    // A religação é de UM mês (a etiqueta dl_auto: é por competência) — o mês
    // em foco, que é o mesmo da conferência que mostrou a divergência.
    setReligando(true);
    try {
      const r = await religarSyncDl(foco.mes);
      await fetchData();
      if (r.sincronizado) {
        toast.success(
          "Sincronização religada",
          `O provisionado global voltou a acompanhar o detalhado (${formatCurrency(r.global_depois)}).`,
        );
      } else {
        toast.warning(
          "Sincronização religada, mas os valores ainda diferem",
          `Global ${formatCurrency(r.global_depois)} × detalhado ${formatCurrency(r.soma_detalhado)}. Confira se há outra linha provisionada no centro 2.8.1 do Financeiro.`,
        );
      }
    } catch (e: unknown) {
      toast.error("Não foi possível religar a sincronização", (e as Error).message ?? String(e));
    } finally {
      setReligando(false);
    }
  }

  // ---- seleção ----
  /** Selecionar/desmarcar todos DESTA PÁGINA (a "1ª caixinha" de sempre). */
  const togglePageSelection = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (rowsPagina.every((r) => next.has(r.id))) rowsPagina.forEach((r) => next.delete(r.id));
      else rowsPagina.forEach((r) => next.add(r.id));
      return next;
    });
  };

  /**
   * Selecionar TODOS os registros do filtro (04-set) — todas as páginas de
   * uma vez. Na DL o recorte já está inteiro no client, então não há
   * consulta: é só marcar rowsVisiveis.
   */
  const selecionarTodosDoFiltro = () => {
    if (rowsVisiveis.length === 0) return;
    setSelectedIds(new Set(rowsVisiveis.map((r) => r.id)));
    toast.info(
      "Todos os registros do filtro selecionados",
      `${rowsVisiveis.length} lançamento${rowsVisiveis.length === 1 ? "" : "s"} de todas as páginas — as ações em massa e a exportação usam essa seleção.`,
    );
  };

  /** Taguear/destaguear tudo que está NA PÁGINA de uma vez (17-ago; página desde 04-set). */
  const toggleAllTags = () => {
    if (rowsPagina.length === 0) return;
    const todos = rowsPagina.every((r) => tags.has(r.id));
    setTags((prev) => {
      const next = new Map(prev);
      for (const r of rowsPagina) {
        if (todos) next.delete(r.id);
        else next.set(r.id, {
          id: r.id,
          socio: r.socio?.apelido ?? r.socio?.nome_completo ?? null,
          descricao: r.descricao ?? null,
          valor: Number(r.valor),
        });
      }
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
    // Consolidados podem ser SELECIONADOS (17-ago), mas não alterados: mudar
    // valor ou status de um lançamento já repassado não atualiza o global, e a
    // Distribuição sairia do lugar. Aqui eles ficam de fora, e a tela diz.
    const alvos = selecionadosEditaveis;
    if (alvos.length === 0) {
      toast.warning(
        "Nada a alterar",
        "Todos os selecionados já foram consolidados em repasse — desfaça o repasse para poder alterá-los.",
      );
      return;
    }
    // Snapshots antes da aplicação — base do "Desfazer" (RF 31-jul). Restaura
    // linha a linha porque a ação em massa pode mexer em status E vencimento.
    const anteriores = alvos;
    setBulkBusy(true);
    try {
      const n = await atualizarDetalhadoEmMassa(alvos.map((r) => r.id), payload);
      if (selecionadosBloqueados > 0) {
        toast.info(
          `${selecionadosBloqueados} consolidado${selecionadosBloqueados === 1 ? "" : "s"} não alterado${selecionadosBloqueados === 1 ? "" : "s"}`,
          "Lançamentos já consolidados em repasse ficam de fora das ações em massa. Desfaça o repasse para alterá-los.",
        );
      }
      toast.desfazer(rotulo, `${n} lançamento${n === 1 ? "" : "s"} atualizado${n === 1 ? "" : "s"}.`, async () => {
        for (const a of anteriores) await desfazerEdicao("transacoes_socio", a);
        await fetchData();
        toast.info("Alteração revertida", `${anteriores.length} lançamento${anteriores.length === 1 ? "" : "s"} voltou como estava.`);
      });
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
    // Consolidados entram na seleção (17-ago) mas não são excluídos aqui.
    const snapshots = selecionadosEditaveis;
    const n = snapshots.length;
    if (selectedIds.size === 0) return;
    if (n === 0) {
      toast.warning(
        "Nada a excluir",
        "Todos os selecionados já foram consolidados em repasse — desfaça o repasse antes de excluí-los.",
      );
      return;
    }
    const aviso = selecionadosBloqueados > 0
      ? `\n\n${selecionadosBloqueados} lançamento${selecionadosBloqueados === 1 ? "" : "s"} já consolidado${selecionadosBloqueados === 1 ? "" : "s"} não será excluído.`
      : "";
    if (!confirm(`Excluir ${n === 1 ? "o lançamento selecionado" : `os ${n} lançamentos selecionados`}? Você ainda terá 8 segundos para desfazer.${aviso}`)) return;
    setBulkDeleteBusy(true);
    try {
      const excluidos = await deletarDetalhadoEmMassa(snapshots.map((r) => r.id));
      if (excluidos < n) {
        toast.warning("Exclusão parcial", `${excluidos} de ${n} lançamentos excluídos — os demais podem estar vinculados a repasse ou protegidos.`);
      } else if (snapshots.length > 0) {
        toast.desfazer(
          "Lançamentos excluídos",
          `${excluidos} lançamento${excluidos === 1 ? "" : "s"} excluído${excluidos === 1 ? "" : "s"} de uma vez. Você tem 8 segundos para recuperá-los.`,
          async () => {
            await desfazerExclusao("transacoes_socio", snapshots);
            await fetchData();
            toast.info("Exclusão desfeita", `${snapshots.length} lançamento${snapshots.length === 1 ? "" : "s"} restaurado${snapshots.length === 1 ? "" : "s"}.`);
          },
        );
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
    f.push(`Competência: ${mesesSel.length ? mesesSel.join(", ") : "todas"}`);
    if (search) f.push(`Busca: "${search}"`);
    if (filterSocios.length) f.push(`Sócio: ${filterSocios.map((id) => nomeSocio(id) || id).join(", ")}`);
    if (filterClassifs.length) f.push(`Classificação: ${filterClassifs.join(", ")}`);
    if (filterStatus.length) f.push(`Status: ${filterStatus.map((s) => STATUS_DL_LABEL[s]).join(", ")}`);
    if (filterContas.length) {
      f.push(`Conta destino: ${filterContas.map((id) => contasTodas.find((c) => c.id === id)?.nome ?? id).join(", ")}`);
    }
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

  // Os botões Exportar abrem a tela de seleção de campos (19-ago — idem ao
  // Financeiro); o formato final é escolhido lá dentro.
  async function handleExport(formato: "pdf" | "xlsx", escolha: CamposExportDlEscolha) {
    // Seleção manual tem precedência sobre os filtros (idem ao Financeiro).
    const selecionadas = rows.filter((r) => selectedIds.has(r.id));
    const alvo = selecionadas.length > 0 ? selecionadas : rowsVisiveis;
    if (alvo.length === 0) {
      toast.info("Nada para exportar", "Nenhum lançamento no recorte atual.");
      return;
    }
    const meta = {
      escopo: selecionadas.length > 0
        ? `Seleção manual — ${selecionadas.length} lançamento${selecionadas.length === 1 ? "" : "s"}`
        : "Recorte pelos filtros da tela",
      filtros: selecionadas.length > 0 ? [] : montarFiltrosExport(),
      campos: escolha.campos,
      incluirFiltros: escolha.incluirFiltros,
      incluirTotais: escolha.incluirTotais,
      // RF 20-ago: rodapé com quem emitiu, a data e a hora.
      emitidoPor: linhaEmissao(await getNomeUsuarioAtual()),
    };
    const setBusy = formato === "pdf" ? setExportandoPdf : setExportandoXlsx;
    setBusy(true);
    try {
      if (formato === "pdf") await exportDistribuicaoPdf(alvo, meta);
      else exportDistribuicaoXlsx(alvo, meta);
      setCamposExportOpen(false);
      toast.success("Exportação concluída", `Arquivo ${formato.toUpperCase()} gerado (${alvo.length} linha${alvo.length === 1 ? "" : "s"}).`);
    } catch (e: unknown) {
      toast.error("Falha na exportação", (e as Error).message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Filtro dos CARDS (19-ago — "todos devem funcionar como botões, seguindo o
   * mesmo padrão utilizado no FINANCEIRO"): zera os demais filtros e aplica só
   * o recorte de status do card — a tabela passa a espelhar o número dele.
   * "" = todos os status (card Global na empresa: provisionado + a repassar +
   * repassado).
   */
  function aplicarFiltroCard(status: StatusDL | "") {
    limparTodosFiltros();
    // Os cards são do mês vigente (04-set): a tabela abre nessa competência
    // para o número do card bater com o que ela mostra (RF 20-ago).
    setMesesSel([mesVigente]);
    setFilterStatus(status ? [status] : []);
    setPage(1);
  }

  // ---- capa do repasse do sócio (PDFMonkey — ajuste 29-jul) ----
  // Responde "onde vou para gerar a capa do repasse do sócio?": direto daqui,
  // com opção de recortar pelos lançamentos TAGUEADOS do dia.
  function abrirCapa() {
    if (socios.length === 0) {
      toast.warning("Nenhum sócio cadastrado", "Cadastre os sócios para gerar a capa do repasse.");
      return;
    }
    setCapaSocioId((filterSocios.length === 1 ? filterSocios[0] : "") || socios[0]?.id || "");
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
        mes_referencia: mesFoco ?? mesCorrente(),
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
    const statusAnterior = row.status;
    try {
      await atualizarDetalhado(row.id, { status });
      toast.desfazer("Status atualizado", `${row.descricao}: ${STATUS_DL_LABEL[status]}.`, async () => {
        await desfazerStatusEmMassa("transacoes_socio", [{ id: row.id, status: statusAnterior }]);
        await fetchData();
        toast.info("Status revertido", `Voltou para ${STATUS_DL_LABEL[statusAnterior]}.`);
      });
      await fetchData();
    } catch (e: unknown) {
      toast.error("Não foi possível mudar o status", (e as Error).message ?? String(e));
    }
  }

  /**
   * Move a COMPETÊNCIA do lançamento para o mês indicado (RF 31-jul) — o atalho
   * do aviso na coluna Competência. Grava só `data`, que é a coluna de onde o
   * `mes_referencia` é derivado; datas de repasse/vencimento ficam como estão.
   */
  async function moverCompetencia(row: TransacaoSocioRich, destino: string) {
    if (row.repasse_id) {
      toast.warning("Lançamento vinculado a repasse", "Desfaça o repasse antes de mudar a competência.");
      return;
    }
    try {
      await atualizarDetalhado(row.id, { data: `${destino}-01` });
      toast.success(
        `Competência movida para ${mesHumano(destino)}`,
        `"${row.descricao}" sai do recorte de ${mesHumano(row.mes_referencia)}.`,
      );
      await fetchData();
    } catch (e: unknown) {
      toast.error("Não foi possível mover a competência", (e as Error).message ?? String(e));
    }
  }

  // ---- CRUD ----
  function openNew() {
    setEditRow(null);
    setForm({
      socio_id: filterSocios.length === 1 ? filterSocios[0] : "",
      classificacao_pessoal: filterClassifs.length === 1 ? filterClassifs[0] : "",
      descricao: "",
      conta_bancaria_socio_id: "",
      competencia: mesFoco ?? mesCorrente(),
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
        const anterior = editRow;
        await atualizarDetalhado(editRow.id, payload);
        toast.desfazer("Lançamento atualizado", "Você tem 8 segundos para voltar ao valor anterior.", async () => {
          await desfazerEdicao("transacoes_socio", anterior);
          await fetchData();
          toast.info("Edição desfeita", "O lançamento voltou como estava.");
        });
      } else {
        const criado = await criarDetalhado(payload);
        toast.desfazer("Lançamento detalhado criado", "Você tem 8 segundos para desfazer.", async () => {
          await desfazerCriacao("transacoes_socio", [criado.id]);
          await fetchData();
          toast.info("Criação desfeita", "O lançamento foi removido.");
        });
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
      toast.desfazer("Lançamento excluído", "Você tem 8 segundos para recuperá-lo.", async () => {
        await desfazerExclusao("transacoes_socio", [row]);
        await fetchData();
        toast.info("Exclusão desfeita", "O lançamento foi restaurado.");
      });
      await fetchData();
    } catch (e: unknown) {
      toast.error("Não foi possível excluir", (e as Error).message ?? String(e));
    }
  }

  // ---- consolidar / desfazer / concluir ----
  async function handleConsolidar() {
    setConsolidando(true);
    try {
      if (!mesFoco) return;
      await consolidarRepasse(mesFoco, consolidarData, incluirTransferencia);
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
      setRepassesTick((t) => t + 1);
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
      setRepassesTick((t) => t + 1);
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
          {/* Competência multi-seleção com "Todas" (17-ago) — idem ao Financeiro */}
          <label className="flex items-center gap-1.5 text-xs text-stone-500"
            title="Competência da tabela detalhada e da consolidação. Nenhuma marcada = todas as competências (padrão ao abrir, idem ao Financeiro). Os cards-botão mostram sempre o mês vigente, independentemente do que estiver marcado aqui. A consolidação exige UMA competência só.">
            Competência
            <CompetenciaMultiSelect
              className="w-40"
              options={meses}
              value={mesesSel}
              onChange={(v) => { setMesesSel(v); setPage(1); }}
            />
          </label>
          {/* RF 20-ago: um único botão "Exportar". Os campos e o formato
              (PDF ou XLSX) são escolhidos dentro do CamposExportDlModal. */}
          <Button variant="outline" size="sm" onClick={() => setCamposExportOpen(true)}
            loading={exportandoPdf || exportandoXlsx} disabled={exportandoPdf || exportandoXlsx}
            title="Escolhe os campos e o formato (PDF ou XLSX) dos lançamentos selecionados ou filtrados">
            <FileDown size={14} /> {selectedIds.size > 0 ? `Exportar (${selectedIds.size})` : "Exportar"}
          </Button>
          <Button variant="outline" size="sm" onClick={abrirCapa}
            title="Gera a capa do repasse do sócio (PDFMonkey) — com opção de usar só os lançamentos tagueados">
            <FileText size={14} /> Capa do sócio
          </Button>
          {/* O <span> em volta existe porque o Button usa
              `disabled:pointer-events-none`: com o botão desligado, o title
              dele NUNCA aparece — e era o único lugar que dizia por que ele
              estava desligado. O span não é disabled, então o tooltip volta a
              funcionar (apontamento de 18-ago: "deixei somente 2026-08 e não
              habilitou o botão consolidar"). */}
          <span title={motivoConsolidarBloqueado ?? "Cria o lançamento global no Financeiro a partir do detalhado marcado como A repassar"}>
            <Button
              size="sm"
              onClick={() => setConsolidarOpen(true)}
              disabled={!!motivoConsolidarBloqueado}
            >
              <ArrowRightLeft size={14} />
              Consolidar repasse{totalConsolidavel > 0 ? ` (${formatCurrency(totalConsolidavel)})` : ""}
            </Button>
          </span>
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

      {/* Por que o botão está desligado — dito na tela, não só no tooltip
          (que nem aparece em botão desabilitado). Ajuste 18-ago. */}
      {motivoConsolidarBloqueado && (
        <div className="-mt-3 flex items-start gap-2 text-xs text-stone-500">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500" />
          <span><b className="text-stone-700">Consolidar repasse está desligado:</b> {motivoConsolidarBloqueado}</span>
        </div>
      )}

      {/* KPIs do mês (19-ago) — ordem, cores e escrita da arte nova, todos
          funcionando como BOTÕES no padrão do Financeiro: os quatro primeiros
          filtram a tabela pelo status do card; o quinto abre os Repasses
          consolidados do mês (idem card Despesa Variável do Financeiro).
          04-set-2026: os cards mostram SEMPRE o mês vigente (não seguem mais o
          filtro Competência) e os rótulos dizem o mês de referência — como os
          cards "até 30/09" do Financeiro. "Global na empresa (2.8.1)" ficou
          exatamente como estava (nome e filtro). */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        {([
          {
            key: "glob",
            label: "Global na empresa (2.8.1)",
            // RF 20-ago: a contagem tem que ser a do DETALHADO — é ele que o
            // clique do card mostra na tabela (e os outros cards já contam
            // assim). Antes vinham as poucas linhas GLOBAIS do 2.8.1 no
            // Financeiro (provisionado + repasses consolidados), então o card
            // dizia "5 lançamentos" e a tabela abria com 48.
            qtd: qtdDetalhadoMes,
            unidade: "lançamento",
            valor: globalMes?.totalCentro281 ?? 0,
            icon: <Landmark size={15} />,
            iconClass: "bg-blue-50 text-blue-600",
            labelClass: "text-blue-700",
            valorClass: "text-blue-700",
            help: `Soma dos lançamentos do centro de custo 2.8.1 (Distribuição de Lucros) no Financeiro da empresa na competência ${mesHumano(mesVigente)} — provisionado + a repassar + repassado, independentemente do filtro Competência. Deve bater com o detalhado; a contagem é a dos lançamentos detalhados do mês. Clique para ver a tabela com todos os status.`,
            filtro: "" as StatusDL | "",
          },
          {
            key: "arep",
            label: `A repassar até ${ateDia}`,
            qtd: resumo?.qtd_a_pagar ?? 0,
            unidade: "repasse",
            valor: resumo?.a_pagar ?? 0,
            icon: <CalendarCheck size={15} />,
            iconClass: "bg-red-50 text-red-600",
            labelClass: "text-red-700",
            valorClass: "text-red-600",
            help: `Soma do detalhado da competência ${mesHumano(mesVigente)} marcado como A repassar (independentemente do filtro Competência). A parte ainda não consolidada aparece no botão Consolidar. Clique para filtrar a tabela.`,
            filtro: "a_pagar" as StatusDL | "",
          },
          {
            key: "prov",
            label: `Provisionado até ${ateDia}`,
            qtd: resumo?.qtd_provisionado ?? 0,
            unidade: "repasse",
            valor: resumo?.provisionado ?? 0,
            icon: <CalendarDays size={15} />,
            iconClass: "bg-amber-50 text-amber-600",
            labelClass: "text-amber-700",
            valorClass: "text-amber-600",
            help: `Soma do detalhado da competência ${mesHumano(mesVigente)} com status Provisionado (independentemente do filtro Competência). É o que ainda falta conferir/marcar. Clique para filtrar a tabela.`,
            filtro: "provisionado" as StatusDL | "",
          },
          {
            key: "rep",
            label: `Repasse realizado individual – ${mesHumano(mesVigente)}`,
            qtd: resumo?.qtd_realizado ?? 0,
            unidade: "lançamento",
            valor: resumo?.realizado ?? 0,
            icon: <Users size={15} />,
            iconClass: "bg-emerald-50 text-emerald-600",
            labelClass: "text-emerald-700",
            valorClass: "text-emerald-700",
            help: `Detalhado da competência ${mesHumano(mesVigente)} já baixado (repassado às contas pessoais dos sócios), independentemente do filtro Competência. Clique para filtrar a tabela.`,
            filtro: "realizado" as StatusDL | "",
          },
        ]).map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => aplicarFiltroCard(c.filtro)}
            title={c.help}
            className="rounded-xl border border-stone-200 bg-white shadow-sm px-3.5 py-2.5 flex items-center gap-3 text-left transition-colors hover:border-stone-300 hover:bg-stone-50 cursor-pointer"
          >
            <span className={`h-8 w-8 shrink-0 rounded-full flex items-center justify-center ${c.iconClass}`}>
              {c.icon}
            </span>
            <span className="leading-tight min-w-0">
              <p className={`text-[10px] font-semibold uppercase tracking-wide truncate ${c.labelClass}`}>
                {c.label}
              </p>
              <p className="text-sm font-bold tabular-nums whitespace-nowrap text-stone-800">
                {c.qtd}{" "}
                <span className="font-normal text-stone-400">
                  {c.unidade}{c.qtd === 1 ? "" : "s"} ·
                </span>{" "}
                <span className={c.valorClass}>{formatCurrency(c.valor)}</span>
              </p>
            </span>
          </button>
        ))}

        {/* Repasse realizado consolidado (19-ago) — 5º card; clique abre a
            visualização detalhada que antes ficava fixada na tela. */}
        <button
          type="button"
          onClick={() => { setRepassesMesSel(mesVigente); setRepassesOpen(true); }}
          title={`Repasses globais consolidados da competência ${mesHumano(mesVigente)} (lançados no Financeiro pela consolidação), independentemente do filtro Competência. Clique para ver o detalhe — com Dar baixa e Desfazer; dentro do modal dá para trocar o mês.`}
          className="rounded-xl border border-stone-200 bg-white shadow-sm px-3.5 py-2.5 flex items-center gap-3 text-left transition-colors hover:border-stone-300 hover:bg-stone-50 cursor-pointer"
        >
          <span className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center bg-teal-50 text-teal-600">
            <FileText size={15} />
          </span>
          <span className="leading-tight min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide truncate text-teal-700">
              Repasse realizado consolidado – {mesHumano(mesVigente)}
            </p>
            <p className="text-sm font-bold tabular-nums whitespace-nowrap text-stone-800">
              {repasses.length}{" "}
              <span className="font-normal text-stone-400">
                lançamento{repasses.length === 1 ? "" : "s"} ·
              </span>{" "}
              <span className="text-teal-700">
                {formatCurrency(repasses.reduce((s, rep) => s + -Number(rep.valor), 0))}
              </span>
            </p>
          </span>
        </button>
      </div>

      {/* Divergência entre global manual e detalhado */}
      {divergenciaProvisionado !== null && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 flex items-start gap-3">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div className="space-y-2">
            <span className="block">
              Competência <b>{mesHumano(foco.mes)}</b>: o provisionado global no Financeiro ({formatCurrency(foco.global?.provisionadoGlobal ?? 0)}) difere
              da soma do detalhado ({formatCurrency(foco.resumo?.provisionado ?? 0)}) em {formatCurrency(divergenciaProvisionado)}.
              A linha global deste mês está fora do controle automático, então ela não acompanha mais as mudanças do
              detalhado — nem quando você consolida um repasse. Clique em <b>Religar sincronização</b> para o sistema
              voltar a mantê-la; se preferir, ajuste ou exclua a linha no{" "}
              <Link href="/dashboard/financeiro" className="underline font-medium">Financeiro</Link>.
            </span>
            <Button size="sm" variant="outline" onClick={handleReligarSync}
              loading={religando} disabled={religando}
              title={`Passa a linha provisionada do centro 2.8.1 de ${mesHumano(foco.mes)} para o controle automático e recalcula o global pela soma do detalhado`}>
              <RefreshCw size={13} /> Religar sincronização ({mesHumano(foco.mes)})
            </Button>
          </div>
        </div>
      )}

      {/* Repasses consolidados do mês (19-ago) — saiu da tela fixa; agora abre
          pelo card "Repasse realizado consolidado (mês)", com as mesmas
          informações e ações de antes (idem Despesa Variável no Financeiro). */}
      <Modal open={repassesOpen} onClose={() => setRepassesOpen(false)}
        title="Repasses consolidados do mês" size="xl">
        <div className="px-6 pt-4 flex items-center gap-3">
          <span className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center bg-teal-50 text-teal-600">
            <HandCoins size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-stone-800 flex items-center gap-2 flex-wrap">
              Competência
              {/* O card é do mês vigente; aqui dá para ver outro mês (04-set). */}
              <select
                value={repassesMesSel}
                onChange={(e) => setRepassesMesSel(e.target.value)}
                className="h-7 rounded-lg border border-stone-200 px-2 text-xs font-medium bg-white"
                title="Mês dos repasses consolidados exibidos abaixo"
                aria-label="Competência dos repasses consolidados"
              >
                {(meses.includes(repassesMesSel) ? meses : [...meses, repassesMesSel]).slice().reverse().map((m) => (
                  <option key={m} value={m}>{mesHumano(m)}</option>
                ))}
              </select>
              {repassesOutroLoading && <Loader2 size={13} className="animate-spin text-stone-400" />}
            </p>
            <p className="text-xs text-stone-500">
              Lançamentos globais criados no Financeiro pela consolidação do detalhado ({"“Consolidar repasse”"}).
            </p>
          </div>
        </div>
        <div className="p-4">
          {repassesModal.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-stone-400">
              {repassesOutroLoading
                ? "Carregando…"
                : <>Nenhum repasse consolidado em {mesHumano(repassesMesSel)}. Marque o detalhado como {"“A repassar”"} e use
                  {" “Consolidar repasse”"} para criar o global no Financeiro.</>}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-100">
                    {["Data", "Descrição", "Detalhados", "Valor", "Status", ...(temAcoesRepasse ? ["Ações"] : [])].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-stone-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {repassesModal.map((rep) => (
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
                      {temAcoesRepasse && (
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
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-stone-100 border-t-2 border-stone-200 font-semibold text-stone-700 text-xs">
                    <td colSpan={3} className="px-4 py-2.5 uppercase tracking-wide">Total</td>
                    <td className="px-4 py-2.5 text-red-600 whitespace-nowrap">
                      {formatCurrency(repassesModal.reduce((s, rep) => s + Number(rep.valor), 0))}
                    </td>
                    <td colSpan={temAcoesRepasse ? 2 : 1}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </Modal>

      {/* Tabela detalhada */}
      <Card>
        <CardHeader className="flex-col items-start gap-3 lg:flex-row lg:items-center lg:gap-2">
          <CardTitle>Detalhado por sócio</CardTitle>
          <div className="flex items-center gap-2 flex-wrap ml-auto">
            <div className="relative" title="Busca por descrição, observação, sócio, classificação ou conta destino (sem diferenciar acento)">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Buscar descrição, sócio, conta…"
                className="h-8 rounded-lg border border-stone-200 pl-8 pr-3 text-xs w-56 focus:outline-none focus:ring-1 focus:ring-accent-400"
              />
            </div>
            {/* Sócios / Classificações / Status com caixa de seleção múltipla
                (04-set — "idem ao financeiro"). */}
            <MultiSelect
              className="w-40"
              value={filterSocios}
              onChange={(v) => {
                setFilterSocios(v);
                // Dependência Sócio ↔ Conta Destino (04-set): descarta contas
                // que não pertencem mais aos sócios selecionados.
                if (v.length) {
                  const validas = new Set(contasTodas.filter((c) => v.includes(c.socio_id)).map((c) => c.id));
                  setFilterContas((prev) => prev.filter((id) => validas.has(id)));
                }
                setPage(1);
              }}
              options={socios.map((s) => ({ value: s.id, label: s.apelido ?? s.nome_completo }))}
              placeholder="Todos os sócios"
              searchPlaceholder="Buscar sócio…"
              emptyText="Nenhum sócio"
              unitLabel="sócios"
            />
            <MultiSelect
              className="w-48"
              value={filterClassifs}
              onChange={(v) => { setFilterClassifs(v); setPage(1); }}
              options={classifs.map((c) => ({ value: c.codigo, label: `${c.codigo} – ${c.nome}` }))}
              placeholder="Todas as classificações"
              searchPlaceholder="Buscar classificação…"
              emptyText="Nenhuma classificação"
              unitLabel="classificações"
            />
            <MultiSelect
              className="w-36"
              value={filterStatus}
              onChange={(v) => { setFilterStatus(v as StatusDL[]); setPage(1); }}
              options={(Object.keys(STATUS_DL_LABEL) as StatusDL[]).map((s) => ({ value: s, label: STATUS_DL_LABEL[s] }))}
              placeholder="Todos os status"
              searchPlaceholder="Buscar status…"
              unitLabel="status"
            />
            {/* Conta Destino (04-set): com sócio marcado, só as contas dele;
                sem sócio, todas as contas ativas. */}
            <MultiSelect
              className="w-44"
              value={filterContas}
              onChange={(v) => { setFilterContas(v); setPage(1); }}
              options={contasFiltraveis.map((c) => ({
                value: c.id,
                label: filterSocios.length === 1 ? c.nome : `${c.nome} · ${nomeSocio(c.socio_id)}`,
              }))}
              placeholder="Todas as contas"
              searchPlaceholder="Buscar conta destino…"
              emptyText="Nenhuma conta ativa"
              unitLabel="contas"
            />
            {/* Período pela DATA DO REPASSE (RF 23-jul — substitui a pesquisa por mês) */}
            <div className="flex items-center gap-1" title="Período pela Data do Repasse.">
              <span className="text-[10px] uppercase text-stone-400 font-medium">Repasse</span>
              <input type="date" value={filterRepasseDe} max={filterRepasseAte || undefined}
                aria-label="Data do repasse de"
                onChange={(e) => { setFilterRepasseDe(e.target.value); setPage(1); }}
                className="h-8 rounded-lg border border-stone-200 px-2 text-xs" />
              <span className="text-stone-400 text-xs">até</span>
              <input type="date" value={filterRepasseAte} min={filterRepasseDe || undefined}
                aria-label="Data do repasse até"
                onChange={(e) => { setFilterRepasseAte(e.target.value); setPage(1); }}
                className="h-8 rounded-lg border border-stone-200 px-2 text-xs" />
              {(filterRepasseDe || filterRepasseAte) && (
                <button type="button" onClick={() => { setFilterRepasseDe(""); setFilterRepasseAte(""); setPage(1); }}
                  className="text-stone-400 hover:text-stone-600 px-1 text-sm leading-none"
                  title="Limpar período de repasse" aria-label="Limpar período de repasse">×</button>
              )}
            </div>
            {/* Período pelo VENCIMENTO da despesa (RF 23-jul) */}
            <div className="flex items-center gap-1" title="Período pelo Vencimento da despesa/fatura.">
              <span className="text-[10px] uppercase text-stone-400 font-medium">Venc.</span>
              <input type="date" value={filterVencDe} max={filterVencAte || undefined}
                aria-label="Vencimento de"
                onChange={(e) => { setFilterVencDe(e.target.value); setPage(1); }}
                className="h-8 rounded-lg border border-stone-200 px-2 text-xs" />
              <span className="text-stone-400 text-xs">até</span>
              <input type="date" value={filterVencAte} min={filterVencDe || undefined}
                aria-label="Vencimento até"
                onChange={(e) => { setFilterVencAte(e.target.value); setPage(1); }}
                className="h-8 rounded-lg border border-stone-200 px-2 text-xs" />
              {(filterVencDe || filterVencAte) && (
                <button type="button" onClick={() => { setFilterVencDe(""); setFilterVencAte(""); setPage(1); }}
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
                <button type="button" onClick={() => { setFilterValorMin(""); setFilterValorMax(""); setPage(1); }}
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
                  onClick={() => { setMostrarSoTagueados(false); setPage(1); }}
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
                title="Remove todos os filtros da listagem de uma vez (busca, sócios, classificações, status, conta destino, períodos e valor)"
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
            {/* "Selecionar todos os registros do filtro" (04-set) — também
                pelo menu da setinha no cabeçalho da tabela. */}
            {rowsVisiveis.length > selectedIds.size && (
              <Button size="sm" variant="ghost" onClick={selecionarTodosDoFiltro}
                disabled={bulkBusy || bulkDeleteBusy}
                title="Seleciona de uma vez TODOS os lançamentos que o filtro devolve, em todas as páginas">
                Selecionar todos os {rowsVisiveis.length} do filtro
              </Button>
            )}
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
                  {/* Checkbox = todos desta página (como sempre); a setinha
                      abre "todos os registros do filtro" (04-set-2026). */}
                  <th className="px-3 py-3 w-14">
                    <SelectAllHeader
                      paginaSelecionada={allPageSelected}
                      onTogglePagina={togglePageSelection}
                      qtdPagina={rowsPagina.length}
                      qtdFiltro={rowsVisiveis.length}
                      qtdSelecionados={selectedIds.size}
                      onSelecionarFiltro={selecionarTodosDoFiltro}
                      onLimpar={() => setSelectedIds(new Set())}
                      disabled={loading}
                    />
                  </th>
                  {/* Taguear TODOS os lançamentos da página de uma vez (17-ago) */}
                  <th className="px-1 py-3 w-8">
                    <button
                      type="button"
                      onClick={toggleAllTags}
                      disabled={rowsPagina.length === 0}
                      className={`p-1 rounded transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed mx-auto block ${
                        allPageTagged ? "text-amber-500 hover:text-amber-600" : "text-amber-300 hover:text-amber-500"
                      }`}
                      title={allPageTagged
                        ? "Remover a tag de todos os lançamentos desta página"
                        : "Taguear todos os lançamentos desta página de uma vez (o 'pintar de amarelo' da planilha)"}
                      aria-label={allPageTagged ? "Remover tag de todos" : "Taguear todos"}
                    >
                      <Tag size={13} fill={allPageTagged ? "currentColor" : "none"} />
                    </button>
                  </th>
                  {["Data do Repasse","Competência","Sócio","Classificação","Descrição","Conta destino","Vencimento","Valor","Status","Repasse","Ações"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={13} className="px-4 py-12 text-center text-stone-400">
                    <Loader2 size={18} className="inline-block animate-spin mr-2" /> Carregando…
                  </td></tr>
                )}
                {!loading && rowsVisiveis.length === 0 && (
                  <tr><td colSpan={13} className="px-4 py-12 text-center text-stone-400">
                    Nenhum lançamento detalhado no recorte. Clique em {"“Novo lançamento detalhado”"} para começar
                    — ou lance pelo Financeiro escolhendo {"“Saída detalhada”"} na conta 2.8.
                  </td></tr>
                )}
                {!loading && rowsPagina.map((r) => {
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
                          onChange={() => toggleOne(r.id)}
                          title={vinculado
                            ? "Já consolidado — pode entrar em relatórios, capa e exportação; as ações em massa não o alteram."
                            : "Selecionar lançamento"}
                          className="h-3.5 w-3.5 rounded border-stone-300 accent-accent-500 cursor-pointer"
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
                      {/* Competência — visível na linha (RF 31-jul): é ela que manda no
                          recorte do mês, não as datas de repasse/vencimento. */}
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        {(() => {
                          const sugerida = competenciaSugerida(r);
                          if (!sugerida) {
                            return <span className="text-stone-500 tabular-nums">{mesHumano(r.mes_referencia)}</span>;
                          }
                          return (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="text-stone-700 tabular-nums font-medium">{mesHumano(r.mes_referencia)}</span>
                              <button
                                type="button"
                                onClick={() => moverCompetencia(r, sugerida)}
                                disabled={vinculado}
                                title={
                                  `Este lançamento está na competência ${mesHumano(r.mes_referencia)}, mas as datas ` +
                                  `são de ${mesHumano(sugerida)} — por isso ele continua aparecendo no recorte de ` +
                                  `${mesHumano(r.mes_referencia)}. ` +
                                  (vinculado
                                    ? "Já consolidado em repasse: desfaça o repasse para mover."
                                    : `Clique para mover a competência para ${mesHumano(sugerida)}.`)
                                }
                                className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-semibold text-amber-700 bg-amber-100 hover:bg-amber-200 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <AlertTriangle size={10} />
                                → {mesHumano(sugerida)}
                              </button>
                            </span>
                          );
                        })()}
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
                    <td colSpan={9} className="px-4 py-2.5 uppercase tracking-wide">
                      Total do recorte ({rowsVisiveis.length} lançamento{rowsVisiveis.length === 1 ? "" : "s"}{totalPages > 1 ? ", todas as páginas" : ""})
                    </td>
                    <td className="px-4 py-2.5">{formatCurrency(rowsVisiveis.reduce((s, r) => s + Number(r.valor), 0))}</td>
                    <td colSpan={3}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {/* Rodapé com a numeração de páginas — mesmo padrão do Financeiro (04-set). */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-stone-100 gap-3 flex-wrap">
            <div className="flex items-center gap-3 text-xs text-stone-400">
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
            <Pagination page={pageAtual} totalPages={totalPages} onPageChange={setPage} />
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
            Serão consolidados <b>{qtdConsolidavel}</b> lançamento{qtdConsolidavel === 1 ? "" : "s"} detalhado{qtdConsolidavel === 1 ? "" : "s"} de <b>{mesFoco}</b> com
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
            Gera a capa em PDF (template do PDFMonkey) do repasse de <b>{mesFoco ?? mesCorrente()}</b> para o sócio escolhido —
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

      {/* Tela de seleção de campos da exportação (19-ago — idem ao Financeiro) */}
      <CamposExportDlModal
        open={camposExportOpen}
        onClose={() => setCamposExportOpen(false)}
        totalLinhas={selectedIds.size > 0 ? selectedIds.size : rowsVisiveis.length}
        escopo={selectedIds.size > 0 ? "Seleção manual" : "Recorte pelos filtros da tela"}
        exportando={exportandoPdf ? "pdf" : exportandoXlsx ? "xlsx" : null}
        onExportar={handleExport}
      />

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
                  onClick={() => { setMostrarSoTagueados((v) => !v); setPage(1); }}
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
