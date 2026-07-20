-- ============================================================================
-- 0040 — Calendário de Chuva (call de 14/jul/2026)
-- ============================================================================
-- "O calendário da chuva pode ser na home, na verdade, porque ele vai abranger
--  a parte de plantio também, da lavoura e também da horta, então ele pega
--  geral" (Ana). Registro manual de mm por dia, uma linha por data.

create table if not exists public.chuvas (
  id          uuid primary key default gen_random_uuid(),
  data        date not null unique,
  milimetros  numeric(6,1) not null check (milimetros >= 0),
  observacao  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_chuvas_data on public.chuvas(data);

drop trigger if exists tg_chuvas_updated_at on public.chuvas;
create trigger tg_chuvas_updated_at
  before update on public.chuvas
  for each row execute function public.tg_set_updated_at();

comment on table public.chuvas is
  'Registro manual de chuva (mm/dia) — alimenta o Calendário de Chuva da Home.';

alter table public.chuvas enable row level security;

drop policy if exists chuvas_read on public.chuvas;
create policy chuvas_read on public.chuvas
  for select using (auth.uid() is not null);
drop policy if exists chuvas_write on public.chuvas;
create policy chuvas_write on public.chuvas
  for all using (public.fn_can_write()) with check (public.fn_can_write());
