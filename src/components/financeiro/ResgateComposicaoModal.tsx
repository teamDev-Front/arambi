"use client";
// "Do que é feito este resgate?" (pedido da Adri, 04-ago-2026).
//
// O resgate automático do Invest é UMA linha por dia (ou por fatura, no caso do
// cartão) somando vários títulos. Sem ver a composição, ela procurava um título
// de R$ 51,00 no extrato do sistema, não achava, e lançava um resgate manual —
// que ficava em dobro com o consolidado. Esta tela é a tabela dinâmica que ela
// usava no Excel, dentro do sistema.

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Loader2, AlertTriangle, CheckCircle2, Landmark } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { getStatusLabel } from "@/lib/utils/status-config";
import { obterComposicaoResgate, type ComposicaoResgate } from "@/lib/queries/resgates";
import { FORMA_PGTO_LABEL } from "@/types";

const EXPLICACAO: Record<ComposicaoResgate["tipo"], string> = {
  diario:
    "Resgate agrupado por DIA: soma todos os títulos do Sicredi que vencem na mesma data. " +
    "Fica programado para o dia útil anterior ao vencimento — assim o dinheiro rende o máximo " +
    "possível e o risco não se concentra num dia só. A exceção é quando o dia anterior cairia no " +
    "mês passado: aí o resgate vai para o próprio dia do vencimento, para o mês fechar em zero.",
  fatura:
    "Resgate agrupado por FATURA do cartão: soma todos os lançamentos de Cartão de Crédito " +
    "do mês numa linha só, programada para o dia útil anterior ao vencimento da fatura.",
  manual:
    "Resgate lançado à mão — não foi gerado pelo sistema, então não tem títulos vinculados " +
    "automaticamente.",
};

interface Props {
  open: boolean;
  resgateId: string | null;
  onClose: () => void;
}

export function ResgateComposicaoModal({ open, resgateId, onClose }: Props) {
  const [dados, setDados] = useState<ComposicaoResgate | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !resgateId) return;
    let cancelado = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- estado de carregamento da busca disparada ao abrir
    setCarregando(true);
    setErro(null);
    setDados(null);
    obterComposicaoResgate(resgateId)
      .then((d) => { if (!cancelado) setDados(d); })
      .catch((e: unknown) => { if (!cancelado) setErro((e as Error).message ?? String(e)); })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, [open, resgateId]);

  const fecha = dados ? Math.abs(dados.diferenca) < 0.005 : false;

  return (
    <Modal open={open} onClose={onClose} title="Composição do resgate" size="lg">
      {carregando && (
        <div className="py-16 text-center text-stone-400">
          <Loader2 size={18} className="inline-block animate-spin mr-2" /> Carregando…
        </div>
      )}

      {erro && (
        <div className="p-6">
          <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2.5 text-sm text-red-700">{erro}</div>
        </div>
      )}

      {dados && !carregando && (
        <>
          <div className="px-6 pt-4">
            <div className="flex items-start gap-3">
              <span className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center bg-emerald-50 text-emerald-600">
                <Landmark size={17} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-stone-800">
                  {formatDate(dados.resgate.data)} · {formatCurrency(dados.valorResgate)}
                </p>
                <p className="text-xs text-stone-500">
                  {getStatusLabel(dados.resgate.status)} ·{" "}
                  {dados.titulos.length === 0
                    ? "nenhum título vinculado"
                    : `${dados.titulos.length} título${dados.titulos.length === 1 ? "" : "s"} somado${dados.titulos.length === 1 ? "" : "s"}`}
                </p>
              </div>
            </div>
            <p className="mt-3 rounded-lg bg-sky-50 border border-sky-100 px-3 py-2 text-xs text-sky-900 leading-relaxed">
              {EXPLICACAO[dados.tipo]}
            </p>
          </div>

          <div className="p-4">
            {dados.titulos.length === 0 ? (
              <div className="py-10 text-center text-sm text-stone-400">
                Este resgate não tem nenhum título vinculado.
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-100 text-stone-500 uppercase tracking-wide">
                    {["Vencimento", "Descrição", "Fornecedor", "Forma de Pgto", "Status", "Valor"].map((h, i) => (
                      <th key={h} className={`px-3 py-2 font-semibold whitespace-nowrap ${i === 5 ? "text-right" : "text-left"}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dados.titulos.map((t) => (
                    <tr key={t.id} className="border-b border-stone-50 hover:bg-stone-50">
                      <td className="px-3 py-2 text-stone-500 whitespace-nowrap">{formatDate(t.data)}</td>
                      <td className="px-3 py-2 text-stone-700 max-w-[280px] truncate" title={t.descricao ?? ""}>
                        {t.descricao ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-stone-500 max-w-[150px] truncate" title={t.fornecedor_nome ?? ""}>
                        {t.fornecedor_nome ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-stone-500 whitespace-nowrap">
                        {t.forma_pgto && t.forma_pgto !== "sem" ? FORMA_PGTO_LABEL[t.forma_pgto] : "—"}
                      </td>
                      <td className="px-3 py-2 text-stone-600 whitespace-nowrap">{getStatusLabel(t.status)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-red-600 whitespace-nowrap">
                        {formatCurrency(Number(t.valor))}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-stone-100 border-t-2 border-stone-200 font-semibold text-stone-700">
                    <td colSpan={5} className="px-3 py-2 uppercase tracking-wide">Soma dos títulos</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      {formatCurrency(dados.somaTitulos)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}

            {/* Conferência: o resgate tem que ser exatamente a soma dos títulos */}
            {dados.titulos.length > 0 && (
              <div className={`mt-3 rounded-xl border px-4 py-3 flex items-start gap-2.5 text-xs leading-relaxed ${
                fecha ? "bg-emerald-50/60 border-emerald-100 text-emerald-900"
                      : "bg-amber-50 border-amber-200 text-amber-900"}`}>
                {fecha
                  ? <CheckCircle2 size={15} className="shrink-0 mt-0.5 text-emerald-600" />
                  : <AlertTriangle size={15} className="shrink-0 mt-0.5 text-amber-600" />}
                <span>
                  {fecha ? (
                    <>
                      <b>Confere.</b> O resgate de {formatCurrency(dados.valorResgate)} é exatamente a soma
                      dos {dados.titulos.length} título{dados.titulos.length === 1 ? "" : "s"} acima — não
                      falta nem sobra resgate para estes lançamentos.
                    </>
                  ) : (
                    <>
                      <b>Não confere.</b> O resgate está em {formatCurrency(dados.valorResgate)}, mas a soma
                      dos títulos dá {formatCurrency(dados.somaTitulos)} — diferença de{" "}
                      {formatCurrency(Math.abs(dados.diferenca))}. Normalmente é sinal de que o valor do
                      resgate foi editado à mão.
                    </>
                  )}
                </span>
              </div>
            )}
          </div>
        </>
      )}

      <div className="px-6 py-4 border-t border-stone-100 flex items-center justify-end bg-stone-50/50">
        <Button variant="outline" onClick={onClose}>Fechar</Button>
      </div>
    </Modal>
  );
}
