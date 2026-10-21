"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/ui/Toast";
import { Search, Download, RefreshCw, Shield, MessageSquare, Upload, ArrowDown, Database, Settings, ChevronRight, Loader2 } from "lucide-react";
import { formatDateTime } from "@/lib/utils/format";
import { listarLogs, type LogLinha } from "@/lib/queries/logs";
import { exportLogsXlsx } from "@/lib/export/logs-export";
import { getNomeUsuarioAtual, linhaEmissao } from "@/lib/auth/usuario-atual";
import type { LogTipo } from "@/types";

// Auditoria real (tabela logs, migration 0007 + RLS 0058): acessos, convites,
// bloqueios, logins e logouts. Antes desta versão a tela mostrava exemplos fixos.

const tipoBadge: Record<LogTipo, { variant: "success"|"info"|"warning"|"neutral"|"accent"|"danger"; label: string; icon: React.ReactNode }> = {
  auth:   { variant: "success", label: "Acesso",     icon: <Shield size={11}/> },
  chat:   { variant: "info",    label: "Chat",       icon: <MessageSquare size={11}/> },
  import: { variant: "warning", label: "Importação", icon: <Upload size={11}/> },
  export: { variant: "accent",  label: "Exportação", icon: <ArrowDown size={11}/> },
  crud:   { variant: "neutral", label: "CRUD",       icon: <Database size={11}/> },
  system: { variant: "danger",  label: "Sistema",    icon: <Settings size={11}/> },
};

const PAGE_SIZE = 15;

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Metadados em linhas legíveis ("Módulos: Financeiro (edição), …"). */
function detalhes(meta: LogLinha["metadados"]): [string, string][] {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return [];
  const rotulos: Record<string, string> = {
    alvo_email: "Usuário afetado", nivel: "Nível", nivel_antes: "Nível antes", nivel_depois: "Nível depois",
    modulos: "Módulos", mudancas: "Mudanças", email_enviado: "E-mail enviado", motivo: "Motivo", aviso_auth: "Aviso do Auth",
  };
  return Object.entries(meta)
    .filter(([k]) => k in rotulos)
    .map(([k, v]) => [
      rotulos[k],
      Array.isArray(v) ? v.join(" · ") : typeof v === "boolean" ? (v ? "sim" : "não") : String(v ?? "—"),
    ]);
}

export function LogsPage() {
  const toast = useToast();
  const [logs, setLogs] = useState<LogLinha[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterTipo, setFilterTipo] = useState<LogTipo | "">("");
  const [filterUser, setFilterUser] = useState("");
  const [page, setPage] = useState(1);
  const [aberto, setAberto] = useState<string | null>(null);

  const avisarErro = useCallback((e: unknown) => {
    toast.error("Erro ao carregar os logs", e instanceof Error ? e.message : undefined);
  }, [toast]);

  useEffect(() => {
    let ativo = true;
    listarLogs()
      .then((r) => { if (ativo) setLogs(r); })
      .catch((e) => { if (ativo) avisarErro(e); })
      .finally(() => { if (ativo) setLoading(false); });
    return () => { ativo = false; };
  }, [avisarErro]);

  async function carregar() {
    setLoading(true);
    try {
      setLogs(await listarLogs());
    } catch (e) {
      avisarErro(e);
    } finally {
      setLoading(false);
    }
  }

  const usuarios = useMemo(
    () => Array.from(new Set(logs.map((l) => l.usuario_nome ?? "Sistema"))).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [logs],
  );

  const tipoCounts = useMemo(() => (Object.keys(tipoBadge) as LogTipo[]).map((t) => ({
    tipo: t, count: logs.filter((l) => l.tipo === t).length, ...tipoBadge[t],
  })), [logs]);

  const filtered = useMemo(() => {
    const q = normalizar(search.trim());
    return logs.filter((l) =>
      (!q || normalizar(`${l.descricao ?? ""} ${l.acao} ${l.usuario_nome ?? ""}`).includes(q)) &&
      (!filterTipo || l.tipo === filterTipo) &&
      (!filterUser || (l.usuario_nome ?? "Sistema") === filterUser),
    );
  }, [logs, search, filterTipo, filterUser]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  async function exportar() {
    if (filtered.length === 0) { toast.warning("Nada para exportar com esses filtros."); return; }
    exportLogsXlsx(filtered, (t) => tipoBadge[t].label, linhaEmissao(await getNomeUsuarioAtual()));
  }

  return (
    <div className="space-y-6 max-w-[1600px]">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#0f1f1c]">Logs do Sistema</h1>
          <p className="text-sm text-stone-500">Auditoria de acessos: convites, alterações de permissão, bloqueios, logins e saídas</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => void carregar()} title="Atualizar">
            <RefreshCw size={14} className={loading ? "animate-spin" : undefined} />
          </Button>
          <Button variant="outline" size="sm" onClick={() => void exportar()}><Download size={14} /> Exportar Logs</Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {tipoCounts.map(({ tipo, count, label, variant, icon }) => (
          <button
            key={tipo}
            onClick={() => { setFilterTipo(filterTipo === tipo ? "" : tipo); setPage(1); }}
            className={`flex flex-col items-center gap-1 p-3 bg-white rounded-xl border transition ${
              filterTipo === tipo ? "border-accent-400 shadow-md" : "border-stone-200 hover:border-stone-300"
            }`}
          >
            <Badge variant={variant}>
              <span className="flex items-center gap-1">{icon}{label}</span>
            </Badge>
            <span className="text-lg font-bold text-stone-800">{count}</span>
          </button>
        ))}
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Registros de Auditoria ({filtered.length})</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Buscar logs..."
                className="h-8 rounded-lg border border-stone-200 pl-8 pr-3 text-xs w-52 focus:outline-none focus:ring-1 focus:ring-accent-400"
              />
            </div>
            <select value={filterTipo} onChange={(e) => { setFilterTipo(e.target.value as LogTipo | ""); setPage(1); }} className="h-8 rounded-lg border border-stone-200 px-2 text-xs focus:outline-none">
              <option value="">Todos os tipos</option>
              {(Object.keys(tipoBadge) as LogTipo[]).map(t => <option key={t} value={t}>{tipoBadge[t].label}</option>)}
            </select>
            <select value={filterUser} onChange={(e) => { setFilterUser(e.target.value); setPage(1); }} className="h-8 rounded-lg border border-stone-200 px-2 text-xs focus:outline-none">
              <option value="">Todos os usuários</option>
              {usuarios.map(u => <option key={u}>{u}</option>)}
            </select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-100">
                  {["Data/Hora","Tipo","Ação","Descrição","Usuário","IP"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-stone-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && logs.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-stone-400">
                    <Loader2 size={16} className="inline animate-spin mr-2" />Carregando...
                  </td></tr>
                )}
                {paged.map((log) => {
                  const meta = tipoBadge[log.tipo];
                  const linhas = detalhes(log.metadados);
                  const expandido = aberto === log.id;
                  return (
                    <Fragment key={log.id}>
                      <tr
                        className={`border-b border-stone-50 hover:bg-stone-50 transition table-row-alt ${linhas.length ? "cursor-pointer" : ""}`}
                        onClick={() => linhas.length && setAberto(expandido ? null : log.id)}
                      >
                        <td className="px-4 py-3 text-stone-500 text-xs whitespace-nowrap">
                          {linhas.length > 0 && (
                            <ChevronRight size={12} className={`inline -ml-1 mr-1 text-stone-400 transition-transform ${expandido ? "rotate-90" : ""}`} />
                          )}
                          {formatDateTime(log.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={meta.variant}>
                            <span className="flex items-center gap-1">{meta.icon}{meta.label}</span>
                          </Badge>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-stone-600">{log.acao}</td>
                        <td className="px-4 py-3 text-stone-600 text-xs max-w-[420px] truncate" title={log.descricao ?? ""}>{log.descricao}</td>
                        <td className="px-4 py-3 text-stone-500 text-xs">{log.usuario_nome ?? "Sistema"}</td>
                        <td className="px-4 py-3 font-mono text-xs text-stone-400">{log.ip ?? "—"}</td>
                      </tr>
                      {expandido && (
                        <tr className="border-b border-stone-100 bg-stone-50/60">
                          <td colSpan={6} className="px-10 py-3">
                            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
                              {linhas.map(([k, v]) => (
                                <Fragment key={k}>
                                  <dt className="font-medium text-stone-500">{k}</dt>
                                  <dd className="text-stone-700">{v}</dd>
                                </Fragment>
                              ))}
                            </dl>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {!loading && paged.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-stone-400">Nenhum log encontrado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-t border-stone-100">
            <p className="text-xs text-stone-400">{filtered.length} registro(s)</p>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
