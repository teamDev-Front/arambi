"use client";
// Estoque de Animais — cadastro por LOTE (decisão do call de 14/jul/2026).
// Cards por espécie + abas (Lotes | Vacinações | Ocorrências | Calendário).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PawPrint, Plus, Pencil, Trash2, Syringe, HeartPulse, CalendarDays,
  ClipboardList, Settings2, CheckCircle2, RotateCcw, Search,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Tabs } from "@/components/ui/Tabs";
import { CalendarioMes, isoLocalHoje } from "@/components/ui/CalendarioMes";
import { useToast } from "@/components/ui/Toast";
import { UnsavedChangesDialog } from "@/components/ui/UnsavedChangesDialog";
import { useUnsavedGuard } from "@/lib/hooks/useUnsavedGuard";
import { formatDate } from "@/lib/utils/format";
import { obterRoleAtual } from "@/lib/queries/configuracoes";
import {
  listarEspecies, criarEspecie, atualizarEspecie,
  listarLotes, criarLote, atualizarLote, excluirLote,
  listarEventos, criarEvento, atualizarEvento, excluirEvento,
  listarOcorrencias, criarOcorrencia, setOcorrenciaResolvida, excluirOcorrencia,
  type LoteFormPayload, type EventoFormPayload,
} from "@/lib/queries/animais";
import type {
  AnimalEspecieRow, AnimalLoteRow, AnimalEventoRow, AnimalOcorrenciaRow,
  AnimalLoteStatus, AnimalEventoTipo, OcorrenciaSeveridade,
} from "@/types";
import {
  ANIMAL_LOTE_STATUS_LABEL, ANIMAL_EVENTO_TIPO_LABEL, OCORRENCIA_SEVERIDADE_LABEL,
} from "@/types";

type Aba = "lotes" | "eventos" | "ocorrencias" | "calendario";

const LOTE_STATUS_VARIANT: Record<AnimalLoteStatus, BadgeVariant> = {
  ativo: "success", vendido: "info", abatido: "neutral", inativo: "neutral",
};
const SEVERIDADE_VARIANT: Record<OcorrenciaSeveridade, BadgeVariant> = {
  info: "info", atencao: "warning", critico: "danger",
};
const EVENTO_TIPO_VARIANT: Record<AnimalEventoTipo, BadgeVariant> = {
  vacina: "info", vermifugo: "success", outro: "neutral",
};

export function AnimaisPage() {
  const toast = useToast();
  const [aba, setAba] = useState<Aba>("lotes");
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [especies, setEspecies] = useState<AnimalEspecieRow[]>([]);
  const [lotes, setLotes] = useState<AnimalLoteRow[]>([]);
  const [eventos, setEventos] = useState<AnimalEventoRow[]>([]);
  const [ocorrencias, setOcorrencias] = useState<AnimalOcorrenciaRow[]>([]);

  // Filtros
  const [fEspecie, setFEspecie] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [busca, setBusca] = useState("");

  // Modais
  const [loteModal, setLoteModal] = useState<{ open: boolean; editando: AnimalLoteRow | null }>({ open: false, editando: null });
  const [eventoModal, setEventoModal] = useState<{ open: boolean; editando: AnimalEventoRow | null; loteId?: string }>({ open: false, editando: null });
  const [ocorrenciaModal, setOcorrenciaModal] = useState<{ open: boolean; loteId?: string }>({ open: false });
  const [especiesModal, setEspeciesModal] = useState(false);
  const [confirmExcluir, setConfirmExcluir] = useState<{ tipo: "lote" | "evento" | "ocorrencia"; id: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [esp, lts, evs, ocs] = await Promise.all([
        listarEspecies(true), listarLotes(), listarEventos(), listarOcorrencias(),
      ]);
      setEspecies(esp);
      setLotes(lts);
      setEventos(evs);
      setOcorrencias(ocs);
    } catch (e) {
      toast.error("Erro ao carregar animais", e instanceof Error ? e.message : "Aplique a migration 0038 no SQL Editor.");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchAll();
    obterRoleAtual().then((r) => {
      setCanEdit(r === "admin" || r === "editor");
      setIsAdmin(r === "admin");
    }).catch(() => {});
  }, [fetchAll]);

  // --------------------------------------------------------------------------
  // Derivados
  // --------------------------------------------------------------------------
  const especieById = useMemo(() => new Map(especies.map((e) => [e.id, e])), [especies]);
  const loteById = useMemo(() => new Map(lotes.map((l) => [l.id, l])), [lotes]);
  const hoje = isoLocalHoje();

  /** Última aplicação e próxima dose por lote (derivado dos eventos). */
  const vacinacaoPorLote = useMemo(() => {
    const map = new Map<string, { ultima: string | null; proxima: string | null }>();
    for (const ev of eventos) {
      const atual = map.get(ev.lote_id) ?? { ultima: null, proxima: null };
      if (ev.data_aplicacao && (!atual.ultima || ev.data_aplicacao > atual.ultima)) atual.ultima = ev.data_aplicacao;
      if (ev.proxima_data && ev.proxima_data >= hoje && (!atual.proxima || ev.proxima_data < atual.proxima)) atual.proxima = ev.proxima_data;
      map.set(ev.lote_id, atual);
    }
    return map;
  }, [eventos, hoje]);

  const ocorrenciasAbertasPorLote = useMemo(() => {
    const map = new Map<string, OcorrenciaSeveridade>();
    const peso: Record<OcorrenciaSeveridade, number> = { info: 0, atencao: 1, critico: 2 };
    for (const oc of ocorrencias) {
      if (oc.resolvida) continue;
      const atual = map.get(oc.lote_id);
      if (!atual || peso[oc.severidade] > peso[atual]) map.set(oc.lote_id, oc.severidade);
    }
    return map;
  }, [ocorrencias]);

  const lotesFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return lotes.filter((l) => {
      if (fEspecie && l.especie_id !== fEspecie) return false;
      if (fStatus && l.status !== fStatus) return false;
      if (q) {
        const alvo = `${l.codigo} ${l.categoria ?? ""} ${l.raca ?? ""}`.toLowerCase();
        if (!alvo.includes(q)) return false;
      }
      return true;
    });
  }, [lotes, fEspecie, fStatus, busca]);

  /** Total de cabeças por espécie (só lotes ativos). */
  const resumoPorEspecie = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of lotes) {
      if (l.status !== "ativo") continue;
      map.set(l.especie_id, (map.get(l.especie_id) ?? 0) + l.quantidade);
    }
    return map;
  }, [lotes]);

  const totalCabecas = useMemo(
    () => [...resumoPorEspecie.values()].reduce((a, b) => a + b, 0),
    [resumoPorEspecie],
  );

  const eventosPorDia = useMemo(() => {
    const map = new Map<string, AnimalEventoRow[]>();
    for (const ev of eventos) {
      if (!ev.proxima_data) continue;
      const arr = map.get(ev.proxima_data) ?? [];
      arr.push(ev);
      map.set(ev.proxima_data, arr);
    }
    return map;
  }, [eventos]);

  const [calAno, setCalAno] = useState(() => new Date().getFullYear());
  const [calMes, setCalMes] = useState(() => new Date().getMonth() + 1);

  // --------------------------------------------------------------------------
  // Ações
  // --------------------------------------------------------------------------
  async function handleExcluir() {
    if (!confirmExcluir) return;
    setBusy(true);
    try {
      if (confirmExcluir.tipo === "lote") await excluirLote(confirmExcluir.id);
      else if (confirmExcluir.tipo === "evento") await excluirEvento(confirmExcluir.id);
      else await excluirOcorrencia(confirmExcluir.id);
      toast.success("Excluído com sucesso");
      setConfirmExcluir(null);
      fetchAll();
    } catch (e) {
      toast.error("Erro ao excluir", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  // --------------------------------------------------------------------------
  // Colunas
  // --------------------------------------------------------------------------
  const colunasLotes: Column<AnimalLoteRow>[] = [
    { key: "codigo", header: "Lote", sortable: true, render: (l) => <span className="font-medium text-stone-800">{l.codigo}</span> },
    {
      key: "especie_id", header: "Espécie",
      render: (l) => {
        const esp = especieById.get(l.especie_id);
        return <span>{esp ? `${esp.icone} ${esp.nome}` : "—"}</span>;
      },
    },
    { key: "categoria", header: "Categoria", render: (l) => l.categoria ?? "—" },
    { key: "raca", header: "Raça", render: (l) => l.raca ?? "—" },
    { key: "idade_meses", header: "Idade", align: "center", render: (l) => (l.idade_meses != null ? `${l.idade_meses} meses` : "—") },
    { key: "quantidade", header: "Qtd", align: "center", sortable: true, render: (l) => <span className="font-semibold">{l.quantidade}</span> },
    {
      key: "status", header: "Status", align: "center",
      render: (l) => <Badge variant={LOTE_STATUS_VARIANT[l.status]}>{ANIMAL_LOTE_STATUS_LABEL[l.status]}</Badge>,
    },
    {
      key: "ultima_vac", header: "Última Vacinação", align: "center",
      render: (l) => {
        const v = vacinacaoPorLote.get(l.id);
        return v?.ultima ? formatDate(v.ultima) : "—";
      },
    },
    {
      key: "proxima_vac", header: "Próxima Vacinação", align: "center",
      render: (l) => {
        const v = vacinacaoPorLote.get(l.id);
        if (!v?.proxima) return "—";
        const dias = Math.round((new Date(v.proxima + "T00:00").getTime() - new Date(hoje + "T00:00").getTime()) / 86400000);
        return (
          <span className={dias <= 15 ? "text-amber-700 font-medium" : undefined}>
            {formatDate(v.proxima)}
            {dias <= 15 && <span className="block text-[10px]">em {dias} dia{dias === 1 ? "" : "s"}</span>}
          </span>
        );
      },
    },
    {
      key: "saude", header: "Saúde", align: "center",
      render: (l) => {
        const sev = ocorrenciasAbertasPorLote.get(l.id);
        return sev
          ? <Badge variant={SEVERIDADE_VARIANT[sev]}>{OCORRENCIA_SEVERIDADE_LABEL[sev]}</Badge>
          : <Badge variant="success">OK</Badge>;
      },
    },
    {
      key: "acoes", header: "Ações", align: "right",
      render: (l) => canEdit ? (
        <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
          <button title="Registrar vacinação" onClick={() => setEventoModal({ open: true, editando: null, loteId: l.id })} className="p-1.5 rounded hover:bg-stone-100 text-stone-500"><Syringe size={14} /></button>
          <button title="Registrar ocorrência" onClick={() => setOcorrenciaModal({ open: true, loteId: l.id })} className="p-1.5 rounded hover:bg-stone-100 text-stone-500"><HeartPulse size={14} /></button>
          <button title="Editar" onClick={() => setLoteModal({ open: true, editando: l })} className="p-1.5 rounded hover:bg-stone-100 text-stone-500"><Pencil size={14} /></button>
          <button title="Excluir" onClick={() => setConfirmExcluir({ tipo: "lote", id: l.id, label: l.codigo })} className="p-1.5 rounded hover:bg-red-50 text-stone-500 hover:text-red-600"><Trash2 size={14} /></button>
        </span>
      ) : null,
    },
  ];

  const colunasEventos: Column<AnimalEventoRow>[] = [
    { key: "lote_id", header: "Lote", render: (ev) => loteById.get(ev.lote_id)?.codigo ?? "—" },
    { key: "tipo", header: "Tipo", align: "center", render: (ev) => <Badge variant={EVENTO_TIPO_VARIANT[ev.tipo]}>{ANIMAL_EVENTO_TIPO_LABEL[ev.tipo]}</Badge> },
    { key: "nome", header: "Vacina / Produto", render: (ev) => <span className="font-medium text-stone-800">{ev.nome}</span> },
    { key: "data_aplicacao", header: "Aplicada em", align: "center", sortable: true, render: (ev) => (ev.data_aplicacao ? formatDate(ev.data_aplicacao) : <Badge variant="warning">Agendada</Badge>) },
    {
      key: "proxima_data", header: "Próxima dose", align: "center", sortable: true,
      render: (ev) => {
        if (!ev.proxima_data) return "—";
        const vencida = ev.proxima_data < hoje;
        return <span className={vencida ? "text-red-600 font-medium" : undefined}>{formatDate(ev.proxima_data)}</span>;
      },
    },
    { key: "observacao", header: "Observação", render: (ev) => <span className="text-stone-500 text-xs">{ev.observacao ?? "—"}</span> },
    {
      key: "acoes", header: "Ações", align: "right",
      render: (ev) => canEdit ? (
        <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
          <button title="Editar" onClick={() => setEventoModal({ open: true, editando: ev })} className="p-1.5 rounded hover:bg-stone-100 text-stone-500"><Pencil size={14} /></button>
          <button title="Excluir" onClick={() => setConfirmExcluir({ tipo: "evento", id: ev.id, label: ev.nome })} className="p-1.5 rounded hover:bg-red-50 text-stone-500 hover:text-red-600"><Trash2 size={14} /></button>
        </span>
      ) : null,
    },
  ];

  const colunasOcorrencias: Column<AnimalOcorrenciaRow>[] = [
    { key: "data", header: "Data", align: "center", sortable: true, render: (oc) => formatDate(oc.data) },
    { key: "lote_id", header: "Lote", render: (oc) => loteById.get(oc.lote_id)?.codigo ?? "—" },
    { key: "descricao", header: "Descrição", render: (oc) => <span className={oc.resolvida ? "text-stone-400 line-through" : undefined}>{oc.descricao}</span> },
    { key: "severidade", header: "Severidade", align: "center", render: (oc) => <Badge variant={SEVERIDADE_VARIANT[oc.severidade]}>{OCORRENCIA_SEVERIDADE_LABEL[oc.severidade]}</Badge> },
    {
      key: "resolvida", header: "Situação", align: "center",
      render: (oc) => oc.resolvida ? <Badge variant="success">Resolvida</Badge> : <Badge variant="warning">Em aberto</Badge>,
    },
    {
      key: "acoes", header: "Ações", align: "right",
      render: (oc) => canEdit ? (
        <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            title={oc.resolvida ? "Reabrir" : "Marcar como resolvida"}
            onClick={async () => {
              try {
                await setOcorrenciaResolvida(oc.id, !oc.resolvida);
                fetchAll();
              } catch (e) {
                toast.error("Erro ao alterar", e instanceof Error ? e.message : undefined);
              }
            }}
            className="p-1.5 rounded hover:bg-stone-100 text-stone-500"
          >
            {oc.resolvida ? <RotateCcw size={14} /> : <CheckCircle2 size={14} />}
          </button>
          <button title="Excluir" onClick={() => setConfirmExcluir({ tipo: "ocorrencia", id: oc.id, label: oc.descricao.slice(0, 40) })} className="p-1.5 rounded hover:bg-red-50 text-stone-500 hover:text-red-600"><Trash2 size={14} /></button>
        </span>
      ) : null,
    },
  ];

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------
  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#e8f0ee] text-[#1a4d40] flex items-center justify-center">
            <PawPrint size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#0f1f1c]">Estoque de Animais</h1>
            <p className="text-sm text-stone-500">Controle do rebanho por lote — vacinação, vermifugação e saúde.</p>
          </div>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={() => setEspeciesModal(true)}>
              <Settings2 size={14} /> Espécies
            </Button>
          )}
          {canEdit && (
            <Button size="sm" onClick={() => setLoteModal({ open: true, editando: null })}>
              <Plus size={14} /> Novo Lote
            </Button>
          )}
        </div>
      </div>

      {/* Cards de resumo por espécie */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        {especies.filter((e) => e.ativo).map((esp) => (
          <button
            key={esp.id}
            onClick={() => setFEspecie(fEspecie === esp.id ? "" : esp.id)}
            className={`bg-white rounded-xl border p-4 flex flex-col items-center gap-1 shadow-sm transition text-center ${
              fEspecie === esp.id ? "border-accent-400 ring-2 ring-accent-400/30" : "border-stone-200 hover:border-stone-300"
            }`}
          >
            <span className="text-2xl leading-none">{esp.icone}</span>
            <span className="text-lg font-bold text-stone-900">{resumoPorEspecie.get(esp.id) ?? 0}</span>
            <span className="text-[11px] text-stone-500">{esp.nome}</span>
          </button>
        ))}
        <div className="bg-[#1a2e28] rounded-xl p-4 flex flex-col items-center gap-1 shadow-sm text-center">
          <span className="text-2xl leading-none">🐾</span>
          <span className="text-lg font-bold text-white">{totalCabecas}</span>
          <span className="text-[11px] text-stone-300">Total de animais</span>
        </div>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-4">
          <div className="w-44">
            <Select label="Espécie" value={fEspecie} onChange={(e) => setFEspecie(e.target.value)}>
              <option value="">Todas</option>
              {especies.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </Select>
          </div>
          <div className="w-40">
            <Select label="Status" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
              <option value="">Todos</option>
              {(Object.keys(ANIMAL_LOTE_STATUS_LABEL) as AnimalLoteStatus[]).map((s) => (
                <option key={s} value={s}>{ANIMAL_LOTE_STATUS_LABEL[s]}</option>
              ))}
            </Select>
          </div>
          <div className="flex-1 min-w-52">
            <Input
              label="Buscar"
              placeholder="Lote, categoria ou raça..."
              icon={<Search size={14} />}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          {(fEspecie || fStatus || busca) && (
            <Button variant="ghost" size="sm" onClick={() => { setFEspecie(""); setFStatus(""); setBusca(""); }}>
              Limpar
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Abas */}
      <Tabs<Aba>
        tabs={[
          { id: "lotes", label: "Lotes", icon: ClipboardList, count: lotesFiltrados.length },
          { id: "eventos", label: "Vacinações & Vermifugações", icon: Syringe, count: eventos.length },
          { id: "ocorrencias", label: "Ocorrências", icon: HeartPulse, count: ocorrencias.filter((o) => !o.resolvida).length },
          { id: "calendario", label: "Calendário", icon: CalendarDays },
        ]}
        active={aba}
        onChange={setAba}
      />

      {aba === "lotes" && (
        <DataTable columns={colunasLotes} data={lotesFiltrados} loading={loading} emptyMessage="Nenhum lote cadastrado. Clique em “Novo Lote” para começar." />
      )}

      {aba === "eventos" && (
        <div className="space-y-3">
          {canEdit && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setEventoModal({ open: true, editando: null })}>
                <Plus size={14} /> Registrar Vacinação
              </Button>
            </div>
          )}
          <DataTable columns={colunasEventos} data={eventos} loading={loading} emptyMessage="Nenhuma vacinação registrada." />
        </div>
      )}

      {aba === "ocorrencias" && (
        <div className="space-y-3">
          {canEdit && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setOcorrenciaModal({ open: true })}>
                <Plus size={14} /> Nova Ocorrência
              </Button>
            </div>
          )}
          <DataTable columns={colunasOcorrencias} data={ocorrencias} loading={loading} emptyMessage="Nenhuma ocorrência de saúde registrada." />
        </div>
      )}

      {aba === "calendario" && (
        <Card>
          <CardHeader>
            <CardTitle>Calendário de Vacinação</CardTitle>
            <span className="text-xs text-stone-400">Próximas doses agendadas por dia</span>
          </CardHeader>
          <CardContent>
            <CalendarioMes
              ano={calAno}
              mes={calMes}
              onNavigate={(a, m) => { setCalAno(a); setCalMes(m); }}
              renderDia={(cel) => {
                const evs = eventosPorDia.get(cel.iso);
                if (!evs?.length) return null;
                return (
                  <div className="flex flex-col items-center gap-0.5 w-full px-0.5">
                    {evs.slice(0, 2).map((ev) => (
                      <span key={ev.id} title={`${loteById.get(ev.lote_id)?.codigo ?? ""} — ${ev.nome}`} className="w-full truncate text-center text-[9px] leading-tight px-1 py-0.5 rounded bg-sky-100 text-sky-800">
                        💉 {ev.nome}
                      </span>
                    ))}
                    {evs.length > 2 && <span className="text-[9px] text-stone-400">+{evs.length - 2}</span>}
                  </div>
                );
              }}
            />
          </CardContent>
        </Card>
      )}

      {/* Modais */}
      {loteModal.open && (
        <LoteModal
          editando={loteModal.editando}
          especies={especies.filter((e) => e.ativo)}
          onClose={() => setLoteModal({ open: false, editando: null })}
          onSaved={() => { setLoteModal({ open: false, editando: null }); fetchAll(); }}
        />
      )}
      {eventoModal.open && (
        <EventoModal
          editando={eventoModal.editando}
          loteIdInicial={eventoModal.loteId}
          lotes={lotes}
          onClose={() => setEventoModal({ open: false, editando: null })}
          onSaved={() => { setEventoModal({ open: false, editando: null }); fetchAll(); }}
        />
      )}
      {ocorrenciaModal.open && (
        <OcorrenciaModal
          loteIdInicial={ocorrenciaModal.loteId}
          lotes={lotes}
          onClose={() => setOcorrenciaModal({ open: false })}
          onSaved={() => { setOcorrenciaModal({ open: false }); fetchAll(); }}
        />
      )}
      {especiesModal && (
        <EspeciesModal
          especies={especies}
          onClose={() => setEspeciesModal(false)}
          onChanged={fetchAll}
        />
      )}
      <ConfirmDialog
        open={!!confirmExcluir}
        title={`Excluir ${confirmExcluir?.tipo === "lote" ? "lote" : confirmExcluir?.tipo === "evento" ? "vacinação" : "ocorrência"}?`}
        description={`"${confirmExcluir?.label ?? ""}" será excluído permanentemente.${confirmExcluir?.tipo === "lote" ? " Vacinações e ocorrências do lote também serão removidas." : ""}`}
        tone="danger"
        confirmText="Excluir"
        busy={busy}
        onConfirm={handleExcluir}
        onCancel={() => setConfirmExcluir(null)}
      />
    </div>
  );
}

// ============================================================================
// Modal — Lote
// ============================================================================
function LoteModal({ editando, especies, onClose, onSaved }: {
  editando: AnimalLoteRow | null;
  especies: AnimalEspecieRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<LoteFormPayload>({
    codigo: editando?.codigo ?? "",
    especie_id: editando?.especie_id ?? (especies[0]?.id ?? ""),
    categoria: editando?.categoria ?? null,
    raca: editando?.raca ?? null,
    idade_meses: editando?.idade_meses ?? null,
    quantidade: editando?.quantidade ?? 0,
    status: editando?.status ?? "ativo",
    observacoes: editando?.observacoes ?? null,
  });
  const guard = useUnsavedGuard(true, form, onClose);

  async function salvar() {
    if (!form.codigo.trim()) { toast.warning("Informe o código do lote."); return; }
    if (!form.especie_id) { toast.warning("Selecione a espécie."); return; }
    setBusy(true);
    try {
      if (editando) await atualizarLote(editando.id, form);
      else await criarLote(form);
      toast.success(editando ? "Lote atualizado" : "Lote criado");
      onSaved();
    } catch (e) {
      toast.error("Erro ao salvar lote", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={guard.requestClose} title={editando ? `Editar ${editando.codigo}` : "Novo Lote"} size="lg" closeOnBackdrop={false}>
      <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input label="Código do lote *" placeholder="LOTE-01" value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} />
        <Select label="Espécie *" value={form.especie_id} onChange={(e) => setForm({ ...form, especie_id: e.target.value })}>
          {especies.map((esp) => <option key={esp.id} value={esp.id}>{esp.icone} {esp.nome}</option>)}
        </Select>
        <Input label="Categoria" placeholder="Leiteiras, Matriz, Bezerros..." value={form.categoria ?? ""} onChange={(e) => setForm({ ...form, categoria: e.target.value || null })} />
        <Input label="Raça" placeholder="Girolando, Nelore..." value={form.raca ?? ""} onChange={(e) => setForm({ ...form, raca: e.target.value || null })} />
        <Input label="Idade (meses)" type="number" min={0} value={form.idade_meses ?? ""} onChange={(e) => setForm({ ...form, idade_meses: e.target.value === "" ? null : Number(e.target.value) })} />
        <Input label="Quantidade de cabeças *" type="number" min={0} value={form.quantidade} onChange={(e) => setForm({ ...form, quantidade: Math.max(0, Number(e.target.value) || 0) })} />
        <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as AnimalLoteStatus })}>
          {(Object.keys(ANIMAL_LOTE_STATUS_LABEL) as AnimalLoteStatus[]).map((s) => (
            <option key={s} value={s}>{ANIMAL_LOTE_STATUS_LABEL[s]}</option>
          ))}
        </Select>
        <div className="sm:col-span-2">
          <Textarea label="Observações" rows={3} placeholder="Anotações gerais do lote..." value={form.observacoes ?? ""} onChange={(e) => setForm({ ...form, observacoes: e.target.value || null })} />
        </div>
      </div>
      <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-2 bg-stone-50/50">
        <Button variant="ghost" onClick={guard.requestClose} disabled={busy}>Cancelar</Button>
        <Button onClick={salvar} loading={busy}>{editando ? "Salvar" : "Criar Lote"}</Button>
      </div>
      <UnsavedChangesDialog open={guard.confirmOpen} onStay={guard.stay} onDiscard={guard.discard} />
    </Modal>
  );
}

// ============================================================================
// Modal — Evento sanitário (vacina / vermífugo)
// ============================================================================
function EventoModal({ editando, loteIdInicial, lotes, onClose, onSaved }: {
  editando: AnimalEventoRow | null;
  loteIdInicial?: string;
  lotes: AnimalLoteRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<EventoFormPayload>({
    lote_id: editando?.lote_id ?? loteIdInicial ?? (lotes[0]?.id ?? ""),
    tipo: editando?.tipo ?? "vacina",
    nome: editando?.nome ?? "",
    data_aplicacao: editando?.data_aplicacao ?? isoLocalHoje(),
    proxima_data: editando?.proxima_data ?? null,
    observacao: editando?.observacao ?? null,
  });
  const guard = useUnsavedGuard(true, form, onClose);

  async function salvar() {
    if (!form.lote_id) { toast.warning("Selecione o lote."); return; }
    if (!form.nome.trim()) { toast.warning("Informe o nome da vacina/produto."); return; }
    setBusy(true);
    try {
      if (editando) await atualizarEvento(editando.id, form);
      else await criarEvento(form);
      toast.success(editando ? "Registro atualizado" : "Vacinação registrada");
      onSaved();
    } catch (e) {
      toast.error("Erro ao salvar", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={guard.requestClose} title={editando ? "Editar Vacinação" : "Registrar Vacinação"} size="lg" closeOnBackdrop={false}>
      <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Select label="Lote *" value={form.lote_id} onChange={(e) => setForm({ ...form, lote_id: e.target.value })}>
          {lotes.map((l) => <option key={l.id} value={l.id}>{l.codigo}</option>)}
        </Select>
        <Select label="Tipo" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as AnimalEventoTipo })}>
          {(Object.keys(ANIMAL_EVENTO_TIPO_LABEL) as AnimalEventoTipo[]).map((t) => (
            <option key={t} value={t}>{ANIMAL_EVENTO_TIPO_LABEL[t]}</option>
          ))}
        </Select>
        <Input label="Vacina / Produto *" placeholder="Brucelose, Raiva, Ivermectina..." value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
        <div />
        <Input label="Data de aplicação" type="date" value={form.data_aplicacao ?? ""} onChange={(e) => setForm({ ...form, data_aplicacao: e.target.value || null })} />
        <Input label="Próxima dose (alimenta o calendário)" type="date" value={form.proxima_data ?? ""} onChange={(e) => setForm({ ...form, proxima_data: e.target.value || null })} />
        <div className="sm:col-span-2">
          <Textarea label="Observação" rows={2} value={form.observacao ?? ""} onChange={(e) => setForm({ ...form, observacao: e.target.value || null })} />
        </div>
      </div>
      <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-2 bg-stone-50/50">
        <Button variant="ghost" onClick={guard.requestClose} disabled={busy}>Cancelar</Button>
        <Button onClick={salvar} loading={busy}>{editando ? "Salvar" : "Registrar"}</Button>
      </div>
      <UnsavedChangesDialog open={guard.confirmOpen} onStay={guard.stay} onDiscard={guard.discard} />
    </Modal>
  );
}

// ============================================================================
// Modal — Ocorrência de saúde
// ============================================================================
function OcorrenciaModal({ loteIdInicial, lotes, onClose, onSaved }: {
  loteIdInicial?: string;
  lotes: AnimalLoteRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    lote_id: loteIdInicial ?? (lotes[0]?.id ?? ""),
    data: isoLocalHoje(),
    descricao: "",
    severidade: "atencao" as OcorrenciaSeveridade,
  });
  const guard = useUnsavedGuard(true, form, onClose);

  async function salvar() {
    if (!form.lote_id) { toast.warning("Selecione o lote."); return; }
    if (!form.descricao.trim()) { toast.warning("Descreva a ocorrência."); return; }
    setBusy(true);
    try {
      await criarOcorrencia(form);
      toast.success("Ocorrência registrada");
      onSaved();
    } catch (e) {
      toast.error("Erro ao registrar", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={guard.requestClose} title="Nova Ocorrência de Saúde" size="lg" closeOnBackdrop={false}>
      <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Select label="Lote *" value={form.lote_id} onChange={(e) => setForm({ ...form, lote_id: e.target.value })}>
          {lotes.map((l) => <option key={l.id} value={l.id}>{l.codigo}</option>)}
        </Select>
        <Input label="Data" type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} />
        <div className="sm:col-span-2">
          <Textarea label="Descrição *" rows={3} placeholder="Ex.: 1 vaca com sinal de mastite — iniciado tratamento..." value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
        </div>
        <Select label="Severidade" value={form.severidade} onChange={(e) => setForm({ ...form, severidade: e.target.value as OcorrenciaSeveridade })}>
          {(Object.keys(OCORRENCIA_SEVERIDADE_LABEL) as OcorrenciaSeveridade[]).map((s) => (
            <option key={s} value={s}>{OCORRENCIA_SEVERIDADE_LABEL[s]}</option>
          ))}
        </Select>
      </div>
      <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-2 bg-stone-50/50">
        <Button variant="ghost" onClick={guard.requestClose} disabled={busy}>Cancelar</Button>
        <Button onClick={salvar} loading={busy}>Registrar</Button>
      </div>
      <UnsavedChangesDialog open={guard.confirmOpen} onStay={guard.stay} onDiscard={guard.discard} />
    </Modal>
  );
}

// ============================================================================
// Modal — Gerenciar espécies (admin)
// ============================================================================
function EspeciesModal({ especies, onClose, onChanged }: {
  especies: AnimalEspecieRow[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [novo, setNovo] = useState({ nome: "", icone: "🐄" });

  async function adicionar() {
    if (!novo.nome.trim()) { toast.warning("Informe o nome da espécie."); return; }
    setBusy(true);
    try {
      await criarEspecie({ nome: novo.nome, icone: novo.icone, ordem: especies.length + 1 });
      toast.success("Espécie criada");
      setNovo({ nome: "", icone: "🐄" });
      onChanged();
    } catch (e) {
      toast.error("Erro ao criar espécie", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function toggleAtivo(esp: AnimalEspecieRow) {
    try {
      await atualizarEspecie(esp.id, { nome: esp.nome, icone: esp.icone, ordem: esp.ordem, ativo: !esp.ativo });
      onChanged();
    } catch (e) {
      toast.error("Erro ao alterar", e instanceof Error ? e.message : undefined);
    }
  }

  return (
    <Modal open onClose={onClose} title="Gerenciar Espécies" size="md">
      <div className="p-6 space-y-4">
        <div className="flex items-end gap-2">
          <div className="w-20">
            <Input label="Ícone" value={novo.icone} onChange={(e) => setNovo({ ...novo, icone: e.target.value })} />
          </div>
          <div className="flex-1">
            <Input label="Nova espécie" placeholder="Búfalos" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
          </div>
          <Button onClick={adicionar} loading={busy}><Plus size={14} /> Adicionar</Button>
        </div>
        <div className="divide-y divide-stone-100 border border-stone-200 rounded-lg">
          {especies.map((esp) => (
            <div key={esp.id} className="flex items-center justify-between px-4 py-2.5">
              <span className={`text-sm ${esp.ativo ? "text-stone-800" : "text-stone-400 line-through"}`}>
                {esp.icone} {esp.nome}
              </span>
              <Button variant="ghost" size="sm" onClick={() => toggleAtivo(esp)}>
                {esp.ativo ? "Inativar" : "Reativar"}
              </Button>
            </div>
          ))}
        </div>
        <p className="text-xs text-stone-400">
          Espécies inativas não aparecem nos cards nem em novos lotes, mas os lotes existentes são preservados.
        </p>
      </div>
    </Modal>
  );
}
