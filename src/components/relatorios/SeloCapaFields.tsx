"use client";
import { Input } from "@/components/ui/Input";
import { MESES_LABEL } from "@/components/ui/CalendarioMes";

interface Props {
  /** Competência da capa ("YYYY-MM") — dá o valor automático do selo. */
  mesReferencia: string;
  numero: string;
  onNumeroChange: (v: string) => void;
  mes: string;
  onMesChange: (v: string) => void;
}

/**
 * Selo dourado da Capa do sócio (out-2026): número da capa no mês e mês de
 * referência, opcionais. A Adri manda mais de uma capa no mês, e o selo saía
 * sempre com o número do MÊS ("10º" em outubro). Em branco, segue assim.
 * Mesmo contrato da Capa Empresa (numero_lote / mes_referencia_label).
 */
export function SeloCapaFields({ mesReferencia, numero, onNumeroChange, mes, onMesChange }: Props) {
  const idx = Number(mesReferencia.slice(5, 7)) - 1;
  const mesAuto = MESES_LABEL[idx] ?? "";
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Número da capa"
          value={numero}
          onChange={(e) => onNumeroChange(e.target.value)}
          placeholder={mesAuto ? `Automático: ${idx + 1}º` : "ex.: 2º"}
        />
        <Input
          label="Mês de referência"
          value={mes}
          onChange={(e) => onMesChange(e.target.value)}
          placeholder={mesAuto ? `Automático: ${mesAuto}` : "ex.: Outubro"}
        />
      </div>
      <p className="text-xs text-stone-400">
        Vão no selo dourado da capa: 2º e Outubro saem como &quot;2º / OUTUBRO&quot;. Em branco, fica o automático.
      </p>
    </div>
  );
}
