"use client";
// Horta & Canteiros — canteiros numerados com ciclo de cultura (call 14/jul):
// cultura, área, data de plantio, previsão MANUAL de colheita (pré-preenchida
// pelo ciclo padrão da cultura) e status editável direto no card.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Carrot, Plus, Settings2, Sprout, History, Trash2, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Tabs } from "@/components/ui/Tabs";
import { isoLocalHoje } from "@/components/ui/CalendarioMes";
import { useToast } from "@/components/ui/Toast";
import { UnsavedChangesDialog } from "@/components/ui/UnsavedChangesDialog";
import { useUnsavedGuard } from "@/lib/hooks/useUnsavedGuard";
import { formatDate } from "@/lib/utils/format";
import { obterRoleAtual } from "@/lib/queries/configuracoes";
import {
  listarCulturasHorta, criarCulturaHorta, atualizarCulturaHorta,
  listarCanteiros, criarCanteiro, atualizarCanteiro,
  listarCiclos, criarCiclo, atualizarCiclo, excluirCiclo,
} from "@/lib/queries/horta";
import type { HortaCulturaRow, CanteiroRow, CanteiroCicloRow, CanteiroCicloStatus } from "@/types";
import { CANTEIRO_CICLO_STATUS_LABEL } from "@/types";

type Aba = "canteiros" | "historico";

const STATUS_VARIANT: Record<CanteiroCicloStatus, BadgeVariant> = {
  plantado: "info", crescimento: "success", colheita: "warning", finalizado: "neutral",
};

function diasEntre(deIso: string, ateIso: string): number {
  return Math.round((new Date(ateIso + "T00:00").getTime() - new Date(deIso + "T00:00").getTime()) / 86400000);
}

function somarDias(iso: string, dias: number): string {
  const d = new Date(iso + "T00:00");
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function HortaPage() {
  const toast = useToast();
  const [aba, setAba] = useState<Aba>("canteiros");
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);

  const [culturas, setCulturas] = useState<HortaCulturaRow[]>([]);
  const [canteiros, setCanteiros] = useState<CanteiroRow[]>([]);
  const [ciclos, setCiclos] = useState<CanteiroCicloRow[]>([]);

  const [plantarModal, setPlantarModal] = useState<{ open: boolean; canteiroId?: string }>({ open: false });
  const [canteiroModal, setCanteiroModal] = useState(false);
  const [culturasModal, setCulturasModal] = useState(false);
  const [confirmExcluir, setConfirmExcluir] = useState<CanteiroCicloRow | null>(null);
  const [busy, setBusy] = useState(false);

  const hoje = isoLocalHoje();

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [cul, can, cic] = await Promise.all([listarCulturasHorta(), listarCanteiros(), listarCiclos()]);
      setCulturas(cul);
      setCanteiros(can);
      setCiclos(cic);
    } catch (e) {
      toast.error("Erro ao carregar horta", e instanceof Error ? e.message : "Aplique a migration 0042 no SQL Editor.");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchAll();
    obterRoleAtual().then((r) => setCanEdit(r === "admin" || r === "editor")).catch(() => {});
  }, [fetchAll]);

  const culturaById = useMemo(() => new Map(culturas.map((c) => [c.id, c])), [culturas]);
  const canteiroById = useMemo(() => new Map(canteiros.map((c) => [c.id, c])), [canteiros]);

  /** Ciclo ATIVO (não finalizado) por canteiro. */
  const cicloAtivoPorCanteiro = useMemo(() => {
    const map = new Map<string, CanteiroCicloRow>();
    for (const c of ciclos) {
      if (c.status === "finalizado") continue;
      const atual = map.get(c.canteiro_id);
      if (!atual || c.data_plantio > atual.data_plantio) map.set(c.canteiro_id, c);
    }
    return map;
  }, [ciclos]);

  const historico = useMemo(() => ciclos.filter((c) => c.status === "finalizado"), [ciclos]);

  async function mudarStatus(ciclo: CanteiroCicloRow, status: CanteiroCicloStatus) {
    try {
      await atualizarCiclo(ciclo.id, status === "finalizado" ? { status, colhido_em: hoje } : { status });
      toast.success(status === "finalizado" ? "Ciclo finalizado! Canteiro liberado." : "Status atualizado");
      fetchAll();
    } catch (e) {
      toast.error("Erro ao atualizar", e instanceof Error ? e.message : undefined);
    }
  }

  const colHistorico: Column<CanteiroCicloRow>[] = [
    { key: "canteiro_id", header: "Canteiro", render: (c) => `Canteiro ${canteiroById.get(c.canteiro_id)?.numero ?? "?"}` },
    { key: "cultura_id", header: "Cultura", render: (c) => <span className="font-medium text-stone-800">{culturaById.get(c.cultura_id)?.nome ?? "—"}</span> },
    { key: "data_plantio", header: "Plantio", align: "center", sortable: true, render: (c) => formatDate(c.data_plantio) },
    { key: "colhido_em", header: "Colheita", align: "center", render: (c) => (c.colhido_em ? formatDate(c.colhido_em) : "—") },
    {
      key: "duracao", header: "Duração", align: "center",
      render: (c) => c.colhido_em ? `${diasEntre(c.data_plantio, c.colhido_em)} dias` : "—",
    },
    { key: "observacao", header: "Observação", render: (c) => <span className="text-xs text-stone-500">{c.observacao ?? "—"}</span> },
    {
      key: "acoes", header: "", align: "right",
      render: (c) => canEdit ? (
        <button title="Excluir" onClick={() => setConfirmExcluir(c)} className="p-1.5 rounded hover:bg-red-50 text-stone-400 hover:text-red-600"><Trash2 size={14} /></button>
      ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#eef4e4] text-[#3a6230] flex items-center justify-center">
            <Carrot size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#0f1f1c]">Horta & Canteiros</h1>
            <p className="text-sm text-stone-500">Ciclos de cultura por canteiro — plantio, previsão e colheita.</p>
          </div>
        </div>
        <div className="flex gap-2">
          {canEdit && (
            <>
              <Button variant="outline" size="sm" onClick={() => setCulturasModal(true)}>
                <Settings2 size={14} /> Culturas
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCanteiroModal(true)}>
                <Plus size={14} /> Canteiro
              </Button>
              <Button size="sm" onClick={() => setPlantarModal({ open: true })}>
                <Sprout size={14} /> Novo Plantio
              </Button>
            </>
          )}
        </div>
      </div>

      <Tabs<Aba>
        tabs={[
          { id: "canteiros", label: "Canteiros", icon: Sprout, count: canteiros.filter((c) => c.ativo).length },
          { id: "historico", label: "Histórico de Ciclos", icon: History, count: historico.length },
        ]}
        active={aba}
        onChange={setAba}
      />

      {aba === "canteiros" && (
        <>
          {!loading && canteiros.filter((c) => c.ativo).length === 0 && (
            <Card>
              <CardContent className="text-center py-12">
                <Sprout size={32} className="mx-auto text-stone-300 mb-3" />
                <p className="text-sm text-stone-500 font-medium">Nenhum canteiro cadastrado</p>
                <p className="text-xs text-stone-400 mt-1">Crie o Canteiro 1 para começar o controle da horta.</p>
              </CardContent>
            </Card>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {canteiros.filter((c) => c.ativo).map((canteiro) => {
              const ciclo = cicloAtivoPorCanteiro.get(canteiro.id);
              const cultura = ciclo ? culturaById.get(ciclo.cultura_id) : null;
              const decorridos = ciclo ? diasEntre(ciclo.data_plantio, hoje) : 0;
              const total = ciclo?.previsao_colheita ? diasEntre(ciclo.data_plantio, ciclo.previsao_colheita) : null;
              const progresso = total && total > 0 ? Math.min(100, Math.max(0, (decorridos / total) * 100)) : 0;
              const atrasado = ciclo?.previsao_colheita ? ciclo.previsao_colheita < hoje && ciclo.status !== "finalizado" : false;

              return (
                <div key={canteiro.id} className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-bold text-stone-800">Canteiro {canteiro.numero}</p>
                      <p className="text-[11px] text-stone-400">{canteiro.area_m2 ? `${Number(canteiro.area_m2).toLocaleString("pt-BR")} m²` : "área não informada"}</p>
                    </div>
                    {ciclo ? (
                      <Badge variant={STATUS_VARIANT[ciclo.status]}>{CANTEIRO_CICLO_STATUS_LABEL[ciclo.status]}</Badge>
                    ) : (
                      <Badge variant="neutral">Livre</Badge>
                    )}
                  </div>

                  {ciclo && cultura ? (
                    <>
                      <div>
                        <p className="text-base font-semibold text-[#3a6230]">🥬 {cultura.nome}</p>
                        <p className="text-[11px] text-stone-500">
                          Plantado em {formatDate(ciclo.data_plantio)} · {decorridos} dia(s)
                        </p>
                      </div>

                      {total != null && total > 0 && (
                        <div>
                          <div className="h-2 rounded-full bg-stone-100 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${atrasado ? "bg-red-400" : "bg-[#7aa870]"}`}
                              style={{ width: `${progresso}%` }}
                            />
                          </div>
                          <p className={`text-[11px] mt-1 ${atrasado ? "text-red-600 font-medium" : "text-stone-500"}`}>
                            {decorridos}/{total} dias · colheita prevista {formatDate(ciclo.previsao_colheita!)}
                            {atrasado && " — passou da previsão"}
                          </p>
                        </div>
                      )}

                      {canEdit && (
                        <div className="flex items-center gap-2 mt-auto pt-1">
                          <select
                            value={ciclo.status}
                            onChange={(e) => mudarStatus(ciclo, e.target.value as CanteiroCicloStatus)}
                            className="flex-1 h-8 rounded-lg border border-stone-200 bg-white px-2 text-xs text-stone-700 focus:outline-none focus:ring-2 focus:ring-accent-400"
                          >
                            {(Object.keys(CANTEIRO_CICLO_STATUS_LABEL) as CanteiroCicloStatus[]).map((s) => (
                              <option key={s} value={s}>{CANTEIRO_CICLO_STATUS_LABEL[s]}</option>
                            ))}
                          </select>
                          {ciclo.status !== "finalizado" && (
                            <button
                              title="Finalizar (colher)"
                              onClick={() => mudarStatus(ciclo, "finalizado")}
                              className="p-1.5 rounded-lg hover:bg-emerald-50 text-stone-400 hover:text-emerald-600 transition"
                            >
                              <CheckCircle2 size={16} />
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2 py-4 mt-auto">
                      <p className="text-xs text-stone-400">Canteiro livre</p>
                      {canEdit && (
                        <Button size="sm" variant="outline" onClick={() => setPlantarModal({ open: true, canteiroId: canteiro.id })}>
                          <Sprout size={13} /> Plantar
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {aba === "historico" && (
        <DataTable columns={colHistorico} data={historico} loading={loading} emptyMessage="Nenhum ciclo finalizado ainda." />
      )}

      {/* Modais */}
      {plantarModal.open && (
        <PlantarModal
          canteiroIdInicial={plantarModal.canteiroId}
          canteiros={canteiros.filter((c) => c.ativo && !cicloAtivoPorCanteiro.has(c.id))}
          culturas={culturas.filter((c) => c.ativo)}
          onClose={() => setPlantarModal({ open: false })}
          onSaved={() => { setPlantarModal({ open: false }); fetchAll(); }}
        />
      )}
      {canteiroModal && (
        <NovoCanteiroModal
          proximoNumero={(canteiros.reduce((m, c) => Math.max(m, c.numero), 0) ?? 0) + 1}
          onClose={() => setCanteiroModal(false)}
          onSaved={() => { setCanteiroModal(false); fetchAll(); }}
        />
      )}
      {culturasModal && (
        <CulturasModal
          culturas={culturas}
          onClose={() => setCulturasModal(false)}
          onChanged={fetchAll}
        />
      )}
      <ConfirmDialog
        open={!!confirmExcluir}
        title="Excluir ciclo do histórico?"
        description="O registro deste ciclo será removido permanentemente."
        tone="danger"
        confirmText="Excluir"
        busy={busy}
        onConfirm={async () => {
          if (!confirmExcluir) return;
          setBusy(true);
          try {
            await excluirCiclo(confirmExcluir.id);
            toast.success("Ciclo excluído");
            setConfirmExcluir(null);
            fetchAll();
          } catch (e) {
            toast.error("Erro ao excluir", e instanceof Error ? e.message : undefined);
          } finally {
            setBusy(false);
          }
        }}
        onCancel={() => setConfirmExcluir(null)}
      />
    </div>
  );
}

// ============================================================================
// Modal — novo plantio
// ============================================================================
function PlantarModal({ canteiroIdInicial, canteiros, culturas, onClose, onSaved }: {
  canteiroIdInicial?: string;
  canteiros: CanteiroRow[];
  culturas: HortaCulturaRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    canteiro_id: canteiroIdInicial ?? (canteiros[0]?.id ?? ""),
    cultura_id: culturas[0]?.id ?? "",
    data_plantio: isoLocalHoje(),
    previsao_colheita: null as string | null,
    observacao: null as string | null,
  });
  // previsao_colheita fica fora da trava: é auto-preenchida pelo efeito abaixo
  // logo após abrir, o que marcaria o formulário como "sujo" sem o usuário digitar.
  const guard = useUnsavedGuard(true, { ...form, previsao_colheita: undefined }, onClose);

  // Pré-preenche a previsão com plantio + ciclo padrão da cultura (editável — call)
  useEffect(() => {
    const cultura = culturas.find((c) => c.id === form.cultura_id);
    if (cultura?.ciclo_dias_padrao && form.data_plantio) {
      setForm((f) => ({ ...f, previsao_colheita: somarDias(f.data_plantio, cultura.ciclo_dias_padrao!) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.cultura_id, form.data_plantio]);

  async function salvar() {
    if (!form.canteiro_id) { toast.warning("Selecione o canteiro."); return; }
    if (!form.cultura_id) { toast.warning("Selecione a cultura."); return; }
    if (!form.data_plantio) { toast.warning("Informe a data de plantio."); return; }
    setBusy(true);
    try {
      await criarCiclo({ ...form, status: "plantado" });
      toast.success("Plantio registrado!");
      onSaved();
    } catch (e) {
      toast.error("Erro ao registrar", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  const cicloDaCultura = culturas.find((c) => c.id === form.cultura_id)?.ciclo_dias_padrao;

  return (
    <Modal open onClose={guard.requestClose} title="Novo Plantio" size="lg" closeOnBackdrop={false}>
      <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Select label="Canteiro *" value={form.canteiro_id} onChange={(e) => setForm({ ...form, canteiro_id: e.target.value })}>
          {canteiros.length === 0 && <option value="">Nenhum canteiro livre</option>}
          {canteiros.map((c) => <option key={c.id} value={c.id}>Canteiro {c.numero}</option>)}
        </Select>
        <Select label="Cultura *" value={form.cultura_id} onChange={(e) => setForm({ ...form, cultura_id: e.target.value })}>
          {culturas.map((c) => (
            <option key={c.id} value={c.id}>{c.nome}{c.ciclo_dias_padrao ? ` (~${c.ciclo_dias_padrao} dias)` : ""}</option>
          ))}
        </Select>
        <Input label="Data de plantio *" type="date" value={form.data_plantio} onChange={(e) => setForm({ ...form, data_plantio: e.target.value })} />
        <div>
          <Input
            label="Previsão de colheita"
            type="date"
            value={form.previsao_colheita ?? ""}
            onChange={(e) => setForm({ ...form, previsao_colheita: e.target.value || null })}
          />
          {cicloDaCultura && (
            <p className="text-[11px] text-stone-400 mt-1">Sugerida pelo ciclo padrão ({cicloDaCultura} dias) — pode ajustar.</p>
          )}
        </div>
        <div className="sm:col-span-2">
          <Textarea label="Observação" rows={2} value={form.observacao ?? ""} onChange={(e) => setForm({ ...form, observacao: e.target.value || null })} />
        </div>
      </div>
      <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-2 bg-stone-50/50">
        <Button variant="ghost" onClick={guard.requestClose} disabled={busy}>Cancelar</Button>
        <Button onClick={salvar} loading={busy} disabled={canteiros.length === 0}>Plantar</Button>
      </div>
      <UnsavedChangesDialog open={guard.confirmOpen} onStay={guard.stay} onDiscard={guard.discard} />
    </Modal>
  );
}

// ============================================================================
// Modal — novo canteiro
// ============================================================================
function NovoCanteiroModal({ proximoNumero, onClose, onSaved }: {
  proximoNumero: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [numero, setNumero] = useState(proximoNumero);
  const [area, setArea] = useState("");
  const guard = useUnsavedGuard(true, { numero, area }, onClose);

  async function salvar() {
    if (!numero || numero < 1) { toast.warning("Informe o número do canteiro."); return; }
    setBusy(true);
    try {
      await criarCanteiro({ numero, area_m2: area === "" ? null : Number(String(area).replace(",", ".")) });
      toast.success(`Canteiro ${numero} criado`);
      onSaved();
    } catch (e) {
      toast.error("Erro ao criar", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={guard.requestClose} title="Novo Canteiro" size="sm" closeOnBackdrop={false}>
      <div className="p-6 space-y-4">
        <Input label="Número *" type="number" min={1} value={numero} onChange={(e) => setNumero(Number(e.target.value) || 0)} />
        <Input label="Área (m²)" type="number" min={0} step="0.01" placeholder="Opcional" value={area} onChange={(e) => setArea(e.target.value)} />
      </div>
      <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-2 bg-stone-50/50">
        <Button variant="ghost" onClick={guard.requestClose} disabled={busy}>Cancelar</Button>
        <Button onClick={salvar} loading={busy}>Criar</Button>
      </div>
      <UnsavedChangesDialog open={guard.confirmOpen} onStay={guard.stay} onDiscard={guard.discard} />
    </Modal>
  );
}

// ============================================================================
// Modal — gerenciar culturas (ciclo padrão editável — call)
// ============================================================================
function CulturasModal({ culturas, onClose, onChanged }: {
  culturas: HortaCulturaRow[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [novo, setNovo] = useState({ nome: "", ciclo: "" });

  async function adicionar() {
    if (!novo.nome.trim()) { toast.warning("Informe o nome da cultura."); return; }
    setBusy(true);
    try {
      await criarCulturaHorta({
        nome: novo.nome,
        ciclo_dias_padrao: novo.ciclo === "" ? null : Number(novo.ciclo),
      });
      toast.success("Cultura criada");
      setNovo({ nome: "", ciclo: "" });
      onChanged();
    } catch (e) {
      toast.error("Erro ao criar", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function salvarCiclo(cultura: HortaCulturaRow, ciclo: string) {
    const valor = ciclo === "" ? null : Number(ciclo);
    if (valor != null && (!Number.isFinite(valor) || valor < 1)) return;
    try {
      await atualizarCulturaHorta(cultura.id, { nome: cultura.nome, ciclo_dias_padrao: valor, ativo: cultura.ativo });
      onChanged();
    } catch (e) {
      toast.error("Erro ao salvar", e instanceof Error ? e.message : undefined);
    }
  }

  async function toggleAtivo(cultura: HortaCulturaRow) {
    try {
      await atualizarCulturaHorta(cultura.id, { nome: cultura.nome, ciclo_dias_padrao: cultura.ciclo_dias_padrao, ativo: !cultura.ativo });
      onChanged();
    } catch (e) {
      toast.error("Erro ao alterar", e instanceof Error ? e.message : undefined);
    }
  }

  return (
    <Modal open onClose={onClose} title="Culturas da Horta" size="md">
      <div className="p-6 space-y-4">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input label="Nova cultura" placeholder="Alface" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
          </div>
          <div className="w-28">
            <Input label="Ciclo (dias)" type="number" min={1} placeholder="45" value={novo.ciclo} onChange={(e) => setNovo({ ...novo, ciclo: e.target.value })} />
          </div>
          <Button onClick={adicionar} loading={busy}><Plus size={14} /></Button>
        </div>
        <div className="divide-y divide-stone-100 border border-stone-200 rounded-lg">
          {culturas.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className={`flex-1 text-sm ${c.ativo ? "text-stone-800" : "text-stone-400 line-through"}`}>{c.nome}</span>
              <input
                type="number"
                min={1}
                defaultValue={c.ciclo_dias_padrao ?? ""}
                placeholder="dias"
                onBlur={(e) => salvarCiclo(c, e.target.value)}
                className="w-20 h-8 rounded-lg border border-stone-200 px-2 text-xs text-center focus:outline-none focus:ring-2 focus:ring-accent-400"
                title="Ciclo padrão em dias — salva ao sair do campo"
              />
              <Button variant="ghost" size="sm" onClick={() => toggleAtivo(c)}>
                {c.ativo ? "Inativar" : "Reativar"}
              </Button>
            </div>
          ))}
        </div>
        <p className="text-xs text-stone-400">
          O ciclo padrão pré-preenche a previsão de colheita ao plantar — sempre editável no plantio.
        </p>
      </div>
    </Modal>
  );
}
