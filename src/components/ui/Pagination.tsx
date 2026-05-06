"use client";
import { Fragment } from "react";
import { cn } from "@/lib/utils/cn";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function Pagination({ page, totalPages, onPageChange, className }: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = Array.from({ length: totalPages }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1
  );

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <button
        disabled={page === 1}
        onClick={() => onPageChange(page - 1)}
        className="p-1.5 rounded-md hover:bg-stone-100 disabled:opacity-30 disabled:cursor-default"
      >
        <ChevronLeft size={16} />
      </button>
      {pages.map((p, i) => {
        const prev = pages[i - 1];
        return (
          <Fragment key={p}>
            {prev && p - prev > 1 && (
              <span className="px-1.5 text-stone-400 text-sm">…</span>
            )}
            <button
              onClick={() => onPageChange(p)}
              className={cn(
                "w-8 h-8 rounded-md text-sm font-medium transition",
                page === p
                  ? "bg-[#3a6230] text-white"
                  : "hover:bg-stone-100 text-stone-600"
              )}
            >
              {p}
            </button>
          </Fragment>
        );
      })}
      <button
        disabled={page === totalPages}
        onClick={() => onPageChange(page + 1)}
        className="p-1.5 rounded-md hover:bg-stone-100 disabled:opacity-30 disabled:cursor-default"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
