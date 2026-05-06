"use client";
import { useState, useMemo } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { Search, Download, RefreshCw, Shield, MessageSquare, Upload, ArrowDown, Database, Settings } from "lucide-react";
import { formatDateTime } from "@/lib/utils/format";

type LogTipo = "auth" | "chat" | "import" | "export" | "crud" | "system";

interface LogEntry {
  id: string;
  tipo: LogTipo;
  acao: string;
  descricao: string;
  usuario: string;
  ip: string;
  created_at: string;
}

function genId() { return Math.random().toString(36).slice(2); }

const tipoBadge: Record<LogTipo, { variant: "success"|"info"|"warning"|"neutral"|"accent"|"danger"; label: string; icon: React.ReactNode }> = {
  auth:   { variant: "success", label: "Auth",     icon: <Shield size={11}/> },
  chat:   { variant: "info",    label: "Chat",     icon: <MessageSquare size={11}/> },
  import: { variant: "warning", label: "Importação",icon: <Upload size={11}/> },
  export: { variant: "accent",  label: "Exportação",icon: <ArrowDown size={11}/> },
  crud:   { variant: "neutral", label: "CRUD",     icon: <Database size={11}/> },
  system: { variant: "danger",  label: "Sistema",  icon: <Settings size={11}/> },
};

const USERS = ["adriana@arambi.com","joao@arambi.com","sistema","maria@arambi.com"];

function randomDate(base = new Date()) {
  const d = new Date(base.getTime() - Math.random() * 7 * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

function mkLog(tipo: LogTipo, acao: string, descricao: string, usuario: string, ip: string): LogEntry {
  return { id: genId(), tipo, acao, descricao, usuario, ip, created_at: randomDate() };
}

const LOGS: LogEntry[] = [
  mkLog("auth",   "LOGIN",          "Login bem-sucedido",                        USERS[0], "192.168.1.10"),
  mkLog("crud",   "CREATE",         "Nova transação: Contrato de Serviços",       USERS[0], "192.168.1.10"),
  mkLog("chat",   "CHAT_MESSAGE",   "Mensagem enviada ao Assistente Financeiro",  USERS[0], "192.168.1.10"),
  mkLog("export", "EXPORT_PDF",     "Exportação de relatório financeiro jan/2024",USERS[1], "192.168.1.11"),
  mkLog("import", "IMPORT_SHEET",   "Importação da planilha fev/2024",            USERS[0], "192.168.1.10"),
  mkLog("auth",   "LOGOUT",         "Sessão encerrada",                           USERS[1], "192.168.1.11"),
  mkLog("crud",   "UPDATE",         "Produto 'Sementes Milho HB' atualizado",     USERS[2], "127.0.0.1"),
  mkLog("system", "CRON_JOB",       "Sync automático com Supabase",               "sistema","127.0.0.1"),
  mkLog("crud",   "DELETE",         "Documento 'Nota Fiscal 99.pdf' removido",    USERS[3], "192.168.1.12"),
  mkLog("auth",   "LOGIN",          "Login bem-sucedido",                         USERS[3], "192.168.1.12"),
  mkLog("export", "EXPORT_RECIBO",  "Recibo REC-001 exportado em PDF",            USERS[0], "192.168.1.10"),
  mkLog("import", "IMPORT_ESTOQUE", "47 produtos importados via CSV",             USERS[0], "192.168.1.10"),
].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

const PAGE_SIZE = 10;

const TIPO_COUNTS = (Object.keys(tipoBadge) as LogTipo[]).map(t => ({
  tipo: t, count: LOGS.filter(l => l.tipo === t).length, ...tipoBadge[t],
}));

export function LogsPage() {
  const [search, setSearch] = useState("");
  const [filterTipo, setFilterTipo] = useState<LogTipo | "">("");
  const [filterUser, setFilterUser] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => LOGS.filter((l) => {
    const q = search.toLowerCase();
    return (
      (!q || l.descricao.toLowerCase().includes(q) || l.acao.toLowerCase().includes(q) || l.usuario.toLowerCase().includes(q)) &&
      (!filterTipo || l.tipo === filterTipo) &&
      (!filterUser || l.usuario === filterUser)
    );
  }), [search, filterTipo, filterUser]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-6 max-w-[1200px]">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#0f1f1c]">Logs do Sistema</h1>
          <p className="text-sm text-stone-500">Auditoria completa de chats, importações, exportações e banco de dados</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm"><RefreshCw size={14} /></Button>
          <Button variant="outline" size="sm"><Download size={14} /> Exportar Logs</Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {TIPO_COUNTS.map(({ tipo, count, label, variant, icon }) => (
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
              {USERS.map(u => <option key={u}>{u}</option>)}
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
                {paged.map((log) => {
                  const meta = tipoBadge[log.tipo];
                  return (
                    <tr key={log.id} className="border-b border-stone-50 hover:bg-stone-50 transition table-row-alt">
                      <td className="px-4 py-3 text-stone-500 text-xs whitespace-nowrap">{formatDateTime(log.created_at)}</td>
                      <td className="px-4 py-3">
                        <Badge variant={meta.variant}>
                          <span className="flex items-center gap-1">{meta.icon}{meta.label}</span>
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-stone-600">{log.acao}</td>
                      <td className="px-4 py-3 text-stone-600 text-xs max-w-[260px] truncate">{log.descricao}</td>
                      <td className="px-4 py-3 text-stone-500 text-xs">{log.usuario}</td>
                      <td className="px-4 py-3 font-mono text-xs text-stone-400">{log.ip}</td>
                    </tr>
                  );
                })}
                {paged.length === 0 && (
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
