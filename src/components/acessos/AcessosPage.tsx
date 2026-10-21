"use client";
// Tela Acessos (só Super Admin): quem entra no sistema, o que vê e o que altera.
// Sem e-mail (0059): o acesso nasce com senha provisória (mandada por WhatsApp),
// a pessoa cria a própria no 1º acesso e "esqueci a senha" vira pedido aprovado aqui.
// Toda escrita passa pelas rotas /api/acessos (service role + auditoria em Logs).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  UserPlus, Search, Pencil, Ban, Unlock, Crown, PencilLine, Eye, Trash2, Check, X,
  Users, Clock, ShieldCheck, ShieldAlert, KeyRound, RefreshCw, UserCheck, Loader2, Lock, Database, Smartphone,
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
  STATUS_ACESSO_LABEL, type AcaoAcesso, type AcessoPayload, type ListaAcessos, type PedidoSenha,
  type StatusAcesso, type UsuarioAcesso,
} from "@/lib/acessos/tipos";
import {
  atualizarAcesso, criarAcesso, decidirPedido, excluirAcesso, executarAcao, listarAcessos, ErroAcessos,
} from "@/lib/queries/acessos";
import { AcessoFormModal } from "./AcessoFormModal";
import { CredenciaisModal, type CredenciaisExibidas } from "./CredenciaisModal";

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
  primeiro_acesso:  { dot: "bg-amber-500",   cls: "text-amber-800 bg-amber-50" },
  senha_provisoria: { dot: "bg-violet-500",  cls: "text-violet-800 bg-violet-50" },
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

type Confirmacao =
  | { tipo: "bloquear" | "desbloquear" | "excluir" | "senha_provisoria"; usuario: UsuarioAcesso }
  | { tipo: "aprovar"; pedido: PedidoSenha }
  | { tipo: "recusar"; pedido: PedidoSenha };
type ModalForm = { usuario: UsuarioAcesso | null; liberarAoSalvar?: boolean };

export function AcessosPage() {
  const toast = useToast();
  const router = useRouter();
  const [usuarios, setUsuarios] = useState<UsuarioAcesso[]>([]);
  const [pedidos, setPedidos] = useState<PedidoSenha[]>([]);
  const [meuId, setMeuId] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState<{ msg: string; migration: boolean } | null>(null);

  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<StatusAcesso | "todos">("todos");
  const [filtroNivel, setFiltroNivel] = useState<NivelGeral | "todos">("todos");
  const [filtroSetor, setFiltroSetor] = useState("todos");

  const [modal, setModal] = useState<ModalForm | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [credenciais, setCredenciais] = useState<CredenciaisExibidas | null>(null);
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const aplicarLista = useCallback((r: ListaAcessos) => {
    setUsuarios(r.usuarios);
    setPedidos(r.pedidos);
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
    aguardando: usuarios.filter((u) => u.status === "primeiro_acesso" || u.status === "senha_provisoria").length,
    bloqueados: usuarios.filter((u) => u.status === "bloqueado").length,
    semLiberacao: usuarios.filter((u) => u.status === "sem_liberacao").length,
  }), [usuarios]);

  const comPedido = useMemo(() => new Set(pedidos.map((p) => p.usuarioId)), [pedidos]);

  const setores = useMemo(
    () => Array.from(new Set(usuarios.map((u) => u.setor).filter((s): s is string => !!s))).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [usuarios],
  );

  const filtrados = useMemo(() => {
    const termo = normalizar(busca.trim());
    const peso: Record<StatusAcesso, number> = { sem_liberacao: 0, primeiro_acesso: 1, senha_provisoria: 2, ativo: 3, bloqueado: 4 };
    return usuarios
      .filter((u) => filtroStatus === "todos" || u.status === filtroStatus)
      .filter((u) => filtroNivel === "todos" || u.nivel === filtroNivel)
      .filter((u) => filtroSetor === "todos" || u.setor === filtroSetor)
      .filter((u) => !termo || normalizar(`${u.nome} ${u.email} ${u.cargo ?? ""} ${u.setor ?? ""}`).includes(termo))
      .sort((a, b) => {
        // Você primeiro; depois quem precisa de atenção; depois nome.
        if (a.id === meuId) return -1;
        if (b.id === meuId) return 1;
        return peso[a.status] - peso[b.status] || a.nome.localeCompare(b.nome, "pt-BR");
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
        if (r.credenciais) setCredenciais({ ...r.credenciais, nome: payload.nome, contexto: "novo" });
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
      substituir(r.usuario);
      if (tipo === "senha_provisoria" && r.credenciais) {
        setCredenciais({ ...r.credenciais, nome: u.nome, contexto: "reset" });
        setPedidos((prev) => prev.filter((p) => p.usuarioId !== u.id));
      } else if (tipo === "bloquear") {
        toast.success(`${u.nome} bloqueado(a)`, "A pessoa foi desconectada e não consegue mais entrar.");
        setPedidos((prev) => prev.filter((p) => p.usuarioId !== u.id));
      } else if (tipo === "desbloquear") {
        toast.success(`${u.nome} desbloqueado(a)`, "O acesso voltou com os mesmos módulos.");
      }
      if (r.aviso) toast.warning("Aviso do Supabase Auth", r.aviso);
    } catch (e) {
      toast.error("Não foi possível concluir", e instanceof Error ? e.message : undefined);
    } finally {
      setOcupado(null);
      setConfirmacao(null);
    }
  }

  async function excluir(u: UsuarioAcesso) {
    setOcupado(u.id);
    try {
      await excluirAcesso(u.id);
      setUsuarios((prev) => prev.filter((p) => p.id !== u.id));
      setPedidos((prev) => prev.filter((p) => p.usuarioId !== u.id));
      toast.success("Acesso excluído", `${u.email} foi removido.`);
    } catch (e) {
      toast.error("Não foi possível excluir", e instanceof Error ? e.message : undefined);
    } finally {
      setOcupado(null);
      setConfirmacao(null);
    }
  }

  async function decidir(p: PedidoSenha, aprovar: boolean) {
    setOcupado(p.id);
    try {
      const r = await decidirPedido(p.id, aprovar ? "aprovar" : "recusar");
      substituir(r.usuario);
      setPedidos((prev) => prev.filter((x) => x.id !== p.id));
      toast.success(
        aprovar ? "Nova senha aprovada" : "Pedido recusado",
        aprovar ? `${p.nome} já pode entrar com a senha que escolheu.` : `A senha de ${p.nome} continua a mesma.`,
      );
      router.refresh();   // contador do menu
    } catch (e) {
      toast.error("Não foi possível concluir", e instanceof Error ? e.message : undefined);
      void carregar();
    } finally {
      setOcupado(null);
      setConfirmacao(null);
    }
  }

  async function confirmar() {
    if (!confirmacao) return;
    if (confirmacao.tipo === "aprovar" || confirmacao.tipo === "recusar") {
      await decidir(confirmacao.pedido, confirmacao.tipo === "aprovar");
    } else if (confirmacao.tipo === "excluir") {
      await excluir(confirmacao.usuario);
    } else {
      await acao(confirmacao.usuario, confirmacao.tipo);
    }
  }

  const textoConfirmacao = (() => {
    if (!confirmacao) return { titulo: "", descricao: undefined, botao: "Confirmar", tom: "warning" as const, ocupadoId: null };
    if (confirmacao.tipo === "aprovar") {
      const n = confirmacao.pedido.nome;
      return {
        titulo: `Aprovar a nova senha de ${n}?`,
        descricao: `Antes de aprovar, confirme com ${n.split(" ")[0]} (WhatsApp ou ligação) que foi ela mesma quem pediu — quem souber o e-mail de alguém consegue fazer um pedido.\n\nAo aprovar, a senha escolhida no pedido passa a valer na hora.`,
        botao: "Aprovar", tom: "warning" as const, ocupadoId: confirmacao.pedido.id,
      };
    }
    if (confirmacao.tipo === "recusar") {
      return {
        titulo: `Recusar o pedido de ${confirmacao.pedido.nome}?`,
        descricao: "A senha atual continua valendo. Se a pessoa precisar, ela pode pedir de novo.",
        botao: "Recusar pedido", tom: "danger" as const, ocupadoId: confirmacao.pedido.id,
      };
    }
    const u = confirmacao.usuario;
    switch (confirmacao.tipo) {
      case "bloquear":
        return {
          titulo: `Bloquear o acesso de ${u.nome}?`,
          descricao: "A pessoa é desconectada na hora e não consegue mais entrar. Tudo o que ela lançou continua no sistema. Dá para desbloquear quando quiser.",
          botao: "Bloquear", tom: "danger" as const, ocupadoId: u.id,
        };
      case "desbloquear":
        return {
          titulo: `${u.status === "sem_liberacao" ? "Liberar" : "Desbloquear"} o acesso de ${u.nome}?`,
          descricao: "A pessoa volta a entrar com a mesma senha e os mesmos módulos.",
          botao: u.status === "sem_liberacao" ? "Liberar" : "Desbloquear", tom: "info" as const, ocupadoId: u.id,
        };
      case "excluir":
        return {
          titulo: `Excluir o acesso de ${u.nome}?`,
          descricao: "Este acesso nunca foi usado (a pessoa não chegou a criar a própria senha), então nada se perde. Para dar acesso de novo, crie um novo acesso.",
          botao: "Excluir acesso", tom: "danger" as const, ocupadoId: u.id,
        };
      default:
        return {
          titulo: `Gerar nova senha provisória para ${u.nome}?`,
          descricao: "A senha atual deixa de funcionar na hora. Você recebe a provisória para mandar à pessoa, e no próximo acesso ela cria a própria.",
          botao: "Gerar senha", tom: "warning" as const, ocupadoId: u.id,
        };
    }
  })();

  // ---- Render ---------------------------------------------------------------
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#0f1f1c]">Acessos</h1>
          <p className="text-sm text-stone-500 max-w-2xl">
            Cadastre quem entra no AramBI, escolha os módulos de cada pessoa e se ela pode alterar dados ou só consultar.
            O acesso nasce com uma senha provisória, que a pessoa troca no primeiro acesso.
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
            <p className="font-semibold">Falta aplicar uma migration de Acessos no banco</p>
            <p className="mt-0.5 text-amber-800/90">{erroCarga.msg} Depois atualize esta página.</p>
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
          helpText="Pessoas que já criaram a própria senha." />
        <KpiCard label="Com senha provisória" value={String(kpis.aguardando)} icon={<Clock size={16} />}
          helpText="Receberam uma senha provisória e ainda não entraram para criar a própria." />
        <KpiCard label="Pedidos de nova senha" value={String(pedidos.length)} icon={<KeyRound size={16} />}
          helpText="Pedidos feitos em 'Esqueceu sua senha?' esperando a sua aprovação." />
        <KpiCard label="Bloqueados" value={String(kpis.bloqueados)} icon={<Ban size={16} />}
          helpText="Não conseguem entrar. O histórico do que fizeram continua no sistema." />
      </div>

      {/* Pedidos de nova senha */}
      {pedidos.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50/60 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200/70 px-5 py-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
              <KeyRound size={16} /> Pedidos de nova senha ({pedidos.length})
            </p>
            <p className="text-xs text-amber-800/80">Confirme com a pessoa que foi ela quem pediu antes de aprovar.</p>
          </div>
          <ul className="divide-y divide-amber-200/60">
            {pedidos.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
                <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white", corAvatar(p.usuarioId))}>
                  {iniciais(p.nome)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-stone-800">{p.nome}</p>
                  <p className="text-xs text-stone-500">
                    {p.email} · pediu {tempoRelativo(p.criadoEm)}
                    <span className="text-stone-400" title={formatDateTime(p.criadoEm)}> ({formatDateTime(p.criadoEm)})</span>
                  </p>
                  {(p.dispositivo || p.ip) && (
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-stone-400">
                      <Smartphone size={11} /> {[p.dispositivo, p.ip ? `IP ${p.ip}` : null].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                {ocupado === p.id ? (
                  <Loader2 size={16} className="animate-spin text-stone-400" />
                ) : (
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setConfirmacao({ tipo: "recusar", pedido: p })}>
                      <X size={14} /> Recusar
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setConfirmacao({ tipo: "aprovar", pedido: p })}>
                      <Check size={14} /> Aprovar
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

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
        <div className="w-48">
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
                    pediuSenha={comPedido.has(u.id)}
                    ocupado={ocupado === u.id}
                    onEditar={() => setModal({ usuario: u })}
                    onLiberar={() => setModal({ usuario: u, liberarAoSalvar: true })}
                    onConfirmar={(tipo) => setConfirmacao({ tipo, usuario: u })}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Como funciona */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs leading-relaxed text-stone-500">
        <Explicacao icon={KeyRound} titulo="Senha provisória e 1º acesso">
          O acesso nasce com uma senha provisória que você manda à pessoa. Ao entrar, ela é obrigada a criar a própria —
          ninguém mais fica sabendo dela.
        </Explicacao>
        <Explicacao icon={ShieldCheck} titulo="Proteção em todas as camadas">
          O que não está liberado some do menu e é barrado também pela URL, pelas APIs e pelo banco de dados.
        </Explicacao>
        <Explicacao icon={Ban} titulo="Esqueceu a senha? Bloquear?">
          O pedido de nova senha chega aqui para você aprovar. Bloquear desconecta na hora e preserva o histórico de quem
          lançou o quê.
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

      {credenciais && <CredenciaisModal dados={credenciais} onClose={() => setCredenciais(null)} />}

      <ConfirmDialog
        open={!!confirmacao}
        busy={!!confirmacao && ocupado === textoConfirmacao.ocupadoId}
        tone={textoConfirmacao.tom}
        title={textoConfirmacao.titulo}
        description={textoConfirmacao.descricao}
        confirmText={textoConfirmacao.botao}
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

function LinhaUsuario({ u, voce, pediuSenha, ocupado, onEditar, onLiberar, onConfirmar }: {
  u: UsuarioAcesso;
  voce: boolean;
  pediuSenha: boolean;
  ocupado: boolean;
  onEditar: () => void;
  onLiberar: () => void;
  onConfirmar: (tipo: "bloquear" | "desbloquear" | "excluir" | "senha_provisoria") => void;
}) {
  const nivel = NIVEL_PILL[u.nivel];
  const NivelIcon = nivel.icon;
  const status = STATUS_PILL[u.status];
  const modulos = (Object.entries(u.permissoes) as [ModuloConcedivel, "leitura" | "edicao"][])
    .sort(([a], [b]) => MODULOS_CONCEDIVEIS.findIndex((m) => m.key === a) - MODULOS_CONCEDIVEIS.findIndex((m) => m.key === b));
  const listaCompleta = modulos.map(([k, v]) => `${MODULO_POR_KEY[k].label} (${v === "edicao" ? "edição" : "leitura"})`).join("\n");
  const podeGerarSenha = !voce && (u.status === "ativo" || u.status === "primeiro_acesso" || u.status === "senha_provisoria");

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
        {pediuSenha && (
          <p className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-amber-700">
            <KeyRound size={10} /> pediu nova senha
          </p>
        )}
        {u.status === "bloqueado" && u.bloqueadoEm && (
          <p className="mt-0.5 text-[10px] text-stone-400" title={formatDateTime(u.bloqueadoEm)}>
            {u.bloqueadoPorNome ? `por ${u.bloqueadoPorNome}` : ""} {tempoRelativo(u.bloqueadoEm)}
          </p>
        )}
        {u.status === "primeiro_acesso" && u.convidadoEm && (
          <p className="mt-0.5 text-[10px] text-stone-400" title={formatDateTime(u.convidadoEm)}>
            criado {tempoRelativo(u.convidadoEm)}
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
              {podeGerarSenha && (
                <BotaoAcao titulo="Gerar nova senha provisória" onClick={() => onConfirmar("senha_provisoria")}>
                  <KeyRound size={14} />
                </BotaoAcao>
              )}
              {!voce && u.status !== "bloqueado" && u.status !== "sem_liberacao" && (
                <BotaoAcao titulo="Bloquear acesso" onClick={() => onConfirmar("bloquear")} className="hover:text-red-600 hover:bg-red-50">
                  <Ban size={15} />
                </BotaoAcao>
              )}
              {u.status === "bloqueado" && (
                <BotaoAcao titulo="Desbloquear acesso" onClick={() => onConfirmar("desbloquear")} className="hover:text-emerald-700 hover:bg-emerald-50">
                  <Unlock size={15} />
                </BotaoAcao>
              )}
              {!voce && !u.senhaDefinidaEm && (
                <BotaoAcao titulo="Excluir acesso (nunca usado)" onClick={() => onConfirmar("excluir")} className="hover:text-red-600 hover:bg-red-50">
                  <Trash2 size={14} />
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
