"use client";
import { User, LogOut, ChevronDown } from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import { NotificacoesBell } from "@/components/layout/NotificacoesBell";

interface HeaderProps {
  userName?: string;
  userRole?: string;
  pageTitle?: string;
}

export function Header({ userName = "Usuário", userRole = "Admin", pageTitle }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="h-14 bg-white border-b border-stone-200 px-6 flex items-center justify-between shrink-0 z-10">
      {/* Page title */}
      <div>
        {pageTitle && (
          <h1 className="text-sm font-semibold text-stone-800">{pageTitle}</h1>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Notification bell — Central de Alertas */}
        <NotificacoesBell />

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-stone-100 transition"
          >
            <div className="w-7 h-7 rounded-full bg-[#3a6230] flex items-center justify-center text-white text-xs font-bold shrink-0">
              {userName[0]?.toUpperCase()}
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-xs font-semibold text-stone-800 leading-tight">{userName}</p>
              <p className="text-[10px] text-stone-400 capitalize">{userRole}</p>
            </div>
            <ChevronDown size={14} className="text-stone-400" />
          </button>

          {menuOpen && (
            <div
              className="absolute right-0 top-full mt-1 w-48 bg-white border border-stone-200 rounded-xl shadow-xl py-1 z-50"
              onBlur={() => setMenuOpen(false)}
            >
              <Link
                href="/dashboard/perfil"
                className="flex items-center gap-2 px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50"
                onClick={() => setMenuOpen(false)}
              >
                <User size={14} />
                Meu Perfil
              </Link>
              <hr className="my-1 border-stone-100" />
              <form action="/auth/logout" method="POST">
                <button
                  type="submit"
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-red-600 hover:bg-red-50"
                >
                  <LogOut size={14} />
                  Sair
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
