"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { KpiCard } from "@/components/ui/KpiCard";
import { Modal } from "@/components/ui/Modal";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { UnsavedChangesDialog } from "@/components/ui/UnsavedChangesDialog";
import { useUnsavedGuard } from "@/lib/hooks/useUnsavedGuard";
import {
  Plus, Search, Edit2, Trash2, Loader2, HandCoins, CheckCheck,
  ArrowRightLeft, Undo2, CalendarCheck, PiggyBank, Landmark, AlertTriangle,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import {
  listarDetalhado, criarDetalhado, atualizarDetalhado, deletarDetalhado,
  atualizarDetalhadoEmMassa, obterResumoMensal, obterGlobalEmpresaMes,
  listarRepassesDoMes, consolidarRepasse, desfazerRepasse, concluirRepasse,
  listarSocios, listarClassificacoesPessoais, listarContasDoSocio, listarMesesDetalhado,
  type TransacaoSocioRich, type GlobalEmpresaMes, type RepasseConsolidado,
} from "@/lib/queries/distribuicao";
import {
  STATUS_DL_LABEL,
  type StatusDL, type SocioRow, type ClassificacaoPessoalRow,
  type ContaBancariaSocioRow, type DlMensalResumoRow, type TransacaoSocioInsert,
} from "@/types";

const DL_BADGE: Record<StatusDL, BadgeVariant> = {
  provisionado: "warning",
  a_pagar:      "info",
  realizado:    "success",
};

const STATUS_EMPRESA_LABEL: Record<string, string> = {
  a_pagar: "A pagar",
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
  data_vencimento: string;
  valor: string;
  status: StatusDL;
  observacao: string;
};

const mesCorrente = () => {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}`;
};

export function DistribuicaoPage() {
  const toast = useToast();

  // ---- filtros ----
  const [mes, setMes] = useState(mesCorrente());
  const [meses, setMeses] = useState<string[]>([]);
  const [filterSocio, setFilterSocio] = useState("");
  const [filterClassif, setFilterClassif] = useState("");
  const [filterStatus, setFilterStatus] = useState<StatusDL | "">("");
  const [search, setSearch] = useState("");

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

  // ---- dados do mês ----
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [r, res, glob, reps] = await Promise.all([
        listarDetalhado({
          mesReferencia: mes,
          socioId: filterSocio || undefined,
          classificacao: filterClassif || undefined,
          status: filterStatus || undefined,
          search: search || undefined,
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
  }, [mes, filterSocio, filterClassif, filterStatus, search]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData(); setSelectedIds(new Set()); }, [fetchData]);

  // ---- derivados ----
  const consolidaveis = useMemo(
    () => rows.filter((r) => r.status === "a_pagar" && !r.repasse_id),
    [rows],
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

  const selecionaveis = useMemo(() => rows.filter((r) => !r.repasse_id), [rows]);
  const allSelected = selecionaveis.length > 0 && selecionaveis.every((r) => selectedIds.has(r.id));

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
      valor: String(row.valor),
      status: row.status,
      observacao: row.observacao ?? "",
    });
    setModalOpen(true);
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
    if (!confirm(`Dar baixa no repasse de ${formatCurrency(-rep.valor)}? O global vira "Repassado", a transferência Cora → Inter vira "Pago/Recebido" e o detalhado vinculado vira "Repassado".`)) return;
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
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#0f1f1c]">Distribuição de Lucro</h1>
          <p className="text-sm text-stone-500">
            Detalhado por sócio — espelho da planilha {`"Distribuição de Lucro_Mensal"`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            onClick={() => setConsolidarOpen(true)}
            disabled={qtdConsolidavel === 0}
            title={qtdConsolidavel === 0
              ? 'Marque lançamentos como "A pagar" para liberar a consolidação'
              : "Cria o lançamento global no Financeiro a partir do detalhado marcado como A pagar"}
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
        <span><b className="text-stone-800">1.</b> Confira o detalhado do mês (valores, faturas, vencimentos) e marque item a item como <b>A pagar</b>.</span>
        <span><b className="text-stone-800">2.</b> Clique em <b>Consolidar repasse</b> — o sistema cria o valor global no Financeiro (Cora → Inter) automaticamente.</span>
        <span><b className="text-stone-800">3.</b> Feito o repasse aos sócios, clique em <b>Dar baixa</b> — tudo vira Repassado de uma vez.</span>
      </div>

      {/* KPIs do mês */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Provisionado (mês)"
          value={formatCurrency(resumo?.provisionado ?? 0)}
          icon={<PiggyBank size={16} />}
          helpText="Soma do detalhado com status Provisionado neste mês. É o que ainda falta conferir/marcar."
        />
        <KpiCard
          label="A pagar (pronto p/ repasse)"
          value={formatCurrency(resumo?.a_pagar ?? 0)}
          icon={<CalendarCheck size={16} />}
          helpText="Soma do detalhado marcado como A pagar. A parte ainda não consolidada aparece no botão Consolidar."
        />
        <KpiCard
          label="Repassado (mês)"
          value={formatCurrency(resumo?.realizado ?? 0)}
          icon={<CheckCheck size={16} />}
          helpText="Detalhado já baixado (repassado às contas pessoais dos sócios)."
        />
        <KpiCard
          label="Global na empresa (2.8)"
          value={formatCurrency((globalMes?.provisionadoGlobal ?? 0) + (globalMes?.aPagarGlobal ?? 0) + (globalMes?.realizadoGlobal ?? 0))}
          icon={<Landmark size={16} />}
          helpText="Soma dos lançamentos de Distribuição de Lucro (conta 2.8) no Financeiro da empresa neste mês (provisionado + a pagar + repassado). Deve bater com o detalhado."
        />
      </div>

      {/* Divergência entre global manual e detalhado */}
      {divergenciaProvisionado !== null && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            O provisionado global lançado à mão no Financeiro ({formatCurrency(globalMes?.provisionadoGlobal ?? 0)}) difere
            da soma do detalhado ({formatCurrency(resumo?.provisionado ?? 0)}) em {formatCurrency(divergenciaProvisionado)}.
            Enquanto existir lançamento provisionado manual na conta 2.8 deste mês, o sistema não sincroniza o global
            automaticamente — ajuste ou exclua a linha manual no <Link href="/dashboard/financeiro" className="underline font-medium">Financeiro</Link> para
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
                      <Badge variant={rep.status === "repassado" ? "success" : "info"}>
                        {STATUS_EMPRESA_LABEL[rep.status] ?? rep.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      {rep.status === "a_pagar" && (
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
            <select value={mes} onChange={(e) => setMes(e.target.value)}
              className="h-8 rounded-lg border border-stone-200 px-2 text-xs" title="Mês de competência">
              {(meses.includes(mes) ? meses : [mes, ...meses]).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
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
              title="Data de vencimento a aplicar nos selecionados"
            />
            <Button size="sm" variant="outline" disabled={!bulkVencimento || bulkBusy}
              onClick={() => aplicarEmMassa({ data_vencimento: bulkVencimento }, "Vencimento aplicado")}>
              Aplicar vencimento
            </Button>
            <Button size="sm" variant="outline" disabled={bulkBusy}
              onClick={() => aplicarEmMassa(
                bulkVencimento ? { status: "a_pagar", data_vencimento: bulkVencimento } : { status: "a_pagar" },
                'Marcado como "A pagar"',
              )}
              title="Marca os selecionados como A pagar (aplica também o vencimento, se preenchido)">
              Marcar A pagar
            </Button>
            <Button size="sm" variant="ghost" disabled={bulkBusy}
              onClick={() => aplicarEmMassa({ status: "provisionado" }, "Voltou a Provisionado")}>
              Voltar a Provisionado
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
                    <input type="checkbox" aria-label="Selecionar todos" checked={allSelected} onChange={toggleAll}
                      className="h-3.5 w-3.5 rounded border-stone-300 accent-accent-500 cursor-pointer" />
                  </th>
                  {["Sócio","Classificação","Descrição","Conta destino","Vencimento","Valor","Status","Repasse","Ações"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={10} className="px-4 py-12 text-center text-stone-400">
                    <Loader2 size={18} className="inline-block animate-spin mr-2" /> Carregando…
                  </td></tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={10} className="px-4 py-12 text-center text-stone-400">
                    Nenhum lançamento detalhado em {mes}. Clique em {"“Novo lançamento detalhado”"} para começar
                    — ou lance pelo Financeiro escolhendo {"“Saída detalhada”"} na conta 2.8.
                  </td></tr>
                )}
                {!loading && rows.map((r) => {
                  const vinculado = !!r.repasse_id;
                  const selected = selectedIds.has(r.id);
                  return (
                    <tr key={r.id} className={`border-b border-stone-50 transition-colors table-row-alt ${selected ? "bg-accent-50/60" : "hover:bg-stone-50"}`}>
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
                        {r.data_vencimento ? formatDate(r.data_vencimento) : <span className="text-stone-300">—</span>}
                      </td>
                      <td className="px-4 py-3 font-semibold text-sm whitespace-nowrap text-stone-800">
                        {formatCurrency(Number(r.valor))}
                      </td>
                      <td className="px-4 py-3">
                        {vinculado ? (
                          <Badge variant={DL_BADGE[r.status]}>{STATUS_DL_LABEL[r.status]}</Badge>
                        ) : (
                          <select
                            value={r.status}
                            onChange={(e) => mudarStatus(r, e.target.value as StatusDL)}
                            className="h-7 rounded-lg border border-stone-200 px-1.5 text-xs bg-white"
                            title="Mudar status deste lançamento"
                          >
                            {(Object.keys(STATUS_DL_LABEL) as StatusDL[]).map((s) =>
                              <option key={s} value={s}>{STATUS_DL_LABEL[s]}</option>)}
                          </select>
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
                          <button onClick={() => handleDelete(r)} className="p-1.5 rounded hover:bg-red-50 text-stone-400 hover:text-red-500 transition" title="Excluir">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {!loading && rows.length > 0 && (
                <tfoot>
                  <tr className="bg-stone-100 border-t-2 border-stone-200 font-semibold text-stone-700 text-xs">
                    <td colSpan={6} className="px-4 py-2.5 uppercase tracking-wide">Total do recorte</td>
                    <td className="px-4 py-2.5">{formatCurrency(rows.reduce((s, r) => s + Number(r.valor), 0))}</td>
                    <td colSpan={3}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <div className="px-4 py-3 border-t border-stone-100 text-xs text-stone-400">
            {loading ? "…" : `${rows.length} lançamento${rows.length === 1 ? "" : "s"} no recorte`}
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
            <div className="grid grid-cols-3 gap-3">
              <Input label="Competência (mês) *" type="month" value={form.competencia}
                onChange={(e) => setForm({ ...form, competencia: e.target.value })} />
              <Input label="Vencimento (dia do repasse)" type="date" value={form.data_vencimento}
                onChange={(e) => setForm({ ...form, data_vencimento: e.target.value })} />
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
            status {"“A pagar”"} — total de <b className="text-stone-800">{formatCurrency(totalConsolidavel)}</b>.
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
              {" “A pagar”"} do mês, totalizando {formatCurrency(totalConsolidavel)}.)
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
            <p>• Saída global no <b>Inter</b> de {formatCurrency(totalConsolidavel)} (Distribuição de Lucro — 2.8), status {"“A pagar”"}</p>
            <p className="text-stone-400 pt-1">
              Tudo nasce como {"“A pagar/A receber”"}. Depois de efetivar o repasse aos sócios, use {"“Dar baixa”"} aqui
              nesta tela para marcar tudo como Pago/Recebido/Repassado de uma vez.
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
    </div>
  );
}
