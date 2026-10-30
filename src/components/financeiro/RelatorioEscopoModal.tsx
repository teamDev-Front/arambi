"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  type ResumoEscopoLinha,
} from "@/lib/queries/financeiro";
import { compararCodigo } from "@/lib/queries/configuracoes";
import { gerarPdfBloqueante } from "@/lib/pdfmonkey/frontend";
import type { ReportScope, ReportScopeDesmarcados } from "@/lib/pdfmonkey/types";
import {
  STATUS_ARAMBURU_LABEL, TIPO_DESPESA_LABEL,
  type StatusAramburu, type TipoDespesa, type PdfMonkeySlug,
} from "@/types";
import { ObservacoesCapaField, observacoesDoTexto } from "@/components/relatorios/ObservacoesCapaField";

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

// ---- Refino por marcação (pedido da Adri, 29-out) ----
// Os quatro grupos do resumo viraram checkboxes, como a tela "Campos do
// relatório": o que ela desmarcar sai do relatório. "A personalização facilita
// para não deixarmos tudo tão engessado". Tudo começa marcado a cada abertura.
type Grupo = "conta" | "centro" | "status" | "tipo";
type Desmarcados = Record<Grupo, ReadonlySet<string>>;
const NADA_DESMARCADO: Desmarcados = {
  conta: new Set(), centro: new Set(), status: new Set(), tipo: new Set(),
};

/** Valor da linha em cada grupo — sem banco/centro é "". */
const VALOR_NO_GRUPO: Record<Grupo, (l: ResumoEscopoLinha) => string> = {
  conta: (l) => l.conta,
  centro: (l) => l.centro,
  status: (l) => l.status,
  tipo: (l) => l.tipo,
};

const ORDEM_STATUS = Object.keys(STATUS_ARAMBURU_LABEL) as StatusAramburu[];
const ORDEM_TIPO: TipoDespesa[] = ["fixa", "variavel", "eventual", "periodica", "sem"];

interface Opcao {
  valor: string;
  label: string;
  /** Código do centro de custo — dois centros podem ter o mesmo nome. */
  detalhe?: string;
  qtd: number;
}

function GrupoMarcavel({
  titulo, opcoes, desmarcados, onAlternar, onAlternarTodos,
}: {
  titulo: string;
  opcoes: Opcao[];
  desmarcados: ReadonlySet<string>;
  onAlternar: (valor: string) => void;
  onAlternarTodos: () => void;
}) {
  const marcados = opcoes.filter((o) => !desmarcados.has(o.valor)).length;
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <p className="text-[10px] uppercase tracking-wide text-stone-400">{titulo}</p>
        <span className="text-[10px] text-stone-400 tabular-nums">{marcados} de {opcoes.length}</span>
        {opcoes.length > 1 && (
          <button
            type="button"
            onClick={onAlternarTodos}
            className="ml-auto text-[11px] text-stone-500 hover:text-stone-800 underline cursor-pointer"
          >
            {desmarcados.size > 0 ? "marcar todos" : "desmarcar todos"}
          </button>
        )}
      </div>
      {opcoes.length === 0 ? (
        <span className="text-stone-300 text-xs">—</span>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 max-h-44 overflow-y-auto">
          {opcoes.map((o) => {
            const marcado = !desmarcados.has(o.valor);
            return (
              <label
                key={o.valor || "sem"}
                className="flex items-center gap-2 py-1 px-1.5 rounded-md hover:bg-white cursor-pointer select-none min-w-0"
              >
                <input
                  type="checkbox"
                  checked={marcado}
                  onChange={() => onAlternar(o.valor)}
                  className="h-3.5 w-3.5 shrink-0 rounded border-stone-300 accent-accent-500 cursor-pointer"
                />
                <span className={`text-sm truncate ${marcado ? "text-stone-800" : "text-stone-400"}`} title={o.label}>
                  {o.label}
                </span>
                {o.detalhe && <span className="text-[10px] text-stone-400 shrink-0">{o.detalhe}</span>}
                <span className="ml-auto pl-1 text-[11px] tabular-nums text-stone-400 shrink-0">{o.qtd}</span>
              </label>
            );
          })}
        </div>
      )}
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
  // Observações (21-out): uma por linha — capa e relatório contábil.
  const [observacoes, setObservacoes] = useState("");
  const [desmarcados, setDesmarcados] = useState<Desmarcados>(NADA_DESMARCADO);
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
    setObservacoes("");
    setDesmarcados(NADA_DESMARCADO);
    /* eslint-enable react-hooks/set-state-in-effect */
    carregarResumo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Opções de cada grupo, com quantos lançamentos do recorte caem nelas.
  const opcoes = useMemo<Record<Grupo, Opcao[]> | null>(() => {
    if (!resumo) return null;
    const contar = (g: Grupo) => {
      const m = new Map<string, number>();
      for (const l of resumo.linhas) {
        const v = VALOR_NO_GRUPO[g](l);
        m.set(v, (m.get(v) ?? 0) + 1);
      }
      return m;
    };
    const nomeConta = new Map(resumo.contas.map((c) => [c.id, c.nome]));
    const nomeCentro = new Map(resumo.centros.map((c) => [c.cod, c.nome]));
    return {
      conta: Array.from(contar("conta"), ([valor, qtd]) => ({
        valor, qtd, label: valor ? nomeConta.get(valor) ?? "—" : "Sem banco",
      })).sort((a, b) => (a.valor ? 0 : 1) - (b.valor ? 0 : 1) || a.label.localeCompare(b.label, "pt-BR")),
      centro: Array.from(contar("centro"), ([valor, qtd]) => ({
        valor, qtd, label: valor ? nomeCentro.get(valor) ?? valor : "Sem centro", detalhe: valor || undefined,
      })).sort((a, b) => (a.valor ? 0 : 1) - (b.valor ? 0 : 1) || compararCodigo(a.valor, b.valor)),
      status: Array.from(contar("status"), ([valor, qtd]) => ({
        valor, qtd, label: STATUS_ARAMBURU_LABEL[valor as StatusAramburu] ?? valor,
      })).sort((a, b) => ORDEM_STATUS.indexOf(a.valor as StatusAramburu) - ORDEM_STATUS.indexOf(b.valor as StatusAramburu)),
      tipo: Array.from(contar("tipo"), ([valor, qtd]) => ({
        valor, qtd, label: valor === "sem" ? "Sem tipo" : TIPO_DESPESA_LABEL[valor as TipoDespesa] ?? valor,
      })).sort((a, b) => ORDEM_TIPO.indexOf(a.valor as TipoDespesa) - ORDEM_TIPO.indexOf(b.valor as TipoDespesa)),
    };
  }, [resumo]);

  const algumDesmarcado = Object.values(desmarcados).some((s) => s.size > 0);
  const incluidas = useMemo(
    () => (resumo?.linhas ?? []).filter((l) =>
      (Object.keys(VALOR_NO_GRUPO) as Grupo[]).every((g) => !desmarcados[g].has(VALOR_NO_GRUPO[g](l)))),
    [resumo, desmarcados],
  );
  // Sem nada desmarcado, os números de sempre (a seleção conta os ids marcados).
  const qtdIncluida = algumDesmarcado ? incluidas.length
    : scopeType === "por_selecao" ? transacaoIds.length : resumo?.count ?? 0;
  const somaIncluida = algumDesmarcado ? incluidas.reduce((s, l) => s + l.valor, 0) : resumo?.soma ?? 0;
  const nadaIncluido = algumDesmarcado && incluidas.length === 0;
  // A capa lista só saídas: avisa quando o que está marcado tem entrada.
  const temEntrada = incluidas.some((l) => l.valor > 0);

  function alternar(g: Grupo, valor: string) {
    setDesmarcados((d) => {
      const s = new Set(d[g]);
      if (s.has(valor)) s.delete(valor); else s.add(valor);
      return { ...d, [g]: s };
    });
  }

  function alternarTodos(g: Grupo) {
    setDesmarcados((d) => ({
      ...d,
      [g]: d[g].size > 0 ? new Set<string>() : new Set((opcoes?.[g] ?? []).map((o) => o.valor)),
    }));
  }

  function montarScope(): ReportScope {
    // Auditoria (scope_applied): o que de fato foi para o relatório.
    const rotulos = (g: Grupo) => (opcoes?.[g] ?? [])
      .filter((o) => !desmarcados[g].has(o.valor))
      .map((o) => o.label);
    const totais = resumo
      ? {
          qtd_lancamentos: algumDesmarcado ? incluidas.length : resumo.count,
          total: somaIncluida,
          contas: rotulos("conta"),
          centros: rotulos("centro"),
          status: rotulos("status"),
          tipos: rotulos("tipo"),
        }
      : undefined;
    // Vazio = undefined: sem nada desmarcado, a requisição sai igual à de antes.
    const lista = (s: ReadonlySet<string>) => (s.size > 0 ? Array.from(s) : undefined);
    const refino: ReportScopeDesmarcados | undefined = algumDesmarcado
      ? {
          conta_bancaria_id: lista(desmarcados.conta),
          centro_custo_cod: lista(desmarcados.centro),
          status: lista(desmarcados.status),
          tipo_despesa: lista(desmarcados.tipo),
        }
      : undefined;

    if (scopeType === "por_selecao") {
      return { scope_type: "por_selecao", transacao_ids: transacaoIds, totais, desmarcados: refino };
    }

    const cc = filtros.centroCustoCod;
    return {
      scope_type: "por_filtros",
      desmarcados: refino,
      filtros: {
        // Competência — 1 ou várias. O seletor da tela virou multi em 17-ago e o
        // `typeof === "string"` que havia aqui passou a descartar a lista: a capa
        // saía sem recorte de mês. Sem competência marcada = todos os meses.
        mes_referencia: filtros.mesReferencia,
        search: filtros.search,
        status: filtros.status,            // 1 status ou lista (filtrosAtuais já manda undefined quando vazio)
        conta_contabil_cod: filtros.contaContabilCod,
        centro_custo_cod: Array.isArray(cc) ? cc : cc ? [cc] : undefined,
        conta_bancaria_id: filtros.contaBancariaId,
        // Tipo, forma de pgto e "só o lado que sai" (out-2026): o "Exportar PDF"
        // da tela já respeitava; a capa não — e o total geral dela não fechava
        // com o do relatório (ex.: entrava o crédito do resgate no SICREDI).
        tipo_despesa: filtros.tipoDespesa,
        forma_pgto: filtros.formaPgto,
        somente_negativos: filtros.somenteNegativos,
        data_de: filtros.dataDe,
        data_ate: filtros.dataAte,
        emissao_de: filtros.emissaoDe,
        emissao_ate: filtros.emissaoAte,
        valor_min: filtros.valorMin,
        valor_max: filtros.valorMax,
        // "Ver só tagueados" (fix 28-jul): o recorte por ids das TAGs também
        // chega ao gerador — antes só o resumo do modal respeitava as tags e
        // a capa saía com todos os lançamentos.
        ids: filtros.ids,
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
    if (nadaIncluido) {
      toast.error("Nada marcado", "Marque ao menos um item em cada grupo.");
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
        // Vazio = undefined: a requisição sai igual à de antes.
        observacoes: observacoesDoTexto(observacoes),
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
          ) : resumo && opcoes ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-stone-400">Lançamentos incluídos</p>
                  <p className="text-lg font-semibold text-stone-800">
                    {qtdIncluida}
                    {algumDesmarcado && (
                      <span className="ml-1 text-xs font-normal text-stone-400">
                        de {scopeType === "por_selecao" ? transacaoIds.length : resumo.count}
                      </span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-stone-400">Total (líquido)</p>
                  <p className="text-lg font-semibold tabular-nums text-stone-800">{formatCurrency(somaIncluida)}</p>
                </div>
              </div>
              {resumo.capped && (
                <p className="text-[11px] text-amber-600 flex items-center gap-1">
                  <AlertTriangle size={12} /> Conjunto muito grande — resumo por amostra de 10.000 lançamentos.
                </p>
              )}
              <p className="text-[11px] text-stone-500 border-t border-stone-200 pt-2">
                Desmarque o que não deve entrar no relatório.
              </p>
              <GrupoMarcavel
                titulo="Contas com movimento"
                opcoes={opcoes.conta}
                desmarcados={desmarcados.conta}
                onAlternar={(v) => alternar("conta", v)}
                onAlternarTodos={() => alternarTodos("conta")}
              />
              <GrupoMarcavel
                titulo="Centros de custo"
                opcoes={opcoes.centro}
                desmarcados={desmarcados.centro}
                onAlternar={(v) => alternar("centro", v)}
                onAlternarTodos={() => alternarTodos("centro")}
              />
              <GrupoMarcavel
                titulo="Status incluídos"
                opcoes={opcoes.status}
                desmarcados={desmarcados.status}
                onAlternar={(v) => alternar("status", v)}
                onAlternarTodos={() => alternarTodos("status")}
              />
              <GrupoMarcavel
                titulo="Tipo de despesa"
                opcoes={opcoes.tipo}
                desmarcados={desmarcados.tipo}
                onAlternar={(v) => alternar("tipo", v)}
                onAlternarTodos={() => alternarTodos("tipo")}
              />
              {nadaIncluido && (
                <p className="text-[11px] text-red-600 flex items-center gap-1">
                  <AlertTriangle size={12} /> Nenhum lançamento marcado — marque ao menos um item em cada grupo.
                </p>
              )}
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
          {slug === "capa_empresa" && (
            <> Compras no cartão de crédito aparecem na capa só para conferência e não somam no total — a fatura entra pelo resgate &ldquo;Fatura Cartão&rdquo;.</>
          )}
        </p>
        {slug === "capa_empresa" && temEntrada && (
          <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2 -mt-2">
            A capa lista as <b>saídas</b> de cada banco: entradas não aparecem nela. A transferência entre
            contas sai uma vez, pela conta de onde o dinheiro sai (ex.: CORA » SICREDI), e soma na caixa
            dessa conta.
          </p>
        )}

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

        {/* Observações (21-out) — capa: campo `observacoes`; contábil: cartões. */}
        <ObservacoesCapaField
          value={observacoes}
          onChange={setObservacoes}
          ajuda={slug === "relatorio_contabil"
            ? "Cada linha vira um cartão de observação no Relatório Contábil."
            : undefined}
        />

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
            disabled={gerando || loadingResumo || !!erroResumo || nadaIncluido
              || (scopeType === "por_selecao" && transacaoIds.length === 0)}>
            <FileText size={14} /> Confirmar e gerar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
