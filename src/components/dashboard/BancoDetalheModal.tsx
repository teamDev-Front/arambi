"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Loader2, ArrowRight } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { listarTransacoesEmpresa, type TransacaoEmpresaRich } from "@/lib/queries/financeiro";
import type { SaldoAtualBanco } from "@/lib/queries/dashboard";
import { STATUS_ARAMBURU_LABEL, STATUS_KIND } from "@/types";

interface Props {
  banco: SaldoAtualBanco | null;
  onClose: () => void;
}

export function BancoDetalheModal({ banco, onClose }: Props) {
  const [rows, setRows] = useState<TransacaoEmpresaRich[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!banco) { setRows([]); setTotal(0); return; }
    setLoading(true);
    listarTransacoesEmpresa({ contaBancariaId: banco.conta_bancaria_id }, 1, 15)
      .then((r) => { setRows(r.rows); setTotal(r.total); })
      .finally(() => setLoading(false));
  }, [banco]);

  if (!banco) return null;

  const saldo = Number(banco.saldo_atual);
  const aPagar = Math.abs(Number(banco.a_pagar));
  const aReceber = Number(banco.a_receber);
  const provis = Math.abs(Number(banco.provisionado));
  const projetado = Number(banco.saldo_projetado);

  return (
    <Modal
      open={!!banco}
      onClose={onClose}
      title={banco.banco_apelido ?? banco.banco_nome}
      size="lg"
    >
      <div className="px-6 pb-6 space-y-5">
        {/* Cabeçalho com saldo grande */}
        <div className="flex items-baseline justify-between border-b border-stone-100 pb-4">
          <div>
            <p className="text-xs text-stone-500">{banco.banco_nome}</p>
            {banco.banco_agencia && (
              <p className="text-[10px] text-stone-400">agência {banco.banco_agencia}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-[10px] text-stone-400 uppercase tracking-wide">saldo atual</p>
            <p className={`text-3xl font-bold tabular-nums ${
              saldo > 0 ? "text-emerald-700" : saldo < 0 ? "text-red-600" : "text-stone-500"
            }`}>
              {formatCurrency(saldo)}
            </p>
          </div>
        </div>

        {/* Quebra de compromissos */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-emerald-50 rounded-lg p-3">
            <p className="text-[10px] text-stone-500 uppercase tracking-wide mb-1">a receber</p>
            <p className="text-sm font-semibold tabular-nums text-emerald-700">
              {aReceber > 0 ? `+${formatCurrency(aReceber)}` : "—"}
            </p>
          </div>
          <div className="bg-amber-50 rounded-lg p-3">
            <p className="text-[10px] text-stone-500 uppercase tracking-wide mb-1">a pagar</p>
            <p className="text-sm font-semibold tabular-nums text-amber-700">
              {aPagar > 0 ? `−${formatCurrency(aPagar)}` : "—"}
            </p>
          </div>
          <div className="bg-red-50 rounded-lg p-3">
            <p className="text-[10px] text-stone-500 uppercase tracking-wide mb-1">provisionado</p>
            <p className="text-sm font-semibold tabular-nums text-red-600">
              {provis > 0 ? `−${formatCurrency(provis)}` : "—"}
            </p>
          </div>
          <div className="bg-stone-100 rounded-lg p-3">
            <p className="text-[10px] text-stone-500 uppercase tracking-wide mb-1">projetado</p>
            <p className={`text-sm font-semibold tabular-nums ${
              projetado < 0 ? "text-red-600" : "text-stone-700"
            }`}>
              {formatCurrency(projetado)}
            </p>
          </div>
        </div>

        {/* Lista de lançamentos */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-stone-700">Últimos lançamentos</h3>
            <span className="text-[10px] text-stone-400">{total} no total</span>
          </div>
          {loading && (
            <div className="text-center py-6 text-stone-400">
              <Loader2 size={16} className="inline-block animate-spin mr-2" />
              Carregando…
            </div>
          )}
          {!loading && rows.length === 0 && (
            <p className="text-xs text-stone-400 text-center py-6">Sem lançamentos.</p>
          )}
          {!loading && rows.length > 0 && (
            <div className="border border-stone-100 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-stone-50 text-[10px] uppercase tracking-wide text-stone-500">
                    <th className="px-3 py-2 text-left font-semibold">Data</th>
                    <th className="px-3 py-2 text-left font-semibold">Descrição</th>
                    <th className="px-3 py-2 text-left font-semibold">Status</th>
                    <th className="px-3 py-2 text-right font-semibold">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => {
                    const kind = STATUS_KIND[t.status];
                    return (
                      <tr key={t.id} className="border-t border-stone-50 hover:bg-stone-50">
                        <td className="px-3 py-2 text-stone-500 whitespace-nowrap">{formatDate(t.data)}</td>
                        <td className="px-3 py-2 text-stone-700 max-w-[260px] truncate" title={t.descricao ?? ""}>
                          {t.descricao || <span className="text-stone-300">—</span>}
                          {t.fornecedor_nome && (
                            <span className="block text-[10px] text-stone-400 truncate">{t.fornecedor_nome}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="neutral">{STATUS_ARAMBURU_LABEL[t.status]}</Badge>
                        </td>
                        <td className={`px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap ${
                          kind === "entrada" ? "text-emerald-700" :
                          kind === "saida" ? "text-red-600" : "text-stone-700"
                        }`}>
                          {formatCurrency(t.valor)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 pt-3 border-t border-stone-100">
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
          <Link href={`/dashboard/financeiro?banco=${banco.conta_bancaria_id}`}>
            <Button variant="outline" size="sm">
              Ver no Financeiro <ArrowRight size={14} />
            </Button>
          </Link>
        </div>
      </div>
    </Modal>
  );
}
