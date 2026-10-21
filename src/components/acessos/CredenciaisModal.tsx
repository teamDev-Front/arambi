"use client";
// Acesso criado / senha provisória gerada: mostra e-mail + senha UMA vez, para
// o Super Admin copiar ou mandar pelo WhatsApp (o processo não usa e-mail).

import { useState } from "react";
import { CheckCircle2, Copy, Check, MessageCircle, KeyRound, ShieldAlert } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import type { Credenciais } from "@/lib/acessos/tipos";

export interface CredenciaisExibidas extends Credenciais {
  nome: string;
  /** "novo" = acesso recém-criado; "reset" = nova senha provisória. */
  contexto: "novo" | "reset";
}

export function CredenciaisModal({ dados, onClose }: { dados: CredenciaisExibidas; onClose: () => void }) {
  const [copiado, setCopiado] = useState<"senha" | "tudo" | null>(null);
  const { nome, email, senha, contexto } = dados;
  const primeiroNome = nome.split(" ")[0];
  const endereco = typeof window !== "undefined" ? window.location.origin : "";

  const mensagem = [
    contexto === "novo"
      ? `Olá, ${primeiroNome}! Seu acesso ao AramBI foi criado.`
      : `Olá, ${primeiroNome}! Geramos uma nova senha provisória para o seu acesso ao AramBI.`,
    "",
    `Endereço: ${endereco}`,
    `E-mail: ${email}`,
    `Senha provisória: ${senha}`,
    "",
    "Ao entrar, o sistema vai pedir para você criar a sua própria senha.",
  ].join("\n");

  async function copiar(texto: string, qual: "senha" | "tudo") {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(qual);
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      setCopiado(null);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={contexto === "novo" ? "Acesso criado" : "Nova senha provisória"}
      size="md"
      closeOnBackdrop={false}
    >
      <div className="p-6 space-y-5">
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-600" />
          <p className="text-sm text-emerald-900">
            {contexto === "novo"
              ? <>Mande os dados abaixo para <b>{primeiroNome}</b>. No primeiro acesso, o sistema pede para criar a própria senha.</>
              : <>A senha anterior de <b>{primeiroNome}</b> deixou de funcionar. Mande a provisória — ao entrar, o sistema pede uma senha nova.</>}
          </p>
        </div>

        <div className="rounded-xl border border-stone-200 bg-stone-50/70 divide-y divide-stone-200/70">
          <Linha rotulo="Endereço" valor={endereco} />
          <Linha rotulo="E-mail" valor={email} />
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">Senha provisória</p>
              <p className="mt-0.5 font-mono text-lg font-semibold tracking-wider text-stone-800 select-all">{senha}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void copiar(senha, "senha")}>
              {copiado === "senha" ? <Check size={13} /> : <KeyRound size={13} />}
              {copiado === "senha" ? "Copiada" : "Copiar senha"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => void copiar(mensagem, "tudo")}>
            {copiado === "tudo" ? <Check size={14} /> : <Copy size={14} />}
            {copiado === "tudo" ? "Mensagem copiada" : "Copiar mensagem"}
          </Button>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(mensagem)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#25D366] px-4 text-sm font-medium text-white shadow-sm transition hover:bg-[#1ebe5b]"
          >
            <MessageCircle size={15} /> Enviar pelo WhatsApp
          </a>
        </div>

        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-stone-500">
          <ShieldAlert size={13} className="mt-0.5 shrink-0 text-amber-600" />
          Esta senha não aparece de novo. Se ela se perder, gere outra pela lista (ícone de chave).
        </p>
      </div>
      <div className="flex justify-end border-t border-stone-100 bg-stone-50/50 px-6 py-4">
        <Button onClick={onClose}>Concluir</Button>
      </div>
    </Modal>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">{rotulo}</p>
      <p className="mt-0.5 truncate text-sm text-stone-800 select-all">{valor}</p>
    </div>
  );
}
