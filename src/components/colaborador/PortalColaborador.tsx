"use client";
// Portal do Colaborador — substitui as fichas de papel (call de 14/jul/2026).
// Mobile-first, identificação por CPF sem senha (fica salvo no aparelho),
// botões grandes para uso no campo.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Leaf, LogOut, ClipboardList, Fuel, ChevronLeft, CheckCircle2,
  AlertTriangle, Loader2, Tractor, Truck, Wrench, Share, PlusSquare,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/utils/format";
import type { TalaoUsoRow, CombustivelFonte, EquipamentoTipo, MedidorTipo } from "@/types";
import { COMBUSTIVEL_FONTE_LABEL } from "@/types";

// ----------------------------------------------------------------------------
// Tipos do contexto (retorno de /api/colaborador/contexto)
// ----------------------------------------------------------------------------
interface EquipamentoPortal {
  id: string;
  codigo: string;
  nome: string;
  tipo: EquipamentoTipo;
  medidor_tipo: MedidorTipo;
  medidor_atual: number | null;
  combustivel: string;
  status: string;
}

interface Contexto {
  colaborador: { id: string; nome: string };
  equipamentos: EquipamentoPortal[];
  taloesAbertos: TalaoUsoRow[];
  emUsoPor: Record<string, string>;
}

type Tela =
  | { t: "identificacao" }
  | { t: "solicitar" }
  | { t: "home" }
  | { t: "abrir"; equipamento?: EquipamentoPortal }
  | { t: "fechar"; talao: TalaoUsoRow }
  | { t: "abastecer" };

const CPF_KEY = "arambi_colaborador_cpf";

function maskCpf(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
}

function unidade(m: MedidorTipo): string {
  return m === "km" ? "km" : "h";
}

async function api<T>(path: string, method: "POST" | "PATCH", body: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? "Erro de comunicação.");
  return json as T;
}

// ----------------------------------------------------------------------------
// Componente principal
// ----------------------------------------------------------------------------
export function PortalColaborador() {
  const toast = useToast();
  const [tela, setTela] = useState<Tela>({ t: "identificacao" });
  const [cpf, setCpf] = useState("");
  const [ctx, setCtx] = useState<Contexto | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [busy, setBusy] = useState(false);

  const cpfLimpo = useMemo(() => cpf.replace(/\D/g, ""), [cpf]);

  const carregarContexto = useCallback(async (cpfDigitos: string): Promise<boolean> => {
    try {
      const data = await api<Contexto>("/api/colaborador/contexto", "POST", { cpf: cpfDigitos });
      setCtx(data);
      setTela({ t: "home" });
      return true;
    } catch (e) {
      toast.error("Não foi possível entrar", e instanceof Error ? e.message : undefined);
      return false;
    }
  }, [toast]);

  // Auto-login com CPF salvo no aparelho
  useEffect(() => {
    const salvo = typeof window !== "undefined" ? localStorage.getItem(CPF_KEY) : null;
    if (salvo && salvo.length === 11) {
      setCpf(maskCpf(salvo));
      carregarContexto(salvo).finally(() => setCarregando(false));
    } else {
      setCarregando(false);
    }
  }, [carregarContexto]);

  async function entrar() {
    if (cpfLimpo.length !== 11) { toast.warning("Digite o CPF completo."); return; }
    setBusy(true);
    const ok = await carregarContexto(cpfLimpo);
    if (ok) localStorage.setItem(CPF_KEY, cpfLimpo);
    setBusy(false);
  }

  function sair() {
    localStorage.removeItem(CPF_KEY);
    setCtx(null);
    setCpf("");
    setTela({ t: "identificacao" });
  }

  async function recarregar() {
    if (cpfLimpo.length === 11) await carregarContexto(cpfLimpo);
  }

  // --------------------------------------------------------------------------
  if (carregando) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 size={28} className="animate-spin text-[#3a6230]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col max-w-md mx-auto px-4 pb-8">
      {/* Topo */}
      <header className="flex items-center justify-between py-5">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-accent-500 flex items-center justify-center shadow-md">
            <Leaf size={18} className="text-white" />
          </div>
          <div>
            <p className="font-bold text-[15px] text-[#0f1f1c] leading-tight">AramBI</p>
            <p className="text-[10px] text-stone-500">Portal do Colaborador</p>
          </div>
        </div>
        {ctx && (
          <button onClick={sair} className="flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-700 px-2 py-1.5 rounded-lg hover:bg-stone-200/60 transition">
            <LogOut size={13} /> Trocar
          </button>
        )}
      </header>

      {/* Telas */}
      {tela.t === "identificacao" && (
        <TelaIdentificacao
          cpf={cpf}
          onCpf={(v) => setCpf(maskCpf(v))}
          onEntrar={entrar}
          busy={busy}
          onSolicitar={() => setTela({ t: "solicitar" })}
        />
      )}

      {tela.t === "solicitar" && (
        <TelaSolicitar
          cpfInicial={cpf}
          onVoltar={() => setTela({ t: "identificacao" })}
        />
      )}

      {tela.t === "home" && ctx && (
        <TelaHome
          ctx={ctx}
          onAbrir={() => setTela({ t: "abrir" })}
          onFechar={(talao) => setTela({ t: "fechar", talao })}
          onAbastecer={() => setTela({ t: "abastecer" })}
        />
      )}

      {tela.t === "abrir" && ctx && (
        <TelaAbrirTalao
          ctx={ctx}
          cpf={cpfLimpo}
          onVoltar={() => setTela({ t: "home" })}
          onDone={async () => { await recarregar(); }}
        />
      )}

      {tela.t === "fechar" && ctx && (
        <TelaFecharTalao
          ctx={ctx}
          talao={tela.talao}
          cpf={cpfLimpo}
          onVoltar={() => setTela({ t: "home" })}
          onDone={async () => { await recarregar(); }}
        />
      )}

      {tela.t === "abastecer" && ctx && (
        <TelaAbastecer
          ctx={ctx}
          cpf={cpfLimpo}
          onVoltar={() => setTela({ t: "home" })}
          onDone={async () => { await recarregar(); }}
        />
      )}

      {tela.t === "identificacao" && <BannerInstalarApp />}
    </div>
  );
}

// ----------------------------------------------------------------------------
// UI base do portal (botões grandes, campo grande)
// ----------------------------------------------------------------------------
function BotaoGrande({ onClick, disabled, children, tone = "primary" }: {
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  tone?: "primary" | "secondary" | "ghost" | "danger";
}) {
  const tones = {
    primary: "bg-[#3a6230] hover:bg-[#2c4a24] text-white shadow-md",
    secondary: "bg-[#a67c20] hover:bg-[#836016] text-white shadow-md",
    ghost: "bg-white border border-stone-300 text-stone-700 hover:bg-stone-50",
    danger: "bg-red-600 hover:bg-red-700 text-white shadow-md",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-2xl px-5 py-4 text-base font-semibold flex items-center justify-center gap-3 transition active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

function CampoGrande({ label, hint, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-stone-700 mb-1.5">{label}</span>
      <input
        {...props}
        className="w-full h-14 rounded-2xl border border-stone-300 bg-white px-4 text-lg text-stone-900 placeholder:text-stone-300 focus:outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent transition"
      />
      {hint && <span className="block text-[11px] text-stone-400 mt-1">{hint}</span>}
    </label>
  );
}

function Voltar({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 text-sm text-stone-500 hover:text-stone-700 mb-4 -ml-1 px-1 py-1">
      <ChevronLeft size={16} /> Voltar
    </button>
  );
}

function IconeEquipamento({ tipo, size = 20 }: { tipo: EquipamentoTipo; size?: number }) {
  if (tipo === "veiculo") return <Truck size={size} />;
  if (tipo === "implemento") return <Wrench size={size} />;
  return <Tractor size={size} />;
}

// ----------------------------------------------------------------------------
// Tela: identificação (CPF)
// ----------------------------------------------------------------------------
function TelaIdentificacao({ cpf, onCpf, onEntrar, busy, onSolicitar }: {
  cpf: string;
  onCpf: (v: string) => void;
  onEntrar: () => void;
  busy: boolean;
  onSolicitar: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col justify-center gap-6 py-8">
      <div className="text-center space-y-1.5">
        <h1 className="text-2xl font-bold text-[#0f1f1c]">Bem-vindo! 👋</h1>
        <p className="text-sm text-stone-500 leading-relaxed">
          Digite seu CPF para registrar o uso de máquinas,<br />veículos e abastecimentos.
        </p>
      </div>

      <CampoGrande
        label="Seu CPF"
        placeholder="000.000.000-00"
        inputMode="numeric"
        autoComplete="off"
        value={cpf}
        onChange={(e) => onCpf(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onEntrar(); }}
        hint="Fica salvo neste aparelho — você só digita uma vez."
      />

      <BotaoGrande onClick={onEntrar} disabled={busy}>
        {busy ? <Loader2 size={20} className="animate-spin" /> : "Entrar"}
      </BotaoGrande>

      <button onClick={onSolicitar} className="text-sm text-accent-700 hover:underline text-center">
        Não tenho cadastro — solicitar acesso
      </button>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Tela: solicitar acesso (plano B — admin aprova em Configurações)
// ----------------------------------------------------------------------------
function TelaSolicitar({ cpfInicial, onVoltar }: { cpfInicial: string; onVoltar: () => void }) {
  const toast = useToast();
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState(cpfInicial);
  const [busy, setBusy] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function enviar() {
    const digitos = cpf.replace(/\D/g, "");
    if (nome.trim().length < 3) { toast.warning("Informe seu nome completo."); return; }
    if (digitos.length !== 11) { toast.warning("Digite o CPF completo."); return; }
    setBusy(true);
    try {
      await api("/api/colaborador/solicitar-acesso", "POST", { nome: nome.trim(), cpf: digitos });
      setEnviado(true);
    } catch (e) {
      toast.error("Não foi possível enviar", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  if (enviado) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center py-8">
        <CheckCircle2 size={48} className="text-emerald-500" />
        <h2 className="text-xl font-bold text-[#0f1f1c]">Solicitação enviada!</h2>
        <p className="text-sm text-stone-500 leading-relaxed max-w-xs">
          A administração vai aprovar seu acesso. Depois é só voltar aqui e digitar seu CPF.
        </p>
        <BotaoGrande onClick={onVoltar} tone="ghost">Voltar</BotaoGrande>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col gap-5 py-4">
      <Voltar onClick={onVoltar} />
      <div>
        <h2 className="text-xl font-bold text-[#0f1f1c]">Solicitar acesso</h2>
        <p className="text-sm text-stone-500 mt-1">A administração aprova e você já pode usar.</p>
      </div>
      <CampoGrande label="Nome completo" placeholder="João da Silva" value={nome} onChange={(e) => setNome(e.target.value)} />
      <CampoGrande
        label="CPF"
        placeholder="000.000.000-00"
        inputMode="numeric"
        value={cpf}
        onChange={(e) => setCpf(maskCpf(e.target.value))}
      />
      <BotaoGrande onClick={enviar} disabled={busy}>
        {busy ? <Loader2 size={20} className="animate-spin" /> : "Enviar solicitação"}
      </BotaoGrande>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Tela: home do colaborador
// ----------------------------------------------------------------------------
function TelaHome({ ctx, onAbrir, onFechar, onAbastecer }: {
  ctx: Contexto;
  onAbrir: () => void;
  onFechar: (talao: TalaoUsoRow) => void;
  onAbastecer: () => void;
}) {
  const eqById = useMemo(() => new Map(ctx.equipamentos.map((e) => [e.id, e])), [ctx.equipamentos]);
  const primeiroNome = ctx.colaborador.nome.split(" ")[0];

  return (
    <div className="flex-1 flex flex-col gap-4 py-2">
      <div className="mb-1">
        <h1 className="text-2xl font-bold text-[#0f1f1c]">Olá, {primeiroNome}!</h1>
        <p className="text-sm text-stone-500">O que você vai fazer?</p>
      </div>

      {/* Talões abertos — finalizar */}
      {ctx.taloesAbertos.map((talao) => {
        const eq = eqById.get(talao.equipamento_id);
        return (
          <button
            key={talao.id}
            onClick={() => onFechar(talao)}
            className="w-full rounded-2xl border-2 border-amber-300 bg-amber-50 px-5 py-4 text-left flex items-center gap-4 active:scale-[0.99] transition"
          >
            <span className="w-11 h-11 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
              <IconeEquipamento tipo={eq?.tipo ?? "trator"} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-bold text-amber-900">
                Em uso: {eq ? `${eq.codigo} — ${eq.nome}` : "equipamento"}
              </span>
              <span className="block text-xs text-amber-700">
                Desde {formatDateTime(talao.inicio_em)} · toque para FINALIZAR
              </span>
            </span>
            <CheckCircle2 size={22} className="text-amber-600 shrink-0" />
          </button>
        );
      })}

      <BotaoGrande onClick={onAbrir}>
        <ClipboardList size={22} /> Abrir Talão de Uso
      </BotaoGrande>

      <BotaoGrande onClick={onAbastecer} tone="secondary">
        <Fuel size={22} /> Registrar Abastecimento
      </BotaoGrande>

      <p className="text-[11px] text-stone-400 text-center leading-relaxed mt-2">
        Abra o talão ao PEGAR o equipamento e finalize ao DEVOLVER.<br />
        Qualquer defeito, anote na finalização.
      </p>

      <BannerInstalarApp />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Tela: abrir talão
// ----------------------------------------------------------------------------
function TelaAbrirTalao({ ctx, cpf, onVoltar, onDone }: {
  ctx: Contexto;
  cpf: string;
  onVoltar: () => void;
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const [eq, setEq] = useState<EquipamentoPortal | null>(null);
  const [medidor, setMedidor] = useState<string>("");
  const [corrigindo, setCorrigindo] = useState(false);
  const [busy, setBusy] = useState(false);

  const sugerido = eq?.medidor_atual != null ? Number(eq.medidor_atual) : null;
  const valorAtual = medidor === "" ? null : Number(String(medidor).replace(",", "."));
  const discrepancia = sugerido != null && valorAtual != null ? Number((valorAtual - sugerido).toFixed(1)) : 0;

  function selecionar(e: EquipamentoPortal) {
    setEq(e);
    setMedidor(e.medidor_atual != null ? String(e.medidor_atual) : "");
    setCorrigindo(e.medidor_atual == null); // sem histórico → digita direto
  }

  async function confirmar() {
    if (!eq) return;
    if (eq.medidor_tipo !== "nenhum" && (valorAtual == null || !Number.isFinite(valorAtual))) {
      toast.warning(`Informe o ${eq.medidor_tipo === "km" ? "KM" : "horímetro"} atual.`);
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ discrepancia: number }>("/api/colaborador/talao", "POST", {
        cpf,
        equipamento_id: eq.id,
        medidor_inicial: valorAtual ?? 0,
      });
      if (r.discrepancia !== 0) {
        toast.warning("Talão aberto com diferença registrada", "A administração vai verificar a diferença de medidor.");
      } else {
        toast.success("Talão aberto!", "Finalize quando devolver o equipamento.");
      }
      await onDone();
    } catch (e) {
      toast.error("Não foi possível abrir", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  // Passo 1 — escolher equipamento
  if (!eq) {
    return (
      <div className="flex-1 flex flex-col gap-3 py-2">
        <Voltar onClick={onVoltar} />
        <h2 className="text-xl font-bold text-[#0f1f1c] mb-1">Qual equipamento?</h2>
        {ctx.equipamentos.length === 0 && (
          <p className="text-sm text-stone-400 text-center py-8">Nenhum equipamento cadastrado ainda.</p>
        )}
        {ctx.equipamentos.map((e) => {
          const emUso = ctx.emUsoPor[e.id];
          return (
            <button
              key={e.id}
              onClick={() => !emUso && selecionar(e)}
              disabled={!!emUso}
              className={`w-full rounded-2xl border px-4 py-3.5 text-left flex items-center gap-3.5 transition active:scale-[0.99] ${
                emUso ? "border-stone-200 bg-stone-100 opacity-60" : "border-stone-200 bg-white hover:border-accent-400 shadow-sm"
              }`}
            >
              <span className="w-10 h-10 rounded-xl bg-[#e8f0ee] text-[#1a4d40] flex items-center justify-center shrink-0">
                <IconeEquipamento tipo={e.tipo} size={18} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-stone-800">{e.codigo} — {e.nome}</span>
                <span className="block text-xs text-stone-400">
                  {emUso
                    ? `Em uso por ${emUso}`
                    : e.medidor_tipo !== "nenhum" && e.medidor_atual != null
                      ? `Último registro: ${Number(e.medidor_atual).toLocaleString("pt-BR")} ${unidade(e.medidor_tipo)}`
                      : " "}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  // Passo 2 — conferir medidor
  return (
    <div className="flex-1 flex flex-col gap-4 py-2">
      <Voltar onClick={() => setEq(null)} />
      <div>
        <h2 className="text-xl font-bold text-[#0f1f1c]">{eq.codigo} — {eq.nome}</h2>
        <p className="text-sm text-stone-500 mt-0.5">Confira o {eq.medidor_tipo === "km" ? "KM" : "horímetro"} antes de começar.</p>
      </div>

      {eq.medidor_tipo !== "nenhum" ? (
        <>
          <div className="rounded-2xl bg-white border border-stone-200 p-5 space-y-3">
            <p className="text-xs text-stone-500 uppercase tracking-wide font-semibold">
              {eq.medidor_tipo === "km" ? "KM no painel" : "Horímetro"}
            </p>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              readOnly={!corrigindo}
              value={medidor}
              onChange={(e) => setMedidor(e.target.value)}
              className={`w-full h-16 rounded-xl border px-4 text-2xl font-bold tabular-nums focus:outline-none transition ${
                corrigindo
                  ? "border-amber-300 bg-amber-50 text-stone-900 focus:ring-2 focus:ring-amber-400"
                  : "border-stone-200 bg-stone-50 text-stone-700"
              }`}
            />
            {sugerido != null && !corrigindo && (
              <button onClick={() => setCorrigindo(true)} className="text-sm text-amber-700 font-medium hover:underline">
                O número no painel está diferente? Toque para corrigir
              </button>
            )}
            {corrigindo && sugerido != null && discrepancia !== 0 && valorAtual != null && (
              <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5">
                <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 leading-relaxed">
                  Diferença de <b>{Math.abs(discrepancia).toLocaleString("pt-BR")} {unidade(eq.medidor_tipo)}</b> em
                  relação ao último registro ({sugerido.toLocaleString("pt-BR")}). Isso ficará anotado para a
                  administração regularizar — pode continuar.
                </p>
              </div>
            )}
          </div>
        </>
      ) : (
        <p className="text-sm text-stone-500 bg-white border border-stone-200 rounded-2xl p-4">
          Este equipamento não tem medidor — é só confirmar para abrir o talão.
        </p>
      )}

      <BotaoGrande onClick={confirmar} disabled={busy}>
        {busy ? <Loader2 size={20} className="animate-spin" /> : "Confirmar e Abrir Talão"}
      </BotaoGrande>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Tela: fechar talão
// ----------------------------------------------------------------------------
function TelaFecharTalao({ ctx, talao, cpf, onVoltar, onDone }: {
  ctx: Contexto;
  talao: TalaoUsoRow;
  cpf: string;
  onVoltar: () => void;
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const eq = ctx.equipamentos.find((e) => e.id === talao.equipamento_id);
  const [medidorFinal, setMedidorFinal] = useState("");
  const [seguranca, setSeguranca] = useState<boolean | null>(null);
  const [observacoes, setObservacoes] = useState("");
  const [defeitos, setDefeitos] = useState("");
  const [busy, setBusy] = useState(false);

  const temMedidor = (eq?.medidor_tipo ?? "horimetro") !== "nenhum";
  const un = unidade(eq?.medidor_tipo ?? "horimetro");
  const valorFinal = medidorFinal === "" ? null : Number(String(medidorFinal).replace(",", "."));
  const rodado = valorFinal != null ? Number((valorFinal - Number(talao.medidor_inicial)).toFixed(1)) : null;

  async function confirmar() {
    if (temMedidor) {
      if (valorFinal == null || !Number.isFinite(valorFinal)) {
        toast.warning(`Informe o ${un === "km" ? "KM" : "horímetro"} final.`);
        return;
      }
      if (valorFinal < Number(talao.medidor_inicial)) {
        toast.warning(`O valor final não pode ser menor que o inicial (${Number(talao.medidor_inicial).toLocaleString("pt-BR")}).`);
        return;
      }
    }
    if (seguranca == null) {
      toast.warning("Informe se usou o equipamento de segurança.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/colaborador/talao", "PATCH", {
        cpf,
        talao_id: talao.id,
        medidor_final: valorFinal ?? Number(talao.medidor_inicial),
        equipamento_seguranca: seguranca,
        observacoes,
        defeitos,
      });
      toast.success("Talão finalizado!", rodado != null ? `${rodado.toLocaleString("pt-BR")} ${un} registrados. Obrigado!` : "Obrigado!");
      await onDone();
    } catch (e) {
      toast.error("Não foi possível finalizar", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col gap-4 py-2">
      <Voltar onClick={onVoltar} />
      <div>
        <h2 className="text-xl font-bold text-[#0f1f1c]">
          Finalizar — {eq ? `${eq.codigo} ${eq.nome}` : "equipamento"}
        </h2>
        <p className="text-sm text-stone-500 mt-0.5">
          Iniciado em {formatDateTime(talao.inicio_em)}
          {temMedidor && ` · ${un === "km" ? "KM" : "horímetro"} inicial: ${Number(talao.medidor_inicial).toLocaleString("pt-BR")}`}
        </p>
      </div>

      {temMedidor && (
        <div className="rounded-2xl bg-white border border-stone-200 p-5 space-y-2">
          <p className="text-xs text-stone-500 uppercase tracking-wide font-semibold">
            {un === "km" ? "KM final no painel" : "Horímetro final"}
          </p>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            placeholder={String(talao.medidor_inicial)}
            value={medidorFinal}
            onChange={(e) => setMedidorFinal(e.target.value)}
            className="w-full h-16 rounded-xl border border-stone-300 px-4 text-2xl font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-accent-400"
          />
          {rodado != null && rodado >= 0 && (
            <p className="text-xs text-stone-500">
              Você rodou/usou <b className="text-stone-700">{rodado.toLocaleString("pt-BR")} {un}</b>.
            </p>
          )}
        </div>
      )}

      <div className="rounded-2xl bg-white border border-stone-200 p-5 space-y-3">
        <p className="text-sm font-medium text-stone-700">Usou equipamento de segurança?</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setSeguranca(true)}
            className={`h-12 rounded-xl text-sm font-semibold border transition ${
              seguranca === true ? "bg-emerald-600 border-emerald-600 text-white" : "bg-white border-stone-300 text-stone-600"
            }`}
          >
            Sim
          </button>
          <button
            onClick={() => setSeguranca(false)}
            className={`h-12 rounded-xl text-sm font-semibold border transition ${
              seguranca === false ? "bg-red-600 border-red-600 text-white" : "bg-white border-stone-300 text-stone-600"
            }`}
          >
            Não
          </button>
        </div>
      </div>

      <label className="block">
        <span className="block text-sm font-medium text-stone-700 mb-1.5">Alguma observação?</span>
        <textarea
          rows={2}
          value={observacoes}
          onChange={(e) => setObservacoes(e.target.value)}
          placeholder="Opcional"
          className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-accent-400 resize-none"
        />
      </label>

      <label className="block">
        <span className="block text-sm font-medium text-stone-700 mb-1.5">
          Algum defeito ou problema? <span className="text-stone-400 font-normal">(protege você — o próximo saberá que já estava assim)</span>
        </span>
        <textarea
          rows={2}
          value={defeitos}
          onChange={(e) => setDefeitos(e.target.value)}
          placeholder="Ex.: pneu murcho, barulho no motor..."
          className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-accent-400 resize-none"
        />
      </label>

      <BotaoGrande onClick={confirmar} disabled={busy}>
        {busy ? <Loader2 size={20} className="animate-spin" /> : "Finalizar Talão"}
      </BotaoGrande>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Tela: registrar abastecimento
// ----------------------------------------------------------------------------
function TelaAbastecer({ ctx, cpf, onVoltar, onDone }: {
  ctx: Contexto;
  cpf: string;
  onVoltar: () => void;
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const [fonte, setFonte] = useState<CombustivelFonte | null>(null);
  const [equipamentoId, setEquipamentoId] = useState<string>("");
  const [medidorInicial, setMedidorInicial] = useState("");
  const [medidorFinal, setMedidorFinal] = useState("");
  const [litros, setLitros] = useState("");
  const [busy, setBusy] = useState(false);

  const litrosNum = litros === "" ? null : Number(String(litros).replace(",", "."));
  // medidor final - inicial preenche litros automaticamente se o operador informar os dois
  const medIni = medidorInicial === "" ? null : Number(String(medidorInicial).replace(",", "."));
  const medFim = medidorFinal === "" ? null : Number(String(medidorFinal).replace(",", "."));

  useEffect(() => {
    if (medIni != null && medFim != null && medFim > medIni) {
      setLitros(String(Number((medFim - medIni).toFixed(1))));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medidorInicial, medidorFinal]);

  async function confirmar() {
    if (!fonte) { toast.warning("Escolha de onde saiu o combustível."); return; }
    if (litrosNum == null || !Number.isFinite(litrosNum) || litrosNum <= 0) {
      toast.warning("Informe a quantidade de litros.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/colaborador/abastecimento", "POST", {
        cpf,
        fonte,
        equipamento_id: equipamentoId || null,
        medidor_inicial: medIni,
        medidor_final: medFim,
        litros: litrosNum,
      });
      toast.success("Abastecimento registrado!", `${litrosNum.toLocaleString("pt-BR")} litros — obrigado!`);
      await onDone();
    } catch (e) {
      toast.error("Não foi possível registrar", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  const FONTES: { id: CombustivelFonte; emoji: string }[] = [
    { id: "tanque_diesel", emoji: "🛢️" },
    { id: "container_gasolina", emoji: "⛽" },
    { id: "posto_externo", emoji: "🏪" },
  ];

  return (
    <div className="flex-1 flex flex-col gap-4 py-2">
      <Voltar onClick={onVoltar} />
      <h2 className="text-xl font-bold text-[#0f1f1c]">Registrar Abastecimento</h2>

      <div>
        <p className="text-sm font-medium text-stone-700 mb-2">De onde saiu o combustível?</p>
        <div className="grid grid-cols-1 gap-2">
          {FONTES.map((f) => (
            <button
              key={f.id}
              onClick={() => setFonte(f.id)}
              className={`rounded-2xl border px-4 py-3.5 flex items-center gap-3 text-left transition active:scale-[0.99] ${
                fonte === f.id ? "border-accent-500 bg-accent-50 ring-2 ring-accent-400/30" : "border-stone-200 bg-white"
              }`}
            >
              <span className="text-2xl">{f.emoji}</span>
              <span className="text-sm font-semibold text-stone-800">{COMBUSTIVEL_FONTE_LABEL[f.id]}</span>
            </button>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="block text-sm font-medium text-stone-700 mb-1.5">Para qual equipamento/veículo?</span>
        <select
          value={equipamentoId}
          onChange={(e) => setEquipamentoId(e.target.value)}
          className="w-full h-14 rounded-2xl border border-stone-300 bg-white px-4 text-base focus:outline-none focus:ring-2 focus:ring-accent-400"
        >
          <option value="">Outro / não listado</option>
          {ctx.equipamentos.map((e) => (
            <option key={e.id} value={e.id}>{e.codigo} — {e.nome}</option>
          ))}
        </select>
      </label>

      {fonte !== "posto_externo" && (
        <div className="grid grid-cols-2 gap-3">
          <CampoGrande
            label="Medidor antes"
            placeholder="0,0"
            inputMode="decimal"
            type="number"
            value={medidorInicial}
            onChange={(e) => setMedidorInicial(e.target.value)}
          />
          <CampoGrande
            label="Medidor depois"
            placeholder="0,0"
            inputMode="decimal"
            type="number"
            value={medidorFinal}
            onChange={(e) => setMedidorFinal(e.target.value)}
          />
        </div>
      )}

      <CampoGrande
        label="Litros *"
        placeholder="0,0"
        inputMode="decimal"
        type="number"
        value={litros}
        onChange={(e) => setLitros(e.target.value)}
        hint={fonte !== "posto_externo" ? "Preenche sozinho se você informar os medidores." : undefined}
      />

      <BotaoGrande onClick={confirmar} disabled={busy} tone="secondary">
        {busy ? <Loader2 size={20} className="animate-spin" /> : "Registrar"}
      </BotaoGrande>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Banner "instalar como app" (PWA) — Android via prompt, iOS via instrução
// ----------------------------------------------------------------------------
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

function BannerInstalarApp() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [ehIos, setEhIos] = useState(false);
  const [instalado, setInstalado] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      (navigator as { standalone?: boolean }).standalone === true;
    setInstalado(!!standalone);
    setEhIos(/iphone|ipad|ipod/i.test(navigator.userAgent));

    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (instalado) return null;

  return (
    <div className="mt-6 rounded-2xl border border-stone-200 bg-white p-4">
      <p className="text-sm font-semibold text-stone-800 flex items-center gap-2">
        <PlusSquare size={16} className="text-accent-600" /> Instale na tela do celular
      </p>
      {installEvent ? (
        <button
          onClick={() => installEvent.prompt()}
          className="mt-2 w-full h-11 rounded-xl bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold transition"
        >
          Instalar aplicativo
        </button>
      ) : ehIos ? (
        <p className="text-xs text-stone-500 mt-1.5 leading-relaxed">
          No Safari: toque em <Share size={12} className="inline -mt-0.5" /> <b>Compartilhar</b> e depois em{" "}
          <b>“Adicionar à Tela de Início”</b>. Vira um app — abre direto, sem digitar nada.
        </p>
      ) : (
        <p className="text-xs text-stone-500 mt-1.5 leading-relaxed">
          No menu do navegador (⋮), toque em <b>“Adicionar à tela inicial”</b>. Vira um app — abre direto, sem digitar nada.
        </p>
      )}
    </div>
  );
}
