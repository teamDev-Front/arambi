"use client";
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { UnsavedChangesDialog } from "@/components/ui/UnsavedChangesDialog";
import { useUnsavedGuard } from "@/lib/hooks/useUnsavedGuard";
import { createClient } from "@/lib/supabase/client";
import type { IAProvider, ConfigIARow } from "@/types";
import { Eye, EyeOff, KeyRound, Save, Sparkles } from "lucide-react";

export type { IAProvider };

export interface IAConfig {
  provider: IAProvider;
  gemini_api_key: string;
  openai_api_key: string;
}

const DEFAULT_CONFIG: IAConfig = {
  provider: "gemini",
  gemini_api_key: "",
  openai_api_key: "",
};

function rowToConfig(row: Pick<ConfigIARow, "provider_ativo" | "gemini_api_key" | "openai_api_key"> | null): IAConfig {
  if (!row) return DEFAULT_CONFIG;
  return {
    provider: row.provider_ativo,
    gemini_api_key: row.gemini_api_key ?? "",
    openai_api_key: row.openai_api_key ?? "",
  };
}

/**
 * Lê a configuração de IA do Supabase (singleton id=1).
 * Use do lado do cliente — a route handler /api/assistentes/chat tem sua
 * própria leitura server-side.
 */
export async function loadIAConfig(): Promise<IAConfig> {
  const supabase = createClient();
  const { data } = await supabase
    .from("config_ia")
    .select("provider_ativo, gemini_api_key, openai_api_key")
    .eq("id", 1)
    .maybeSingle();
  return rowToConfig(data);
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
  // Snapshot só depois do load assíncrono (open && !loading) — senão o config
  // carregado marcaria o formulário como "sujo" sem o usuário digitar nada.
  const guard = useUnsavedGuard(open && !loading, config, onClose);

  useEffect(() => {
    if (!open) return;
    setShowGemini(false);
    setShowOpenAI(false);
    setLoading(true);
    loadIAConfig()
      .then((c) => setConfig(c))
      .catch(() => {
        toast.error("Erro ao carregar", "Não foi possível ler a configuração das IAs.");
        setConfig(DEFAULT_CONFIG);
      })
      .finally(() => setLoading(false));
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
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    setSaving(false);

    if (error) {
      toast.error("Erro ao salvar", error.message);
      return;
    }
    toast.success(
      "Configuração salva",
      `Provedor ativo: ${config.provider === "gemini" ? "Google Gemini" : "OpenAI"}.`,
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
          deve responder os assistentes neste momento. As chaves ficam salvas no Supabase
          e são lidas server-side pela rota do chat — o navegador não as expõe.
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
