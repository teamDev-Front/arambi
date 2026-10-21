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
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Leaf,
  Landmark,
  HandCoins,
  FileBarChart,
  Wallet,
  PiggyBank,
  Settings,
  ShieldCheck,
  Users,
  CalendarClock,
  Wheat,
  PawPrint,
  Tractor,
  Carrot,
  ClipboardList,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { MODULO_POR_KEY, type ModuloKey } from "@/lib/acessos/modulos";
import { usePermissoes } from "@/components/acessos/PermissoesProvider";

type NavLink = { label: string; href: string; icon: LucideIcon; modulo: ModuloKey };
type NavGroup = { label: string; icon: LucideIcon; children: NavLink[] };
type NavEntry = NavLink | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
  return "children" in entry;
}

// Rótulo e rota vêm do catálogo de módulos (o mesmo das guardas de acesso).
const link = (modulo: ModuloKey, icon: LucideIcon): NavLink => ({
  label: MODULO_POR_KEY[modulo].label,
  href: MODULO_POR_KEY[modulo].href,
  icon,
  modulo,
});

const navItems: NavEntry[] = [
  link("home", LayoutDashboard),
  link("financeiro", TrendingUp),
  link("distribuicao", Users),
  link("bancos", Landmark),
  link("saldos", Wallet),
  link("orcamentos", PiggyBank),
  link("provisionamento", CalendarClock),
  link("vendas", HandCoins),
  {
    label: "Estoque & Safra",
    icon: Sprout,
    children: [
      link("estoque", Wheat),
      link("animais", PawPrint),
      link("maquinario", Tractor),
      link("horta", Carrot),
    ],
  },
  link("operacao", ClipboardList),
  link("relatorios", FileBarChart),
  link("documentos", FileText),
  link("assistentes", Bot),
  link("recibos", Receipt),
  link("lixeira", Trash2),
  link("logs", ScrollText),
  link("acessos", ShieldCheck),
  link("configuracoes", Settings),
];

/** Contadores ao lado do item (ex.: pedidos de nova senha em Acessos). */
export function Sidebar({ badges = {} }: { badges?: Partial<Record<ModuloKey, number>> }) {
  const pathname = usePathname();
  const { podeVer } = usePermissoes();
  const [collapsed, setCollapsed] = useState(false);
  // Grupos abertos: inicia aberto se a rota atual está dentro do grupo.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const entry of navItems) {
      if (isGroup(entry)) {
        initial[entry.label] = entry.children.some((c) => pathname.startsWith(c.href));
      }
    }
    return initial;
  });

  const isActive = (href: string) =>
    pathname === href || (href !== "/dashboard" && pathname.startsWith(href));

  const linkClasses = (active: boolean, child = false) =>
    cn(
      "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/60",
      child && "py-2 text-[13px]",
      active
        ? "bg-gradient-to-r from-accent-600 to-accent-400 text-white shadow-sm border-r-[3px] border-accent-300"
        : "text-stone-300 hover:bg-white/6 hover:text-white"
    );

  const renderLink = ({ label, href, icon: Icon, modulo }: NavLink, child = false) => {
    const active = isActive(href);
    const badge = badges[modulo] ?? 0;
    return (
      <Link
        key={href}
        href={href}
        title={collapsed ? (badge ? `${label} (${badge})` : label) : undefined}
        className={cn(linkClasses(active, child), "relative")}
      >
        <Icon
          size={child ? 16 : 18}
          className={cn("shrink-0 transition-colors", active ? "text-white" : "text-stone-400 group-hover:text-stone-200")}
        />
        {!collapsed && <span className="flex-1">{label}</span>}
        {badge > 0 && (
          <span
            className={cn(
              "flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white",
              collapsed && "absolute right-1 top-1 h-4 min-w-4 px-1 text-[9px]",
            )}
          >
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </Link>
    );
  };

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
        {navItems.map((entry) => {
          // Menu só com os módulos liberados (tela Acessos).
          if (!isGroup(entry)) return podeVer(entry.modulo) ? renderLink(entry) : null;

          const { label, icon: Icon } = entry;
          const children = entry.children.filter((c) => podeVer(c.modulo));
          if (children.length === 0) return null;
          const groupActive = children.some((c) => isActive(c.href));
          const open = openGroups[label] ?? false;

          return (
            <div key={label}>
              <button
                type="button"
                title={collapsed ? label : undefined}
                onClick={() => {
                  // Colapsada: expandir a sidebar já abrindo o grupo.
                  if (collapsed) {
                    setCollapsed(false);
                    setOpenGroups((prev) => ({ ...prev, [label]: true }));
                    return;
                  }
                  setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/60",
                  groupActive && !open
                    ? "bg-white/6 text-white"
                    : "text-stone-300 hover:bg-white/6 hover:text-white"
                )}
              >
                <Icon
                  size={18}
                  className={cn(
                    "shrink-0 transition-colors",
                    groupActive ? "text-accent-300" : "text-stone-400 group-hover:text-stone-200"
                  )}
                />
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left">{label}</span>
                    <ChevronDown
                      size={14}
                      className={cn("shrink-0 text-stone-500 transition-transform", open && "rotate-180")}
                    />
                  </>
                )}
              </button>
              {!collapsed && open && (
                <div className="mt-0.5 ml-4 pl-3 border-l border-white/10 flex flex-col gap-0.5">
                  {children.map((c) => renderLink(c, true))}
                </div>
              )}
            </div>
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
