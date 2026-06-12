"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import {
  LayoutDashboard,
  TrendingUp,
  Sprout,
  FileText,
  Bot,
  Receipt,
  ScrollText,
  ChevronLeft,
  ChevronRight,
  Leaf,
  Landmark,
  HandCoins,
  FileBarChart,
  Wallet,
  PiggyBank,
} from "lucide-react";
import { useState } from "react";

const navItems = [
  { label: "Home", href: "/dashboard", icon: LayoutDashboard },
  { label: "Financeiro", href: "/dashboard/financeiro", icon: TrendingUp },
  { label: "Bancos", href: "/dashboard/bancos", icon: Landmark },
  { label: "Saldos Mensais", href: "/dashboard/saldos", icon: Wallet },
  { label: "Orçamentos", href: "/dashboard/orcamentos", icon: PiggyBank },
  { label: "Vendas Futuras", href: "/dashboard/vendas-futuras", icon: HandCoins },
  { label: "Estoque & Safra", href: "/dashboard/estoque", icon: Sprout },
  { label: "Relatórios PDF", href: "/dashboard/relatorios", icon: FileBarChart },
  { label: "Documentos", href: "/dashboard/documentos", icon: FileText },
  { label: "Assistentes IA", href: "/dashboard/assistentes", icon: Bot },
  { label: "Recibos & Termos", href: "/dashboard/recibos", icon: Receipt },
  { label: "Logs do Sistema", href: "/dashboard/logs", icon: ScrollText },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "flex flex-col h-full transition-all duration-300 shrink-0 relative",
        collapsed ? "w-16" : "w-60"
      )}
      style={{ background: "linear-gradient(180deg, #2b2b2b 0%, #1a1a1a 100%)" }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-white/[0.07]">
        <div className="w-8 h-8 rounded-lg bg-accent-500 flex items-center justify-center shrink-0 shadow-md">
          <Leaf size={16} className="text-white" />
        </div>
        {!collapsed && (
          <div>
            <p className="font-bold text-sm text-white leading-tight tracking-wide">AramBI</p>
            <p className="text-[10px] text-stone-400">Gestão Agro</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 flex flex-col gap-0.5 px-2 overflow-y-auto">
        {navItems.map(({ label, href, icon: Icon }) => {
          const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/60",
                active
                  ? "bg-gradient-to-r from-accent-600 to-accent-400 text-white shadow-sm border-r-[3px] border-accent-300"
                  : "text-stone-300 hover:bg-white/6 hover:text-white"
              )}
            >
              <Icon
                size={18}
                className={cn("shrink-0 transition-colors", active ? "text-white" : "text-stone-400 group-hover:text-stone-200")}
              />
              {!collapsed && <span>{label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-20 z-10 w-6 h-6 rounded-full bg-accent-500 text-white flex items-center justify-center shadow-lg hover:bg-accent-400 transition"
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>

      {/* Bottom */}
      {!collapsed && (
        <div className="px-4 py-3 border-t border-white/6 text-[10px] text-stone-500">
          AramBI © 2024
        </div>
      )}
    </aside>
  );
}
