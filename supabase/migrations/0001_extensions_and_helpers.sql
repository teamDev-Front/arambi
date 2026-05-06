-- ============================================================================
-- 0001 — Extensions e helpers
-- ============================================================================
-- Roda primeiro. Cria extensions e funções utilitárias usadas por outras tabelas.

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "citext";     -- emails case-insensitive

-- Trigger genérico de updated_at
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.tg_set_updated_at is
  'Atualiza updated_at em qualquer tabela que tenha essa coluna.';

-- ---------------------------------------------------------------------------
-- mes_referencia(date) — função IMMUTABLE para uso em colunas generated stored
-- ---------------------------------------------------------------------------
-- to_char() do Postgres é STABLE (depende de lc_time), o que impede uso direto
-- em GENERATED ALWAYS AS ... STORED. Construímos a string YYYY-MM manualmente
-- com extract() + lpad(), que são imutáveis.
create or replace function public.fn_mes_referencia(d date)
returns text
language sql
immutable
as $$
  select case
    when d is null then null
    else extract(year from d)::int::text || '-' ||
         lpad(extract(month from d)::int::text, 2, '0')
  end
$$;

comment on function public.fn_mes_referencia is
  'Retorna ''YYYY-MM'' a partir de uma date. IMMUTABLE para uso em generated columns.';
