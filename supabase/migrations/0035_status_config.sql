-- 0035_status_config.sql
-- Torna o STATUS dos lançamentos configurável pela UI (Admin → Status & Cores):
-- rótulo, cor de fundo/texto, "tipo" (entrada/saída/neutro), ordem e ativo.
--
-- A coluna transacoes_empresa.status continua sendo o enum status_aramburu.
-- Esta tabela guarda apenas a APRESENTAÇÃO de cada valor e quais aparecem nas
-- seleções. Adicionar um status NOVO usa a função fn_status_add (faz ALTER TYPE
-- ADD VALUE no enum + insere aqui). "Remover" = inativar (Postgres não permite
-- excluir valor de enum; um valor já usado jamais pode ser apagado).

create table if not exists public.status_config (
  codigo      text primary key,                 -- valor do enum status_aramburu (texto)
  label       text not null,
  kind        text not null default 'neutro' check (kind in ('entrada','saida','neutro')),
  cor_bg      text not null default '#6b7280',  -- hex (#rrggbb)
  cor_text    text not null default '#ffffff',
  ordem       smallint,
  ativo       boolean not null default true,
  is_sistema  boolean not null default false,   -- true = valor original do enum (não excluir)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists tg_status_config_updated_at on public.status_config;
create trigger tg_status_config_updated_at
  before update on public.status_config
  for each row execute function public.tg_set_updated_at();

-- RLS: leitura para todos autenticados, escrita só admin (padrão dos cadastros).
alter table public.status_config enable row level security;
drop policy if exists status_config_read on public.status_config;
create policy status_config_read on public.status_config
  for select using (auth.uid() is not null);
drop policy if exists status_config_admin on public.status_config;
create policy status_config_admin on public.status_config
  for all using (public.fn_is_admin()) with check (public.fn_is_admin());

-- Seed: os 16 status atuais, com rótulo/cor/tipo iguais aos hardcoded do app
-- (legenda do Excel da Lola). is_sistema = true.
insert into public.status_config (codigo, label, kind, cor_bg, cor_text, ordem, is_sistema) values
  ('saldo_inicial',   'Saldo inicial',   'neutro',  '#6b7280', '#ffffff',  1, true),
  ('recebido',        'Recebido',        'entrada', '#29abe2', '#ffffff',  2, true),
  ('a_receber',       'A receber',       'entrada', '#0071bc', '#ffffff',  3, true),
  ('pago',            'Pago',            'saida',   '#22b14c', '#ffffff',  4, true),
  ('a_pagar',         'A pagar',         'saida',   '#ed1c24', '#ffffff',  5, true),
  ('repassado',       'Repassado',       'saida',   '#22b14c', '#ffffff',  6, true),
  ('a_repassar',      'A repassar',      'saida',   '#ed1c24', '#ffffff',  7, true),
  ('aplicado',        'Aplicado',        'saida',   '#22b14c', '#ffffff',  8, true),
  ('a_aplicar',       'A aplicar',       'saida',   '#ed1c24', '#ffffff',  9, true),
  ('aplicacao',       'Aplicação',       'entrada', '#f7b500', '#1c1917', 10, true),
  ('resgatado',       'Resgatado',       'entrada', '#22b14c', '#ffffff', 11, true),
  ('a_resgatar',      'A resgatar',      'entrada', '#ed1c24', '#ffffff', 12, true),
  ('resgate',         'Resgate',         'entrada', '#f7b500', '#1c1917', 13, true),
  ('provisionado',    'Provisionado',    'saida',   '#f7b500', '#1c1917', 14, true),
  ('provisionado_dl', 'Provisionado DL', 'saida',   '#f7b500', '#1c1917', 15, true),
  ('provisionado_dv', 'Provisionado DV', 'saida',   '#f7b500', '#1c1917', 16, true)
on conflict (codigo) do nothing;

-- Função para ADICIONAR um status novo: adiciona o valor ao enum (idempotente)
-- e cria a linha de apresentação. SECURITY DEFINER porque ALTER TYPE exige dono
-- do tipo. Em PG12+ ADD VALUE pode rodar em transação (o valor fica utilizável
-- após o commit desta função, o que ocorre quando a RPC retorna).
create or replace function public.fn_status_add(
  p_codigo   text,
  p_label    text,
  p_kind     text default 'neutro',
  p_cor_bg   text default '#6b7280',
  p_cor_text text default '#ffffff',
  p_ordem    int  default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.fn_is_admin() then
    raise exception 'Apenas administradores podem adicionar status';
  end if;
  if p_codigo is null or p_codigo !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'Código de status inválido. Use minúsculas, números e _ (ex.: em_negociacao).';
  end if;
  if coalesce(p_kind,'neutro') not in ('entrada','saida','neutro') then
    raise exception 'Tipo inválido (use entrada, saida ou neutro).';
  end if;

  execute format('alter type public.status_aramburu add value if not exists %L', p_codigo);

  insert into public.status_config (codigo, label, kind, cor_bg, cor_text, ordem, is_sistema, ativo)
  values (
    p_codigo,
    coalesce(nullif(btrim(p_label), ''), p_codigo),
    coalesce(nullif(p_kind, ''), 'neutro'),
    coalesce(nullif(p_cor_bg, ''), '#6b7280'),
    coalesce(nullif(p_cor_text, ''), '#ffffff'),
    p_ordem, false, true
  )
  on conflict (codigo) do update set
    label = excluded.label, kind = excluded.kind,
    cor_bg = excluded.cor_bg, cor_text = excluded.cor_text,
    ordem = excluded.ordem, ativo = true;
end;
$$;

grant execute on function public.fn_status_add(text, text, text, text, text, int) to authenticated;

comment on table public.status_config is
  'Apresentação configurável dos status (rótulo, cor, tipo, ordem, ativo). Espelha o enum status_aramburu.';
