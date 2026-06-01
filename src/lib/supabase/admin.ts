// Cliente Supabase com service-role — bypassa RLS.
// USE EXCLUSIVAMENTE em route handlers / server actions / scripts.
// NÃO IMPORTAR EM CLIENT COMPONENTS.

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Cria um client Supabase com a service-role key, que bypassa RLS.
 * Use só quando o caller server-side precisar ler/escrever tabelas que a RLS
 * fechou para usuários não-admin (ex.: chaves de API em config_ia).
 *
 * Importante: a chave é lida de `SUPABASE_SERVICE_ROLE_KEY` (sem prefixo
 * NEXT_PUBLIC_). Como a env atual do projeto ainda chama essa variável de
 * `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`, aceitamos ambos os nomes — mas a
 * versão NEXT_PUBLIC_ vaza pro bundle do cliente; recomenda-se renomeá-la.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL não configurado.");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurado.");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
