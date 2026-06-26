"use client";
import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { formatCurrency } from "@/lib/utils/format";
import {
  Loader2, FileText, CheckCircle2, AlertTriangle, Download, ListChecks, Filter,
} from "lucide-react";
import {
  resumirEscopoTransacoes,
  type ListarTransacoesFiltros,
  type ResumoEscopo,
} from "@/lib/queries/financeiro";
import { gerarPdfBloqueante } from "@/lib/pdfmonkey/frontend";
import type { ReportScope } from "@/lib/pdfmonkey/types";
import { STATUS_ARAMBURU_LABEL, type StatusAramburu, type PdfMonkeySlug } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  /** "por_selecao" quando há itens marcados; senão "por_filtros". */
  scopeType: "por_filtros" | "por_selecao";
  /** Filtros atuais da tela (usados em por_filtros). */
  filtros: ListarTransacoesFiltros;
  /** Ids selecionados manualmente (usados em por_selecao). */
  transacaoIds: string[];
  /** Mês de competência sugerido para a capa (YYYY-MM). */
  mesReferenciaDefault: string;
}

const TEMPLATES: { slug: Extract<PdfMonkeySlug, "capa_empresa" | "relatorio_contabil">; label: string }[] = [
  { slug: "capa_empresa", label: "Capa Empresa" },
  { slug: "relatorio_contabil", label: "Relatório Contábil" },
];

function Chips({ items, max = 8 }: { items: string[]; max?: number }) {
  if (items.length === 0) return <span className="text-stone-300 text-xs">—</span>;
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1">
      {/* index na key: nomes podem repetir (ex.: dois centros "Cooperativa Sicredi"). */}
      {shown.map((t, i) => (
        <span key={`${t}-${i}`} className="px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 text-[11px]">{t}</span>
      ))}
      {rest > 0 && <span className="px-1.5 py-0.5 text-stone-400 text-[11px]">+{rest}</span>}
    </div>
  );
}

export function RelatorioEscopoModal({
  open, onClose, scopeType, filtros, transacaoIds, mesReferenciaDefault,
}: Props) {
  const toast = useToast();
  const [resumo, setResumo] = useState<ResumoEscopo | null>(null);
  const [loadingResumo, setLoadingResumo] = useState(false);
  const [erroResumo, setErroResumo] = useState<string | null>(null);

  const [slug, setSlug] = useState<PdfMonkeySlug>("relatorio_contabil");
  const [competencia, setCompetencia] = useState(mesReferenciaDefault);
  // CAPAS (4.3): número do lote e mês de referência informados manualmente.
  const [numeroLote, setNumeroLote] = useState("");
  const [mesRefLabel, setMesRefLabel] = useState("");
  const [gerando, setGerando] = useState(false);
  const [resultado, setResultado] = useState<{ status: string; url: string | null } | null>(null);

  const carregarResumo = useCallback(async () => {
    setLoadingResumo(true);
    setErroResumo(null);
    try {
      const r = await resumirEscopoTransacoes(
        scopeType === "por_selecao" ? { transacaoIds } : { filtros },
      );
      setResumo(r);
    } catch (e) {
      setErroResumo((e as Error).message ?? String(e));
      setResumo(null);
    } finally {
      setLoadingResumo(false);
    }
  }, [scopeType, transacaoIds, filtros]);

  // Recarrega o resumo e reseta o estado sempre que o modal abre (sincronização legítima).
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setResultado(null);
    setCompetencia(mesReferenciaDefault);
    setNumeroLote("");
    setMesRefLabel("");
    /* eslint-enable react-hooks/set-state-in-effect */
    carregarResumo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function montarScope(): ReportScope {
    const totais = resumo
      ? {
          qtd_lancamentos: resumo.count,
          total: resumo.soma,
          contas: resumo.contas.map((c) => c.nome),
          centros: resumo.centros.map((c) => c.nome),
          status: resumo.statuses.map((s) => STATUS_ARAMBURU_LABEL[s]),
        }
      : undefined;

    if (scopeType === "por_selecao") {
      return { scope_type: "por_selecao", transacao_ids: transacaoIds, totais };
    }

    const cc = filtros.centroCustoCod;
    return {
      scope_type: "por_filtros",
      filtros: {
        // só restringe por mês se a tela estava filtrada por mês
        mes_referencia: typeof filtros.mesReferencia === "string" ? filtros.mesReferencia : undefined,
        search: filtros.search,
        status: filtros.status,            // 1 status ou lista (filtrosAtuais já manda undefined quando vazio)
        conta_contabil_cod: filtros.contaContabilCod,
        centro_custo_cod: Array.isArray(cc) ? cc : cc ? [cc] : undefined,
        conta_bancaria_id: filtros.contaBancariaId,
        data_de: filtros.dataDe,
        data_ate: filtros.dataAte,
      },
      totais,
    };
  }

  async function gerar() {
    if (!/^\d{4}-\d{2}$/.test(competencia)) {
      toast.error("Competência inválida", "Informe o mês no formato AAAA-MM.");
      return;
    }
    if (scopeType === "por_selecao" && transacaoIds.length === 0) {
      toast.error("Nenhum item selecionado", "Selecione ao menos um lançamento.");
      return;
    }
    setGerando(true);
    setResultado(null);
    try {
      const res = await gerarPdfBloqueante({
        slug: slug as PdfMonkeySlug,
        mes_referencia: competencia,
        scope: montarScope(),
        ...(slug === "capa_empresa"
          ? { numero_lote: numeroLote.trim() || undefined, mes_referencia_label: mesRefLabel.trim() || undefined }
          : {}),
      });
      setResultado({ status: res.status, url: res.download_url });
      if (res.status === "success") toast.success("Relatório gerado", "O PDF está pronto para download.");
      else if (res.status === "failure") toast.error("Falha na geração", res.failure_cause ?? "Erro desconhecido no PDFMonkey.");
      else toast.info("Geração em andamento", "O PDF ainda está sendo processado. Veja em Relatórios PDF.");
    } catch (e) {
      toast.error("Não foi possível gerar", (e as Error).message ?? String(e));
    } finally {
      setGerando(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Gerar relatório" size="lg" closeOnBackdrop={false}>
      <div className="p-6 space-y-5">
        {/* Tipo de escopo */}
        <div className="flex items-center gap-2">
          {scopeType === "por_selecao" ? (
            <Badge variant="accent"><ListChecks size={12} className="inline mr-1" /> Por seleção manual</Badge>
          ) : (
            <Badge variant="info"><Filter size={12} className="inline mr-1" /> Pelos filtros aplicados</Badge>
          )}
          <span className="text-xs text-stone-500">
            {scopeType === "por_selecao"
              ? "O relatório incluirá somente os lançamentos marcados."
              : "O relatório incluirá os lançamentos que correspondem aos filtros da tela."}
          </span>
        </div>

        {/* Resumo do escopo */}
        <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-4">
          {loadingResumo ? (
            <div className="flex items-center gap-2 text-stone-400 text-sm py-4 justify-center">
              <Loader2 size={16} className="animate-spin" /> Calculando os lançamentos…
            </div>
          ) : erroResumo ? (
            <div className="flex items-start gap-2 text-red-600 text-sm">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <div>
                Não foi possível calcular a seleção.
                <div className="text-xs text-red-500">{erroResumo}</div>
                <button onClick={carregarResumo} className="text-xs underline mt-1">Tentar novamente</button>
              </div>
            </div>
          ) : resumo ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-stone-400">Lançamentos incluídos</p>
                  <p className="text-lg font-semibold text-stone-800">
                    {scopeType === "por_selecao" ? transacaoIds.length : resumo.count}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-stone-400">Total (líquido)</p>
                  <p className="text-lg font-semibold tabular-nums text-stone-800">{formatCurrency(resumo.soma)}</p>
                </div>
              </div>
              {resumo.capped && (
                <p className="text-[11px] text-amber-600 flex items-center gap-1">
                  <AlertTriangle size={12} /> Conjunto muito grande — resumo por amostra de 10.000 lançamentos.
                </p>
              )}
              <div>
                <p className="text-[10px] uppercase tracking-wide text-stone-400 mb-1">Contas com movimento</p>
                <Chips items={resumo.contas.map((c) => c.nome)} />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-stone-400 mb-1">Centros de custo</p>
                <Chips items={resumo.centros.map((c) => c.nome)} />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-stone-400 mb-1">Status incluídos</p>
                <Chips items={resumo.statuses.map((s) => STATUS_ARAMBURU_LABEL[s as StatusAramburu])} />
              </div>
            </div>
          ) : null}
        </div>

        {/* Parâmetros */}
        <div className="grid grid-cols-2 gap-3">
          <Select label="Relatório" value={slug as string}
            onChange={(e) => setSlug(e.target.value as PdfMonkeySlug)}>
            {TEMPLATES.map((t) => <option key={t.slug} value={t.slug}>{t.label}</option>)}
          </Select>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-stone-700">Competência (capa)</label>
            <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)}
              className="w-full h-9 rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent transition" />
          </div>
        </div>
        <p className="text-[11px] text-stone-400 -mt-2">
          A capa inclui somente as contas com movimento. Os filtros/seleção usados ficam registrados na geração.
        </p>

        {/* CAPAS (4.3): lote + mês de referência manuais (apenas Capa Empresa). */}
        {slug === "capa_empresa" && (
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-stone-700">Número do lote</label>
              <input
                value={numeroLote}
                onChange={(e) => setNumeroLote(e.target.value)}
                placeholder="ex.: 7º (automático se vazio)"
                className="w-full h-9 rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent transition"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-stone-700">Mês de referência (lote)</label>
              <input
                value={mesRefLabel}
                onChange={(e) => setMesRefLabel(e.target.value)}
                placeholder="ex.: Julho (automático se vazio)"
                className="w-full h-9 rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent transition"
              />
            </div>
          </div>
        )}

        {/* Resultado */}
        {resultado && (
          <div className={`rounded-lg p-3 text-sm flex items-center gap-2 ${
            resultado.status === "success" ? "bg-emerald-50 text-emerald-700"
            : resultado.status === "failure" ? "bg-red-50 text-red-700"
            : "bg-amber-50 text-amber-700"
          }`}>
            {resultado.status === "success" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <span className="flex-1">
              {resultado.status === "success" ? "Relatório gerado com sucesso."
                : resultado.status === "failure" ? "A geração falhou."
                : "Geração ainda em processamento."}
            </span>
            {resultado.url && (
              <a href={resultado.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium underline">
                <Download size={13} /> Baixar
              </a>
            )}
          </div>
        )}

        {/* Ações */}
        <div className="flex justify-end gap-3 pt-2 border-t border-stone-100">
          <Button variant="ghost" onClick={onClose} disabled={gerando}>Fechar</Button>
          <Button onClick={gerar} loading={gerando}
            disabled={gerando || loadingResumo || !!erroResumo || (scopeType === "por_selecao" && transacaoIds.length === 0)}>
            <FileText size={14} /> Confirmar e gerar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
