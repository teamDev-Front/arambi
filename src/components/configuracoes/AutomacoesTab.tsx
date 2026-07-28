"use client";
import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { Landmark, Loader2 } from "lucide-react";
import {
  obterConfigApp, salvarConfigApp, CONFIG_RESGATES_SICREDI,
} from "@/lib/queries/configuracoes";

/**
 * Configurações → Automações (ajuste 27-jul).
 *
 * Toggle dos RESGATES AUTOMÁTICOS do Sicredi Invest: hoje, toda despesa
 * lançada na conta Sicredi gera automaticamente um resgate do Invest para
 * cobrir o pagamento. Quando a operação passar a ser direto na conta corrente,
 * basta DESLIGAR aqui — sem reconfigurar nada no sistema (pedido da Lola:
 * "como podemos deixar no sistema, para não ter que reconfigurar futuramente?").
 */
export function AutomacoesTab({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const [resgatesAtivos, setResgatesAtivos] = useState<boolean | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    obterConfigApp(CONFIG_RESGATES_SICREDI, "on")
      .then((v) => setResgatesAtivos(v !== "off"))
      .catch((e: unknown) => {
        setResgatesAtivos(true);
        toast.error("Erro carregando configuração", (e as Error).message ?? String(e));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function alternar() {
    if (resgatesAtivos === null || salvando) return;
    const novo = !resgatesAtivos;
    setSalvando(true);
    try {
      await salvarConfigApp(CONFIG_RESGATES_SICREDI, novo ? "on" : "off");
      setResgatesAtivos(novo);
      toast.success(
        novo ? "Resgates automáticos LIGADOS" : "Resgates automáticos DESLIGADOS",
        novo
          ? "Despesas na conta Sicredi voltam a gerar o resgate automático do Invest."
          : "Novos lançamentos na conta Sicredi NÃO geram mais resgate automático. Os resgates já existentes não foram alterados.",
      );
    } catch (e: unknown) {
      toast.error("Não foi possível salvar", (e as Error).message ?? String(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>Resgates automáticos — Sicredi Invest</CardTitle>
          <Landmark size={16} className="text-stone-400" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="text-sm text-stone-600 space-y-2 max-w-xl">
              <p>
                <b className="text-stone-800">Como funciona hoje:</b> ao lançar uma despesa vinculada à conta
                Sicredi (0913), o sistema gera automaticamente um <b>resgate da conta Invest</b> no dia útil
                anterior ao vencimento, para suprir o pagamento.
              </p>
              <p>
                Quando vocês deixarem de trabalhar com essa sistemática e passarem a operar direto na{" "}
                <b>conta corrente</b>, basta desligar a chave ao lado — nenhuma outra configuração é
                necessária, e dá para religar a qualquer momento.
              </p>
              <p className="text-xs text-stone-400">
                Desligar NÃO altera resgates e vínculos já existentes — apenas os lançamentos novos deixam de
                gerar resgate automático.
              </p>
            </div>
            {resgatesAtivos === null ? (
              <span className="inline-flex items-center gap-2 text-sm text-stone-400">
                <Loader2 size={16} className="animate-spin" /> Carregando…
              </span>
            ) : (
              <button
                type="button"
                role="switch"
                aria-checked={resgatesAtivos}
                disabled={!canEdit || salvando}
                onClick={alternar}
                title={canEdit
                  ? (resgatesAtivos ? "Clique para DESLIGAR os resgates automáticos" : "Clique para LIGAR os resgates automáticos")
                  : "Apenas administradores podem alterar"}
                className={`relative inline-flex h-8 w-32 items-center rounded-full transition-colors text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  resgatesAtivos ? "bg-emerald-600 text-white" : "bg-stone-300 text-stone-700"
                }`}
              >
                <span className={`absolute h-6 w-6 rounded-full bg-white shadow transition-all ${resgatesAtivos ? "right-1" : "left-1"}`} />
                <span className={`w-full ${resgatesAtivos ? "pr-8 text-right" : "pl-8 text-left"} px-3`}>
                  {salvando ? "…" : resgatesAtivos ? "LIGADO" : "DESLIGADO"}
                </span>
              </button>
            )}
          </div>
        </CardContent>
      </Card>
      <p className="text-xs text-stone-400">
        As automações valem para todo o sistema. Alterações exigem a migration 0047 aplicada no banco.
      </p>
    </div>
  );
}
