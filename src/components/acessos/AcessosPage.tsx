"use client";
// Tela Acessos (só Super Admin): quem entra no sistema, o que vê e o que altera.
// Toda escrita passa pelas rotas /api/acessos (service role + auditoria em Logs).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  UserPlus, Search, Pencil, Mail, Link2, Ban, Unlock, X, Crown, PencilLine, Eye,
  Users, Clock, ShieldCheck, ShieldAlert, KeyRound, RefreshCw, UserCheck, Loader2, Lock, Database,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Input";
import { KpiCard } from "@/components/ui/KpiCard";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";
import { MODULOS_CONCEDIVEIS, MODULO_POR_KEY, type ModuloConcedivel } from "@/lib/acessos/modulos";
import { NIVEL_GERAL_LABEL, type NivelGeral } from "@/lib/acessos/permissoes";
import {
  STATUS_ACESSO_LABEL, type AcaoAcesso, type AcessoPayload, type ListaAcessos, type StatusAcesso, type UsuarioAcesso,
} from "@/lib/acessos/tipos";
import {
  atualizarAcesso, cancelarConvite, criarAcesso, executarAcao, listarAcessos, ErroAcessos,
} from "@/lib/queries/acessos";
import { AcessoFormModal } from "./AcessoFormModal";
import { ConviteLinkModal, type ConviteExibido } from "./ConviteLinkModal";

// ---------------------------------------------------------------------------
// Visual
// ---------------------------------------------------------------------------

const NIVEL_PILL: Record<NivelGeral, { cls: string; icon: typeof Crown }> = {
  super_admin: { cls: "bg-accent-100 text-accent-800 ring-accent-200", icon: Crown },
  edicao:      { cls: "bg-emerald-50 text-emerald-800 ring-emerald-200", icon: PencilLine },
  leitura:     { cls: "bg-sky-50 text-sky-800 ring-sky-200", icon: Eye },
  sem_acesso:  { cls: "bg-stone-100 text-stone-600 ring-stone-200", icon: Lock },
};

const STATUS_PILL: Record<StatusAcesso, { dot: string; cls: string }> = {
  ativo:            { dot: "bg-emerald-500", cls: "text-emerald-800 bg-emerald-50" },
  convite_pendente: { dot: "bg-amber-500",   cls: "text-amber-800 bg-amber-50" },
  bloqueado:        { dot: "bg-red-500",     cls: "text-red-700 bg-red-50" },
  sem_liberacao:    { dot: "bg-stone-400",   cls: "text-stone-600 bg-stone-100" },
};

const AVATAR_CORES = [
  "bg-[#246354]", "bg-[#a67c20]", "bg-[#3a6230]", "bg-[#1a4d40]", "bg-[#836016]", "bg-[#5b6b3a]", "bg-[#7a4e2d]",
];

function corAvatar(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_CORES[h % AVATAR_CORES.length];
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
}

const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

function tempoRelativo(iso: string | null): string {
  if (!iso) return "Nunca entrou";
  const diffMin = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  const abs = Math.abs(diffMin);
  if (abs < 1) return "agora";
  if (abs < 60) return rtf.format(diffMin, "minute");
  if (abs < 60 * 24) return rtf.format(Math.round(diffMin / 60), "hour");
  if (abs < 60 * 24 * 30) return rtf.format(Math.round(diffMin / (60 * 24)), "day");
  return new Intl.DateTimeFormat("pt-BR").format(new Date(iso));
}

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

type Confirmacao = { tipo: "bloquear" | "desbloquear" | "cancelar" | "gerar_link"; usuario: UsuarioAcesso };
type ModalForm = { usuario: UsuarioAcesso | null; liberarAoSalvar?: boolean };

export function AcessosPage() {
  const toast = useToast();
  const [usuarios, setUsuarios] = useState<UsuarioAcesso[]>([]);
  const [meuId, setMeuId] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState<{ msg: string; migration: boolean } | null>(null);

  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<StatusAcesso | "todos">("todos");
  const [filtroNivel, setFiltroNivel] = useState<NivelGeral | "todos">("todos");
  const [filtroSetor, setFiltroSetor] = useState("todos");

  const [modal, setModal] = useState<ModalForm | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [convite, setConvite] = useState<ConviteExibido | null>(null);
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const aplicarLista = useCallback((r: ListaAcessos) => {
    setUsuarios(r.usuarios);
    setMeuId(r.meuId);
    setErroCarga(null);
  }, []);

  const aplicarErro = useCallback((e: unknown) => {
    const migration = e instanceof ErroAcessos && e.codigo === "migration_pendente";
    setErroCarga({ msg: e instanceof Error ? e.message : "Falha ao carregar.", migration });
  }, []);

  useEffect(() => {
    let ativo = true;
    listarAcessos()
      .then((r) => { if (ativo) aplicarLista(r); })
      .catch((e) => { if (ativo) aplicarErro(e); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [aplicarLista, aplicarErro]);

  async function carregar() {
    setCarregando(true);
    try {
      aplicarLista(await listarAcessos());
    } catch (e) {
      aplicarErro(e);
    } finally {
      setCarregando(false);
    }
  }

  const substituir = (u: UsuarioAcesso | null | undefined) => {
    if (!u) return;
    setUsuarios((prev) => (prev.some((p) => p.id === u.id) ? prev.map((p) => (p.id === u.id ? u : p)) : [...prev, u]));
  };

  // ---- Indicadores e filtros ------------------------------------------------
  const kpis = useMemo(() => ({
    ativos: usuarios.filter((u) => u.status === "ativo").length,
    pendentes: usuarios.filter((u) => u.status === "convite_pendente").length,
    bloqueados: usuarios.filter((u) => u.status === "bloqueado").length,
    superAdmins: usuarios.filter((u) => u.superAdmin && u.status !== "bloqueado").length,
    semLiberacao: usuarios.filter((u) => u.status === "sem_liberacao").length,
  }), [usuarios]);

  const setores = useMemo(
    () => Array.from(new Set(usuarios.map((u) => u.setor).filter((s): s is string => !!s))).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [usuarios],
  );

  const filtrados = useMemo(() => {
    const termo = normalizar(busca.trim());
    return usuarios
      .filter((u) => filtroStatus === "todos" || u.status === filtroStatus)
      .filter((u) => filtroNivel === "todos" || u.nivel === filtroNivel)
      .filter((u) => filtroSetor === "todos" || u.setor === filtroSetor)
      .filter((u) => !termo || normalizar(`${u.nome} ${u.email} ${u.cargo ?? ""} ${u.setor ?? ""}`).includes(termo))
      .sort((a, b) => {
        // Você primeiro; depois quem precisa de atenção; depois nome.
        if (a.id === meuId) return -1;
        if (b.id === meuId) return 1;
        const peso = (s: StatusAcesso) => (s === "sem_liberacao" ? 0 : s === "convite_pendente" ? 1 : s === "ativo" ? 2 : 3);
        return peso(a.status) - peso(b.status) || a.nome.localeCompare(b.nome, "pt-BR");
      });
  }, [usuarios, busca, filtroStatus, filtroNivel, filtroSetor, meuId]);

  const temFiltro = busca.trim() !== "" || filtroStatus !== "todos" || filtroNivel !== "todos" || filtroSetor !== "todos";

  // ---- Ações ----------------------------------------------------------------
  async function salvar(payload: AcessoPayload) {
    if (!modal) return;
    setSalvando(true);
    try {
      if (!modal.usuario) {
        const r = await criarAcesso(payload);
        substituir(r.usuario);
        setModal(null);
        setConvite({ ...r, nome: payload.nome, email: payload.email ?? "", contexto: "convite" });
      } else {
        const r = await atualizarAcesso(modal.usuario.id, payload);
        let usuario = r.usuario;
        if (modal.liberarAoSalvar) {
          const lib = await executarAcao(modal.usuario.id, "desbloquear");
          usuario = lib.usuario ?? usuario;
        }
        substituir(usuario);
        setModal(null);
        toast.success(modal.liberarAoSalvar ? "Acesso liberado" : "Acesso atualizado", payload.nome);
      }
    } catch (e) {
      toast.error("Não foi possível salvar", e instanceof Error ? e.message : undefined);
    } finally {
      setSalvando(false);
    }
  }

  async function acao(u: UsuarioAcesso, tipo: AcaoAcesso) {
    setOcupado(u.id);
    try {
      const r = await executarAcao(u.id, tipo);
      if (r.usuario) substituir(r.usuario);
      if (tipo === "bloquear") toast.success(`${u.nome} bloqueado(a)`, "A pessoa foi desconectada e não consegue mais entrar.");
      else if (tipo === "desbloquear") toast.success(`${u.nome} desbloqueado(a)`, "O acesso voltou com os mesmos módulos.");
      else {
        setConvite({
          ...r,
          nome: u.nome,
          email: u.email,
          contexto: u.status === "convite_pendente" ? "convite" : "senha",
        });
      }
      if (r.aviso) toast.warning("Aviso do Supabase Auth", r.aviso);
    } catch (e) {
      toast.error("Não foi possível concluir", e instanceof Error ? e.message : undefined);
    } finally {
      setOcupado(null);
      setConfirmacao(null);
    }
  }

  async function cancelar(u: UsuarioAcesso) {
    setOcupado(u.id);
    try {
      await cancelarConvite(u.id);
      setUsuarios((prev) => prev.filter((p) => p.id !== u.id));
      toast.success("Convite cancelado", `${u.email} foi removido.`);
    } catch (e) {
      toast.error("Não foi possível cancelar", e instanceof Error ? e.message : undefined);
    } finally {
      setOcupado(null);
      setConfirmacao(null);
    }
  }

  async function confirmar() {
    if (!confirmacao) return;
    const { tipo, usuario } = confirmacao;
    if (tipo === "cancelar") await cancelar(usuario);
    else await acao(usuario, tipo);
  }

  // ---- Render ---------------------------------------------------------------
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#0f1f1c]">Acessos</h1>
          <p className="text-sm text-stone-500 max-w-2xl">
            Cadastre quem entra no AramBI, escolha os módulos de cada pessoa e se ela pode alterar dados ou só consultar.
            A pessoa recebe um convite para criar a própria senha.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void carregar()} title="Atualizar lista">
            <RefreshCw size={14} className={cn(carregando && "animate-spin")} />
          </Button>
          <Button onClick={() => setModal({ usuario: null })} disabled={!!erroCarga?.migration}>
            <UserPlus size={15} /> Novo acesso
          </Button>
        </div>
      </div>

      {erroCarga?.migration && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Database size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold">Falta aplicar a migration 0058 no banco</p>
            <p className="mt-0.5 text-amber-800/90">
              Abra o SQL Editor do Supabase e rode <code className="rounded bg-amber-100 px-1.5 py-0.5 text-xs">supabase/migrations/0058_acessos.sql</code>.
              Depois atualize esta página.
            </p>
          </div>
        </div>
      )}
      {erroCarga && !erroCarga.migration && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span>{erroCarga.msg}</span>
          <Button variant="outline" size="sm" onClick={() => void carregar()}>Tentar de novo</Button>
        </div>
      )}

      {/* Indicadores */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Usuários ativos" value={String(kpis.ativos)} icon={<UserCheck size={16} />}
          helpText="Pessoas que já criaram a senha e podem entrar." />
        <KpiCard label="Convites pendentes" value={String(kpis.pendentes)} icon={<Clock size={16} />}
          helpText="Convidados que ainda não criaram a senha. Reenvie o convite ou mande o link pelo WhatsApp." />
        <KpiCard label="Bloqueados" value={String(kpis.bloqueados)} icon={<Ban size={16} />}
          helpText="Não conseguem entrar. O histórico do que fizeram continua no sistema." />
        <KpiCard label="Super Admins" value={String(kpis.superAdmins)} icon={<Crown size={16} />}
          helpText="Acesso total, inclusive a esta tela. O sistema nunca fica sem pelo menos um." />
      </div>

      {kpis.semLiberacao > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-700">
          <ShieldAlert size={18} className="mt-0.5 shrink-0 text-stone-500" />
          <span>
            <b>{kpis.semLiberacao} cadastro(s) aguardando liberação</b> — foram criados fora desta tela (ex.: cadastro
            público do Supabase) e não acessam nada até você liberar e escolher os módulos.
          </span>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative w-full sm:w-72">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, e-mail, cargo ou setor"
            className="h-9 w-full rounded-lg border border-stone-300 bg-white pl-9 pr-3 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent"
          />
        </div>
        <div className="w-44">
          <Select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as StatusAcesso | "todos")} aria-label="Status">
            <option value="todos">Todos os status</option>
            {(Object.keys(STATUS_ACESSO_LABEL) as StatusAcesso[]).map((s) => (
              <option key={s} value={s}>{STATUS_ACESSO_LABEL[s]}</option>
            ))}
          </Select>
        </div>
        <div className="w-40">
          <Select value={filtroNivel} onChange={(e) => setFiltroNivel(e.target.value as NivelGeral | "todos")} aria-label="Nível">
            <option value="todos">Todos os níveis</option>
            {(["super_admin", "edicao", "leitura"] as NivelGeral[]).map((n) => (
              <option key={n} value={n}>{NIVEL_GERAL_LABEL[n]}</option>
            ))}
          </Select>
        </div>
        {setores.length > 0 && (
          <div className="w-44">
            <Select value={filtroSetor} onChange={(e) => setFiltroSetor(e.target.value)} aria-label="Setor">
              <option value="todos">Todos os setores</option>
              {setores.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
        )}
        {temFiltro && (
          <button
            type="button"
            className="h-9 text-xs font-medium text-stone-500 hover:text-accent-700"
            onClick={() => { setBusca(""); setFiltroStatus("todos"); setFiltroNivel("todos"); setFiltroSetor("todos"); }}
          >
            Limpar filtros
          </button>
        )}
      </div>

      {/* Lista */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100 bg-stone-50/70 text-left text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                <th className="px-5 py-3">Usuário</th>
                <th className="px-4 py-3">Cargo / Setor</th>
                <th className="px-4 py-3">Nível</th>
                <th className="px-4 py-3">Módulos</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Último acesso</th>
                <th className="px-5 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {carregando && usuarios.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-stone-400">
                    <Loader2 size={18} className="mx-auto mb-2 animate-spin" /> Carregando usuários...
                  </td>
                </tr>
              ) : filtrados.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-stone-500">
                    {temFiltro ? "Nenhum usuário com esses filtros." : "Nenhum usuário cadastrado ainda."}
                  </td>
                </tr>
              ) : (
                filtrados.map((u) => (
                  <LinhaUsuario
                    key={u.id}
                    u={u}
                    voce={u.id === meuId}
                    ocupado={ocupado === u.id}
                    onEditar={() => setModal({ usuario: u })}
                    onLiberar={() => setModal({ usuario: u, liberarAoSalvar: true })}
                    onAcao={(tipo) => {
                      if (tipo === "bloquear" || tipo === "desbloquear" || tipo === "gerar_link") setConfirmacao({ tipo, usuario: u });
                      else void acao(u, tipo);
                    }}
                    onCancelar={() => setConfirmacao({ tipo: "cancelar", usuario: u })}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Como funciona */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs leading-relaxed text-stone-500">
        <Explicacao icon={KeyRound} titulo="Convite e senha">
          A pessoa recebe um e-mail (ou o link pelo WhatsApp) e cria a própria senha. Ninguém mais conhece a senha dela.
        </Explicacao>
        <Explicacao icon={ShieldCheck} titulo="Proteção em todas as camadas">
          O que não está liberado some do menu e é barrado também pela URL, pelas APIs e pelo banco de dados.
        </Explicacao>
        <Explicacao icon={Ban} titulo="Bloquear em vez de apagar">
          Bloquear desconecta na hora e impede novos logins, mas preserva o histórico de quem lançou o quê.
        </Explicacao>
      </div>

      {modal && (
        <AcessoFormModal
          usuario={modal.usuario}
          ehVoceMesmo={!!modal.usuario && modal.usuario.id === meuId}
          setoresExistentes={setores}
          salvando={salvando}
          onClose={() => setModal(null)}
          onSalvar={(p) => void salvar(p)}
        />
      )}

      {convite && <ConviteLinkModal resultado={convite} onClose={() => setConvite(null)} />}

      <ConfirmDialog
        open={!!confirmacao}
        busy={!!confirmacao && ocupado === confirmacao.usuario.id}
        tone={confirmacao?.tipo === "desbloquear" ? "info" : confirmacao?.tipo === "gerar_link" ? "warning" : "danger"}
        title={
          !confirmacao ? "" :
          confirmacao.tipo === "bloquear" ? `Bloquear o acesso de ${confirmacao.usuario.nome}?` :
          confirmacao.tipo === "desbloquear" ? `${confirmacao.usuario.status === "sem_liberacao" ? "Liberar" : "Desbloquear"} o acesso de ${confirmacao.usuario.nome}?` :
          confirmacao.tipo === "cancelar" ? `Cancelar o convite de ${confirmacao.usuario.nome}?` :
          `Gerar um novo link para ${confirmacao.usuario.nome}?`
        }
        description={
          !confirmacao ? undefined :
          confirmacao.tipo === "bloquear"
            ? "A pessoa é desconectada na hora e não consegue mais entrar. Tudo o que ela lançou continua no sistema. Dá para desbloquear quando quiser."
            : confirmacao.tipo === "desbloquear"
              ? "A pessoa volta a entrar com a mesma senha e os mesmos módulos."
              : confirmacao.tipo === "cancelar"
                ? "O convite deixa de valer e o cadastro é removido. Para convidar de novo, crie um novo acesso."
                : "O link anterior — inclusive o que foi por e-mail — deixa de funcionar. Envie o novo link para a pessoa."
        }
        confirmText={
          !confirmacao ? "Confirmar" :
          confirmacao.tipo === "bloquear" ? "Bloquear" :
          confirmacao.tipo === "desbloquear" ? (confirmacao.usuario.status === "sem_liberacao" ? "Liberar" : "Desbloquear") :
          confirmacao.tipo === "cancelar" ? "Cancelar convite" : "Gerar link"
        }
        cancelText="Voltar"
        onConfirm={confirmar}
        onCancel={() => setConfirmacao(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Linha da tabela
// ---------------------------------------------------------------------------

function LinhaUsuario({ u, voce, ocupado, onEditar, onLiberar, onAcao, onCancelar }: {
  u: UsuarioAcesso;
  voce: boolean;
  ocupado: boolean;
  onEditar: () => void;
  onLiberar: () => void;
  onAcao: (tipo: AcaoAcesso) => void;
  onCancelar: () => void;
}) {
  const nivel = NIVEL_PILL[u.nivel];
  const NivelIcon = nivel.icon;
  const status = STATUS_PILL[u.status];
  const modulos = (Object.entries(u.permissoes) as [ModuloConcedivel, "leitura" | "edicao"][])
    .sort(([a], [b]) => MODULOS_CONCEDIVEIS.findIndex((m) => m.key === a) - MODULOS_CONCEDIVEIS.findIndex((m) => m.key === b));
  const listaCompleta = modulos.map(([k, v]) => `${MODULO_POR_KEY[k].label} (${v === "edicao" ? "edição" : "leitura"})`).join("\n");

  return (
    <tr className={cn("transition-colors hover:bg-stone-50/60", u.status === "bloqueado" && "bg-stone-50/40")}>
      <td className="px-5 py-3">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white",
              corAvatar(u.id),
              u.status === "bloqueado" && "grayscale opacity-60",
            )}
          >
            {iniciais(u.nome)}
          </span>
          <div className="min-w-0">
            <p className={cn("flex items-center gap-1.5 font-medium text-stone-800", u.status === "bloqueado" && "text-stone-500")}>
              <span className="truncate">{u.nome}</span>
              {voce && <span className="rounded-full bg-stone-800 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-white">Você</span>}
            </p>
            <p className="truncate text-xs text-stone-400">{u.email}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        {u.cargo || u.setor ? (
          <>
            <p className="text-stone-700">{u.cargo ?? "—"}</p>
            {u.setor && <p className="text-xs text-stone-400">{u.setor}</p>}
          </>
        ) : (
          <span className="text-stone-300">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", nivel.cls)}>
          <NivelIcon size={11} /> {NIVEL_GERAL_LABEL[u.nivel]}
        </span>
      </td>
      <td className="px-4 py-3">
        {u.superAdmin ? (
          <span className="text-xs text-stone-500">Todos os módulos</span>
        ) : modulos.length === 0 ? (
          <span className="text-xs text-stone-400">Nenhum</span>
        ) : (
          <div className="flex max-w-xs flex-wrap gap-1" title={listaCompleta}>
            {modulos.slice(0, 3).map(([k, v]) => (
              <span
                key={k}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]",
                  v === "edicao" ? "bg-emerald-50 text-emerald-800" : "bg-sky-50 text-sky-800",
                )}
              >
                {v === "edicao" ? <PencilLine size={10} /> : <Eye size={10} />}
                {MODULO_POR_KEY[k].label}
              </span>
            ))}
            {modulos.length > 3 && (
              <span className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[11px] font-medium text-stone-600">
                +{modulos.length - 3}
              </span>
            )}
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", status.cls)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
          {STATUS_ACESSO_LABEL[u.status]}
        </span>
        {u.status === "bloqueado" && u.bloqueadoEm && (
          <p className="mt-0.5 text-[10px] text-stone-400" title={formatDateTime(u.bloqueadoEm)}>
            {u.bloqueadoPorNome ? `por ${u.bloqueadoPorNome}` : ""} {tempoRelativo(u.bloqueadoEm)}
          </p>
        )}
        {u.status === "convite_pendente" && u.convidadoEm && (
          <p className="mt-0.5 text-[10px] text-stone-400" title={formatDateTime(u.convidadoEm)}>
            convidado {tempoRelativo(u.convidadoEm)}{u.emailConfirmado ? " · link aberto" : ""}
          </p>
        )}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-xs text-stone-500" title={u.ultimoAcesso ? formatDateTime(u.ultimoAcesso) : undefined}>
        {tempoRelativo(u.ultimoAcesso)}
      </td>
      <td className="px-5 py-3">
        <div className="flex items-center justify-end gap-0.5">
          {ocupado ? (
            <Loader2 size={15} className="mx-2 animate-spin text-stone-400" />
          ) : (
            <>
              {u.status === "sem_liberacao" ? (
                <BotaoAcao titulo="Liberar acesso (escolher módulos)" onClick={onLiberar} className="hover:text-emerald-700 hover:bg-emerald-50">
                  <UserCheck size={15} />
                </BotaoAcao>
              ) : (
                <BotaoAcao titulo="Editar acesso" onClick={onEditar}><Pencil size={14} /></BotaoAcao>
              )}
              {u.status === "convite_pendente" && (
                <>
                  <BotaoAcao titulo="Reenviar convite por e-mail" onClick={() => onAcao("reenviar_convite")}><Mail size={15} /></BotaoAcao>
                  <BotaoAcao titulo="Gerar link de convite (WhatsApp)" onClick={() => onAcao("gerar_link")}><Link2 size={15} /></BotaoAcao>
                </>
              )}
              {u.status === "ativo" && (
                <>
                  <BotaoAcao titulo="Enviar redefinição de senha por e-mail" onClick={() => onAcao("redefinir_senha")}><KeyRound size={14} /></BotaoAcao>
                  <BotaoAcao titulo="Gerar link de nova senha (WhatsApp)" onClick={() => onAcao("gerar_link")}><Link2 size={15} /></BotaoAcao>
                </>
              )}
              {!voce && (u.status === "ativo" || u.status === "convite_pendente") && (
                <BotaoAcao titulo="Bloquear acesso" onClick={() => onAcao("bloquear")} className="hover:text-red-600 hover:bg-red-50">
                  <Ban size={15} />
                </BotaoAcao>
              )}
              {u.status === "bloqueado" && (
                <BotaoAcao titulo="Desbloquear acesso" onClick={() => onAcao("desbloquear")} className="hover:text-emerald-700 hover:bg-emerald-50">
                  <Unlock size={15} />
                </BotaoAcao>
              )}
              {!voce && u.status === "convite_pendente" && (
                <BotaoAcao titulo="Cancelar convite" onClick={onCancelar} className="hover:text-red-600 hover:bg-red-50">
                  <X size={15} />
                </BotaoAcao>
              )}
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function BotaoAcao({ titulo, onClick, className, children }: {
  titulo: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      onClick={onClick}
      className={cn("rounded-md p-1.5 text-stone-500 transition hover:bg-stone-100 hover:text-stone-800", className)}
    >
      {children}
    </button>
  );
}

function Explicacao({ icon: Icon, titulo, children }: { icon: typeof Users; titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-stone-200 bg-white/70 p-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#e8f0ee] text-[#1a4d40]">
        <Icon size={15} />
      </span>
      <div>
        <p className="mb-0.5 text-sm font-semibold text-stone-700">{titulo}</p>
        <p>{children}</p>
      </div>
    </div>
  );
}
