-- ============================================================================
-- 0041 — Portal do Colaborador: colaboradores, talões e combustível
-- ============================================================================
-- Digitaliza as fichas de papel (call de 14/jul/2026):
--   • "Lista para Uso de Bens Agrop." (TRATOR / CAMINHONETE) → talao_usos
--   • "Consumo Combustível" (Tanque Diesel / Container Gasolina) → abastecimentos
--
-- Decisões do call:
--   • Identificação por CPF, SEM senha (fica salvo no celular do operador).
--     Trade-off de segurança aceito conscientemente na reunião.
--   • Admin PRÉ-CADASTRA os colaboradores; auto-solicitação fica como plano B
--     (status 'pendente' → admin aprova).
--   • Desligamento NÃO apaga: status 'desativado' preserva todo o histórico.
--   • KM/horímetro inicial é sugerido pelo sistema (último final). Se o
--     operador corrigir, a diferença fica registrada como DISCREPÂNCIA para
--     as meninas regularizarem ("foi meu pai, vai lá e registra").
--   • Reservatório fixo: entradas (compras) - abastecimentos = saldo.
--
-- SEGURANÇA: nenhuma policy para anon. O portal público acessa EXCLUSIVAMENTE
-- via route handlers server-side com service-role (validação por CPF).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'colaborador_status') then
    create type public.colaborador_status as enum ('ativo','pendente','desativado');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'talao_status') then
    create type public.talao_status as enum ('aberto','fechado');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'combustivel_fonte') then
    create type public.combustivel_fonte as enum ('tanque_diesel','container_gasolina','posto_externo');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Colaboradores (operadores de campo — NÃO são usuários do Supabase Auth)
-- ---------------------------------------------------------------------------
create table if not exists public.colaboradores (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  cpf           text not null unique check (cpf ~ '^[0-9]{11}$'),
  status        public.colaborador_status not null default 'ativo',
  desativado_em timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists tg_colaboradores_updated_at on public.colaboradores;
create trigger tg_colaboradores_updated_at
  before update on public.colaboradores
  for each row execute function public.tg_set_updated_at();

comment on table public.colaboradores is
  'Operadores de campo do Portal do Colaborador. Identificação por CPF sem senha (call 14/jul). Desativar preserva histórico.';

-- ---------------------------------------------------------------------------
-- Talões de uso (abre com KM/horímetro inicial, fecha com final)
-- ---------------------------------------------------------------------------
create table if not exists public.talao_usos (
  id                        uuid primary key default gen_random_uuid(),
  colaborador_id            uuid not null references public.colaboradores(id) on delete restrict,
  equipamento_id            uuid not null references public.equipamentos(id) on delete restrict,
  inicio_em                 timestamptz not null default now(),
  medidor_inicial           numeric(12,1) not null,
  medidor_inicial_sugerido  numeric(12,1),          -- o que o sistema sugeriu (último final)
  -- Discrepância = o quanto o operador corrigiu do valor sugerido.
  -- ≠ 0 → "alguém andou X km sem registrar" → alerta até ser regularizada.
  discrepancia              numeric(12,1) not null default 0,
  discrepancia_regularizada boolean not null default true,   -- sem discrepância = nada a regularizar
  regularizada_obs          text,
  fim_em                    timestamptz,
  medidor_final             numeric(12,1) check (medidor_final is null or medidor_final >= medidor_inicial),
  equipamento_seguranca     boolean,
  observacoes               text,
  defeitos                  text,                   -- responsabiliza o usuário anterior
  status                    public.talao_status not null default 'aberto',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists idx_talao_colaborador on public.talao_usos(colaborador_id);
create index if not exists idx_talao_equipamento on public.talao_usos(equipamento_id);
create index if not exists idx_talao_aberto on public.talao_usos(equipamento_id) where status = 'aberto';

drop trigger if exists tg_talao_usos_updated_at on public.talao_usos;
create trigger tg_talao_usos_updated_at
  before update on public.talao_usos
  for each row execute function public.tg_set_updated_at();

comment on table public.talao_usos is
  'Fichas digitais de uso de bens (trator/caminhonete). KM inicial sugerido pelo último final; discrepância registrada e regularizável.';

-- Fechou o talão → equipamento.medidor_atual acompanha o medidor_final.
create or replace function public.tg_talao_atualiza_medidor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.medidor_final is not null and new.status = 'fechado' then
    update public.equipamentos
       set medidor_atual = new.medidor_final
     where id = new.equipamento_id
       and (medidor_atual is null or medidor_atual < new.medidor_final);
  end if;
  return new;
end;
$$;

drop trigger if exists tg_talao_medidor on public.talao_usos;
create trigger tg_talao_medidor
  after insert or update on public.talao_usos
  for each row execute function public.tg_talao_atualiza_medidor();

-- ---------------------------------------------------------------------------
-- Abastecimentos (fichas "Consumo Combustível")
-- ---------------------------------------------------------------------------
create table if not exists public.abastecimentos (
  id              uuid primary key default gen_random_uuid(),
  colaborador_id  uuid not null references public.colaboradores(id) on delete restrict,
  equipamento_id  uuid references public.equipamentos(id) on delete set null,
  fonte           public.combustivel_fonte not null,
  data            timestamptz not null default now(),
  medidor_inicial numeric(12,1),                    -- medidor da bomba/reservatório
  medidor_final   numeric(12,1),
  litros          numeric(8,1) not null check (litros > 0),
  observacao      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_abast_colaborador on public.abastecimentos(colaborador_id);
create index if not exists idx_abast_fonte on public.abastecimentos(fonte);
create index if not exists idx_abast_data on public.abastecimentos(data);

drop trigger if exists tg_abastecimentos_updated_at on public.abastecimentos;
create trigger tg_abastecimentos_updated_at
  before update on public.abastecimentos
  for each row execute function public.tg_set_updated_at();

comment on table public.abastecimentos is
  'Retiradas de combustível do tanque de diesel / container de gasolina por equipamento.';

-- ---------------------------------------------------------------------------
-- Entradas de combustível nos reservatórios (compras/recargas)
-- ---------------------------------------------------------------------------
create table if not exists public.reservatorio_entradas (
  id          uuid primary key default gen_random_uuid(),
  fonte       public.combustivel_fonte not null,
  data        date not null default current_date,
  litros      numeric(8,1) not null check (litros > 0),
  observacao  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists tg_reserv_entradas_updated_at on public.reservatorio_entradas;
create trigger tg_reserv_entradas_updated_at
  before update on public.reservatorio_entradas
  for each row execute function public.tg_set_updated_at();

comment on table public.reservatorio_entradas is
  'Compras/recargas dos reservatórios fixos. Saldo = entradas - abastecimentos da fonte.';

-- ---------------------------------------------------------------------------
-- RLS — dashboard lê tudo; escrita admin/editor. Portal público NÃO tem
-- policy (acessa via service-role nos route handlers).
-- ---------------------------------------------------------------------------
alter table public.colaboradores         enable row level security;
alter table public.talao_usos            enable row level security;
alter table public.abastecimentos        enable row level security;
alter table public.reservatorio_entradas enable row level security;

drop policy if exists colaboradores_read on public.colaboradores;
create policy colaboradores_read on public.colaboradores
  for select using (auth.uid() is not null);
drop policy if exists colaboradores_admin on public.colaboradores;
create policy colaboradores_admin on public.colaboradores
  for all using (public.fn_is_admin()) with check (public.fn_is_admin());

drop policy if exists talao_usos_read on public.talao_usos;
create policy talao_usos_read on public.talao_usos
  for select using (auth.uid() is not null);
drop policy if exists talao_usos_write on public.talao_usos;
create policy talao_usos_write on public.talao_usos
  for all using (public.fn_can_write()) with check (public.fn_can_write());

drop policy if exists abastecimentos_read on public.abastecimentos;
create policy abastecimentos_read on public.abastecimentos
  for select using (auth.uid() is not null);
drop policy if exists abastecimentos_write on public.abastecimentos;
create policy abastecimentos_write on public.abastecimentos
  for all using (public.fn_can_write()) with check (public.fn_can_write());

drop policy if exists reserv_entradas_read on public.reservatorio_entradas;
create policy reserv_entradas_read on public.reservatorio_entradas
  for select using (auth.uid() is not null);
drop policy if exists reserv_entradas_write on public.reservatorio_entradas;
create policy reserv_entradas_write on public.reservatorio_entradas
  for all using (public.fn_can_write()) with check (public.fn_can_write());
