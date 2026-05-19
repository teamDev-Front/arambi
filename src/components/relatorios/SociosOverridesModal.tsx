"use client";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { FileText } from "lucide-react";
import type { RelatorioSociosOverrides } from "@/lib/pdfmonkey/types";

interface Props {
  open: boolean;
  mesRef: string;
  onClose: () => void;
  onConfirmar: (overrides: RelatorioSociosOverrides) => void | Promise<void>;
  submitting: boolean;
}

export function SociosOverridesModal({ open, mesRef, onClose, onConfirmar, submitting }: Props) {
  const [v, setV] = useState<RelatorioSociosOverrides>({
    saldo_inicial_texto:      "",
    nota_entradas:            "",
    nota_saidas:              "",
    nota_obra_sede:           "",
    nota_despesas_classif:    "",
    nota_impostos:            "",
    nota_distribuicao_lucro:  "",
  });

  function update<K extends keyof RelatorioSociosOverrides>(k: K, val: string) {
    setV((prev) => ({ ...prev, [k]: val }));
  }

  // Remove campos vazios antes de mandar (deixa o builder usar o default auto-gerado)
  function handleConfirmar() {
    const limpo: RelatorioSociosOverrides = {};
    for (const [k, val] of Object.entries(v)) {
      if (val && val.trim()) (limpo as Record<string, string>)[k] = val.trim();
    }
    void onConfirmar(limpo);
  }

  return (
    <Modal open={open} onClose={onClose} title={`Relatório Sócios — Notas editáveis (${mesRef})`} size="xl">
      <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
        <p className="text-xs text-stone-500">
          Os valores e gráficos são <strong>gerados automaticamente</strong> a partir dos lançamentos do mês.
          Os campos abaixo são <strong>textos explicativos opcionais</strong>: deixe em branco para usar o padrão.
        </p>

        <Textarea
          label="Saldo inicial de caixa (texto que aparece na visão geral)"
          rows={3}
          value={v.saldo_inicial_texto ?? ""}
          onChange={(e) => update("saldo_inicial_texto", e.target.value)}
          placeholder="Em branco = gerado a partir dos saldos iniciais dos bancos cadastrados."
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Textarea
            label="Nota — Entradas (sobre Outros Recebimentos)"
            rows={4}
            value={v.nota_entradas ?? ""}
            onChange={(e) => update("nota_entradas", e.target.value)}
            placeholder="Padrão: texto explicando transferências internas entre contas."
          />
          <Textarea
            label="Nota — Saídas"
            rows={4}
            value={v.nota_saidas ?? ""}
            onChange={(e) => update("nota_saidas", e.target.value)}
            placeholder="Padrão: distribuição de lucro não está considerada nesta saída…"
          />
          <Textarea
            label="Nota — Obra da Sede"
            rows={4}
            value={v.nota_obra_sede ?? ""}
            onChange={(e) => update("nota_obra_sede", e.target.value)}
            placeholder="Padrão: valor total investido no mês (auto-gerado)."
          />
          <Textarea
            label="Nota — Despesas por Classificação"
            rows={4}
            value={v.nota_despesas_classif ?? ""}
            onChange={(e) => update("nota_despesas_classif", e.target.value)}
            placeholder="Padrão: explicação de despesas eventuais e periódicas."
          />
          <Textarea
            label="Nota — Impostos"
            rows={4}
            value={v.nota_impostos ?? ""}
            onChange={(e) => update("nota_impostos", e.target.value)}
            placeholder="Padrão: explicação sobre impostos administrativos e retidos."
          />
          <Textarea
            label="Nota — Distribuição de Lucro"
            rows={4}
            value={v.nota_distribuicao_lucro ?? ""}
            onChange={(e) => update("nota_distribuicao_lucro", e.target.value)}
            placeholder="Ex.: considerar adicionalmente o plano de saúde dos sócios…"
          />
        </div>
      </div>

      <div className="px-6 py-4 border-t border-stone-100 flex items-center justify-end gap-2 bg-stone-50/50">
        <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>Cancelar</Button>
        <Button onClick={handleConfirmar} disabled={submitting} loading={submitting}>
          <FileText size={13} /> Gerar PDF
        </Button>
      </div>
    </Modal>
  );
}
