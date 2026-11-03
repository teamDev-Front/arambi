"use client";
// Nome da "Conta bancária de origem – Distribuição de Lucros" (Configurações →
// Automações, migration 0069) para os textos das telas. Regra central pedida
// pela Adri em 30-out: trocou a conta lá, os textos acompanham. Sem a chave
// (antes da 0069) ou vazia, vale o CORA, como era até out-2026.
import { useEffect, useState } from "react";
import { obterConfigApp, CONFIG_DL_CONTA_ORIGEM } from "@/lib/queries/configuracoes";
import { listarContasEmpresa } from "@/lib/queries/bancos";

let cache: Promise<string> | null = null;

async function carregar(): Promise<string> {
  const [id, contas] = await Promise.all([obterConfigApp(CONFIG_DL_CONTA_ORIGEM, ""), listarContasEmpresa()]);
  const conta = contas.find((c) => c.id === id && c.ativa)
    ?? contas.find((c) => c.ativa && /cora/i.test(c.banco ?? c.nome));
  return conta?.apelido?.trim() || conta?.nome || "Cora";
}

export function useContaOrigemDL(): string {
  const [nome, setNome] = useState("Cora");
  useEffect(() => {
    cache ??= carregar().catch(() => { cache = null; return "Cora"; });
    let vivo = true;
    cache.then((n) => { if (vivo) setNome(n); });
    return () => { vivo = false; };
  }, []);
  return nome;
}
