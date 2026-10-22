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
import { useModulo } from "@/components/acessos/PermissoesProvider";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from "recharts";
import {
  Plus, Search, Edit2, Trash2, Loader2, Sprout,
  Wallet, CalendarClock, ArrowDownToLine, HandCoins, PackageCheck,
  Link2, Eye, FileDown,
} from "lucide-react";
import { MultiSelect } from "@/components/ui/MultiSelect";
import { CompetenciaMultiSelect } from "@/components/ui/CompetenciaMultiSelect";
import {
  listarVendas, criarVenda, atualizarVenda, deletarVenda, calcularResumo,
  atualizarStatusVendasEmMassa, deletarVendasEmMassa,
  type ListarVendasFiltros,
} from "@/lib/queries/vendas";
import { desfazerCriacao, desfazerEdicao, desfazerExclusao } from "@/lib/queries/desfazer";
import {
  baixarEstoqueFifo, desfazerBaixasVenda, obterSaldoEstoque,
  listarKgBaixadoPorVenda, type SaldoEstoque,
} from "@/lib/queries/safra";
import { listarSocios } from "@/lib/queries/bancos";
import {
  criarTransacaoEmpresa, listarClassificacoes, listarContasEmpresa,
  listarFornecedores, garantirFornecedor,
} from "@/lib/queries/financeiro";
import { criarDetalhado, listarClassificacoesPessoais } from "@/lib/queries/distribuicao";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { exportVendasPdf, exportVendasXlsx, mesHumano } from "@/lib/export/vendas-export";
import { getNomeUsuarioAtual, linhaEmissao } from "@/lib/auth/usuario-atual";
import { CamposExportVendasModal, type CamposExportVendasEscolha } from "./CamposExportVendasModal";
import {
  CULTURA_LABEL, CULTURA_EMOJI, VENDA_STATUS_LABEL,
  type VendaProvisionadaRichRow, type SocioRow,
  type CulturaSafra, type VendaStatus, type Database,
  type ClassificacaoFinanceiraRow, type ContaBancariaEmpresaRow, type FornecedorRow,
  type TransacaoEmpresaInsert, type TransacaoSocioInsert, type ClassificacaoPessoalRow,
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
  // Taxa de Armazenagem — data de pagamento / ND / banco (ajuste 27-jul)
  taxa_data_pgto: string;
  taxa_nd: string;
  taxa_banco_id: string;
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
  taxa_data_pgto: "",
  taxa_nd: "",
  taxa_banco_id: "",
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
  // Modo leitura (Acessos): sem criar/editar/excluir — a seleção fica só para a soma.
  const { podeEditar } = useModulo("vendas");

  const [rows, setRows] = useState<VendaProvisionadaRichRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [socios, setSocios] = useState<SocioRow[]>([]);

  // filtros
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<VendaStatus | "">("");
  const [filterCultura, setFilterCultura] = useState<CulturaSafra | "">("");
  const [filterSafra, setFilterSafra] = useState("");
  const [filterDestino, setFilterDestino] = useState<"empresa" | "socio" | "">("");
  // Competência (mês do recebimento previsto) — multi-seleção no header, mesmo
  // padrão do Financeiro e da Distribuição, com "Todas" (17-ago). Substitui o
  // antigo seletor "Todos meses" de escolha única que ficava entre os filtros.
  const [filterCompetencias, setFilterCompetencias] = useState<string[]>([]);
  // Exercício (anual) — multi-seleção para análise/soma/comparação (ajuste 27-jul).
  const [filterExercicios, setFilterExercicios] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  // Venda como estava ao abrir a edição — base do "Desfazer" (RF 31-jul).
  const [editSnapshot, setEditSnapshot] = useState<VendaProvisionadaRichRow | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const guard = useUnsavedGuard(modalOpen, form, () => setModalOpen(false));
  const [saving, setSaving] = useState(false);

  // Baixa de estoque por volume (FIFO — migration 0043)
  const [baixarEstoque, setBaixarEstoque] = useState(true);
  const [saldoEstoque, setSaldoEstoque] = useState<SaldoEstoque | null>(null);
  const [kgBaixadoPorVenda, setKgBaixadoPorVenda] = useState<Map<string, number>>(new Map());
  // Baixa vinculada da venda em edição — para permitir marcar/desmarcar na edição (27-jul).
  const [editTinhaBaixa, setEditTinhaBaixa] = useState(false);

  // ---- seleção múltipla (ajuste 27-jul) ----
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);

  // ---- integração com o Financeiro (ajuste 27-jul) ----
  // Gerar o "valor a receber" (qualquer destino), a DL provisionada (sócio) e a
  // despesa da Taxa de Armazenagem no momento do cadastro — com opção de NÃO
  // gerar (caso o lançamento já exista no Financeiro, evitando duplicidade).
  const [gerarFinanceiro, setGerarFinanceiro] = useState(true);
  const [gerarDL, setGerarDL] = useState(true);
  const [gerarTaxaDespesa, setGerarTaxaDespesa] = useState(true);
  const [dlClassif, setDlClassif] = useState("");
  const [recebBancoId, setRecebBancoId] = useState("");
  const [classificacoesFin, setClassificacoesFin] = useState<ClassificacaoFinanceiraRow[]>([]);
  const [bancosEmpresa, setBancosEmpresa] = useState<ContaBancariaEmpresaRow[]>([]);
  const [fornecedores, setFornecedores] = useState<FornecedorRow[]>([]);
  const [classifsPessoais, setClassifsPessoais] = useState<ClassificacaoPessoalRow[]>([]);

  // ---- exportação PDF/XLSX (reunião 20-out-2026) ----
  const [camposExportOpen, setCamposExportOpen] = useState(false);
  const [exportando, setExportando] = useState<"pdf" | "xlsx" | null>(null);

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

      };
      const [data, baixas] = await Promise.all([
        listarVendas(filtros),
        listarKgBaixadoPorVenda().catch(() => new Map<string, number>()),
      ]);
      setRows(data);
      setKgBaixadoPorVenda(baixas);
    } catch (e: unknown) {
      toast.error("Erro carregando vendas", (e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filterStatus, filterCultura, filterSafra, filterDestino]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData(); setSelectedIds(new Set()); }, [fetchData]);
  useEffect(() => {
    listarSocios().then(setSocios).catch((e) => toast.error("Erro carregando sócios", (e as Error).message));
    // Lookups da integração com o Financeiro (falha silenciosa: a integração é
    // opcional e avisa na hora de gerar se algo faltar).
    listarClassificacoes().then(setClassificacoesFin).catch(() => undefined);
    listarContasEmpresa().then(setBancosEmpresa).catch(() => undefined);
    listarFornecedores().then(setFornecedores).catch(() => undefined);
    listarClassificacoesPessoais().then(setClassifsPessoais).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Saldo em estoque da cultura×safra escolhida (criação E edição — 27-jul;
  // debounce leve porque o campo Safra é digitado). Falha silenciosa: o banco
  // valida de novo.
  useEffect(() => {
    if (!modalOpen) return;
    const safra = form.safra.trim();
    let cancelado = false;
    const t = setTimeout(() => {
      if (!safra) { if (!cancelado) setSaldoEstoque(null); return; }
      obterSaldoEstoque(form.cultura, safra)
        .then((s) => { if (!cancelado) setSaldoEstoque(s); })
        .catch(() => { if (!cancelado) setSaldoEstoque(null); });
    }, 350);
    return () => { cancelado = true; clearTimeout(t); };
  }, [modalOpen, form.cultura, form.safra]);

  // ---- derivados ----
  // Recortes no client, pelo mês do recebimento previsto:
  //   • COMPETÊNCIA (17-ago) — mês a mês, com "Todas";
  //   • EXERCÍCIO (27-jul)   — o ano inteiro, para somar/comparar.
  // Os dois se somam: exercício 2027 + competências 01 e 02 = jan e fev/2027.
  const rowsFiltradas = useMemo(
    () => rows.filter((r) => {
      if (filterExercicios.length && !filterExercicios.includes(r.mes_recebimento.slice(0, 4))) return false;
      if (filterCompetencias.length && !filterCompetencias.includes(r.mes_recebimento)) return false;
      return true;
    }),
    [rows, filterExercicios, filterCompetencias],
  );
  const resumo = useMemo(() => calcularResumo(rowsFiltradas), [rowsFiltradas]);
  const safrasDistintas = useMemo(() => Array.from(new Set(rows.map((r) => r.safra))).sort(), [rows]);
  const mesesDistintos = useMemo(() => Array.from(new Set(rows.map((r) => r.mes_recebimento))).sort(), [rows]);
  const exerciciosDistintos = useMemo(
    () => Array.from(new Set(rows.map((r) => r.mes_recebimento.slice(0, 4)))).sort(),
    [rows],
  );
  const totalPages = Math.max(1, Math.ceil(rowsFiltradas.length / PAGE_SIZE));
  const paged = rowsFiltradas.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // ---- seleção múltipla (ajuste 27-jul) ----
  const allPageSelected = paged.length > 0 && paged.every((r) => selectedIds.has(r.id));
  const togglePageSelection = () => {
    if (paged.length === 0) return;
    const allSel = paged.every((r) => selectedIds.has(r.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      paged.forEach((r) => { if (allSel) next.delete(r.id); else next.add(r.id); });
      return next;
    });
  };
  const toggleOneSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const somaSelecionados = useMemo(() => {
    let s = 0;
    for (const r of rows) if (selectedIds.has(r.id)) s += r.valor_total ?? 0;
    return s;
  }, [rows, selectedIds]);

  // ---- helpers da integração com o Financeiro (ajuste 27-jul) ----
  const valorTotalForm = (Number(form.kg) / (Number(form.kg_por_saca) || 60)) * Number(form.preco_sc);
  const round2 = (v: number) => Math.round(v * 100) / 100;

  /** Centro de custo da RECEITA da venda (1.2.x — Venda de Soja/Milho…). */
  function centroReceitaVenda(cultura: CulturaSafra): { conta: string; centro: string } | null {
    const conta = classificacoesFin.find((c) => c.nivel === 2 && c.codigo === "1.2")
      ?? classificacoesFin.find((c) => c.nivel === 2 && /arrendamento/i.test(c.nome));
    if (!conta) return null;
    const filhos = classificacoesFin.filter((c) => c.nivel === 3 && c.parent_codigo === conta.codigo);
    const porNome = filhos.find((c) => c.nome.toLowerCase().includes(CULTURA_LABEL[cultura].toLowerCase()));
    const centro = porNome ?? filhos[0];
    return centro ? { conta: conta.codigo, centro: centro.codigo } : null;
  }

  /** Centro de custo da DESPESA da Taxa de Armazenagem (2.4.5). */
  function centroTaxaArmazenagem(): { conta: string; centro: string } | null {
    const centro = classificacoesFin.find((c) => c.nivel === 3 && c.codigo === "2.4.5")
      ?? classificacoesFin.find((c) => c.nivel === 3 && /armazenagem/i.test(c.nome));
    if (!centro || !centro.parent_codigo) return null;
    return { conta: centro.parent_codigo, centro: centro.codigo };
  }

  /** Classificação pessoal padrão da DL gerada por venda (Lucro, se existir). */
  const dlClassifPadrao = useMemo(
    () => classifsPessoais.find((c) => /lucro/i.test(c.nome))?.codigo ?? classifsPessoais[0]?.codigo ?? "",
    [classifsPessoais],
  );
  /** Banco padrão do recebimento (Cora — padrão dos lançamentos de venda). */
  const bancoRecebPadrao = useMemo(
    () => bancosEmpresa.find((b) => (b.apelido ?? b.nome).toLowerCase().includes("cora"))?.id ?? "",
    [bancosEmpresa],
  );

  // ---- handlers ----
  function openNova() {
    if (!podeEditar) return;
    setEditId(null);
    setForm({ ...EMPTY });
    setBaixarEstoque(true);
    setSaldoEstoque(null);
    setEditTinhaBaixa(false);
    setGerarFinanceiro(true);
    setGerarDL(true);
    setGerarTaxaDespesa(true);
    setDlClassif("");
    setRecebBancoId("");
    setModalOpen(true);
  }
  function openEdit(v: VendaProvisionadaRichRow) {
    setEditSnapshot(v);
    const tinhaBaixa = (kgBaixadoPorVenda.get(v.id) ?? 0) > 0;
    setEditId(v.id);
    setEditTinhaBaixa(tinhaBaixa);
    setBaixarEstoque(tinhaBaixa);
    setSaldoEstoque(null);
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
      taxa_data_pgto: v.taxa_data_pgto ?? "",
      taxa_nd: v.taxa_nd ?? "",
      taxa_banco_id: v.taxa_banco_id ?? "",
      observacao: v.observacao ?? "",
      status: v.status,
    });
    setModalOpen(true);
  }

  /**
   * Gera os lançamentos integrados no Financeiro após criar a venda:
   *   • conta a receber (1.2.x, status A receber) — QUALQUER destino. Venda
   *     destinada a sócio também é receita da empresa (01-out-2026: "deve
   *     constar como receita no financeiro, idem aos demais"), como já era na
   *     planilha;
   *   • destino SÓCIO → além da receita, a DL detalhada provisionada (reflete
   *     no Financeiro como Provisionado DL automaticamente, via trigger SOMASE);
   *   • taxa de armazenagem → despesa a pagar (2.4.5) SEMPRE no Financeiro,
   *     independentemente do destino do recebimento.
   * Falhas aqui NÃO desfazem a venda — avisam para lançar manualmente.
   */
  async function gerarIntegracaoFinanceiro(vendaId: string): Promise<void> {
    const valorTotal = round2(valorTotalForm);
    const descricaoVenda = `Venda ${CULTURA_LABEL[form.cultura]} Safra ${form.safra.trim()}`;
    const nf = form.nota_fiscal.trim();
    const socio = form.destino_empresa ? undefined : socios.find((s) => s.id === form.socio_destino_id);
    const nomeSocio = socio?.apelido ?? socio?.nome_completo ?? "";

    if (gerarFinanceiro) {
      try {
        const alvo = centroReceitaVenda(form.cultura);
        if (!alvo) throw new Error('Plano de contas sem a conta 1.2 (Receita de Arrendamento) — cadastre em Configurações → Plano de Contas.');
        let fornecedorId: string | null = null;
        let fornecedorNome: string | null = form.comprador.trim() || null;
        if (fornecedorNome) {
          const f = await garantirFornecedor(fornecedorNome, fornecedores);
          if (f) { fornecedorId = f.id; fornecedorNome = f.nome; }
        }
        const payload: TransacaoEmpresaInsert = {
          data: form.data_pgto_prevista,
          data_emissao: form.data_venda || null,
          conta_contabil_cod: alvo.conta,
          centro_custo_cod: alvo.centro,
          tipo_despesa: "sem",
          fornecedor_id: fornecedorId,
          fornecedor_nome: fornecedorNome,
          descricao: descricaoVenda,
          obs_obra: "sem",
          ref: nf ? `NF ${nf}` : (form.numero_contrato.trim() || null),
          parcelas: null,
          forma_pgto: "sem",
          conta_bancaria_id: recebBancoId || bancoRecebPadrao || null,
          status: "a_receber",
          valor: valorTotal,
          observacao: socio
            ? `Gerado automaticamente pela Venda Futura (${form.comprador.trim()}) — recebimento destinado a ${nomeSocio}; o repasse está na Distribuição de Lucro.`
            : `Gerado automaticamente pela Venda Futura (${form.comprador.trim()}).`,
          origem_planilha: `venda_auto:${vendaId}`,
          created_by: null,
        };
        const criada = await criarTransacaoEmpresa(payload);
        await atualizarVenda(vendaId, { transacao_empresa_id: criada.id });
        toast.success("Conta a receber criada no Financeiro", `${descricaoVenda} — ${formatCurrency(valorTotal)} (A receber).`);
      } catch (e: unknown) {
        toast.warning("Venda salva, mas a conta a receber NÃO foi gerada", (e as Error).message);
      }
    }

    if (gerarDL && !form.destino_empresa && form.socio_destino_id) {
      try {
        const classif = dlClassif || dlClassifPadrao;
        if (!classif) throw new Error("Nenhuma classificação pessoal cadastrada para a DL.");
        const payload: TransacaoSocioInsert = {
          data: `${form.data_pgto_prevista.slice(0, 7)}-01`,   // competência = mês do recebimento
          socio_id: form.socio_destino_id,
          classificacao_pessoal: classif,
          descricao: `${descricaoVenda}${nf ? ` — NF ${nf}` : ""} (${form.comprador.trim()})`,
          conta_bancaria_socio_id: null,
          conta_bancaria_socio_nome: null,
          valor: valorTotal,
          data_vencimento: form.data_pgto_prevista,            // Data do Repasse prevista
          data_vencimento_despesa: null,
          status: "provisionado",
          observacao: `Gerado automaticamente pela Venda Futura destinada ao sócio ${nomeSocio}.`,
          origem_planilha: `venda_auto:${vendaId}`,
          created_by: null,
        };
        await criarDetalhado(payload);
        toast.success(
          "Distribuição de Lucro provisionada",
          `${formatCurrency(valorTotal)} lançados no detalhado do sócio — o Provisionado DL global do Financeiro atualiza sozinho.`,
        );
      } catch (e: unknown) {
        toast.warning("Venda salva, mas a DL NÃO foi gerada", (e as Error).message);
      }
    }

    const taxa = Number(form.taxa_armazenagem) || 0;
    if (gerarTaxaDespesa && taxa > 0) {
      try {
        const alvo = centroTaxaArmazenagem();
        if (!alvo) throw new Error('Plano de contas sem o centro "Taxa de Armazenagem" (2.4.5) — cadastre em Configurações → Plano de Contas.');
        let fornecedorId: string | null = null;
        let fornecedorNome: string | null = form.comprador.trim() || null;
        if (fornecedorNome) {
          const f = await garantirFornecedor(fornecedorNome, fornecedores);
          if (f) { fornecedorId = f.id; fornecedorNome = f.nome; }
        }
        const payload: TransacaoEmpresaInsert = {
          data: form.taxa_data_pgto || form.data_pgto_prevista,
          data_emissao: null,
          conta_contabil_cod: alvo.conta,
          centro_custo_cod: alvo.centro,
          tipo_despesa: "sem",
          fornecedor_id: fornecedorId,
          fornecedor_nome: fornecedorNome,
          descricao: `Taxa de Armazenagem Safra ${form.safra.trim()} — ${CULTURA_LABEL[form.cultura]}`,
          obs_obra: "sem",
          ref: form.taxa_nd.trim() ? `ND ${form.taxa_nd.trim()}` : null,
          parcelas: null,
          forma_pgto: "sem",
          conta_bancaria_id: form.taxa_banco_id || null,
          status: "a_pagar",
          valor: -Math.abs(round2(taxa)),
          observacao: "Taxa de Armazenagem gerada automaticamente pela Venda Futura — responsabilidade da empresa (sempre no Financeiro, nunca em DL).",
          origem_planilha: `venda_taxa_auto:${vendaId}`,
          created_by: null,
        };
        const criada = await criarTransacaoEmpresa(payload);
        await atualizarVenda(vendaId, { taxa_transacao_id: criada.id });
        toast.success("Despesa da Taxa de Armazenagem criada", `${formatCurrency(-Math.abs(taxa))} (A pagar) no Financeiro.`);
      } catch (e: unknown) {
        toast.warning("Venda salva, mas a despesa da taxa NÃO foi gerada", (e as Error).message);
      }
    }
  }
  async function save() {
    if (!podeEditar) return;
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
      taxa_data_pgto: form.taxa_data_pgto || null,
      taxa_nd: form.taxa_nd.trim() || null,
      taxa_banco_id: form.taxa_banco_id || null,
      observacao: form.observacao.trim() || null,
      status: form.status,
      transacao_empresa_id: null,
      origem_planilha: null,
      created_by: null,
    };
    try {
      if (editId) {
        // Na edição não sobrescrevemos o vínculo com o Financeiro.
        const { transacao_empresa_id: _t, ...updatePayload } = payload;
        void _t;
        await atualizarVenda(editId, updatePayload);

        // "Dar baixa no estoque" agora é editável a qualquer momento (27-jul):
        //   • estava SEM baixa e marcou  → baixa FIFO vinculada à venda;
        //   • estava COM baixa e desmarcou → desfaz as baixas (volume volta).
        if (!editTinhaBaixa && baixarEstoque) {
          try {
            const res = await baixarEstoqueFifo({
              cultura: form.cultura,
              safra: form.safra.trim(),
              kg: Number(form.kg),
              data: form.data_venda,
              vendaId: editId,
              observacao: `Baixa automática da venda ${form.numero_contrato.trim() || form.comprador.trim()}`,
            });
            const partes = [`${res.notas_baixadas_total} nota(s) inteira(s)`];
            if (res.notas_parciais > 0) partes.push(`${res.notas_parciais} parcial`);
            toast.success(
              "Venda atualizada com baixa no estoque",
              `FIFO: ${partes.join(" + ")}. Saldo restante da safra: ${res.saldo_restante_kg.toLocaleString("pt-BR")} kg.`,
            );
          } catch (eBaixa: unknown) {
            toast.error("Venda atualizada, mas a baixa de estoque FALHOU", (eBaixa as Error).message);
          }
        } else if (editTinhaBaixa && !baixarEstoque) {
          try {
            await desfazerBaixasVenda(editId);
            toast.success("Baixa de estoque desfeita", "O volume voltou ao estoque; a venda segue sem baixa vinculada.");
          } catch (eDesfaz: unknown) {
            toast.error("Venda atualizada, mas não foi possível desfazer a baixa", (eDesfaz as Error).message);
          }
        } else if (editSnapshot) {
          const anterior = editSnapshot;
          toast.desfazer("Venda atualizada", "Você tem 8 segundos para voltar aos valores anteriores.", async () => {
            await desfazerEdicao("vendas_provisionadas", anterior);
            await fetchData();
            toast.info("Edição desfeita", "A venda voltou como estava.");
          });
        } else {
          toast.success("Venda atualizada");
        }
      } else {
        const vendaId = await criarVenda(payload);
        if (baixarEstoque) {
          // Baixa FIFO vinculada à venda. Se falhar (ex.: estoque insuficiente),
          // desfaz a venda recém-criada para não deixar meio-caminho.
          try {
            const res = await baixarEstoqueFifo({
              cultura: form.cultura,
              safra: form.safra.trim(),
              kg: Number(form.kg),
              data: form.data_venda,
              vendaId,
              observacao: `Baixa automática da venda ${form.numero_contrato.trim() || form.comprador.trim()}`,
            });
            const partes = [`${res.notas_baixadas_total} nota(s) inteira(s)`];
            if (res.notas_parciais > 0) partes.push(`${res.notas_parciais} parcial`);
            toast.success(
              "Venda registrada com baixa no estoque",
              `FIFO: ${partes.join(" + ")}. Saldo restante da safra: ${res.saldo_restante_kg.toLocaleString("pt-BR")} kg.`,
            );
          } catch (eBaixa: unknown) {
            await deletarVenda(vendaId).catch(() => undefined);
            toast.error("Baixa de estoque falhou — venda não registrada", (eBaixa as Error).message);
            return; // modal aberto p/ ela corrigir o volume/safra
          }
        } else {
          toast.desfazer("Venda registrada", "Sem baixa de estoque (opção desmarcada). Você tem 8 segundos para desfazer.", async () => {
            await desfazerCriacao("vendas_provisionadas", [vendaId]);
            await fetchData();
            toast.info("Criação desfeita", "A venda foi removida.");
          });
        }
        // Integração com o Financeiro / DL / taxa (ajuste 27-jul) — depois da
        // baixa, para a venda já estar consolidada. Falha aqui não desfaz nada.
        await gerarIntegracaoFinanceiro(vendaId);
      }
      setModalOpen(false);
      await fetchData();
    } catch (e: unknown) {
      toast.error("Não foi possível salvar", (e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  // ---- ações em massa (ajuste 27-jul) ----
  async function aplicarStatusEmMassa() {
    if (!podeEditar) return;
    if (!bulkStatus || selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      const n = await atualizarStatusVendasEmMassa(Array.from(selectedIds), bulkStatus as VendaStatus);
      toast.success("Status aplicado", `${n} venda${n === 1 ? "" : "s"} atualizada${n === 1 ? "" : "s"} para "${VENDA_STATUS_LABEL[bulkStatus as VendaStatus]}".`);
      setSelectedIds(new Set());
      setBulkStatus("");
      await fetchData();
    } catch (e: unknown) {
      toast.error("Não foi possível aplicar o status", (e as Error).message);
    } finally {
      setBulkBusy(false);
    }
  }

  async function excluirSelecionados() {
    if (!podeEditar) return;
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const comBaixa = ids.filter((id) => (kgBaixadoPorVenda.get(id) ?? 0) > 0);
    const aviso = comBaixa.length > 0
      ? `\n\n${comBaixa.length} dela${comBaixa.length === 1 ? "" : "s"} tem baixa de estoque vinculada — as baixas serão desfeitas e o volume VOLTA ao estoque.`
      : "";
    if (!confirm(`Excluir DEFINITIVAMENTE ${ids.length === 1 ? "a venda selecionada" : `as ${ids.length} vendas selecionadas`}?${aviso}`)) return;
    setBulkDeleteBusy(true);
    try {
      // Desfaz as baixas vinculadas antes do DELETE (volume volta ao estoque).
      for (const id of comBaixa) {
        await desfazerBaixasVenda(id);
      }
      const n = await deletarVendasEmMassa(ids);
      toast.success(
        "Vendas excluídas",
        `${n} venda${n === 1 ? "" : "s"} excluída${n === 1 ? "" : "s"}${comBaixa.length > 0 ? " — volumes de estoque restaurados" : ""}.`,
      );
      setSelectedIds(new Set());
      await fetchData();
    } catch (e: unknown) {
      toast.error("Não foi possível excluir os selecionados", (e as Error).message);
      await fetchData();
    } finally {
      setBulkDeleteBusy(false);
    }
  }

  async function remove(v: VendaProvisionadaRichRow) {
    if (!podeEditar) return;
    const kgBaixado = kgBaixadoPorVenda.get(v.id) ?? 0;
    const msg = kgBaixado > 0
      ? `Esta venda tem baixa de estoque vinculada (${kgBaixado.toLocaleString("pt-BR")} kg). Ao excluir, as baixas serão desfeitas e o volume VOLTA ao estoque.\n\nExcluir a venda de ${v.comprador} (${v.numero_contrato ?? "sem contrato"})?`
      : `Excluir a venda de ${v.comprador} (${v.numero_contrato ?? "sem contrato"})?`;
    if (!confirm(msg)) return;
    try {
      if (kgBaixado > 0) await desfazerBaixasVenda(v.id);
      await deletarVenda(v.id);
      if (kgBaixado > 0) {
        // Com baixa de estoque revertida não há desfazer de um clique: as baixas
        // FIFO já voltaram ao estoque e o vínculo com a venda se perdeu.
        toast.success("Venda excluída", `${kgBaixado.toLocaleString("pt-BR")} kg voltaram ao estoque.`);
      } else {
        toast.desfazer("Venda excluída", "Você tem 8 segundos para recuperá-la.", async () => {
          await desfazerExclusao("vendas_provisionadas", [v]);
          await fetchData();
          toast.info("Exclusão desfeita", "A venda foi restaurada.");
        });
      }
      await fetchData();
    } catch (e: unknown) {
      toast.error("Não foi possível excluir", (e as Error).message);
    }
  }

  // ---- exportação PDF/XLSX do recorte da tela (reunião 20-out-2026) ----
  // Mesmo padrão da DL: o botão abre a tela de campos e o formato (PDF ou
  // XLSX) é escolhido lá dentro.
  function montarFiltrosExport(): string[] {
    const f: string[] = [];
    // Nenhuma competência marcada = todas: aí não vale uma linha no cabeçalho.
    if (filterCompetencias.length) f.push(`Competência: ${[...filterCompetencias].sort().map(mesHumano).join(", ")}`);
    if (filterExercicios.length) f.push(`Exercício: ${[...filterExercicios].sort().join(", ")}`);
    if (search) f.push(`Busca: "${search}"`);
    if (filterStatus) f.push(`Status: ${VENDA_STATUS_LABEL[filterStatus]}`);
    if (filterCultura) f.push(`Cultura: ${CULTURA_LABEL[filterCultura]}`);
    if (filterSafra) f.push(`Safra: ${filterSafra}`);
    if (filterDestino) f.push(`Destino: ${filterDestino === "empresa" ? "Empresa Aramburu" : "Sócios (direto)"}`);
    return f;
  }

  async function handleExport(formato: "pdf" | "xlsx", escolha: CamposExportVendasEscolha) {
    // Seleção manual tem precedência sobre os filtros (idem à DL). Sem seleção
    // vai o recorte filtrado INTEIRO — não só a página da tabela.
    const selecionadas = rows.filter((r) => selectedIds.has(r.id));
    const alvo = selecionadas.length > 0 ? selecionadas : rowsFiltradas;
    if (alvo.length === 0) {
      toast.info("Nada para exportar", "Nenhuma venda no recorte atual.");
      return;
    }
    setExportando(formato);
    try {
      const meta = {
        filtros: selecionadas.length > 0 ? [] : montarFiltrosExport(),
        campos: escolha.campos,
        incluirFiltros: escolha.incluirFiltros,
        incluirTotais: escolha.incluirTotais,
        emitidoPor: linhaEmissao(await getNomeUsuarioAtual()),
      };
      if (formato === "pdf") await exportVendasPdf(alvo, meta);
      else exportVendasXlsx(alvo, meta);
      setCamposExportOpen(false);
      toast.success("Exportação concluída", `Arquivo ${formato.toUpperCase()} gerado (${alvo.length} venda${alvo.length === 1 ? "" : "s"}).`);
    } catch (e: unknown) {
      toast.error("Falha na exportação", (e as Error).message ?? String(e));
    } finally {
      setExportando(null);
    }
  }

  // ---- render ----
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#0f1f1c]">Vendas Futuras</h1>
          <p className="text-sm text-stone-500">
            Provisionamento de receitas — contratos firmados aguardando pagamento
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Competência no header — mesmo padrão do Financeiro e da DL (17-ago) */}
          <label className="flex items-center gap-1.5 text-xs text-stone-500"
            title="Competência (mês do recebimento previsto) de toda a página: cards, gráficos e tabela seguem o que estiver marcado aqui. Nenhuma marcada = todas.">
            Competência
            <CompetenciaMultiSelect
              className="w-40"
              options={mesesDistintos}
              value={filterCompetencias}
              onChange={(v) => { setFilterCompetencias(v); setPage(1); }}
            />
          </label>
          {/* Exportar (reunião 20-out-2026) — fora do podeEditar: o modo
              leitura também exporta. Campos e formato no CamposExportVendasModal. */}
          <Button variant="outline" size="sm" onClick={() => setCamposExportOpen(true)}
            loading={!!exportando} disabled={!!exportando}
            title="Escolhe os campos e o formato (PDF ou XLSX) das vendas selecionadas ou filtradas">
            <FileDown size={14} /> {selectedIds.size > 0 ? `Exportar (${selectedIds.size})` : "Exportar"}
          </Button>
          {podeEditar && <Button size="sm" onClick={openNova}><Plus size={14} /> Nova Venda</Button>}
        </div>
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
        {/* Sacas por CULTURA (17-ago): o total sozinho não dizia quanto era de
            cada grão, que é o número usado para conferir contra o estoque. */}
        <KpiCard
          label="Sacas Vendidas"
          value={`${resumo.total_sacas.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} sc`}
          icon={<Sprout size={16}/>}
          helpText="Total de sacas já comprometidas em contratos no filtro, aberto por cultura. A conversão kg → sacas usa o kg/saca informado em cada venda (60 kg por padrão)."
          detalhe={
            resumo.por_cultura.length > 0 ? (
              <div className="flex flex-wrap gap-x-3 gap-y-1 -mt-1">
                {resumo.por_cultura.map((c) => (
                  <span
                    key={c.cultura}
                    className="inline-flex items-center gap-1 text-xs text-stone-600 whitespace-nowrap"
                    title={`${CULTURA_LABEL[c.cultura]}: ${c.sacas.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} sacas · ${formatCurrency(c.valor)}`}
                  >
                    <span aria-hidden>{CULTURA_EMOJI[c.cultura]}</span>
                    <span className="text-stone-400">{CULTURA_LABEL[c.cultura]}</span>
                    <b className="tabular-nums text-stone-700">
                      {c.sacas.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
                    </b>
                  </span>
                ))}
              </div>
            ) : null
          }
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
            {/* Exercício (anual) — 1+ anos para análise/soma/comparação (27-jul) */}
            <MultiSelect
              className="w-36"
              value={filterExercicios}
              onChange={(v) => { setFilterExercicios(v); setPage(1); }}
              options={exerciciosDistintos.map((a) => ({ value: a, label: `Exercício ${a}` }))}
              placeholder="Todos os exercícios"
              searchPlaceholder="Buscar ano…"
              emptyText="Nenhum exercício"
              unitLabel="exercícios"
            />
          </div>
        </CardHeader>

        {/* Barra de ações em massa (27-jul) */}
        {selectedIds.size > 0 && (
          <div className="mx-4 mb-1 rounded-lg bg-accent-50 border border-accent-200 px-3 py-2 flex items-center gap-2 flex-wrap text-xs">
            <span className="font-medium text-stone-700">
              {selectedIds.size} selecionada{selectedIds.size === 1 ? "" : "s"}:
            </span>
            {podeEditar && (
              <>
                <select
                  value={bulkStatus}
                  onChange={(e) => setBulkStatus(e.target.value)}
                  className="h-7 rounded-lg border border-stone-200 px-2 text-xs bg-white"
                  title="Status a aplicar em todas as vendas selecionadas"
                >
                  <option value="">Escolher status…</option>
                  {(Object.keys(VENDA_STATUS_LABEL) as VendaStatus[]).map((s) =>
                    <option key={s} value={s}>{VENDA_STATUS_LABEL[s]}</option>)}
                </select>
                <Button size="sm" variant="outline" disabled={!bulkStatus || bulkBusy || bulkDeleteBusy}
                  loading={bulkBusy}
                  onClick={aplicarStatusEmMassa}
                  title="Aplica o status escolhido em todas as vendas selecionadas de uma vez">
                  Aplicar status
                </Button>
                <Button size="sm" variant="outline" disabled={bulkBusy || bulkDeleteBusy}
                  loading={bulkDeleteBusy}
                  onClick={excluirSelecionados}
                  className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                  title="Exclui DE UMA VEZ todas as vendas selecionadas (baixas de estoque vinculadas são desfeitas)">
                  <Trash2 size={13} /> Excluir selecionadas
                </Button>
              </>
            )}
            <span className="ml-auto inline-flex items-center gap-1.5 font-semibold text-stone-700 tabular-nums bg-white border border-accent-200 rounded-lg px-2.5 py-1">
              Soma: <span className="text-emerald-700">{formatCurrency(somaSelecionados)}</span>
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
                    <input
                      type="checkbox"
                      aria-label="Selecionar todas da página"
                      checked={allPageSelected}
                      onChange={togglePageSelection}
                      className="h-3.5 w-3.5 rounded border-stone-300 accent-accent-500 cursor-pointer"
                    />
                  </th>
                  {["Cultura","Safra","Comprador","Contrato/NF","Sacas","R$/sc","Valor Total","Pgto Previsto","Destino","Status","Ações"].map((h) => (
                    <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={12} className="px-4 py-12 text-center text-stone-400">
                    <Loader2 size={18} className="inline-block animate-spin mr-2" /> Carregando…
                  </td></tr>
                )}
                {!loading && paged.length === 0 && (
                  <tr><td colSpan={12} className="px-4 py-12 text-center text-stone-400">
                    Nenhuma venda encontrada.
                  </td></tr>
                )}
                {!loading && paged.map((v) => (
                  <tr key={v.id} className={`border-b border-stone-50 transition-colors table-row-alt ${selectedIds.has(v.id) ? "bg-accent-50/60" : "hover:bg-stone-50"}`}>
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        aria-label="Selecionar venda"
                        checked={selectedIds.has(v.id)}
                        onChange={() => toggleOneSelection(v.id)}
                        className="h-3.5 w-3.5 rounded border-stone-300 accent-accent-500 cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-3 text-stone-700 whitespace-nowrap">
                      <span className="mr-1">{CULTURA_EMOJI[v.cultura]}</span>
                      {CULTURA_LABEL[v.cultura]}
                    </td>
                    <td className="px-3 py-3 text-stone-700 text-xs">{v.safra}</td>
                    <td className="px-3 py-3 text-stone-700 font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        {v.comprador}
                        {(kgBaixadoPorVenda.get(v.id) ?? 0) > 0 && (
                          <span title={`Baixa de estoque vinculada: ${(kgBaixadoPorVenda.get(v.id) ?? 0).toLocaleString("pt-BR")} kg (FIFO)`}>
                            <PackageCheck size={13} className="text-emerald-600 shrink-0" />
                          </span>
                        )}
                      </span>
                    </td>
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
                        <button onClick={() => openEdit(v)} className="p-1.5 rounded hover:bg-primary-50 text-stone-400 hover:text-primary-600 transition" title={podeEditar ? "Editar" : "Ver detalhes"}>{podeEditar ? <Edit2 size={13}/> : <Eye size={13}/>}</button>
                        {podeEditar && <button onClick={() => remove(v)} className="p-1.5 rounded hover:bg-red-50 text-stone-400 hover:text-red-500 transition" title="Excluir"><Trash2 size={13}/></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              {!loading && rowsFiltradas.length > 0 && (
                <tfoot>
                  <tr className="bg-stone-50 border-t-2 border-stone-200 font-semibold text-stone-700">
                    <td colSpan={5} className="px-3 py-3 text-xs uppercase tracking-wide">
                      Total{filterExercicios.length > 0 ? ` (${filterExercicios.join(" + ")})` : ""}
                    </td>
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
              {loading ? "…" : `${rowsFiltradas.length} venda${rowsFiltradas.length === 1 ? "" : "s"}`}
              {!loading && filterExercicios.length > 0 && ` no${filterExercicios.length === 1 ? "" : "s"} exercício${filterExercicios.length === 1 ? "" : "s"} ${filterExercicios.join(", ")}`}
            </p>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </CardContent>
      </Card>

      {/* Modal CRUD */}
      <Modal open={modalOpen} onClose={guard.requestClose}
        title={!podeEditar ? "Detalhes da Venda" : editId ? "Editar Venda" : "Nova Venda"} size="lg">
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Input label="Data da Venda *" type="date" value={form.data_venda} readOnly={!podeEditar}
              onChange={(e) => setForm({ ...form, data_venda: e.target.value })} />
            <Input label="Comprador *" placeholder="Copasul" value={form.comprador} readOnly={!podeEditar}
              onChange={(e) => setForm({ ...form, comprador: e.target.value })} />
            <Select label="Status" value={form.status} disabled={!podeEditar}
              onChange={(e) => setForm({ ...form, status: e.target.value as VendaStatus })}>
              {(Object.keys(VENDA_STATUS_LABEL) as VendaStatus[]).map((s) =>
                <option key={s} value={s}>{VENDA_STATUS_LABEL[s]}</option>)}
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Select label="Cultura *" value={form.cultura} disabled={!podeEditar}
              onChange={(e) => setForm({ ...form, cultura: e.target.value as CulturaSafra })}>
              {(Object.keys(CULTURA_LABEL) as CulturaSafra[]).map((c) =>
                <option key={c} value={c}>{CULTURA_EMOJI[c]} {CULTURA_LABEL[c]}</option>)}
            </Select>
            <Input label="Safra *" placeholder="24/25" value={form.safra} readOnly={!podeEditar}
              onChange={(e) => setForm({ ...form, safra: e.target.value })} />
            <Input label="Data Prevista do Pgto *" type="date" value={form.data_pgto_prevista} readOnly={!podeEditar}
              onChange={(e) => setForm({ ...form, data_pgto_prevista: e.target.value })} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Input label="Quantidade (kg) *" type="number" step="0.001" readOnly={!podeEditar}
              value={form.kg} onChange={(e) => setForm({ ...form, kg: e.target.value })} />
            <Input label="Preço por Saca (R$) *" type="number" step="0.0001" readOnly={!podeEditar}
              value={form.preco_sc} onChange={(e) => setForm({ ...form, preco_sc: e.target.value })} />
            <Input label="kg por Saca" type="number" step="0.01" readOnly={!podeEditar}
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

          {/* Baixa de estoque por volume — FIFO (migration 0043).
              Desde o ajuste 27-jul a opção também aparece na EDIÇÃO: marcar dá
              a baixa ao salvar; desmarcar desfaz as baixas vinculadas. */}
          <div className="rounded-lg border border-stone-200 p-3 space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-stone-700">
                <input
                  type="checkbox"
                  checked={baixarEstoque}
                  disabled={!podeEditar}
                  onChange={(e) => setBaixarEstoque(e.target.checked)}
                  className="h-4 w-4 rounded border-stone-300 accent-accent-500"
                />
                <span className="font-medium">Dar baixa no estoque</span>
                <span className="text-xs text-stone-400">(FIFO — notas mais antigas primeiro)</span>
              </label>
              {saldoEstoque && (
                <span className="text-xs text-stone-500">
                  Disponível: <strong className="text-stone-700">
                    {saldoEstoque.sacas.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} sc
                  </strong>{" "}
                  ({saldoEstoque.kg.toLocaleString("pt-BR")} kg em {saldoEstoque.notas} nota{saldoEstoque.notas === 1 ? "" : "s"})
                </span>
              )}
            </div>
            {(!editId || (!editTinhaBaixa && baixarEstoque)) && baixarEstoque && saldoEstoque && form.kg && Number(form.kg) > saldoEstoque.kg && (
              <p className="text-xs text-red-600">
                Volume maior que o saldo em estoque ({saldoEstoque.kg.toLocaleString("pt-BR")} kg) — a baixa vai falhar.
                Ajuste a quantidade ou desmarque a baixa.
              </p>
            )}
            {(!editId || (!editTinhaBaixa && baixarEstoque)) && baixarEstoque && saldoEstoque && saldoEstoque.kg === 0 && (
              <p className="text-xs text-amber-600">
                Sem estoque lançado para esta cultura/safra — a baixa vai falhar. Confira a safra (ex.: 25/25) ou desmarque.
              </p>
            )}
            {editId && editTinhaBaixa && baixarEstoque && (
              <p className="text-[11px] text-amber-700">
                Esta venda já tem baixa vinculada ({(kgBaixadoPorVenda.get(editId) ?? 0).toLocaleString("pt-BR")} kg).
                Alterar volume, cultura ou safra <b>não realoca</b> a baixa — para refazer, desmarque a opção,
                salve (o volume volta ao estoque) e edite de novo marcando a baixa.
              </p>
            )}
            {editId && editTinhaBaixa && !baixarEstoque && (
              <p className="text-[11px] text-red-600 font-medium">
                Ao salvar, as baixas vinculadas ({(kgBaixadoPorVenda.get(editId) ?? 0).toLocaleString("pt-BR")} kg)
                serão desfeitas e o volume VOLTA ao estoque.
              </p>
            )}
            {editId && !editTinhaBaixa && baixarEstoque && (
              <p className="text-[11px] text-emerald-700 font-medium">
                Ao salvar, o sistema dará baixa de {Number(form.kg || 0).toLocaleString("pt-BR")} kg no estoque
                da safra (FIFO) vinculada a esta venda.
              </p>
            )}
            <p className="text-[11px] text-stone-400">
              O sistema consome as notas mais antigas até completar o volume; se pegar parte de uma nota,
              o restante continua em estoque com a data de depósito original. As baixas ficam registradas
              por nota para conferência com o armazém.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Input label="Autorização de Fixação" placeholder="153076" value={form.aut_fixacao} readOnly={!podeEditar}
              onChange={(e) => setForm({ ...form, aut_fixacao: e.target.value })} />
            <Input label="Nº Contrato" value={form.numero_contrato} readOnly={!podeEditar}
              onChange={(e) => setForm({ ...form, numero_contrato: e.target.value })} />
            <Input label="Nota Fiscal" placeholder="8066969" value={form.nota_fiscal} readOnly={!podeEditar}
              onChange={(e) => setForm({ ...form, nota_fiscal: e.target.value })} />
          </div>

          <div className="rounded-lg border border-stone-200 p-3 space-y-3">
            <p className="text-xs font-semibold text-stone-600 uppercase tracking-wide">Destino do recebimento</p>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={form.destino_empresa} disabled={!podeEditar}
                  onChange={() => setForm({ ...form, destino_empresa: true })} />
                <span className="text-sm">Empresa Aramburu</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={!form.destino_empresa} disabled={!podeEditar}
                  onChange={() => setForm({ ...form, destino_empresa: false })} />
                <span className="text-sm">Sócio direto</span>
              </label>
            </div>
            {!form.destino_empresa && (
              <Select label="Sócio destinatário *" value={form.socio_destino_id} disabled={!podeEditar}
                onChange={(e) => setForm({ ...form, socio_destino_id: e.target.value })}>
                <option value="">Selecione…</option>
                {socios.map((s) => <option key={s.id} value={s.id}>{s.nome_completo}</option>)}
              </Select>
            )}
          </div>

          {/* Taxa de Armazenagem — valor + data de pagamento + ND + banco (27-jul) */}
          <div className="rounded-lg border border-stone-200 p-3 space-y-3">
            <p className="text-xs font-semibold text-stone-600 uppercase tracking-wide">Taxa de Armazenagem</p>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Valor (R$)" type="number" step="0.01" min="0"
                value={form.taxa_armazenagem}
                readOnly={!podeEditar}
                onChange={(e) => setForm({ ...form, taxa_armazenagem: e.target.value })}
              />
              <Input label="Data de Pagamento" type="date"
                value={form.taxa_data_pgto}
                readOnly={!podeEditar}
                onChange={(e) => setForm({ ...form, taxa_data_pgto: e.target.value })}
              />
              <Input label="ND (Nota de Débito)" placeholder="29635"
                value={form.taxa_nd}
                readOnly={!podeEditar}
                onChange={(e) => setForm({ ...form, taxa_nd: e.target.value })}
              />
              <Select label="Banco" value={form.taxa_banco_id} disabled={!podeEditar}
                onChange={(e) => setForm({ ...form, taxa_banco_id: e.target.value })}>
                <option value="">—</option>
                {bancosEmpresa.map((b) => <option key={b.id} value={b.id}>{b.apelido ?? b.nome}</option>)}
              </Select>
            </div>
            {Number(form.taxa_armazenagem) > 0 && (
              <p className="text-[11px] text-stone-400">
                A taxa é responsabilidade da <b>empresa</b>: a despesa vai SEMPRE para o Financeiro
                (Serviços Terceirizados → Taxa de Armazenagem), mesmo quando o recebimento da venda
                é direcionado a um sócio — nunca para a Distribuição de Lucros.
              </p>
            )}
          </div>

          {/* Integração com o Financeiro (27-jul) — só no cadastro, para evitar duplicidade */}
          {!editId && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 space-y-3">
              <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wide flex items-center gap-1.5">
                <Link2 size={13} /> Integração com o Financeiro
              </p>
              <label className="flex items-start gap-2 cursor-pointer text-sm text-stone-700">
                <input
                  type="checkbox"
                  checked={gerarFinanceiro}
                  onChange={(e) => setGerarFinanceiro(e.target.checked)}
                  className="h-4 w-4 mt-0.5 rounded border-stone-300 accent-accent-500"
                />
                <span>
                  <span className="font-medium">Gerar a conta a receber no Financeiro</span>
                  <span className="block text-xs text-stone-500">
                    Cria {form.kg && form.preco_sc ? <b>{formatCurrency(valorTotalForm)}</b> : "o valor da venda"} como{" "}
                    <b>A receber</b> (Receita de Arrendamento → Venda de {CULTURA_LABEL[form.cultura]}) com vencimento
                    na data prevista do pagamento{!form.destino_empresa && " — venda destinada a sócio também é receita da empresa"}.
                    Desmarque se o lançamento JÁ existe no Financeiro (evita duplicidade).
                  </span>
                </span>
              </label>
              {gerarFinanceiro && (
                <Select label="Banco do recebimento" value={recebBancoId || bancoRecebPadrao}
                  onChange={(e) => setRecebBancoId(e.target.value)}>
                  <option value="">—</option>
                  {bancosEmpresa.map((b) => <option key={b.id} value={b.id}>{b.apelido ?? b.nome}</option>)}
                </Select>
              )}
              {!form.destino_empresa && (
                <label className="flex items-start gap-2 cursor-pointer text-sm text-stone-700">
                  <input
                    type="checkbox"
                    checked={gerarDL}
                    onChange={(e) => setGerarDL(e.target.checked)}
                    className="h-4 w-4 mt-0.5 rounded border-stone-300 accent-accent-500"
                  />
                  <span>
                    <span className="font-medium">Lançar o repasse na Distribuição de Lucro (DL) do sócio</span>
                    <span className="block text-xs text-stone-500">
                      Cria {form.kg && form.preco_sc ? <b>{formatCurrency(valorTotalForm)}</b> : "o valor da venda"} no
                      detalhado do sócio como <b>Provisionado</b> — o valor global <b>Provisionado DL</b> no Financeiro
                      da Aramburu atualiza automaticamente. Desmarque se já foi lançado (evita duplicidade).
                    </span>
                  </span>
                </label>
              )}
              {gerarDL && !form.destino_empresa && (
                <Select label="Classificação da DL" value={dlClassif || dlClassifPadrao}
                  onChange={(e) => setDlClassif(e.target.value)}>
                  {classifsPessoais.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} – {c.nome}</option>)}
                </Select>
              )}
              {Number(form.taxa_armazenagem) > 0 && (
                <label className="flex items-start gap-2 cursor-pointer text-sm text-stone-700">
                  <input
                    type="checkbox"
                    checked={gerarTaxaDespesa}
                    onChange={(e) => setGerarTaxaDespesa(e.target.checked)}
                    className="h-4 w-4 mt-0.5 rounded border-stone-300 accent-accent-500"
                  />
                  <span>
                    <span className="font-medium">Gerar a despesa da Taxa de Armazenagem</span>
                    <span className="block text-xs text-stone-500">
                      Cria <b>{formatCurrency(-Math.abs(Number(form.taxa_armazenagem) || 0))}</b> como <b>A pagar</b>{" "}
                      (Taxa de Armazenagem — identifica a safra {form.safra || "…"} na descrição
                      {form.taxa_nd.trim() ? `, ND ${form.taxa_nd.trim()}` : ""}). Sempre no Financeiro da empresa.
                    </span>
                  </span>
                </label>
              )}
            </div>
          )}

          <Textarea label="Observações" rows={2} readOnly={!podeEditar}
            value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })}
            placeholder="Ex: pagamento em 4 parcelas (jan/mar/mar/jul)" />

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={guard.requestClose}>{podeEditar ? "Cancelar" : "Fechar"}</Button>
            {podeEditar && (
              <Button onClick={save} loading={saving} disabled={saving}>
                {editId ? "Salvar Alterações" : "Adicionar"}
              </Button>
            )}
          </div>
        </div>
      </Modal>
      <UnsavedChangesDialog open={guard.confirmOpen} onStay={guard.stay} onDiscard={guard.discard} />

      {/* Tela de seleção de campos da exportação (reunião 20-out-2026 — idem à DL) */}
      <CamposExportVendasModal
        open={camposExportOpen}
        onClose={() => setCamposExportOpen(false)}
        totalLinhas={selectedIds.size > 0 ? selectedIds.size : rowsFiltradas.length}
        escopo={selectedIds.size > 0 ? "Seleção manual" : "Recorte pelos filtros da tela"}
        exportando={exportando}
        onExportar={handleExport}
      />
    </div>
  );
}
