"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { createClient } from "@/lib/supabase/client";
import {
  Plus, Pencil, Trash2, Wallet,
} from "lucide-react";
import {
  TIPO_DESPESA_LABEL,
  type OrcamentoMensalRow,
  type TipoDespesa,
} from "@/types";

// Apenas os 4 tipos que fazem sentido orçar (sem "sem").
const TIPOS_ORCAVEIS: TipoDespesa[] = ["fixa", "variavel", "eventual", "periodica"];

const fmtBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtMesHumano = (yyyymm: string) => {
  const [y, m] = yyyymm.split("-");
  const meses = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const idx = Math.max(0, Math.min(11, parseInt(m, 10) - 1));
  return `${meses[idx]}/${y.slice(2)}`;
};

const mesAtual = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

interface FormState {
  id: string | null;
  mes_referencia: string;
  tipo_despesa: TipoDespesa;
  valor_orcado: string;     // string para o input, converte na hora de salvar
  observacao: string;
}

const DEFAULT_FORM: FormState = {
  id: null,
  mes_referencia: mesAtual(),
  tipo_despesa: "variavel",
  valor_orcado: "",
  observacao: "",
};

export function OrcamentosPage() {
  const toast = useToast();
  const [linhas, setLinhas] = useState<OrcamentoMensalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroMes, setFiltroMes] = useState<string>("");
  const [filtroTipo, setFiltroTipo] = useState<"" | TipoDespesa>("");

  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);

  const [confirmDelId, setConfirmDelId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("orcamentos_mensais")
      .select("*")
      .order("mes_referencia", { ascending: false })
      .order("tipo_despesa", { ascending: true });
    if (error) {
      toast.error("Erro ao carregar orçamentos", error.message);
      setLinhas([]);
    } else {
      setLinhas(data ?? []);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { void carregar(); }, [carregar]);

  const linhasFiltradas = useMemo(() => {
    return linhas.filter(r =>
      (!filtroMes || r.mes_referencia === filtroMes) &&
      (!filtroTipo || r.tipo_despesa === filtroTipo)
    );
  }, [linhas, filtroMes, filtroTipo]);

  function abrirNovo() {
    setForm(DEFAULT_FORM);
    setEditOpen(true);
  }
  function abrirEdicao(r: OrcamentoMensalRow) {
    setForm({
      id: r.id,
      mes_referencia: r.mes_referencia,
      tipo_despesa: r.tipo_despesa,
      valor_orcado: r.valor_orcado.toString(),
      observacao: r.observacao ?? "",
    });
    setEditOpen(true);
  }

  async function salvar() {
    if (!/^\d{4}-\d{2}$/.test(form.mes_referencia)) {
      toast.error("Mês inválido", "Use o formato YYYY-MM.");
      return;
    }
    const valor = Number(form.valor_orcado.replace(",", "."));
    if (!Number.isFinite(valor) || valor < 0) {
      toast.error("Valor inválido", "Use um número positivo (ex.: 20000.00).");
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const camposEditaveis = {
      valor_orcado:   valor,
      observacao:     form.observacao.trim() || null,
    };

    const { error } = form.id
      ? await supabase
          .from("orcamentos_mensais")
          .update(camposEditaveis)
          .eq("id", form.id)
      : await supabase.from("orcamentos_mensais").insert({
          mes_referencia: form.mes_referencia,
          tipo_despesa:   form.tipo_despesa,
          ...camposEditaveis,
        });
    setSaving(false);

    if (error) {
      // 23505 = unique_violation (já existe (mes, tipo))
      if (error.code === "23505") {
        toast.error("Já existe orçamento", `Já há um orçamento para ${fmtMesHumano(form.mes_referencia)} / ${TIPO_DESPESA_LABEL[form.tipo_despesa]}. Edite o existente.`);
      } else {
        toast.error("Erro ao salvar", error.message);
      }
      return;
    }
    toast.success(form.id ? "Orçamento atualizado" : "Orçamento criado");
    setEditOpen(false);
    void carregar();
  }

  async function confirmarRemocao() {
    if (!confirmDelId) return;
    setDeleting(true);
    const supabase = createClient();
    const { error } = await supabase.from("orcamentos_mensais").delete().eq("id", confirmDelId);
    setDeleting(false);
    setConfirmDelId(null);
    if (error) {
      toast.error("Erro ao remover", error.message);
      return;
    }
    toast.success("Orçamento removido");
    void carregar();
  }

  const mesesDisponiveis = useMemo(() => {
    const s = new Set(linhas.map(r => r.mes_referencia));
    return Array.from(s).sort().reverse();
  }, [linhas]);

  return (
    <div className="space-y-6 max-w-[1200px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#0f1f1c] flex items-center gap-2">
            <Wallet size={20} className="text-accent-500" /> Orçamentos Mensais
          </h1>
          <p className="text-sm text-stone-500 max-w-[680px]">
            Teto mensal de gasto por tipo de despesa. Substitui o orçamento fixo de R$ 20.000 que ficava chumbado na Memória de Cálculo da planilha. O card &quot;Realizado vs Saldo&quot; do relatório mensal consulta esta tabela.
          </p>
        </div>
        <Button onClick={abrirNovo}><Plus size={14}/> Novo orçamento</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Select
              label="Mês"
              value={filtroMes}
              onChange={(e) => setFiltroMes(e.target.value)}
            >
              <option value="">Todos</option>
              {mesesDisponiveis.map(m => (
                <option key={m} value={m}>{fmtMesHumano(m)} ({m})</option>
              ))}
            </Select>
            <Select
              label="Tipo de despesa"
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value as "" | TipoDespesa)}
            >
              <option value="">Todos</option>
              {TIPOS_ORCAVEIS.map(t => (
                <option key={t} value={t}>{TIPO_DESPESA_LABEL[t]}</option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Orçamentos cadastrados</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-100">
                  {["Mês", "Tipo de Despesa", "Valor Orçado", "Observação", "Ações"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-stone-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={5} className="px-4 py-12 text-center text-xs text-stone-400">Carregando…</td></tr>
                )}
                {!loading && linhasFiltradas.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-12 text-center text-xs text-stone-400">
                    Nenhum orçamento {filtroMes || filtroTipo ? "com esses filtros" : "cadastrado"}. Clique em &quot;Novo orçamento&quot; para começar.
                  </td></tr>
                )}
                {!loading && linhasFiltradas.map(r => (
                  <tr key={r.id} className="border-b border-stone-50 hover:bg-stone-50 transition table-row-alt">
                    <td className="px-4 py-3 text-stone-700 text-xs font-mono">{r.mes_referencia}</td>
                    <td className="px-4 py-3 text-stone-700">{TIPO_DESPESA_LABEL[r.tipo_despesa]}</td>
                    <td className="px-4 py-3 text-stone-800 font-medium">{fmtBRL(Number(r.valor_orcado))}</td>
                    <td className="px-4 py-3 text-stone-500 text-xs truncate max-w-[300px]">{r.observacao ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => abrirEdicao(r)} className="p-1.5 rounded hover:bg-stone-100 text-stone-500 hover:text-accent-500 transition" title="Editar">
                          <Pencil size={13}/>
                        </button>
                        <button onClick={() => setConfirmDelId(r.id)} className="p-1.5 rounded hover:bg-red-50 text-stone-400 hover:text-red-600 transition" title="Remover">
                          <Trash2 size={13}/>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Modal open={editOpen} onClose={() => !saving && setEditOpen(false)} title={form.id ? "Editar orçamento" : "Novo orçamento"} size="md">
        <div className="p-6 space-y-4">
          <Input
            label="Mês (YYYY-MM)"
            type="month"
            value={form.mes_referencia}
            onChange={(e) => setForm({ ...form, mes_referencia: e.target.value })}
            disabled={!!form.id}
          />
          <Select
            label="Tipo de Despesa"
            value={form.tipo_despesa}
            onChange={(e) => setForm({ ...form, tipo_despesa: e.target.value as TipoDespesa })}
            disabled={!!form.id}
          >
            {TIPOS_ORCAVEIS.map(t => (
              <option key={t} value={t}>{TIPO_DESPESA_LABEL[t]}</option>
            ))}
          </Select>
          <Input
            label="Valor orçado (R$)"
            type="number"
            step="0.01"
            min="0"
            value={form.valor_orcado}
            onChange={(e) => setForm({ ...form, valor_orcado: e.target.value })}
            placeholder="20000.00"
          />
          <Input
            label="Observação (opcional)"
            value={form.observacao}
            onChange={(e) => setForm({ ...form, observacao: e.target.value })}
            placeholder="Ex.: ajustado por causa da safra"
          />
        </div>
        <div className="px-6 py-4 border-t border-stone-100 flex items-center justify-end gap-2 bg-stone-50/50">
          <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={salvar} loading={saving} disabled={saving}>
            {form.id ? "Salvar" : "Criar orçamento"}
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmDelId}
        title="Remover este orçamento?"
        description="A linha será apagada do banco. Não impacta lançamentos já feitos; apenas remove o teto cadastrado para esse mês/tipo."
        confirmText="Remover"
        cancelText="Cancelar"
        tone="danger"
        busy={deleting}
        onConfirm={confirmarRemocao}
        onCancel={() => setConfirmDelId(null)}
      />
    </div>
  );
}
