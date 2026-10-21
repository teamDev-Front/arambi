"use client";
// Panorama Agro da Home (call 14/jul/2026): Calendário de Chuva + Calendário
// de Vacinação sempre visíveis + Central de Alertas. Fetch independente do
// restante da Home (não altera as queries financeiras existentes).

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CloudRain, Syringe, BellRing, Maximize2, Wrench, FileBadge,
  HeartPulse, GaugeCircle, FileDown, Loader2, CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { CalendarioMes, MESES_LABEL } from "@/components/ui/CalendarioMes";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/utils/format";
import { useModulo, usePermissoes } from "@/components/acessos/PermissoesProvider";
import { classificarRota } from "@/lib/acessos/modulos";
import {
  listarChuvasPeriodo, salvarChuvaDia, listarAlertas, listarEventosVacinacao,
  type AlertaItem, type AlertaTipo,
} from "@/lib/queries/agro";
import type { ChuvaRow, AnimalEventoRow } from "@/types";

const ALERTA_ICON: Record<AlertaTipo, typeof Syringe> = {
  vacinacao: Syringe,
  manutencao: Wrench,
  documento: FileBadge,
  ocorrencia: HeartPulse,
  discrepancia: GaugeCircle,
};

const SEV_VARIANT: Record<AlertaItem["severidade"], BadgeVariant> = {
  info: "info", atencao: "warning", critico: "danger",
};

function pad(n: number) { return String(n).padStart(2, "0"); }

interface AgroPanoramaSectionProps {
  /** "row" = 3 cards lado a lado (padrão antigo); "column" = empilhados na
   *  coluna da direita da Home (ajuste 23-jul: calendários e alertas à direita). */
  layout?: "row" | "column";
}

export function AgroPanoramaSection({ layout = "row" }: AgroPanoramaSectionProps) {
  const toast = useToast();
  const agora = new Date();
  // Chuva é lançada aqui mesmo: edição do módulo Home. Vacinação e alertas
  // só dos módulos que a pessoa vê (0058).
  const { podeEditar: canEdit } = useModulo("home");
  const { podeVer } = usePermissoes();
  const verVacinacao = podeVer("animais");
  const [loading, setLoading] = useState(true);

  // Chuva
  const [chuvaAno, setChuvaAno] = useState(agora.getFullYear());
  const [chuvaMes, setChuvaMes] = useState(agora.getMonth() + 1);
  const [chuvas, setChuvas] = useState<ChuvaRow[]>([]);
  const [chuvaExpandida, setChuvaExpandida] = useState(false);
  const [lancarChuva, setLancarChuva] = useState<{ iso: string; atual: ChuvaRow | null } | null>(null);

  // Vacinação
  const [vacAno, setVacAno] = useState(agora.getFullYear());
  const [vacMes, setVacMes] = useState(agora.getMonth() + 1);
  const [eventos, setEventos] = useState<(AnimalEventoRow & { lote_codigo: string | null })[]>([]);

  // Alertas
  const [todosAlertas, setAlertas] = useState<AlertaItem[]>([]);
  const [gerandoPdf, setGerandoPdf] = useState(false);

  const fetchChuvas = useCallback(async (ano: number, mes: number) => {
    const de = `${ano}-${pad(mes)}-01`;
    const ate = `${ano}-${pad(mes)}-${pad(new Date(ano, mes, 0).getDate())}`;
    try {
      setChuvas(await listarChuvasPeriodo(de, ate));
    } catch {
      // migration 0040 ainda não aplicada — silencioso (card mostra vazio)
      setChuvas([]);
    }
  }, []);

  const fetchTudo = useCallback(async () => {
    setLoading(true);
    try {
      const [evs, als] = await Promise.all([
        listarEventosVacinacao().catch(() => []),
        listarAlertas().catch(() => []),
      ]);
      setEventos(evs);
      setAlertas(als);
      await fetchChuvas(chuvaAno, chuvaMes);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchChuvas]);

  useEffect(() => {
    fetchTudo();
  }, [fetchTudo]);

  const alertas = useMemo(() => todosAlertas.filter((a) => {
    const rota = classificarRota(a.href);
    return rota.tipo !== "modulo" || podeVer(rota.modulo);
  }), [todosAlertas, podeVer]);

  // Derivados — chuva
  const chuvaPorDia = useMemo(() => new Map(chuvas.map((c) => [c.data, c])), [chuvas]);
  const resumoChuva = useMemo(() => {
    const total = chuvas.reduce((s, c) => s + Number(c.milimetros), 0);
    const diasComChuva = chuvas.filter((c) => Number(c.milimetros) > 0).length;
    const maior = chuvas.reduce<ChuvaRow | null>((m, c) => (!m || Number(c.milimetros) > Number(m.milimetros) ? c : m), null);
    const diasNoMes = new Date(chuvaAno, chuvaMes, 0).getDate();
    return { total, diasComChuva, maior, media: diasNoMes > 0 ? total / diasNoMes : 0 };
  }, [chuvas, chuvaAno, chuvaMes]);

  // Derivados — vacinação
  const eventosPorDia = useMemo(() => {
    const map = new Map<string, (AnimalEventoRow & { lote_codigo: string | null })[]>();
    for (const ev of eventos) {
      if (!ev.proxima_data) continue;
      const arr = map.get(ev.proxima_data) ?? [];
      arr.push(ev);
      map.set(ev.proxima_data, arr);
    }
    return map;
  }, [eventos]);

  const fmtMm = (n: number) => `${Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mm`;

  async function exportarProgramacao() {
    setGerandoPdf(true);
    try {
      const { gerarProgramacaoPdf } = await import("@/lib/pdf/programacao");
      await gerarProgramacaoPdf();
      toast.success("PDF gerado", "A programação foi baixada.");
    } catch (e) {
      toast.error("Erro ao gerar PDF", e instanceof Error ? e.message : undefined);
    } finally {
      setGerandoPdf(false);
    }
  }

  const renderCalendarioChuva = (compact: boolean) => (
    <CalendarioMes
      ano={chuvaAno}
      mes={chuvaMes}
      compact={compact}
      onNavigate={(a, m) => { setChuvaAno(a); setChuvaMes(m); fetchChuvas(a, m); }}
      onDiaClick={canEdit ? (cel) => setLancarChuva({ iso: cel.iso, atual: chuvaPorDia.get(cel.iso) ?? null }) : undefined}
      renderDia={(cel) => {
        const c = chuvaPorDia.get(cel.iso);
        if (!c) return null;
        return (
          <span className="text-[9px] leading-none font-semibold text-sky-600">
            {Number(c.milimetros).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
          </span>
        );
      }}
    />
  );

  return (
    <>
      <div className={layout === "column" ? "grid grid-cols-1 gap-4" : verVacinacao ? "grid grid-cols-1 lg:grid-cols-3 gap-4" : "grid grid-cols-1 lg:grid-cols-2 gap-4"}>
        {/* Calendário de Chuva */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="flex items-center gap-2">
              <CloudRain size={15} className="text-sky-600" /> Calendário de Chuva
            </CardTitle>
            <button
              onClick={() => setChuvaExpandida(true)}
              className="p-1.5 rounded-lg hover:bg-stone-100 text-stone-400 transition"
              title="Expandir"
            >
              <Maximize2 size={14} />
            </button>
          </CardHeader>
          <CardContent className="pt-3">
            {renderCalendarioChuva(true)}
            <div className="grid grid-cols-2 gap-2 mt-3 text-center">
              <div className="rounded-lg bg-sky-50 px-2 py-1.5">
                <p className="text-sm font-bold text-sky-700 leading-tight">{fmtMm(resumoChuva.total)}</p>
                <p className="text-[10px] text-stone-500">Chuva total</p>
              </div>
              <div className="rounded-lg bg-stone-50 px-2 py-1.5">
                <p className="text-sm font-bold text-stone-700 leading-tight">{resumoChuva.diasComChuva} dias</p>
                <p className="text-[10px] text-stone-500">Dias com chuva</p>
              </div>
              <div className="rounded-lg bg-stone-50 px-2 py-1.5">
                <p className="text-sm font-bold text-stone-700 leading-tight">
                  {resumoChuva.maior ? fmtMm(Number(resumoChuva.maior.milimetros)) : "—"}
                </p>
                <p className="text-[10px] text-stone-500">
                  Maior registro{resumoChuva.maior ? ` · ${formatDate(resumoChuva.maior.data)}` : ""}
                </p>
              </div>
              <div className="rounded-lg bg-stone-50 px-2 py-1.5">
                <p className="text-sm font-bold text-stone-700 leading-tight">{fmtMm(resumoChuva.media)}</p>
                <p className="text-[10px] text-stone-500">Média diária</p>
              </div>
            </div>
            {canEdit && (
              <p className="text-[10px] text-stone-400 mt-2 text-center">Clique num dia para lançar a chuva.</p>
            )}
          </CardContent>
        </Card>

        {/* Calendário de Vacinação */}
        {verVacinacao && (
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="flex items-center gap-2">
                <Syringe size={15} className="text-emerald-600" /> Calendário de Vacinação
              </CardTitle>
              <Link href="/dashboard/animais" className="text-xs text-accent-600 hover:underline">
                Ver animais
              </Link>
            </CardHeader>
            <CardContent className="pt-3">
              <CalendarioMes
                ano={vacAno}
                mes={vacMes}
                compact
                onNavigate={(a, m) => { setVacAno(a); setVacMes(m); }}
                renderDia={(cel) => {
                  const evs = eventosPorDia.get(cel.iso);
                  if (!evs?.length) return null;
                  return (
                    <span
                      title={evs.map((e) => `${e.lote_codigo ?? ""} ${e.nome}`.trim()).join(" · ")}
                      className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 text-[8px] font-bold flex items-center justify-center"
                    >
                      {evs.length}
                    </span>
                  );
                }}
              />
              <div className="mt-3 space-y-1 max-h-24 overflow-y-auto">
                {eventos
                  .filter((ev) => ev.proxima_data?.startsWith(`${vacAno}-${pad(vacMes)}`))
                  .sort((a, b) => (a.proxima_data ?? "").localeCompare(b.proxima_data ?? ""))
                  .slice(0, 6)
                  .map((ev) => (
                    <div key={ev.id} className="flex items-center gap-2 text-[11px] text-stone-600">
                      <span className="font-semibold text-emerald-700 tabular-nums shrink-0">
                        {ev.proxima_data ? formatDate(ev.proxima_data) : ""}
                      </span>
                      <span className="truncate">💉 {ev.nome}{ev.lote_codigo ? ` — ${ev.lote_codigo}` : ""}</span>
                    </div>
                  ))}
                {eventos.filter((ev) => ev.proxima_data?.startsWith(`${vacAno}-${pad(vacMes)}`)).length === 0 && (
                  <p className="text-[11px] text-stone-400 text-center py-1">
                    Nenhuma vacinação agendada em {MESES_LABEL[vacMes - 1]}.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Central de Alertas */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="flex items-center gap-2">
              <BellRing size={15} className="text-amber-600" /> Central de Alertas
              {alertas.length > 0 && <Badge variant="warning">{alertas.length}</Badge>}
            </CardTitle>
            <Button variant="outline" size="sm" onClick={exportarProgramacao} loading={gerandoPdf}>
              <FileDown size={13} /> Programação
            </Button>
          </CardHeader>
          <CardContent className="pt-3">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-stone-400">
                <Loader2 size={18} className="animate-spin" />
              </div>
            ) : alertas.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <CheckCircle2 size={28} className="text-emerald-400" />
                <p className="text-sm text-stone-500">Tudo em dia!</p>
                <p className="text-[11px] text-stone-400">
                  Sem vacinações, manutenções ou documentos vencendo nos próximos dias.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[340px] overflow-y-auto pr-1">
                {alertas.map((a) => {
                  const Icon = ALERTA_ICON[a.tipo];
                  return (
                    <Link
                      key={a.id}
                      href={a.href}
                      className="flex items-start gap-2.5 rounded-lg border border-stone-100 px-3 py-2 hover:bg-stone-50 transition"
                    >
                      <span className={`shrink-0 mt-0.5 w-7 h-7 rounded-full flex items-center justify-center ${
                        a.severidade === "critico" ? "bg-red-50 text-red-600"
                        : a.severidade === "atencao" ? "bg-amber-50 text-amber-600"
                        : "bg-sky-50 text-sky-600"
                      }`}>
                        <Icon size={14} />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-xs font-medium text-stone-800 truncate">{a.titulo}</span>
                        <span className="block text-[11px] text-stone-500 truncate">{a.detalhe}</span>
                      </span>
                      <Badge variant={SEV_VARIANT[a.severidade]} className="shrink-0">
                        {a.data ? formatDate(a.data) : "!"}
                      </Badge>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Modal — chuva expandida */}
      <Modal open={chuvaExpandida} onClose={() => setChuvaExpandida(false)} title="Calendário de Chuva" size="lg">
        <div className="p-6">
          {renderCalendarioChuva(false)}
          <p className="text-xs text-stone-400 mt-3 text-center">
            Total de {fmtMm(resumoChuva.total)} em {MESES_LABEL[chuvaMes - 1]} · {resumoChuva.diasComChuva} dia(s) com chuva
          </p>
        </div>
      </Modal>

      {/* Modal — lançar chuva do dia */}
      {lancarChuva && (
        <LancarChuvaModal
          iso={lancarChuva.iso}
          atual={lancarChuva.atual}
          onClose={() => setLancarChuva(null)}
          onSaved={() => { setLancarChuva(null); fetchChuvas(chuvaAno, chuvaMes); }}
        />
      )}
    </>
  );
}

// ============================================================================
// Modal — lançar mm de chuva num dia
// ============================================================================
function LancarChuvaModal({ iso, atual, onClose, onSaved }: {
  iso: string;
  atual: ChuvaRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [mm, setMm] = useState<string>(atual ? String(atual.milimetros) : "");

  async function salvar(remover = false) {
    setBusy(true);
    try {
      if (remover) {
        await salvarChuvaDia(iso, null);
        toast.success("Registro removido");
      } else {
        const valor = Number(String(mm).replace(",", "."));
        if (!Number.isFinite(valor) || valor < 0) {
          toast.warning("Informe um valor válido em mm.");
          setBusy(false);
          return;
        }
        await salvarChuvaDia(iso, valor);
        toast.success("Chuva registrada", `${formatDate(iso)} — ${valor.toLocaleString("pt-BR")} mm`);
      }
      onSaved();
    } catch (e) {
      toast.error("Erro ao salvar", e instanceof Error ? e.message : "Aplique a migration 0040 no SQL Editor.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Chuva em ${formatDate(iso)}`} size="sm">
      <div className="p-6 space-y-4">
        <Input
          label="Milímetros (mm)"
          type="number" min={0} step="0.1"
          placeholder="12,4"
          value={mm}
          onChange={(e) => setMm(e.target.value)}
          autoFocus
        />
      </div>
      <div className="px-6 py-4 border-t border-stone-100 flex items-center justify-between gap-2 bg-stone-50/50">
        {atual ? (
          <Button variant="danger" size="sm" onClick={() => salvar(true)} disabled={busy}>
            Remover
          </Button>
        ) : <span />}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={() => salvar()} loading={busy}>Salvar</Button>
        </div>
      </div>
    </Modal>
  );
}
