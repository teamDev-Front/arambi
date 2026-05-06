import { cn } from "@/lib/utils/cn";

export type BadgeVariant = "success" | "warning" | "danger" | "info" | "neutral" | "accent";

interface BadgeProps {
  variant?: BadgeVariant;
  className?: string;
  children: React.ReactNode;
}

const variantClasses: Record<BadgeVariant, string> = {
  success: "bg-[#0f3d2a] text-emerald-200",
  warning: "bg-[#3d2a00] text-amber-200",
  danger:  "bg-[#3d0f0f] text-red-200",
  info:    "bg-[#0f2a3d] text-sky-200",
  neutral: "bg-[#2a2a2a] text-stone-300",
  accent:  "bg-[#3d2a00] text-amber-200",
};

export function Badge({ variant = "neutral", className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
        variantClasses[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
