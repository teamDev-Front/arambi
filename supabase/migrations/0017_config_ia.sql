-- ============================================================================
-- 0017 — Config IA (chaves de API + provedor ativo)
-- ============================================================================
-- Substitui o localStorage da tela /dashboard/assistentes pelo armazenamento
-- server-side das chaves de API dos provedores de IA (Gemini / OpenAI) e a
-- escolha de qual deles está ativo.
--
-- Padrão singleton: a tabela tem no máximo UMA linha (id = 1), garantida
-- por check constraint. A modal lê/escreve via Supabase JS; a route
-- /api/assistentes/chat lê server-side antes de chamar o provedor — o front
-- nunca enxerga a chave em si.

-- ---------------------------------------------------------------------------
-- 1) Enum dos provedores suportados
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'ia_provider') then
    create type public.ia_provider as enum ('gemini', 'openai');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Tabela config_ia (singleton)
-- ---------------------------------------------------------------------------
create table if not exists public.config_ia (
  id              integer primary key default 1,
  provider_ativo  public.ia_provider not null default 'gemini',
  gemini_api_key  text,
  openai_api_key  text,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.users(id) on delete set null,
  constraint config_ia_singleton check (id = 1)
);

drop trigger if exists tg_config_ia_updated_at on public.config_ia;
create trigger tg_config_ia_updated_at
  before update on public.config_ia
  for each row execute function public.tg_set_updated_at();

-- Garante a linha singleton (idempotente)
insert into public.config_ia (id) values (1)
  on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3) RLS — leitura para autenticados, escrita para admin/editor
-- ---------------------------------------------------------------------------
alter table public.config_ia enable row level security;

drop policy if exists config_ia_read on public.config_ia;
create policy config_ia_read on public.config_ia
  for select using (auth.uid() is not null);

drop policy if exists config_ia_write on public.config_ia;
create policy config_ia_write on public.config_ia
  for all using (public.fn_can_write()) with check (public.fn_can_write());

comment on table public.config_ia is
  'Configuração das IAs dos assistentes (singleton id=1): chaves de API e provedor ativo. Consumida server-side por /api/assistentes/chat.';
