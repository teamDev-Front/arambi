"use client";
// Operação de Campo — acompanhamento dos talões digitais e do combustível
// registrados pelos colaboradores no portal (/colaborador).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ClipboardList, Fuel, GaugeCircle, Droplets, Plus, Trash2,
  AlertTriangle, CheckCircle2, QrCode, Copy,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Tabs } from "@/components/ui/Tabs";
import { isoLocalHoje } from "@/components/ui/CalendarioMes";
import { useToast } from "@/components/ui/Toast";
import { UnsavedChangesDialog } from "@/components/ui/UnsavedChangesDialog";
import { useUnsavedGuard } from "@/lib/hooks/useUnsavedGuard";
import { formatDateTime, formatDate } from "@/lib/utils/format";
import { obterRoleAtual } from "@/lib/queries/configuracoes";
import {
  listarTaloes, listarAbastecimentos, regularizarDiscrepancia,
  saldosReservatorios, listarEntradasReservatorio, criarEntradaReservatorio,
  excluirEntradaReservatorio,
  type TalaoRich, type AbastecimentoRich, type SaldoReservatorio,
} from "@/lib/queries/operacao";
import type { ReservatorioEntradaRow, CombustivelFonte } from "@/types";
import { COMBUSTIVEL_FONTE_LABEL, TALAO_STATUS_LABEL } from "@/types";

type Aba = "taloes" | "abastecimentos" | "combustivel" | "discrepancias";

const fmtNum = (n: number | string | null | undefined, casas = 1) =>
  n == null ? "—" : Number(n).toLocaleString("pt-BR", { maximumFractionDigits: casas });

export function OperacaoPage() {
  const toast = useToast();
  const [aba, setAba] = useState<Aba>("taloes");
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);

  const [taloes, setTaloes] = useState<TalaoRich[]>([]);
  const [abastecimentos, setAbastecimentos] = useState<AbastecimentoRich[]>([]);
  const [saldos, setSaldos] = useState<SaldoReservatorio[]>([]);
  const [entradas, setEntradas] = useState<ReservatorioEntradaRow[]>([]);

  const [regularizar, setRegularizar] = useState<TalaoRich | null>(null);
  const [entradaModal, setEntradaModal] = useState(false);
  const [linkModal, setLinkModal] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [t, a, s, e] = await Promise.all([
        listarTaloes(), listarAbastecimentos(), saldosReservatorios(), listarEntradasReservatorio(),
      ]);
      setTaloes(t);
      setAbastecimentos(a);
      setSaldos(s);
      setEntradas(e);
    } catch (e) {
      toast.error("Erro ao carregar operação", e instanceof Error ? e.message : "Aplique a migration 0041 no SQL Editor.");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchAll();
    obterRoleAtual().then((r) => setCanEdit(r === "admin" || r === "editor")).catch(() => {});
  }, [fetchAll]);

  const discrepancias = useMemo(
    () => taloes.filter((t) => !t.discrepancia_regularizada && Number(t.discrepancia) !== 0),
    [taloes],
  );

  const emUso = useMemo(() => taloes.filter((t) => t.status === "aberto").length, [taloes]);

  // --------------------------------------------------------------------------
  // Colunas
  // --------------------------------------------------------------------------
  const colTaloes: Column<TalaoRich>[] = [
    { key: "inicio_em", header: "Início", sortable: true, render: (t) => <span className="whitespace-nowrap text-xs">{formatDateTime(t.inicio_em)}</span> },
    { key: "colaborador", header: "Colaborador", render: (t) => <span className="font-medium text-stone-800">{t.colaboradores?.nome ?? "—"}</span> },
    { key: "equipamento", header: "Equipamento", render: (t) => t.equipamentos ? `${t.equipamentos.codigo} — ${t.equipamentos.nome}` : "—" },
    { key: "medidor_inicial", header: "Inicial", align: "right", render: (t) => fmtNum(t.medidor_inicial) },
    { key: "medidor_final", header: "Final", align: "right", render: (t) => fmtNum(t.medidor_final) },
    {
      key: "rodado", header: "Uso", align: "right",
      render: (t) => t.medidor_final != null
        ? <span className="font-semibold">{fmtNum(Number(t.medidor_final) - Number(t.medidor_inicial))}</span>
        : "—",
    },
    {
      key: "equipamento_seguranca", header: "EPI", align: "center",
      render: (t) => t.equipamento_seguranca == null ? "—"
        : t.equipamento_seguranca ? <Badge variant="success">Sim</Badge> : <Badge variant="danger">Não</Badge>,
    },
    {
      key: "status", header: "Status", align: "center",
      render: (t) => (
        <span className="inline-flex flex-col items-center gap-1">
          <Badge variant={t.status === "aberto" ? "warning" : "success"}>{TALAO_STATUS_LABEL[t.status]}</Badge>
          {!t.discrepancia_regularizada && Number(t.discrepancia) !== 0 && (
            <Badge variant="danger">Δ {fmtNum(t.discrepancia)}</Badge>
          )}
        </span>
      ),
    },
    {
      key: "obs", header: "Obs / Defeitos",
      render: (t) => (
        <span className="text-xs text-stone-500 block max-w-[220px]">
          {t.defeitos && <span className="text-red-600 block">⚠ {t.defeitos}</span>}
          {t.observacoes ?? (!t.defeitos ? "—" : "")}
        </span>
      ),
    },
  ];

  const colAbast: Column<AbastecimentoRich>[] = [
    { key: "data", header: "Data", sortable: true, render: (a) => <span className="whitespace-nowrap text-xs">{formatDateTime(a.data)}</span> },
    { key: "colaborador", header: "Colaborador", render: (a) => <span className="font-medium text-stone-800">{a.colaboradores?.nome ?? "—"}</span> },
    { key: "fonte", header: "Fonte", render: (a) => COMBUSTIVEL_FONTE_LABEL[a.fonte] },
    { key: "equipamento", header: "Equipamento", render: (a) => a.equipamentos ? `${a.equipamentos.codigo} — ${a.equipamentos.nome}` : "—" },
    { key: "medidor_inicial", header: "Medidor antes", align: "right", render: (a) => fmtNum(a.medidor_inicial) },
    { key: "medidor_final", header: "Medidor depois", align: "right", render: (a) => fmtNum(a.medidor_final) },
    { key: "litros", header: "Litros", align: "right", sortable: true, render: (a) => <span className="font-semibold">{fmtNum(a.litros)} L</span> },
    { key: "observacao", header: "Obs.", render: (a) => <span className="text-xs text-stone-500">{a.observacao ?? "—"}</span> },
  ];

  const colEntradas: Column<ReservatorioEntradaRow>[] = [
    { key: "data", header: "Data", sortable: true, render: (e) => formatDate(e.data) },
    { key: "fonte", header: "Reservatório", render: (e) => COMBUSTIVEL_FONTE_LABEL[e.fonte] },
    { key: "litros", header: "Litros", align: "right", render: (e) => <span className="font-semibold text-emerald-700">+{fmtNum(e.litros)} L</span> },
    { key: "observacao", header: "Obs.", render: (e) => <span className="text-xs text-stone-500">{e.observacao ?? "—"}</span> },
    {
      key: "acoes", header: "", align: "right",
      render: (e) => canEdit ? (
        <button
          title="Excluir"
          onClick={async () => {
            try { await excluirEntradaReservatorio(e.id); toast.success("Entrada removida"); fetchAll(); }
            catch (err) { toast.error("Erro ao excluir", err instanceof Error ? err.message : undefined); }
          }}
          className="p-1.5 rounded hover:bg-red-50 text-stone-400 hover:text-red-600"
        >
          <Trash2 size={14} />
        </button>
      ) : null,
    },
  ];

  const colDiscrep: Column<TalaoRich>[] = [
    { key: "inicio_em", header: "Quando", render: (t) => <span className="whitespace-nowrap text-xs">{formatDateTime(t.inicio_em)}</span> },
    { key: "equipamento", header: "Equipamento", render: (t) => t.equipamentos ? `${t.equipamentos.codigo} — ${t.equipamentos.nome}` : "—" },
    { key: "colaborador", header: "Quem abriu", render: (t) => t.colaboradores?.nome ?? "—" },
    { key: "medidor_inicial_sugerido", header: "Sistema esperava", align: "right", render: (t) => fmtNum(t.medidor_inicial_sugerido) },
    { key: "medidor_inicial", header: "Painel marcava", align: "right", render: (t) => fmtNum(t.medidor_inicial) },
    {
      key: "discrepancia", header: "Diferença", align: "right",
      render: (t) => (
        <Badge variant="danger">
          {Number(t.discrepancia) > 0 ? "+" : ""}{fmtNum(t.discrepancia)} sem registro
        </Badge>
      ),
    },
    {
      key: "acoes", header: "Ações", align: "right",
      render: (t) => canEdit ? (
        <Button size="sm" variant="outline" onClick={() => setRegularizar(t)}>
          Regularizar
        </Button>
      ) : null,
    },
  ];

  // --------------------------------------------------------------------------
  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#e8f0ee] text-[#1a4d40] flex items-center justify-center">
            <ClipboardList size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#0f1f1c]">Operação de Campo</h1>
            <p className="text-sm text-stone-500">
              Talões de uso e abastecimentos registrados pelos colaboradores no portal.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setLinkModal(true)}>
          <QrCode size={14} /> Link do Portal
        </Button>
      </div>

      {/* Cards de resumo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 flex items-center gap-3">
          <span className="w-9 h-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center"><ClipboardList size={18} /></span>
          <div>
            <p className="text-lg font-bold text-stone-900 leading-tight">{emUso}</p>
            <p className="text-[11px] text-stone-500">Equipamento(s) em uso agora</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 flex items-center gap-3">
          <span className="w-9 h-9 rounded-lg bg-red-50 text-red-600 flex items-center justify-center"><GaugeCircle size={18} /></span>
          <div>
            <p className="text-lg font-bold text-stone-900 leading-tight">{discrepancias.length}</p>
            <p className="text-[11px] text-stone-500">Discrepância(s) a regularizar</p>
          </div>
        </div>
        {saldos.map((s) => (
          <div key={s.fonte} className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 flex items-center gap-3">
            <span className="w-9 h-9 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center"><Droplets size={18} /></span>
            <div>
              <p className={`text-lg font-bold leading-tight ${s.saldo < 0 ? "text-red-600" : "text-stone-900"}`}>
                {fmtNum(s.saldo)} L
              </p>
              <p className="text-[11px] text-stone-500">{COMBUSTIVEL_FONTE_LABEL[s.fonte]}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Abas */}
      <Tabs<Aba>
        tabs={[
          { id: "taloes", label: "Talões de Uso", icon: ClipboardList, count: taloes.length },
          { id: "abastecimentos", label: "Abastecimentos", icon: Fuel, count: abastecimentos.length },
          { id: "combustivel", label: "Reservatórios", icon: Droplets },
          { id: "discrepancias", label: "Discrepâncias", icon: AlertTriangle, count: discrepancias.length },
        ]}
        active={aba}
        onChange={setAba}
      />

      {aba === "taloes" && (
        <DataTable columns={colTaloes} data={taloes} loading={loading} emptyMessage="Nenhum talão registrado ainda. Compartilhe o link do portal com os colaboradores." />
      )}

      {aba === "abastecimentos" && (
        <DataTable columns={colAbast} data={abastecimentos} loading={loading} emptyMessage="Nenhum abastecimento registrado ainda." />
      )}

      {aba === "combustivel" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-stone-500">
              Saldo = compras/recargas registradas aqui − retiradas registradas pelos colaboradores.
            </p>
            {canEdit && (
              <Button size="sm" onClick={() => setEntradaModal(true)}>
                <Plus size={14} /> Registrar Compra/Recarga
              </Button>
            )}
          </div>
          <DataTable columns={colEntradas} data={entradas} loading={loading} emptyMessage="Nenhuma compra/recarga registrada. Registre a primeira para iniciar o saldo." />
        </div>
      )}

      {aba === "discrepancias" && (
        <div className="space-y-3">
          {discrepancias.length === 0 && !loading ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                <CheckCircle2 size={30} className="text-emerald-400" />
                <p className="text-sm text-stone-600 font-medium">Nenhuma discrepância pendente</p>
                <p className="text-xs text-stone-400 max-w-md">
                  Quando um colaborador corrigir o KM/horímetro sugerido ao abrir um talão
                  (ex.: alguém usou sem registrar), a diferença aparece aqui para regularização.
                </p>
              </CardContent>
            </Card>
          ) : (
            <DataTable columns={colDiscrep} data={discrepancias} loading={loading} emptyMessage="" />
          )}
        </div>
      )}

      {/* Modal — regularizar discrepância */}
      {regularizar && (
        <RegularizarModal
          talao={regularizar}
          onClose={() => setRegularizar(null)}
          onSaved={() => { setRegularizar(null); fetchAll(); }}
        />
      )}

      {/* Modal — nova entrada de combustível */}
      {entradaModal && (
        <EntradaModal
          onClose={() => setEntradaModal(false)}
          onSaved={() => { setEntradaModal(false); fetchAll(); }}
        />
      )}

      {/* Modal — link do portal */}
      <LinkPortalModal open={linkModal} onClose={() => setLinkModal(false)} />
    </div>
  );
}

// ============================================================================
// Modal — regularizar discrepância
// ============================================================================
function RegularizarModal({ talao, onClose, onSaved }: {
  talao: TalaoRich;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [obs, setObs] = useState("");
  const [busy, setBusy] = useState(false);
  const guard = useUnsavedGuard(true, obs, onClose);

  async function salvar() {
    if (!obs.trim()) { toast.warning("Explique o que aconteceu (ex.: uso do proprietário no fim de semana)."); return; }
    setBusy(true);
    try {
      await regularizarDiscrepancia(talao.id, obs);
      toast.success("Discrepância regularizada");
      onSaved();
    } catch (e) {
      toast.error("Erro ao regularizar", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={guard.requestClose} title="Regularizar diferença de medidor" size="md" closeOnBackdrop={false}>
      <div className="p-6 space-y-4">
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          <b>{talao.equipamentos?.codigo} — {talao.equipamentos?.nome}</b>: o sistema esperava{" "}
          <b>{fmtNum(talao.medidor_inicial_sugerido)}</b>, mas o painel marcava{" "}
          <b>{fmtNum(talao.medidor_inicial)}</b> quando {talao.colaboradores?.nome ?? "o colaborador"} pegou.
          Diferença de <b>{fmtNum(talao.discrepancia)}</b> sem registro.
        </div>
        <Textarea
          label="O que aconteceu? *"
          rows={3}
          placeholder="Ex.: Uso do proprietário no fim de semana — regularizado."
          value={obs}
          onChange={(e) => setObs(e.target.value)}
        />
      </div>
      <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-2 bg-stone-50/50">
        <Button variant="ghost" onClick={guard.requestClose} disabled={busy}>Cancelar</Button>
        <Button onClick={salvar} loading={busy}>Regularizar</Button>
      </div>
      <UnsavedChangesDialog open={guard.confirmOpen} onStay={guard.stay} onDiscard={guard.discard} />
    </Modal>
  );
}

// ============================================================================
// Modal — entrada de combustível no reservatório
// ============================================================================
function EntradaModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    fonte: "tanque_diesel" as CombustivelFonte,
    data: isoLocalHoje(),
    litros: "",
    observacao: null as string | null,
  });
  const guard = useUnsavedGuard(true, form, onClose);

  async function salvar() {
    const litros = Number(String(form.litros).replace(",", "."));
    if (!Number.isFinite(litros) || litros <= 0) { toast.warning("Informe os litros."); return; }
    setBusy(true);
    try {
      await criarEntradaReservatorio({ fonte: form.fonte, data: form.data, litros, observacao: form.observacao });
      toast.success("Compra/recarga registrada");
      onSaved();
    } catch (e) {
      toast.error("Erro ao registrar", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={guard.requestClose} title="Registrar Compra/Recarga" size="md" closeOnBackdrop={false}>
      <div className="p-6 space-y-4">
        <Select label="Reservatório" value={form.fonte} onChange={(e) => setForm({ ...form, fonte: e.target.value as CombustivelFonte })}>
          <option value="tanque_diesel">Tanque de Diesel</option>
          <option value="container_gasolina">Container de Gasolina</option>
        </Select>
        <Input label="Data" type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} />
        <Input label="Litros *" type="number" min={0} step="0.1" placeholder="500" value={form.litros} onChange={(e) => setForm({ ...form, litros: e.target.value })} />
        <Input label="Observação" placeholder="NF, fornecedor..." value={form.observacao ?? ""} onChange={(e) => setForm({ ...form, observacao: e.target.value || null })} />
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
// Modal — link do portal (para fixar no grupo / imprimir QR)
// ============================================================================
function LinkPortalModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") setUrl(`${window.location.origin}/colaborador`);
  }, []);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado!", "Cole no grupo de WhatsApp dos colaboradores.");
    } catch {
      toast.warning("Não foi possível copiar — selecione manualmente.");
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Link do Portal do Colaborador" size="md">
      <div className="p-6 space-y-4">
        <p className="text-sm text-stone-600 leading-relaxed">
          Compartilhe este link com os colaboradores (fixe no grupo de WhatsApp).
          No celular, eles podem <b>instalar como aplicativo</b> — o portal ensina o passo a passo.
        </p>
        <div className="flex gap-2">
          <input
            readOnly
            value={url}
            className="flex-1 h-10 rounded-lg border border-stone-300 bg-stone-50 px-3 text-sm text-stone-700"
            onFocus={(e) => e.target.select()}
          />
          <Button onClick={copiar}><Copy size={14} /> Copiar</Button>
        </div>
        <p className="text-xs text-stone-400 leading-relaxed">
          Dica: gere um QR code deste link (qualquer gerador gratuito) e cole impresso no galpão —
          o funcionário aponta a câmera e já cai no portal.
        </p>
      </div>
    </Modal>
  );
}
