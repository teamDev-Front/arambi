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
import {
  Plus, Search, Edit2, Trash2, Loader2, Save,
  Warehouse, Sprout, Calculator, Calendar, PackageCheck,
  Coins, TrendingDown, ArrowDownToLine, HelpCircle,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer,
} from "recharts";
import {
  listarArmazens, listarParametros, obterParametro, upsertParametro,
  listarDepositosCalculados, criarDeposito, atualizarDeposito, deletarDeposito,
  calcularResumoSafra,
} from "@/lib/queries/safra";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import {
  CULTURA_LABEL, CULTURA_EMOJI, SAFRA_DEP_STATUS_LABEL,
  type ArmazemRow, type SafraParametrosRow, type SafraDepositoCalculadoRow,
  type CulturaSafra, type SafraDepositoStatus, type Database,
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
  taxa_recepcao_por_saca: string;    // R$/saca — só terceiros; 0 = isenta
  kg_por_saca: string;
  data_atual: string;
  cotacao_simulada_sc: string;
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

const fmtKg = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} kg`;
const fmtSc = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} sc`;

export function EstoquePage() {
  const toast = useToast();

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

  const [depModal, setDepModal] = useState(false);
  const [depEditId, setDepEditId] = useState<string | null>(null);
  const [depForm, setDepForm] = useState<DepForm>(EMPTY_DEP);
  const depGuard = useUnsavedGuard(depModal, depForm, () => setDepModal(false));
  const [depSaving, setDepSaving] = useState(false);

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
          taxa_recepcao_por_saca: String(p.taxa_recepcao_por_saca ?? 0),
          kg_por_saca: String(p.kg_por_saca),
          data_atual: p.data_atual,
          cotacao_simulada_sc: p.cotacao_simulada_sc !== null ? String(p.cotacao_simulada_sc) : "",
        } : {
          quebra_quinzena_pct: "0.0015",
          armazenagem_por_kg_quinzena: "0.20",
          devolucao_por_saca: "4.75",
          carencia_dias: "30",
          carencia_armazem_dias: "365",
          taxa_recepcao_por_saca: "0",
          kg_por_saca: "60",
          data_atual: new Date().toISOString().slice(0, 10),
          cotacao_simulada_sc: "50",
        });
      })
      .catch((e) => toast.error("Erro carregando parâmetro", (e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armazemId, cultura, safra]);

  // ---- carregar depósitos ----
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
        status: filterStatus || undefined,
        search: search || undefined,
      });
      setRows(data);
    } catch (e: unknown) {
      toast.error("Erro carregando depósitos", (e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armazemId, cultura, safra, filterStatus, search]);

  // fetchDepositos sincroniza a tabela com os filtros — o setState interno é intencional.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchDepositos(); }, [fetchDepositos]);

  // ---- derivados ----
  const resumo = useMemo(() => calcularResumoSafra(rows), [rows]);
  const safrasDistintas = useMemo(() => {
    const fromParams = parametros.filter((p) => p.cultura === cultura).map((p) => p.safra);
    const fromRows = rows.map((r) => r.safra);
    return Array.from(new Set([...fromParams, ...fromRows])).sort();
  }, [parametros, rows, cultura]);
  const culturasDistintas = useMemo(
    () => Array.from(new Set(parametros.map((p) => p.cultura))) as CulturaSafra[],
    [parametros],
  );
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const armazem = armazens.find((a) => a.id === armazemId);

  // ---- Salvar parâmetros ----
  async function saveParam() {
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
        taxa_recepcao_por_saca: Number(paramForm.taxa_recepcao_por_saca),
        kg_por_saca: Number(paramForm.kg_por_saca),
        data_atual: paramForm.data_atual,
        cotacao_simulada_sc: paramForm.cotacao_simulada_sc === "" ? null : Number(paramForm.cotacao_simulada_sc),
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
    setDepEditId(null);
    setDepForm({ ...EMPTY_DEP, cultura, safra });
    setDepModal(true);
  }
  function openEditDep(r: SafraDepositoCalculadoRow) {
    setDepEditId(r.id);
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
  async function saveDep() {
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
        toast.success("Depósito atualizado");
      } else {
        await criarDeposito(payload);
        toast.success("Depósito registrado");
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
    if (!confirm(`Excluir depósito DFe ${r.dfe_entrada ?? "(s/ DFe)"} de ${fmtKg(Number(r.kg_bruto))}?`)) return;
    try {
      await deletarDeposito(r.id);
      toast.success("Depósito excluído");
      await fetchDepositos();
    } catch (e: unknown) {
      toast.error("Não foi possível excluir", (e as Error).message);
    }
  }

  // ---- render ----
  return (
    <div className="space-y-6 max-w-[1500px]">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#0f1f1c]">Estoque & Safra</h1>
          <p className="text-sm text-stone-500">
            Acompanhamento de grãos armazenados — taxa de armazenagem, quebra técnica e simulação de venda
          </p>
        </div>
        <Button size="sm" onClick={openNovoDep} disabled={!armazemId}>
          <Plus size={14} /> Novo Depósito
        </Button>
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

      {/* Cards principais — Safra / Armazém / Quantidade */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
        <Card className="border-l-4 border-l-[#5a9485]">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-sky-50 flex items-center justify-center text-sky-700">
              <PackageCheck size={20} />
            </div>
            <div>
              <p className="text-xs uppercase text-stone-400 font-medium tracking-wide">Em Estoque (saldo)</p>
              <p className="text-lg font-bold text-stone-800">{fmtKg(resumo.total_kg_saldo)}</p>
              <p className="text-xs text-stone-500">
                {fmtSc(resumo.total_sc_saldo)}
                {resumo.total_kg_baixado > 0 && ` · ${fmtKg(resumo.total_kg_baixado)} baixados de ${fmtKg(resumo.total_kg_bruto)}`}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

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
                  <input type="date" value={paramForm.data_atual}
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
                  <input type="number" step="0.01" value={paramForm.cotacao_simulada_sc}
                    onChange={(e) => setParamForm({ ...paramForm, cotacao_simulada_sc: e.target.value })}
                    placeholder="R$ 50,00"
                    className="w-full h-9 rounded-lg border border-stone-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-stone-100">
                  <div>
                    <label className="text-[10px] font-medium text-stone-500 uppercase">Quebra/Quinzena</label>
                    <input type="number" step="0.00001" value={paramForm.quebra_quinzena_pct}
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
                    <input type="number" value={paramForm.carencia_dias}
                      onChange={(e) => setParamForm({ ...paramForm, carencia_dias: e.target.value })}
                      className="w-full h-8 rounded-lg border border-stone-200 bg-white px-2 text-xs"
                    />
                    <span className="text-[10px] text-stone-400">dias</span>
                  </div>
                  <div>
                    <div className="flex items-center gap-1">
                      <label className="text-[10px] font-medium text-stone-500 uppercase">Carência Armazém</label>
                      <Tooltip text="Dias sem cobrança quando a venda é PARA O PRÓPRIO armazém (Copasul). Vem da normativa anual e muda por produto/ano — ex.: milho 25/26 teve carência até 30/mai." position="bottom">
                        <HelpCircle size={10} className="text-stone-300" />
                      </Tooltip>
                    </div>
                    <input type="number" value={paramForm.carencia_armazem_dias}
                      onChange={(e) => setParamForm({ ...paramForm, carencia_armazem_dias: e.target.value })}
                      className="w-full h-8 rounded-lg border border-stone-200 bg-white px-2 text-xs"
                    />
                    <span className="text-[10px] text-stone-400">dias (normativa anual)</span>
                  </div>
                  <div>
                    <div className="flex items-center gap-1">
                      <label className="text-[10px] font-medium text-stone-500 uppercase">Recepção/saca</label>
                      <Tooltip text="Taxa de recepção (R$/saca), cobrada só na venda a terceiros. Deixe 0 se a normativa isentar (caso do milho atual)." position="bottom">
                        <HelpCircle size={10} className="text-stone-300" />
                      </Tooltip>
                    </div>
                    <input type="number" step="0.01" value={paramForm.taxa_recepcao_por_saca}
                      onChange={(e) => setParamForm({ ...paramForm, taxa_recepcao_por_saca: e.target.value })}
                      className="w-full h-8 rounded-lg border border-stone-200 bg-white px-2 text-xs"
                    />
                    <span className="text-[10px] text-stone-400">0 = isenta</span>
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-stone-500 uppercase">Armaz. kg/quinz</label>
                    <input type="number" step="0.0001" value={paramForm.armazenagem_por_kg_quinzena}
                      onChange={(e) => setParamForm({ ...paramForm, armazenagem_por_kg_quinzena: e.target.value })}
                      className="w-full h-8 rounded-lg border border-stone-200 bg-white px-2 text-xs"
                    />
                    <span className="text-[10px] text-stone-400">R$ por kg / 15 dias</span>
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-stone-500 uppercase">Devolução/saca</label>
                    <input type="number" step="0.01" value={paramForm.devolucao_por_saca}
                      onChange={(e) => setParamForm({ ...paramForm, devolucao_por_saca: e.target.value })}
                      className="w-full h-8 rounded-lg border border-stone-200 bg-white px-2 text-xs"
                    />
                    <span className="text-[10px] text-stone-400">retirada/expedição</span>
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] font-medium text-stone-500 uppercase">kg por saca</label>
                    <input type="number" step="0.01" value={paramForm.kg_por_saca}
                      onChange={(e) => setParamForm({ ...paramForm, kg_por_saca: e.target.value })}
                      className="w-full h-8 rounded-lg border border-stone-200 bg-white px-2 text-xs"
                    />
                  </div>
                </div>
                <Button size="sm" className="w-full mt-2" onClick={saveParam} loading={paramSaving} disabled={paramSaving}>
                  <Save size={14}/> Aplicar / Salvar Parâmetros
                </Button>
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
                    <p className="text-sm font-bold text-red-600">{fmtKg(resumo.total_quebra_kg)}</p>
                    <p className="text-[10px] text-stone-400">líquido: {fmtSc(resumo.total_sc_liquida)}</p>
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
                <div className="rounded-lg bg-gradient-to-r from-[#0f1f1c] to-[#1a3028] px-3 py-2.5 text-white flex items-center justify-between">
                  <p className="text-[10px] uppercase text-[#7ab8aa] font-medium flex items-center gap-1">
                    <ArrowDownToLine size={11}/> Saldo se vender a terceiros
                  </p>
                  <p className="text-lg font-bold">{formatCurrency(resumo.saldo_a_receber)}</p>
                </div>
              </div>

              {/* Cenário 2 — Venda ao próprio armazém */}
              <div className="rounded-xl border border-stone-200 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-stone-700 uppercase tracking-wide">
                    🏬 Venda ao Armazém {armazem?.apelido ? `(${armazem.apelido})` : ""}
                  </p>
                  <span className="text-[10px] text-stone-400">
                    carência {paramForm?.carencia_armazem_dias ?? "—"} dias · normativa anual
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-stone-50 p-2.5">
                    <p className="text-[10px] uppercase text-stone-500 font-medium">Quebra Técnica</p>
                    <p className="text-sm font-bold text-red-600">{fmtKg(resumo.armazem_total_quebra_kg)}</p>
                    <p className="text-[10px] text-stone-400">líquido: {fmtSc(resumo.armazem_total_sc_liquida)}</p>
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
                <div className="rounded-lg bg-gradient-to-r from-[#0f1f1c] to-[#1a3028] px-3 py-2.5 text-white flex items-center justify-between">
                  <p className="text-[10px] uppercase text-[#7ab8aa] font-medium flex items-center gap-1">
                    <ArrowDownToLine size={11}/> Saldo se vender ao armazém
                  </p>
                  <p className="text-lg font-bold">{formatCurrency(resumo.armazem_saldo_a_receber)}</p>
                </div>
              </div>
            </div>
            <p className="mt-3 text-[11px] text-stone-400">
              {resumo.qtd_depositos} DFe(s) · {fmtKg(resumo.total_kg_saldo)} em estoque
              {resumo.total_kg_baixado > 0 && ` (${fmtKg(resumo.total_kg_baixado)} já baixados)`}
              {" "}· cálculos sobre o saldo, recalculados em tempo real
              pela {"“Data Atual”"} dos parâmetros. Colunas da tabela abaixo seguem o cenário de venda a terceiros.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Gráfico de depósitos por dia */}
      {resumo.por_data_deposito.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Depósitos por Data</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={resumo.por_data_deposito} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" />
                <XAxis dataKey="data" tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
                  tickFormatter={(d) => formatDate(d)}
                />
                <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}t`}
                />
                <RTooltip
                  contentStyle={{ borderRadius: 8, border: "1px solid #e7e5e4", fontSize: 12 }}
                  formatter={(v: unknown) => fmtKg(Number(v) || 0)}
                  labelFormatter={(l: unknown) => formatDate(String(l ?? ""))}
                />
                <Bar dataKey="kg_bruto" name="Bruto" fill="#a67c20" radius={[4, 4, 0, 0]} />
                <Bar dataKey="kg_liquido" name="Líquido" fill="#3a6230" radius={[4, 4, 0, 0]} />
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
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-100">
                  {["Data","DFe","NFP","kg Bruto","kg Baixado","kg Saldo","Dias","Qz","Quebra","kg Líq","Sc Líq","Tx Armaz","Tx Devol","Total Desc","Valor Venda","Status","Ações"].map((h) => (
                    <th key={h} className="px-2 py-3 text-left text-[10px] font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={17} className="px-4 py-12 text-center text-stone-400">
                    <Loader2 size={18} className="inline-block animate-spin mr-2" /> Carregando…
                  </td></tr>
                )}
                {!loading && paged.length === 0 && (
                  <tr><td colSpan={17} className="px-4 py-12 text-center text-stone-400">
                    Sem depósitos nesta seleção — estoque zerado ou ainda não lançado.
                    Clique em &quot;Novo Depósito&quot; para registrar uma entrada.
                  </td></tr>
                )}
                {!loading && paged.map((r) => (
                  <tr key={r.id} className="border-b border-stone-50 hover:bg-stone-50 transition-colors table-row-alt">
                    <td className="px-2 py-2 text-stone-500 whitespace-nowrap">{formatDate(r.data_deposito)}</td>
                    <td className="px-2 py-2 text-stone-700 font-mono">{r.dfe_entrada ?? "—"}</td>
                    <td className="px-2 py-2 text-stone-700 font-mono">{r.nfp ?? "—"}</td>
                    <td className="px-2 py-2 text-stone-800 text-right font-medium">{Number(r.kg_bruto).toLocaleString("pt-BR")}</td>
                    <td className="px-2 py-2 text-right text-stone-400">
                      {Number(r.kg_baixado ?? 0) > 0 ? Number(r.kg_baixado).toLocaleString("pt-BR") : "—"}
                    </td>
                    <td className="px-2 py-2 text-right font-semibold text-stone-800">
                      {Number(r.kg_saldo ?? r.kg_bruto).toLocaleString("pt-BR")}
                    </td>
                    <td className="px-2 py-2 text-stone-500 text-right">{r.dias_percorridos}</td>
                    <td className="px-2 py-2 text-stone-500 text-right">{Number(r.quinzenas).toFixed(2)}</td>
                    <td className="px-2 py-2 text-red-600 text-right">{Number(r.quebra_kg_saldo ?? r.quebra_kg).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}</td>
                    <td className="px-2 py-2 text-stone-700 text-right">{Number(r.kg_liquido_saldo ?? r.kg_liquido).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}</td>
                    <td className="px-2 py-2 text-stone-700 text-right">{Number(r.sc_liquida_saldo ?? r.sc_liquida).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</td>
                    <td className="px-2 py-2 text-orange-700 text-right">{formatCurrency(Number(r.taxa_armazenagem_saldo ?? r.taxa_armazenagem))}</td>
                    <td className="px-2 py-2 text-orange-700 text-right">{formatCurrency(Number(r.taxa_devolucao_saldo ?? r.taxa_devolucao))}</td>
                    <td className="px-2 py-2 text-red-700 font-semibold text-right">{formatCurrency(Number(r.total_a_descontar_saldo ?? r.total_a_descontar))}</td>
                    <td className="px-2 py-2 text-emerald-700 font-semibold text-right">{formatCurrency(Number(r.valor_venda_saldo ?? r.valor_venda_simulado))}</td>
                    <td className="px-2 py-2"><Badge variant={statusBadge(r.status)}>{SAFRA_DEP_STATUS_LABEL[r.status]}</Badge></td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-0.5">
                        <button onClick={() => openEditDep(r)} className="p-1 rounded hover:bg-primary-50 text-stone-400 hover:text-primary-600 transition" title="Editar"><Edit2 size={12}/></button>
                        <button onClick={() => removeDep(r)} className="p-1 rounded hover:bg-red-50 text-stone-400 hover:text-red-500 transition" title="Excluir"><Trash2 size={12}/></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              {!loading && rows.length > 0 && (
                <tfoot>
                  <tr className="bg-stone-100 border-t-2 border-stone-200 font-semibold text-stone-700 text-[11px]">
                    <td colSpan={3} className="px-2 py-2.5 uppercase tracking-wide">Totais</td>
                    <td className="px-2 py-2.5 text-right">{resumo.total_kg_bruto.toLocaleString("pt-BR")}</td>
                    <td className="px-2 py-2.5 text-right text-stone-500">
                      {resumo.total_kg_baixado > 0 ? resumo.total_kg_baixado.toLocaleString("pt-BR") : "—"}
                    </td>
                    <td className="px-2 py-2.5 text-right">{resumo.total_kg_saldo.toLocaleString("pt-BR")}</td>
                    <td colSpan={2}></td>
                    <td className="px-2 py-2.5 text-red-700 text-right">{resumo.total_quebra_kg.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}</td>
                    <td className="px-2 py-2.5 text-right">{resumo.total_kg_liquido.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}</td>
                    <td className="px-2 py-2.5 text-right">{resumo.total_sc_liquida.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</td>
                    <td className="px-2 py-2.5 text-orange-700 text-right">{formatCurrency(resumo.total_taxa_armazenagem)}</td>
                    <td className="px-2 py-2.5 text-orange-700 text-right">{formatCurrency(resumo.total_taxa_devolucao)}</td>
                    <td className="px-2 py-2.5 text-red-700 text-right">{formatCurrency(resumo.total_a_descontar)}</td>
                    <td className="px-2 py-2.5 text-emerald-700 text-right">{formatCurrency(resumo.total_valor_venda)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-t border-stone-100">
            <p className="text-xs text-stone-400">
              {loading ? "…" : `${rows.length} depósito${rows.length === 1 ? "" : "s"}`}
            </p>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </CardContent>
      </Card>

      {/* Modal Depósito */}
      <Modal open={depModal} onClose={depGuard.requestClose}
        title={depEditId ? "Editar Depósito" : "Novo Depósito"} size="lg">
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Select label="Cultura *" value={depForm.cultura}
              onChange={(e) => setDepForm({ ...depForm, cultura: e.target.value as CulturaSafra })}>
              {(Object.keys(CULTURA_LABEL) as CulturaSafra[]).map((c) =>
                <option key={c} value={c}>{CULTURA_EMOJI[c]} {CULTURA_LABEL[c]}</option>)}
            </Select>
            <Input label="Safra *" placeholder="25/25" value={depForm.safra}
              onChange={(e) => setDepForm({ ...depForm, safra: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input label="Data Depósito *" type="date" value={depForm.data_deposito}
              onChange={(e) => setDepForm({ ...depForm, data_deposito: e.target.value })} />
            <Input label="DFe (entrada)" placeholder="54383" value={depForm.dfe_entrada}
              onChange={(e) => setDepForm({ ...depForm, dfe_entrada: e.target.value })} />
            <Input label="NFP" placeholder="8285721" value={depForm.nfp}
              onChange={(e) => setDepForm({ ...depForm, nfp: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Quantidade (kg bruto) *" type="number" step="0.001"
              value={depForm.kg_bruto} onChange={(e) => setDepForm({ ...depForm, kg_bruto: e.target.value })} />
            <Select label="Status" value={depForm.status}
              onChange={(e) => setDepForm({ ...depForm, status: e.target.value as SafraDepositoStatus })}>
              {(Object.keys(SAFRA_DEP_STATUS_LABEL) as SafraDepositoStatus[]).map((s) =>
                <option key={s} value={s}>{SAFRA_DEP_STATUS_LABEL[s]}</option>)}
            </Select>
          </div>
          <Textarea label="Observação" rows={2} value={depForm.observacao}
            onChange={(e) => setDepForm({ ...depForm, observacao: e.target.value })} />
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={depGuard.requestClose}>Cancelar</Button>
            <Button onClick={saveDep} loading={depSaving} disabled={depSaving}>
              {depEditId ? "Salvar Alterações" : "Adicionar"}
            </Button>
          </div>
        </div>
      </Modal>
      <UnsavedChangesDialog open={depGuard.confirmOpen} onStay={depGuard.stay} onDiscard={depGuard.discard} />
    </div>
  );
}
