-- ============================================================================
-- 0012 — Promover admin@arambi.com a role='admin'
-- ============================================================================
-- O trigger tg_handle_new_auth_user (migration 0003) cria todo perfil novo
-- com role='viewer' por padrão. Quando o admin@arambi.com foi criado, caiu
-- como viewer e por isso a RLS bloqueava UPDATE/DELETE no Financeiro,
-- causando erro 406 ("Cannot coerce the result to a single JSON object").
--
-- Esta migration:
-- 1. Promove o admin@arambi.com já cadastrado para 'admin'.
-- 2. Atualiza o trigger pra que futuras criações desse email entrem
--    direto como admin (idempotente — pode rodar a qualquer momento).

update public.users
set role = 'admin'::public.user_role
where email = 'admin@arambi.com'
  and role <> 'admin';

-- Trigger atualizado: emails reconhecidos viram admin direto.
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
    case
      when new.email in ('admin@arambi.com') then 'admin'::public.user_role
      else 'viewer'::public.user_role
    end
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.users.full_name, excluded.full_name);
  return new;
end;
$$;

-- Conferência rápida (não falha, só loga via NOTICE)
do $$
declare r record;
begin
  for r in
    select email, role from public.users where email = 'admin@arambi.com'
  loop
    raise notice 'admin user promovido: % (role=%)', r.email, r.role;
  end loop;
end $$;
