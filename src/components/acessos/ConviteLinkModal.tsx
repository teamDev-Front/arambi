"use client";
// Resultado de um convite: confirmação do e-mail e/ou o link para enviar por
// WhatsApp (quando pedido ou quando o e-mail não saiu).

import { useState } from "react";
import { CheckCircle2, Copy, Check, MessageCircle, MailWarning, Link2, Mail } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import type { ResultadoConvite } from "@/lib/acessos/tipos";

export interface ConviteExibido extends ResultadoConvite {
  nome: string;
  email: string;
  /** "convite" (criação/reenvio) ou "senha" (redefinição para quem já tem conta). */
  contexto: "convite" | "senha";
}

export function ConviteLinkModal({ resultado, onClose }: { resultado: ConviteExibido; onClose: () => void }) {
  const [copiado, setCopiado] = useState(false);
  const { nome, email, link, emailEnviado, avisoEmail, contexto } = resultado;
  const primeiroNome = nome.split(" ")[0];

  const mensagemWhats = link
    ? contexto === "convite"
      ? `Olá, ${primeiroNome}! Seu acesso ao AramBI foi criado. Abra o link abaixo para criar a sua senha e entrar no sistema:\n\n${link}`
      : `Olá, ${primeiroNome}! Use o link abaixo para criar uma nova senha no AramBI:\n\n${link}`
    : "";

  async function copiar() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={contexto === "convite" ? "Convite de acesso" : "Redefinição de senha"} size="md">
      <div className="p-6 space-y-5">
        {emailEnviado ? (
          <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-600" />
            <div className="text-sm text-emerald-900">
              <p className="font-semibold">E-mail enviado para {email}</p>
              <p className="mt-0.5 text-emerald-800/80">
                {contexto === "convite"
                  ? `${primeiroNome} vai receber um link para criar a senha. Peça para conferir também o spam.`
                  : `${primeiroNome} vai receber um link para criar uma nova senha.`}
              </p>
            </div>
          </div>
        ) : avisoEmail ? (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <MailWarning size={20} className="mt-0.5 shrink-0 text-amber-600" />
            <div className="text-sm text-amber-900">
              <p className="font-semibold">O e-mail não foi enviado</p>
              <p className="mt-0.5 text-amber-800/90 leading-relaxed">{avisoEmail}</p>
            </div>
          </div>
        ) : null}

        {link && (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-sm font-medium text-stone-800">
              <Link2 size={15} className="text-accent-600" />
              Link {contexto === "convite" ? "de convite" : "para nova senha"} de {primeiroNome}
            </p>
            <div className="flex gap-2">
              <input
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
                className="h-9 min-w-0 flex-1 rounded-lg border border-stone-300 bg-stone-50 px-3 text-xs text-stone-700 focus:outline-none focus:ring-2 focus:ring-accent-400"
              />
              <Button variant="outline" size="md" onClick={copiar}>
                {copiado ? <Check size={14} /> : <Copy size={14} />}
                {copiado ? "Copiado" : "Copiar"}
              </Button>
            </div>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(mensagemWhats)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-[#25D366] px-4 text-sm font-medium text-white shadow-sm transition hover:bg-[#1ebe5b]"
            >
              <MessageCircle size={15} /> Enviar pelo WhatsApp
            </a>
            <ul className="space-y-1 pt-1 text-[11px] leading-relaxed text-stone-500">
              <li>• O link é pessoal e vale por tempo limitado — se expirar, gere outro pela lista.</li>
              <li>• Gerar um novo link invalida o anterior (inclusive o do e-mail).</li>
              <li>• Para testar você mesmo, abra numa janela anônima — no mesmo navegador, o link troca a sua sessão pela da pessoa.</li>
            </ul>
          </div>
        )}

        {!link && !emailEnviado && !avisoEmail && (
          <p className="flex items-center gap-2 text-sm text-stone-600">
            <Mail size={15} /> Nada a enviar.
          </p>
        )}
      </div>
      <div className="flex justify-end border-t border-stone-100 bg-stone-50/50 px-6 py-4">
        <Button onClick={onClose}>Concluir</Button>
      </div>
    </Modal>
  );
}
