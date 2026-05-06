-- ============================================================================
-- 0003 — Perfis de usuário (espelha auth.users do Supabase Auth)
-- ============================================================================
-- A tabela auth.users é gerenciada pelo Supabase. Mantemos um espelho em
-- public.users com role e dados de exibição. Trigger sincroniza ao criar.

create table if not exists public.users (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        citext unique not null,
  full_name    text,
  role         public.user_role not null default 'viewer',
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_users_role on public.users(role);

drop trigger if exists tg_users_updated_at on public.users;
create trigger tg_users_updated_at
  before update on public.users
  for each row execute function public.tg_set_updated_at();

-- Quando um usuário é criado em auth.users, cria perfil em public.users.
create or replace function public.tg_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'viewer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists tg_on_auth_user_created on auth.users;
create trigger tg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.tg_handle_new_auth_user();

comment on table public.users is
  'Perfil de aplicação (espelha auth.users). RLS aplicada no migration 0009.';
