"use client";
// Modal de novo acesso / edição: dados da pessoa, nível (Super Admin, Edição,
// Leitura) e módulos liberados. Em "Edição", cada módulo pode ficar só leitura.

import { useMemo, useState } from "react";
import { Crown, PencilLine, Eye, Lock, Mail, Check, Info, KeyRound, RefreshCw } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { UnsavedChangesDialog } from "@/components/ui/UnsavedChangesDialog";
import { useUnsavedGuard } from "@/lib/hooks/useUnsavedGuard";
import { cn } from "@/lib/utils/cn";
import {
  GRUPOS_MODULO, MODULOS_CONCEDIVEIS, MODULOS_EXCLUSIVOS, type ModuloConcedivel,
} from "@/lib/acessos/modulos";
import type { MapaPermissoes, NivelModulo } from "@/lib/acessos/permissoes";
import { REGRAS_SENHA, gerarSenhaProvisoria, senhaValida } from "@/lib/acessos/senha";
import type { AcessoPayload, UsuarioAcesso } from "@/lib/acessos/tipos";

type NivelForm = "super_admin" | "edicao" | "leitura";

const NIVEIS: { id: NivelForm; titulo: string; texto: string; icon: typeof Crown; cor: string; corAtivo: string }[] = [
  {
    id: "super_admin", titulo: "Super Admin", icon: Crown,
    texto: "Acesso total, sem restrições — inclusive Acessos e Configurações.",
    cor: "text-accent-600 bg-accent-50", corAtivo: "border-accent-400 ring-2 ring-accent-200 bg-accent-50/40",
  },
  {
    id: "edicao", titulo: "Edição", icon: PencilLine,
    texto: "Consulta e altera dados nos módulos liberados.",
    cor: "text-emerald-700 bg-emerald-50", corAtivo: "border-emerald-400 ring-2 ring-emerald-100 bg-emerald-50/40",
  },
  {
    id: "leitura", titulo: "Leitura", icon: Eye,
    texto: "Só consulta e exporta (PDF/Excel) nos módulos liberados.",
    cor: "text-sky-700 bg-sky-50", corAtivo: "border-sky-400 ring-2 ring-sky-100 bg-sky-50/40",
  },
];

const SETORES_SUGERIDOS = ["Administrativo", "Financeiro", "Contabilidade", "Operacional", "Campo", "Diretoria", "Sócios"];

interface FormState {
  nome: string;
  email: string;
  cargo: string;
  setor: string;
  nivel: NivelForm;
  modulos: MapaPermissoes;
  /** Só na criação: a pessoa entra com ela e cria a própria no 1º acesso. */
  senhaProvisoria: string;
}

function estadoInicial(u: UsuarioAcesso | null): FormState {
  if (!u) {
    return {
      nome: "", email: "", cargo: "", setor: "", nivel: "leitura", modulos: {},
      senhaProvisoria: gerarSenhaProvisoria(),
    };
  }
  return {
    nome: u.nome,
    email: u.email,
    cargo: u.cargo ?? "",
    setor: u.setor ?? "",
    nivel: u.superAdmin ? "super_admin" : u.nivel === "edicao" ? "edicao" : "leitura",
    modulos: u.permissoes,
    senhaProvisoria: "",
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AcessoFormModal({ usuario, ehVoceMesmo, setoresExistentes, salvando, onClose, onSalvar }: {
  /** null = novo acesso. */
  usuario: UsuarioAcesso | null;
  ehVoceMesmo: boolean;
  setoresExistentes: string[];
  salvando: boolean;
  onClose: () => void;
  onSalvar: (payload: AcessoPayload) => void;
}) {
  const [form, setForm] = useState<FormState>(() => estadoInicial(usuario));
  const [tentou, setTentou] = useState(false);
  const guard = useUnsavedGuard(true, form, onClose);
  const novo = !usuario;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const setores = useMemo(
    () => Array.from(new Set([...setoresExistentes, ...SETORES_SUGERIDOS])).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [setoresExistentes],
  );

  const qtdModulos = Object.keys(form.modulos).length;
  const qtdEdicao = form.nivel === "edicao" ? Object.values(form.modulos).filter((v) => v === "edicao").length : 0;

  const erros = {
    nome: form.nome.trim().length < 3 ? "Informe o nome completo." : null,
    email: novo && !EMAIL_RE.test(form.email.trim()) ? "Informe um e-mail válido." : null,
    modulos: form.nivel !== "super_admin" && qtdModulos === 0 ? "Libere ao menos um módulo." : null,
    senha: novo && !senhaValida(form.senhaProvisoria) ? "A senha provisória precisa ter 8+ caracteres, com letras e números." : null,
  };
  const valido = !erros.nome && !erros.email && !erros.modulos && !erros.senha;

  function trocarNivel(nivel: NivelForm) {
    setForm((f) => {
      // Leitura → Edição: o que estava marcado passa a ser edição.
      const modulos: MapaPermissoes = {};
      for (const k of Object.keys(f.modulos) as ModuloConcedivel[]) {
        modulos[k] = nivel === "edicao" ? (f.nivel === "edicao" ? f.modulos[k]! : "edicao") : "leitura";
      }
      return { ...f, nivel, modulos };
    });
  }

  function alternarModulo(k: ModuloConcedivel) {
    setForm((f) => {
      const modulos = { ...f.modulos };
      if (modulos[k]) delete modulos[k];
      else modulos[k] = f.nivel === "edicao" ? "edicao" : "leitura";
      return { ...f, modulos };
    });
  }

  function nivelDoModulo(k: ModuloConcedivel, v: NivelModulo) {
    setForm((f) => ({ ...f, modulos: { ...f.modulos, [k]: v } }));
  }

  function marcarGrupo(keys: ModuloConcedivel[], marcar: boolean) {
    setForm((f) => {
      const modulos = { ...f.modulos };
      for (const k of keys) {
        if (marcar) modulos[k] = modulos[k] ?? (f.nivel === "edicao" ? "edicao" : "leitura");
        else delete modulos[k];
      }
      return { ...f, modulos };
    });
  }

  function salvar() {
    setTentou(true);
    if (!valido) return;
    const superAdmin = form.nivel === "super_admin";
    const permissoes: MapaPermissoes = {};
    if (!superAdmin) {
      for (const [k, v] of Object.entries(form.modulos) as [ModuloConcedivel, NivelModulo][]) {
        permissoes[k] = form.nivel === "leitura" ? "leitura" : v;
      }
    }
    onSalvar({
      nome: form.nome.trim(),
      email: novo ? form.email.trim().toLowerCase() : undefined,
      cargo: form.cargo.trim() || null,
      setor: form.setor.trim() || null,
      superAdmin,
      permissoes,
      senhaProvisoria: novo ? form.senhaProvisoria : undefined,
    });
  }

  const todosKeys = MODULOS_CONCEDIVEIS.map((m) => m.key);

  return (
    <Modal
      open
      onClose={guard.requestClose}
      title={novo ? "Novo acesso" : `Editar acesso — ${usuario.nome}`}
      size="xl"
      closeOnBackdrop={false}
    >
      <div className="p-6 space-y-7">
        {/* 1. Dados da pessoa */}
        <section className="space-y-3">
          <TituloSecao numero={1} titulo="Quem é a pessoa" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Nome completo *"
              placeholder="Maria da Silva"
              value={form.nome}
              onChange={(e) => set("nome", e.target.value)}
              error={tentou ? erros.nome ?? undefined : undefined}
              autoFocus={novo}
            />
            <Input
              label="E-mail *"
              type="email"
              placeholder="maria@empresa.com.br"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              disabled={!novo}
              error={tentou ? erros.email ?? undefined : undefined}
              icon={<Mail size={14} />}
            />
            <Input
              label="Cargo"
              placeholder="Ex.: Analista financeiro"
              value={form.cargo}
              onChange={(e) => set("cargo", e.target.value)}
              maxLength={80}
            />
            <div>
              <Input
                label="Setor"
                placeholder="Ex.: Financeiro"
                value={form.setor}
                onChange={(e) => set("setor", e.target.value)}
                list="acessos-setores"
                maxLength={80}
              />
              <datalist id="acessos-setores">
                {setores.map((s) => <option key={s} value={s} />)}
              </datalist>
            </div>
          </div>
          {!novo && (
            <p className="text-xs text-stone-400">O e-mail é o login da pessoa e não pode ser alterado.</p>
          )}
        </section>

        {/* 2. Nível */}
        <section className="space-y-3">
          <TituloSecao numero={2} titulo="Tipo de acesso" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {NIVEIS.map(({ id, titulo, texto, icon: Icon, cor, corAtivo }) => {
              const ativo = form.nivel === id;
              const travado = ehVoceMesmo && id !== "super_admin";
              return (
                <button
                  key={id}
                  type="button"
                  disabled={travado}
                  onClick={() => trocarNivel(id)}
                  className={cn(
                    "relative text-left rounded-xl border p-4 transition",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400",
                    ativo ? corAtivo : "border-stone-200 hover:border-stone-300 hover:bg-stone-50",
                    travado && "opacity-40 cursor-not-allowed hover:bg-transparent",
                  )}
                >
                  <span className={cn("inline-flex h-9 w-9 items-center justify-center rounded-lg mb-2.5", cor)}>
                    <Icon size={17} />
                  </span>
                  <p className="text-sm font-semibold text-stone-800">{titulo}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-stone-500">{texto}</p>
                  {ativo && (
                    <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-stone-800 text-white">
                      <Check size={12} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {ehVoceMesmo && (
            <p className="text-xs text-stone-400">Você não pode tirar o seu próprio acesso de Super Admin.</p>
          )}
        </section>

        {/* 3. Módulos */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <TituloSecao numero={3} titulo="Módulos liberados" />
            {form.nivel !== "super_admin" && (
              <div className="flex items-center gap-3 text-xs">
                <button type="button" className="font-medium text-accent-700 hover:underline" onClick={() => marcarGrupo(todosKeys, true)}>
                  Marcar todos
                </button>
                <span className="text-stone-300">|</span>
                <button type="button" className="font-medium text-stone-500 hover:underline" onClick={() => marcarGrupo(todosKeys, false)}>
                  Limpar
                </button>
              </div>
            )}
          </div>

          {form.nivel === "super_admin" ? (
            <div className="flex items-start gap-3 rounded-xl border border-accent-200 bg-accent-50/60 px-4 py-3 text-sm text-accent-800">
              <Crown size={18} className="mt-0.5 shrink-0" />
              <span>Super Admin vê e altera <b>todos os módulos</b>, inclusive Acessos e Configurações. Não há o que marcar.</span>
            </div>
          ) : (
            <>
              {form.nivel === "edicao" && (
                <p className="flex items-center gap-1.5 text-xs text-stone-500">
                  <Info size={13} className="shrink-0" />
                  Cada módulo marcado entra em edição; use a chave ao lado para deixar algum só como leitura.
                </p>
              )}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {GRUPOS_MODULO.map((g) => {
                  const mods = MODULOS_CONCEDIVEIS.filter((m) => m.grupo === g.id);
                  if (mods.length === 0) return null;
                  const keys = mods.map((m) => m.key);
                  const todosMarcados = keys.every((k) => form.modulos[k]);
                  return (
                    <div key={g.id} className="rounded-xl border border-stone-200 overflow-hidden">
                      <div className="flex items-center justify-between bg-stone-50 px-4 py-2 border-b border-stone-100">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">{g.label}</span>
                        <button
                          type="button"
                          className="text-[11px] font-medium text-accent-700 hover:underline"
                          onClick={() => marcarGrupo(keys, !todosMarcados)}
                        >
                          {todosMarcados ? "Desmarcar" : "Marcar"} grupo
                        </button>
                      </div>
                      <ul className="divide-y divide-stone-100">
                        {mods.map((m) => {
                          const nivelMod = form.modulos[m.key];
                          const marcado = !!nivelMod;
                          return (
                            <li key={m.key} className={cn("flex items-center gap-3 px-4 py-2.5 transition", marcado && "bg-white")}>
                              <label className="flex flex-1 min-w-0 items-start gap-3 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={marcado}
                                  onChange={() => alternarModulo(m.key)}
                                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-stone-300 accent-[#a67c20]"
                                />
                                <span className="min-w-0">
                                  <span className={cn("block text-sm", marcado ? "font-medium text-stone-800" : "text-stone-600")}>
                                    {m.label}
                                  </span>
                                  <span className="block text-[11px] leading-snug text-stone-400">{m.descricao}</span>
                                </span>
                              </label>
                              {marcado && form.nivel === "edicao" && (
                                <ChaveNivel valor={nivelMod!} onChange={(v) => nivelDoModulo(m.key, v)} />
                              )}
                              {marcado && form.nivel === "leitura" && (
                                <span className="shrink-0 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                                  Leitura
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-stone-200 px-4 py-2.5 text-xs text-stone-500">
                <Lock size={13} className="shrink-0" />
                Exclusivos do Super Admin:
                {MODULOS_EXCLUSIVOS.map((m) => (
                  <span key={m.key} className="rounded-full bg-stone-100 px-2 py-0.5 font-medium text-stone-600">{m.label}</span>
                ))}
              </div>
              {tentou && erros.modulos && <p className="text-xs text-red-600">{erros.modulos}</p>}
            </>
          )}
        </section>

        {novo && (
          <section className="space-y-3">
            <TituloSecao numero={4} titulo="Senha provisória" />
            <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-4">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    label="Senha para o primeiro acesso"
                    value={form.senhaProvisoria}
                    onChange={(e) => set("senhaProvisoria", e.target.value.trim())}
                    className="font-mono tracking-wider"
                    icon={<KeyRound size={14} />}
                    maxLength={72}
                    error={tentou ? erros.senha ?? undefined : undefined}
                  />
                </div>
                <Button type="button" variant="outline" onClick={() => set("senhaProvisoria", gerarSenhaProvisoria())}>
                  <RefreshCw size={14} /> Gerar outra
                </Button>
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {REGRAS_SENHA.map((r) => (
                  <li key={r.id} className={cn("flex items-center gap-1 text-[11px]", r.ok(form.senhaProvisoria) ? "text-emerald-700" : "text-stone-400")}>
                    <Check size={11} className={r.ok(form.senhaProvisoria) ? "" : "opacity-30"} /> {r.label}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs leading-relaxed text-stone-500">
                Depois de criar, você recebe e-mail + senha para mandar à pessoa (WhatsApp). No primeiro acesso,
                o sistema obriga a criar a própria senha — a provisória deixa de valer.
              </p>
            </div>
          </section>
        )}
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 bg-white/95 px-6 py-4 backdrop-blur">
        <p className="text-xs text-stone-500">
          {form.nivel === "super_admin"
            ? "Acesso total ao sistema."
            : qtdModulos === 0
              ? "Nenhum módulo marcado."
              : form.nivel === "edicao"
                ? `${qtdModulos} módulo(s) liberado(s) · edita ${qtdEdicao}, só consulta ${qtdModulos - qtdEdicao}.`
                : `${qtdModulos} módulo(s) liberado(s), só consulta.`}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={guard.requestClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} loading={salvando} disabled={salvando || (tentou && !valido)}>
            {novo ? "Criar acesso" : "Salvar alterações"}
          </Button>
        </div>
      </div>
      <UnsavedChangesDialog open={guard.confirmOpen} onStay={guard.stay} onDiscard={guard.discard} />
    </Modal>
  );
}

function TituloSecao({ numero, titulo }: { numero: number; titulo: string }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-800">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-stone-800 text-[10px] font-bold text-white">
        {numero}
      </span>
      {titulo}
    </h3>
  );
}

function ChaveNivel({ valor, onChange }: { valor: NivelModulo; onChange: (v: NivelModulo) => void }) {
  const opcoes: { v: NivelModulo; label: string }[] = [
    { v: "edicao", label: "Edição" },
    { v: "leitura", label: "Leitura" },
  ];
  return (
    <div className="flex shrink-0 rounded-lg border border-stone-200 bg-stone-50 p-0.5" role="radiogroup">
      {opcoes.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={valor === o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            "rounded-md px-2 py-0.5 text-[11px] font-medium transition",
            valor === o.v
              ? o.v === "edicao" ? "bg-emerald-600 text-white shadow-sm" : "bg-sky-600 text-white shadow-sm"
              : "text-stone-500 hover:text-stone-700",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
