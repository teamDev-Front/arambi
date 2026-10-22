"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Pagination } from "@/components/ui/Pagination";
import { Tooltip } from "@/components/ui/Tooltip";
import { useToast } from "@/components/ui/Toast";
import { UnsavedChangesDialog } from "@/components/ui/UnsavedChangesDialog";
import { useUnsavedGuard } from "@/lib/hooks/useUnsavedGuard";
import { useModulo } from "@/components/acessos/PermissoesProvider";
import {
  Plus, Search, Edit2, Trash2, Loader2, Save,
  Warehouse, Sprout, Calculator, Calendar, PackageCheck,
  Coins, TrendingDown, ArrowDownToLine, HelpCircle,
  Copy, FileSpreadsheet, FileDown, ClipboardList, Gauge, Handshake, Info, Scale, Eye,
  PackageMinus, Boxes,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer,
} from "recharts";
import {
  listarArmazens, listarParametros, obterParametro, upsertParametro,
  listarDepositosCalculados, criarDeposito, atualizarDeposito, deletarDeposito, obterDeposito,
  calcularResumoSafra, sacasDoDeposito, listarSafrasComDeposito, zerarSaldoQuebra, desfazerBaixas,
} from "@/lib/queries/safra";
import { desfazerCriacao, desfazerEdicao, desfazerExclusao } from "@/lib/queries/desfazer";
import { exportEstoquePdf, exportEstoqueXlsx, type EstoqueExportMeta } from "@/lib/export/estoque-export";
import { getNomeUsuarioAtual, linhaEmissao } from "@/lib/auth/usuario-atual";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import {
  CULTURA_LABEL, CULTURA_EMOJI, SAFRA_DEP_STATUS_LABEL,
  type ArmazemRow, type SafraParametrosRow, type SafraDepositoCalculadoRow,
  type CulturaSafra, type SafraDepositoStatus, type Database, type SafraDepositoRow,
} from "@/types";

const PAGE_SIZE = 16;

type DepForm = {
  cultura: CulturaSafra;
  safra: string;
  data_deposito: string;
  dfe_entrada: string;
  nfp: string;
  kg_bruto: string;
  status: SafraDepositoStatus;
  observacao: string;
};
const EMPTY_DEP: DepForm = {
  cultura: "milho",
  safra: "",
  data_deposito: new Date().toISOString().slice(0, 10),
  dfe_entrada: "",
  nfp: "",
  kg_bruto: "",
  status: "armazenado",
  observacao: "",
};

type ParamForm = {
  quebra_quinzena_pct: string;
  armazenagem_por_kg_quinzena: string;
  devolucao_por_saca: string;
  carencia_dias: string;             // carência p/ venda a TERCEIROS
  carencia_armazem_dias: string;     // carência p/ venda ao PRÓPRIO ARMAZÉM (normativa anual)
  carencia_armazem_ate: string;      // data-limite da normativa — vazia = usa os dias acima
  taxa_recepcao_por_saca: string;    // R$/saca — só terceiros; 0 = isenta
  kg_por_saca: string;
  data_atual: string;
  cotacao_simulada_sc: string;
  deposito_total_programado_kg: string; // Depósito Total Programado (ajuste 27-jul)
};

function statusBadge(s: SafraDepositoStatus): BadgeVariant {
  switch (s) {
    case "armazenado":      return "info";
    case "vendido_total":   return "success";
    case "vendido_parcial": return "warning";
    case "retirado":        return "neutral";
    case "baixa":           return "danger";
  }
}

// Sacas são a unidade principal da tela (reunião de 20-out): toda exibição de
// quantidade sai em sc, com 2 casas. Os kg ficam só nos campos de entrada (a
// nota fiscal vem em kg), com a prévia "= X sc" ao lado.
const fmtScNum = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtSc = (n: number) => `${fmtScNum(n)} sc`;

export function EstoquePage() {
  const toast = useToast();
  // Modo leitura (Acessos): parâmetros e depósitos só para consulta; exportar continua.
  const { podeEditar } = useModulo("estoque");

  const [armazens, setArmazens] = useState<ArmazemRow[]>([]);
  const [armazemId, setArmazemId] = useState<string>("");
  const [parametros, setParametros] = useState<SafraParametrosRow[]>([]);

  const [cultura, setCultura] = useState<CulturaSafra>("milho");
  const [safra, setSafra] = useState<string>("");

  const [, setParam] = useState<SafraParametrosRow | null>(null);
  const [paramForm, setParamForm] = useState<ParamForm | null>(null);
  const [paramSaving, setParamSaving] = useState(false);

  const [rows, setRows] = useState<SafraDepositoCalculadoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<SafraDepositoStatus | "">("");
  const [page, setPage] = useState(1);
  const [exportando, setExportando] = useState<"pdf" | "xlsx" | null>(null);

  const [depModal, setDepModal] = useState(false);
  const [depEditId, setDepEditId] = useState<string | null>(null);
  // Linha da TABELA BASE ao abrir a edição — base do "Desfazer" (RF 31-jul).
  // A listagem vem da view calculada, que não serve para regravar.
  const [depSnapshot, setDepSnapshot] = useState<SafraDepositoRow | null>(null);
  const [depForm, setDepForm] = useState<DepForm>(EMPTY_DEP);
  const depGuard = useUnsavedGuard(depModal, depForm, () => setDepModal(false));
  const [depSaving, setDepSaving] = useState(false);

  // Ajuste de saldo por quebra técnica (10-ago) — zera o resíduo que sobra
  // quando a venda foi lançada pelo peso LÍQUIDO fixado pelo armazém e as notas
  // guardam o peso BRUTO depositado.
  const [ajusteModal, setAjusteModal] = useState(false);
  const [ajusteForm, setAjusteForm] = useState({ data: "", observacao: "" });
  const ajusteGuard = useUnsavedGuard(ajusteModal, ajusteForm, () => setAjusteModal(false));
  const [ajusteSaving, setAjusteSaving] = useState(false);

  // ---- Initial load: armazens & parametros ----
  useEffect(() => {
    (async () => {
      try {
        const arms = await listarArmazens();
        setArmazens(arms);
        if (arms.length > 0 && !armazemId) setArmazemId(arms[0].id);
      } catch (e: unknown) {
        toast.error("Erro carregando armazéns", (e as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!armazemId) return;
    (async () => {
      try {
        const params = await listarParametros(armazemId);
        setParametros(params);
        // Default cultura/safra escolhe o primeiro parâmetro
        if (params.length > 0 && !safra) {
          setCultura(params[0].cultura);
          setSafra(params[0].safra);
        }
      } catch (e: unknown) {
        toast.error("Erro carregando parâmetros", (e as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armazemId]);

  // ---- carregar param atual quando cultura/safra mudam ----
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset síncrono intencional ao trocar seleção
    if (!armazemId || !cultura || !safra) { setParam(null); setParamForm(null); return; }
    obterParametro(armazemId, cultura, safra)
      .then((p) => {
        setParam(p);
        setParamForm(p ? {
          quebra_quinzena_pct: String(p.quebra_quinzena_pct),
          armazenagem_por_kg_quinzena: String(p.armazenagem_por_kg_quinzena),
          devolucao_por_saca: String(p.devolucao_por_saca),
          carencia_dias: String(p.carencia_dias),
          carencia_armazem_dias: String(p.carencia_armazem_dias ?? 365),
          carencia_armazem_ate: p.carencia_armazem_ate ?? "",
          taxa_recepcao_por_saca: String(p.taxa_recepcao_por_saca ?? 0),
          kg_por_saca: String(p.kg_por_saca),
          data_atual: p.data_atual,
          cotacao_simulada_sc: p.cotacao_simulada_sc !== null ? String(p.cotacao_simulada_sc) : "",
          deposito_total_programado_kg: String(p.deposito_total_programado_kg ?? 0),
        } : {
          quebra_quinzena_pct: "0.0015",
          armazenagem_por_kg_quinzena: "0.20",
          devolucao_por_saca: "4.75",
          carencia_dias: "30",
          carencia_armazem_dias: "365",
          carencia_armazem_ate: "",
          taxa_recepcao_por_saca: "0",
          kg_por_saca: "60",
          data_atual: new Date().toISOString().slice(0, 10),
          cotacao_simulada_sc: "50",
          deposito_total_programado_kg: "0",
        });
      })
      .catch((e) => toast.error("Erro carregando parâmetro", (e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armazemId, cultura, safra]);

  // ---- carregar depósitos ----
  // Traz a seleção inteira (Armazém × Cultura × Safra). Busca e status filtram
  // só a TABELA, no client (rowsTabela): os cards, o andamento e o cálculo
  // consolidado não podem mudar com eles — o "Armazenado (inicial)" é a
  // referência fixa da safra (reunião de 20-out).
  const fetchDepositos = useCallback(async () => {
    // Sem armazém selecionado (ex.: base recém-zerada): mostra o estado vazio em
    // vez de ficar preso no "Carregando…" (pedido da call de 24-jun, 35:28).
    if (!armazemId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    try {
      const data = await listarDepositosCalculados({
        armazemId,
        cultura,
        safra: safra || undefined,
      });
      setRows(data);
    } catch (e: unknown) {
      toast.error("Erro carregando depósitos", (e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armazemId, cultura, safra]);

  // fetchDepositos sincroniza com a seleção do topo — o setState interno é intencional.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchDepositos(); }, [fetchDepositos]);

  // ---- safras EFETIVAMENTE cadastradas (com depósito) — ajuste 27-jul ----
  // Antes a lista vinha também dos parâmetros salvos, o que fazia combinações
  // criadas por engano (ex.: soja 25/25) aparecerem no histórico de busca.
  const [safrasDisponiveis, setSafrasDisponiveis] = useState<string[]>([]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset síncrono intencional ao trocar seleção
    if (!armazemId || !cultura) { setSafrasDisponiveis([]); return; }
    let cancelado = false;
    listarSafrasComDeposito(armazemId, cultura)
      .then((s) => { if (!cancelado) setSafrasDisponiveis(s); })
      .catch(() => { if (!cancelado) setSafrasDisponiveis([]); });
    return () => { cancelado = true; };
  }, [armazemId, cultura]);

  // ---- derivados ----
  // Filtros da TABELA, no client: busca em DFe/NFP/observação sem diferenciar
  // maiúsculas (como o ilike que rodava no banco) + status.
  const rowsTabela = useMemo(() => {
    const termo = search.trim().toLowerCase();
    return rows.filter((r) =>
      (!filterStatus || r.status === filterStatus) &&
      (!termo || [r.dfe_entrada, r.nfp, r.observacao].some((v) => (v ?? "").toLowerCase().includes(termo))),
    );
  }, [rows, search, filterStatus]);
  const filtrandoTabela = !!search.trim() || !!filterStatus;
  // resumo = seleção inteira (cards, andamento, cálculo consolidado, gráfico e
  // ajuste de saldo); resumoTabela = linha de totais da tabela filtrada.
  const resumo = useMemo(() => calcularResumoSafra(rows), [rows]);
  const resumoTabela = useMemo(() => calcularResumoSafra(rowsTabela), [rowsTabela]);
  // Sem parâmetros salvos para a cultura × safra, a view não tem kg por saca e
  // devolve as sacas nulas: mostra "—" em vez de "0,00 sc".
  const semSacas = resumo.qtd_depositos > 0 && resumo.qtd_sem_parametro === resumo.qtd_depositos;
  const scResumo = (n: number) => (semSacas ? "—" : fmtSc(n));
  const semSacasTabela = resumoTabela.qtd_depositos > 0 && resumoTabela.qtd_sem_parametro === resumoTabela.qtd_depositos;
  const scTabela = (n: number) => (semSacasTabela ? "—" : fmtScNum(n));
  // Saídas e saldo em % do armazenado inicial (kg ÷ kg: independe do kg por saca).
  const pctDoInicial = (kg: number) => (resumo.total_kg_bruto > 0 ? (kg / resumo.total_kg_bruto) * 100 : 0);
  const safrasDistintas = useMemo(() => {
    // A safra selecionada continua visível mesmo sem depósito (ex.: recém-digitada).
    return Array.from(new Set(safra ? [...safrasDisponiveis, safra] : safrasDisponiveis)).sort();
  }, [safrasDisponiveis, safra]);
  const culturasDistintas = useMemo(
    () => Array.from(new Set(parametros.map((p) => p.cultura))) as CulturaSafra[],
    [parametros],
  );

  // ---- Andamento do Depósito da Safra (ajuste 27-jul) ----
  // "Já armazenado" = total BRUTO depositado na seleção (independe de baixas por
  // venda e dos filtros da tabela). O programado é digitado em kg e exibido em
  // sacas pelo kg por saca do parâmetro (padrão 60).
  const depProgramadoKg = Number(paramForm?.deposito_total_programado_kg) || 0;
  const kgPorSaca = Number(paramForm?.kg_por_saca) || 60;
  const depProgramadoSc = depProgramadoKg / kgPorSaca;
  const depRestanteSc = Math.max(depProgramadoSc - resumo.total_sc_bruto, 0);
  // kg ÷ kg: o percentual não depende do kg por saca nem do parâmetro salvo.
  const depPct = depProgramadoKg > 0 ? (resumo.total_kg_bruto / depProgramadoKg) * 100 : 0;
  const depPctClamp = Math.min(depPct, 100);
  const fmtPct = (v: number) =>
    `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  const totalPages = Math.max(1, Math.ceil(rowsTabela.length / PAGE_SIZE));
  const paged = rowsTabela.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const armazem = armazens.find((a) => a.id === armazemId);
  // kg por saca SALVO de uma cultura × safra — o que a view usa nas sacas. Sem
  // parâmetro salvo, o do formulário (padrão 60). Converte o que chega em kg
  // (prévia do modal de depósito, retorno do ajuste de saldo).
  const kgPorSacaSalvo = (c: CulturaSafra, s: string) =>
    Number(parametros.find((p) => p.cultura === c && p.safra === s.trim())?.kg_por_saca) || kgPorSaca;

  // ---- Salvar parâmetros ----
  async function saveParam() {
    if (!podeEditar) return;
    if (!armazemId || !cultura || !safra || !paramForm) return;
    setParamSaving(true);
    try {
      type P = Database["public"]["Tables"]["safra_parametros"]["Insert"];
      const payload: P = {
        armazem_id: armazemId,
        cultura, safra,
        quebra_quinzena_pct: Number(paramForm.quebra_quinzena_pct),
        armazenagem_por_kg_quinzena: Number(paramForm.armazenagem_por_kg_quinzena),
        devolucao_por_saca: Number(paramForm.devolucao_por_saca),
        carencia_dias: Number(paramForm.carencia_dias),
        carencia_armazem_dias: Number(paramForm.carencia_armazem_dias),
        carencia_armazem_ate: paramForm.carencia_armazem_ate || null,
        taxa_recepcao_por_saca: Number(paramForm.taxa_recepcao_por_saca),
        kg_por_saca: Number(paramForm.kg_por_saca),
        data_atual: paramForm.data_atual,
        cotacao_simulada_sc: paramForm.cotacao_simulada_sc === "" ? null : Number(paramForm.cotacao_simulada_sc),
        deposito_total_programado_kg: Number(paramForm.deposito_total_programado_kg) || 0,
        observacao: null,
      };
      const saved = await upsertParametro(payload);
      setParam(saved);
      setParametros((prev) => {
        const idx = prev.findIndex((p) => p.id === saved.id);
        if (idx >= 0) { const copy = [...prev]; copy[idx] = saved; return copy; }
        return [...prev, saved];
      });
      toast.success("Parâmetros atualizados", "Os cálculos foram recalculados.");
      await fetchDepositos();
    } catch (e: unknown) {
      toast.error("Não foi possível salvar parâmetros", (e as Error).message);
    } finally {
      setParamSaving(false);
    }
  }

  // ---- CRUD depósito ----
  function openNovoDep() {
    if (!podeEditar) return;
    setDepEditId(null);
    setDepSnapshot(null);
    setDepForm({ ...EMPTY_DEP, cultura, safra });
    setDepModal(true);
  }
  function openEditDep(r: SafraDepositoCalculadoRow) {
    setDepEditId(r.id);
    setDepSnapshot(null);
    obterDeposito(r.id).then(setDepSnapshot).catch(() => setDepSnapshot(null));
    setDepForm({
      cultura: r.cultura,
      safra: r.safra,
      data_deposito: r.data_deposito,
      dfe_entrada: r.dfe_entrada ?? "",
      nfp: r.nfp ?? "",
      kg_bruto: String(r.kg_bruto),
      status: r.status,
      observacao: r.observacao ?? "",
    });
    setDepModal(true);
  }
  // Copiar depósito (ajuste 27-jul): abre o modal de NOVO já preenchido com os
  // dados do existente — ajusta o que precisar (DFe/NFP/data) e salva.
  function openCopyDep(r: SafraDepositoCalculadoRow) {
    if (!podeEditar) return;
    setDepEditId(null);
    setDepForm({
      cultura: r.cultura,
      safra: r.safra,
      data_deposito: r.data_deposito,
      dfe_entrada: r.dfe_entrada ?? "",
      nfp: r.nfp ?? "",
      kg_bruto: String(r.kg_bruto),
      status: r.status,
      observacao: r.observacao ?? "",
    });
    setDepModal(true);
    toast.info("Copiando depósito", "Revise os campos (ex.: DFe/NFP e data) e clique em Adicionar.");
  }

  // Exportar a tabela filtrada — Excel (ajuste 27-jul) ou PDF (reunião de 20-out).
  // Os quadros de resumo do PDF repetem os cards: seleção inteira, sem os
  // filtros da tabela. Modo leitura também exporta.
  async function handleExport(formato: "pdf" | "xlsx") {
    if (rowsTabela.length === 0) {
      toast.info("Nada para exportar", "Nenhum depósito no recorte atual.");
      return;
    }
    const filtros: string[] = [];
    if (search) filtros.push(`Busca: "${search}"`);
    if (filterStatus) filtros.push(`Status: ${SAFRA_DEP_STATUS_LABEL[filterStatus]}`);
    setExportando(formato);
    try {
      const meta: EstoqueExportMeta = {
        armazem: armazem?.apelido ?? armazem?.nome,
        cultura: `${CULTURA_LABEL[cultura]}`,
        safra: safra ? `Safra ${safra}` : undefined,
        filtros,
        // RF 20-ago: quem emitiu, a data e a hora.
        emitidoPor: linhaEmissao(await getNomeUsuarioAtual()),
        resumo,
        programado: depProgramadoKg > 0 ? { sc: depProgramadoSc, pct: depPct } : undefined,
      };
      if (formato === "pdf") await exportEstoquePdf(rowsTabela, meta);
      else exportEstoqueXlsx(rowsTabela, meta);
      toast.success("Exportação concluída", `Arquivo ${formato.toUpperCase()} gerado (${rowsTabela.length} depósito${rowsTabela.length === 1 ? "" : "s"}).`);
    } catch (e: unknown) {
      toast.error("Falha na exportação", (e as Error).message ?? String(e));
    } finally {
      setExportando(null);
    }
  }
  async function saveDep() {
    if (!podeEditar) return;
    if (!armazemId || !depForm.kg_bruto || !depForm.safra || !depForm.data_deposito) {
      toast.warning("Campos obrigatórios", "Safra, data e quantidade são obrigatórios.");
      return;
    }
    setDepSaving(true);
    try {
      type P = Database["public"]["Tables"]["safra_depositos"]["Insert"];
      const payload: P = {
        armazem_id: armazemId,
        cultura: depForm.cultura,
        safra: depForm.safra.trim(),
        data_deposito: depForm.data_deposito,
        dfe_entrada: depForm.dfe_entrada.trim() || null,
        nfp: depForm.nfp.trim() || null,
        kg_bruto: Number(depForm.kg_bruto),
        status: depForm.status,
        observacao: depForm.observacao.trim() || null,
        origem_planilha: null,
        created_by: null,
      };
      if (depEditId) {
        await atualizarDeposito(depEditId, payload);
        const anterior = depSnapshot;
        if (anterior) {
          toast.desfazer("Depósito atualizado", "Você tem 8 segundos para voltar aos valores anteriores.", async () => {
            await desfazerEdicao("safra_depositos", anterior);
            await fetchDepositos();
            toast.info("Edição desfeita", "O depósito voltou como estava.");
          });
        } else {
          toast.success("Depósito atualizado");
        }
      } else {
        const criado = await criarDeposito(payload);
        toast.desfazer("Depósito registrado", "Você tem 8 segundos para desfazer.", async () => {
          await desfazerCriacao("safra_depositos", [criado.id]);
          await fetchDepositos();
          toast.info("Criação desfeita", "O depósito foi removido.");
        });
      }
      setDepModal(false);
      await fetchDepositos();
    } catch (e: unknown) {
      toast.error("Não foi possível salvar", (e as Error).message);
    } finally {
      setDepSaving(false);
    }
  }
  async function removeDep(r: SafraDepositoCalculadoRow) {
    if (!podeEditar) return;
    const sc = sacasDoDeposito(r);
    const qtd = sc.disponivel ? ` de ${fmtSc(sc.inicial)}` : "";
    if (!confirm(`Excluir depósito DFe ${r.dfe_entrada ?? "(s/ DFe)"}${qtd}? Você ainda terá 8 segundos para desfazer.`)) return;
    try {
      const apagado = await deletarDeposito(r.id);
      toast.desfazer("Depósito excluído", "Você tem 8 segundos para recuperá-lo.", async () => {
        await desfazerExclusao("safra_depositos", [apagado]);
        await fetchDepositos();
        toast.info("Exclusão desfeita", "O depósito foi restaurado.");
      });
      await fetchDepositos();
    } catch (e: unknown) {
      toast.error("Não foi possível excluir", (e as Error).message);
    }
  }

  // ---- Ajuste de saldo: zerar o resíduo da quebra técnica ----
  function openAjusteSaldo() {
    if (!podeEditar) return;
    setAjusteForm({
      data: paramForm?.data_atual ?? new Date().toISOString().slice(0, 10),
      observacao: "",
    });
    setAjusteModal(true);
  }
  async function zerarSaldo() {
    if (!podeEditar) return;
    if (!safra) return;
    setAjusteSaving(true);
    try {
      // Sem quantidade: o banco mede o saldo sob lock e baixa exatamente ele,
      // então não há divergência com o número que a tela estava mostrando.
      const res = await zerarSaldoQuebra({
        cultura,
        safra,
        armazemId: armazemId || undefined,
        data: ajusteForm.data,
        observacao: ajusteForm.observacao.trim() || undefined,
      });
      const ids = res.notas.map((n) => n.baixa_id).filter((id): id is string => !!id);
      setAjusteModal(false);
      await fetchDepositos();
      // O banco devolve kg; a mensagem sai em sacas (kg por saca salvo da safra).
      const scBaixadas = Number(res.kg_baixado) / kgPorSacaSalvo(cultura, safra);
      const resumoTxt = `${fmtSc(scBaixadas)} baixadas como quebra técnica em ${res.notas.length} nota${res.notas.length === 1 ? "" : "s"}.`;
      if (ids.length > 0) {
        toast.desfazer("Saldo zerado", `${resumoTxt} Você tem 8 segundos para desfazer.`, async () => {
          await desfazerBaixas(ids);
          await fetchDepositos();
          toast.info("Ajuste desfeito", "O saldo voltou ao estoque.");
        });
      } else {
        toast.success("Saldo zerado", resumoTxt);
      }
    } catch (e: unknown) {
      toast.error("Não foi possível zerar o saldo", (e as Error).message);
    } finally {
      setAjusteSaving(false);
    }
  }

  // ---- render ----
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#0f1f1c]">Culturas & Safra</h1>
          <p className="text-sm text-stone-500">
            Acompanhamento de grãos armazenados — taxa de armazenagem, quebra técnica e simulação de venda
          </p>
        </div>
        {podeEditar && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={openAjusteSaldo}
              disabled={!armazemId || !safra || resumo.total_kg_saldo <= 0}
              title="Zera o saldo remanescente lançando-o como quebra técnica — para quando 100% do estoque já foi comercializado e sobrou só a diferença do peso bruto para o líquido fixado pelo armazém">
              <Scale size={14} /> Ajustar Saldo
            </Button>
            <Button size="sm" onClick={openNovoDep} disabled={!armazemId}>
              <Plus size={14} /> Novo Depósito
            </Button>
          </div>
        )}
      </div>

      {/* Seletor: Armazém × Cultura × Safra */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Select label="Armazém" value={armazemId} onChange={(e) => { setArmazemId(e.target.value); setSafra(""); }}>
              <option value="">Selecione…</option>
              {armazens.map((a) => (
                <option key={a.id} value={a.id}>{a.apelido ?? a.nome}</option>
              ))}
            </Select>
            <Select label="Cultura" value={cultura} onChange={(e) => { setCultura(e.target.value as CulturaSafra); }}>
              {(Object.keys(CULTURA_LABEL) as CulturaSafra[])
                .filter((c) => culturasDistintas.length === 0 || culturasDistintas.includes(c))
                .map((c) =>
                  <option key={c} value={c}>{CULTURA_EMOJI[c]} {CULTURA_LABEL[c]}</option>
                )}
            </Select>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-stone-700">Safra</label>
              <div className="flex gap-2">
                <select
                  value={safra}
                  onChange={(e) => setSafra(e.target.value)}
                  className="flex-1 h-9 rounded-lg border border-stone-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400"
                >
                  <option value="">Selecione…</option>
                  {safrasDistintas.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <input
                  placeholder="ou digitar…"
                  value={safra}
                  onChange={(e) => setSafra(e.target.value)}
                  className="w-28 h-9 rounded-lg border border-stone-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cards principais — Safra / Armazém / Depósito programado */}
      <div className={`grid grid-cols-1 md:grid-cols-2 ${depProgramadoKg > 0 ? "xl:grid-cols-4" : ""} gap-4`}>
        <Card className="border-l-4 border-l-[#a67c20]">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center text-amber-700">
              <Sprout size={20} />
            </div>
            <div>
              <p className="text-xs uppercase text-stone-400 font-medium tracking-wide">Safra / Cultura</p>
              <p className="text-lg font-bold text-stone-800">
                {CULTURA_EMOJI[cultura]} {CULTURA_LABEL[cultura]} {safra && `· ${safra}`}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-[#3a6230]">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-700">
              <Warehouse size={20} />
            </div>
            <div>
              <p className="text-xs uppercase text-stone-400 font-medium tracking-wide">Armazém</p>
              <p className="text-lg font-bold text-stone-800">
                {armazem?.apelido ?? armazem?.nome ?? "—"}
              </p>
              {armazem?.cidade && <p className="text-xs text-stone-500">{armazem.cidade}/{armazem.uf}</p>}
            </div>
          </CardContent>
        </Card>
        {depProgramadoKg > 0 && (
          <>
            <Card className="border-l-4 border-l-[#7c5fb8]">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-violet-50 flex items-center justify-center text-violet-700">
                  <ClipboardList size={20} />
                </div>
                <div>
                  <p className="text-xs uppercase text-stone-400 font-medium tracking-wide">Depósito Total Programado</p>
                  <p className="text-lg font-bold text-stone-800">{fmtSc(depProgramadoSc)}</p>
                  <p className="text-[10px] text-stone-500 leading-tight">
                    total que o parceiro irá depositar<br/>como pagamento do arrendamento
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-[#2f7d4f]">
              <CardContent className="p-5 flex items-center gap-4">
                <div>
                  <p className="text-xs uppercase text-stone-400 font-medium tracking-wide">Andamento</p>
                  <p className="text-lg font-bold text-emerald-700">{fmtPct(depPct)}</p>
                  <p className="text-xs text-stone-500">do depósito programado</p>
                </div>
                {/* Anel de progresso */}
                <svg viewBox="0 0 44 44" className="w-14 h-14 ml-auto -rotate-90" aria-hidden="true">
                  <circle cx="22" cy="22" r="18" fill="none" stroke="#e7e5e4" strokeWidth="6" />
                  <circle
                    cx="22" cy="22" r="18" fill="none"
                    stroke="#2f7d4f" strokeWidth="6" strokeLinecap="round"
                    strokeDasharray={`${(depPctClamp / 100) * 2 * Math.PI * 18} ${2 * Math.PI * 18}`}
                  />
                </svg>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Estoque em sacas (reunião de 20-out): o armazenado inicial é a referência
          fixa; o saldo atual reflete as vendas e saídas. Seleção inteira — não
          muda com a busca/status da tabela. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-l-4 border-l-[#5a9485]">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-sky-50 flex items-center justify-center text-sky-700">
              <PackageCheck size={20} />
            </div>
            <div>
              <p className="text-xs uppercase text-stone-400 font-medium tracking-wide">Armazenado (inicial)</p>
              <p className="text-lg font-bold text-stone-800">{scResumo(resumo.total_sc_bruto)}</p>
              <p className="text-xs text-stone-500">
                referência fixa · {resumo.qtd_depositos} nota{resumo.qtd_depositos === 1 ? "" : "s"} depositada{resumo.qtd_depositos === 1 ? "" : "s"}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-[#c2410c]">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-orange-50 flex items-center justify-center text-orange-700">
              <PackageMinus size={20} />
            </div>
            <div>
              <p className="text-xs uppercase text-stone-400 font-medium tracking-wide">Saídas</p>
              <p className="text-lg font-bold text-orange-700">{scResumo(resumo.total_sc_baixado)}</p>
              <p className="text-xs text-stone-500">
                vendas e baixas · {fmtPct(pctDoInicial(resumo.total_kg_baixado))} do inicial
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-[#2f7d4f]">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-700">
              <Boxes size={20} />
            </div>
            <div>
              <p className="text-xs uppercase text-stone-400 font-medium tracking-wide">Saldo atual</p>
              <p className="text-lg font-bold text-emerald-700">{scResumo(resumo.total_sc_saldo)}</p>
              <p className="text-xs text-stone-500">
                {fmtPct(pctDoInicial(resumo.total_kg_saldo))} do inicial · após vendas e saídas
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
      {resumo.qtd_sem_parametro > 0 && (
        <div className="rounded-lg bg-amber-50/70 border border-amber-100 px-4 py-2.5 flex items-start gap-2.5 text-xs text-stone-600">
          <Info size={14} className="text-amber-700 shrink-0 mt-0.5" />
          <span>
            {resumo.qtd_sem_parametro} depósito{resumo.qtd_sem_parametro === 1 ? "" : "s"} sem parâmetros salvos
            para a cultura × safra — sem o <b className="text-stone-700">kg por saca</b>,{" "}
            {resumo.qtd_sem_parametro === 1 ? "fica" : "ficam"} fora das quantidades em sacas.
            Salve os parâmetros da safra para converter.
          </span>
        </div>
      )}

      {/* Andamento do Depósito da Safra — barra de progresso (ajuste 27-jul) */}
      {depProgramadoKg > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              Andamento do Depósito da Safra
              <Tooltip text="Acompanha a quantidade de grãos efetivamente depositada no armazém (registros das NFPs) contra o Depósito Total Programado — configurável no painel de Parâmetros." position="bottom">
                <HelpCircle size={12} className="inline-block ml-1 text-stone-300" />
              </Tooltip>
            </CardTitle>
            <Gauge size={16} className="text-stone-400" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="w-full h-3 rounded-full bg-stone-200 overflow-hidden">
              <div
                className="h-full rounded-full bg-[#2f7d4f] transition-all"
                style={{ width: `${depPctClamp}%` }}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-center">
              <div>
                <p className="text-2xl font-bold text-emerald-700">{fmtPct(depPct)}</p>
                <p className="text-[10px] uppercase font-semibold text-emerald-800 tracking-wide">Depósito da Safra</p>
                <p className="text-[11px] text-stone-400">
                  {depPct >= 100 ? "Depósito programado concluído" : depPct >= 99 ? "Muito próximo do depósito total programado" : "Em andamento"}
                </p>
              </div>
              <div className="sm:border-l sm:border-stone-100 sm:pl-4">
                <p className="text-sm font-bold text-stone-800">{scResumo(resumo.total_sc_bruto)}</p>
                <p className="text-[11px] text-stone-500">já armazenadas</p>
              </div>
              <div className="sm:border-l sm:border-stone-100 sm:pl-4">
                <p className="text-sm font-bold text-amber-600">{scResumo(depRestanteSc)}</p>
                <p className="text-[11px] text-stone-500">restantes para atingir o programado</p>
              </div>
              <div className="sm:border-l sm:border-stone-100 sm:pl-4">
                <p className="text-sm font-bold text-violet-700">{fmtSc(depProgramadoSc)}</p>
                <p className="text-[11px] text-stone-500">depósito total programado</p>
              </div>
            </div>
            <div className="rounded-lg bg-emerald-50/60 border border-emerald-100 px-4 py-2.5 flex items-start gap-2.5 text-xs text-stone-600">
              <Info size={14} className="text-emerald-700 shrink-0 mt-0.5" />
              <span>
                <b className="text-stone-700">Sobre o depósito total programado:</b>{" "}
                refere-se à quantidade total de grãos que o parceiro do arrendamento se compromete a depositar
                neste armazém como forma de pagamento do arrendamento da safra {safra || "selecionada"}.
              </span>
              <Handshake size={16} className="text-emerald-700 shrink-0 ml-auto" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Painel de cálculos + Parâmetros */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Parâmetros (editáveis) */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>
              Parâmetros
              <Tooltip text="Taxas e regras desta safra. Editar aqui recalcula todos os depósitos em tempo real." position="bottom">
                <HelpCircle size={12} className="inline-block ml-1 text-stone-300" />
              </Tooltip>
            </CardTitle>
            <Calculator size={16} className="text-stone-400" />
          </CardHeader>
          <CardContent className="space-y-3">
            {!paramForm ? (
              <p className="text-xs text-stone-400">Selecione um armazém, cultura e safra para configurar.</p>
            ) : (
              <>
                <div>
                  <div className="flex items-center gap-1 mb-1.5">
                    <label className="text-xs font-medium text-stone-600">Data Atual (referência do cálculo)</label>
                    <Tooltip text="Data simulada para 'congelar' os cálculos de quebra técnica e armazenagem. Mudar essa data recalcula tudo automaticamente." position="bottom">
                      <HelpCircle size={11} className="text-stone-300" />
                    </Tooltip>
                  </div>
                  <input type="date" value={paramForm.data_atual} readOnly={!podeEditar}
                    onChange={(e) => setParamForm({ ...paramForm, data_atual: e.target.value })}
                    className="w-full h-9 rounded-lg border border-stone-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400"
                  />
                </div>
                <div>
                  <div className="flex items-center gap-1 mb-1.5">
                    <label className="text-xs font-medium text-stone-600">Cotação Simulada (R$/saca)</label>
                    <Tooltip text="Preço hipotético para projetar o valor da venda. NÃO grava negócio — só simula a coluna 'Valor de Venda'." position="bottom">
                      <HelpCircle size={11} className="text-stone-300" />
                    </Tooltip>
                  </div>
                  <input type="number" step="0.01" value={paramForm.cotacao_simulada_sc} readOnly={!podeEditar}
                    onChange={(e) => setParamForm({ ...paramForm, cotacao_simulada_sc: e.target.value })}
                    placeholder="R$ 50,00"
                    className="w-full h-9 rounded-lg border border-stone-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-stone-100">
                  <div>
                    <label className="text-[10px] font-medium text-stone-500 uppercase">Quebra/Quinzena</label>
                    <input type="number" step="0.00001" value={paramForm.quebra_quinzena_pct} readOnly={!podeEditar}
                      onChange={(e) => setParamForm({ ...paramForm, quebra_quinzena_pct: e.target.value })}
                      className="w-full h-8 rounded-lg border border-stone-200 bg-white px-2 text-xs"
                    />
                    <span className="text-[10px] text-stone-400">ex: 0.0015 = 0,15%</span>
                  </div>
                  <div>
                    <div className="flex items-center gap-1">
                      <label className="text-[10px] font-medium text-stone-500 uppercase">Carência Terceiros</label>
                      <Tooltip text="Dias sem cobrança quando a venda é PARA FORA do armazém (contagem desde o depósito). Normalmente ~30 dias." position="bottom">
                        <HelpCircle size={10} className="text-stone-300" />
                      </Tooltip>
                    </div>
                    <input type="number" value={paramForm.carencia_dias} readOnly={!podeEditar}
                      onChange={(e) => setParamForm({ ...paramForm, carencia_dias: e.target.value })}
                      className="w-full h-8 rounded-lg border border-stone-200 bg-white px-2 text-xs"
                    />
                    <span className="text-[10px] text-stone-400">dias</span>
                  </div>
                  <div>
                    <div className="flex items-center gap-1">
                      <label className="text-[10px] font-medium text-stone-500 uppercase">Carência Armazém</label>
                      <Tooltip text="Dias sem cobrança quando a venda é PARA O PRÓPRIO armazém (Copasul), contados a partir de cada depósito. Só vale quando a data-limite abaixo está vazia." position="bottom">
                        <HelpCircle size={10} className="text-stone-300" />
                      </Tooltip>
                    </div>
                    <input type="number" value={paramForm.carencia_armazem_dias} readOnly={!podeEditar}
                      disabled={!!paramForm.carencia_armazem_ate}
                      onChange={(e) => setParamForm({ ...paramForm, carencia_armazem_dias: e.target.value })}
                      className="w-full h-8 rounded-lg border border-stone-200 bg-white px-2 text-xs disabled:bg-stone-100 disabled:text-stone-400"
                    />
                    <span className="text-[10px] text-stone-400">
                      {paramForm.carencia_armazem_ate ? "ignorado — usando a data-limite" : "dias desde cada depósito"}
                    </span>
                  </div>
                  {/* Carência do armazém como DATA-LIMITE (ajuste 10-ago) — a normativa
                      da safra libera armazenagem gratuita até uma data fixa (ex.: milho
                      25/25 Copasul: 31/05/2026), igual para todas as notas. Era isto que
                      faltava: com 365 dias por nota a taxa saía muito abaixo da Copasul. */}
                  <div className="col-span-2">
                    <div className="flex items-center gap-1">
                      <label className="text-[10px] font-medium text-stone-500 uppercase">Carência Armazém até (data)</label>
                      <Tooltip text="Data-limite da armazenagem gratuita pela normativa da safra na venda ao próprio armazém — ex.: milho 25/25 Copasul: 31/05/2026. Preenchida, a cobrança passa a contar dessa data para TODAS as notas (nota que entrou depois conta da própria entrada) e o campo 'Carência Armazém' em dias é ignorado." position="bottom">
                        <HelpCircle size={10} className="text-stone-300" />
                      </Tooltip>
                    </div>
                    <div className="flex gap-1.5">
                      <input type="date" value={paramForm.carencia_armazem_ate} readOnly={!podeEditar}
                        onChange={(e) => setParamForm({ ...paramForm, carencia_armazem_ate: e.target.value })}
                        className="flex-1 h-8 rounded-lg border border-stone-200 bg-white px-2 text-xs"
                      />
                      {podeEditar && paramForm.carencia_armazem_ate && (
                        <button type="button"
                          onClick={() => setParamForm({ ...paramForm, carencia_armazem_ate: "" })}
                          className="h-8 px-2 rounded-lg border border-stone-200 text-[10px] text-stone-500 hover:bg-stone-50"
                          title="Limpar e voltar a contar a carência em dias por nota"
                        >Limpar</button>
                      )}
                    </div>
                    <span className="text-[10px] text-stone-400">vazio = contar pela carência em dias</span>
                  </div>
                  <div>
                    <div className="flex items-center gap-1">
                      <label className="text-[10px] font-medium text-stone-500 uppercase">Recepção/saca</label>
                      <Tooltip text="Taxa de recepção (R$/saca), cobrada só na venda a terceiros. Deixe 0 se a normativa isentar (caso do milho atual)." position="bottom">
                        <HelpCircle size={10} className="text-stone-300" />
                      </Tooltip>
                    </div>
                    <input type="number" step="0.01" value={paramForm.taxa_recepcao_por_saca} readOnly={!podeEditar}
                      onChange={(e) => setParamForm({ ...paramForm, taxa_recepcao_por_saca: e.target.value })}
                      className="w-full h-8 rounded-lg border border-stone-200 bg-white px-2 text-xs"
                    />
                    <span className="text-[10px] text-stone-400">0 = isenta</span>
                  </div>
                  <div>
                    {/* A view cobra (kg líquido ÷ kg por saca) × taxa × dias/15 — a taxa é
                        por SACA, apesar do nome da coluna (conferido com a Copasul na 0051). */}
                    <label className="text-[10px] font-medium text-stone-500 uppercase">Armaz. sc/quinz</label>
                    <input type="number" step="0.0001" value={paramForm.armazenagem_por_kg_quinzena} readOnly={!podeEditar}
                      onChange={(e) => setParamForm({ ...paramForm, armazenagem_por_kg_quinzena: e.target.value })}
                      className="w-full h-8 rounded-lg border border-stone-200 bg-white px-2 text-xs"
                    />
                    <span className="text-[10px] text-stone-400">R$ por saca / 15 dias</span>
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-stone-500 uppercase">Devolução/saca</label>
                    <input type="number" step="0.01" value={paramForm.devolucao_por_saca} readOnly={!podeEditar}
                      onChange={(e) => setParamForm({ ...paramForm, devolucao_por_saca: e.target.value })}
                      className="w-full h-8 rounded-lg border border-stone-200 bg-white px-2 text-xs"
                    />
                    <span className="text-[10px] text-stone-400">retirada/expedição</span>
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] font-medium text-stone-500 uppercase">kg por saca</label>
                    <input type="number" step="0.01" value={paramForm.kg_por_saca} readOnly={!podeEditar}
                      onChange={(e) => setParamForm({ ...paramForm, kg_por_saca: e.target.value })}
                      className="w-full h-8 rounded-lg border border-stone-200 bg-white px-2 text-xs"
                    />
                    <span className="text-[10px] text-stone-400">base da conversão de kg para sacas</span>
                  </div>
                  <div className="col-span-2">
                    <div className="flex items-center gap-1">
                      <label className="text-[10px] font-medium text-stone-500 uppercase">Depósito Total Programado (kg)</label>
                      <Tooltip text="Quantidade total que o parceiro do arrendamento se compromete a depositar neste armazém (pagamento do arrendamento). Preencher habilita o painel 'Andamento do Depósito da Safra'." position="bottom">
                        <HelpCircle size={10} className="text-stone-300" />
                      </Tooltip>
                    </div>
                    <input type="number" step="0.001" min="0" value={paramForm.deposito_total_programado_kg} readOnly={!podeEditar}
                      onChange={(e) => setParamForm({ ...paramForm, deposito_total_programado_kg: e.target.value })}
                      className="w-full h-8 rounded-lg border border-stone-200 bg-white px-2 text-xs"
                    />
                    <span className="text-[10px] text-stone-400">
                      {depProgramadoKg > 0 ? `= ${fmtSc(depProgramadoSc)}` : "0 = sem acompanhamento"}
                    </span>
                  </div>
                </div>
                {podeEditar && (
                  <Button size="sm" className="w-full mt-2" onClick={saveParam} loading={paramSaving} disabled={paramSaving}>
                    <Save size={14}/> Aplicar / Salvar Parâmetros
                  </Button>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Cálculos consolidados — dois cenários (call 24-jun): venda a terceiros × venda ao armazém */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>
              Cálculo Consolidado — dois cenários de venda
              <Tooltip text="Mesmas tarifas, carências diferentes: a terceiros conta desde o depósito (carência curta); ao próprio armazém a contagem começa depois da carência da normativa anual. Compare os dois saldos para decidir a venda." position="bottom">
                <HelpCircle size={12} className="inline-block ml-1 text-stone-300" />
              </Tooltip>
            </CardTitle>
            <Calendar size={16} className="text-stone-400" />
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {/* Cenário 1 — Venda a terceiros */}
              <div className="rounded-xl border border-stone-200 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-stone-700 uppercase tracking-wide">🚚 Venda a Terceiros</p>
                  <span className="text-[10px] text-stone-400">
                    carência {paramForm?.carencia_dias ?? "—"} dias · desde o depósito
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-stone-50 p-2.5">
                    <p className="text-[10px] uppercase text-stone-500 font-medium">Quebra Técnica</p>
                    <p className="text-sm font-bold text-red-600">{scResumo(resumo.total_quebra_sc)}</p>
                    <p className="text-[10px] text-stone-400">líquido: {scResumo(resumo.total_sc_liquida)}</p>
                  </div>
                  <div className="rounded-lg bg-stone-50 p-2.5">
                    <p className="text-[10px] uppercase text-stone-500 font-medium">Tx Armazenagem</p>
                    <p className="text-sm font-bold text-orange-600">{formatCurrency(resumo.total_taxa_armazenagem)}</p>
                  </div>
                  <div className="rounded-lg bg-stone-50 p-2.5">
                    <p className="text-[10px] uppercase text-stone-500 font-medium">Tx Retirada</p>
                    <p className="text-sm font-bold text-orange-600">{formatCurrency(resumo.total_taxa_devolucao)}</p>
                  </div>
                  <div className="rounded-lg bg-stone-50 p-2.5">
                    <p className="text-[10px] uppercase text-stone-500 font-medium">Tx Recepção</p>
                    <p className="text-sm font-bold text-orange-600">
                      {resumo.total_taxa_recepcao > 0 ? formatCurrency(resumo.total_taxa_recepcao) : "isenta"}
                    </p>
                  </div>
                  <div className="rounded-lg bg-red-50 border border-red-100 p-2.5">
                    <p className="text-[10px] uppercase text-red-700 font-medium flex items-center gap-1">
                      <TrendingDown size={10}/> Total a Descontar
                    </p>
                    <p className="text-sm font-bold text-red-700">{formatCurrency(resumo.total_a_descontar)}</p>
                  </div>
                  <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-2.5">
                    <p className="text-[10px] uppercase text-emerald-700 font-medium flex items-center gap-1">
                      <Coins size={10}/> Venda (simulada)
                    </p>
                    <p className="text-sm font-bold text-emerald-700">{formatCurrency(resumo.total_valor_venda)}</p>
                  </div>
                </div>
                <div className="rounded-lg bg-gradient-to-r from-[#0f1f1c] to-[#1a3028] px-3 py-2.5 text-white space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] uppercase text-[#7ab8aa] font-medium flex items-center gap-1">
                      <ArrowDownToLine size={11}/> Saldo se vender a terceiros
                    </p>
                    <p className="text-lg font-bold">{formatCurrency(resumo.saldo_a_receber)}</p>
                  </div>
                  {/* Valor final por saca = saldo líquido ÷ sacas líquidas (RF 23-jul) */}
                  <div className="flex items-center justify-between border-t border-white/10 pt-1">
                    <p className="text-[10px] text-emerald-300 font-medium">Valor final por sc:</p>
                    <p className="text-sm font-bold text-emerald-300 tabular-nums">
                      {resumo.total_sc_liquida > 0 ? formatCurrency(resumo.saldo_a_receber / resumo.total_sc_liquida) : "—"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Cenário 2 — Venda ao próprio armazém */}
              <div className="rounded-xl border border-stone-200 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-stone-700 uppercase tracking-wide">
                    🏬 Venda ao Armazém {armazem?.apelido ? `(${armazem.apelido})` : ""}
                  </p>
                  <span className="text-[10px] text-stone-400">
                    {paramForm?.carencia_armazem_ate
                      ? `carência até ${formatDate(paramForm.carencia_armazem_ate)} · normativa da safra`
                      : `carência ${paramForm?.carencia_armazem_dias ?? "—"} dias · desde cada depósito`}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-stone-50 p-2.5">
                    <p className="text-[10px] uppercase text-stone-500 font-medium">Quebra Técnica</p>
                    <p className="text-sm font-bold text-red-600">{scResumo(resumo.armazem_total_quebra_sc)}</p>
                    <p className="text-[10px] text-stone-400">líquido: {scResumo(resumo.armazem_total_sc_liquida)}</p>
                  </div>
                  <div className="rounded-lg bg-stone-50 p-2.5">
                    <p className="text-[10px] uppercase text-stone-500 font-medium">Tx Armazenagem</p>
                    <p className="text-sm font-bold text-orange-600">{formatCurrency(resumo.armazem_total_taxa_armazenagem)}</p>
                  </div>
                  <div className="rounded-lg bg-stone-50 p-2.5">
                    <p className="text-[10px] uppercase text-stone-500 font-medium">Tx Retirada</p>
                    <p className="text-sm font-bold text-stone-400">não cobrada</p>
                  </div>
                  <div className="rounded-lg bg-stone-50 p-2.5">
                    <p className="text-[10px] uppercase text-stone-500 font-medium">Tx Recepção</p>
                    <p className="text-sm font-bold text-stone-400">não cobrada</p>
                  </div>
                  <div className="rounded-lg bg-red-50 border border-red-100 p-2.5">
                    <p className="text-[10px] uppercase text-red-700 font-medium flex items-center gap-1">
                      <TrendingDown size={10}/> Total a Descontar
                    </p>
                    <p className="text-sm font-bold text-red-700">{formatCurrency(resumo.armazem_total_a_descontar)}</p>
                  </div>
                  <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-2.5">
                    <p className="text-[10px] uppercase text-emerald-700 font-medium flex items-center gap-1">
                      <Coins size={10}/> Venda (simulada)
                    </p>
                    <p className="text-sm font-bold text-emerald-700">{formatCurrency(resumo.armazem_total_valor_venda)}</p>
                  </div>
                </div>
                <div className="rounded-lg bg-gradient-to-r from-[#0f1f1c] to-[#1a3028] px-3 py-2.5 text-white space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] uppercase text-[#7ab8aa] font-medium flex items-center gap-1">
                      <ArrowDownToLine size={11}/> Saldo se vender ao armazém
                    </p>
                    <p className="text-lg font-bold">{formatCurrency(resumo.armazem_saldo_a_receber)}</p>
                  </div>
                  {/* Valor final por saca = saldo líquido ÷ sacas líquidas (RF 23-jul) */}
                  <div className="flex items-center justify-between border-t border-white/10 pt-1">
                    <p className="text-[10px] text-emerald-300 font-medium">Valor final por sc:</p>
                    <p className="text-sm font-bold text-emerald-300 tabular-nums">
                      {resumo.armazem_total_sc_liquida > 0 ? formatCurrency(resumo.armazem_saldo_a_receber / resumo.armazem_total_sc_liquida) : "—"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <p className="mt-3 text-[11px] text-stone-400">
              {resumo.qtd_depositos} DFe(s) · {scResumo(resumo.total_sc_saldo)} em estoque
              {resumo.total_kg_baixado > 0 && ` (${scResumo(resumo.total_sc_baixado)} já baixadas)`}
              {" "}· cálculos sobre o saldo, recalculados em tempo real
              pela {"“Data Atual”"} dos parâmetros. Colunas da tabela abaixo seguem o cenário de venda a terceiros.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Gráfico de depósitos por dia — em sacas (20-out); sem kg por saca não há o que plotar */}
      {resumo.por_data_deposito.length > 0 && !semSacas && (
        <Card>
          <CardHeader>
            <CardTitle>Depósitos por Data (sacas)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={resumo.por_data_deposito} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" />
                <XAxis dataKey="data" tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
                  tickFormatter={(d) => formatDate(d)}
                />
                <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
                />
                <RTooltip
                  contentStyle={{ borderRadius: 8, border: "1px solid #e7e5e4", fontSize: 12 }}
                  formatter={(v: unknown) => fmtSc(Number(v) || 0)}
                  labelFormatter={(l: unknown) => formatDate(String(l ?? ""))}
                />
                <Bar dataKey="sc_bruto" name="Bruto" fill="#a67c20" radius={[4, 4, 0, 0]} />
                <Bar dataKey="sc_liquido" name="Líquido" fill="#3a6230" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Tabela detalhada de depósitos */}
      <Card>
        <CardHeader className="flex-col items-start gap-3 lg:flex-row lg:items-center">
          <CardTitle>Detalhe dos Depósitos</CardTitle>
          <div className="flex items-center gap-2 flex-wrap ml-auto">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="DFe, NFP, observação..."
                className="h-8 rounded-lg border border-stone-200 pl-8 pr-3 text-xs w-56 focus:outline-none focus:ring-1 focus:ring-accent-400"
              />
            </div>
            <select value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value as SafraDepositoStatus | ""); setPage(1); }}
              className="h-8 rounded-lg border border-stone-200 px-2 text-xs">
              <option value="">Todos status</option>
              {(Object.keys(SAFRA_DEP_STATUS_LABEL) as SafraDepositoStatus[]).map((s) =>
                <option key={s} value={s}>{SAFRA_DEP_STATUS_LABEL[s]}</option>)}
            </select>
            <Button variant="outline" size="sm" onClick={() => handleExport("xlsx")}
              loading={exportando === "xlsx"} disabled={loading || !!exportando}
              title="Exporta a tabela filtrada para Excel (.xlsx), com totais">
              <FileSpreadsheet size={14} /> Exportar Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleExport("pdf")}
              loading={exportando === "pdf"} disabled={loading || !!exportando}
              title="Exporta a tabela filtrada para PDF, com o resumo da safra em sacas e totais">
              <FileDown size={14} /> Exportar PDF
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-100">
                  {["Data","DFe","NFP","Sc Inicial","Sc Baixadas","Sc Saldo","Dias","Qz","Quebra (sc)","Sc Líq","Tx Armaz","Tx Devol","Total Desc","Valor Venda","Status","Ações"].map((h) => (
                    <th key={h} className="px-2 py-3 text-left text-[10px] font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={16} className="px-4 py-12 text-center text-stone-400">
                    <Loader2 size={18} className="inline-block animate-spin mr-2" /> Carregando…
                  </td></tr>
                )}
                {!loading && paged.length === 0 && (
                  <tr><td colSpan={16} className="px-4 py-12 text-center text-stone-400">
                    Sem depósitos nesta seleção — estoque zerado ou ainda não lançado.
                    {podeEditar && <> Clique em &quot;Novo Depósito&quot; para registrar uma entrada.</>}
                  </td></tr>
                )}
                {!loading && paged.map((r) => {
                  // Sacas da nota; sem parâmetro salvo (kg por saca nulo) → "—".
                  const sc = sacasDoDeposito(r);
                  const scCel = (n: number) => (sc.disponivel ? fmtScNum(n) : "—");
                  return (
                    <tr key={r.id} className="border-b border-stone-50 hover:bg-stone-50 transition-colors table-row-alt">
                      <td className="px-2 py-2 text-stone-500 whitespace-nowrap">{formatDate(r.data_deposito)}</td>
                      <td className="px-2 py-2 text-stone-700 font-mono">{r.dfe_entrada ?? "—"}</td>
                      <td className="px-2 py-2 text-stone-700 font-mono">{r.nfp ?? "—"}</td>
                      <td className="px-2 py-2 text-stone-800 text-right font-medium">{scCel(sc.inicial)}</td>
                      <td className="px-2 py-2 text-right text-stone-400">
                        {sc.baixadas > 0 ? scCel(sc.baixadas) : "—"}
                      </td>
                      <td className="px-2 py-2 text-right font-semibold text-stone-800">
                        {scCel(sc.saldo)}
                      </td>
                      <td className="px-2 py-2 text-stone-500 text-right">{r.dias_percorridos}</td>
                      <td className="px-2 py-2 text-stone-500 text-right">{Number(r.quinzenas).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="px-2 py-2 text-red-600 text-right">{scCel(sc.quebra)}</td>
                      <td className="px-2 py-2 text-stone-700 text-right">{scCel(sc.liquida)}</td>
                      <td className="px-2 py-2 text-orange-700 text-right">{formatCurrency(Number(r.taxa_armazenagem_saldo ?? r.taxa_armazenagem))}</td>
                      <td className="px-2 py-2 text-orange-700 text-right">{formatCurrency(Number(r.taxa_devolucao_saldo ?? r.taxa_devolucao))}</td>
                      <td className="px-2 py-2 text-red-700 font-semibold text-right">{formatCurrency(Number(r.total_a_descontar_saldo ?? r.total_a_descontar))}</td>
                      <td className="px-2 py-2 text-emerald-700 font-semibold text-right">{formatCurrency(Number(r.valor_venda_saldo ?? r.valor_venda_simulado))}</td>
                      <td className="px-2 py-2"><Badge variant={statusBadge(r.status)}>{SAFRA_DEP_STATUS_LABEL[r.status]}</Badge></td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-0.5">
                          <button onClick={() => openEditDep(r)} className="p-1 rounded hover:bg-primary-50 text-stone-400 hover:text-primary-600 transition" title={podeEditar ? "Editar" : "Ver detalhes"}>{podeEditar ? <Edit2 size={12}/> : <Eye size={12}/>}</button>
                          {podeEditar && (
                            <>
                              <button onClick={() => openCopyDep(r)} className="p-1 rounded hover:bg-accent-50 text-stone-400 hover:text-accent-600 transition" title="Copiar (abre um novo depósito já preenchido)"><Copy size={12}/></button>
                              <button onClick={() => removeDep(r)} className="p-1 rounded hover:bg-red-50 text-stone-400 hover:text-red-500 transition" title="Excluir"><Trash2 size={12}/></button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Totais = linhas filtradas da tabela (resumoTabela), em sacas. */}
              {!loading && rowsTabela.length > 0 && (
                <tfoot>
                  <tr className="bg-stone-100 border-t-2 border-stone-200 font-semibold text-stone-700 text-[11px]">
                    <td colSpan={3} className="px-2 py-2.5 uppercase tracking-wide">Totais</td>
                    <td className="px-2 py-2.5 text-right">{scTabela(resumoTabela.total_sc_bruto)}</td>
                    <td className="px-2 py-2.5 text-right text-stone-500">
                      {resumoTabela.total_sc_baixado > 0 ? scTabela(resumoTabela.total_sc_baixado) : "—"}
                    </td>
                    <td className="px-2 py-2.5 text-right">{scTabela(resumoTabela.total_sc_saldo)}</td>
                    <td colSpan={2}></td>
                    <td className="px-2 py-2.5 text-red-700 text-right">{scTabela(resumoTabela.total_quebra_sc)}</td>
                    <td className="px-2 py-2.5 text-right">{scTabela(resumoTabela.total_sc_liquida)}</td>
                    <td className="px-2 py-2.5 text-orange-700 text-right">{formatCurrency(resumoTabela.total_taxa_armazenagem)}</td>
                    <td className="px-2 py-2.5 text-orange-700 text-right">{formatCurrency(resumoTabela.total_taxa_devolucao)}</td>
                    <td className="px-2 py-2.5 text-red-700 text-right">{formatCurrency(resumoTabela.total_a_descontar)}</td>
                    <td className="px-2 py-2.5 text-emerald-700 text-right">{formatCurrency(resumoTabela.total_valor_venda)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-t border-stone-100">
            <p className="text-xs text-stone-400">
              {loading
                ? "…"
                : `${filtrandoTabela ? `${rowsTabela.length} de ` : ""}${rows.length} depósito${rows.length === 1 ? "" : "s"}`}
            </p>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </CardContent>
      </Card>

      {/* Modal Depósito */}
      <Modal open={depModal} onClose={depGuard.requestClose}
        title={!podeEditar ? "Detalhes do Depósito" : depEditId ? "Editar Depósito" : "Novo Depósito"} size="lg">
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Select label="Cultura *" value={depForm.cultura} disabled={!podeEditar}
              onChange={(e) => setDepForm({ ...depForm, cultura: e.target.value as CulturaSafra })}>
              {(Object.keys(CULTURA_LABEL) as CulturaSafra[]).map((c) =>
                <option key={c} value={c}>{CULTURA_EMOJI[c]} {CULTURA_LABEL[c]}</option>)}
            </Select>
            <Input label="Safra *" placeholder="25/25" value={depForm.safra} readOnly={!podeEditar}
              onChange={(e) => setDepForm({ ...depForm, safra: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input label="Data Depósito *" type="date" value={depForm.data_deposito} readOnly={!podeEditar}
              onChange={(e) => setDepForm({ ...depForm, data_deposito: e.target.value })} />
            <Input label="DFe (entrada)" placeholder="54383" value={depForm.dfe_entrada} readOnly={!podeEditar}
              onChange={(e) => setDepForm({ ...depForm, dfe_entrada: e.target.value })} />
            <Input label="NFP" placeholder="8285721" value={depForm.nfp} readOnly={!podeEditar}
              onChange={(e) => setDepForm({ ...depForm, nfp: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {/* Entrada em kg (como na nota fiscal); a prévia mostra as sacas que a tela vai exibir. */}
            <div>
              <Input label="Quantidade (kg bruto) *" type="number" step="0.001" readOnly={!podeEditar}
                value={depForm.kg_bruto} onChange={(e) => setDepForm({ ...depForm, kg_bruto: e.target.value })} />
              {Number(depForm.kg_bruto) > 0 && (
                <p className="mt-1 text-[11px] text-stone-500">
                  = {fmtSc(Number(depForm.kg_bruto) / kgPorSacaSalvo(depForm.cultura, depForm.safra))}
                </p>
              )}
            </div>
            <Select label="Status" value={depForm.status} disabled={!podeEditar}
              onChange={(e) => setDepForm({ ...depForm, status: e.target.value as SafraDepositoStatus })}>
              {(Object.keys(SAFRA_DEP_STATUS_LABEL) as SafraDepositoStatus[]).map((s) =>
                <option key={s} value={s}>{SAFRA_DEP_STATUS_LABEL[s]}</option>)}
            </Select>
          </div>
          <Textarea label="Observação" rows={2} value={depForm.observacao} readOnly={!podeEditar}
            onChange={(e) => setDepForm({ ...depForm, observacao: e.target.value })} />
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={depGuard.requestClose}>{podeEditar ? "Cancelar" : "Fechar"}</Button>
            {podeEditar && (
              <Button onClick={saveDep} loading={depSaving} disabled={depSaving}>
                {depEditId ? "Salvar Alterações" : "Adicionar"}
              </Button>
            )}
          </div>
        </div>
      </Modal>
      <UnsavedChangesDialog open={depGuard.confirmOpen} onStay={depGuard.stay} onDiscard={depGuard.discard} />

      {/* Modal Ajuste de Saldo (quebra técnica) — 10-ago */}
      <Modal open={ajusteModal} onClose={ajusteGuard.requestClose}
        title="Ajustar Saldo do Estoque — Quebra Técnica" size="lg">
        <div className="p-6 space-y-4">
          <div className="rounded-lg bg-amber-50/70 border border-amber-100 px-4 py-3 flex items-start gap-2.5 text-xs text-stone-600">
            <Info size={14} className="text-amber-700 shrink-0 mt-0.5" />
            <span>
              Use quando <b className="text-stone-700">100% do estoque já foi comercializado</b> e ainda
              sobra saldo. Isso acontece porque as notas guardam o peso <b>bruto depositado</b> e o
              armazém fixa o peso <b>líquido</b> — a diferença é a quebra técnica real apurada por ele.
              O ajuste baixa exatamente esse resíduo com o motivo <b>quebra técnica</b>:
              o bruto depositado continua íntegro no histórico e a saída fica registrada.
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-stone-50 p-3">
              <p className="text-[10px] uppercase text-stone-500 font-medium">Safra / Cultura</p>
              <p className="text-sm font-bold text-stone-800">
                {CULTURA_EMOJI[cultura]} {CULTURA_LABEL[cultura]} · {safra || "—"}
              </p>
            </div>
            <div className="rounded-lg bg-stone-50 p-3">
              <p className="text-[10px] uppercase text-stone-500 font-medium">Armazém</p>
              <p className="text-sm font-bold text-stone-800">{armazem?.apelido ?? armazem?.nome ?? "—"}</p>
            </div>
            <div className="rounded-lg bg-red-50 border border-red-100 p-3">
              <p className="text-[10px] uppercase text-red-700 font-medium">Saldo a zerar</p>
              <p className="text-sm font-bold text-red-700">{scResumo(resumo.total_sc_saldo)}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label="Data do ajuste *" type="date" value={ajusteForm.data}
              onChange={(e) => setAjusteForm({ ...ajusteForm, data: e.target.value })} />
          </div>
          <Textarea label="Observação" rows={2}
            placeholder="Ex.: quebra técnica apurada pela Copasul na fixação de 07/08/2026"
            value={ajusteForm.observacao}
            onChange={(e) => setAjusteForm({ ...ajusteForm, observacao: e.target.value })} />

          <p className="text-[11px] text-stone-400">
            O valor baixado é medido no banco no instante da confirmação — se alguém lançar uma venda
            enquanto esta janela está aberta, o ajuste acompanha. Depois de confirmar você ainda tem
            8 segundos para desfazer.
          </p>

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={ajusteGuard.requestClose}>Cancelar</Button>
            <Button onClick={zerarSaldo} loading={ajusteSaving}
              disabled={ajusteSaving || !ajusteForm.data || resumo.total_kg_saldo <= 0}>
              <Scale size={14} /> Zerar Saldo
            </Button>
          </div>
        </div>
      </Modal>
      <UnsavedChangesDialog open={ajusteGuard.confirmOpen} onStay={ajusteGuard.stay} onDiscard={ajusteGuard.discard} />
    </div>
  );
}
