"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/ui/Toast";
import {
  Search, Download, Trash2, FileText, Fuel, Home as HomeIcon, Wrench,
  Handshake, ArrowRightLeft, FileSignature, Loader2,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { DOCUMENTO_GERADO_LABEL, DOCUMENTO_GERADO_LABEL_CURTO } from "@/types";
import type { DocumentoGeradoRow, DocumentoGeradoTipo } from "@/types";
import {
  listarDocumentosGerados, listarMesesDistintos, gerarDocumento,
  obterUrlDownload, excluirDocumento,
} from "@/lib/queries/documentos";
import { FORM_BY_TIPO } from "./forms/registry";

interface ModeloCard {
  tipo: DocumentoGeradoTipo;
  icone: React.ElementType;
  resumo: string;
  cor: string;
}

const MODELOS: ModeloCard[] = [
  { tipo: "recibo_vale_combustivel",               icone: Fuel,           resumo: "Auxílio combustível indenizatório",       cor: "bg-amber-50 text-amber-700 border-amber-100" },
  { tipo: "recibo_aluguel",                        icone: HomeIcon,       resumo: "Recibo mensal de aluguel",                cor: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  { tipo: "recibo_pagamento_prestador",            icone: Wrench,         resumo: "Pagamento por serviço prestado",          cor: "bg-sky-50 text-sky-700 border-sky-100" },
  { tipo: "termo_autorizacao_pagamento_terceiros", icone: Handshake,      resumo: "Autoriza pagamento a terceiro indicado",  cor: "bg-violet-50 text-violet-700 border-violet-100" },
  { tipo: "termo_transferencia_bancaria",          icone: ArrowRightLeft, resumo: "Comprova transferência entre contas",     cor: "bg-rose-50 text-rose-700 border-rose-100" },
  { tipo: "contrato_prestacao_servicos",           icone: FileSignature,  resumo: "Contrato com cláusulas customizáveis",    cor: "bg-stone-50 text-stone-700 border-stone-200" },
];

const TIPO_ICON: Record<DocumentoGeradoTipo, React.ElementType> = MODELOS.reduce((acc, m) => {
  acc[m.tipo] = m.icone;
  return acc;
}, {} as Record<DocumentoGeradoTipo, React.ElementType>);

const PAGE_SIZE = 10;

export function DocumentosPage() {
  const toast = useToast();
  const [rows, setRows]         = useState<DocumentoGeradoRow[]>([]);
  const [total, setTotal]       = useState(0);
  const [meses, setMeses]       = useState<string[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const [filterTipo, setFilterTipo] = useState<DocumentoGeradoTipo | "">("");
  const [filterMes,  setFilterMes]  = useState("");
  const [page, setPage]         = useState(1);

  const [tipoAberto, setTipoAberto]     = useState<DocumentoGeradoTipo | null>(null);
  const [submitting, setSubmitting]     = useState(false);
  const [downloading, setDownloading]   = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const [lista, mesesDistintos] = await Promise.all([
        listarDocumentosGerados({ search, tipo: filterTipo, mes: filterMes, page, pageSize: PAGE_SIZE }),
        listarMesesDistintos(),
      ]);
      setRows(lista.rows);
      setTotal(lista.total);
      setMeses(mesesDistintos);
    } catch (e) {
      toast.error("Falha ao carregar documentos", (e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filterTipo, filterMes, page]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar(); }, [carregar]);

  const FormAtivo = useMemo(
    () => (tipoAberto ? FORM_BY_TIPO[tipoAberto] : null),
    [tipoAberto],
  );

  async function handleGerar(dados: unknown) {
    if (!tipoAberto) return;
    setSubmitting(true);
    try {
      const res = await gerarDocumento(tipoAberto, dados as never);
      toast.success("Documento gerado", `${DOCUMENTO_GERADO_LABEL[tipoAberto]} pronto para download.`);
      if (res.download_url) {
        window.open(res.download_url, "_blank", "noopener");
      }
      setTipoAberto(null);
      setPage(1);
      await carregar();
    } catch (e) {
      toast.error("Falha ao gerar PDF", (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDownload(row: DocumentoGeradoRow) {
    setDownloading(row.id);
    try {
      const { download_url } = await obterUrlDownload(row.id);
      window.open(download_url, "_blank", "noopener");
    } catch (e) {
      toast.error("Falha ao baixar", (e as Error).message);
    } finally {
      setDownloading(null);
    }
  }

  async function handleExcluir(row: DocumentoGeradoRow) {
    if (!confirm(`Excluir "${row.beneficiario ?? DOCUMENTO_GERADO_LABEL[row.tipo]}"? Esta ação não pode ser desfeita.`)) {
      return;
    }
    try {
      await excluirDocumento(row.id);
      toast.success("Documento excluído");
      await carregar();
    } catch (e) {
      toast.error("Falha ao excluir", (e as Error).message);
    }
  }

  return (
    <div className="space-y-6 max-w-[1200px]">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#0f1f1c]">Documentos</h1>
          <p className="text-sm text-stone-500">Gere recibos e termos a partir dos templates oficiais da Aramburu</p>
        </div>
      </div>

      {/* ─── Modelos disponíveis ─────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-3">Modelos disponíveis</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {MODELOS.map((m) => {
            const Icon = m.icone;
            return (
              <button
                key={m.tipo}
                onClick={() => setTipoAberto(m.tipo)}
                className="group flex items-start gap-3 p-4 bg-white rounded-xl border border-stone-200 hover:border-[#a67c20] hover:shadow-sm transition text-left"
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center border ${m.cor} shrink-0`}>
                  <Icon size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-stone-800 leading-tight">
                    {DOCUMENTO_GERADO_LABEL[m.tipo]}
                  </p>
                  <p className="text-xs text-stone-500 mt-1 leading-relaxed">{m.resumo}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Últimos gerados ────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Últimos gerados {total > 0 && <span className="text-stone-400 font-normal">({total})</span>}</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Buscar por beneficiário, descrição ou número..."
                className="h-8 rounded-lg border border-stone-200 pl-8 pr-3 text-xs w-60 focus:outline-none focus:ring-1 focus:ring-[#a67c20]"
              />
            </div>
            <select
              value={filterTipo}
              onChange={(e) => { setFilterTipo(e.target.value as DocumentoGeradoTipo | ""); setPage(1); }}
              className="h-8 rounded-lg border border-stone-200 px-2 text-xs focus:outline-none"
            >
              <option value="">Todos os tipos</option>
              {MODELOS.map((m) => (
                <option key={m.tipo} value={m.tipo}>{DOCUMENTO_GERADO_LABEL_CURTO[m.tipo]}</option>
              ))}
            </select>
            <select
              value={filterMes}
              onChange={(e) => { setFilterMes(e.target.value); setPage(1); }}
              className="h-8 rounded-lg border border-stone-200 px-2 text-xs focus:outline-none"
            >
              <option value="">Todos os meses</option>
              {meses.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-100">
                  {["Tipo", "Beneficiário", "Nº/Ref", "Valor", "Mês Ref.", "Descrição", "Data", "Ações"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-stone-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-stone-400">
                      <Loader2 size={20} className="inline animate-spin mr-2" /> Carregando...
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-stone-400">
                      Nenhum documento encontrado. Escolha um modelo acima para gerar o primeiro.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const Icon = TIPO_ICON[r.tipo] ?? FileText;
                    return (
                      <tr key={r.id} className="border-b border-stone-50 hover:bg-stone-50/60 transition">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Icon size={14} className="text-stone-400 shrink-0" />
                            <Badge variant="neutral">{DOCUMENTO_GERADO_LABEL_CURTO[r.tipo]}</Badge>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-medium text-stone-700 max-w-[180px] truncate">
                          {r.beneficiario ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-stone-500 font-mono">{r.numero ?? "—"}</td>
                        <td className="px-4 py-3 font-semibold text-stone-700 whitespace-nowrap">
                          {r.valor != null ? formatCurrency(Number(r.valor)) : "—"}
                        </td>
                        <td className="px-4 py-3 text-stone-500 text-xs">{r.mes_referencia ?? "—"}</td>
                        <td className="px-4 py-3 text-stone-500 text-xs truncate max-w-[200px]">{r.descricao ?? "—"}</td>
                        <td className="px-4 py-3 text-stone-500 text-xs whitespace-nowrap">{formatDate(r.created_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDownload(r)}
                              disabled={downloading === r.id}
                              title="Baixar PDF"
                              className="p-1.5 rounded hover:bg-green-50 text-stone-400 hover:text-green-600 transition disabled:opacity-50"
                            >
                              {downloading === r.id
                                ? <Loader2 size={13} className="animate-spin" />
                                : <Download size={13} />}
                            </button>
                            <button
                              onClick={() => handleExcluir(r)}
                              title="Excluir"
                              className="p-1.5 rounded hover:bg-red-50 text-stone-400 hover:text-red-500 transition"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-t border-stone-100">
            <p className="text-xs text-stone-400">{total} documento(s)</p>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </CardContent>
      </Card>

      {/* ─── Modal de geração ───────────────────────────────────────────── */}
      <Modal
        open={tipoAberto !== null}
        onClose={() => { if (!submitting) setTipoAberto(null); }}
        title={tipoAberto ? `Gerar – ${DOCUMENTO_GERADO_LABEL[tipoAberto]}` : ""}
        size="xl"
      >
        {FormAtivo && (
          <FormAtivo
            onSubmit={handleGerar}
            onCancel={() => { if (!submitting) setTipoAberto(null); }}
            submitting={submitting}
          />
        )}
      </Modal>
    </div>
  );
}
