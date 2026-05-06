import { cn } from "@/lib/utils/cn";

interface CardProps {
  className?: string;
  children: React.ReactNode;
}

export function Card({ className, children }: CardProps) {
  return (
    <div className={cn("bg-white rounded-xl border border-stone-200 shadow-sm", className)}>
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: CardProps) {
  return (
    <div className={cn("flex items-center justify-between px-5 py-4 border-b border-stone-100", className)}>
      {children}
    </div>
  );
}

export function CardTitle({ className, children }: CardProps) {
  return (
    <h3 className={cn("font-semibold text-[#1a2e28] text-sm", className)}>{children}</h3>
  );
}

export function CardContent({ className, children }: CardProps) {
  return <div className={cn("p-5", className)}>{children}</div>;
}
