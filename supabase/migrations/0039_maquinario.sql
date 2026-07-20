-- ============================================================================
-- 0039 — Estoque de Maquinário & Veículos (call de 14/jul/2026)
-- ============================================================================
-- Decisões do call:
--   • SEM valores financeiros (aquisição/manutenção) — máquinas antigas sem
--     avaliação; "aqui é mais um status de situação do maquinário".
--   • Status operacional: em operação, parado, em manutenção, estragou.
--   • Veículos (caminhonete) entram no mesmo cadastro, com documentação/
--     licenciamento (ex.: licenciamento em agosto) e avisos por data.
--   • Manutenções com data prevista → alertas ("período de manutenção,
--     deixar as datas ali para dar um alertazinho").
--   • medidor_atual guarda o último horímetro/KM conhecido — é atualizado
--     pelo fechamento de talão (migration 0041) e serve de sugestão para o
--     próximo uso.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'equipamento_tipo') then
    create type public.equipamento_tipo as enum ('trator','implemento','veiculo','outro');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'equipamento_status') then
    create type public.equipamento_status as enum ('em_operacao','parado','em_manutencao','estragou');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'medidor_tipo') then
    create type public.medidor_tipo as enum ('horimetro','km','nenhum');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'combustivel_tipo') then
    create type public.combustivel_tipo as enum ('diesel','gasolina','nenhum');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Equipamentos (máquinas, implementos e veículos)
-- ---------------------------------------------------------------------------
create table if not exists public.equipamentos (
  id            uuid primary key default gen_random_uuid(),
  codigo        text not null unique,               -- "TR-001"
  nome          text not null,                      -- "Trator CBT", "Caminhonete S10"
  tipo          public.equipamento_tipo not null default 'trator',
  marca_modelo  text,
  ano           int check (ano is null or ano between 1900 and 2100),
  medidor_tipo  public.medidor_tipo not null default 'horimetro',
  medidor_atual numeric(12,1),                      -- último horímetro/KM conhecido
  status        public.equipamento_status not null default 'em_operacao',
  localizacao   text,                               -- "Sede", "Galpão 2", "Oficina"
  combustivel   public.combustivel_tipo not null default 'diesel',
  observacoes   text,
  ativo         boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists tg_equipamentos_updated_at on public.equipamentos;
create trigger tg_equipamentos_updated_at
  before update on public.equipamentos
  for each row execute function public.tg_set_updated_at();

comment on table public.equipamentos is
  'Inventário de maquinário e veículos — status operacional, SEM valores financeiros (decisão do call 14/jul).';

-- ---------------------------------------------------------------------------
-- Manutenções (previstas e realizadas)
-- ---------------------------------------------------------------------------
create table if not exists public.equipamento_manutencoes (
  id               uuid primary key default gen_random_uuid(),
  equipamento_id   uuid not null references public.equipamentos(id) on delete cascade,
  descricao        text not null,                   -- "Troca de óleo", "Revisão geral"
  data_prevista    date,                            -- alerta por data
  medidor_previsto numeric(12,1),                   -- alerta por horímetro/KM (ex.: aos 2.900h)
  realizada_em     date,                            -- null = pendente
  observacao       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_eq_manut_equipamento on public.equipamento_manutencoes(equipamento_id);
create index if not exists idx_eq_manut_prevista on public.equipamento_manutencoes(data_prevista) where realizada_em is null;

drop trigger if exists tg_eq_manut_updated_at on public.equipamento_manutencoes;
create trigger tg_eq_manut_updated_at
  before update on public.equipamento_manutencoes
  for each row execute function public.tg_set_updated_at();

comment on table public.equipamento_manutencoes is
  'Manutenções por equipamento. realizada_em nulo = pendente → gera alerta por data_prevista/medidor_previsto.';

-- ---------------------------------------------------------------------------
-- Documentação (licenciamento, seguro — principalmente veículos)
-- ---------------------------------------------------------------------------
create table if not exists public.equipamento_documentos (
  id             uuid primary key default gen_random_uuid(),
  equipamento_id uuid not null references public.equipamentos(id) on delete cascade,
  tipo           text not null,                     -- "Licenciamento", "Seguro", "IPVA"
  descricao      text,
  vencimento     date not null,                     -- alerta por proximidade
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_eq_doc_equipamento on public.equipamento_documentos(equipamento_id);
create index if not exists idx_eq_doc_vencimento on public.equipamento_documentos(vencimento);

drop trigger if exists tg_eq_doc_updated_at on public.equipamento_documentos;
create trigger tg_eq_doc_updated_at
  before update on public.equipamento_documentos
  for each row execute function public.tg_set_updated_at();

comment on table public.equipamento_documentos is
  'Documentação com vencimento (licenciamento da caminhonete em agosto, etc.) → alertas.';

-- ---------------------------------------------------------------------------
-- RLS — leitura autenticada; escrita admin+editor
-- ---------------------------------------------------------------------------
alter table public.equipamentos            enable row level security;
alter table public.equipamento_manutencoes enable row level security;
alter table public.equipamento_documentos  enable row level security;

drop policy if exists equipamentos_read on public.equipamentos;
create policy equipamentos_read on public.equipamentos
  for select using (auth.uid() is not null);
drop policy if exists equipamentos_write on public.equipamentos;
create policy equipamentos_write on public.equipamentos
  for all using (public.fn_can_write()) with check (public.fn_can_write());

drop policy if exists eq_manut_read on public.equipamento_manutencoes;
create policy eq_manut_read on public.equipamento_manutencoes
  for select using (auth.uid() is not null);
drop policy if exists eq_manut_write on public.equipamento_manutencoes;
create policy eq_manut_write on public.equipamento_manutencoes
  for all using (public.fn_can_write()) with check (public.fn_can_write());

drop policy if exists eq_doc_read on public.equipamento_documentos;
create policy eq_doc_read on public.equipamento_documentos
  for select using (auth.uid() is not null);
drop policy if exists eq_doc_write on public.equipamento_documentos;
create policy eq_doc_write on public.equipamento_documentos
  for all using (public.fn_can_write()) with check (public.fn_can_write());
