"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Input, Select } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import {
  FileText, Download, Loader2, FileBarChart, FileSpreadsheet, User,
  Building2, RefreshCw, ExternalLink, AlertCircle, CheckCircle2,
} from "lucide-react";
import { gerarPdfBloqueante, consultarStatus } from "@/lib/pdfmonkey/frontend";
import type { ContabilObservacao, RelatorioSociosOverrides } from "@/lib/pdfmonkey/types";
import { listarSocios } from "@/lib/queries/bancos";
import { createClient } from "@/lib/supabase/client";
import { formatDateTime } from "@/lib/utils/format";
import {
  PDFMONKEY_LABEL,
  type PdfMonkeySlug, type SocioRow, type PdfMonkeyGeracaoRow,
} from "@/types";
import { ContabilObservacoesModal } from "./ContabilObservacoesModal";
import { SociosOverridesModal } from "./SociosOverridesModal";
import { SeloCapaFields } from "./SeloCapaFields";
import { ObservacoesCapaField, observacoesDoTexto } from "./ObservacoesCapaField";

const TEMPLATES: Array<{
  slug: PdfMonkeySlug;
  icon: React.ReactNode;
  cor: string;
  descricao: string;
  precisaSocio: boolean;
}> = [
  { slug: "capa_empresa",       icon: <Building2 size={20} />,  cor: "bg-amber-700",   descricao: "Capa do relatório contábil — Agropecuária Aramburu.",                    precisaSocio: false },
  { slug: "capa_socio",         icon: <User size={20} />,        cor: "bg-emerald-700", descricao: "Capa do relatório mensal de um sócio (renda, despesas, fazenda etc).", precisaSocio: true  },
  { slug: "relatorio_contabil", icon: <FileSpreadsheet size={20} />, cor: "bg-blue-700",   descricao: "Documento detalhado por banco e categoria — para a contabilidade.",  precisaSocio: false },
  { slug: "relatorio_socios",   icon: <FileBarChart size={20} />, cor: "bg-purple-700",  descricao: "Resumido infográfico, gráficos de pizza/barra — para os sócios.",     precisaSocio: false },
];

function statusBadge(s: string | null): BadgeVariant {
  switch (s) {
    case "success":     return "success";
    case "failure":     return "danger";
    case "generating":  return "info";
    case "pending":     return "warning";
    default:            return "neutral";
  }
}

const STATUS_LABEL: Record<string, string> = {
  pending:    "Pendente",
  generating: "Gerando",
  success:    "Pronto",
  failure:    "Falhou",
  draft:      "Rascunho",
};

export function RelatoriosPage() {
  const toast = useToast();
  const [socios, setSocios] = useState<SocioRow[]>([]);
  const [mesRef, setMesRef] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [socioId, setSocioId] = useState<string>("");
  // Selo dourado da Capa do sócio (out-2026) — vazios = automático.
  const [capaNumero, setCapaNumero] = useState("");
  const [capaMesLabel, setCapaMesLabel] = useState("");
  // Observações da Capa do sócio (21-out) — uma por linha; vazio = nenhuma.
  const [capaObs, setCapaObs] = useState("");

  const [modalSocioOpen, setModalSocioOpen] = useState(false);
  const [modalObsOpen, setModalObsOpen] = useState(false);
  const [modalOverridesOpen, setModalOverridesOpen] = useState(false);
  const [slugAtual, setSlugAtual] = useState<PdfMonkeySlug | null>(null);
  const [gerando, setGerando] = useState<PdfMonkeySlug | null>(null);

  const [geracoes, setGeracoes] = useState<PdfMonkeyGeracaoRow[]>([]);
  const [loadingHist, setLoadingHist] = useState(true);

  // ---- load sócios + histórico ----
  useEffect(() => {
    listarSocios().then(setSocios).catch((e) => toast.error("Erro carregando sócios", (e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchHistorico = useCallback(async () => {
    setLoadingHist(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("pdfmonkey_geracoes")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      setGeracoes((data ?? []) as PdfMonkeyGeracaoRow[]);
    } catch (e: unknown) {
      toast.error("Erro carregando histórico", (e as Error).message);
    } finally {
      setLoadingHist(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchHistorico(); }, [fetchHistorico]);

  // ---- ações ----
  function clickGerar(slug: PdfMonkeySlug) {
    const tpl = TEMPLATES.find((t) => t.slug === slug)!;
    setSlugAtual(slug);
    if (tpl.precisaSocio) {
      setSocioId(socios[0]?.id ?? "");
      setCapaNumero("");
      setCapaMesLabel("");
      setCapaObs("");
      setModalSocioOpen(true);
      return;
    }
    if (slug === "relatorio_contabil") {
      setModalObsOpen(true);
      return;
    }
    if (slug === "relatorio_socios") {
      setModalOverridesOpen(true);
      return;
    }
    void gerar(slug);
  }

  async function gerar(
    slug: PdfMonkeySlug,
    extras?: {
      socio_id?: string;
      observacoes?: ContabilObservacao[];
      socios_overrides?: RelatorioSociosOverrides;
      numero_lote?: string;
      mes_referencia_label?: string;
    },
  ) {
    setGerando(slug);
    try {
      const res = await gerarPdfBloqueante({
        slug,
        mes_referencia: mesRef,
        socio_id:         extras?.socio_id,
        observacoes:      extras?.observacoes,
        socios_overrides: extras?.socios_overrides,
        numero_lote:          extras?.numero_lote,
        mes_referencia_label: extras?.mes_referencia_label,
      });
      if (res.status === "success" && res.download_url) {
        toast.success(`${PDFMONKEY_LABEL[slug]} gerado`, "Baixe pelo link na tabela abaixo.");
        window.open(res.download_url, "_blank");
      } else if (res.status === "pending" || res.status === "generating") {
        toast.info("Geração em andamento", "Acompanhe pelo histórico abaixo — atualizamos a cada poucos segundos.");
      } else if (res.status === "failure") {
        toast.error("Geração falhou", res.failure_cause ?? "Verifique o template/payload no PDFMonkey.");
      }
      await fetchHistorico();
    } catch (e: unknown) {
      toast.error("Não foi possível gerar", (e as Error).message);
    } finally {
      setGerando(null);
      setModalSocioOpen(false);
      setModalObsOpen(false);
      setModalOverridesOpen(false);
    }
  }

  async function refreshGeracao(g: PdfMonkeyGeracaoRow) {
    if (!g.pdfmonkey_document_id) return;
    try {
      await consultarStatus(g.pdfmonkey_document_id, g.id);
      await fetchHistorico();
      toast.success("Status atualizado");
    } catch (e: unknown) {
      toast.error("Não foi possível consultar status", (e as Error).message);
    }
  }

  const socioMap = useMemo(() => Object.fromEntries(socios.map((s) => [s.id, s])), [socios]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#0f1f1c]">Relatórios PDF</h1>
        <p className="text-sm text-stone-500">
          Gerar relatórios mensais via PDFMonkey. Escolha o mês de referência e clique no template desejado.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Mês de referência</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <Input
              label="Mês (YYYY-MM)"
              type="month"
              value={mesRef}
              onChange={(e) => setMesRef(e.target.value)}
            />
            <p className="text-xs text-stone-500 sm:col-span-2">
              Os relatórios são gerados a partir dos lançamentos deste mês. Para o &quot;Relatório Sócios&quot;,
              os totais infográficos vêm das views <code className="text-[10px]">v_por_conta_contabil_mensal</code> e <code className="text-[10px]">v_saldo_por_banco_mensal</code>.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {TEMPLATES.map((t) => (
          <Card key={t.slug} className="hover:shadow-md transition-shadow">
            <CardContent className="p-5 flex flex-col gap-3 h-full">
              <div className={`w-12 h-12 rounded-xl ${t.cor} flex items-center justify-center text-white shrink-0`}>
                {t.icon}
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm text-stone-800">{PDFMONKEY_LABEL[t.slug]}</p>
                <p className="text-xs text-stone-500 mt-1 leading-relaxed">{t.descricao}</p>
              </div>
              <Button
                size="sm"
                onClick={() => clickGerar(t.slug)}
                disabled={!mesRef || gerando !== null}
                loading={gerando === t.slug}
              >
                <FileText size={13}/> Gerar PDF
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Histórico */}
      <Card>
        <CardHeader>
          <CardTitle>Últimas gerações</CardTitle>
          <button onClick={fetchHistorico} className="p-1.5 rounded hover:bg-stone-100 text-stone-500 transition" title="Atualizar">
            <RefreshCw size={14}/>
          </button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-100">
                  {["Template","Mês","Sócio","Status","Data","Ações"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loadingHist && (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-stone-400">
                    <Loader2 size={18} className="inline-block animate-spin mr-2" /> Carregando…
                  </td></tr>
                )}
                {!loadingHist && geracoes.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-stone-400">
                    Nenhuma geração ainda. Clique em &quot;Gerar PDF&quot; em um dos cards acima.
                  </td></tr>
                )}
                {!loadingHist && geracoes.map((g) => (
                  <tr key={g.id} className="border-b border-stone-50 hover:bg-stone-50 transition-colors table-row-alt">
                    <td className="px-4 py-3 text-stone-700">{PDFMONKEY_LABEL[g.template_slug]}</td>
                    <td className="px-4 py-3 text-stone-700 text-xs">{g.mes_referencia ?? "—"}</td>
                    <td className="px-4 py-3 text-stone-500 text-xs">
                      {g.socio_id ? (socioMap[g.socio_id]?.apelido ?? socioMap[g.socio_id]?.nome_completo ?? g.socio_id) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={statusBadge(g.status)}>
                        <span className="flex items-center gap-1">
                          {g.status === "success" && <CheckCircle2 size={11}/>}
                          {g.status === "failure" && <AlertCircle size={11}/>}
                          {STATUS_LABEL[g.status ?? ""] ?? g.status ?? "—"}
                        </span>
                      </Badge>
                      {g.erro && (
                        <p className="text-[10px] text-red-500 mt-1 max-w-[200px] truncate" title={g.erro}>{g.erro}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-stone-500 text-xs whitespace-nowrap">{formatDateTime(g.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {g.download_url && (
                          <a href={g.download_url} target="_blank" rel="noreferrer"
                            className="p-1.5 rounded hover:bg-primary-50 text-stone-400 hover:text-primary-600 transition" title="Baixar PDF">
                            <Download size={13}/>
                          </a>
                        )}
                        {g.pdfmonkey_document_id && (
                          <button onClick={() => refreshGeracao(g)}
                            className="p-1.5 rounded hover:bg-stone-100 text-stone-400 hover:text-stone-700 transition" title="Atualizar status">
                            <RefreshCw size={13}/>
                          </button>
                        )}
                        {g.pdfmonkey_document_id && (
                          <a href={`https://dashboard.pdfmonkey.io/documents/${g.pdfmonkey_document_id}`}
                            target="_blank" rel="noreferrer"
                            className="p-1.5 rounded hover:bg-stone-100 text-stone-400 hover:text-stone-700 transition" title="Abrir no PDFMonkey">
                            <ExternalLink size={13}/>
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Modal selecionar sócio */}
      <Modal open={modalSocioOpen} onClose={() => setModalSocioOpen(false)} title="Selecione o sócio">
        <div className="p-6 space-y-4">
          <Select label="Sócio *" value={socioId} onChange={(e) => setSocioId(e.target.value)}>
            <option value="">Selecione…</option>
            {socios.map((s) => <option key={s.id} value={s.id}>{s.nome_completo}</option>)}
          </Select>
          <SeloCapaFields
            mesReferencia={mesRef}
            numero={capaNumero}
            onNumeroChange={setCapaNumero}
            mes={capaMesLabel}
            onMesChange={setCapaMesLabel}
          />
          <ObservacoesCapaField value={capaObs} onChange={setCapaObs} />
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={() => setModalSocioOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => slugAtual && socioId && gerar(slugAtual, {
                socio_id: socioId,
                numero_lote: capaNumero.trim() || undefined,
                mes_referencia_label: capaMesLabel.trim() || undefined,
                observacoes: observacoesDoTexto(capaObs),
              })}
              disabled={!socioId || gerando !== null} loading={gerando !== null}>
              <FileText size={13}/> Gerar
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal de observações — Relatório Contábil */}
      <ContabilObservacoesModal
        open={modalObsOpen}
        mesRef={mesRef}
        onClose={() => { if (gerando === null) setModalObsOpen(false); }}
        submitting={gerando === "relatorio_contabil"}
        onConfirmar={(observacoes) => gerar("relatorio_contabil", { observacoes })}
      />

      {/* Modal de notas editáveis — Relatório Sócios */}
      <SociosOverridesModal
        open={modalOverridesOpen}
        mesRef={mesRef}
        onClose={() => { if (gerando === null) setModalOverridesOpen(false); }}
        submitting={gerando === "relatorio_socios"}
        onConfirmar={(socios_overrides) => gerar("relatorio_socios", { socios_overrides })}
      />
    </div>
  );
}
