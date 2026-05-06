-- ============================================================================
-- 0009 — Row Level Security
-- ============================================================================
-- Política base:
--   • admin   → pode tudo
--   • editor  → CRUD em transações, estoque, documentos, recibos, chats
--   • socio   → SELECT em quase tudo; vê SUAS próprias transações_socio sempre
--   • viewer  → SELECT em tudo (read-only)
-- Cadastros (plano de contas, sócios, bancos) são read-only para todos exceto admin.

-- ---------------------------------------------------------------------------
-- Helper: pega a role do usuário atual
-- ---------------------------------------------------------------------------
create or replace function public.fn_my_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users where id = auth.uid()
$$;

create or replace function public.fn_is_admin()
returns boolean language sql stable as $$ select public.fn_my_role() = 'admin' $$;

create or replace function public.fn_can_write()
returns boolean language sql stable as $$ select public.fn_my_role() in ('admin','editor') $$;

create or replace function public.fn_my_socio_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.socios where user_id = auth.uid() limit 1
$$;

-- ---------------------------------------------------------------------------
-- public.users — perfil próprio + admin
-- ---------------------------------------------------------------------------
alter table public.users enable row level security;

drop policy if exists users_select_self_or_admin on public.users;
create policy users_select_self_or_admin on public.users
  for select using (auth.uid() = id or public.fn_is_admin());

drop policy if exists users_update_self_or_admin on public.users;
create policy users_update_self_or_admin on public.users
  for update using (auth.uid() = id or public.fn_is_admin())
  with check       (auth.uid() = id or public.fn_is_admin());

drop policy if exists users_admin_all on public.users;
create policy users_admin_all on public.users
  for all using (public.fn_is_admin())
  with check    (public.fn_is_admin());

-- ---------------------------------------------------------------------------
-- Cadastros: SELECT para todos autenticados, escrita só admin
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select unnest(array[
      'classificacao_financeira',
      'classificacao_pessoal',
      'socios',
      'contas_bancarias_empresa',
      'contas_bancarias_socio',
      'despesas_recorrentes_socio',
      'fornecedores',
      'recibo_modelos',
      'obra_parametros'
    ])
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select using (auth.uid() is not null)', t, t);
    execute format('drop policy if exists %I_admin on public.%I', t, t);
    execute format('create policy %I_admin on public.%I for all using (public.fn_is_admin()) with check (public.fn_is_admin())', t, t);
  end loop;
end$$;

-- ---------------------------------------------------------------------------
-- Tabelas operacionais: SELECT para todos, escrita admin/editor
-- (com 1 exceção: socio só vê suas próprias transações_socio se a role for 'socio')
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select unnest(array[
      'transacoes_empresa',
      'estoque',
      'documentos',
      'recibos',
      'obra_lts_itens',
      'obra_pendencias',
      'notas_em_grupo'
    ])
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select using (auth.uid() is not null)', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format('create policy %I_write on public.%I for all using (public.fn_can_write()) with check (public.fn_can_write())', t, t);
  end loop;
end$$;

-- ---------- transacoes_socio: socio vê SOMENTE as suas; admin/editor/viewer vê tudo ----------
alter table public.transacoes_socio enable row level security;

drop policy if exists ts_select on public.transacoes_socio;
create policy ts_select on public.transacoes_socio
  for select using (
    auth.uid() is not null and (
      public.fn_my_role() in ('admin','editor','viewer')
      or socio_id = public.fn_my_socio_id()
    )
  );

drop policy if exists ts_write on public.transacoes_socio;
create policy ts_write on public.transacoes_socio
  for all using (public.fn_can_write())
  with check    (public.fn_can_write());

-- ---------- chat_sessions / chat_mensagens: todos veem tudo (escopo do projeto) ----------
alter table public.chat_sessions enable row level security;
drop policy if exists cs_read  on public.chat_sessions;
create policy cs_read  on public.chat_sessions for select using (auth.uid() is not null);
drop policy if exists cs_write on public.chat_sessions;
create policy cs_write on public.chat_sessions for all
  using       (auth.uid() is not null)
  with check  (auth.uid() is not null);

alter table public.chat_mensagens enable row level security;
drop policy if exists cm_read  on public.chat_mensagens;
create policy cm_read  on public.chat_mensagens for select using (auth.uid() is not null);
drop policy if exists cm_write on public.chat_mensagens;
create policy cm_write on public.chat_mensagens for all
  using       (auth.uid() is not null)
  with check  (auth.uid() is not null);

-- ---------- logs: read admin/editor; insert qualquer autenticado ----------
alter table public.logs enable row level security;
drop policy if exists logs_read   on public.logs;
create policy logs_read   on public.logs for select using (public.fn_can_write());
drop policy if exists logs_insert on public.logs;
create policy logs_insert on public.logs for insert with check (auth.uid() is not null);
