-- ============================================================================
-- 0058 — Acessos: usuários por convite, módulos e níveis (21-out-2026)
-- ============================================================================
-- Pedido (Luiz, 21-out): tela "Acessos" para cadastrar quem entra no sistema
-- (nome, e-mail, cargo, setor), convidar por e-mail para a pessoa definir a
-- própria senha, bloquear o acesso e definir o que cada um vê e altera:
--   • Super Admin  → tudo, inclusive Acessos e Configurações (role 'admin');
--   • Edição       → módulos liberados, podendo alterar (role 'editor');
--   • Leitura      → módulos liberados, só consulta e exportação (role 'viewer').
-- Dentro de "Edição", cada módulo pode ficar só como leitura.
--
-- Modelo:
--   • users.permissoes = { "<modulo>": "leitura" | "edicao" } — as chaves são os
--     módulos do menu (catálogo em src/lib/acessos/modulos.ts). Super Admin
--     ignora o mapa.
--   • users.role continua sendo a trava do RLS e passa a ser DERIVADO do mapa
--     (gatilho abaixo): algum módulo em edição → 'editor'; só leitura →
--     'viewer'. 'admin' e 'socio' não são tocados.
--   • users.ativo = false → bloqueado: as funções de papel devolvem NULL/false
--     e as políticas de leitura passam a exigir usuário ativo — o corte vale
--     na hora, mesmo com o token de acesso ainda válido.
--   • Perfis criados pelo gatilho de auth.users (convite OU cadastro público)
--     nascem INATIVOS; quem ativa é o servidor da tela Acessos, depois de
--     gravar módulos e nível. Cadastro público, se continuar ligado no painel,
--     não dá acesso a nada.
--
-- Brechas fechadas aqui:
--   • users_update_self_or_admin deixava o usuário alterar a PRÓPRIA linha
--     inteira — inclusive role (autopromoção a admin pelo console). Agora o
--     usuário logado só altera full_name/avatar_url; o resto passa pelo
--     servidor (service role) da tela Acessos.
--   • fn_is_admin()/fn_can_write() devolviam NULL sem login (ou com perfil
--     bloqueado), e "if not NULL" deixava passar nas RPCs security definer
--     (achado de 14-out: fn_status_add, fn_lixeira_restaurar/descartar,
--     fn_registrar_versao_documento, fn_registrar_descricao_documento).
--     Agora devolvem false.
--
-- Recorte por módulo DENTRO do banco (fase 2, não feito aqui): o RLS segue
-- por papel — Leitura não grava nada, Edição grava dados operacionais. O
-- recorte por módulo de quem tem Edição é garantido pela aplicação (proxy,
-- páginas, APIs e telas). Exceções já recortadas aqui por serem cadastros
-- de um módulo só: contas bancárias (Bancos) e espécies (Animais).
--
-- Tabelas NOVAS: usar `(select public.fn_usuario_ativo())` na política de
-- leitura, e não `auth.uid() is not null`.
--
-- Aplicar no SQL Editor. Idempotente.

-- ---------------------------------------------------------------------------
-- 1) Colunas novas em public.users
-- ---------------------------------------------------------------------------
alter table public.users
  add column if not exists cargo             text,
  add column if not exists setor             text,
  add column if not exists permissoes        jsonb not null default '{}'::jsonb,
  -- default true só para preencher quem JÁ existe; logo abaixo vira false.
  add column if not exists ativo             boolean not null default true,
  add column if not exists senha_definida_em timestamptz,
  add column if not exists convidado_por     uuid references public.users(id) on delete set null,
  add column if not exists convidado_em      timestamptz,
  add column if not exists bloqueado_em      timestamptz,
  add column if not exists bloqueado_por     uuid references public.users(id) on delete set null;

alter table public.users alter column ativo set default false;

-- Quem já existia antes da tela Acessos entrava com senha.
update public.users
   set senha_definida_em = created_at
 where senha_definida_em is null
   and convidado_em is null
   and ativo;

comment on column public.users.permissoes is
  'Módulos liberados: {"<modulo>": "leitura"|"edicao"}. Ignorado para role admin. Migration 0058.';
comment on column public.users.ativo is
  'false = bloqueado (ou convite ainda não ativado pelo servidor). Corta leitura e escrita no RLS. Migration 0058.';
comment on column public.users.senha_definida_em is
  'Primeira vez que a pessoa definiu a senha (convite aceito). NULL = convite pendente. Migration 0058.';

create or replace function public.fn_permissoes_validas(p jsonb)
returns boolean
language sql
immutable
as $$
  -- case (e não "and"): jsonb_each num array daria erro antes da checagem.
  select case
    when jsonb_typeof(p) = 'object' then not exists (
      select 1 from jsonb_each(p) e
       where e.value not in ('"leitura"'::jsonb, '"edicao"'::jsonb)
    )
    else false
  end
$$;

alter table public.users drop constraint if exists users_permissoes_validas;
alter table public.users
  add constraint users_permissoes_validas check (public.fn_permissoes_validas(permissoes));

create index if not exists idx_users_ativo on public.users(ativo);

-- Perfis editor/viewer anteriores à 0058 (produção não tinha nenhum) mantêm o
-- que viam: todos os módulos, no nível do papel.
update public.users u
   set permissoes = (
     select jsonb_object_agg(m, case when u.role = 'editor' then 'edicao' else 'leitura' end)
       from unnest(array[
         'home','financeiro','distribuicao','bancos','saldos','orcamentos',
         'provisionamento','vendas','estoque','animais','maquinario','horta',
         'operacao','relatorios','documentos','assistentes','recibos','lixeira','logs'
       ]) as m
   )
 where u.role in ('editor', 'viewer')
   and u.permissoes = '{}'::jsonb
   and u.convidado_em is null;

-- ---------------------------------------------------------------------------
-- 2) Funções de papel — agora exigem usuário ATIVO e nunca devolvem NULL
-- ---------------------------------------------------------------------------
create or replace function public.fn_usuario_ativo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select u.ativo from public.users u where u.id = auth.uid()), false)
$$;

comment on function public.fn_usuario_ativo() is
  'true se o usuário logado tem perfil ativo (não bloqueado). Base das políticas de leitura. Migration 0058.';

create or replace function public.fn_my_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select u.role from public.users u where u.id = auth.uid() and u.ativo
$$;

create or replace function public.fn_is_admin()
returns boolean
language sql
stable
as $$ select coalesce(public.fn_my_role() = 'admin', false) $$;

create or replace function public.fn_can_write()
returns boolean
language sql
stable
as $$ select coalesce(public.fn_my_role() in ('admin', 'editor'), false) $$;

create or replace function public.fn_pode_ver_modulo(p_modulo text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select u.role = 'admin' or u.permissoes ? p_modulo
      from public.users u
     where u.id = auth.uid() and u.ativo
  ), false)
$$;

create or replace function public.fn_pode_editar_modulo(p_modulo text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select u.role = 'admin'
        or (u.role = 'editor' and u.permissoes ->> p_modulo = 'edicao')
      from public.users u
     where u.id = auth.uid() and u.ativo
  ), false)
$$;

comment on function public.fn_pode_ver_modulo(text) is
  'Super Admin ou módulo liberado (leitura ou edição) para o usuário ativo. Migration 0058.';
comment on function public.fn_pode_editar_modulo(text) is
  'Super Admin ou módulo liberado em EDIÇÃO para o usuário ativo. Migration 0058.';

grant execute on function public.fn_usuario_ativo()          to authenticated;
grant execute on function public.fn_pode_ver_modulo(text)    to authenticated;
grant execute on function public.fn_pode_editar_modulo(text) to authenticated;

-- Marca o convite como aceito na primeira vez que a pessoa define a senha
-- (ou entra com senha). Só mexe na própria linha.
create or replace function public.fn_marcar_senha_definida()
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.users
     set senha_definida_em = coalesce(senha_definida_em, now())
   where id = auth.uid()
     and senha_definida_em is null
$$;

revoke all on function public.fn_marcar_senha_definida() from public, anon;
grant execute on function public.fn_marcar_senha_definida() to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Gatilhos de public.users
-- ---------------------------------------------------------------------------
-- 3a) role derivado das permissões (editor/viewer); admin e socio intactos.
create or replace function public.tg_users_normaliza_acesso()
returns trigger
language plpgsql
as $$
begin
  new.permissoes := coalesce(new.permissoes, '{}'::jsonb);
  -- Formato inválido fica para o CHECK users_permissoes_validas recusar.
  if new.role in ('editor', 'viewer') and jsonb_typeof(new.permissoes) = 'object' then
    new.role := case
      when exists (select 1 from jsonb_each_text(new.permissoes) e where e.value = 'edicao')
        then 'editor'::public.user_role
      else 'viewer'::public.user_role
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists tg_users_normaliza_acesso on public.users;
create trigger tg_users_normaliza_acesso
  before insert or update of role, permissoes on public.users
  for each row execute function public.tg_users_normaliza_acesso();

-- 3b) Nunca deixar o sistema sem Super Admin ativo. Só recusa o comando que
-- tirou o ÚLTIMO (se antes havia algum) — ambiente vazio de teste não trava.
-- security definer: a contagem não pode depender do que o RLS deixa ver.
create or replace function public.tg_users_garante_super_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from antigos where role = 'admin' and ativo)
     and not exists (select 1 from public.users where role = 'admin' and ativo) then
    raise exception 'Operação recusada: o sistema ficaria sem nenhum Super Admin ativo.'
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

drop trigger if exists tg_users_garante_super_admin_upd on public.users;
create trigger tg_users_garante_super_admin_upd
  after update on public.users
  referencing old table as antigos
  for each statement execute function public.tg_users_garante_super_admin();

drop trigger if exists tg_users_garante_super_admin_del on public.users;
create trigger tg_users_garante_super_admin_del
  after delete on public.users
  referencing old table as antigos
  for each statement execute function public.tg_users_garante_super_admin();

-- 3c) Perfil criado a partir de auth.users nasce INATIVO e sem módulos.
-- (admin@arambi.com continua na lista de exceção da 0012.)
create or replace function public.tg_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean := new.email in ('admin@arambi.com');
begin
  insert into public.users (id, email, full_name, role, ativo, permissoes)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
    case when v_admin then 'admin'::public.user_role else 'viewer'::public.user_role end,
    v_admin,
    '{}'::jsonb
  )
  on conflict (id) do update
    set email     = excluded.email,
        full_name = coalesce(public.users.full_name, excluded.full_name);
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) public.users: o usuário logado só altera nome e avatar da própria linha
-- ---------------------------------------------------------------------------
-- A linha continua filtrada pela política users_update_self_or_admin; o
-- privilégio de coluna fecha o resto (role, permissoes, ativo...). Criar,
-- alterar acesso e bloquear passam pelo servidor (/api/acessos, service role).
revoke insert, update, delete on public.users from anon, authenticated;
grant update (full_name, avatar_url) on public.users to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Leitura exige usuário ATIVO (bloqueado perde acesso na hora)
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and cmd = 'SELECT'
       and qual = '(auth.uid() IS NOT NULL)'
  loop
    execute format(
      'alter policy %I on %I.%I using ((select public.fn_usuario_ativo()))',
      r.policyname, r.schemaname, r.tablename
    );
  end loop;
end $$;

-- Log de auditoria: qualquer usuário ativo registra (login, exportação...).
alter policy logs_insert on public.logs
  with check ((select public.fn_usuario_ativo()));

-- Logs do Sistema: Super Admin ou quem tem o módulo (antes: admin/editor).
drop policy if exists logs_read on public.logs;
create policy logs_read on public.logs
  for select using (public.fn_pode_ver_modulo('logs'));

-- transacoes_socio: mesma regra da 0009, agora exigindo usuário ativo
-- também no caminho do sócio.
drop policy if exists ts_select on public.transacoes_socio;
create policy ts_select on public.transacoes_socio
  for select using (
    (select public.fn_usuario_ativo()) and (
      public.fn_my_role() in ('admin', 'editor', 'viewer')
      or socio_id = public.fn_my_socio_id()
    )
  );

-- Chat: escrita só do dono e só com usuário ativo (regra da 0020 + ativo).
drop policy if exists cs_write on public.chat_sessions;
create policy cs_write on public.chat_sessions
  for all
  using       ((select public.fn_usuario_ativo()) and usuario_id = auth.uid())
  with check  ((select public.fn_usuario_ativo()) and usuario_id = auth.uid());

drop policy if exists cm_write on public.chat_mensagens;
create policy cm_write on public.chat_mensagens
  for all
  using (
    (select public.fn_usuario_ativo()) and exists (
      select 1 from public.chat_sessions s
      where s.id = chat_mensagens.session_id
        and s.usuario_id = auth.uid()
    )
  )
  with check (
    (select public.fn_usuario_ativo()) and exists (
      select 1 from public.chat_sessions s
      where s.id = chat_mensagens.session_id
        and s.usuario_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 6) Cadastros de um módulo só: escrita por quem tem o módulo em EDIÇÃO
-- ---------------------------------------------------------------------------
-- Antes: só admin. Só a tela Bancos grava contas; nenhum gatilho de outro
-- módulo escreve nelas.
drop policy if exists contas_bancarias_empresa_admin on public.contas_bancarias_empresa;
drop policy if exists contas_bancarias_empresa_write on public.contas_bancarias_empresa;
create policy contas_bancarias_empresa_write on public.contas_bancarias_empresa
  for all
  using      (public.fn_pode_editar_modulo('bancos'))
  with check (public.fn_pode_editar_modulo('bancos'));

drop policy if exists contas_bancarias_socio_admin on public.contas_bancarias_socio;
drop policy if exists contas_bancarias_socio_write on public.contas_bancarias_socio;
create policy contas_bancarias_socio_write on public.contas_bancarias_socio
  for all
  using      (public.fn_pode_editar_modulo('bancos'))
  with check (public.fn_pode_editar_modulo('bancos'));

-- Espécies de animais: quem edita o módulo Animais cadastra espécies.
drop policy if exists animal_especies_admin on public.animal_especies;
drop policy if exists animal_especies_write on public.animal_especies;
create policy animal_especies_write on public.animal_especies
  for all
  using      (public.fn_pode_editar_modulo('animais'))
  with check (public.fn_pode_editar_modulo('animais'));

-- ---------------------------------------------------------------------------
-- 7) Storage (bucket documentos-gerados): leitura exige usuário ativo;
--    upload exige permissão de escrita (antes: qualquer autenticado).
-- ---------------------------------------------------------------------------
-- Em bloco próprio: se o papel que roda a migration não puder alterar
-- políticas de storage.objects, só esta parte é pulada (com aviso).
do $$
begin
  drop policy if exists dg_storage_read on storage.objects;
  create policy dg_storage_read on storage.objects
    for select to authenticated
    using (bucket_id = 'documentos-gerados' and (select public.fn_usuario_ativo()));

  drop policy if exists dg_storage_insert on storage.objects;
  create policy dg_storage_insert on storage.objects
    for insert to authenticated
    with check (bucket_id = 'documentos-gerados' and public.fn_can_write());
exception
  when insufficient_privilege then
    raise notice '0058: sem permissão para alterar as políticas de storage.objects — parte 7 pulada (o resto foi aplicado).';
end $$;

-- ---------------------------------------------------------------------------
-- Conferência (só NOTICE)
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select email, role, ativo, senha_definida_em is not null as com_senha
             from public.users order by email
  loop
    raise notice '0058 · %: role=% ativo=% senha=%', r.email, r.role, r.ativo, r.com_senha;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- ROLLBACK (manual):
--   • políticas: recriar as da 0009/0020 (auth.uid() is not null; logs_read com
--     fn_can_write; *_admin com fn_is_admin) e as de storage da 0016;
--   • grant insert, update, delete on public.users to authenticated;
--   • drop trigger tg_users_normaliza_acesso, tg_users_garante_super_admin_upd,
--     tg_users_garante_super_admin_del on public.users; recriar
--     tg_handle_new_auth_user da 0012;
--   • fn_my_role/fn_is_admin/fn_can_write da 0009;
--   • drop function fn_pode_ver_modulo, fn_pode_editar_modulo,
--     fn_usuario_ativo, fn_marcar_senha_definida, fn_permissoes_validas;
--   • colunas novas de users podem ficar (não atrapalham).
-- ----------------------------------------------------------------------------
