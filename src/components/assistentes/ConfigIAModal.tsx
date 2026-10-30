"use client";
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { UnsavedChangesDialog } from "@/components/ui/UnsavedChangesDialog";
import { useUnsavedGuard } from "@/lib/hooks/useUnsavedGuard";
import { createClient } from "@/lib/supabase/client";
import { MODELO_PADRAO, modeloEfetivo, type ModeloOpcao } from "@/lib/ai/modelos";
import type { IAProvider, ConfigIARow } from "@/types";
import { Eye, EyeOff, KeyRound, Save, Sparkles } from "lucide-react";

export type { IAProvider };

export interface IAConfig {
  provider: IAProvider;
  gemini_api_key: string;
  openai_api_key: string;
  /** Modelo escolhido por provedor (0067). "" = padrão do código. */
  openai_model: string;
  gemini_model: string;
  /** As colunas de modelo existem (migration 0067 aplicada)? */
  suportaModelo: boolean;
}

const DEFAULT_CONFIG: IAConfig = {
  provider: "gemini",
  gemini_api_key: "",
  openai_api_key: "",
  openai_model: "",
  gemini_model: "",
  suportaModelo: false,
};

function rowToConfig(row: Partial<ConfigIARow> | null): IAConfig {
  if (!row) return DEFAULT_CONFIG;
  return {
    provider: row.provider_ativo ?? DEFAULT_CONFIG.provider,
    gemini_api_key: row.gemini_api_key ?? "",
    openai_api_key: row.openai_api_key ?? "",
    openai_model: row.openai_model ?? "",
    gemini_model: row.gemini_model ?? "",
    suportaModelo: "openai_model" in row,
  };
}

/**
 * Lê a configuração de IA do Supabase (singleton id=1).
 * Use do lado do cliente — a route handler /api/assistentes/chat tem sua
 * própria leitura server-side. `select *`: as colunas de modelo só existem
 * depois da 0067, e a leitura não pode quebrar antes dela.
 */
export async function loadIAConfig(): Promise<IAConfig> {
  const supabase = createClient();
  const { data } = await supabase
    .from("config_ia")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  return rowToConfig(data);
}

/** Modelos de conversa da conta (chave salva) — /api/assistentes/modelos. */
async function buscarModelos(provider: IAProvider): Promise<ModeloOpcao[]> {
  const res = await fetch(`/api/assistentes/modelos?provider=${provider}`);
  const json = (await res.json().catch(() => ({}))) as { modelos?: ModeloOpcao[]; error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.modelos ?? [];
}

interface Catalogo {
  carregando: boolean;
  modelos: ModeloOpcao[];
  erro: string | null;
}
const CATALOGO_VAZIO: Catalogo = { carregando: false, modelos: [], erro: null };

const AJUDA_MODELO: Record<IAProvider, string> = {
  openai: "Os mais novos costumam responder melhor, mas demoram mais e cada mensagem custa mais na conta da OpenAI. Na dúvida, fique no padrão.",
  gemini: "Os mais novos costumam responder melhor, mas demoram mais e cada mensagem custa mais na conta do Google. Na dúvida, fique no padrão.",
};

/** Seletor do modelo de um provedor: a lista da conta, agrupada (GPT-6, GPT-5…). */
function SeletorModelo({
  provider, valor, onChange, catalogo, disabled, suporta,
}: {
  provider: IAProvider;
  valor: string;
  onChange: (v: string) => void;
  catalogo: Catalogo;
  disabled: boolean;
  suporta: boolean;
}) {
  if (!suporta) {
    return (
      <p className="text-xs text-stone-400">
        A escolha do modelo aparece depois da atualização do banco (migration 0067).
      </p>
    );
  }
  const grupos = new Map<string, ModeloOpcao[]>();
  for (const m of catalogo.modelos) grupos.set(m.grupo, [...(grupos.get(m.grupo) ?? []), m]);
  // O modelo salvo continua na lista mesmo se a conta não o mostrar mais.
  const foraDaLista = !!valor && !catalogo.modelos.some((m) => m.id === valor);

  return (
    <div className="space-y-1 pt-1">
      <label className="text-xs font-medium text-stone-600">Modelo</label>
      <select
        value={valor}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent transition disabled:opacity-50"
      >
        <option value="">Padrão — {MODELO_PADRAO[provider]}</option>
        {foraDaLista && <option value={valor}>{valor}</option>}
        {Array.from(grupos, ([grupo, modelos]) => (
          <optgroup key={grupo} label={grupo}>
            {modelos.map((m) => (
              <option key={m.id} value={m.id}>{m.nota ? `${m.id} — ${m.nota}` : m.id}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <p className="text-xs text-stone-400">
        {catalogo.carregando ? "Carregando os modelos da conta…" : catalogo.erro ?? AJUDA_MODELO[provider]}
      </p>
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ConfigIAModal({ open, onClose }: Props) {
  const toast = useToast();
  const [config, setConfig] = useState<IAConfig>(DEFAULT_CONFIG);
  const [showGemini, setShowGemini] = useState(false);
  const [showOpenAI, setShowOpenAI] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [catalogo, setCatalogo] = useState<Record<IAProvider, Catalogo>>({
    openai: CATALOGO_VAZIO, gemini: CATALOGO_VAZIO,
  });
  // Snapshot só depois do load assíncrono (open && !loading) — senão o config
  // carregado marcaria o formulário como "sujo" sem o usuário digitar nada.
  const guard = useUnsavedGuard(open && !loading, config, onClose);

  // Recarrega a configuração sempre que o modal abre (sincronização legítima).
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setShowGemini(false);
    setShowOpenAI(false);
    setLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    let cancelado = false;
    loadIAConfig()
      .then((c) => {
        if (cancelado) return;
        setConfig(c);
        if (!c.suportaModelo) return;
        // Modelos de cada provedor, da conta (chave salva). Sem chave, a rota
        // devolve a dica "Salve a chave…", que aparece sob o seletor.
        for (const p of ["openai", "gemini"] as const) {
          setCatalogo((cat) => ({ ...cat, [p]: { ...CATALOGO_VAZIO, carregando: true } }));
          buscarModelos(p)
            .then((modelos) => { if (!cancelado) setCatalogo((cat) => ({ ...cat, [p]: { carregando: false, modelos, erro: null } })); })
            .catch((e: Error) => { if (!cancelado) setCatalogo((cat) => ({ ...cat, [p]: { carregando: false, modelos: [], erro: e.message } })); });
        }
      })
      .catch(() => {
        toast.error("Erro ao carregar", "Não foi possível ler a configuração das IAs.");
        setConfig(DEFAULT_CONFIG);
      })
      .finally(() => setLoading(false));
    return () => { cancelado = true; };
  }, [open, toast]);

  async function handleSalvar() {
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("config_ia")
      .update({
        provider_ativo: config.provider,
        gemini_api_key: config.gemini_api_key.trim() || null,
        openai_api_key: config.openai_api_key.trim() || null,
        // Colunas da 0067 só vão quando existem — antes dela o update sai igual.
        ...(config.suportaModelo
          ? { openai_model: config.openai_model || null, gemini_model: config.gemini_model || null }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    setSaving(false);

    if (error) {
      toast.error("Erro ao salvar", error.message);
      return;
    }
    const modeloAtivo = modeloEfetivo(
      config.provider, config.provider === "gemini" ? config.gemini_model : config.openai_model,
    );
    toast.success(
      "Configuração salva",
      `Provedor ativo: ${config.provider === "gemini" ? "Google Gemini" : "OpenAI"}`
        + (config.suportaModelo ? ` · modelo ${modeloAtivo}.` : "."),
    );
    onClose();
  }

  const geminiPronto = config.gemini_api_key.trim().length > 0;
  const openaiPronto = config.openai_api_key.trim().length > 0;

  return (
    <Modal open={open} onClose={guard.requestClose} title="Configuração das IAs" size="lg">
      <div className="p-6 space-y-5">
        <p className="text-xs text-stone-500 leading-relaxed">
          Cadastre as chaves de API dos provedores de IA suportados e escolha qual deles
          deve responder os assistentes neste momento, e com qual modelo. As chaves ficam
          salvas no Supabase e são lidas server-side pela rota do chat — o navegador não as expõe.
        </p>

        {/* Switch de provedor ativo */}
        <div>
          <p className="text-sm font-medium text-stone-700 mb-2">Provedor ativo</p>
          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-stone-100 border border-stone-200">
            <button
              type="button"
              disabled={loading}
              onClick={() => setConfig((p) => ({ ...p, provider: "gemini" }))}
              className={
                "flex items-center justify-center gap-2 h-10 rounded-lg text-sm font-medium transition disabled:opacity-50 " +
                (config.provider === "gemini"
                  ? "bg-white text-surface-dark shadow-sm border border-stone-200"
                  : "text-stone-500 hover:text-stone-700")
              }
            >
              <Sparkles size={14} />
              Google Gemini
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => setConfig((p) => ({ ...p, provider: "openai" }))}
              className={
                "flex items-center justify-center gap-2 h-10 rounded-lg text-sm font-medium transition disabled:opacity-50 " +
                (config.provider === "openai"
                  ? "bg-white text-surface-dark shadow-sm border border-stone-200"
                  : "text-stone-500 hover:text-stone-700")
              }
            >
              <Sparkles size={14} />
              OpenAI
            </button>
          </div>
          <p className="text-xs text-stone-400 mt-2">
            O provedor selecionado precisa ter a respectiva chave preenchida abaixo.
          </p>
        </div>

        {/* Gemini */}
        <div className="rounded-lg border border-stone-200 p-4 space-y-2 bg-stone-50/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <KeyRound size={14} className="text-stone-500" />
              <span className="text-sm font-semibold text-stone-700">Google Gemini</span>
            </div>
            <span
              className={
                "text-[11px] font-medium px-2 py-0.5 rounded-full " +
                (geminiPronto
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-stone-100 text-stone-500")
              }
            >
              {geminiPronto ? "Chave salva" : "Sem chave"}
            </span>
          </div>
          <div className="relative">
            <Input
              type={showGemini ? "text" : "password"}
              value={config.gemini_api_key}
              disabled={loading}
              onChange={(e) =>
                setConfig((p) => ({ ...p, gemini_api_key: e.target.value }))
              }
              placeholder="AIza..."
              className="pr-9"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowGemini((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition"
              aria-label={showGemini ? "Ocultar chave" : "Mostrar chave"}
            >
              {showGemini ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <SeletorModelo
            provider="gemini"
            valor={config.gemini_model}
            onChange={(v) => setConfig((p) => ({ ...p, gemini_model: v }))}
            catalogo={catalogo.gemini}
            disabled={loading}
            suporta={config.suportaModelo}
          />
        </div>

        {/* OpenAI */}
        <div className="rounded-lg border border-stone-200 p-4 space-y-2 bg-stone-50/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <KeyRound size={14} className="text-stone-500" />
              <span className="text-sm font-semibold text-stone-700">OpenAI</span>
            </div>
            <span
              className={
                "text-[11px] font-medium px-2 py-0.5 rounded-full " +
                (openaiPronto
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-stone-100 text-stone-500")
              }
            >
              {openaiPronto ? "Chave salva" : "Sem chave"}
            </span>
          </div>
          <div className="relative">
            <Input
              type={showOpenAI ? "text" : "password"}
              value={config.openai_api_key}
              disabled={loading}
              onChange={(e) =>
                setConfig((p) => ({ ...p, openai_api_key: e.target.value }))
              }
              placeholder="sk-..."
              className="pr-9"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowOpenAI((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition"
              aria-label={showOpenAI ? "Ocultar chave" : "Mostrar chave"}
            >
              {showOpenAI ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <SeletorModelo
            provider="openai"
            valor={config.openai_model}
            onChange={(v) => setConfig((p) => ({ ...p, openai_model: v }))}
            catalogo={catalogo.openai}
            disabled={loading}
            suporta={config.suportaModelo}
          />
        </div>
      </div>

      <div className="px-6 py-4 border-t border-stone-100 flex items-center justify-end gap-2 bg-stone-50/50">
        <UnsavedChangesDialog open={guard.confirmOpen} onStay={guard.stay} onDiscard={guard.discard} />
        <Button type="button" variant="ghost" onClick={guard.requestClose} disabled={saving}>
          Cancelar
        </Button>
        <Button onClick={handleSalvar} disabled={loading || saving} loading={saving}>
          <Save size={13} /> Salvar configuração
        </Button>
      </div>
    </Modal>
  );
}
