import { cn } from "@/lib/utils/cn";
import { TrendingUp, TrendingDown, Minus, HelpCircle } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";

interface KpiCardProps {
  label: string;
  value: string;
  change?: number;
  trend?: "up" | "down" | "neutral";
  icon?: React.ReactNode;
  className?: string;
  helpText?: string;       // tooltip explicativo opcional
}

export function KpiCard({ label, value, change, trend = "neutral", icon, className, helpText }: KpiCardProps) {
  const trendColor =
    trend === "up" ? "text-green-600" : trend === "down" ? "text-red-500" : "text-stone-400";
  const TrendIcon =
    trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;

  return (
    <div
      className={cn(
        "bg-white rounded-xl border border-stone-200 shadow-sm p-5 flex flex-col gap-3",
        className
      )}
    >
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium text-[#1a2e28]/60 uppercase tracking-wide flex items-center gap-1.5">
          {label}
          {helpText && (
            <Tooltip text={helpText} position="bottom">
              <HelpCircle size={11} className="text-stone-300 hover:text-stone-500" />
            </Tooltip>
          )}
        </span>
        {icon && (
          <span className="p-2 rounded-lg bg-[#e8f0ee] text-[#1a4d40]">{icon}</span>
        )}
      </div>
      <div className="text-2xl font-bold text-stone-900">{value}</div>
      {change !== undefined && (
        <div className={cn("flex items-center gap-1 text-xs font-medium", trendColor)}>
          <TrendIcon size={13} />
          <span>{Math.abs(change).toFixed(1)}% vs mês anterior</span>
        </div>
      )}
    </div>
  );
}
