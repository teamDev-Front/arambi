"use client";
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { UnsavedChangesDialog } from "@/components/ui/UnsavedChangesDialog";
import { useUnsavedGuard } from "@/lib/hooks/useUnsavedGuard";
import { createClient } from "@/lib/supabase/client";
import type { AgentePromptPublicoRow, AgentePromptRow } from "@/types";
import { BookOpen, MessageCircle, Save, Sliders, Sparkles } from "lucide-react";

export interface AgentePromptEditavel {
  nome: string;
  system_prompt: string;
  mensagem_boas_vindas: string;
  temperatura: number;
}

const DEFAULT_EDIT: AgentePromptEditavel = {
  nome: "",
  system_prompt: "",
  mensagem_boas_vindas: "",
  temperatura: 0.3,
};

function rowToEdit(row: AgentePromptRow | null): AgentePromptEditavel {
  if (!row) return DEFAULT_EDIT;
  return {
    nome: row.nome,
    system_prompt: row.system_prompt ?? "",
    mensagem_boas_vindas: row.mensagem_boas_vindas ?? "",
    temperatura: Number(row.temperatura ?? 0.3),
  };
}

/**
 * Lê o "treinamento" completo (com system_prompt + temperatura).
 * Só admin/editor — RLS bloqueia outros papéis. Usado por esta modal.
 */
export async function loadAgentePrompt(agenteId: string): Promise<AgentePromptRow | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("agente_prompts")
    .select("*")
    .eq("agente_id", agenteId)
    .maybeSingle();
  return data;
}

/**
 * Lê só os metadados públicos (nome, boas-vindas, ativo) — acessível a
 * qualquer usuário autenticado via view v_agente_prompts_publico.
 * Usado pelo ChatPage no carregamento da tela.
 */
export async function loadAgentePromptPublico(agenteId: string): Promise<AgentePromptPublicoRow | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("v_agente_prompts_publico")
    .select("agente_id, nome, mensagem_boas_vindas, ativo")
    .eq("agente_id", agenteId)
    .maybeSingle();
  return data;
}

interface Props {
  open: boolean;
  agenteId: string;
  nomeFallback: string;       // usado se o agente ainda não existir no DB
  onClose: () => void;
  onSaved?: (saved: AgentePromptEditavel) => void;
}

function temperaturaLabel(t: number): string {
  if (t <= 0.2) return "Conservador (respostas previsíveis)";
  if (t <= 0.5) return "Balanceado";
  if (t <= 0.8) return "Criativo";
  return "Muito criativo (resposta pode variar)";
}

export function ConfigPromptModal({ open, agenteId, nomeFallback, onClose, onSaved }: Props) {
  const toast = useToast();
  const [edit, setEdit] = useState<AgentePromptEditavel>(DEFAULT_EDIT);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [existe, setExiste] = useState(false);
  // Snapshot só depois do load assíncrono (open && !loading) — senão o prompt
  // carregado marcaria o formulário como "sujo" sem o usuário digitar nada.
  const guard = useUnsavedGuard(open && !loading, edit, onClose);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    loadAgentePrompt(agenteId)
      .then((row) => {
        if (row) {
          setExiste(true);
          setEdit(rowToEdit(row));
        } else {
          setExiste(false);
          setEdit({ ...DEFAULT_EDIT, nome: nomeFallback });
        }
      })
      .catch(() => {
        toast.error("Erro ao carregar", "Não foi possível ler o treinamento do assistente.");
        setEdit({ ...DEFAULT_EDIT, nome: nomeFallback });
      })
      .finally(() => setLoading(false));
  }, [open, agenteId, nomeFallback, toast]);

  async function handleSalvar() {
    setSaving(true);
    const supabase = createClient();
    const camposEditaveis = {
      nome: edit.nome.trim() || nomeFallback,
      system_prompt: edit.system_prompt,
      mensagem_boas_vindas: edit.mensagem_boas_vindas.trim() || null,
      temperatura: edit.temperatura,
      ativo: true,
      updated_at: new Date().toISOString(),
    };

    const { error } = existe
      ? await supabase
          .from("agente_prompts")
          .update(camposEditaveis)
          .eq("agente_id", agenteId)
      : await supabase
          .from("agente_prompts")
          .insert({ agente_id: agenteId, ...camposEditaveis });
    setSaving(false);

    if (error) {
      toast.error("Erro ao salvar", error.message);
      return;
    }
    toast.success("Treinamento salvo", `Atualizado para ${camposEditaveis.nome}.`);
    setExiste(true);
    onSaved?.(edit);
    onClose();
  }

  return (
    <Modal open={open} onClose={guard.requestClose} title={`Treinamento — ${edit.nome || nomeFallback}`} size="xl">
      <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
        <p className="text-xs text-stone-500 leading-relaxed">
          Este é o &quot;treinamento&quot; do assistente: as diretrizes que ele segue em todas as
          conversas. Edite com calma — quanto mais específico (responsabilidades,
          restrições, formato de resposta), melhor o resultado.
        </p>

        {/* Nome de exibição */}
        <div className="rounded-lg border border-stone-200 p-4 bg-stone-50/40 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-stone-500" />
            <span className="text-sm font-semibold text-stone-700">Identidade</span>
          </div>
          <Input
            label="Nome de exibição"
            value={edit.nome}
            disabled={loading}
            onChange={(e) => setEdit((p) => ({ ...p, nome: e.target.value }))}
            placeholder={nomeFallback}
          />
        </div>

        {/* System prompt */}
        <div className="rounded-lg border border-stone-200 p-4 bg-stone-50/40 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpen size={14} className="text-stone-500" />
              <span className="text-sm font-semibold text-stone-700">Diretrizes (prompt do sistema)</span>
            </div>
            <span className="text-[11px] text-stone-400">
              {edit.system_prompt.length} caracteres
            </span>
          </div>
          <Textarea
            rows={14}
            value={edit.system_prompt}
            disabled={loading}
            onChange={(e) => setEdit((p) => ({ ...p, system_prompt: e.target.value }))}
            placeholder={
              "Você é o Assistente X da Aramburu.\n\n" +
              "Responsabilidades:\n- ...\n- ...\n\n" +
              "Restrições:\n- ...\n- Responder sempre em português do Brasil."
            }
            className="font-mono text-xs leading-relaxed"
          />
          <p className="text-[11px] text-stone-400">
            Esse texto vai como <strong>system instruction</strong> antes de cada mensagem do usuário.
            É o que define o &quot;papel&quot; e o estilo do assistente.
          </p>
        </div>

        {/* Mensagem de boas-vindas */}
        <div className="rounded-lg border border-stone-200 p-4 bg-stone-50/40 space-y-3">
          <div className="flex items-center gap-2">
            <MessageCircle size={14} className="text-stone-500" />
            <span className="text-sm font-semibold text-stone-700">Mensagem de boas-vindas</span>
          </div>
          <Textarea
            rows={3}
            value={edit.mensagem_boas_vindas}
            disabled={loading}
            onChange={(e) => setEdit((p) => ({ ...p, mensagem_boas_vindas: e.target.value }))}
            placeholder="Olá! Sou o Assistente X. Posso ajudar com..."
          />
          <p className="text-[11px] text-stone-400">
            Primeira fala que aparece quando o usuário abre o chat. Deixe em branco para usar o texto padrão.
          </p>
        </div>

        {/* Temperatura */}
        <div className="rounded-lg border border-stone-200 p-4 bg-stone-50/40 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sliders size={14} className="text-stone-500" />
              <span className="text-sm font-semibold text-stone-700">Temperatura</span>
            </div>
            <span className="text-sm font-mono text-stone-700">{edit.temperatura.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={edit.temperatura}
            disabled={loading}
            onChange={(e) => setEdit((p) => ({ ...p, temperatura: Number(e.target.value) }))}
            className="w-full accent-[#a67c20]"
          />
          <div className="flex justify-between text-[10px] text-stone-400">
            <span>0.00</span>
            <span>0.50</span>
            <span>1.00</span>
          </div>
          <p className="text-xs text-stone-500">{temperaturaLabel(edit.temperatura)}</p>
        </div>
      </div>

      <div className="px-6 py-4 border-t border-stone-100 flex items-center justify-end gap-2 bg-stone-50/50">
        <Button type="button" variant="ghost" onClick={guard.requestClose} disabled={saving}>
          Cancelar
        </Button>
        <Button onClick={handleSalvar} disabled={loading || saving} loading={saving}>
          <Save size={13} /> Salvar treinamento
        </Button>
      </div>
      <UnsavedChangesDialog open={guard.confirmOpen} onStay={guard.stay} onDiscard={guard.discard} />
    </Modal>
  );
}
