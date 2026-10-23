// Papéis do Plano de Contas nas telas (browser) — cache de módulo + store
// reativo, no mesmo padrão de src/lib/utils/status-config.ts.
//
// Antes de carregar — ou sem a migration 0066 — vale o PAPEIS_PADRAO (os
// códigos de hoje), então nada muda até alguém trocar um código no Plano de
// Contas. Uma falha de leitura passageira mantém o último mapa bom e tenta de
// novo no próximo uso; o mapa também se renova sozinho a cada 5 minutos (uma
// troca de código feita em outra aba/sessão chega sem recarregar a página).
//
// Uso:
//   • componentes: `const papeis = usePapeis();` → papeis.dl, papeis.resgate…
//   • queries/handlers assíncronos: `const papeis = await obterPapeis();`
//   • depois de trocar um código no Plano de Contas: `recarregarPapeis()`.

import { useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { carregarPapeisDetalhado, mesmosPapeis, PAPEIS_PADRAO, type MapaPapeis } from "./papeis";

const VALIDADE_MS = 5 * 60_000;

let snapshot: MapaPapeis = PAPEIS_PADRAO;
let carga: Promise<MapaPapeis> | null = null;
let validoAte = 0;
let geracao = 0;
const listeners = new Set<() => void>();

function notificar() { for (const l of listeners) l(); }

/**
 * Mapa papel → código (carrega na 1ª vez e a cada 5 min). Nunca lança: sem a
 * tabela, devolve o padrão; com falha de leitura, o último mapa bom.
 */
export function obterPapeis(forcar = false): Promise<MapaPapeis> {
  if (carga && !forcar && Date.now() < validoAte) return carga;
  validoAte = Date.now() + VALIDADE_MS;
  const minha = ++geracao;
  carga = (async () => {
    try {
      const r = await carregarPapeisDetalhado(createClient());
      // Uma carga mais nova (ex.: recarregarPapeis após trocar um código) já
      // assumiu — esta não sobrescreve o resultado dela.
      if (minha !== geracao) return snapshot;
      if (r.erro) {
        validoAte = 0; // falha passageira: mantém o último mapa bom e tenta de novo
        return snapshot;
      }
      if (!mesmosPapeis(snapshot, r.papeis)) {
        snapshot = Object.freeze({ ...r.papeis });
        notificar();
      }
    } catch {
      if (minha === geracao) validoAte = 0;
    }
    return snapshot;
  })();
  return carga;
}

/** Recarrega do banco — chamar depois de trocar um código no Plano de Contas. */
export function recarregarPapeis(): Promise<MapaPapeis> {
  return obterPapeis(true);
}

/** Último mapa carregado (ou o padrão) — leitura síncrona, sem disparar carga. */
export function getPapeis(): MapaPapeis {
  return snapshot;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  void obterPapeis(); // dispara (ou renova) a carga ao primeiro uso
  return () => { listeners.delete(cb); };
}

/** Hook reativo: papel → código, com o padrão até o banco responder. */
export function usePapeis(): MapaPapeis {
  return useSyncExternalStore(subscribe, () => snapshot, () => PAPEIS_PADRAO);
}
