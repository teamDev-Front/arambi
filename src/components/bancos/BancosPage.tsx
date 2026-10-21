"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { KpiCard } from "@/components/ui/KpiCard";
import { Modal } from "@/components/ui/Modal";
import { Input, Select } from "@/components/ui/Input";
import { Pagination } from "@/components/ui/Pagination";
import { Tooltip } from "@/components/ui/Tooltip";
import { useToast } from "@/components/ui/Toast";
import { UnsavedChangesDialog } from "@/components/ui/UnsavedChangesDialog";
import { useUnsavedGuard } from "@/lib/hooks/useUnsavedGuard";
import { useModulo } from "@/components/acessos/PermissoesProvider";
import {
  Plus, Search, Edit2, Trash2, Loader2, Building2, Users,
  Landmark, AlertTriangle, CheckCircle2, HelpCircle, Eye,
} from "lucide-react";
import {
  listarContasEmpresa, criarContaEmpresa, atualizarContaEmpresa, deletarContaEmpresa,
  listarContasSocios, criarContaSocio, atualizarContaSocio, deletarContaSocio,
  listarSocios, MAX_CONTAS_POR_SOCIO,
  type ContaBancariaSocioRich,
} from "@/lib/queries/bancos";
import type {
  ContaBancariaEmpresaRow, SocioRow, Database,
} from "@/types";

type Tab = "empresa" | "socio";
const PAGE_SIZE = 10;

const TIPO_OPTIONS = ["corrente", "poupanca", "investimento"] as const;
const TIPO_LABEL: Record<(typeof TIPO_OPTIONS)[number], string> = {
  corrente: "Conta Corrente",
  poupanca: "Poupança",
  investimento: "Investimento",
};

type CbeForm = {
  nome: string;
  apelido: string;
  banco: string;
  numero_banco: string;
  tipo_instituicao: string;
  agencia: string;
  numero_conta: string;
  digito: string;
  tipo: string;
  ativa: boolean;
  ordem: string;
};

const EMPTY_EMPRESA: CbeForm = {
  nome: "", apelido: "", banco: "", numero_banco: "", tipo_instituicao: "banco",
  agencia: "", numero_conta: "", digito: "", tipo: "corrente",
  ativa: true, ordem: "",
};

type CbsForm = {
  socio_id: string;
  nome: string;
  banco: string;
  agencia: string;
  numero_conta: string;
  digito: string;
  tipo: string;
  email_chave: string;
  ativa: boolean;
  ordem: string;
};

const EMPTY_SOCIO: CbsForm = {
  socio_id: "", nome: "", banco: "", agencia: "",
  numero_conta: "", digito: "", tipo: "corrente",
  email_chave: "", ativa: true, ordem: "",
};

export function BancosPage() {
  const toast = useToast();
  // Modo leitura (Acessos): sem criar/editar/excluir — o modal abre só como detalhes.
  const { podeEditar } = useModulo("bancos");
  const [tab, setTab] = useState<Tab>("empresa");

  // ------- empresa -------
  const [empresaRows, setEmpresaRows] = useState<ContaBancariaEmpresaRow[]>([]);
  const [empLoading, setEmpLoading] = useState(true);
  const [empSearch, setEmpSearch] = useState("");
  const [empPage, setEmpPage] = useState(1);
  const [empModalOpen, setEmpModalOpen] = useState(false);
  const [empEditId, setEmpEditId] = useState<string | null>(null);
  const [empForm, setEmpForm] = useState<CbeForm>(EMPTY_EMPRESA);
  const empGuard = useUnsavedGuard(empModalOpen, empForm, () => setEmpModalOpen(false));
  const [empSaving, setEmpSaving] = useState(false);

  // ------- socio -------
  const [socios, setSocios] = useState<SocioRow[]>([]);
  const [socioFiltro, setSocioFiltro] = useState<string>("");
  const [socioRows, setSocioRows] = useState<ContaBancariaSocioRich[]>([]);
  const [socioLoading, setSocioLoading] = useState(true);
  const [socioSearch, setSocioSearch] = useState("");
  const [socioPage, setSocioPage] = useState(1);
  const [socioModalOpen, setSocioModalOpen] = useState(false);
  const [socioEditId, setSocioEditId] = useState<string | null>(null);
  const [socioForm, setSocioForm] = useState<CbsForm>(EMPTY_SOCIO);
  const socioGuard = useUnsavedGuard(socioModalOpen, socioForm, () => setSocioModalOpen(false));
  const [socioSaving, setSocioSaving] = useState(false);

  // ---- carregar empresa ----
  const fetchEmpresa = useCallback(async () => {
    setEmpLoading(true);
    try {
      const rows = await listarContasEmpresa();
      setEmpresaRows(rows);
    } catch (e: unknown) {
      toast.error("Erro carregando contas da empresa", (e as Error).message);
    } finally {
      setEmpLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- carregar sócios + contas ----
  const fetchSocios = useCallback(async () => {
    try {
      const data = await listarSocios();
      setSocios(data);
    } catch (e: unknown) {
      toast.error("Erro carregando sócios", (e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchContasSocio = useCallback(async () => {
    setSocioLoading(true);
    try {
      const rows = await listarContasSocios(socioFiltro || undefined);
      setSocioRows(rows);
    } catch (e: unknown) {
      toast.error("Erro carregando contas dos sócios", (e as Error).message);
    } finally {
      setSocioLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socioFiltro]);

  useEffect(() => { fetchEmpresa(); fetchSocios(); }, [fetchEmpresa, fetchSocios]);
  useEffect(() => { fetchContasSocio(); }, [fetchContasSocio]);

  // ---- contagem de contas ativas por sócio (limite 5) ----
  const contagemPorSocio = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of socioRows) {
      if (!c.ativa) continue;
      map.set(c.socio_id, (map.get(c.socio_id) ?? 0) + 1);
    }
    return map;
  }, [socioRows]);

  // ---- filtragens em memória ----
  const empFiltered = useMemo(() => {
    const s = empSearch.trim().toLowerCase();
    if (!s) return empresaRows;
    return empresaRows.filter((c) =>
      [c.nome, c.apelido, c.banco, c.agencia, c.numero_conta]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s))
    );
  }, [empresaRows, empSearch]);

  const empTotalPages = Math.max(1, Math.ceil(empFiltered.length / PAGE_SIZE));
  const empPaged = empFiltered.slice((empPage - 1) * PAGE_SIZE, empPage * PAGE_SIZE);

  const socioFiltered = useMemo(() => {
    const s = socioSearch.trim().toLowerCase();
    if (!s) return socioRows;
    return socioRows.filter((c) =>
      [c.nome, c.banco, c.agencia, c.numero_conta, c.socio?.nome_completo]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s))
    );
  }, [socioRows, socioSearch]);

  const socioTotalPages = Math.max(1, Math.ceil(socioFiltered.length / PAGE_SIZE));
  const socioPaged = socioFiltered.slice((socioPage - 1) * PAGE_SIZE, socioPage * PAGE_SIZE);

  // ------------------------------------------------------------------
  // Empresa — handlers
  // ------------------------------------------------------------------
  function openNovaEmpresa() {
    if (!podeEditar) return;
    setEmpEditId(null);
    setEmpForm({ ...EMPTY_EMPRESA });
    setEmpModalOpen(true);
  }
  function openEditEmpresa(c: ContaBancariaEmpresaRow) {
    setEmpEditId(c.id);
    setEmpForm({
      nome: c.nome,
      apelido: c.apelido ?? "",
      banco: c.banco ?? "",
      numero_banco: c.numero_banco ?? "",
      tipo_instituicao: c.tipo_instituicao ?? "banco",
      agencia: c.agencia ?? "",
      numero_conta: c.numero_conta ?? "",
      digito: c.digito ?? "",
      tipo: c.tipo ?? "corrente",
      ativa: c.ativa,
      ordem: c.ordem !== null ? String(c.ordem) : "",
    });
    setEmpModalOpen(true);
  }
  async function saveEmpresa() {
    if (!podeEditar) return;
    if (!empForm.nome.trim()) {
      toast.warning("Nome obrigatório", "Preencha o nome da conta (ex: 'Banco Cora (0001)')");
      return;
    }
    setEmpSaving(true);
    type Payload = Database["public"]["Tables"]["contas_bancarias_empresa"]["Insert"];
    const payload: Payload = {
      nome: empForm.nome.trim(),
      apelido: empForm.apelido.trim() || null,
      banco: empForm.banco.trim() || null,
      numero_banco: empForm.numero_banco.trim() || null,
      tipo_instituicao: empForm.tipo_instituicao || "banco",
      agencia: empForm.agencia.trim() || null,
      numero_conta: empForm.numero_conta.trim() || null,
      digito: empForm.digito.trim() || null,
      tipo: empForm.tipo || null,
      conta: null,
      ativa: empForm.ativa,
      ordem: empForm.ordem === "" ? null : Number(empForm.ordem),
    };
    try {
      if (empEditId) {
        await atualizarContaEmpresa(empEditId, payload);
        toast.success("Conta atualizada");
      } else {
        await criarContaEmpresa(payload);
        toast.success("Conta criada");
      }
      setEmpModalOpen(false);
      await fetchEmpresa();
    } catch (e: unknown) {
      toast.error("Não foi possível salvar", (e as Error).message);
    } finally {
      setEmpSaving(false);
    }
  }
  async function removeEmpresa(c: ContaBancariaEmpresaRow) {
    if (!podeEditar) return;
    if (!confirm(`Excluir a conta "${c.nome}"?\nLançamentos relacionados ficarão sem banco vinculado.`)) return;
    try {
      await deletarContaEmpresa(c.id);
      toast.success("Conta excluída");
      await fetchEmpresa();
    } catch (e: unknown) {
      toast.error("Não foi possível excluir", (e as Error).message);
    }
  }

  // ------------------------------------------------------------------
  // Sócio — handlers
  // ------------------------------------------------------------------
  function openNovaSocio() {
    if (!podeEditar) return;
    if (socios.length === 0) {
      toast.warning("Cadastre sócios antes", "Não há sócios ativos no banco de dados.");
      return;
    }
    setSocioEditId(null);
    setSocioForm({ ...EMPTY_SOCIO, socio_id: socioFiltro || socios[0].id });
    setSocioModalOpen(true);
  }
  function openEditSocio(c: ContaBancariaSocioRich) {
    setSocioEditId(c.id);
    setSocioForm({
      socio_id: c.socio_id,
      nome: c.nome,
      banco: c.banco ?? "",
      agencia: c.agencia ?? "",
      numero_conta: c.numero_conta ?? "",
      digito: c.digito ?? "",
      tipo: c.tipo ?? "corrente",
      email_chave: c.email_chave ?? "",
      ativa: c.ativa,
      ordem: c.ordem !== null ? String(c.ordem) : "",
    });
    setSocioModalOpen(true);
  }
  async function saveSocio() {
    if (!podeEditar) return;
    if (!socioForm.socio_id || !socioForm.nome.trim()) {
      toast.warning("Campos obrigatórios", "Selecione o sócio e preencha o nome da conta.");
      return;
    }
    setSocioSaving(true);
    type Payload = Database["public"]["Tables"]["contas_bancarias_socio"]["Insert"];
    const payload: Payload = {
      socio_id: socioForm.socio_id,
      nome: socioForm.nome.trim(),
      banco: socioForm.banco.trim() || null,
      agencia: socioForm.agencia.trim() || null,
      numero_conta: socioForm.numero_conta.trim() || null,
      digito: socioForm.digito.trim() || null,
      tipo: socioForm.tipo || null,
      email_chave: socioForm.email_chave.trim() || null,
      conta: null,
      ativa: socioForm.ativa,
      ordem: socioForm.ordem === "" ? null : Number(socioForm.ordem),
    };
    try {
      if (socioEditId) {
        await atualizarContaSocio(socioEditId, payload);
        toast.success("Conta atualizada");
      } else {
        await criarContaSocio(payload);
        toast.success("Conta criada");
      }
      setSocioModalOpen(false);
      await fetchContasSocio();
    } catch (e: unknown) {
      toast.error("Não foi possível salvar", (e as Error).message);
    } finally {
      setSocioSaving(false);
    }
  }
  async function removeSocio(c: ContaBancariaSocioRich) {
    if (!podeEditar) return;
    if (!confirm(`Excluir a conta "${c.nome}" do sócio ${c.socio?.nome_completo ?? "?"}?`)) return;
    try {
      await deletarContaSocio(c.id);
      toast.success("Conta excluída");
      await fetchContasSocio();
    } catch (e: unknown) {
      toast.error("Não foi possível excluir", (e as Error).message);
    }
  }

  // KPIs do header
  const totalEmpresaAtivas = empresaRows.filter((c) => c.ativa).length;
  const totalSociosCadastrados = new Set(socioRows.map((c) => c.socio_id)).size;
  const totalSociosNoLimite = Array.from(contagemPorSocio.entries()).filter(([, n]) => n >= MAX_CONTAS_POR_SOCIO).length;
  const totalContasSocio = socioRows.filter((c) => c.ativa).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#0f1f1c]">Bancos</h1>
          <p className="text-sm text-stone-500">
            Cadastro de instituições financeiras — empresa Aramburu e sócios
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Contas da empresa"
          value={String(totalEmpresaAtivas)}
          icon={<Landmark size={16} />}
          helpText="Contas bancárias ativas vinculadas à Agropecuária Aramburu Ltda."
        />
        <KpiCard
          label="Sócios com conta"
          value={String(totalSociosCadastrados)}
          icon={<Users size={16} />}
          helpText="Quantos sócios já possuem ao menos uma conta cadastrada."
        />
        <KpiCard
          label="Contas pessoais ativas"
          value={String(totalContasSocio)}
          icon={<Building2 size={16} />}
          helpText={`Cada sócio pode ter no máximo ${MAX_CONTAS_POR_SOCIO} contas ativas.`}
        />
        <KpiCard
          label="No limite (≥ 5)"
          value={String(totalSociosNoLimite)}
          trend={totalSociosNoLimite > 0 ? "down" : "neutral"}
          icon={<AlertTriangle size={16} />}
          helpText="Sócios que atingiram o limite de 5 contas ativas (cadastro novo bloqueado até inativar uma)."
        />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-stone-200">
        <button
          onClick={() => setTab("empresa")}
          className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 ${
            tab === "empresa"
              ? "border-[#a67c20] text-[#0f1f1c]"
              : "border-transparent text-stone-500 hover:text-stone-700"
          }`}
        >
          <span className="inline-flex items-center gap-2">
            <Landmark size={14} /> Empresa Aramburu
          </span>
        </button>
        <button
          onClick={() => setTab("socio")}
          className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 ${
            tab === "socio"
              ? "border-[#a67c20] text-[#0f1f1c]"
              : "border-transparent text-stone-500 hover:text-stone-700"
          }`}
        >
          <span className="inline-flex items-center gap-2">
            <Users size={14} /> Contas dos Sócios
          </span>
        </button>
      </div>

      {/* ----------- TAB EMPRESA ----------- */}
      {tab === "empresa" && (
        <Card>
          <CardHeader className="flex-col items-start gap-3 lg:flex-row lg:items-center">
            <CardTitle>Contas Bancárias — Empresa</CardTitle>
            <div className="flex items-center gap-2 flex-wrap ml-auto">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                <input
                  value={empSearch}
                  onChange={(e) => { setEmpSearch(e.target.value); setEmpPage(1); }}
                  placeholder="Buscar conta, agência, banco..."
                  className="h-8 rounded-lg border border-stone-200 pl-8 pr-3 text-xs w-64 focus:outline-none focus:ring-1 focus:ring-accent-400"
                />
              </div>
              {podeEditar && (
                <Button size="sm" onClick={openNovaEmpresa}>
                  <Plus size={14} /> Nova Conta
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-100">
                    {["Nome / Apelido", "Banco", "Agência", "Conta", "Tipo", "Status", "Ações"].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {empLoading && (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-stone-400">
                      <Loader2 size={18} className="inline-block animate-spin mr-2" /> Carregando…
                    </td></tr>
                  )}
                  {!empLoading && empPaged.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-stone-400">
                      Nenhuma conta encontrada.
                    </td></tr>
                  )}
                  {!empLoading && empPaged.map((c) => (
                    <tr key={c.id} className="border-b border-stone-50 hover:bg-stone-50 transition-colors table-row-alt">
                      <td className="px-4 py-3">
                        <div className="font-medium text-stone-800">{c.nome}</div>
                        {c.apelido && <div className="text-stone-400 text-xs">{c.apelido}</div>}
                      </td>
                      <td className="px-4 py-3 text-stone-700 text-xs">{c.banco ?? <span className="text-stone-300">—</span>}</td>
                      <td className="px-4 py-3 text-stone-700 text-xs font-mono">{c.agencia ?? <span className="text-stone-300">—</span>}</td>
                      <td className="px-4 py-3 text-stone-700 text-xs font-mono">
                        {c.numero_conta
                          ? `${c.numero_conta}${c.digito ? "-" + c.digito : ""}`
                          : <span className="text-stone-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-stone-700 text-xs capitalize">{c.tipo ?? "—"}</td>
                      <td className="px-4 py-3">
                        <Badge variant={c.ativa ? "success" : "neutral"}>
                          <span className="flex items-center gap-1">
                            {c.ativa ? <CheckCircle2 size={11}/> : null}
                            {c.ativa ? "Ativa" : "Inativa"}
                          </span>
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEditEmpresa(c)} className="p-1.5 rounded hover:bg-primary-50 text-stone-400 hover:text-primary-600 transition" title={podeEditar ? "Editar" : "Ver detalhes"}>
                            {podeEditar ? <Edit2 size={13}/> : <Eye size={13}/>}
                          </button>
                          {podeEditar && (
                            <button onClick={() => removeEmpresa(c)} className="p-1.5 rounded hover:bg-red-50 text-stone-400 hover:text-red-500 transition" title="Excluir">
                              <Trash2 size={13}/>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-t border-stone-100">
              <p className="text-xs text-stone-400">
                {empLoading ? "…" : `${empFiltered.length} conta${empFiltered.length === 1 ? "" : "s"}`}
              </p>
              <Pagination page={empPage} totalPages={empTotalPages} onPageChange={setEmpPage} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ----------- TAB SOCIO ----------- */}
      {tab === "socio" && (
        <>
          {/* Painel de contagem por sócio */}
          <Card>
            <CardHeader>
              <CardTitle>
                Contas por sócio
                <Tooltip text={`Cada sócio pode ter no máximo ${MAX_CONTAS_POR_SOCIO} contas ativas. Inativar uma libera espaço.`} position="bottom">
                  <HelpCircle size={12} className="inline-block ml-1 text-stone-300" />
                </Tooltip>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {socios.map((s) => {
                  const usadas = contagemPorSocio.get(s.id) ?? 0;
                  const pct = (usadas / MAX_CONTAS_POR_SOCIO) * 100;
                  const cor = usadas >= MAX_CONTAS_POR_SOCIO ? "bg-red-500" : usadas >= 4 ? "bg-amber-500" : "bg-emerald-500";
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSocioFiltro(socioFiltro === s.id ? "" : s.id)}
                      className={`text-left rounded-xl border p-4 transition-all ${
                        socioFiltro === s.id
                          ? "border-[#a67c20] shadow-md bg-[#fdf8ee]"
                          : "border-stone-200 hover:border-stone-300 bg-white"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="font-medium text-sm text-stone-800 truncate">{s.apelido ?? s.nome_completo}</div>
                        <span className="text-xs font-bold text-stone-600 shrink-0">
                          {usadas}/{MAX_CONTAS_POR_SOCIO}
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-stone-100 rounded-full overflow-hidden">
                        <div className={`h-full ${cor} transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-col items-start gap-3 lg:flex-row lg:items-center">
              <CardTitle>
                Contas Bancárias — Sócios
                {socioFiltro && (
                  <button onClick={() => setSocioFiltro("")} className="text-xs ml-2 text-[#a67c20] hover:underline">
                    (limpar filtro)
                  </button>
                )}
              </CardTitle>
              <div className="flex items-center gap-2 flex-wrap ml-auto">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                  <input
                    value={socioSearch}
                    onChange={(e) => { setSocioSearch(e.target.value); setSocioPage(1); }}
                    placeholder="Buscar conta, banco, sócio..."
                    className="h-8 rounded-lg border border-stone-200 pl-8 pr-3 text-xs w-64 focus:outline-none focus:ring-1 focus:ring-accent-400"
                  />
                </div>
                <select
                  value={socioFiltro}
                  onChange={(e) => { setSocioFiltro(e.target.value); setSocioPage(1); }}
                  className="h-8 rounded-lg border border-stone-200 px-2 text-xs"
                >
                  <option value="">Todos os sócios</option>
                  {socios.map((s) => (
                    <option key={s.id} value={s.id}>{s.apelido ?? s.nome_completo}</option>
                  ))}
                </select>
                {podeEditar && (
                  <Button size="sm" onClick={openNovaSocio}>
                    <Plus size={14} /> Nova Conta
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-stone-50 border-b border-stone-100">
                      {["Sócio", "Nome da Conta", "Banco", "Agência", "Conta", "Tipo", "Status", "Ações"].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {socioLoading && (
                      <tr><td colSpan={8} className="px-4 py-12 text-center text-stone-400">
                        <Loader2 size={18} className="inline-block animate-spin mr-2" /> Carregando…
                      </td></tr>
                    )}
                    {!socioLoading && socioPaged.length === 0 && (
                      <tr><td colSpan={8} className="px-4 py-12 text-center text-stone-400">
                        Nenhuma conta encontrada.
                      </td></tr>
                    )}
                    {!socioLoading && socioPaged.map((c) => (
                      <tr key={c.id} className="border-b border-stone-50 hover:bg-stone-50 transition-colors table-row-alt">
                        <td className="px-4 py-3 text-stone-700 text-xs">
                          {c.socio?.apelido ?? c.socio?.nome_completo}
                        </td>
                        <td className="px-4 py-3 font-medium text-stone-800 max-w-[260px] truncate" title={c.nome}>{c.nome}</td>
                        <td className="px-4 py-3 text-stone-700 text-xs">{c.banco ?? <span className="text-stone-300">—</span>}</td>
                        <td className="px-4 py-3 text-stone-700 text-xs font-mono">{c.agencia ?? <span className="text-stone-300">—</span>}</td>
                        <td className="px-4 py-3 text-stone-700 text-xs font-mono">
                          {c.numero_conta
                            ? `${c.numero_conta}${c.digito ? "-" + c.digito : ""}`
                            : c.email_chave
                              ? <span className="text-stone-400 italic" title="Chave PIX por email">{c.email_chave}</span>
                              : <span className="text-stone-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-stone-700 text-xs capitalize">{c.tipo ?? "—"}</td>
                        <td className="px-4 py-3">
                          <Badge variant={c.ativa ? "success" : "neutral" as BadgeVariant}>
                            {c.ativa ? "Ativa" : "Inativa"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button onClick={() => openEditSocio(c)} className="p-1.5 rounded hover:bg-primary-50 text-stone-400 hover:text-primary-600 transition" title={podeEditar ? "Editar" : "Ver detalhes"}>
                              {podeEditar ? <Edit2 size={13}/> : <Eye size={13}/>}
                            </button>
                            {podeEditar && (
                              <button onClick={() => removeSocio(c)} className="p-1.5 rounded hover:bg-red-50 text-stone-400 hover:text-red-500 transition" title="Excluir">
                                <Trash2 size={13}/>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between px-4 py-3 border-t border-stone-100">
                <p className="text-xs text-stone-400">
                  {socioLoading ? "…" : `${socioFiltered.length} conta${socioFiltered.length === 1 ? "" : "s"}`}
                </p>
                <Pagination page={socioPage} totalPages={socioTotalPages} onPageChange={setSocioPage} />
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Modal — Empresa */}
      <Modal
        open={empModalOpen}
        onClose={empGuard.requestClose}
        title={!podeEditar ? "Detalhes da Conta da Empresa" : empEditId ? "Editar Conta da Empresa" : "Nova Conta da Empresa"}
        size="lg"
      >
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Nome da Conta *"
              placeholder="Ex: Banco Cora (0001)"
              value={empForm.nome}
              readOnly={!podeEditar}
              onChange={(e) => setEmpForm({ ...empForm, nome: e.target.value })}
            />
            <Input
              label="Apelido"
              placeholder="Ex: Cora"
              value={empForm.apelido}
              readOnly={!podeEditar}
              onChange={(e) => setEmpForm({ ...empForm, apelido: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input
              label="Banco / Instituição"
              placeholder="Ex: Banco Cora"
              value={empForm.banco}
              readOnly={!podeEditar}
              onChange={(e) => setEmpForm({ ...empForm, banco: e.target.value })}
            />
            <Input
              label="Agência"
              placeholder="0001"
              value={empForm.agencia}
              readOnly={!podeEditar}
              onChange={(e) => setEmpForm({ ...empForm, agencia: e.target.value })}
            />
            <Select
              label="Tipo"
              value={empForm.tipo}
              disabled={!podeEditar}
              onChange={(e) => setEmpForm({ ...empForm, tipo: e.target.value })}
            >
              {TIPO_OPTIONS.map((t) => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Tipo de instituição"
              value={empForm.tipo_instituicao}
              disabled={!podeEditar}
              onChange={(e) => setEmpForm({ ...empForm, tipo_instituicao: e.target.value })}
            >
              <option value="banco">Banco</option>
              <option value="cooperativa">Cooperativa</option>
            </Select>
            <Input
              label="Nº do Banco (BACEN)"
              placeholder="403 / 748 / 077 / 348"
              value={empForm.numero_banco}
              readOnly={!podeEditar}
              onChange={(e) => setEmpForm({ ...empForm, numero_banco: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input
              label="Número da Conta"
              placeholder="123456"
              value={empForm.numero_conta}
              readOnly={!podeEditar}
              onChange={(e) => setEmpForm({ ...empForm, numero_conta: e.target.value })}
            />
            <Input
              label="Dígito"
              placeholder="7"
              value={empForm.digito}
              readOnly={!podeEditar}
              onChange={(e) => setEmpForm({ ...empForm, digito: e.target.value })}
            />
            <Input
              label="Ordem (exibição)"
              type="number"
              value={empForm.ordem}
              readOnly={!podeEditar}
              onChange={(e) => setEmpForm({ ...empForm, ordem: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={empForm.ativa}
              disabled={!podeEditar}
              onChange={(e) => setEmpForm({ ...empForm, ativa: e.target.checked })}
              className="w-4 h-4 rounded text-[#a67c20] focus:ring-[#a67c20]"
            />
            <span className="text-sm text-stone-700">Conta ativa</span>
          </label>

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={empGuard.requestClose}>{podeEditar ? "Cancelar" : "Fechar"}</Button>
            {podeEditar && (
              <Button onClick={saveEmpresa} loading={empSaving} disabled={empSaving}>
                {empEditId ? "Salvar Alterações" : "Adicionar"}
              </Button>
            )}
          </div>
        </div>
      </Modal>

      {/* Modal — Sócio */}
      <Modal
        open={socioModalOpen}
        onClose={socioGuard.requestClose}
        title={!podeEditar ? "Detalhes da Conta do Sócio" : socioEditId ? "Editar Conta do Sócio" : "Nova Conta do Sócio"}
        size="lg"
      >
        <div className="p-6 space-y-4">
          <Select
            label="Sócio *"
            value={socioForm.socio_id}
            onChange={(e) => setSocioForm({ ...socioForm, socio_id: e.target.value })}
            disabled={!podeEditar || !!socioEditId}
          >
            <option value="">Selecione…</option>
            {socios.map((s) => {
              const c = contagemPorSocio.get(s.id) ?? 0;
              const cheio = c >= MAX_CONTAS_POR_SOCIO && !socioEditId;
              return (
                <option key={s.id} value={s.id} disabled={cheio}>
                  {s.apelido ?? s.nome_completo} ({c}/{MAX_CONTAS_POR_SOCIO}){cheio ? " — limite atingido" : ""}
                </option>
              );
            })}
          </Select>

          <Input
            label="Nome da Conta *"
            placeholder="Ex: Bradesco 3489 C/C 3154-2"
            value={socioForm.nome}
            readOnly={!podeEditar}
            onChange={(e) => setSocioForm({ ...socioForm, nome: e.target.value })}
          />

          <div className="grid grid-cols-3 gap-3">
            <Input
              label="Banco"
              placeholder="Bradesco, Inter, Nubank…"
              value={socioForm.banco}
              readOnly={!podeEditar}
              onChange={(e) => setSocioForm({ ...socioForm, banco: e.target.value })}
            />
            <Input
              label="Agência"
              placeholder="3489"
              value={socioForm.agencia}
              readOnly={!podeEditar}
              onChange={(e) => setSocioForm({ ...socioForm, agencia: e.target.value })}
            />
            <Select
              label="Tipo"
              value={socioForm.tipo}
              disabled={!podeEditar}
              onChange={(e) => setSocioForm({ ...socioForm, tipo: e.target.value })}
            >
              {TIPO_OPTIONS.map((t) => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Input
              label="Número da Conta"
              placeholder="3154"
              value={socioForm.numero_conta}
              readOnly={!podeEditar}
              onChange={(e) => setSocioForm({ ...socioForm, numero_conta: e.target.value })}
            />
            <Input
              label="Dígito"
              placeholder="2"
              value={socioForm.digito}
              readOnly={!podeEditar}
              onChange={(e) => setSocioForm({ ...socioForm, digito: e.target.value })}
            />
            <Input
              label="Ordem"
              type="number"
              value={socioForm.ordem}
              readOnly={!podeEditar}
              onChange={(e) => setSocioForm({ ...socioForm, ordem: e.target.value })}
            />
          </div>

          <Input
            label="Chave PIX por email (opcional)"
            placeholder="email@dominio.com"
            value={socioForm.email_chave}
            readOnly={!podeEditar}
            onChange={(e) => setSocioForm({ ...socioForm, email_chave: e.target.value })}
          />

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={socioForm.ativa}
              disabled={!podeEditar}
              onChange={(e) => setSocioForm({ ...socioForm, ativa: e.target.checked })}
              className="w-4 h-4 rounded text-[#a67c20] focus:ring-[#a67c20]"
            />
            <span className="text-sm text-stone-700">Conta ativa</span>
          </label>

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={socioGuard.requestClose}>{podeEditar ? "Cancelar" : "Fechar"}</Button>
            {podeEditar && (
              <Button onClick={saveSocio} loading={socioSaving} disabled={socioSaving}>
                {socioEditId ? "Salvar Alterações" : "Adicionar"}
              </Button>
            )}
          </div>
        </div>
      </Modal>
      <UnsavedChangesDialog open={empGuard.confirmOpen} onStay={empGuard.stay} onDiscard={empGuard.discard} />
      <UnsavedChangesDialog open={socioGuard.confirmOpen} onStay={socioGuard.stay} onDiscard={socioGuard.discard} />
    </div>
  );
}
