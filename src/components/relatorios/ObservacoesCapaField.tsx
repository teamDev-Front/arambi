"use client";
import { Textarea } from "@/components/ui/Input";
import type { ContabilObservacao } from "@/lib/pdfmonkey/types";

/**
 * Texto do campo → lista de observações do PDF: uma por linha; linhas em
 * branco somem. Mesmo formato do Relatório Contábil ({ titulo, texto }) com o
 * título vazio — vazio vira `undefined` (a requisição sai igual à de antes).
 */
export function observacoesDoTexto(texto: string): ContabilObservacao[] | undefined {
  const linhas = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return linhas.length > 0 ? linhas.map((l) => ({ titulo: "", texto: l })) : undefined;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** Linha de ajuda abaixo do campo (cada tela explica onde as observações aparecem). */
  ajuda?: string;
}

/**
 * Observações livres das capas (pedido de 20-out): uma por linha, opcional.
 * Vão no campo `observacoes` do JSON enviado ao PDFMonkey.
 */
export function ObservacoesCapaField({ value, onChange, ajuda }: Props) {
  return (
    <div className="space-y-1.5">
      <Textarea
        label="Observações"
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Opcional — uma observação por linha"
      />
      <p className="text-xs text-stone-400">
        {ajuda ?? "Cada linha vira uma observação no quadro de observações da capa (o quadro depende do template do PDFMonkey)."}
      </p>
    </div>
  );
}
