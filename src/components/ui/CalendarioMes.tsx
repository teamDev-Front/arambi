"use client";
import { cn } from "@/lib/utils/cn";
import { ChevronLeft, ChevronRight } from "lucide-react";

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export const MESES_LABEL = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export interface CalendarioCelula {
  /** Data ISO local (YYYY-MM-DD) — nunca passa por Date UTC. */
  iso: string;
  dia: number;
  /** Pertence ao mês exibido (false = "sobra" do mês anterior/seguinte). */
  doMes: boolean;
  hoje: boolean;
}

interface CalendarioMesProps {
  ano: number;
  /** 1–12 */
  mes: number;
  onNavigate?: (ano: number, mes: number) => void;
  /** Conteúdo extra da célula (mm de chuva, badges de vacina...). */
  renderDia?: (celula: CalendarioCelula) => React.ReactNode;
  onDiaClick?: (celula: CalendarioCelula) => void;
  /** Células menores (uso na Home). */
  compact?: boolean;
  className?: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function isoLocalHoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Monta a grade (5–6 semanas) do mês, domingo→sábado, com sobras dos vizinhos. */
export function gradeDoMes(ano: number, mes: number): CalendarioCelula[] {
  const hojeIso = isoLocalHoje();
  const primeiro = new Date(ano, mes - 1, 1);
  const inicio = new Date(ano, mes - 1, 1 - primeiro.getDay()); // volta até domingo
  const celulas: CalendarioCelula[] = [];
  const cursor = new Date(inicio);
  // 6 semanas cobrem qualquer mês; corta a última se for toda de sobra.
  for (let i = 0; i < 42; i++) {
    const iso = `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(cursor.getDate())}`;
    celulas.push({
      iso,
      dia: cursor.getDate(),
      doMes: cursor.getMonth() === mes - 1,
      hoje: iso === hojeIso,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  const ultimaSemana = celulas.slice(35);
  return ultimaSemana.every((c) => !c.doMes) ? celulas.slice(0, 35) : celulas;
}

export function CalendarioMes({
  ano,
  mes,
  onNavigate,
  renderDia,
  onDiaClick,
  compact = false,
  className,
}: CalendarioMesProps) {
  const celulas = gradeDoMes(ano, mes);

  const navegar = (delta: number) => {
    if (!onNavigate) return;
    const total = ano * 12 + (mes - 1) + delta;
    onNavigate(Math.floor(total / 12), (total % 12) + 1);
  };

  return (
    <div className={className}>
      {/* Navegação */}
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => navegar(-1)}
          className="p-1.5 rounded-lg hover:bg-stone-100 text-stone-500 transition"
          aria-label="Mês anterior"
        >
          <ChevronLeft size={16} />
        </button>
        <p className="text-sm font-semibold text-stone-800">
          {MESES_LABEL[mes - 1]} <span className="text-stone-400 font-normal">{ano}</span>
        </p>
        <button
          type="button"
          onClick={() => navegar(1)}
          className="p-1.5 rounded-lg hover:bg-stone-100 text-stone-500 transition"
          aria-label="Próximo mês"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Cabeçalho dos dias */}
      <div className="grid grid-cols-7 mb-1">
        {DIAS_SEMANA.map((d) => (
          <div key={d} className="text-center text-[10px] font-semibold text-stone-400 uppercase tracking-wide py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Grade */}
      <div className="grid grid-cols-7 gap-px bg-stone-100 rounded-lg overflow-hidden border border-stone-100">
        {celulas.map((celula) => (
          <div
            key={celula.iso}
            onClick={() => onDiaClick?.(celula)}
            className={cn(
              "bg-white flex flex-col items-center gap-0.5 px-0.5",
              compact ? "min-h-10 py-1" : "min-h-14 py-1.5",
              !celula.doMes && "bg-stone-50",
              onDiaClick && "cursor-pointer hover:bg-accent-50 transition-colors"
            )}
          >
            <span
              className={cn(
                "text-xs leading-none flex items-center justify-center rounded-full",
                compact ? "w-5 h-5 text-[11px]" : "w-6 h-6",
                celula.doMes ? "text-stone-700 font-medium" : "text-stone-300",
                celula.hoje && "bg-accent-500 text-white font-bold"
              )}
            >
              {celula.dia}
            </span>
            {renderDia?.(celula)}
          </div>
        ))}
      </div>
    </div>
  );
}
