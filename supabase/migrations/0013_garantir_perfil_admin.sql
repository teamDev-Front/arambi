-- ============================================================================
-- 0013 — Garante que TODO usuário em auth.users tenha perfil em public.users
-- ============================================================================
-- A migration 0012 fazia só UPDATE, mas se o usuário foi criado em auth.users
-- ANTES do trigger tg_handle_new_auth_user existir (ou se o trigger falhou),
-- a row em public.users simplesmente não existe. Sem ela, fn_my_role() retorna
-- NULL e qualquer policy que faça `fn_my_role() in (...)` rejeita silenciosamente
-- (o NULL não casa com nada → 0 rows → erro 406 no front).
--
-- Esta migration:
-- 1. Faz UPSERT pra cada usuário existente em auth.users criando perfil em
--    public.users (com role='admin' pra emails na allow-list, 'viewer' resto).
-- 2. Idempotente — pode rodar quantas vezes quiser.

insert into public.users (id, email, full_name, role)
select
  au.id,
  au.email::citext,
  coalesce(au.raw_user_meta_data->>'full_name', split_part(au.email, '@', 1)),
  case
    when au.email = 'admin@arambi.com' then 'admin'::public.user_role
    else 'viewer'::public.user_role
  end
from auth.users au
where au.email is not null
on conflict (id) do update
  set email = excluded.email,
      role  = case
        when excluded.email = 'admin@arambi.com' then 'admin'::public.user_role
        else public.users.role     -- preserva role atual pra outros usuários
      end;

-- Conferência (loga via NOTICE)
do $$
declare r record;
begin
  for r in
    select u.email, u.role, u.id
    from public.users u
    join auth.users au on au.id = u.id
    order by u.email
  loop
    raise notice '✓ perfil garantido: % (role=%)', r.email, r.role;
  end loop;
end $$;
