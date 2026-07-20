-- ============================================================================
-- 0042 — Horta / Canteiros (call de 14/jul/2026)
-- ============================================================================
-- Decisões do call:
--   • Canteiros numerados para controlar os ciclos de cultura.
--   • Campos: cultura, área, data de plantio, PREVISÃO DE COLHEITA (manual —
--     "a gente insere a previsão"), status editável ("clica, desce a barrinha,
--     coloca crescimento").
--   • Culturas têm ciclo padrão em dias, EDITÁVEL ("campo de previsão, 45 dias
--     que é o normal do alface") — a UI usa para pré-preencher a previsão.

-- ---------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'canteiro_ciclo_status') then
    create type public.canteiro_ciclo_status as enum ('plantado','crescimento','colheita','finalizado');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Culturas da horta (com ciclo padrão editável)
-- ---------------------------------------------------------------------------
create table if not exists public.horta_culturas (
  id                uuid primary key default gen_random_uuid(),
  nome              text not null unique,           -- "Alface"
  ciclo_dias_padrao int check (ciclo_dias_padrao is null or ciclo_dias_padrao between 1 and 730),
  ativo             boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists tg_horta_culturas_updated_at on public.horta_culturas;
create trigger tg_horta_culturas_updated_at
  before update on public.horta_culturas
  for each row execute function public.tg_set_updated_at();

comment on table public.horta_culturas is
  'Culturas da horta com ciclo padrão em dias (editável) — pré-preenche a previsão de colheita.';

-- Seed com exemplos citados no call
insert into public.horta_culturas (nome, ciclo_dias_padrao) values
  ('Alface', 45),
  ('Rúcula', 40),
  ('Couve', 60),
  ('Cenoura', 90),
  ('Beterraba', 70),
  ('Tomate', 90)
on conflict (nome) do nothing;

-- ---------------------------------------------------------------------------
-- Canteiros
-- ---------------------------------------------------------------------------
create table if not exists public.canteiros (
  id          uuid primary key default gen_random_uuid(),
  numero      int not null unique check (numero > 0),
  area_m2     numeric(8,2) check (area_m2 is null or area_m2 > 0),
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists tg_canteiros_updated_at on public.canteiros;
create trigger tg_canteiros_updated_at
  before update on public.canteiros
  for each row execute function public.tg_set_updated_at();

comment on table public.canteiros is 'Canteiros numerados da horta (call 14/jul).';

-- ---------------------------------------------------------------------------
-- Ciclos por canteiro (um plantio → colheita)
-- ---------------------------------------------------------------------------
create table if not exists public.canteiro_ciclos (
  id                uuid primary key default gen_random_uuid(),
  canteiro_id       uuid not null references public.canteiros(id) on delete cascade,
  cultura_id        uuid not null references public.horta_culturas(id) on delete restrict,
  data_plantio      date not null,
  previsao_colheita date,                           -- manual (call): UI sugere plantio + ciclo padrão
  status            public.canteiro_ciclo_status not null default 'plantado',
  colhido_em        date,
  observacao        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_ciclos_canteiro on public.canteiro_ciclos(canteiro_id);
create index if not exists idx_ciclos_status on public.canteiro_ciclos(status);

drop trigger if exists tg_canteiro_ciclos_updated_at on public.canteiro_ciclos;
create trigger tg_canteiro_ciclos_updated_at
  before update on public.canteiro_ciclos
  for each row execute function public.tg_set_updated_at();

comment on table public.canteiro_ciclos is
  'Ciclos de cultura por canteiro: plantio, previsão manual de colheita, status e finalização.';

-- ---------------------------------------------------------------------------
-- RLS — leitura autenticada; escrita admin+editor
-- ---------------------------------------------------------------------------
alter table public.horta_culturas  enable row level security;
alter table public.canteiros       enable row level security;
alter table public.canteiro_ciclos enable row level security;

drop policy if exists horta_culturas_read on public.horta_culturas;
create policy horta_culturas_read on public.horta_culturas
  for select using (auth.uid() is not null);
drop policy if exists horta_culturas_write on public.horta_culturas;
create policy horta_culturas_write on public.horta_culturas
  for all using (public.fn_can_write()) with check (public.fn_can_write());

drop policy if exists canteiros_read on public.canteiros;
create policy canteiros_read on public.canteiros
  for select using (auth.uid() is not null);
drop policy if exists canteiros_write on public.canteiros;
create policy canteiros_write on public.canteiros
  for all using (public.fn_can_write()) with check (public.fn_can_write());

drop policy if exists canteiro_ciclos_read on public.canteiro_ciclos;
create policy canteiro_ciclos_read on public.canteiro_ciclos
  for select using (auth.uid() is not null);
drop policy if exists canteiro_ciclos_write on public.canteiro_ciclos;
create policy canteiro_ciclos_write on public.canteiro_ciclos
  for all using (public.fn_can_write()) with check (public.fn_can_write());
