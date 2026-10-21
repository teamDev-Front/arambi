// Logs do Sistema (tabela logs). Leitura: Super Admin ou módulo Logs (RLS 0058).
// Escrita: servidor (tela Acessos) e eventos de login/logout.

import { createClient } from "@/lib/supabase/client";
import type { LogRow } from "@/types";

export type LogLinha = Pick<LogRow, "id" | "tipo" | "acao" | "descricao" | "usuario_nome" | "metadados" | "ip" | "created_at">;

/** Registros mais recentes (o filtro/paginação da tela é local). */
export async function listarLogs(limite = 2000): Promise<LogLinha[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("logs")
    .select("id, tipo, acao, descricao, usuario_nome, metadados, ip, created_at")
    .order("created_at", { ascending: false })
    .limit(limite);
  if (error) throw error;
  return (data ?? []) as LogLinha[];
}
