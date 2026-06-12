"use client";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { type TransacaoEmpresaRich } from "@/lib/queries/financeiro";
import {
  STATUS_KIND, FORMA_PGTO_LABEL,
  TIPO_DESPESA_LABEL, OBS_OBRA_LABEL,
} from "@/types";

interface Props {
  lancamento: TransacaoEmpresaRich | null;
  onClose: () => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[10px] uppercase tracking-wide text-stone-500">{label}</p>
      <div className="text-sm text-stone-800">{children}</div>
    </div>
  );
}

export function LancamentoDetalheModal({ lancamento, onClose }: Props) {
  if (!lancamento) return null;
  const t = lancamento;
  const kind = STATUS_KIND[t.status];

  return (
    <Modal open={!!lancamento} onClose={onClose} title="Detalhes do Lançamento" size="lg">
      <div className="px-6 pb-6 space-y-5">
        {/* Cabeçalho com valor */}
        <div className="flex items-baseline justify-between border-b border-stone-100 pb-3">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-stone-400">Status</p>
            <StatusBadge status={t.status} />
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-stone-400">Valor</p>
            <p className={`text-2xl font-bold tabular-nums ${
              kind === "entrada" ? "text-emerald-700" :
              kind === "saida" ? "text-red-600" : "text-stone-700"
            }`}>
              {formatCurrency(t.valor)}
            </p>
          </div>
        </div>

        {/* Grid de campos */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Field label="Vencimento">{formatDate(t.data)}</Field>
          <Field label="Emissão">
            {t.data_emissao ? formatDate(t.data_emissao) : <span className="text-stone-300">—</span>}
          </Field>

          <Field label="Mês de referência">{t.mes_referencia}</Field>
          <Field label="Conta Contábil">
            <div>{t.conta_contabil?.nome ?? t.conta_contabil_cod}</div>
            <div className="text-[10px] text-stone-400">{t.conta_contabil_cod}</div>
          </Field>
          <Field label="Centro de Custo">
            <div>{t.centro_custo?.nome ?? t.centro_custo_cod}</div>
            <div className="text-[10px] text-stone-400">{t.centro_custo_cod}</div>
          </Field>

          <Field label="Tipo de Despesa">{TIPO_DESPESA_LABEL[t.tipo_despesa]}</Field>
          <Field label="Forma de Pagamento">{FORMA_PGTO_LABEL[t.forma_pgto]}</Field>

          <Field label="Banco">
            {t.conta_bancaria?.apelido ?? t.conta_bancaria?.nome ?? <span className="text-stone-300">—</span>}
          </Field>
          <Field label="Obs. Obra">{OBS_OBRA_LABEL[t.obs_obra]}</Field>

          <Field label="Fornecedor">
            {t.fornecedor_nome || <span className="text-stone-300">—</span>}
          </Field>
          <Field label="Referência (NF / recibo)">
            {t.ref || <span className="text-stone-300">—</span>}
          </Field>

          <Field label="Parcelas">
            {t.parcelas || <span className="text-stone-300">—</span>}
          </Field>
          <Field label="Origem">
            {t.origem_planilha ? (
              <span className="text-[10px] font-mono text-stone-500">{t.origem_planilha}</span>
            ) : <span className="text-stone-300">manual</span>}
          </Field>
        </div>

        {/* Descrição em destaque */}
        {t.descricao && (
          <div className="bg-stone-50 rounded-lg p-3">
            <p className="text-[10px] uppercase tracking-wide text-stone-500 mb-1">Descrição</p>
            <p className="text-sm text-stone-800 whitespace-pre-wrap">{t.descricao}</p>
          </div>
        )}

        {/* Observação destacada (caso a Lola tenha anotado algo) */}
        {t.observacao && (
          <div className="bg-amber-50 border-l-4 border-amber-400 rounded p-3">
            <p className="text-[10px] uppercase tracking-wide text-amber-700 mb-1">Observação</p>
            <p className="text-sm text-stone-800 whitespace-pre-wrap">{t.observacao}</p>
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-stone-100">
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </Modal>
  );
}
