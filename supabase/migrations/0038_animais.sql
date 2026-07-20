-- ============================================================================
-- 0038 — Estoque de Animais (call de 14/jul/2026)
-- ============================================================================
-- Decisões do call:
--   • Cadastro por LOTE (não individual/brinco) — rebanho pequeno, gado leiteiro.
--   • Espécies são data-driven: a Ana cria novas espécies quando precisar
--     (hoje só bovino + equino; suíno zerado aguardando reposição).
--   • Vacinação/vermifugação = eventos sanitários com "próxima data" → alimenta
--     o calendário de vacinação (Home + página Animais) e os alertas.
--   • Histórico de saúde = ocorrências por lote com severidade (amarelo/vermelho).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'animal_lote_status') then
    create type public.animal_lote_status as enum ('ativo','vendido','abatido','inativo');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'animal_evento_tipo') then
    create type public.animal_evento_tipo as enum ('vacina','vermifugo','outro');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'ocorrencia_severidade') then
    create type public.ocorrencia_severidade as enum ('info','atencao','critico');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Espécies (cadastro data-driven, admin cria — ex.: Bovinos, Equinos, Suínos)
-- ---------------------------------------------------------------------------
create table if not exists public.animal_especies (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null unique,             -- "Bovinos"
  icone       text not null default '🐄',       -- emoji exibido nos cards
  ordem       smallint,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists tg_animal_especies_updated_at on public.animal_especies;
create trigger tg_animal_especies_updated_at
  before update on public.animal_especies
  for each row execute function public.tg_set_updated_at();

comment on table public.animal_especies is
  'Espécies de animais (data-driven — admin cria novas; call 14/jul).';

-- Seed com as espécies citadas no call / print da Adriane
insert into public.animal_especies (nome, icone, ordem) values
  ('Bovinos',  '🐄', 1),
  ('Equinos',  '🐎', 2),
  ('Ovinos',   '🐑', 3),
  ('Caprinos', '🐐', 4),
  ('Suínos',   '🐖', 5),
  ('Aves',     '🐔', 6)
on conflict (nome) do nothing;

-- ---------------------------------------------------------------------------
-- Lotes (unidade de cadastro decidida no call)
-- ---------------------------------------------------------------------------
create table if not exists public.animal_lotes (
  id          uuid primary key default gen_random_uuid(),
  codigo      text not null unique,             -- "LOTE-01"
  especie_id  uuid not null references public.animal_especies(id) on delete restrict,
  categoria   text,                             -- "Matriz", "Bezerro", "Leiteiras"
  raca        text,                             -- "Nelore", "Girolando"
  idade_meses int check (idade_meses is null or idade_meses >= 0),
  quantidade  int not null default 0 check (quantidade >= 0),
  status      public.animal_lote_status not null default 'ativo',
  observacoes text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_animal_lotes_especie on public.animal_lotes(especie_id);

drop trigger if exists tg_animal_lotes_updated_at on public.animal_lotes;
create trigger tg_animal_lotes_updated_at
  before update on public.animal_lotes
  for each row execute function public.tg_set_updated_at();

comment on table public.animal_lotes is
  'Lotes de animais (cadastro por lote — decisão do call 14/jul; quantidade de cabeças por lote).';

-- ---------------------------------------------------------------------------
-- Eventos sanitários (vacinação / vermifugação) — alimentam calendário+alertas
-- ---------------------------------------------------------------------------
create table if not exists public.animal_eventos (
  id             uuid primary key default gen_random_uuid(),
  lote_id        uuid not null references public.animal_lotes(id) on delete cascade,
  tipo           public.animal_evento_tipo not null default 'vacina',
  nome           text not null,                 -- "Brucelose", "Raiva", "Ivermectina"
  data_aplicacao date,                          -- quando foi aplicada (null = só agendada)
  proxima_data   date,                          -- próxima dose → calendário/alerta
  observacao     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_animal_eventos_lote on public.animal_eventos(lote_id);
create index if not exists idx_animal_eventos_proxima on public.animal_eventos(proxima_data);

drop trigger if exists tg_animal_eventos_updated_at on public.animal_eventos;
create trigger tg_animal_eventos_updated_at
  before update on public.animal_eventos
  for each row execute function public.tg_set_updated_at();

comment on table public.animal_eventos is
  'Vacinações/vermifugações por lote. proxima_data alimenta o calendário de vacinação e os alertas.';

-- ---------------------------------------------------------------------------
-- Ocorrências de saúde (histórico com severidade — "alerta amarelo/vermelho")
-- ---------------------------------------------------------------------------
create table if not exists public.animal_ocorrencias (
  id          uuid primary key default gen_random_uuid(),
  lote_id     uuid not null references public.animal_lotes(id) on delete cascade,
  data        date not null default current_date,
  descricao   text not null,                    -- "1 vaca com sinal de mastite"
  severidade  public.ocorrencia_severidade not null default 'info',
  resolvida   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_animal_ocorrencias_lote on public.animal_ocorrencias(lote_id);

drop trigger if exists tg_animal_ocorrencias_updated_at on public.animal_ocorrencias;
create trigger tg_animal_ocorrencias_updated_at
  before update on public.animal_ocorrencias
  for each row execute function public.tg_set_updated_at();

comment on table public.animal_ocorrencias is
  'Histórico de saúde por lote (campo de observação com severidade — call 14/jul).';

-- ---------------------------------------------------------------------------
-- RLS — leitura autenticada; espécies só admin; demais admin+editor
-- ---------------------------------------------------------------------------
alter table public.animal_especies    enable row level security;
alter table public.animal_lotes       enable row level security;
alter table public.animal_eventos     enable row level security;
alter table public.animal_ocorrencias enable row level security;

drop policy if exists animal_especies_read on public.animal_especies;
create policy animal_especies_read on public.animal_especies
  for select using (auth.uid() is not null);
drop policy if exists animal_especies_admin on public.animal_especies;
create policy animal_especies_admin on public.animal_especies
  for all using (public.fn_is_admin()) with check (public.fn_is_admin());

drop policy if exists animal_lotes_read on public.animal_lotes;
create policy animal_lotes_read on public.animal_lotes
  for select using (auth.uid() is not null);
drop policy if exists animal_lotes_write on public.animal_lotes;
create policy animal_lotes_write on public.animal_lotes
  for all using (public.fn_can_write()) with check (public.fn_can_write());

drop policy if exists animal_eventos_read on public.animal_eventos;
create policy animal_eventos_read on public.animal_eventos
  for select using (auth.uid() is not null);
drop policy if exists animal_eventos_write on public.animal_eventos;
create policy animal_eventos_write on public.animal_eventos
  for all using (public.fn_can_write()) with check (public.fn_can_write());

drop policy if exists animal_ocorrencias_read on public.animal_ocorrencias;
create policy animal_ocorrencias_read on public.animal_ocorrencias
  for select using (auth.uid() is not null);
drop policy if exists animal_ocorrencias_write on public.animal_ocorrencias;
create policy animal_ocorrencias_write on public.animal_ocorrencias
  for all using (public.fn_can_write()) with check (public.fn_can_write());
