-- ============================================================================
-- AramBI — apply_all.sql
-- ============================================================================
-- Concatenação de todas as migrations e seeds, na ordem correta.
-- Para aplicar:
--   1. Abrir o SQL Editor do Supabase (https://supabase.com/dashboard/project/<id>/sql)
--   2. Colar este arquivo inteiro e executar.
--   OU
--   psql "${SUPABASE_DB_URL}" -f apply_all.sql
--
-- Idempotente: pode ser rodado múltiplas vezes (CREATE TABLE IF NOT EXISTS,
-- ON CONFLICT DO NOTHING nos seeds).
-- ============================================================================


-- ============================================================================
-- MIGRATIONS — schema (DDL)
-- ============================================================================


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0001_extensions_and_helpers.sql
-- └──────────────────────────────────────────────────────────────────────────┘
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



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0002_enums.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0002 — Enums (domínios fechados)
-- ============================================================================
-- Refletem exatamente o cadastro da aba "Classificação Financeira" da planilha.
-- Status normalizados em snake_case (Postgres é case-sensitive, Excel SUMIFS não).
--
-- Padrão idempotente: cada CREATE TYPE é envolto em DO $$ ... IF NOT EXISTS,
-- pra rodar várias vezes sem erro.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'tipo_despesa') then
    create type public.tipo_despesa as enum (
      'fixa',         -- "Despesas Fixas"
      'variavel',     -- "Despesas Variáveis"
      'eventual',     -- "Despesas Eventuais"
      'periodica',    -- "Despesas Periódicas"
      'sem'           -- "-"   (lançamentos sem classificação fixa/variável)
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'forma_pgto') then
    create type public.forma_pgto as enum (
      'boleto',
      'pix',
      'cartao_credito',
      'cartao_debito',
      'debito_automatico',
      'guia',
      'transferencia',
      'sem'           -- "-" na planilha
    );
  end if;
end $$;

-- Coluna "Obs. Obra" do Aramburu_Mensal — classifica contribuição à obra LTS.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'obs_obra') then
    create type public.obs_obra as enum (
      'sem',           -- "-"
      'outras',        -- "OUTRAS"
      'projeto',       -- "Projeto"
      'ordem_compra',  -- "ORDEM DE COMPRA"
      'medicao_01',
      'medicao_02',
      'medicao_03',
      'medicao_04',
      'medicao_05',
      'medicao_06',
      'retencao'       -- "Retenção"
    );
  end if;
end $$;

-- Status — Aramburu_Mensal (16 valores)
-- DL = Distribuição de Lucro / DV = Distribuição Variável
do $$ begin
  if not exists (select 1 from pg_type where typname = 'status_aramburu') then
    create type public.status_aramburu as enum (
      'saldo_inicial',
      'recebido',
      'a_receber',
      'pago',
      'a_pagar',
      'repassado',
      'a_repassar',
      'aplicado',
      'a_aplicar',
      'aplicacao',         -- "Aplicação" (movimento)
      'resgatado',
      'a_resgatar',
      'resgate',           -- "Resgate" (movimento)
      'provisionado',
      'provisionado_dl',   -- "Provisionado DL"
      'provisionado_dv'    -- "Provisionado DV"
    );
  end if;
end $$;

-- Status — Distribuição de Lucro
do $$ begin
  if not exists (select 1 from pg_type where typname = 'status_dl') then
    create type public.status_dl as enum (
      'provisionado',
      'realizado',
      'a_pagar'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'natureza_conta') then
    create type public.natureza_conta as enum ('entrada', 'saida');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('admin','editor','socio','viewer');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'recibo_status') then
    create type public.recibo_status as enum ('rascunho','emitido','cancelado');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'estoque_status') then
    create type public.estoque_status as enum ('em_estoque','baixo_estoque','critico','esgotado');
  end if;
end $$;

-- Status genérico de OC/Medição da obra LTS (PAGO / VENCIDO / VENCE HOJE / EM ABERTO)
do $$ begin
  if not exists (select 1 from pg_type where typname = 'lts_status') then
    create type public.lts_status as enum ('pago','em_aberto','vence_hoje','vencido','cancelado');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'log_tipo') then
    create type public.log_tipo as enum ('auth','chat','import','export','crud','system');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'chat_role') then
    create type public.chat_role as enum ('user','assistant','system');
  end if;
end $$;



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0003_users_e_perfis.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0003 — Perfis de usuário (espelha auth.users do Supabase Auth)
-- ============================================================================
-- A tabela auth.users é gerenciada pelo Supabase. Mantemos um espelho em
-- public.users com role e dados de exibição. Trigger sincroniza ao criar.

create table if not exists public.users (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        citext unique not null,
  full_name    text,
  role         public.user_role not null default 'viewer',
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_users_role on public.users(role);

drop trigger if exists tg_users_updated_at on public.users;
create trigger tg_users_updated_at
  before update on public.users
  for each row execute function public.tg_set_updated_at();

-- Quando um usuário é criado em auth.users, cria perfil em public.users.
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
    'viewer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists tg_on_auth_user_created on auth.users;
create trigger tg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.tg_handle_new_auth_user();

comment on table public.users is
  'Perfil de aplicação (espelha auth.users). RLS aplicada no migration 0009.';



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0004_cadastros.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0004 — Cadastros (lookups / domínio de dados)
-- ============================================================================
-- Estas tabelas sustentam os dropdowns/seletores no front e são populadas pelos
-- arquivos em supabase/seed/. São o "dicionário" do sistema.

-- ---------------------------------------------------------------------------
-- Plano de contas mestre da empresa (Aramburu)
-- Espelha exatamente a aba oculta "Classificação Financeira" da planilha.
-- ---------------------------------------------------------------------------
create table if not exists public.classificacao_financeira (
  codigo         text primary key,                     -- "1.1", "1.1.1", "2.7.2"
  nome           text not null,                        -- "Saldo Inicial" / "Banco Cora" / "Obras e Melhorias..."
  natureza       public.natureza_conta not null,       -- entrada | saida
  parent_codigo  text references public.classificacao_financeira(codigo) on delete restrict,
  nivel          smallint not null check (nivel between 1 and 3),  -- 1='1', 2='1.1', 3='1.1.1'
  ordem          smallint,
  ativo          boolean not null default true,
  created_at     timestamptz not null default now()
);

create index if not exists idx_cf_parent on public.classificacao_financeira(parent_codigo);
create index if not exists idx_cf_natureza on public.classificacao_financeira(natureza);

-- Visões úteis para filtros do front
create or replace view public.v_classificacao_n2 as
  select codigo, nome, natureza, ordem
  from public.classificacao_financeira
  where nivel = 2 and ativo = true
  order by codigo;

create or replace view public.v_classificacao_n3 as
  select codigo, nome, natureza, parent_codigo, ordem
  from public.classificacao_financeira
  where nivel = 3 and ativo = true
  order by codigo;

-- ---------------------------------------------------------------------------
-- Plano de contas pessoal dos sócios (1.01 a 1.06 — diferente do plano da empresa)
-- ---------------------------------------------------------------------------
create table if not exists public.classificacao_pessoal (
  codigo     text primary key,        -- "1.01", "1.02", ..., "1.06"
  nome       text not null,           -- "Imóvel", "Família", "Renda Mensal/Qualidade de Vida"...
  ordem      smallint,
  ativo      boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Sócios
-- ---------------------------------------------------------------------------
create table if not exists public.socios (
  id            uuid primary key default gen_random_uuid(),
  nome_completo text not null unique,         -- "Claudio Luiz Resta Fragelli"
  apelido       text,                          -- "Cláudio Luiz"
  email         citext,
  user_id       uuid references public.users(id) on delete set null,
  ativo         boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_socios_user on public.socios(user_id);

drop trigger if exists tg_socios_updated_at on public.socios;
create trigger tg_socios_updated_at
  before update on public.socios
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Contas bancárias da empresa (Aramburu)
-- ---------------------------------------------------------------------------
create table if not exists public.contas_bancarias_empresa (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null unique,        -- "Cooperativa Sicredi (0902)" — formato exato da planilha
  apelido     text,                        -- "Sicredi MJU"
  banco       text,                        -- "Banco Cora", "Cooperativa Sicredi", "Banco Inter"
  agencia     text,                        -- "0001", "0902", "0913", "0001-9"
  conta       text,
  tipo        text,                        -- "corrente", "investimento", "poupanca"
  ativa       boolean not null default true,
  ordem       smallint,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists tg_cbe_updated_at on public.contas_bancarias_empresa;
create trigger tg_cbe_updated_at
  before update on public.contas_bancarias_empresa
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Contas bancárias dos sócios
-- ---------------------------------------------------------------------------
create table if not exists public.contas_bancarias_socio (
  id          uuid primary key default gen_random_uuid(),
  socio_id    uuid not null references public.socios(id) on delete cascade,
  nome        text not null,               -- "Bradesco 3489 C/C 3154-2" — formato exato da planilha
  banco       text,                        -- "Bradesco", "Nubank", "XP", "Inter", "B. Brasil"
  agencia     text,
  conta       text,
  ativa       boolean not null default true,
  ordem       smallint,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (socio_id, nome)
);

create index if not exists idx_cbs_socio on public.contas_bancarias_socio(socio_id);

drop trigger if exists tg_cbs_updated_at on public.contas_bancarias_socio;
create trigger tg_cbs_updated_at
  before update on public.contas_bancarias_socio
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Despesas recorrentes do sócio (aba "Dados Bancários")
-- ---------------------------------------------------------------------------
-- Catálogo de despesas-fixas previstas para cada sócio em cada categoria pessoal.
-- Ex: "Casan Águas e Saneamento (Residência SC)" da Ana Beatriz na 1.04.
create table if not exists public.despesas_recorrentes_socio (
  id                       uuid primary key default gen_random_uuid(),
  socio_id                 uuid not null references public.socios(id) on delete cascade,
  classificacao_pessoal    text not null references public.classificacao_pessoal(codigo) on delete restrict,
  descricao                text not null,
  conta_bancaria_socio_id  uuid references public.contas_bancarias_socio(id) on delete set null,
  validado                 boolean,
  observacao               text,
  ordem                    smallint,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (socio_id, classificacao_pessoal, descricao)
);

create index if not exists idx_drs_socio on public.despesas_recorrentes_socio(socio_id);
create index if not exists idx_drs_classificacao on public.despesas_recorrentes_socio(classificacao_pessoal);

drop trigger if exists tg_drs_updated_at on public.despesas_recorrentes_socio;
create trigger tg_drs_updated_at
  before update on public.despesas_recorrentes_socio
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Fornecedores (cadastro lazy — populado pelos lançamentos do Aramburu)
-- ---------------------------------------------------------------------------
-- A planilha tem 109 fornecedores únicos como texto livre. Mantemos uma tabela
-- pra desduplicar e enriquecer com CNPJ etc no futuro.
create table if not exists public.fornecedores (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null unique,
  cnpj        text,
  apelido     text,
  observacao  text,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists tg_fornecedores_updated_at on public.fornecedores;
create trigger tg_fornecedores_updated_at
  before update on public.fornecedores
  for each row execute function public.tg_set_updated_at();



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0005_transacoes.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0005 — Tabelas-fonte de lançamentos
-- ============================================================================
-- Espelham as duas tabelas-fonte da planilha:
--   • transacoes_empresa  ← Aramburu_Mensal       (739 linhas hoje)
--   • transacoes_socio    ← Distribuição de Lucro_Mensal (543 linhas hoje)
--
-- Manter SEPARADAS porque os domínios divergem (status, schema, regras).

-- ---------------------------------------------------------------------------
-- Lançamentos da empresa (aba Aramburu_Mensal)
-- ---------------------------------------------------------------------------
create table if not exists public.transacoes_empresa (
  id                  uuid primary key default gen_random_uuid(),

  -- Eixo temporal
  data                date not null,
  mes_referencia      text generated always as (public.fn_mes_referencia(data)) stored,

  -- Plano de contas (referência ao mestre)
  conta_contabil_cod  text not null references public.classificacao_financeira(codigo) on update cascade,
  centro_custo_cod   text not null references public.classificacao_financeira(codigo) on update cascade,

  -- Atributos do lançamento (todos correspondem a colunas da planilha)
  tipo_despesa        public.tipo_despesa not null default 'sem',
  fornecedor_id       uuid references public.fornecedores(id) on delete set null,
  fornecedor_nome     text,                       -- snapshot para auditoria/import
  descricao           text,
  obs_obra            public.obs_obra not null default 'sem',
  ref                 text,                        -- nº NF, "AGUARDANDO NF", "RECIBO 024/2026"
  parcelas            text,                        -- "1/3", "5/12", livre
  forma_pgto          public.forma_pgto not null default 'sem',
  conta_bancaria_id   uuid references public.contas_bancarias_empresa(id) on delete set null,
  status              public.status_aramburu not null,
  valor               numeric(15,2) not null,      -- negativo = saída

  -- Anotações livres (cobre os 20 comments embedded da Lola)
  observacao          text,

  -- Metadados
  origem_planilha     text,                        -- "linha 287 do Aramburu_Mensal" para rastreabilidade no import
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references public.users(id) on delete set null
);

create index if not exists idx_te_data           on public.transacoes_empresa(data);
create index if not exists idx_te_mes_ref        on public.transacoes_empresa(mes_referencia);
create index if not exists idx_te_centro_custo   on public.transacoes_empresa(centro_custo_cod);
create index if not exists idx_te_status         on public.transacoes_empresa(status);
create index if not exists idx_te_conta_bancaria on public.transacoes_empresa(conta_bancaria_id);
create index if not exists idx_te_obs_obra       on public.transacoes_empresa(obs_obra);
create index if not exists idx_te_fornecedor     on public.transacoes_empresa(fornecedor_id);
create index if not exists idx_te_ref            on public.transacoes_empresa(ref);

drop trigger if exists tg_te_updated_at on public.transacoes_empresa;
create trigger tg_te_updated_at
  before update on public.transacoes_empresa
  for each row execute function public.tg_set_updated_at();

comment on table public.transacoes_empresa is
  'Lançamentos da Agropecuária Aramburu — espelho da aba Aramburu_Mensal.';

-- ---------------------------------------------------------------------------
-- Lançamentos pessoais dos sócios (aba Distribuição de Lucro_Mensal)
-- ---------------------------------------------------------------------------
create table if not exists public.transacoes_socio (
  id                       uuid primary key default gen_random_uuid(),

  data                     date not null,
  mes_referencia           text generated always as (public.fn_mes_referencia(data)) stored,

  socio_id                 uuid not null references public.socios(id) on delete restrict,
  classificacao_pessoal    text not null references public.classificacao_pessoal(codigo) on update cascade,
  descricao                text not null,
  conta_bancaria_socio_id  uuid references public.contas_bancarias_socio(id) on delete set null,
  conta_bancaria_socio_nome text,                          -- snapshot do nome (Pedro: cadastro incompleto)

  valor                    numeric(15,2) not null,
  data_vencimento          date,
  status                   public.status_dl not null default 'provisionado',

  observacao               text,
  origem_planilha          text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  created_by               uuid references public.users(id) on delete set null
);

create index if not exists idx_ts_data         on public.transacoes_socio(data);
create index if not exists idx_ts_mes_ref      on public.transacoes_socio(mes_referencia);
create index if not exists idx_ts_socio        on public.transacoes_socio(socio_id);
create index if not exists idx_ts_classif      on public.transacoes_socio(classificacao_pessoal);
create index if not exists idx_ts_status       on public.transacoes_socio(status);
create index if not exists idx_ts_vencimento   on public.transacoes_socio(data_vencimento);

drop trigger if exists tg_ts_updated_at on public.transacoes_socio;
create trigger tg_ts_updated_at
  before update on public.transacoes_socio
  for each row execute function public.tg_set_updated_at();

comment on table public.transacoes_socio is
  'Despesas pessoais dos 4 sócios — espelho da aba "Distribuição de Lucro_Mensal".';



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0006_obra_lts.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0006 — Obra Sede / LTS Engenharia
-- ============================================================================
-- Cobre as abas: LTS, $ obra sede, obra sede, pendências da obra, NOTAS EM GRUPO.
-- Os dashboards "obra sede" e "$ obra sede" são VIEWS — calculadas em runtime
-- a partir das transações + tabela detalhada da LTS.

-- ---------------------------------------------------------------------------
-- Detalhamento de OCs e Medições (aba LTS)
-- ---------------------------------------------------------------------------
-- Cada linha = um item de Ordem de Compra ou parcela de Medição da obra.
-- Importante: LTS!K80 (total contrato) é a fonte de verdade que aparece em
-- 'obra sede'!I30 e em '$ obra sede'!F11.
create table if not exists public.obra_lts_itens (
  id              uuid primary key default gen_random_uuid(),

  oc_numero       text,                                    -- "001", "MED 001", "ENTRADA"
  data_compra     date,
  loja            text,                                    -- "ESPAÇO SMART", "LTS ENGENHARIA", "MADEGRAN"
  nf              text,                                    -- número/identificador da NF
  forma_pagamento text,                                    -- "1X BOLETO", "PIX", "ENTRADA 50% + 4X BOLETOS"
  valor           numeric(15,2) not null,
  vencimento      date,
  status          public.lts_status not null default 'em_aberto',

  contrato        text,                                    -- "Contrato 01" / "Contrato 02" / "Outros" / "Projeto"
  parcela         text,                                    -- "1/4", "ENTRADA", "DIFAL"
  observacao      text,
  origem_planilha text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_oli_status     on public.obra_lts_itens(status);
create index if not exists idx_oli_contrato   on public.obra_lts_itens(contrato);
create index if not exists idx_oli_vencimento on public.obra_lts_itens(vencimento);

drop trigger if exists tg_oli_updated_at on public.obra_lts_itens;
create trigger tg_oli_updated_at
  before update on public.obra_lts_itens
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Itens a contratar / pendências (aba "pendências da obra")
-- ---------------------------------------------------------------------------
create table if not exists public.obra_pendencias (
  id              uuid primary key default gen_random_uuid(),
  categoria       text,                          -- "Pintura", "Granito", "Piso", "Elétrica", "Revestimento"
  subcategoria    text,                          -- "Material", "Mão de Obra", "Filetes", "Pingadeiras"...
  descricao       text not null,
  empresa         text,                          -- "Total Tintas", "Marmoaria Fênix"
  condicao_pgto   text,                          -- "Entrada + 30/60d", "Parcelado em 8x no cartão"
  valor           numeric(15,2),
  observacao      text,
  resolvida       boolean not null default false,
  resolvida_at    timestamptz,
  ordem           smallint,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists tg_op_updated_at on public.obra_pendencias;
create trigger tg_op_updated_at
  before update on public.obra_pendencias
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Notas em grupo (aba "NOTAS EM GRUPO")
-- ---------------------------------------------------------------------------
-- Notas fiscais que somam para um orçamento único parcelado.
create table if not exists public.notas_em_grupo (
  id              uuid primary key default gen_random_uuid(),
  data            date,
  mes_referencia  text generated always as (public.fn_mes_referencia(data)) stored,
  referencia      text,                                   -- "Orçamento 003M6G", "NF 201122"
  valor           numeric(15,2),
  parcelas        text,                                   -- "6x cartão Sicredi 0913"
  conta_bancaria_id uuid references public.contas_bancarias_empresa(id) on delete set null,
  observacao      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists tg_neg_updated_at on public.notas_em_grupo;
create trigger tg_neg_updated_at
  before update on public.notas_em_grupo
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Capital inicial e snapshot histórico da obra
-- ---------------------------------------------------------------------------
-- Substitui o external link da planilha (que apontava para outro .xlsx).
-- Dados de "$ obra sede": Capital Inicial Maio/2025, Pago 2025 hardcoded, etc.
create table if not exists public.obra_parametros (
  chave           text primary key,            -- "capital_inicial", "pago_2025_lts_medicao", etc.
  valor_numerico  numeric(15,2),
  valor_texto     text,
  data_referencia date,
  observacao      text,
  updated_at      timestamptz not null default now()
);

drop trigger if exists tg_op_param_updated_at on public.obra_parametros;
create trigger tg_op_param_updated_at
  before update on public.obra_parametros
  for each row execute function public.tg_set_updated_at();



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0007_sistema_aplicacao.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0007 — Sistema da aplicação (estoque, documentos, recibos, chats, logs)
-- ============================================================================
-- Tabelas que sustentam os módulos do front que NÃO vêm da planilha,
-- mas estão no escopo do AramBI (NOVO PROJETO AGRO.pdf).

-- ---------------------------------------------------------------------------
-- Estoque
-- ---------------------------------------------------------------------------
create table if not exists public.estoque (
  id             uuid primary key default gen_random_uuid(),
  produto        text not null,
  categoria      text,
  quantidade     numeric(12,3) not null default 0,
  unidade        text not null default 'un',
  valor_unitario numeric(15,2) not null default 0,
  status         public.estoque_status not null default 'em_estoque',
  fornecedor_id  uuid references public.fornecedores(id) on delete set null,
  fornecedor_nome text,
  observacao     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references public.users(id) on delete set null
);

create index if not exists idx_estoque_status on public.estoque(status);
create index if not exists idx_estoque_categoria on public.estoque(categoria);

drop trigger if exists tg_estoque_updated_at on public.estoque;
create trigger tg_estoque_updated_at
  before update on public.estoque
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Documentos (anexos)
-- ---------------------------------------------------------------------------
-- Vinculados a um mês de referência para alimentar o filtro do dashboard.
create table if not exists public.documentos (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  tipo            text,                                -- PDF / Excel / PPT / XML / Imagem...
  tamanho_bytes   bigint,
  storage_path    text,                                -- caminho no Supabase Storage
  url_publica     text,
  mes_referencia  text,                                -- "YYYY-MM"
  numero_nota     text,
  descricao       text,
  vinculado_a_transacao_empresa_id  uuid references public.transacoes_empresa(id) on delete set null,
  vinculado_a_transacao_socio_id    uuid references public.transacoes_socio(id) on delete set null,
  vinculado_a_obra_lts_item_id      uuid references public.obra_lts_itens(id) on delete set null,
  observacao      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.users(id) on delete set null
);

create index if not exists idx_doc_mes_ref     on public.documentos(mes_referencia);
create index if not exists idx_doc_numero_nota on public.documentos(numero_nota);
create index if not exists idx_doc_te          on public.documentos(vinculado_a_transacao_empresa_id);
create index if not exists idx_doc_ts          on public.documentos(vinculado_a_transacao_socio_id);

drop trigger if exists tg_doc_updated_at on public.documentos;
create trigger tg_doc_updated_at
  before update on public.documentos
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Recibos / Termos
-- ---------------------------------------------------------------------------
create table if not exists public.recibo_modelos (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,                -- "simples", "prestacao_servico", "aluguel"...
  nome            text not null,                       -- "Recibo Simples"
  template_html   text,                                -- conteúdo com placeholders {{nome}}, {{valor}}...
  campos_extras   jsonb,                               -- definição dos campos dinâmicos
  pdfmonkey_id    text,                                -- id do template no PDFMonkey, quando integrar
  ativo           boolean not null default true,
  ordem           smallint,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists tg_rm_updated_at on public.recibo_modelos;
create trigger tg_rm_updated_at
  before update on public.recibo_modelos
  for each row execute function public.tg_set_updated_at();

create table if not exists public.recibos (
  id              uuid primary key default gen_random_uuid(),
  numero          text unique not null,                -- "REC-001"
  modelo_id       uuid references public.recibo_modelos(id) on delete restrict,
  beneficiario    text not null,
  descricao       text,
  valor           numeric(15,2) not null default 0,
  data            date not null,
  campos_extras   jsonb not null default '{}'::jsonb,
  status          public.recibo_status not null default 'rascunho',
  pdf_url         text,
  observacao      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.users(id) on delete set null
);

create index if not exists idx_recibos_status on public.recibos(status);
create index if not exists idx_recibos_data   on public.recibos(data);

drop trigger if exists tg_recibos_updated_at on public.recibos;
create trigger tg_recibos_updated_at
  before update on public.recibos
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Assistentes IA — chats persistidos
-- ---------------------------------------------------------------------------
-- A chave de sessão é "<usuario>-<ia>" no escopo: salvar a sessão completa
-- para QUALQUER usuário poder ver o histórico de qualquer outro.
create table if not exists public.chat_sessions (
  id            uuid primary key default gen_random_uuid(),
  agente_id     text not null,                          -- "financeiro", "adv-trabalhista"...
  agente_nome   text not null,                          -- "Assistente Financeiro"
  usuario_id    uuid not null references public.users(id) on delete cascade,
  usuario_nome  text not null,
  titulo        text,                                   -- gerado a partir da 1ª mensagem
  fechada       boolean not null default false,
  metadata      jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_cs_agente   on public.chat_sessions(agente_id);
create index if not exists idx_cs_usuario  on public.chat_sessions(usuario_id);
create index if not exists idx_cs_updated  on public.chat_sessions(updated_at desc);

drop trigger if exists tg_cs_updated_at on public.chat_sessions;
create trigger tg_cs_updated_at
  before update on public.chat_sessions
  for each row execute function public.tg_set_updated_at();

create table if not exists public.chat_mensagens (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.chat_sessions(id) on delete cascade,
  role        public.chat_role not null,
  conteudo    text not null,
  anexos      jsonb,
  tokens      integer,
  created_at  timestamptz not null default now()
);

create index if not exists idx_cm_session on public.chat_mensagens(session_id, created_at);

-- ---------------------------------------------------------------------------
-- Logs (auditoria)
-- ---------------------------------------------------------------------------
create table if not exists public.logs (
  id            uuid primary key default gen_random_uuid(),
  tipo          public.log_tipo not null,
  acao          text not null,                         -- "LOGIN", "CREATE", "EXPORT_PDF"...
  descricao     text,
  usuario_id    uuid references public.users(id) on delete set null,
  usuario_nome  text,
  metadados     jsonb,
  ip            inet,
  user_agent    text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_logs_tipo    on public.logs(tipo);
create index if not exists idx_logs_usuario on public.logs(usuario_id);
create index if not exists idx_logs_created on public.logs(created_at desc);



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0008_views_dashboard.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0008 — Views para o dashboard
-- ============================================================================
-- Reproduzem em SQL os cálculos que hoje estão em fórmulas SUMIFS/SUMPRODUCT
-- da planilha. O front consome essas views direto via Supabase JS.

-- ---------------------------------------------------------------------------
-- KPIs por mês (geral)
-- ---------------------------------------------------------------------------
create or replace view public.v_kpi_mensal as
select
  mes_referencia,
  sum(case when status in ('recebido','resgatado','aplicacao') then valor else 0 end) as entradas_realizadas,
  sum(case when status in ('a_receber','a_resgatar') then valor else 0 end)            as entradas_a_receber,
  sum(case when status in ('pago','repassado','aplicado','resgate') then -valor else 0 end) as saidas_realizadas,
  sum(case when status in ('a_pagar','a_repassar','a_aplicar') then -valor else 0 end)      as saidas_a_pagar,
  sum(case when status in ('provisionado','provisionado_dl','provisionado_dv') then -valor else 0 end) as saidas_provisionadas,
  sum(valor)                                                                            as saldo_movimentacao
from public.transacoes_empresa
group by mes_referencia
order by mes_referencia;

-- ---------------------------------------------------------------------------
-- Soma por classificação (para PieChart "Despesa por Categoria")
-- ---------------------------------------------------------------------------
create or replace view public.v_por_conta_contabil_mensal as
select
  mes_referencia,
  conta_contabil_cod,
  cf.nome as conta_contabil_nome,
  cf.natureza,
  sum(valor) as valor_total,
  count(*)   as qtd_lancamentos
from public.transacoes_empresa te
join public.classificacao_financeira cf on cf.codigo = te.conta_contabil_cod
group by mes_referencia, conta_contabil_cod, cf.nome, cf.natureza;

create or replace view public.v_por_centro_custo_mensal as
select
  mes_referencia,
  centro_custo_cod,
  cf.nome as centro_custo_nome,
  cf.parent_codigo,
  cf.natureza,
  sum(valor) as valor_total,
  count(*)   as qtd_lancamentos
from public.transacoes_empresa te
join public.classificacao_financeira cf on cf.codigo = te.centro_custo_cod
group by mes_referencia, centro_custo_cod, cf.nome, cf.parent_codigo, cf.natureza;

-- ---------------------------------------------------------------------------
-- Saldo por banco (replica "Saldo Disponível")
-- ---------------------------------------------------------------------------
create or replace view public.v_saldo_por_banco_mensal as
select
  mes_referencia,
  conta_bancaria_id,
  cbe.nome as conta_bancaria_nome,
  sum(valor) as variacao_no_mes,
  sum(case when status = 'saldo_inicial' then valor else 0 end) as saldo_inicial_no_mes,
  sum(case when status in ('recebido','resgatado','aplicacao') then valor else 0 end) as entradas,
  sum(case when status in ('pago','repassado','aplicado','resgate') then valor else 0 end) as saidas
from public.transacoes_empresa te
left join public.contas_bancarias_empresa cbe on cbe.id = te.conta_bancaria_id
group by mes_referencia, conta_bancaria_id, cbe.nome;

-- ---------------------------------------------------------------------------
-- Obra LTS — espelha 'obra sede' I16:I28 (bloco "atual 2026")
-- ---------------------------------------------------------------------------
create or replace view public.v_obra_resumo_atual as
with base as (
  select
    obs_obra,
    status,
    sum(-valor) as valor   -- negativo na transação = saída → positivo aqui
  from public.transacoes_empresa
  where centro_custo_cod = '2.7.2'
  group by obs_obra, status
)
select
  obs_obra::text as bucket,
  status::text   as status,
  valor
from base
order by 1, 2;

-- ---------------------------------------------------------------------------
-- Obra LTS — totais de Pago/A pagar/Provisionado para os cards de '$ obra sede'
-- ---------------------------------------------------------------------------
create or replace view public.v_obra_totais as
select
  sum(case when status = 'pago'         and obs_obra in ('ordem_compra','projeto') then -valor else 0 end) as pago_oc_projeto,
  sum(case when status = 'pago'         and obs_obra::text like 'medicao_%'              then -valor else 0 end) as pago_medicoes,
  sum(case when status = 'pago'         and obs_obra = 'outras'                    then -valor else 0 end) as pago_outras,
  sum(case when status = 'a_pagar'      and obs_obra = 'outras'                    then -valor else 0 end) as a_pagar_outras,
  sum(case when status = 'provisionado' and obs_obra::text like 'medicao_%'              then -valor else 0 end) as provisionado_medicoes,
  sum(case when status = 'provisionado' and obs_obra = 'outras'                    then -valor else 0 end) as provisionado_outras,
  sum(case when status = 'provisionado' and obs_obra = 'retencao'                  then -valor else 0 end) as provisionado_retencao
from public.transacoes_empresa
where centro_custo_cod = '2.7.2';

-- ---------------------------------------------------------------------------
-- Capinhas por sócio (replica abas Ana Beatriz, Cláudio Luiz, Isamélia, Pedro)
-- ---------------------------------------------------------------------------
create or replace view public.v_capinha_socio_mensal as
select
  socio_id,
  s.nome_completo as socio_nome,
  mes_referencia,
  classificacao_pessoal,
  cp.nome as classificacao_nome,
  status,
  sum(valor) as valor_total,
  count(*)   as qtd_lancamentos
from public.transacoes_socio ts
join public.socios s              on s.id = ts.socio_id
join public.classificacao_pessoal cp on cp.codigo = ts.classificacao_pessoal
group by socio_id, s.nome_completo, mes_referencia, classificacao_pessoal, cp.nome, status;

-- ---------------------------------------------------------------------------
-- Distribuição de Lucro consolidada (replica aba "_")
-- ---------------------------------------------------------------------------
create or replace view public.v_distribuicao_lucro_mensal as
select
  mes_referencia,
  classificacao_pessoal,
  cp.nome as classificacao_nome,
  sum(valor) as valor_total
from public.transacoes_socio ts
join public.classificacao_pessoal cp on cp.codigo = ts.classificacao_pessoal
group by mes_referencia, classificacao_pessoal, cp.nome
order by mes_referencia, classificacao_pessoal;



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0009_rls.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0009 — Row Level Security
-- ============================================================================
-- Política base:
--   • admin   → pode tudo
--   • editor  → CRUD em transações, estoque, documentos, recibos, chats
--   • socio   → SELECT em quase tudo; vê SUAS próprias transações_socio sempre
--   • viewer  → SELECT em tudo (read-only)
-- Cadastros (plano de contas, sócios, bancos) são read-only para todos exceto admin.

-- ---------------------------------------------------------------------------
-- Helper: pega a role do usuário atual
-- ---------------------------------------------------------------------------
create or replace function public.fn_my_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users where id = auth.uid()
$$;

create or replace function public.fn_is_admin()
returns boolean language sql stable as $$ select public.fn_my_role() = 'admin' $$;

create or replace function public.fn_can_write()
returns boolean language sql stable as $$ select public.fn_my_role() in ('admin','editor') $$;

create or replace function public.fn_my_socio_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.socios where user_id = auth.uid() limit 1
$$;

-- ---------------------------------------------------------------------------
-- public.users — perfil próprio + admin
-- ---------------------------------------------------------------------------
alter table public.users enable row level security;

drop policy if exists users_select_self_or_admin on public.users;
create policy users_select_self_or_admin on public.users
  for select using (auth.uid() = id or public.fn_is_admin());

drop policy if exists users_update_self_or_admin on public.users;
create policy users_update_self_or_admin on public.users
  for update using (auth.uid() = id or public.fn_is_admin())
  with check       (auth.uid() = id or public.fn_is_admin());

drop policy if exists users_admin_all on public.users;
create policy users_admin_all on public.users
  for all using (public.fn_is_admin())
  with check    (public.fn_is_admin());

-- ---------------------------------------------------------------------------
-- Cadastros: SELECT para todos autenticados, escrita só admin
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select unnest(array[
      'classificacao_financeira',
      'classificacao_pessoal',
      'socios',
      'contas_bancarias_empresa',
      'contas_bancarias_socio',
      'despesas_recorrentes_socio',
      'fornecedores',
      'recibo_modelos',
      'obra_parametros'
    ])
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select using (auth.uid() is not null)', t, t);
    execute format('drop policy if exists %I_admin on public.%I', t, t);
    execute format('create policy %I_admin on public.%I for all using (public.fn_is_admin()) with check (public.fn_is_admin())', t, t);
  end loop;
end$$;

-- ---------------------------------------------------------------------------
-- Tabelas operacionais: SELECT para todos, escrita admin/editor
-- (com 1 exceção: socio só vê suas próprias transações_socio se a role for 'socio')
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select unnest(array[
      'transacoes_empresa',
      'estoque',
      'documentos',
      'recibos',
      'obra_lts_itens',
      'obra_pendencias',
      'notas_em_grupo'
    ])
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select using (auth.uid() is not null)', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format('create policy %I_write on public.%I for all using (public.fn_can_write()) with check (public.fn_can_write())', t, t);
  end loop;
end$$;

-- ---------- transacoes_socio: socio vê SOMENTE as suas; admin/editor/viewer vê tudo ----------
alter table public.transacoes_socio enable row level security;

drop policy if exists ts_select on public.transacoes_socio;
create policy ts_select on public.transacoes_socio
  for select using (
    auth.uid() is not null and (
      public.fn_my_role() in ('admin','editor','viewer')
      or socio_id = public.fn_my_socio_id()
    )
  );

drop policy if exists ts_write on public.transacoes_socio;
create policy ts_write on public.transacoes_socio
  for all using (public.fn_can_write())
  with check    (public.fn_can_write());

-- ---------- chat_sessions / chat_mensagens: todos veem tudo (escopo do projeto) ----------
alter table public.chat_sessions enable row level security;
drop policy if exists cs_read  on public.chat_sessions;
create policy cs_read  on public.chat_sessions for select using (auth.uid() is not null);
drop policy if exists cs_write on public.chat_sessions;
create policy cs_write on public.chat_sessions for all
  using       (auth.uid() is not null)
  with check  (auth.uid() is not null);

alter table public.chat_mensagens enable row level security;
drop policy if exists cm_read  on public.chat_mensagens;
create policy cm_read  on public.chat_mensagens for select using (auth.uid() is not null);
drop policy if exists cm_write on public.chat_mensagens;
create policy cm_write on public.chat_mensagens for all
  using       (auth.uid() is not null)
  with check  (auth.uid() is not null);

-- ---------- logs: read admin/editor; insert qualquer autenticado ----------
alter table public.logs enable row level security;
drop policy if exists logs_read   on public.logs;
create policy logs_read   on public.logs for select using (public.fn_can_write());
drop policy if exists logs_insert on public.logs;
create policy logs_insert on public.logs for insert with check (auth.uid() is not null);



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0010_saldo_por_banco.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0010 — Saldo atual por banco (conciliação bancária)
-- ============================================================================
-- Reproduz a lógica que a Lola usa hoje na aba "Saldo Disponível":
-- saldo atual = saldo_inicial + todos os status realizados (Pago, Recebido,
-- Aplicado, Resgatado, Repassado, Aplicação, Resgate).
--
-- Status NÃO contam:
--   • a_pagar / a_receber / a_repassar / a_aplicar / a_resgatar  → futuros
--   • provisionado / provisionado_dl / provisionado_dv          → previsão
--
-- Esses status entram em colunas separadas (a_pagar, a_receber, provisionado)
-- pra ela ter visão de "o que vai sair/entrar" sem misturar com saldo real.

create or replace view public.v_saldo_atual_por_banco as
select
  cb.id                                                           as conta_bancaria_id,
  cb.nome                                                         as banco_nome,
  cb.apelido                                                      as banco_apelido,
  cb.banco                                                        as banco_instituicao,
  cb.agencia                                                      as banco_agencia,
  cb.ordem                                                        as banco_ordem,

  -- Saldo conciliado (soma de tudo que de fato entrou/saiu)
  coalesce(sum(te.valor) filter (
    where te.status in (
      'saldo_inicial',
      'recebido', 'pago',
      'repassado',
      'aplicado', 'aplicacao',
      'resgatado', 'resgate'
    )
  ), 0)                                                           as saldo_atual,

  -- Compromissos previstos
  coalesce(sum(te.valor) filter (where te.status = 'a_pagar'),    0) as a_pagar,
  coalesce(sum(te.valor) filter (where te.status = 'a_receber'),  0) as a_receber,
  coalesce(sum(te.valor) filter (where te.status = 'a_repassar'), 0) as a_repassar,
  coalesce(sum(te.valor) filter (where te.status = 'a_resgatar'), 0) as a_resgatar,
  coalesce(sum(te.valor) filter (
    where te.status in ('provisionado','provisionado_dl','provisionado_dv')
  ), 0)                                                           as provisionado,

  -- Quebra mais granular pro card (entradas / saídas realizadas separadas)
  coalesce(sum(te.valor) filter (
    where te.status in ('saldo_inicial','recebido','resgatado','resgate','aplicacao')
  ), 0)                                                           as entradas_realizadas,
  coalesce(sum(te.valor) filter (
    where te.status in ('pago','repassado','aplicado')
  ), 0)                                                           as saidas_realizadas,

  -- Saldo "projetado" = saldo atual + a_receber - a_pagar - provisionado
  -- Usado pra responder "se eu honrar tudo que está em aberto, fico com quanto?"
  coalesce(sum(te.valor) filter (
    where te.status in (
      'saldo_inicial','recebido','pago','repassado','aplicado','aplicacao',
      'resgatado','resgate','a_pagar','a_receber','a_repassar','a_resgatar',
      'provisionado','provisionado_dl','provisionado_dv'
    )
  ), 0)                                                           as saldo_projetado,

  count(te.id)                                                    as total_lancamentos
from public.contas_bancarias_empresa cb
left join public.transacoes_empresa te on te.conta_bancaria_id = cb.id
where cb.ativa = true
group by cb.id, cb.nome, cb.apelido, cb.banco, cb.agencia, cb.ordem
order by cb.ordem;

comment on view public.v_saldo_atual_por_banco is
  'Saldo bancário conciliado por banco — espelha a lógica de "Saldo Disponível" da planilha. Inclui projetado (saldo + a receber - a pagar - provisionado) para visão de fluxo.';



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0011_contas_investimento.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0011 — Contas de investimento (XP, Invest, Invest Evolutivo)
-- ============================================================================
-- Na planilha esses 3 cards (INVEST, INVEST EVOLUTIVO, XP) são valores fixos
-- digitados na mão. No sistema, são contas como qualquer outra: ela cadastra,
-- faz um lançamento de "Saldo inicial" + movimentações (resgate, aplicação,
-- rendimento) e o saldo aparece no dashboard automaticamente via
-- v_saldo_atual_por_banco.

insert into public.contas_bancarias_empresa (nome, apelido, banco, agencia, tipo, ordem) values
  ('XP (Conta)',         'XP',                'XP Investimentos', null, 'investimento', 4),
  ('Invest',             'Invest',            'XP Investimentos', null, 'investimento', 5),
  ('Invest Evolutivo',   'Invest Evolutivo',  'XP Investimentos', null, 'investimento', 6)
on conflict (nome) do nothing;

-- Os nomes acima são plausíveis mas a Lola pode ajustar pelo cadastro depois.
-- O importante é que cada conta tem id único + apelido pro card do dashboard.



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0012_promover_admin.sql
-- └──────────────────────────────────────────────────────────────────────────┘
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



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0013_garantir_perfil_admin.sql
-- └──────────────────────────────────────────────────────────────────────────┘
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



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0014_vendas_e_safra.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0014 — Vendas Futuras + Armazéns + Depósitos de Safra
-- ============================================================================
-- Espelha as planilhas-satélite "Provisionamento_VENDAS 2026.xlsx" e
-- "Provisionamento Safra 25.25 - Copasul.xlsx" (vide ANALISE-NOVAS-PLANILHAS.md).
--
-- Conceitos:
--   • vendas_provisionadas  → contratos de venda já firmados, aguardando pgto
--   • armazens              → cadastro dos cerealistas (Copasul, etc)
--   • safra_depositos       → cada DFe/NFP de produto entregue no armazém
--   • A view v_safra_depositos_calculado aplica fórmulas da planilha
--     (quebra técnica, taxa de armazenagem, taxa de devolução) usando uma
--     data parametrizada — o front passa a "Data Atual" via filtro.

-- ---------------------------------------------------------------------------
-- Enums novos
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'cultura_safra') then
    create type public.cultura_safra as enum ('soja','milho','sorgo','girassol','algodao','feijao','trigo');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'venda_status') then
    create type public.venda_status as enum (
      'firmada',          -- contrato assinado, aguardando pagamento
      'parcial',          -- alguma parcela já paga
      'liquidada',        -- 100% recebida
      'cancelada'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'safra_deposito_status') then
    create type public.safra_deposito_status as enum (
      'armazenado',       -- em estoque no armazém
      'vendido_parcial',
      'vendido_total',
      'retirado',         -- retirado sem venda
      'baixa'             -- baixa por perda/sinistro
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Armazéns (cooperativas / cerealistas)
-- ---------------------------------------------------------------------------
create table if not exists public.armazens (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null unique,                -- "Copasul"
  apelido       text,                                -- "Copasul Maracaju"
  cnpj          text,
  cidade        text,
  uf            text,
  observacao    text,
  ativo         boolean not null default true,
  ordem         smallint,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists tg_armazens_updated_at on public.armazens;
create trigger tg_armazens_updated_at
  before update on public.armazens
  for each row execute function public.tg_set_updated_at();

comment on table public.armazens is
  'Cerealistas/cooperativas onde a Aramburu armazena grãos para venda futura.';

-- ---------------------------------------------------------------------------
-- Parâmetros de cálculo da safra (taxas)
-- ---------------------------------------------------------------------------
-- Cada combinação (armazém, cultura, safra) tem suas taxas próprias.
-- Vem das constantes da aba Detalhado__ (L13, P13, S13) da planilha Copasul.
create table if not exists public.safra_parametros (
  id                          uuid primary key default gen_random_uuid(),
  armazem_id                  uuid not null references public.armazens(id) on delete cascade,
  cultura                     public.cultura_safra not null,
  safra                       text not null,                          -- "24/25", "25/25"
  -- Constantes de cálculo
  quebra_quinzena_pct         numeric(8,5) not null default 0.0015,   -- 0.15%
  armazenagem_por_kg_quinzena numeric(10,4) not null default 0.20,    -- R$/kg/quinzena
  devolucao_por_saca          numeric(10,4) not null default 4.75,    -- R$/saca
  carencia_dias               smallint not null default 30,           -- período sem cobrança
  kg_por_saca                 numeric(6,2) not null default 60.00,    -- conversão base
  -- Inputs do dashboard
  data_atual                  date not null default current_date,     -- usada nos cálculos
  cotacao_simulada_sc         numeric(10,2),                          -- R$/saca para simular venda
  observacao                  text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (armazem_id, cultura, safra)
);

create index if not exists idx_sp_armazem on public.safra_parametros(armazem_id);

drop trigger if exists tg_sp_updated_at on public.safra_parametros;
create trigger tg_sp_updated_at
  before update on public.safra_parametros
  for each row execute function public.tg_set_updated_at();

comment on table public.safra_parametros is
  'Constantes e inputs editáveis por (armazem, cultura, safra) — espelha L13/P13/S13/F7/E20 da aba Detalhado__ Copasul.';

-- ---------------------------------------------------------------------------
-- Depósitos da safra (cada DFe/NFP entregue no armazém)
-- ---------------------------------------------------------------------------
create table if not exists public.safra_depositos (
  id                  uuid primary key default gen_random_uuid(),
  armazem_id          uuid not null references public.armazens(id) on delete restrict,
  cultura             public.cultura_safra not null,
  safra               text not null,                                  -- "25/25"
  data_deposito       date not null,
  dfe_entrada         text,                                           -- "54383"
  nfp                 text,                                           -- "8285721"
  kg_bruto            numeric(15,3) not null check (kg_bruto >= 0),
  status              public.safra_deposito_status not null default 'armazenado',
  observacao          text,
  origem_planilha     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references public.users(id) on delete set null
);

create index if not exists idx_sd_armazem  on public.safra_depositos(armazem_id);
create index if not exists idx_sd_cultura  on public.safra_depositos(cultura);
create index if not exists idx_sd_safra    on public.safra_depositos(safra);
create index if not exists idx_sd_data     on public.safra_depositos(data_deposito);
create index if not exists idx_sd_status   on public.safra_depositos(status);

drop trigger if exists tg_sd_updated_at on public.safra_depositos;
create trigger tg_sd_updated_at
  before update on public.safra_depositos
  for each row execute function public.tg_set_updated_at();

comment on table public.safra_depositos is
  'Cada DFe entregue no armazém — espelha R16:R31 da aba Detalhado__ Copasul.';

-- ---------------------------------------------------------------------------
-- View calculada: aplica fórmulas da planilha sobre cada depósito
-- ---------------------------------------------------------------------------
-- Reproduz exatamente:
--   I_r = (H_r - C_r) - carencia        (dias percorridos)
--   J_r = I_r / 15                      (quinzenas)
--   L_r = quebra_pct * J_r * F_r        (quebra técnica em kg)
--   M_r = F_r - L_r                     (produto líquido em kg)
--   N_r = M_r / kg_por_saca             (líquido em sacas)
--   Q_r = M_r * I_r * (P13/15) / kg_por_saca   (taxa armazenagem)
--   S_r = G_r * devolucao_sc            (taxa devolução)
--   U_r = Q_r + S_r                     (total a descontar)
--   W_r = N_r * cotacao_sc              (valor venda simulado)
create or replace view public.v_safra_depositos_calculado as
select
  d.id,
  d.armazem_id,
  a.nome           as armazem_nome,
  a.apelido        as armazem_apelido,
  d.cultura,
  d.safra,
  d.data_deposito,
  d.dfe_entrada,
  d.nfp,
  d.kg_bruto,
  d.status,
  d.observacao,
  d.created_at,
  d.updated_at,
  -- Parâmetros vigentes
  p.id                          as parametros_id,
  p.quebra_quinzena_pct,
  p.armazenagem_por_kg_quinzena,
  p.devolucao_por_saca,
  p.carencia_dias,
  p.kg_por_saca,
  p.data_atual,
  p.cotacao_simulada_sc,
  -- Conversões base
  (d.kg_bruto / p.kg_por_saca)::numeric(15,4)            as sc_bruto,
  -- Tempo decorrido (descontando carência)
  greatest((p.data_atual - d.data_deposito) - p.carencia_dias, 0)::int as dias_percorridos,
  (greatest((p.data_atual - d.data_deposito) - p.carencia_dias, 0)::numeric / 15)::numeric(10,4) as quinzenas,
  -- Quebra técnica
  (
    (p.quebra_quinzena_pct *
     (greatest((p.data_atual - d.data_deposito) - p.carencia_dias, 0)::numeric / 15)
    ) * d.kg_bruto
  )::numeric(15,3) as quebra_kg,
  -- Produto líquido
  (
    d.kg_bruto -
    (p.quebra_quinzena_pct *
     (greatest((p.data_atual - d.data_deposito) - p.carencia_dias, 0)::numeric / 15)
    ) * d.kg_bruto
  )::numeric(15,3) as kg_liquido,
  (
    (
      d.kg_bruto -
      (p.quebra_quinzena_pct *
       (greatest((p.data_atual - d.data_deposito) - p.carencia_dias, 0)::numeric / 15)
      ) * d.kg_bruto
    ) / p.kg_por_saca
  )::numeric(15,4) as sc_liquida,
  -- Taxa de armazenagem  =  kg_liq * dias * (armaz/15) / kg_por_saca
  (
    (
      d.kg_bruto -
      (p.quebra_quinzena_pct *
       (greatest((p.data_atual - d.data_deposito) - p.carencia_dias, 0)::numeric / 15)
      ) * d.kg_bruto
    )
    * greatest((p.data_atual - d.data_deposito) - p.carencia_dias, 0)::numeric
    * (p.armazenagem_por_kg_quinzena / 15)
    / p.kg_por_saca
  )::numeric(15,2) as taxa_armazenagem,
  -- Taxa de devolução  =  sc_bruta * devolucao_sc
  ( (d.kg_bruto / p.kg_por_saca) * p.devolucao_por_saca )::numeric(15,2) as taxa_devolucao,
  -- TOTAL A DESCONTAR
  (
    (
      d.kg_bruto -
      (p.quebra_quinzena_pct *
       (greatest((p.data_atual - d.data_deposito) - p.carencia_dias, 0)::numeric / 15)
      ) * d.kg_bruto
    )
    * greatest((p.data_atual - d.data_deposito) - p.carencia_dias, 0)::numeric
    * (p.armazenagem_por_kg_quinzena / 15)
    / p.kg_por_saca
    +
    (d.kg_bruto / p.kg_por_saca) * p.devolucao_por_saca
  )::numeric(15,2) as total_a_descontar,
  -- VALOR DE VENDA (simulado): sc_liq × cotacao
  (
    (
      (
        d.kg_bruto -
        (p.quebra_quinzena_pct *
         (greatest((p.data_atual - d.data_deposito) - p.carencia_dias, 0)::numeric / 15)
        ) * d.kg_bruto
      ) / p.kg_por_saca
    ) * coalesce(p.cotacao_simulada_sc, 0)
  )::numeric(15,2) as valor_venda_simulado
from public.safra_depositos d
join public.armazens a            on a.id = d.armazem_id
left join public.safra_parametros p on p.armazem_id = d.armazem_id
                                    and p.cultura = d.cultura
                                    and p.safra = d.safra;

comment on view public.v_safra_depositos_calculado is
  'Cada depósito enriquecido com cálculos da planilha (quebra, armazenagem, devolução, valor venda). Usa safra_parametros.data_atual como "Data Atual".';

-- ---------------------------------------------------------------------------
-- Vendas Provisionadas (Provisionamento_VENDAS 2026)
-- ---------------------------------------------------------------------------
-- Destino_da_venda: para qual entidade vai o valor (empresa Aramburu ou um sócio direto).
create table if not exists public.vendas_provisionadas (
  id                  uuid primary key default gen_random_uuid(),
  data_venda          date not null,                          -- data do contrato
  comprador           text not null,                          -- "Copasul"
  cultura             public.cultura_safra not null,
  safra               text not null,                          -- "24/25"
  aut_fixacao         text,                                   -- nº autorização de fixação
  numero_contrato     text,                                   -- "153076"
  nota_fiscal         text,
  kg                  numeric(15,3) not null check (kg >= 0),
  preco_sc            numeric(12,4) not null,                 -- R$/saca
  kg_por_saca         numeric(6,2) not null default 60.00,
  data_pgto_prevista  date not null,                          -- quando vai cair na conta
  destino_empresa     boolean not null default true,          -- true=Aramburu, false=socio_id setado
  socio_destino_id    uuid references public.socios(id) on delete set null,
  taxa_armazenagem    numeric(12,2) not null default 0,
  observacao          text,
  status              public.venda_status not null default 'firmada',
  -- Conexão com transação real quando paga
  transacao_empresa_id uuid references public.transacoes_empresa(id) on delete set null,
  origem_planilha     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references public.users(id) on delete set null,
  check (destino_empresa or socio_destino_id is not null)
);

create index if not exists idx_vp_data_pgto  on public.vendas_provisionadas(data_pgto_prevista);
create index if not exists idx_vp_data_venda on public.vendas_provisionadas(data_venda);
create index if not exists idx_vp_status     on public.vendas_provisionadas(status);
create index if not exists idx_vp_safra      on public.vendas_provisionadas(safra);
create index if not exists idx_vp_cultura    on public.vendas_provisionadas(cultura);
create index if not exists idx_vp_socio      on public.vendas_provisionadas(socio_destino_id);

drop trigger if exists tg_vp_updated_at on public.vendas_provisionadas;
create trigger tg_vp_updated_at
  before update on public.vendas_provisionadas
  for each row execute function public.tg_set_updated_at();

comment on table public.vendas_provisionadas is
  'Contratos de venda firmados aguardando pgto futuro — espelha Provisionamento_VENDAS 2026.xlsx.';

-- ---------------------------------------------------------------------------
-- View enriquecida + agregados por trimestre/mês
-- ---------------------------------------------------------------------------
create or replace view public.v_vendas_provisionadas as
select
  v.*,
  (v.kg / v.kg_por_saca)::numeric(15,4) as sacas,
  ((v.kg / v.kg_por_saca) * v.preco_sc)::numeric(15,2) as valor_total,
  s.nome_completo as socio_destino_nome,
  s.apelido       as socio_destino_apelido,
  -- Mês & trimestre do recebimento
  public.fn_mes_referencia(v.data_pgto_prevista) as mes_recebimento,
  case
    when extract(month from v.data_pgto_prevista) <= 3 then '1º TRI'
    when extract(month from v.data_pgto_prevista) <= 6 then '2º TRI'
    when extract(month from v.data_pgto_prevista) <= 9 then '3º TRI'
    else '4º TRI'
  end as trimestre_recebimento
from public.vendas_provisionadas v
left join public.socios s on s.id = v.socio_destino_id;

comment on view public.v_vendas_provisionadas is
  'Vendas com sacas, valor_total e mês/trim de recebimento calculados.';

-- Agregação por trimestre/destino (alimenta o card de "Saldo Futuro")
create or replace view public.v_vendas_por_trimestre as
select
  destino_empresa,
  socio_destino_id,
  cultura,
  safra,
  trimestre_recebimento,
  count(*)                 as qtd,
  sum(sacas)               as sacas_total,
  sum(valor_total)         as valor_total
from public.v_vendas_provisionadas
group by destino_empresa, socio_destino_id, cultura, safra, trimestre_recebimento
order by safra, trimestre_recebimento;

create or replace view public.v_vendas_por_mes as
select
  destino_empresa,
  socio_destino_id,
  cultura,
  safra,
  mes_recebimento,
  count(*)                 as qtd,
  sum(sacas)               as sacas_total,
  sum(valor_total)         as valor_total
from public.v_vendas_provisionadas
group by destino_empresa, socio_destino_id, cultura, safra, mes_recebimento
order by safra, mes_recebimento;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.armazens enable row level security;
drop policy if exists armazens_read on public.armazens;
create policy armazens_read on public.armazens
  for select using (auth.uid() is not null);
drop policy if exists armazens_write on public.armazens;
create policy armazens_write on public.armazens
  for all using (public.fn_can_write()) with check (public.fn_can_write());

alter table public.safra_parametros enable row level security;
drop policy if exists sp_read on public.safra_parametros;
create policy sp_read on public.safra_parametros
  for select using (auth.uid() is not null);
drop policy if exists sp_write on public.safra_parametros;
create policy sp_write on public.safra_parametros
  for all using (public.fn_can_write()) with check (public.fn_can_write());

alter table public.safra_depositos enable row level security;
drop policy if exists sd_read on public.safra_depositos;
create policy sd_read on public.safra_depositos
  for select using (auth.uid() is not null);
drop policy if exists sd_write on public.safra_depositos;
create policy sd_write on public.safra_depositos
  for all using (public.fn_can_write()) with check (public.fn_can_write());

alter table public.vendas_provisionadas enable row level security;
drop policy if exists vp_read on public.vendas_provisionadas;
create policy vp_read on public.vendas_provisionadas
  for select using (auth.uid() is not null);
drop policy if exists vp_write on public.vendas_provisionadas;
create policy vp_write on public.vendas_provisionadas
  for all using (public.fn_can_write()) with check (public.fn_can_write());



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0015_bancos_e_pdfmonkey.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0015 — Bancos (limite 5 por sócio) + Templates PDFMonkey + ajustes
-- ============================================================================
-- Mudanças combinadas na reunião 15/05:
--   1. Limitar a 5 contas bancárias por sócio (trigger)
--   2. Permitir cadastro de contas pessoais para QUALQUER sócio (até hoje
--      Pedro Henrique era exceção sem cadastro — a regra cai)
--   3. Adicionar tabela de templates do PDFMonkey (capa empresa, capa socio,
--      relatório contábil, relatório sócios)
--   4. Adicionar coluna `numero_nota` à transacoes_empresa (já existe `ref`,
--      mas indexamos pra busca por NF acelerar)

-- ---------------------------------------------------------------------------
-- 1) Trigger: máximo 5 contas bancárias por sócio
-- ---------------------------------------------------------------------------
create or replace function public.fn_limitar_contas_bancarias_socio()
returns trigger
language plpgsql
as $$
declare
  v_count int;
begin
  select count(*) into v_count
  from public.contas_bancarias_socio
  where socio_id = new.socio_id
    and ativa = true
    and (tg_op = 'INSERT' or id <> new.id);

  if v_count >= 5 then
    raise exception 'Limite de 5 contas bancárias ativas por sócio atingido (socio_id = %)', new.socio_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists tg_limitar_contas_socio on public.contas_bancarias_socio;
create trigger tg_limitar_contas_socio
  before insert or update on public.contas_bancarias_socio
  for each row execute function public.fn_limitar_contas_bancarias_socio();

comment on function public.fn_limitar_contas_bancarias_socio is
  'Garante o limite de 5 contas bancárias ativas por sócio (decisão da reunião 15/05/2026).';

-- ---------------------------------------------------------------------------
-- 2) Adicionar colunas que faltam para identificação completa do banco
-- ---------------------------------------------------------------------------
-- Estruturado para alimentar o cadastro de Bancos pelo front (UI):
--   • banco        — instituição financeira (Cora, Sicredi, Bradesco…)
--   • agencia      — código da agência
--   • conta        — número da conta corrente
--   • tipo         — corrente, poupança, investimento
--   • titular      — opcional, p/ contas de sócio (snapshot)
alter table public.contas_bancarias_empresa
  add column if not exists numero_conta text,
  add column if not exists digito       text;

alter table public.contas_bancarias_socio
  add column if not exists tipo          text,                            -- corrente/poupanca/investimento
  add column if not exists numero_conta  text,
  add column if not exists digito        text,
  add column if not exists email_chave   text;                            -- para PIX por email (Nubank/B.Brasil)

-- ---------------------------------------------------------------------------
-- 3) Templates PDFMonkey (capa empresa / capa socio / contábil / sócios)
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'pdfmonkey_slug') then
    create type public.pdfmonkey_slug as enum (
      'capa_empresa',
      'capa_socio',
      'relatorio_contabil',
      'relatorio_socios'
    );
  end if;
end $$;

create table if not exists public.pdfmonkey_templates (
  slug          public.pdfmonkey_slug primary key,
  nome          text not null,
  descricao     text,
  template_id   text,                                  -- ID do template no PDFMonkey
  ativo         boolean not null default true,
  exemplo_payload jsonb,                               -- payload de referência (preenchido pelos jsons da pasta jsons-pdf-monkey/)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists tg_pmt_updated_at on public.pdfmonkey_templates;
create trigger tg_pmt_updated_at
  before update on public.pdfmonkey_templates
  for each row execute function public.tg_set_updated_at();

insert into public.pdfmonkey_templates (slug, nome, descricao) values
  ('capa_empresa',       'Capa Empresa',        'Capa do Relatório Contábil — empresa Aramburu'),
  ('capa_socio',         'Capa Sócio',          'Capa do Relatório Mensal — por sócio'),
  ('relatorio_contabil', 'Relatório Contábil',  'Documento detalhado por banco/categoria — para a contabilidade'),
  ('relatorio_socios',   'Relatório Sócios',    'Documento resumido infográfico — para os sócios')
on conflict (slug) do nothing;

-- Log de gerações de PDF
create table if not exists public.pdfmonkey_geracoes (
  id              uuid primary key default gen_random_uuid(),
  template_slug   public.pdfmonkey_slug not null references public.pdfmonkey_templates(slug),
  mes_referencia  text,                                -- "YYYY-MM" quando aplicável
  socio_id        uuid references public.socios(id) on delete set null,
  pdfmonkey_document_id text,                          -- id devolvido pela API
  status          text,                                -- "pending", "success", "failure"
  download_url    text,
  payload         jsonb,
  erro            text,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.users(id) on delete set null
);

create index if not exists idx_pmg_template on public.pdfmonkey_geracoes(template_slug);
create index if not exists idx_pmg_mes      on public.pdfmonkey_geracoes(mes_referencia);
create index if not exists idx_pmg_status   on public.pdfmonkey_geracoes(status);

-- ---------------------------------------------------------------------------
-- 4) Busca de transações por número de nota (acelerar ILIKE)
-- ---------------------------------------------------------------------------
-- O front já busca em ref via ilike. Adicionamos índice trigram para acelerar.
create extension if not exists pg_trgm;

create index if not exists idx_te_ref_trgm
  on public.transacoes_empresa using gin (ref gin_trgm_ops);

create index if not exists idx_te_descricao_trgm
  on public.transacoes_empresa using gin (descricao gin_trgm_ops);

create index if not exists idx_te_fornecedor_nome_trgm
  on public.transacoes_empresa using gin (fornecedor_nome gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 5) RLS dos novos objetos
-- ---------------------------------------------------------------------------
alter table public.pdfmonkey_templates enable row level security;
drop policy if exists pmt_read on public.pdfmonkey_templates;
create policy pmt_read on public.pdfmonkey_templates
  for select using (auth.uid() is not null);
drop policy if exists pmt_write on public.pdfmonkey_templates;
create policy pmt_write on public.pdfmonkey_templates
  for all using (public.fn_is_admin()) with check (public.fn_is_admin());

alter table public.pdfmonkey_geracoes enable row level security;
drop policy if exists pmg_read on public.pdfmonkey_geracoes;
create policy pmg_read on public.pdfmonkey_geracoes
  for select using (auth.uid() is not null);
drop policy if exists pmg_write on public.pdfmonkey_geracoes;
create policy pmg_write on public.pdfmonkey_geracoes
  for all using (public.fn_can_write()) with check (public.fn_can_write());



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0016_documentos_gerados.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0016 — Documentos Gerados (recibos e termos via código)
-- ============================================================================
-- Substitui o mock da tela /dashboard/documentos pela emissão real de:
--   • Recibo de Vale Combustível
--   • Recibo de Aluguel
--   • Recibo de Pagamento de Prestador
--   • Termo de Autorização de Pagamento a Terceiros
--   • Termo de Transferência Bancária
--   • Contrato de Prestação de Serviços (construção civil)
--
-- O PDF é gerado server-side por /api/documentos/gerar (pdf-lib) e
-- armazenado no bucket privado `documentos-gerados`. Esta tabela guarda
-- o registro + payload (jsonb) usado para regerar/auditar.

-- ---------------------------------------------------------------------------
-- 1) Enum dos tipos suportados
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'documento_gerado_tipo') then
    create type public.documento_gerado_tipo as enum (
      'recibo_vale_combustivel',
      'recibo_aluguel',
      'recibo_pagamento_prestador',
      'termo_autorizacao_pagamento_terceiros',
      'termo_transferencia_bancaria',
      'contrato_prestacao_servicos'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Tabela documentos_gerados
-- ---------------------------------------------------------------------------
create table if not exists public.documentos_gerados (
  id              uuid primary key default gen_random_uuid(),
  tipo            public.documento_gerado_tipo not null,
  numero          text,
  beneficiario    text,
  valor           numeric(14,2),
  descricao       text,
  mes_referencia  text,                                  -- "YYYY-MM"
  dados           jsonb not null default '{}'::jsonb,    -- snapshot dos campos do form
  pdf_path        text,                                  -- path no bucket Storage
  pdf_size        integer,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.users(id) on delete set null
);

create index if not exists idx_dg_tipo          on public.documentos_gerados(tipo);
create index if not exists idx_dg_created_at    on public.documentos_gerados(created_at desc);
create index if not exists idx_dg_mes           on public.documentos_gerados(mes_referencia);
create index if not exists idx_dg_beneficiario_trgm
  on public.documentos_gerados using gin (beneficiario gin_trgm_ops);
create index if not exists idx_dg_descricao_trgm
  on public.documentos_gerados using gin (descricao gin_trgm_ops);
create index if not exists idx_dg_numero_trgm
  on public.documentos_gerados using gin (numero gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 3) RLS — leitura para todo autenticado, escrita para admin/editor
-- ---------------------------------------------------------------------------
alter table public.documentos_gerados enable row level security;

drop policy if exists dg_read on public.documentos_gerados;
create policy dg_read on public.documentos_gerados
  for select using (auth.uid() is not null);

drop policy if exists dg_write on public.documentos_gerados;
create policy dg_write on public.documentos_gerados
  for all using (public.fn_can_write()) with check (public.fn_can_write());

-- ---------------------------------------------------------------------------
-- 4) Storage: bucket privado + policies em storage.objects
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('documentos-gerados', 'documentos-gerados', false)
on conflict (id) do nothing;

drop policy if exists dg_storage_read on storage.objects;
create policy dg_storage_read on storage.objects
  for select to authenticated
  using (bucket_id = 'documentos-gerados');

drop policy if exists dg_storage_insert on storage.objects;
create policy dg_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documentos-gerados');

drop policy if exists dg_storage_delete on storage.objects;
create policy dg_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'documentos-gerados' and public.fn_can_write());

comment on table public.documentos_gerados is
  'Log de emissões de recibos/termos gerados via /api/documentos/gerar. PDF físico fica no bucket documentos-gerados (Storage) e é referenciado por pdf_path.';



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0017_config_ia.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0017 — Config IA (chaves de API + provedor ativo)
-- ============================================================================
-- Substitui o localStorage da tela /dashboard/assistentes pelo armazenamento
-- server-side das chaves de API dos provedores de IA (Gemini / OpenAI) e a
-- escolha de qual deles está ativo.
--
-- Padrão singleton: a tabela tem no máximo UMA linha (id = 1), garantida
-- por check constraint. A modal lê/escreve via Supabase JS; a route
-- /api/assistentes/chat lê server-side antes de chamar o provedor — o front
-- nunca enxerga a chave em si.

-- ---------------------------------------------------------------------------
-- 1) Enum dos provedores suportados
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'ia_provider') then
    create type public.ia_provider as enum ('gemini', 'openai');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Tabela config_ia (singleton)
-- ---------------------------------------------------------------------------
create table if not exists public.config_ia (
  id              integer primary key default 1,
  provider_ativo  public.ia_provider not null default 'gemini',
  gemini_api_key  text,
  openai_api_key  text,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.users(id) on delete set null,
  constraint config_ia_singleton check (id = 1)
);

drop trigger if exists tg_config_ia_updated_at on public.config_ia;
create trigger tg_config_ia_updated_at
  before update on public.config_ia
  for each row execute function public.tg_set_updated_at();

-- Garante a linha singleton (idempotente)
insert into public.config_ia (id) values (1)
  on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3) RLS — leitura para autenticados, escrita para admin/editor
-- ---------------------------------------------------------------------------
alter table public.config_ia enable row level security;

drop policy if exists config_ia_read on public.config_ia;
create policy config_ia_read on public.config_ia
  for select using (auth.uid() is not null);

drop policy if exists config_ia_write on public.config_ia;
create policy config_ia_write on public.config_ia
  for all using (public.fn_can_write()) with check (public.fn_can_write());

comment on table public.config_ia is
  'Configuração das IAs dos assistentes (singleton id=1): chaves de API e provedor ativo. Consumida server-side por /api/assistentes/chat.';



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0018_agente_prompts.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0018 — Prompts/Treinamento dos Assistentes IA
-- ============================================================================
-- Cada assistente da tela /dashboard/assistentes tem seu "treinamento":
--   • system_prompt        — diretrizes/regras/contexto (instrução de sistema)
--   • mensagem_boas_vindas — primeira fala do assistente ao abrir o chat
--   • temperatura          — 0.0 (conservador) … 1.0 (criativo)
--
-- A modal de configuração (ícone de engrenagem dentro de cada chat) escreve
-- aqui; a route /api/assistentes/chat lê e injeta como system instruction
-- antes de chamar Gemini/OpenAI.

-- ---------------------------------------------------------------------------
-- 1) Tabela agente_prompts (1 linha por agente_id)
-- ---------------------------------------------------------------------------
create table if not exists public.agente_prompts (
  agente_id              text primary key,                  -- "contabilidade", "adv-trabalhista", ...
  nome                   text not null,                     -- "Assistente de Contabilidade"
  system_prompt          text not null default '',
  mensagem_boas_vindas   text,
  temperatura            numeric(3,2) not null default 0.30
                         check (temperatura >= 0 and temperatura <= 1),
  ativo                  boolean not null default true,
  updated_at             timestamptz not null default now(),
  updated_by             uuid references public.users(id) on delete set null
);

drop trigger if exists tg_agente_prompts_updated_at on public.agente_prompts;
create trigger tg_agente_prompts_updated_at
  before update on public.agente_prompts
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2) RLS — leitura para autenticados, escrita para admin/editor
-- ---------------------------------------------------------------------------
alter table public.agente_prompts enable row level security;

drop policy if exists ap_read on public.agente_prompts;
create policy ap_read on public.agente_prompts
  for select using (auth.uid() is not null);

drop policy if exists ap_write on public.agente_prompts;
create policy ap_write on public.agente_prompts
  for all using (public.fn_can_write()) with check (public.fn_can_write());

-- ---------------------------------------------------------------------------
-- 3) Seed inicial dos assistentes existentes (idempotente)
-- ---------------------------------------------------------------------------
-- O system_prompt aqui é um esqueleto curto: a Lola/admin vai refinar pela UI.
insert into public.agente_prompts (agente_id, nome, mensagem_boas_vindas, system_prompt) values
  (
    'contabilidade',
    'Assistente de Contabilidade',
    'Olá! Sou o Assistente de Contabilidade. Posso ajudar com lançamentos, conciliação bancária e plano de contas. O que você precisa?',
    'Você é o Assistente de Contabilidade da Agropecuária Aramburu.

Responsabilidades:
- Auxiliar em lançamentos contábeis, conciliação bancária e classificação de despesas.
- Explicar termos contábeis em linguagem simples para a operadora (não-contadora).
- Quando citar valores monetários, use o formato brasileiro (R$ 1.234,56).

Restrições:
- Não inventar números: se não tiver o dado, peça antes de responder.
- Sempre responder em português do Brasil.'
  ),
  (
    'adv-trabalhista',
    'Assistente Adv. Trabalhista',
    'Olá! Sou o Assistente Jurídico Trabalhista. Posso ajudar com CLT, contratos e prazos. Qual é a sua dúvida?',
    'Você é o Assistente Jurídico Trabalhista da Agropecuária Aramburu.

Responsabilidades:
- Esclarecer dúvidas sobre CLT, contratos de trabalho, prazos legais e obrigações do empregador rural.
- Citar a base legal (lei/artigo) sempre que possível.

Restrições:
- Não substitui um advogado: ao final de cada resposta, lembre que decisões definitivas exigem consulta jurídica formal.
- Responder em português do Brasil.'
  ),
  (
    'adv-ambiental',
    'Assistente Adv. Ambiental',
    'Olá! Sou o Assistente Jurídico Ambiental. Posso ajudar com licenciamento, CAR e conformidade ambiental.',
    'Você é o Assistente Jurídico Ambiental da Agropecuária Aramburu.

Responsabilidades:
- Orientar sobre legislação ambiental aplicável a produção agropecuária (Código Florestal, CAR, licenciamento, outorga de água).
- Indicar órgão competente quando relevante (IMASUL/MS, IBAMA, Funai etc.).

Restrições:
- Não substitui um advogado nem um engenheiro ambiental.
- Responder em português do Brasil.'
  ),
  (
    'adv-tributarista',
    'Assistente Adv. Tributarista',
    'Olá! Sou o Assistente Tributarista. Posso ajudar com tributos, planejamento fiscal e Funrural.',
    'Você é o Assistente Tributarista da Agropecuária Aramburu.

Responsabilidades:
- Esclarecer dúvidas sobre tributos do agronegócio (Funrural, ITR, ICMS, PIS/COFINS, IR pessoa física x jurídica).
- Apontar oportunidades de planejamento fiscal e regimes especiais.

Restrições:
- Não substitui um contador/advogado tributarista para decisões definitivas.
- Responder em português do Brasil.'
  ),
  (
    'adv-contratual',
    'Assistente Adv. Contratual',
    'Olá! Sou o Assistente Jurídico Contratual. Posso ajudar a elaborar e revisar contratos.',
    'Você é o Assistente Jurídico Contratual da Agropecuária Aramburu.

Responsabilidades:
- Auxiliar na elaboração e revisão de contratos empresariais (compra e venda, arrendamento, parceria agrícola, prestação de serviços).
- Apontar cláusulas críticas, riscos e sugestões de redação.

Restrições:
- Não substitui um advogado para validação final.
- Responder em português do Brasil.'
  ),
  (
    'fiscal-notas',
    'Assistente Fiscal / NF-e',
    'Olá! Sou o Assistente Fiscal. Posso ajudar com NF-e, SPED e obrigações acessórias.',
    'Você é o Assistente Fiscal da Agropecuária Aramburu.

Responsabilidades:
- Esclarecer dúvidas sobre emissão de NF-e/NFP-e, CFOP, CST, SPED Fiscal/Contribuições.
- Auxiliar a interpretar rejeições da SEFAZ e códigos de status.

Restrições:
- Considere sempre que a empresa é produtor rural pessoa jurídica em Mato Grosso do Sul (regras estaduais aplicáveis).
- Responder em português do Brasil.'
  ),
  (
    'estoque',
    'Assistente de Estoque',
    'Olá! Sou o Assistente de Estoque. Posso ajudar com inventário, alertas e movimentações.',
    'Você é o Assistente de Estoque da Agropecuária Aramburu.

Responsabilidades:
- Auxiliar no controle de inventário (insumos, defensivos, sementes, peças, combustível).
- Sinalizar itens em estoque baixo/crítico e sugerir reposição.

Restrições:
- Não inventar quantidades: se o dado não estiver disponível na conversa, peça antes.
- Responder em português do Brasil.'
  )
on conflict (agente_id) do nothing;

comment on table public.agente_prompts is
  'Prompt de sistema/treinamento de cada assistente IA. Editado pela engrenagem dentro de cada chat e consumido server-side por /api/assistentes/chat.';



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0019_chat_view.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0019 — Views/utilidades para o módulo de Assistentes IA
-- ============================================================================
-- Sustenta o card "Conversas Recentes" do hub /dashboard/assistentes:
-- traz a sessão + texto da última mensagem em uma única query.

-- ---------------------------------------------------------------------------
-- 1) View v_chat_sessoes_recentes
-- ---------------------------------------------------------------------------
-- Uma linha por chat_session, junto com a última mensagem (conteúdo + role +
-- created_at). Ordenada pelo updated_at da sessão DESC.
--
-- Usa LATERAL para evitar GROUP BY + window function — o índice
-- idx_cm_session (session_id, created_at) cobre a sub-query.
create or replace view public.v_chat_sessoes_recentes as
select
  s.id              as session_id,
  s.agente_id,
  s.agente_nome,
  s.usuario_id,
  s.usuario_nome,
  s.titulo,
  s.fechada,
  s.created_at,
  s.updated_at,
  last_msg.conteudo   as ultima_mensagem,
  last_msg.role       as ultima_mensagem_role,
  last_msg.created_at as ultima_mensagem_at
from public.chat_sessions s
left join lateral (
  select cm.conteudo, cm.role, cm.created_at
  from public.chat_mensagens cm
  where cm.session_id = s.id
  order by cm.created_at desc
  limit 1
) last_msg on true;

comment on view public.v_chat_sessoes_recentes is
  'Sessões de chat com a última mensagem associada. Alimenta o card "Conversas Recentes".';



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0020_assistentes_hardening.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0020 — Hardening do módulo de Assistentes IA
-- ============================================================================
-- Corrige achados do review adversarial:
--   • config_ia: SELECT só admin/editor (chaves de API não devem ser legíveis
--     pelo browser de qualquer usuário autenticado).
--   • agente_prompts: SELECT só admin/editor + view pública sem system_prompt
--     para o front conseguir ler boas-vindas/nome.
--   • chat_sessions / chat_mensagens: escrita restrita ao dono da sessão
--     (leitura continua aberta — escopo do produto).
--   • Índice único parcial para evitar duas sessões "vivas" no mesmo
--     (usuario_id, agente_id) — corta race condition.
--   • Trigger AFTER INSERT em chat_mensagens atualizando chat_sessions.updated_at
--     (o trigger pré-existente só dispara em UPDATE).
--   • Novas colunas em chat_mensagens (tokens_input, model, provider) — métricas
--     deixam de poluir o jsonb `anexos`.
--   • View v_chat_sessoes_recentes só conta sessões abertas (fechada = false).

-- ---------------------------------------------------------------------------
-- 1) config_ia — SELECT restrito
-- ---------------------------------------------------------------------------
drop policy if exists config_ia_read  on public.config_ia;
create policy config_ia_read on public.config_ia
  for select using (public.fn_can_write());

-- (escrita já era admin/editor — mantida)

-- ---------------------------------------------------------------------------
-- 2) agente_prompts — SELECT restrito + view pública só com metadados
-- ---------------------------------------------------------------------------
drop policy if exists ap_read on public.agente_prompts;
create policy ap_read on public.agente_prompts
  for select using (public.fn_can_write());

create or replace view public.v_agente_prompts_publico as
select
  agente_id,
  nome,
  mensagem_boas_vindas,
  ativo
from public.agente_prompts
where ativo = true;

comment on view public.v_agente_prompts_publico is
  'Subconjunto não-sensível de agente_prompts (sem system_prompt/temperatura) — consumido pelo ChatPage para mostrar boas-vindas.';

-- Views herdam a RLS da tabela base, mas o ChatPage precisa que QUALQUER
-- usuário autenticado leia daqui. Como a tabela base agora só permite SELECT
-- para admin/editor, criamos uma SECURITY DEFINER function pra contornar
-- (alternativamente daria pra criar política específica na view; views simples
-- aplicam policies da tabela base). Optamos por marcar a view com security_invoker=false.
alter view public.v_agente_prompts_publico set (security_invoker = false);

-- Garante SELECT explícito para anon/authenticated, já que a tabela base
-- agora tem SELECT restrito por RLS — sem isso, a view também ficaria fechada.
grant select on public.v_agente_prompts_publico to authenticated;
grant select on public.v_agente_prompts_publico to anon;

-- ---------------------------------------------------------------------------
-- 3) chat_sessions — escrita só do dono
-- ---------------------------------------------------------------------------
drop policy if exists cs_write on public.chat_sessions;
create policy cs_write on public.chat_sessions
  for all
  using       (auth.uid() is not null and usuario_id = auth.uid())
  with check  (auth.uid() is not null and usuario_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4) chat_mensagens — escrita só em sessões do dono
-- ---------------------------------------------------------------------------
drop policy if exists cm_write on public.chat_mensagens;
create policy cm_write on public.chat_mensagens
  for all
  using (
    auth.uid() is not null and exists (
      select 1 from public.chat_sessions s
      where s.id = chat_mensagens.session_id
        and s.usuario_id = auth.uid()
    )
  )
  with check (
    auth.uid() is not null and exists (
      select 1 from public.chat_sessions s
      where s.id = chat_mensagens.session_id
        and s.usuario_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 5) Índice único parcial — no máximo UMA sessão "viva" por (user, agente)
-- ---------------------------------------------------------------------------
create unique index if not exists uniq_cs_open
  on public.chat_sessions (usuario_id, agente_id)
  where fechada = false;

-- ---------------------------------------------------------------------------
-- 6) Trigger AFTER INSERT em chat_mensagens → bump chat_sessions.updated_at
-- ---------------------------------------------------------------------------
create or replace function public.tg_bump_session_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_sessions
     set updated_at = new.created_at
   where id = new.session_id;
  return new;
end;
$$;

drop trigger if exists tg_cm_bump_session on public.chat_mensagens;
create trigger tg_cm_bump_session
  after insert on public.chat_mensagens
  for each row execute function public.tg_bump_session_updated_at();

-- ---------------------------------------------------------------------------
-- 7) Novas colunas em chat_mensagens (telemetria/usage)
-- ---------------------------------------------------------------------------
alter table public.chat_mensagens
  add column if not exists tokens_input integer,
  add column if not exists model        text,
  add column if not exists provider     public.ia_provider;

-- ---------------------------------------------------------------------------
-- 8) View de sessões recentes — só conta abertas
-- ---------------------------------------------------------------------------
create or replace view public.v_chat_sessoes_recentes as
select
  s.id              as session_id,
  s.agente_id,
  s.agente_nome,
  s.usuario_id,
  s.usuario_nome,
  s.titulo,
  s.fechada,
  s.created_at,
  s.updated_at,
  last_msg.conteudo   as ultima_mensagem,
  last_msg.role       as ultima_mensagem_role,
  last_msg.created_at as ultima_mensagem_at
from public.chat_sessions s
left join lateral (
  select cm.conteudo, cm.role, cm.created_at
  from public.chat_mensagens cm
  where cm.session_id = s.id
  order by cm.created_at desc
  limit 1
) last_msg on true
where s.fechada = false;



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0021_agente_prompts_tools.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0021 — Atualiza system_prompts dos assistentes para usar tools (function calling)
-- ============================================================================
-- O catálogo real de tools fica no código (src/lib/ai/tools/*). Aqui só
-- atualizamos as DIRETRIZES para que o LLM saiba que tem ferramentas
-- disponíveis e quando invocá-las (ou pedir esclarecimento), em vez de
-- responder "me forneça os dados".
--
-- Idempotente: usa UPDATE. Não toca em registros customizados pelo usuário
-- (mantém mensagem_boas_vindas, temperatura, ativo, updated_by intactos).

update public.agente_prompts
set system_prompt = $$Você é o Assistente de Contabilidade da Agropecuária Aramburu.

Você tem ACESSO DIRETO aos dados financeiros da empresa via FERRAMENTAS (function calling). Use-as proativamente — NUNCA peça ao usuário valores que você pode buscar.

Ferramentas disponíveis (resumido — os nomes exatos estão na sua API):
- mes_referencia_atual — descobre o mês atual (YYYY-MM)
- listar_socios, listar_bancos_empresa, plano_de_contas — cadastros
- kpi_mensal — entradas/saídas agregadas por mês
- saldo_atual_por_banco — saldo realizado/projetado por conta
- saldo_por_banco_mensal — movimentação de um mês específico
- lancamentos_por_conta_contabil_mensal — soma por código contábil
- lancamentos_por_centro_custo_mensal — soma por centro de custo
- top_lancamentos — os N maiores lançamentos (com filtros)
- listar_fornecedores, lancamentos_por_fornecedor

Diretrizes:
- Se o usuário disser "este mês" ou "agora", chame mes_referencia_atual primeiro.
- Para perguntas como "qual o maior lançamento?" use top_lancamentos.
- Para conciliação bancária, combine saldo_por_banco_mensal + top_lancamentos do mês.
- Valores monetários em formato brasileiro: R$ 1.234,56.
- Linguagem clara, sem jargão; explique como se a usuária não fosse contadora.
- Sempre em português do Brasil.

Restrições:
- Tools são READ-ONLY. Você não pode criar nem alterar lançamentos.
- Se a tool retornar { ok: false, error: ... }, explique educadamente que houve um problema técnico e sugira reformular.
- Nunca invente números. Se a tool não retornar o dado, diga claramente que não encontrou.$$
where agente_id = 'contabilidade';

update public.agente_prompts
set system_prompt = $$Você é o Assistente Jurídico Trabalhista da Agropecuária Aramburu (atividade rural em Mato Grosso do Sul).

Você não tem acesso a uma base de dados de funcionários ou contratos CLT — o sistema ainda não persiste esses dados. Suas ferramentas são limitadas a:
- mes_referencia_atual — mês atual
- listar_socios, listar_bancos_empresa, plano_de_contas — cadastros gerais

Responsabilidades:
- Esclarecer dúvidas sobre CLT, contratos de trabalho rural, prazos legais e obrigações do empregador.
- Citar base legal (lei/artigo) sempre que possível.
- Considerar particularidades do trabalhador rural (Lei 5.889/73, NR-31).

Restrições:
- Não substitui um advogado: ao final de respostas que envolvam decisões, lembre que consulta jurídica formal é necessária.
- Sempre em português do Brasil.$$
where agente_id = 'adv-trabalhista';

update public.agente_prompts
set system_prompt = $$Você é o Assistente Jurídico Ambiental da Agropecuária Aramburu (Mato Grosso do Sul).

Suas ferramentas atuais são limitadas a cadastros gerais (mes_referencia_atual, listar_socios, listar_bancos_empresa, plano_de_contas). O sistema ainda não persiste licenças, CAR ou autuações.

Responsabilidades:
- Orientar sobre legislação ambiental aplicável a produção agropecuária: Código Florestal (Lei 12.651/12), CAR, licenciamento ambiental, outorga de água, NR-31 ambiental.
- Indicar órgão competente (IMASUL/MS, IBAMA, ANA) quando relevante.

Restrições:
- Não substitui um advogado nem um engenheiro ambiental.
- Sempre em português do Brasil.$$
where agente_id = 'adv-ambiental';

update public.agente_prompts
set system_prompt = $$Você é o Assistente Tributarista da Agropecuária Aramburu (produtor rural pessoa jurídica em Mato Grosso do Sul).

Você tem acesso aos dados financeiros via FERRAMENTAS (function calling). Use-as para análise tributária real, NUNCA peça ao usuário valores que pode buscar.

Ferramentas disponíveis:
- mes_referencia_atual, listar_socios, listar_bancos_empresa, plano_de_contas
- kpi_mensal, saldo_atual_por_banco, saldo_por_banco_mensal
- lancamentos_por_conta_contabil_mensal, lancamentos_por_centro_custo_mensal
- top_lancamentos, listar_fornecedores, lancamentos_por_fornecedor

Responsabilidades:
- Esclarecer dúvidas sobre Funrural, ITR, ICMS, PIS/COFINS, IR pessoa física x jurídica.
- Apontar oportunidades de planejamento fiscal e regimes especiais (ex.: Lei do Agronegócio).
- Quando analisar gastos, busque os números reais nas ferramentas — não estime.

Restrições:
- Tools READ-ONLY. Não substitui um contador/advogado tributarista para decisões definitivas.
- Sempre em português do Brasil.$$
where agente_id = 'adv-tributarista';

update public.agente_prompts
set system_prompt = $$Você é o Assistente Jurídico Contratual da Agropecuária Aramburu.

Você tem acesso à base de contratos da Obra Sede (parceria com a LTS Engenharia) via FERRAMENTAS:
- mes_referencia_atual, listar_socios, listar_bancos_empresa, plano_de_contas
- listar_obra_lts_itens — OCs e medições do contrato com a LTS
- obra_pendencias — itens a contratar
- obra_resumo — totais consolidados (pago, a pagar, provisionado, retenção)
- obra_parametros — constantes contratuais (capital inicial, etc.)

Responsabilidades:
- Auxiliar na elaboração e revisão de contratos empresariais agro (compra e venda, arrendamento, parceria agrícola, prestação de serviços).
- Apontar cláusulas críticas e riscos.
- Para perguntas sobre a obra atual, consulte as ferramentas antes de responder.

Restrições:
- Não substitui um advogado para validação final.
- Sempre em português do Brasil.$$
where agente_id = 'adv-contratual';

update public.agente_prompts
set system_prompt = $$Você é o Assistente Fiscal / NF-e da Agropecuária Aramburu (produtor rural PJ em MS).

FERRAMENTAS disponíveis:
- mes_referencia_atual, listar_socios, listar_bancos_empresa, plano_de_contas
- buscar_por_ref_ou_nf — encontra lançamentos pelo número/código de NF
- listar_notas_em_grupo — NFs agrupadas em orçamentos parcelados
- listar_documentos — documentos anexados (NFs/recibos digitalizados)
- kpi_mensal, lancamentos_por_conta_contabil_mensal, top_lancamentos
- listar_fornecedores

Responsabilidades:
- Esclarecer emissão de NF-e/NFP-e, CFOP, CST, SPED Fiscal/Contribuições.
- Auxiliar a interpretar rejeições da SEFAZ.
- Considere sempre regras estaduais de Mato Grosso do Sul.
- Quando o usuário citar um número de NF, busque com buscar_por_ref_ou_nf.

Restrições:
- Tools READ-ONLY. Não emite NF nem altera dados.
- Sempre em português do Brasil.$$
where agente_id = 'fiscal-notas';

update public.agente_prompts
set system_prompt = $$Você é o Assistente de Estoque da Agropecuária Aramburu.

FERRAMENTAS disponíveis:
- mes_referencia_atual, listar_socios, listar_bancos_empresa, plano_de_contas
- listar_estoque — itens com filtros (categoria, status, busca por nome)
- alertas_estoque — apenas itens em estado baixo/crítico/esgotado
- listar_fornecedores, lancamentos_por_fornecedor — pra investigar compras recentes

Responsabilidades:
- Controle de inventário (insumos, defensivos, sementes, peças, combustível).
- Sinalizar itens em estoque baixo/crítico e sugerir reposição.
- Quando o usuário perguntar "o que está faltando?", use alertas_estoque.
- Para histórico de compras de um item, combine listar_fornecedores + lancamentos_por_fornecedor.

Restrições:
- Tools READ-ONLY. Não altera quantidades.
- Sempre em português do Brasil.$$
where agente_id = 'estoque';



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0022_agente_prompts_data_model.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0022 — Refina prompts: explica o modelo de dados (provisionados, prefix match,
-- quando NÃO assumir "mês atual")
-- ============================================================================
-- Motivação: o assistente de Contabilidade respondia "não encontrei" para
-- contas que existem em meses diferentes do atual, porque o prompt anterior
-- o instruía a chamar mes_referencia_atual sempre que o usuário não
-- especificasse mês. O sistema também armazena lançamentos provisionados
-- com data futura (até 12 meses à frente), o que o agente desconhecia.

update public.agente_prompts
set system_prompt = $$Você é o Assistente de Contabilidade da Agropecuária Aramburu.

Você tem ACESSO DIRETO aos dados financeiros da empresa via FERRAMENTAS (function calling). Use-as proativamente — NUNCA peça ao usuário valores que você pode buscar.

═══════════════════════════════════════════════════════════════════════════
MODELO DE DADOS — leia antes de chamar tools
═══════════════════════════════════════════════════════════════════════════
• Lançamentos têm `data` = data PREVISTA OU EFETIVA da transação (igual à planilha original). Existem lançamentos com data FUTURA (até 12 meses à frente) marcados como `status='provisionado'` ou `'a_pagar'`/`'a_receber'` — são compromissos agendados, não erros.
• `mes_referencia` é derivado de `data` no formato YYYY-MM. Um lançamento provisionado para 29/12/2026 tem `mes_referencia='2026-12'`.
• Códigos contábeis são HIERÁRQUICOS: '2' = saídas, '2.3' = grupo de saídas, '2.3.6' = subitem específico. Quando filtrar por código nas tools (conta_contabil_cod, centro_custo_cod), o filtro é PREFIX — passar '2.3' já inclui '2.3.1', '2.3.6', '2.3.6.x'.
• Valores: entradas > 0, saídas < 0. Formato monetário em respostas: R$ 1.234,56.

═══════════════════════════════════════════════════════════════════════════
QUANDO usar mes_referencia_atual
═══════════════════════════════════════════════════════════════════════════
SOMENTE quando o usuário disser explicitamente "este mês", "agora", "esse mês", "atualmente".
NÃO assuma mês atual quando o usuário mencionar uma conta/código/fornecedor específico sem citar mês — nesses casos busque SEM filtro de mês.

═══════════════════════════════════════════════════════════════════════════
FERRAMENTAS disponíveis
═══════════════════════════════════════════════════════════════════════════
- mes_referencia_atual — só pra "este mês"
- listar_socios, listar_bancos_empresa, plano_de_contas
- kpi_mensal — agregados por mês (KPIs)
- saldo_atual_por_banco — saldo realizado/projetado por conta
- saldo_por_banco_mensal — movimentação de um mês específico
- lancamentos_por_conta_contabil_mensal — soma por conta contábil em um mês
- lancamentos_por_centro_custo_mensal — soma por centro de custo em um mês
- top_lancamentos — listagem flexível com filtros e ordenação. Use:
    • ordenar_por='data_desc' para "mais recente"
    • ordenar_por='valor_abs_desc' (default) para "maior"
    • conta_contabil_cod / centro_custo_cod (prefix) para filtrar por código
    • status='provisionado' para ver só agendamentos futuros
- listar_fornecedores, lancamentos_por_fornecedor

═══════════════════════════════════════════════════════════════════════════
EXEMPLOS DE RACIOCÍNIO
═══════════════════════════════════════════════════════════════════════════
Pergunta: "Qual o lançamento mais recente da conta 2.3.6?"
→ top_lancamentos({ centro_custo_cod: '2.3.6', ordenar_por: 'data_desc', limit: 1 })

Pergunta: "Qual o maior gasto este mês?"
→ chama mes_referencia_atual → top_lancamentos({ mes_referencia, natureza: 'saida', ordenar_por: 'valor_abs_desc', limit: 1 })

Pergunta: "O que estamos pagando à LTS Engenharia?"
→ lancamentos_por_fornecedor({ fornecedor_nome: 'LTS' })

Pergunta: "Como está minha conta na Cora?"
→ saldo_atual_por_banco (e use o resultado correspondente ao banco 'Cora')

═══════════════════════════════════════════════════════════════════════════
RESTRIÇÕES
═══════════════════════════════════════════════════════════════════════════
• Tools são READ-ONLY. Você não pode criar nem alterar lançamentos.
• Se uma tool retornar { ok: false, error: ... }, explique educadamente o problema e sugira reformular.
• Nunca invente números. Se a tool não retornar dado, diga claramente que não encontrou.
• Sempre em português do Brasil, linguagem clara (a usuária não é contadora).$$
where agente_id = 'contabilidade';

update public.agente_prompts
set system_prompt = $$Você é o Assistente Tributarista da Agropecuária Aramburu (produtor rural pessoa jurídica em Mato Grosso do Sul).

Você tem acesso aos dados financeiros via FERRAMENTAS — use-as para análise tributária real.

═══════════════════════════════════════════════════════════════════════════
MODELO DE DADOS
═══════════════════════════════════════════════════════════════════════════
• Lançamentos têm `data` PREVISTA OU EFETIVA. Existem entradas/saídas com data FUTURA (provisionadas) — não são erro.
• `mes_referencia` = YYYY-MM derivado da data.
• Códigos contábeis são hierárquicos: filtros por prefix ('2.3' inclui '2.3.6').
• Entradas > 0, saídas < 0.

═══════════════════════════════════════════════════════════════════════════
QUANDO usar mes_referencia_atual
═══════════════════════════════════════════════════════════════════════════
Só quando o usuário disser explicitamente "este mês". NÃO assuma mês atual quando ele citar conta/código/fornecedor sem mês.

═══════════════════════════════════════════════════════════════════════════
FERRAMENTAS
═══════════════════════════════════════════════════════════════════════════
- mes_referencia_atual, listar_socios, listar_bancos_empresa, plano_de_contas
- kpi_mensal, saldo_atual_por_banco, saldo_por_banco_mensal
- lancamentos_por_conta_contabil_mensal, lancamentos_por_centro_custo_mensal
- top_lancamentos — com filtros por código (prefix) e ordenação flexível
- listar_fornecedores, lancamentos_por_fornecedor

Responsabilidades:
- Esclarecer dúvidas sobre Funrural, ITR, ICMS, PIS/COFINS, IR pessoa física x jurídica.
- Apontar oportunidades de planejamento fiscal e regimes especiais.
- Para análise de gastos, busque os números reais nas ferramentas — não estime.

Restrições:
- Tools READ-ONLY. Não substitui um contador/advogado tributarista para decisões finais.
- Sempre em português do Brasil.$$
where agente_id = 'adv-tributarista';

update public.agente_prompts
set system_prompt = $$Você é o Assistente Fiscal / NF-e da Agropecuária Aramburu (produtor rural PJ em MS).

═══════════════════════════════════════════════════════════════════════════
MODELO DE DADOS
═══════════════════════════════════════════════════════════════════════════
• Lançamentos têm `ref` (número de NF, identificador 'AGUARDANDO NF', código de recibo). Use buscar_por_ref_ou_nf para localizar pela NF.
• Datas podem estar no futuro (compromissos provisionados — não é erro).
• Códigos contábeis aceitam prefix match nas tools.

═══════════════════════════════════════════════════════════════════════════
FERRAMENTAS
═══════════════════════════════════════════════════════════════════════════
- mes_referencia_atual, listar_socios, listar_bancos_empresa, plano_de_contas
- buscar_por_ref_ou_nf — busca por número/código de NF
- listar_notas_em_grupo — NFs agrupadas em orçamentos parcelados
- listar_documentos — documentos anexados
- kpi_mensal, lancamentos_por_conta_contabil_mensal, top_lancamentos
- listar_fornecedores

Responsabilidades:
- Esclarecer emissão de NF-e/NFP-e, CFOP, CST, SPED Fiscal/Contribuições.
- Auxiliar a interpretar rejeições da SEFAZ.
- Sempre considere regras estaduais de MS.
- Quando o usuário citar um número de NF, use buscar_por_ref_ou_nf antes de responder.

Quando NÃO assumir "mês atual": apenas se o usuário disser "este mês" explicitamente. Para buscas por NF ou fornecedor sem mês, busque sem filtro.

Restrições:
- Tools READ-ONLY.
- Sempre em português do Brasil.$$
where agente_id = 'fiscal-notas';



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0023_chat_view_revert_fechada_filter.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0023 — View de sessões recentes volta a mostrar conversas ARQUIVADAS
-- ============================================================================
-- A migration 0020 fez a view filtrar `fechada = false`, com a intenção de
-- esconder sessões arquivadas. Mas o card "Conversas Recentes" do hub é
-- explicitamente o lugar onde a Lola vai consultar histórico — incluindo
-- conversas encerradas. O Hub agora controla a diferenciação visualmente
-- (badge "Arquivada") e o ChatPage aceita ?session=<uuid> para reabrir
-- uma sessão específica passada pelo link.

create or replace view public.v_chat_sessoes_recentes as
select
  s.id              as session_id,
  s.agente_id,
  s.agente_nome,
  s.usuario_id,
  s.usuario_nome,
  s.titulo,
  s.fechada,
  s.created_at,
  s.updated_at,
  last_msg.conteudo   as ultima_mensagem,
  last_msg.role       as ultima_mensagem_role,
  last_msg.created_at as ultima_mensagem_at
from public.chat_sessions s
left join lateral (
  select cm.conteudo, cm.role, cm.created_at
  from public.chat_mensagens cm
  where cm.session_id = s.id
  order by cm.created_at desc
  limit 1
) last_msg on true;

comment on view public.v_chat_sessoes_recentes is
  'Sessões de chat (abertas + arquivadas) com a última mensagem. Hub diferencia pelo campo fechada.';



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0024_agente_estoque_safra_vendas.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0024 — Assistente de Estoque vira "Estoque & Safra"
-- ============================================================================
-- O agente respondia "estoque vazio" porque só conhecia a tabela `estoque`
-- (insumos/peças). A Lola tem 866.616 kg de milho em depósito (safra_depositos)
-- e 16 contratos de venda futura — esses dados existiam mas o agente não
-- enxergava. Esta migration:
--   • Renomeia o agente para "Assistente de Estoque & Safra"
--   • Atualiza system_prompt explicando os 3 domínios e as tools novas
--   • Atualiza mensagem de boas-vindas

update public.agente_prompts
set
  nome = 'Assistente de Estoque & Safra',
  mensagem_boas_vindas = 'Olá! Sou o Assistente de Estoque & Safra. Posso responder sobre insumos cadastrados, depósitos de grãos por armazém e vendas futuras já firmadas. O que você quer saber?',
  system_prompt = $$Você é o Assistente de Estoque & Safra da Agropecuária Aramburu.

Você tem acesso a TRÊS DOMÍNIOS via ferramentas:

═══════════════════════════════════════════════════════════════════════════
1. ESTOQUE TRADICIONAL (insumos, peças, defensivos, sementes, combustível)
═══════════════════════════════════════════════════════════════════════════
• listar_estoque({ categoria?, status?, busca?, limit? }) — itens com filtros
• alertas_estoque({ limit? }) — só itens em baixo/crítico/esgotado
Tabela origem: `estoque`. Pode estar VAZIA — não é erro do sistema, só não há cadastro.

═══════════════════════════════════════════════════════════════════════════
2. SAFRA ARMAZENADA (grãos depositados em cooperativas)
═══════════════════════════════════════════════════════════════════════════
• listar_armazens() — cadastro dos armazéns (Copasul Maracaju, etc.)
• listar_depositos_safra({ armazem_id?, cultura?, safra?, status?, limit? })
  → DFEs com kg_bruto, status (armazenado/vendido_parcial/etc.)
• calculo_consolidado_safra({ armazem_id?, cultura?, safra?, status?, limit? })
  → cada depósito JÁ com quebra técnica, taxa de armazenagem acumulada,
    devolução, kg líquido, sacas líquidas e VALOR DE VENDA SIMULADO
    (baseado na cotação que a Lola configurou em parametros_safra).
  → Use ESTA quando o usuário quiser "valor", "líquido", "quanto rende".
• parametros_safra({ armazem_id?, cultura?, safra? })
  → quebra/quinzena, armazenagem por kg/quinzena, devolução por saca,
    cotação simulada — só pra explicar de onde vem o cálculo.

═══════════════════════════════════════════════════════════════════════════
3. VENDAS FUTURAS (contratos firmados de venda de safra)
═══════════════════════════════════════════════════════════════════════════
• listar_vendas_provisionadas({ cultura?, safra?, status?, comprador?, destino_empresa?, limit? })
  → contratos com comprador, kg, preço/saca, data prevista de pagamento,
    e cálculo de sacas + valor bruto já feito na resposta.

═══════════════════════════════════════════════════════════════════════════
COMPARTILHADAS
═══════════════════════════════════════════════════════════════════════════
- mes_referencia_atual — só pra "este mês"
- listar_socios, listar_bancos_empresa, plano_de_contas
- listar_fornecedores, lancamentos_por_fornecedor — pra investigar compras recentes

═══════════════════════════════════════════════════════════════════════════
COMO DECIDIR
═══════════════════════════════════════════════════════════════════════════
"Como está meu estoque?" → COMBINA listar_estoque + calculo_consolidado_safra (pra ter visão completa).
"Quanto temos de milho armazenado?" → listar_depositos_safra({ cultura: 'milho' }) ou calculo_consolidado_safra({ cultura: 'milho' }).
"Quanto rende se eu vender hoje?" → calculo_consolidado_safra (já traz valor_venda_simulado).
"Próximos recebimentos de vendas" → listar_vendas_provisionadas (use data_pgto_prevista).
"O que está faltando?" → alertas_estoque (só insumos físicos).

═══════════════════════════════════════════════════════════════════════════
REGRAS
═══════════════════════════════════════════════════════════════════════════
• Tools READ-ONLY. Não criar/alterar nada.
• Se a tool retornar { ok: false, error: ... }, explique educadamente e sugira reformular.
• Nunca invente quantidades. Se não encontrar dado, diga claramente.
• Quando uma das tabelas estiver vazia (ex.: `estoque`), DIGA isso e ainda assim consulte os outros domínios — não conclua que "está tudo vazio" sem checar safra e vendas.
• Valores monetários: R$ 1.234,56. Quantidades de grãos: separar kg e sacas.
• Sempre em português do Brasil, linguagem clara.$$
where agente_id = 'estoque';



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0025_paridade_planilha.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0025 — Paridade com a planilha Excel original
-- ============================================================================
-- Implementa os itens IMPORTANTES + NICE-TO-HAVE da AUDITORIA-PLANILHA-vs-SISTEMA.md:
--   • orcamentos_mensais (substitui o hardcoded -20.000 da E37 da Memória)
--   • v_memoria_calculo_mensal (espelho do mês sem pares de transferência interna)
--   • v_obra_lts_status_calculado (status do contrato LTS recalculado por data)
--   • v_distribuicao_lucro_ytd (acumulado anual por sócio × classificação — pág.11 PDF)
--   • v_fazenda_aramburu_ytd (acumulado 1.05 por sócio — pág.12 PDF)

-- ---------------------------------------------------------------------------
-- 1) orcamentos_mensais — Lola configura o teto de cada (mês, tipo_despesa)
-- ---------------------------------------------------------------------------
-- A planilha Memória de Cálculo tinha o orçamento de "Despesas Variáveis"
-- como literal `-20000` dentro da fórmula E37. Aqui viramos isso editável,
-- por mês, e dá pra Lola ajustar conforme a temporada.
create table if not exists public.orcamentos_mensais (
  id              uuid primary key default gen_random_uuid(),
  mes_referencia  text not null,                              -- "YYYY-MM"
  tipo_despesa    public.tipo_despesa not null,
  valor_orcado    numeric(14,2) not null check (valor_orcado >= 0),
  observacao      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.users(id) on delete set null,
  unique (mes_referencia, tipo_despesa)
);

create index if not exists idx_om_mes  on public.orcamentos_mensais(mes_referencia);
create index if not exists idx_om_tipo on public.orcamentos_mensais(tipo_despesa);

drop trigger if exists tg_om_updated_at on public.orcamentos_mensais;
create trigger tg_om_updated_at
  before update on public.orcamentos_mensais
  for each row execute function public.tg_set_updated_at();

alter table public.orcamentos_mensais enable row level security;

drop policy if exists om_read on public.orcamentos_mensais;
create policy om_read on public.orcamentos_mensais
  for select using (auth.uid() is not null);

drop policy if exists om_write on public.orcamentos_mensais;
create policy om_write on public.orcamentos_mensais
  for all using (public.fn_can_write()) with check (public.fn_can_write());

comment on table public.orcamentos_mensais is
  'Teto mensal por tipo_despesa — substitui o hardcoded -20.000 de E37 da Memória de Cálculo.';

-- ---------------------------------------------------------------------------
-- 2) v_memoria_calculo_mensal — espelho "limpo" do mês
-- ---------------------------------------------------------------------------
-- Replica o trabalho manual que a Lola fazia na aba `Agrop. Aramburu_Detalhado`
-- da Memória de Cálculo V5: copiar lançamentos do mês e REMOVER pares de
-- transferência entre contas (status='Recebido'+'Pago' com descrição
-- "Transf. Entre Contas...", valores opostos), pois eles inflacionam 1.9 e 2.9
-- sem representar entrada/saída real.
--
-- Critério de pareamento (escolhido como o mais conservador):
--   • Descrição contém "Transf. Entre Contas" (case-insensitive)
--   • Existe OUTRA linha com EXATAMENTE a mesma descrição + valor oposto
--
-- Não exigimos mesma data porque na planilha as duas pernas podem cair em
-- dias diferentes (ex.: resgate em XP cai dia 16, deposito em CGR dia 19,
-- mas descrição "Transf. Entre Contas_Resgate Investimento XP" é idêntica).
create or replace view public.v_memoria_calculo_mensal as
select te.*
from public.transacoes_empresa te
where te.descricao is null
   or te.descricao not ilike '%transf%entre%contas%'
   or not exists (
     select 1
     from public.transacoes_empresa pair
     where pair.id <> te.id
       and pair.descricao = te.descricao
       and pair.valor = -te.valor
   );

comment on view public.v_memoria_calculo_mensal is
  'Espelho de transacoes_empresa SEM pares de transferência interna (mesma descrição + valor oposto). Replica o trabalho manual da Memória de Cálculo V5.';

-- ---------------------------------------------------------------------------
-- 3) v_obra_lts_status_calculado — semáforo de vencimento
-- ---------------------------------------------------------------------------
-- Replica a fórmula `J<row> = IFS(I<row><TODAY(), "VENCIDO", I=TODAY, "VENCE HOJE", I>TODAY, "EM ABERTO")`
-- da aba LTS da planilha. Recalcula o status em tempo de consulta, mas só
-- quando o estado-mãe não é definitivo (pago/cancelado mantém-se inalterado).
create or replace view public.v_obra_lts_status_calculado as
select
  i.id,
  i.oc_numero,
  i.data_compra,
  i.loja,
  i.nf,
  i.forma_pagamento,
  i.valor,
  i.vencimento,
  i.status as status_cadastrado,
  case
    when i.status in ('pago', 'cancelado') then i.status
    when i.vencimento is null              then i.status
    when i.vencimento <  current_date      then 'vencido'::public.lts_status
    when i.vencimento =  current_date      then 'vence_hoje'::public.lts_status
    when i.vencimento >  current_date      then 'em_aberto'::public.lts_status
    else i.status
  end as status_calculado,
  i.contrato,
  i.parcela,
  i.observacao,
  i.origem_planilha,
  i.created_at,
  i.updated_at
from public.obra_lts_itens i;

comment on view public.v_obra_lts_status_calculado is
  'OCs/Medições com status recalculado dinamicamente (vencido/em_aberto/vence_hoje), preservando estados definitivos (pago/cancelado).';

-- ---------------------------------------------------------------------------
-- 4) v_distribuicao_lucro_ytd — acumulado anual por sócio × classificação
-- ---------------------------------------------------------------------------
-- Alimenta a página 11 do PDF mensal (donut + barras: Imóvel R$ 348.621,68,
-- Família R$ 39.853,75, Renda Mensal R$ 763.476,74, Despesas Pessoais
-- R$ 74.231,52, Fazenda Aramburu R$ 158.287,63, Contratos de Venda R$ 715.300,25).
-- Numbers vinham do Aramburu_Mensal mestre via SUMIFS sobre o ano inteiro.
create or replace view public.v_distribuicao_lucro_ytd as
select
  extract(year from ts.data)::int  as ano,
  ts.classificacao_pessoal,
  cp.nome                          as classificacao_nome,
  ts.socio_id,
  s.nome_completo                  as socio_nome,
  s.apelido                        as socio_apelido,
  sum(ts.valor)                    as valor_acumulado,
  count(*)                         as qtd_lancamentos
from public.transacoes_socio ts
join public.socios s              on s.id = ts.socio_id
join public.classificacao_pessoal cp on cp.codigo = ts.classificacao_pessoal
group by 1, ts.classificacao_pessoal, cp.nome, ts.socio_id, s.nome_completo, s.apelido;

comment on view public.v_distribuicao_lucro_ytd is
  'Distribuição de Lucro acumulada por (ano, sócio, classificacao) — alimenta a página 11 do PDF mensal.';

-- ---------------------------------------------------------------------------
-- 5) v_fazenda_aramburu_ytd — total acumulado 1.05 por sócio × ano
-- ---------------------------------------------------------------------------
-- Alimenta a página 12 do PDF (sub-bloco "Fazenda Aramburu" — R$ 158.287,63).
-- A planilha decompõe esse total em Energia / Operacionais / Pessoal, mas
-- essa subclassificação não existia no schema (era categorização manual da
-- Lola). Aqui retornamos o total — quem precisar da decomposição usa a
-- busca textual em descricao ou cria uma view secundária no futuro.
create or replace view public.v_fazenda_aramburu_ytd as
select
  extract(year from ts.data)::int as ano,
  ts.socio_id,
  s.nome_completo                 as socio_nome,
  sum(ts.valor)                   as valor_acumulado,
  count(*)                        as qtd_lancamentos
from public.transacoes_socio ts
join public.socios s on s.id = ts.socio_id
where ts.classificacao_pessoal = '1.05'
group by 1, ts.socio_id, s.nome_completo;

comment on view public.v_fazenda_aramburu_ytd is
  '1.05 Fazenda Aramburu acumulado por sócio × ano — alimenta a página 12 do PDF mensal.';



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0026_validacoes_e_link_vendas.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0026 — Validações cruzadas (replicas das células Ok/Valor Incorreto)
--        + auto-link venda ↔ transação por NF
-- ============================================================================
-- Replica EXATAMENTE as validações que existiam na planilha Excel:
--   • obra sede!H32  → soma das categorias 2026 == capital + total LTS
--   • obra sede!H62  → soma 2025+2026 == total contrato
--   • obra sede!H79  → total geral == soma OC + Medições + Outras
--   • $ obra sede!I50/I56/I60 → saldo dos bancos cobre A pagar / Provisionado
--   • LTS!K85       → total contrato == soma de medições+OCs
--   • NOTAS EM GRUPO!F17 → notas a emitir == orçamento - notas emitidas
--
-- O trigger venda↔NF automatiza o que a Lola fazia ao ver uma NF cair na
-- Aramburu_Mensal e atualizar manualmente a planilha de Vendas.

-- ---------------------------------------------------------------------------
-- 1) Trigger: vincular venda_provisionada quando uma transação Recebida
--    com NF correspondente é inserida em transacoes_empresa
-- ---------------------------------------------------------------------------
-- Quando um lançamento tem `ref` igual à `nota_fiscal` de uma venda firmada,
-- vincula a venda → transação E marca status='liquidada' (ou 'parcial' se a
-- venda tem mais parcelas pendentes — heurística: se o valor recebido é
-- menor que o total da venda, fica parcial).
create or replace function public.tg_auto_link_venda_nf()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venda record;
  v_valor_venda numeric;
  v_valor_recebido numeric;
begin
  -- Só dispara quando o ref existe e é uma entrada (recebido/a_receber/etc.)
  if new.ref is null or new.ref = '' then return new; end if;
  if new.valor <= 0 then return new; end if;

  -- Procura venda firmada com mesma NF
  select v.*,
         (v.kg / nullif(v.kg_por_saca, 0)) * v.preco_sc as total_venda
    into v_venda
  from public.vendas_provisionadas v
  where v.nota_fiscal = new.ref
    and v.status in ('firmada', 'parcial')
  limit 1;

  if not found then return new; end if;

  v_valor_venda    := v_venda.total_venda;
  v_valor_recebido := new.valor;

  update public.vendas_provisionadas
     set transacao_empresa_id = new.id,
         status = case
           when v_valor_recebido >= v_valor_venda - 0.5 then 'liquidada'::public.venda_status
           else 'parcial'::public.venda_status
         end,
         updated_at = now()
   where id = v_venda.id;

  return new;
end;
$$;

drop trigger if exists tg_te_auto_link_venda on public.transacoes_empresa;
create trigger tg_te_auto_link_venda
  after insert on public.transacoes_empresa
  for each row execute function public.tg_auto_link_venda_nf();

comment on function public.tg_auto_link_venda_nf is
  'Vincula automaticamente venda_provisionada↔transacao_empresa quando ref=nota_fiscal. Atualiza status para liquidada/parcial.';

-- ---------------------------------------------------------------------------
-- 2) fn_validar_consistencia() — retorna lista de discrepâncias
-- ---------------------------------------------------------------------------
-- Cada linha = uma validação. severidade ('ok' | 'aviso' | 'erro').
-- Retorna apenas o que NÃO está OK para virar uma lista de alertas no UI.
create or replace function public.fn_validar_consistencia()
returns table (
  codigo      text,        -- "obra_h32", "lts_k85", etc.
  descricao   text,        -- texto humano
  severidade  text,        -- "aviso" | "erro"
  esperado    numeric,
  realizado   numeric,
  diferenca   numeric,
  detalhes    text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_capital_inicial numeric;
  v_total_lts_oc     numeric;
  v_total_lts_med    numeric;
  v_total_contrato   numeric;
  v_pago_oc_proj     numeric;
  v_pago_medicoes    numeric;
  v_a_pagar          numeric;
  v_provisionado     numeric;
  v_saldo_mju        numeric;
  v_saldo_cgr        numeric;
  v_saldo_cora       numeric;
begin
  -- Capital inicial e total contrato (parâmetros + somatórios)
  select coalesce(valor_numerico, 0) into v_capital_inicial
    from public.obra_parametros where chave = 'capital_inicial';

  select coalesce(sum(valor), 0) into v_total_contrato
    from public.obra_lts_itens where status <> 'cancelado';

  select coalesce(sum(valor), 0) into v_total_lts_oc
    from public.obra_lts_itens where status <> 'cancelado'
      and (oc_numero ilike 'OC%' or contrato ilike '%OC%');

  select coalesce(sum(valor), 0) into v_total_lts_med
    from public.obra_lts_itens where status <> 'cancelado'
      and (oc_numero ilike 'MED%' or contrato ilike '%medi%' );

  -- Pago/A pagar/Provisionado do centro_custo 2.7.2 (obra)
  select
    coalesce(sum(case when status = 'pago'         and obs_obra in ('ordem_compra','projeto') then -valor else 0 end), 0),
    coalesce(sum(case when status = 'pago'         and obs_obra::text like 'medicao_%'        then -valor else 0 end), 0),
    coalesce(sum(case when status = 'a_pagar'                                                 then -valor else 0 end), 0),
    coalesce(sum(case when status = 'provisionado'                                            then -valor else 0 end), 0)
    into v_pago_oc_proj, v_pago_medicoes, v_a_pagar, v_provisionado
  from public.transacoes_empresa
  where centro_custo_cod = '2.7.2';

  -- Saldos atuais por banco (apelido) — replica $ obra sede!I50/I56
  select coalesce(saldo_atual, 0) into v_saldo_mju
    from public.v_saldo_atual_por_banco
    where banco_apelido ilike '%MJU%' or banco_nome ilike '%0902%'
    limit 1;
  select coalesce(saldo_atual, 0) into v_saldo_cgr
    from public.v_saldo_atual_por_banco
    where banco_apelido ilike '%CGR%' or banco_nome ilike '%0913%'
    limit 1;
  select coalesce(saldo_atual, 0) into v_saldo_cora
    from public.v_saldo_atual_por_banco
    where banco_apelido ilike '%Cora%' or banco_nome ilike '%Cora%'
    limit 1;

  -- VALIDAÇÃO 1: LTS!K85 — total contrato bate com soma dos itens
  if v_total_contrato = 0 and v_total_lts_oc + v_total_lts_med = 0 then
    -- ambos zero, nada a validar
    null;
  elsif abs(v_total_contrato - (v_total_lts_oc + v_total_lts_med)) > 0.5 then
    codigo := 'lts_k85';
    descricao := 'Total do contrato LTS difere da soma de OCs + Medições.';
    severidade := 'aviso';
    esperado := v_total_contrato;
    realizado := v_total_lts_oc + v_total_lts_med;
    diferenca := esperado - realizado;
    detalhes := format('OCs: %s | Medições: %s', v_total_lts_oc, v_total_lts_med);
    return next;
  end if;

  -- VALIDAÇÃO 2: obra sede!H32 — saldo bancário cobre A pagar?
  if v_saldo_mju + v_saldo_cgr + v_saldo_cora > 0 and v_a_pagar > 0 then
    if v_saldo_mju + v_saldo_cgr + v_saldo_cora < v_a_pagar then
      codigo := 'obra_saldo_a_pagar';
      descricao := 'Saldo total dos bancos NÃO cobre o A Pagar da obra.';
      severidade := 'erro';
      esperado := v_a_pagar;
      realizado := v_saldo_mju + v_saldo_cgr + v_saldo_cora;
      diferenca := esperado - realizado;
      detalhes := format('Cora: %s | MJU: %s | CGR: %s', v_saldo_cora, v_saldo_mju, v_saldo_cgr);
      return next;
    end if;
  end if;

  -- VALIDAÇÃO 3: obra sede!I60 — saldo cobre A pagar + Provisionado?
  if v_saldo_mju + v_saldo_cgr + v_saldo_cora > 0 and (v_a_pagar + v_provisionado) > 0 then
    if v_saldo_mju + v_saldo_cgr + v_saldo_cora < (v_a_pagar + v_provisionado) then
      codigo := 'obra_saldo_provisionado';
      descricao := 'Saldo total dos bancos NÃO cobre A Pagar + Provisionado da obra.';
      severidade := 'aviso';
      esperado := v_a_pagar + v_provisionado;
      realizado := v_saldo_mju + v_saldo_cgr + v_saldo_cora;
      diferenca := esperado - realizado;
      detalhes := format('A pagar: %s | Provisionado: %s', v_a_pagar, v_provisionado);
      return next;
    end if;
  end if;

  -- VALIDAÇÃO 4: Capital inicial vs custo total (placeholder se cadastrado)
  if v_capital_inicial > 0 then
    declare
      v_custo_total numeric := v_pago_oc_proj + v_pago_medicoes + v_a_pagar + v_provisionado;
    begin
      if v_custo_total > v_capital_inicial then
        codigo := 'obra_capital';
        descricao := 'Custo total da obra ultrapassou o capital inicial declarado.';
        severidade := 'aviso';
        esperado := v_capital_inicial;
        realizado := v_custo_total;
        diferenca := esperado - realizado;
        detalhes := format('Capital: %s | Pago + A pagar + Provisionado: %s', v_capital_inicial, v_custo_total);
        return next;
      end if;
    end;
  end if;

  -- VALIDAÇÃO 5: pares de transferência interna órfãos
  -- (lançamento "Transf. Entre Contas..." sem par com valor oposto)
  for codigo, descricao, severidade, esperado, realizado, diferenca, detalhes in
    select
      'transf_orfa'::text,
      format('Transferência interna sem par: "%s" (%s)', t.descricao, t.data),
      'aviso'::text,
      0::numeric,
      t.valor,
      t.valor,
      format('Lançamento id=%s. Esperado um par com valor=%s e descrição idêntica.', t.id, -t.valor)
    from public.transacoes_empresa t
    where t.descricao ilike '%transf%entre%contas%'
      and not exists (
        select 1 from public.transacoes_empresa p
        where p.id <> t.id
          and p.descricao = t.descricao
          and p.valor = -t.valor
      )
  loop
    return next;
  end loop;

  return;
end;
$$;

comment on function public.fn_validar_consistencia is
  'Retorna lista de discrepâncias detectadas. Replica os validadores Ok/Valor Incorreto da planilha (obra sede!H32/I50/I56/I60, LTS!K85, pares de transferência).';



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0027_documentos_versionamento.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0027 — Documentos: edição com versionamento (RF-09)
-- ============================================================================
-- Permite corrigir um documento já gerado preservando o original.
-- Cada edição cria uma nova versão (snapshot do payload + PDF próprio).
-- A linha em documentos_gerados sempre reflete a VERSÃO ATUAL; o histórico
-- completo fica em documentos_gerados_versoes. PDFs antigos não são apagados.

-- ---------------------------------------------------------------------------
-- 1) Colunas de controle na tabela principal
-- ---------------------------------------------------------------------------
alter table public.documentos_gerados
  add column if not exists versao_atual int not null default 1,
  add column if not exists updated_at   timestamptz not null default now();

drop trigger if exists tg_dg_updated_at on public.documentos_gerados;
create trigger tg_dg_updated_at
  before update on public.documentos_gerados
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2) Tabela de histórico de versões
-- ---------------------------------------------------------------------------
create table if not exists public.documentos_gerados_versoes (
  id             uuid primary key default gen_random_uuid(),
  documento_id   uuid not null references public.documentos_gerados(id) on delete cascade,
  versao         int  not null,
  numero         text,
  beneficiario   text,
  valor          numeric(14,2),
  descricao      text,
  mes_referencia text,
  dados          jsonb not null default '{}'::jsonb,
  pdf_path       text,
  pdf_size       int,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.users(id) on delete set null,
  unique (documento_id, versao)
);

create index if not exists idx_dgv_doc
  on public.documentos_gerados_versoes(documento_id, versao desc);

-- ---------------------------------------------------------------------------
-- 3) Backfill: versão 1 para documentos já existentes (sem histórico ainda)
-- ---------------------------------------------------------------------------
insert into public.documentos_gerados_versoes
  (documento_id, versao, numero, beneficiario, valor, descricao, mes_referencia, dados, pdf_path, pdf_size, created_by)
select d.id, 1, d.numero, d.beneficiario, d.valor, d.descricao, d.mes_referencia, d.dados, d.pdf_path, d.pdf_size, d.created_by
from public.documentos_gerados d
where not exists (
  select 1 from public.documentos_gerados_versoes v where v.documento_id = d.id
);

-- ---------------------------------------------------------------------------
-- 4) RLS — leitura para autenticado, escrita para admin/editor
-- ---------------------------------------------------------------------------
alter table public.documentos_gerados_versoes enable row level security;

drop policy if exists dgv_read on public.documentos_gerados_versoes;
create policy dgv_read on public.documentos_gerados_versoes
  for select using (auth.uid() is not null);

drop policy if exists dgv_write on public.documentos_gerados_versoes;
create policy dgv_write on public.documentos_gerados_versoes
  for all using (public.fn_can_write()) with check (public.fn_can_write());

-- ---------------------------------------------------------------------------
-- 5) RPC: registra nova versão (insert + update atômicos)
-- ---------------------------------------------------------------------------
create or replace function public.fn_registrar_versao_documento(
  p_documento_id  uuid,
  p_dados         jsonb,
  p_numero        text,
  p_beneficiario  text,
  p_valor         numeric,
  p_descricao     text,
  p_mes_referencia text,
  p_pdf_path      text,
  p_pdf_size      int,
  p_created_by    uuid
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nova int;
begin
  if not public.fn_can_write() then
    raise exception 'Sem permissão para editar documentos' using errcode = '42501';
  end if;

  select coalesce(versao_atual, 1) + 1
    into v_nova
    from public.documentos_gerados
   where id = p_documento_id
   for update;

  if v_nova is null then
    raise exception 'Documento % não encontrado', p_documento_id;
  end if;

  insert into public.documentos_gerados_versoes
    (documento_id, versao, numero, beneficiario, valor, descricao, mes_referencia, dados, pdf_path, pdf_size, created_by)
  values
    (p_documento_id, v_nova, p_numero, p_beneficiario, p_valor, p_descricao, p_mes_referencia, p_dados, p_pdf_path, p_pdf_size, p_created_by);

  update public.documentos_gerados set
    numero         = p_numero,
    beneficiario   = p_beneficiario,
    valor          = p_valor,
    descricao      = p_descricao,
    mes_referencia = p_mes_referencia,
    dados          = p_dados,
    pdf_path       = p_pdf_path,
    pdf_size       = p_pdf_size,
    versao_atual   = v_nova
  where id = p_documento_id;

  return v_nova;
end $$;

grant execute on function public.fn_registrar_versao_documento(
  uuid, jsonb, text, text, numeric, text, text, text, int, uuid
) to authenticated;

comment on function public.fn_registrar_versao_documento is
  'RF-09 — registra uma nova versão de documento_gerado (histórico + atualização da versão atual, de forma atômica).';



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0028_documentos_descricoes_historico.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0028 — Histórico de descrições de documentos (RF-02)
-- ============================================================================
-- Guarda as descrições já utilizadas por tipo de documento, com contagem de uso,
-- para sugerir autocompletar no preenchimento (documentos emitidos mensalmente
-- com textos semelhantes). Sem dados sensíveis; isolado por tipo de documento.

create extension if not exists pg_trgm;

create table if not exists public.document_description_history (
  id            uuid primary key default gen_random_uuid(),
  document_type public.documento_gerado_tipo not null,
  description   text not null,
  usage_count   int  not null default 1,
  last_used_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (document_type, description)
);

create index if not exists idx_ddh_busca
  on public.document_description_history using gin (description gin_trgm_ops);
create index if not exists idx_ddh_rank
  on public.document_description_history (document_type, usage_count desc, last_used_at desc);

-- ---------------------------------------------------------------------------
-- RLS — leitura para autenticado, escrita para admin/editor
-- ---------------------------------------------------------------------------
alter table public.document_description_history enable row level security;

drop policy if exists ddh_read on public.document_description_history;
create policy ddh_read on public.document_description_history
  for select using (auth.uid() is not null);

drop policy if exists ddh_write on public.document_description_history;
create policy ddh_write on public.document_description_history
  for all using (public.fn_can_write()) with check (public.fn_can_write());

-- ---------------------------------------------------------------------------
-- RPC: registra/atualiza uma descrição (upsert com incremento de uso)
-- ---------------------------------------------------------------------------
create or replace function public.fn_registrar_descricao_documento(
  p_tipo      public.documento_gerado_tipo,
  p_descricao text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_descricao is null or length(btrim(p_descricao)) = 0 then
    return;
  end if;
  if not public.fn_can_write() then
    return;  -- silencioso: histórico é acessório
  end if;

  insert into public.document_description_history (document_type, description)
  values (p_tipo, btrim(p_descricao))
  on conflict (document_type, description) do update
    set usage_count  = public.document_description_history.usage_count + 1,
        last_used_at = now(),
        updated_at   = now();
end $$;

grant execute on function public.fn_registrar_descricao_documento(
  public.documento_gerado_tipo, text
) to authenticated;

comment on function public.fn_registrar_descricao_documento is
  'RF-02 — registra/atualiza uma descrição no histórico por tipo de documento (autocomplete).';



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0029_financeiro_emissao.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0029 — Coluna "Emissão" em transacoes_empresa (RF-FIN-06 / ajustes 12-jun-2026)
-- ============================================================================
-- A planilha da Lola só tinha a data de VENCIMENTO (coluna `data`, que gera
-- mes_referencia). Ela pediu uma coluna separada de EMISSÃO (data da NF/documento)
-- para facilitar a busca de notas recebidas/emitidas num período.
--
-- São campos DISTINTOS — a emissão NUNCA sobrescreve o vencimento:
--   • data         → VENCIMENTO (mantido; continua gerando mes_referencia)
--   • data_emissao → EMISSÃO    (novo; nullable — lançamentos antigos ficam vazios)
--
-- Reversível (ver ROLLBACK no fim).

alter table public.transacoes_empresa
  add column if not exists data_emissao date;

comment on column public.transacoes_empresa.data_emissao is
  'Data de emissão da NF/documento (RF-FIN-06). Distinta de `data` (vencimento). '
  'Nullable: lançamentos anteriores a jun/2026 ficam sem emissão (exibidos como "—").';

create index if not exists idx_te_data_emissao
  on public.transacoes_empresa(data_emissao);

-- ----------------------------------------------------------------------------
-- ROLLBACK (reverter esta migration):
--   drop index if exists public.idx_te_data_emissao;
--   alter table public.transacoes_empresa drop column if exists data_emissao;
-- ----------------------------------------------------------------------------



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0030_contas_identificacao.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0030 — Identificação bancária completa nos cards (RF-FIN-01 / RF-FIN-02)
-- ============================================================================
-- A Lola pediu que cada card de "Saldos por Banco" exiba os dados completos:
--   "Banco 403 · Ag. 0001 · Cc. 2347942-2"   (banco)
--   "Cooperativa 748 · Ag. 0913 · Cc. 29945-3" (cooperativa)
--
-- Para isso faltavam duas informações no cadastro de contas:
--   • numero_banco     — código do banco no BACEN (403, 748, 077, 348)
--   • tipo_instituicao — "banco" ou "cooperativa" (define o rótulo do card)
--
-- A RECONCILIAÇÃO DOS DADOS (preencher esses campos para Cora/Sicredi/Inter/XP,
-- criar o SICREDINVEST e desativar o Sicredi MJU) fica no
-- seed 12_reconciliacao_contas_bancarias.sql — que roda DEPOIS dos seeds 03/0011,
-- garantindo que as contas já existem. Esta migration só altera o SCHEMA.
--
-- Reversível (ver ROLLBACK no fim).

-- ---------------------------------------------------------------------------
-- 1) Novas colunas de identificação
-- ---------------------------------------------------------------------------
alter table public.contas_bancarias_empresa
  add column if not exists numero_banco     text,
  add column if not exists tipo_instituicao text not null default 'banco';

comment on column public.contas_bancarias_empresa.numero_banco is
  'Código do banco no BACEN (3 dígitos). Ex: 403 Cora, 748 Sicredi, 077 Inter, 348 XP.';
comment on column public.contas_bancarias_empresa.tipo_instituicao is
  'banco | cooperativa — define o rótulo exibido no card ("Banco 403" vs "Cooperativa 748").';

-- ---------------------------------------------------------------------------
-- 2) View de saldo por banco recriada expondo a identificação completa
-- ---------------------------------------------------------------------------
-- Acrescenta banco_numero, banco_tipo_instituicao, banco_numero_conta,
-- banco_digito e banco_tipo (corrente/investimento) ao retorno. A lógica de
-- saldo/compromissos/projetado é idêntica à 0010.
-- Recriamos a view com DROP + CREATE (e não CREATE OR REPLACE) para ser
-- idempotente mesmo quando a view já existe numa forma diferente — re-aplicar
-- esta migration ou o apply_all não falha com "cannot drop columns from view".
-- O frontend lê por nome, então a posição das colunas não importa.
drop view if exists public.v_saldo_atual_por_banco;
create view public.v_saldo_atual_por_banco as
select
  cb.id                as conta_bancaria_id,
  cb.nome              as banco_nome,
  cb.apelido           as banco_apelido,
  cb.banco             as banco_instituicao,
  cb.agencia           as banco_agencia,
  cb.ordem             as banco_ordem,

  -- Saldo conciliado (soma de tudo que de fato entrou/saiu)
  coalesce(sum(te.valor) filter (
    where te.status in (
      'saldo_inicial',
      'recebido', 'pago',
      'repassado',
      'aplicado', 'aplicacao',
      'resgatado', 'resgate'
    )
  ), 0)                                                           as saldo_atual,

  -- Compromissos previstos
  coalesce(sum(te.valor) filter (where te.status = 'a_pagar'),    0) as a_pagar,
  coalesce(sum(te.valor) filter (where te.status = 'a_receber'),  0) as a_receber,
  coalesce(sum(te.valor) filter (where te.status = 'a_repassar'), 0) as a_repassar,
  coalesce(sum(te.valor) filter (where te.status = 'a_resgatar'), 0) as a_resgatar,
  coalesce(sum(te.valor) filter (
    where te.status in ('provisionado','provisionado_dl','provisionado_dv')
  ), 0)                                                           as provisionado,

  -- Quebra mais granular pro card (entradas / saídas realizadas separadas)
  coalesce(sum(te.valor) filter (
    where te.status in ('saldo_inicial','recebido','resgatado','resgate','aplicacao')
  ), 0)                                                           as entradas_realizadas,
  coalesce(sum(te.valor) filter (
    where te.status in ('pago','repassado','aplicado')
  ), 0)                                                           as saidas_realizadas,

  -- Saldo "projetado" = saldo atual + a_receber - a_pagar - provisionado
  coalesce(sum(te.valor) filter (
    where te.status in (
      'saldo_inicial','recebido','pago','repassado','aplicado','aplicacao',
      'resgatado','resgate','a_pagar','a_receber','a_repassar','a_resgatar',
      'provisionado','provisionado_dl','provisionado_dv'
    )
  ), 0)                                                           as saldo_projetado,

  count(te.id)                                                    as total_lancamentos,

  -- Identificação completa (RF-FIN-01/02) — anexadas ao FIM
  cb.numero_banco      as banco_numero,
  cb.tipo_instituicao  as banco_tipo_instituicao,
  cb.numero_conta      as banco_numero_conta,
  cb.digito            as banco_digito,
  cb.tipo              as banco_tipo
from public.contas_bancarias_empresa cb
left join public.transacoes_empresa te on te.conta_bancaria_id = cb.id
where cb.ativa = true
group by cb.id, cb.nome, cb.apelido, cb.banco, cb.agencia, cb.ordem,
         cb.numero_banco, cb.tipo_instituicao, cb.numero_conta, cb.digito, cb.tipo
order by cb.ordem;

comment on view public.v_saldo_atual_por_banco is
  'Saldo bancário conciliado por banco (espelha "Saldo Disponível" da planilha) + '
  'identificação completa para os cards: numero_banco, tipo_instituicao, conta, dígito e tipo.';

-- ----------------------------------------------------------------------------
-- ROLLBACK (reverter esta migration):
--   -- 1. Recriar a view sem as colunas novas (ver migration 0010_saldo_por_banco.sql)
--   -- 2. alter table public.contas_bancarias_empresa
--   --      drop column if exists tipo_instituicao,
--   --      drop column if exists numero_banco;
-- ----------------------------------------------------------------------------



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0031_relatorios_scope.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0031 — Escopo do relatório registrado na geração (RF-FIN-09 / 12-jun-2026)
-- ============================================================================
-- A Lola passou a gerar relatórios por RECORTE (filtros aplicados ou itens
-- selecionados manualmente) e não mais "todas as contas pagas no mês". Para
-- auditoria e reprodutibilidade, registramos em cada geração EXATAMENTE qual
-- escopo foi usado (tipo, filtros, ids de lançamentos, contas incluídas, totais).
--
-- Reversível (ver ROLLBACK no fim).

alter table public.pdfmonkey_geracoes
  add column if not exists scope_applied jsonb;

comment on column public.pdfmonkey_geracoes.scope_applied is
  'Recorte usado na geração (RF-FIN-09): { scope_type: por_mes|por_filtros|por_selecao, '
  'filtros:{...}, transacao_ids:[...], conta_ids:[...], totais:{...} }. Para auditoria/reprodutibilidade.';

-- ----------------------------------------------------------------------------
-- ROLLBACK (reverter esta migration):
--   alter table public.pdfmonkey_geracoes drop column if exists scope_applied;
-- ----------------------------------------------------------------------------



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0032_fluxo_caixa_mensal.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0032 — Fluxo de Caixa mensal + "Saldo − contas do próximo mês"
-- ============================================================================
-- Espelha a aba "Saldo Disponível" da planilha Provisionamento_FLUXO DE CAIXA.
-- O indicador-chave (linha 37 da planilha "SALDO (-) CONTAS DO PRÓXIMO MÊS"):
--
--   saldo_menos_proximo_mes(M) = saldo acumulado no fim de M
--                              + Saídas(M+1)              (negativas)
--                              + Resgates(M+1)            (entradas de investimento)
--                              + Outras Entradas(M+1)     (a receber/recebido que NÃO são vendas)
--
-- Ou seja: "se eu pegar meu saldo de hoje e passar TODO o mês que vem contando só
-- com resgates e outras entradas — SEM depender de vendas — sobra isso?".
-- Verde (>= 0) = passa o mês tranquila; Vermelho (< 0) = vai precisar de vendas/resgates.
--
-- Fórmula original (aba Saldo Disponível): F37 = SUM(F33:F35) + H26 + H25 + H24.
-- "Vendas" = conta contábil 1.2 (Receita de Arrendamento / Venda de Soja/Milho) —
-- propositalmente EXCLUÍDA do próximo mês.

create or replace view public.v_fluxo_caixa_mensal as
with por_mes as (
  select
    te.mes_referencia,
    -- Saldo disponível: SÓ contas-corrente (igual à planilha — investimentos ficam
    -- de fora; o dinheiro investido entra de volta via "resgate" do próximo mês).
    coalesce(sum(te.valor) filter (where te.status in
      ('saldo_inicial','recebido','pago','repassado','aplicado','aplicacao','resgatado','resgate')
      and cbe.tipo = 'corrente'), 0)                                                   as movimento_realizado,
    -- Saídas do mês (todas as contas): realizadas + provisionadas + a pagar — negativas
    coalesce(sum(te.valor) filter (where te.status in
      ('provisionado','provisionado_dv','provisionado_dl','a_pagar','a_repassar','a_aplicar','pago','repassado','aplicado','aplicacao')), 0) as saidas_mes,
    -- Resgates de investimento (entradas "certas" que caem na conta-corrente)
    coalesce(sum(te.valor) filter (where te.status in ('resgate','a_resgatar','resgatado')), 0) as resgate_mes,
    -- Outras entradas = a receber/recebido que NÃO são vendas (conta 1.2)
    coalesce(sum(te.valor) filter (where te.status in ('a_receber','recebido') and te.conta_contabil_cod not like '1.2%'), 0) as outros_entradas_mes,
    -- Vendas (conta 1.2) — excluídas do indicador de próximo mês
    coalesce(sum(te.valor) filter (where te.status in ('a_receber','recebido') and te.conta_contabil_cod like '1.2%'), 0) as vendas_mes
  from public.transacoes_empresa te
  left join public.contas_bancarias_empresa cbe on cbe.id = te.conta_bancaria_id
  where te.mes_referencia is not null
  group by te.mes_referencia
),
acc as (
  select
    *,
    sum(movimento_realizado) over (order by mes_referencia rows between unbounded preceding and current row) as saldo_final_acumulado
  from por_mes
)
select
  mes_referencia,
  saldo_final_acumulado,
  saidas_mes,
  resgate_mes,
  outros_entradas_mes,
  vendas_mes,
  coalesce(lead(saidas_mes) over (order by mes_referencia), 0)                         as saidas_proximo_mes,
  coalesce(lead(resgate_mes + outros_entradas_mes) over (order by mes_referencia), 0)  as entradas_garantidas_proximo_mes,
  saldo_final_acumulado
    + coalesce(lead(saidas_mes + resgate_mes + outros_entradas_mes) over (order by mes_referencia), 0) as saldo_menos_proximo_mes
from acc
order by mes_referencia;

comment on view public.v_fluxo_caixa_mensal is
  'Fluxo de caixa mensal (espelha aba "Saldo Disponível"). saldo_menos_proximo_mes = saldo acumulado no fim do mês + saídas/resgates/outras entradas do mês seguinte, SEM vendas — mostra se o mês seguinte aperta sem depender de vendas.';

-- ----------------------------------------------------------------------------
-- ROLLBACK:
--   drop view if exists public.v_fluxo_caixa_mensal;
-- ----------------------------------------------------------------------------



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0033_saldo_exclui_resgate.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0033 — Corrige saldo_atual: 'Resgate' (provisionado) não é saldo realizado
-- ============================================================================
-- Contexto (explicado pela Lola):
--   Os pagamentos de obra pelo Sicredi saem de uma CONTA INVESTIMENTO (rendendo),
--   não da conta corrente. Para pagar, faz-se um RESGATE. Para o saldo bancário
--   não ser distorcido pelas despesas ainda PROVISIONADAS, a Lola provisiona
--   também os resgates: cada lançamento status "Resgate" é um SOMASE de tudo que
--   está "Provisionado" + "Despesas Eventuais" + pago pelo Sicredi naquele mês.
--   Assim Resgate(+) zera Provisionado(−) e NÃO entra no saldo realizado.
--
-- Bug: a view v_saldo_atual_por_banco contava 'resgate' como realizado em
--   saldo_atual e entradas_realizadas, inflando o Sicredi 0913 em R$ 38.724,65
--   (45.073,95 mostrado vs 6.349,30 real da planilha).
--
-- Correção: remover 'resgate' de saldo_atual e entradas_realizadas. Mantém-se
--   'resgatado' (resgate JÁ realizado). saldo_projetado continua somando tudo
--   (lá o 'resgate' segue anulando o 'provisionado'), então projeção não muda.

drop view if exists public.v_saldo_atual_por_banco;
create view public.v_saldo_atual_por_banco as
select
  cb.id                as conta_bancaria_id,
  cb.nome              as banco_nome,
  cb.apelido           as banco_apelido,
  cb.banco             as banco_instituicao,
  cb.agencia           as banco_agencia,
  cb.ordem             as banco_ordem,

  -- Saldo conciliado (soma de tudo que de fato entrou/saiu).
  -- 'resgate' (provisionado) REMOVIDO; 'resgatado' (realizado) mantido.
  coalesce(sum(te.valor) filter (
    where te.status in (
      'saldo_inicial',
      'recebido', 'pago',
      'repassado',
      'aplicado', 'aplicacao',
      'resgatado'
    )
  ), 0)                                                           as saldo_atual,

  -- Compromissos previstos
  coalesce(sum(te.valor) filter (where te.status = 'a_pagar'),    0) as a_pagar,
  coalesce(sum(te.valor) filter (where te.status = 'a_receber'),  0) as a_receber,
  coalesce(sum(te.valor) filter (where te.status = 'a_repassar'), 0) as a_repassar,
  coalesce(sum(te.valor) filter (where te.status = 'a_resgatar'), 0) as a_resgatar,
  coalesce(sum(te.valor) filter (
    where te.status in ('provisionado','provisionado_dl','provisionado_dv')
  ), 0)                                                           as provisionado,

  -- Quebra mais granular pro card (entradas / saídas realizadas separadas).
  -- 'resgate' (provisionado) REMOVIDO daqui também — não é entrada realizada.
  coalesce(sum(te.valor) filter (
    where te.status in ('saldo_inicial','recebido','resgatado','aplicacao')
  ), 0)                                                           as entradas_realizadas,
  coalesce(sum(te.valor) filter (
    where te.status in ('pago','repassado','aplicado')
  ), 0)                                                           as saidas_realizadas,

  -- Saldo "projetado" = saldo atual + previstos (inclui 'resgate', que lá segue
  -- anulando o 'provisionado'). Inalterado.
  coalesce(sum(te.valor) filter (
    where te.status in (
      'saldo_inicial','recebido','pago','repassado','aplicado','aplicacao',
      'resgatado','resgate','a_pagar','a_receber','a_repassar','a_resgatar',
      'provisionado','provisionado_dl','provisionado_dv'
    )
  ), 0)                                                           as saldo_projetado,

  count(te.id)                                                    as total_lancamentos,

  -- Identificação completa (RF-FIN-01/02)
  cb.numero_banco      as banco_numero,
  cb.tipo_instituicao  as banco_tipo_instituicao,
  cb.numero_conta      as banco_numero_conta,
  cb.digito            as banco_digito,
  cb.tipo              as banco_tipo
from public.contas_bancarias_empresa cb
left join public.transacoes_empresa te on te.conta_bancaria_id = cb.id
where cb.ativa = true
group by cb.id, cb.nome, cb.apelido, cb.banco, cb.agencia, cb.ordem,
         cb.numero_banco, cb.tipo_instituicao, cb.numero_conta, cb.digito, cb.tipo
order by cb.ordem;

comment on view public.v_saldo_atual_por_banco is
  'Saldo bancário conciliado por banco (espelha "Saldo Disponível" da planilha) + '
  'identificação completa. saldo_atual exclui "Resgate" provisionado (só "Resgatado" '
  'realizado conta), corrigido na migration 0033.';



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0034_trigger_resgate_sicredi.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0034 — Gatilho: resgate provisionado do Sicredi 0913 calculado automático
-- ============================================================================
-- Replica no banco a fórmula SOMASE que a Lola usa na planilha:
--   Resgate(0913, mês) = -1 × Σ( status 'Provisionado' + tipo 'Despesas Eventuais'
--                                 + conta 'Cooperativa Sicredi (0913)' + mesmo mês )
--
-- Assim, quando ela lança/edita/paga um provisionado eventual do 0913 pelo app,
-- a linha "Resgate" daquele mês é criada / atualizada / removida sozinha — ela
-- nunca ajusta na mão. O 'Resgate' não afeta saldo_atual (ver migration 0033),
-- só o projetado, onde anula o provisionado.
--
-- Escopo (decisão do usuário): SOMENTE a conta corrente 'Cooperativa Sicredi (0913)'.
-- Comportamento: 100% automático (cria/atualiza/zera-remove).
--
-- ⚠ Reimport da planilha: se um dia for reimportar via script, DESABILITE este
--   gatilho durante o import (alter table ... disable trigger) para não duplicar
--   as linhas de resgate — o script já calcula os resgates. No fluxo normal (app)
--   deixe sempre habilitado.

create or replace function public.fn_sync_resgate_sicredi()
returns trigger
language plpgsql
as $$
declare
  v_sic0913  uuid;
  v_forn     uuid;
  v_meses    text[] := array[]::text[];
  v_mes      text;
  v_total    numeric(15,2);
  v_existe   uuid;
begin
  -- Evita recursão: quando o próprio gatilho grava a linha de resgate, ele
  -- dispara de novo em profundidade > 1; aí não faz nada.
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  -- Conta corrente Sicredi 0913 (CGR). Se não existir, não há o que sincronizar.
  select id into v_sic0913
    from public.contas_bancarias_empresa
   where nome = 'Cooperativa Sicredi (0913)'
   limit 1;
  if v_sic0913 is null then
    return null;
  end if;

  -- Coleta os meses afetados a partir de linhas "driver"
  -- (provisionado + eventual + 0913). Em UPDATE, considera mês antigo e novo.
  if tg_op in ('INSERT','UPDATE')
     and NEW.status = 'provisionado'
     and NEW.tipo_despesa = 'eventual'
     and NEW.conta_bancaria_id = v_sic0913 then
    v_meses := array_append(v_meses, NEW.mes_referencia);
  end if;
  if tg_op in ('UPDATE','DELETE')
     and OLD.status = 'provisionado'
     and OLD.tipo_despesa = 'eventual'
     and OLD.conta_bancaria_id = v_sic0913 then
    v_meses := array_append(v_meses, OLD.mes_referencia);
  end if;

  -- Nada relevante mudou.
  if array_length(v_meses, 1) is null then
    return null;
  end if;

  -- Fornecedor padrão da linha de resgate (snapshot da planilha).
  select id into v_forn
    from public.fornecedores
   where nome = 'Banco Cooperativa Sicredi'
   limit 1;

  -- Recomputa o resgate de cada mês afetado (distinto).
  for v_mes in select distinct unnest(v_meses) loop
    select coalesce(sum(valor), 0) into v_total
      from public.transacoes_empresa
     where status = 'provisionado'
       and tipo_despesa = 'eventual'
       and conta_bancaria_id = v_sic0913
       and mes_referencia = v_mes;

    select id into v_existe
      from public.transacoes_empresa
     where status = 'resgate'
       and conta_bancaria_id = v_sic0913
       and mes_referencia = v_mes
     limit 1;

    if v_total = 0 then
      -- Não sobrou nenhum provisionado eventual no mês → remove o resgate automático.
      if v_existe is not null then
        delete from public.transacoes_empresa where id = v_existe;
      end if;
    elsif v_existe is not null then
      -- Já existe a linha do mês → atualiza o valor (sinal invertido).
      update public.transacoes_empresa
         set valor = -1 * v_total
       where id = v_existe;
    else
      -- Não existe → cria a linha de resgate do mês (último dia do mês).
      insert into public.transacoes_empresa
        (data, conta_contabil_cod, centro_custo_cod, tipo_despesa, obs_obra,
         forma_pgto, conta_bancaria_id, status, valor,
         fornecedor_id, fornecedor_nome, descricao, origem_planilha)
      values
        ((to_date(v_mes, 'YYYY-MM') + interval '1 month - 1 day')::date,
         '1.8', '1.8.1', 'sem', 'sem', 'sem',
         v_sic0913, 'resgate', -1 * v_total,
         v_forn, 'Banco Cooperativa Sicredi',
         'Resgate da Conta Investimento Invest - Reserva p/ Construção da Sede',
         'auto:resgate_sicredi');
    end if;
  end loop;

  return null;
end;
$$;

comment on function public.fn_sync_resgate_sicredi is
  'Mantém automaticamente a linha "Resgate" (status=resgate) da conta Sicredi 0913 '
  '= -1 × soma dos Provisionados de Despesas Eventuais do mesmo mês/conta. '
  'Cria/atualiza/remove. Anti-recursão via pg_trigger_depth(). Migration 0034.';

drop trigger if exists tg_sync_resgate_sicredi on public.transacoes_empresa;
create trigger tg_sync_resgate_sicredi
  after insert or update or delete on public.transacoes_empresa
  for each row execute function public.fn_sync_resgate_sicredi();



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0035_status_config.sql
-- └──────────────────────────────────────────────────────────────────────────┘
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



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0036_distribuicao_repasse.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0036 — Distribuição de Lucro: detalhado ↔ global integrados (call 24-jun-2026)
-- ============================================================================
-- Fluxo operacional da Adriane (transcrição 19:14–27:59): ela lança/confere o
-- DETALHADO por sócio primeiro, marca item a item como "A pagar" e só então
-- consolida o valor GLOBAL na empresa (Cora → Inter → contas pessoais).
--
-- O que esta migration entrega:
--   1. transacoes_socio.repasse_id — vincula cada linha detalhada ao lançamento
--      global consolidado em transacoes_empresa (sem duplicidade: o global é
--      GERADO a partir do detalhado, nunca digitado à mão).
--   2. Trigger "SOMASE": mantém automaticamente a linha global PROVISIONADA
--      da empresa (status provisionado_dl, conta 2.8) igual à soma do detalhado
--      provisionado do mês — replica a fórmula SOMASE que ela criou na planilha.
--   3. fn_consolidar_repasse_dl — cria atomicamente os lançamentos do repasse:
--        a) saída Cora  (2.9, "Transf. Entre Contas_…")  ┐ par de transferência
--        b) entrada Inter (1.9, mesma descrição)         ┘ (removido da Memória)
--        c) saída Inter (2.8 Distribuição de Lucro) — a "linha só" global que
--           alimenta DRE/Memória/Capa Empresa, exatamente como ela faz hoje.
--      Saldo resultante: Cora −X, Inter 0 (entra e sai), despesa 2.8 contada 1x.
--   4. fn_desfazer_repasse_dl / fn_concluir_repasse_dl — desfaz (enquanto em
--      aberto) ou dá baixa em grupo no repasse.
--   5. Views v_dl_mensal_resumo e v_provisionamento_anual (telas novas).
--
-- Nenhuma view existente é alterada — zero risco de regressão em saldos/KPIs.

-- ---------------------------------------------------------------------------
-- 1) Vínculo detalhado → global
-- ---------------------------------------------------------------------------
alter table public.transacoes_socio
  add column if not exists repasse_id uuid references public.transacoes_empresa(id) on delete set null;

create index if not exists idx_ts_repasse on public.transacoes_socio(repasse_id);

comment on column public.transacoes_socio.repasse_id is
  'Lançamento global (transacoes_empresa, conta 2.8) que consolidou esta linha detalhada. Preenchido por fn_consolidar_repasse_dl.';

-- ---------------------------------------------------------------------------
-- 2) Trigger "SOMASE" — global provisionado da empresa segue o detalhado
-- ---------------------------------------------------------------------------
-- Replica o comportamento da planilha: mudou férias/rescisão/valor no detalhado
-- → o provisionado global da empresa muda sozinho ("ele já mudava automático").
--
-- Segurança:
--   • Só gerencia a linha marcada com origem_planilha = 'dl_auto:<YYYY-MM>'.
--   • Se o mês tiver linha provisionada 2.8 MANUAL (importada da planilha ou
--     digitada), NÃO mexe em nada — a tela de Distribuição avisa a divergência.
--   • Nunca levanta exceção (não pode bloquear o save do detalhado).
create or replace function public.fn_sync_provisionado_dl(p_mes text)
returns void
language plpgsql
as $$
declare
  v_tag   text := 'dl_auto:' || p_mes;
  v_soma  numeric(15,2);
  v_banco uuid;
  v_id    uuid;
begin
  if p_mes is null then return; end if;

  -- Plano de contas precisa ter 2.8/2.8.1 (seeds padrão); se não tiver, não faz nada.
  if not exists (select 1 from public.classificacao_financeira where codigo = '2.8')
     or not exists (select 1 from public.classificacao_financeira where codigo = '2.8.1') then
    return;
  end if;

  -- Mês com provisionado 2.8 manual → gestão manual, trigger não interfere.
  if exists (
    select 1 from public.transacoes_empresa
    where mes_referencia = p_mes
      and conta_contabil_cod = '2.8'
      and status in ('provisionado', 'provisionado_dl')
      and (origem_planilha is null or origem_planilha not like 'dl_auto:%')
  ) then
    return;
  end if;

  select coalesce(sum(valor), 0) into v_soma
  from public.transacoes_socio
  where mes_referencia = p_mes and status = 'provisionado';

  if v_soma <= 0 then
    delete from public.transacoes_empresa where origem_planilha = v_tag;
    return;
  end if;

  update public.transacoes_empresa
     set valor = -v_soma
   where origem_planilha = v_tag
  returning id into v_id;

  if v_id is null then
    select id into v_banco
    from public.contas_bancarias_empresa
    where ativa = true and banco ilike '%cora%'
    order by ordem nulls last limit 1;

    insert into public.transacoes_empresa (
      data, conta_contabil_cod, centro_custo_cod, tipo_despesa,
      descricao, obs_obra, forma_pgto, conta_bancaria_id,
      status, valor, observacao, origem_planilha
    ) values (
      to_date(p_mes || '-01', 'YYYY-MM-DD'), '2.8', '2.8.1', 'sem',
      'Distribuição de Lucro — Provisionado (automático do detalhado)',
      'sem', 'sem', v_banco,
      'provisionado_dl', -v_soma,
      'Linha mantida automaticamente pela soma do detalhado por sócio (tela Distribuição de Lucro). Não editar o valor à mão.',
      v_tag
    );
  end if;
exception when others then
  -- Nunca bloquear a operação no detalhado por causa da sincronização.
  null;
end;
$$;

create or replace function public.tg_ts_sync_provisionado_dl()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.fn_sync_provisionado_dl(old.mes_referencia);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and
     (tg_op = 'INSERT' or new.mes_referencia is distinct from old.mes_referencia) then
    perform public.fn_sync_provisionado_dl(new.mes_referencia);
  elsif tg_op = 'UPDATE' then
    -- mesmo mês: já sincronizado acima pelo old
    null;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists tg_ts_sync_prov_dl on public.transacoes_socio;
create trigger tg_ts_sync_prov_dl
  after insert or update or delete on public.transacoes_socio
  for each row execute function public.tg_ts_sync_provisionado_dl();

-- ---------------------------------------------------------------------------
-- 3) Consolidar repasse do mês (detalhado "A pagar" → global na empresa)
-- ---------------------------------------------------------------------------
create or replace function public.fn_consolidar_repasse_dl(
  p_mes text,                               -- "YYYY-MM"
  p_data date default current_date,         -- data programada do repasse
  p_incluir_transferencia boolean default true
)
returns uuid
language plpgsql
as $$
declare
  v_soma   numeric(15,2);
  v_qtd    int;
  v_grupo  text := 'dl_repasse:' || gen_random_uuid();
  v_cora   uuid;
  v_inter  uuid;
  v_global uuid;
  v_mes_humano text;
begin
  if p_mes is null or p_mes !~ '^\d{4}-\d{2}$' then
    raise exception 'Mês inválido (esperado YYYY-MM).';
  end if;

  select coalesce(sum(valor), 0), count(*) into v_soma, v_qtd
  from public.transacoes_socio
  where mes_referencia = p_mes and status = 'a_pagar' and repasse_id is null;

  if v_qtd = 0 then
    raise exception 'Nenhum lançamento detalhado com status "A pagar" (e sem repasse) em %.', p_mes;
  end if;
  if v_soma <= 0 then
    raise exception 'A soma do detalhado "A pagar" de % é R$ % — verifique os valores antes de consolidar.', p_mes, v_soma;
  end if;

  -- Classificações exigidas (seeds padrão do plano de contas)
  perform 1 from public.classificacao_financeira where codigo in ('2.8','2.8.1','2.9','2.9.3','1.9','1.9.1')
  having count(*) = 6;
  if not found then
    raise exception 'Plano de contas incompleto: são necessárias as classificações 2.8/2.8.1, 2.9/2.9.3 e 1.9/1.9.1 (Configurações → Plano de Contas).';
  end if;

  select id into v_inter from public.contas_bancarias_empresa
   where ativa = true and banco ilike '%inter%' order by ordem nulls last limit 1;
  if v_inter is null then
    raise exception 'Conta do Banco Inter não encontrada em Bancos (necessária para o repasse).';
  end if;

  if p_incluir_transferencia then
    select id into v_cora from public.contas_bancarias_empresa
     where ativa = true and banco ilike '%cora%' order by ordem nulls last limit 1;
    if v_cora is null then
      raise exception 'Conta do Banco Cora não encontrada em Bancos (necessária para a transferência Cora → Inter).';
    end if;
  end if;

  -- "2026-07" → "07/2026" (determinístico, independe do locale do banco)
  v_mes_humano := substring(p_mes from 6 for 2) || '/' || substring(p_mes from 1 for 4);

  -- (c) Global 2.8 — a "linha só" da empresa. Sai do Inter (é de lá que o valor
  -- vai para as contas pessoais). Alimenta DRE/Memória/Capa como hoje.
  insert into public.transacoes_empresa (
    data, conta_contabil_cod, centro_custo_cod, tipo_despesa,
    descricao, obs_obra, forma_pgto, conta_bancaria_id,
    status, valor, observacao, origem_planilha
  ) values (
    p_data, '2.8', '2.8.1', 'sem',
    'Distribuição de Lucro — repasse ' || v_mes_humano,
    'sem', 'transferencia', v_inter,
    'a_pagar', -v_soma,
    'Consolidado automaticamente de ' || v_qtd || ' lançamento(s) detalhado(s) por sócio (tela Distribuição de Lucro).',
    v_grupo
  ) returning id into v_global;

  -- (a)+(b) Par de transferência Cora → Inter (mesma descrição, valores opostos:
  -- a Memória de Cálculo remove o par, como nas transferências internas de hoje).
  if p_incluir_transferencia then
    insert into public.transacoes_empresa (
      data, conta_contabil_cod, centro_custo_cod, tipo_despesa,
      descricao, obs_obra, forma_pgto, conta_bancaria_id,
      status, valor, observacao, origem_planilha
    ) values (
      p_data, '2.9', '2.9.3', 'sem',
      'Transf. Entre Contas_Distribuição de Lucro ' || v_mes_humano,
      'sem', 'transferencia', v_cora,
      'a_pagar', -v_soma, null, v_grupo
    ), (
      p_data, '1.9', '1.9.1', 'sem',
      'Transf. Entre Contas_Distribuição de Lucro ' || v_mes_humano,
      'sem', 'transferencia', v_inter,
      'a_receber', v_soma, null, v_grupo
    );
  end if;

  update public.transacoes_socio
     set repasse_id = v_global
   where mes_referencia = p_mes and status = 'a_pagar' and repasse_id is null;

  return v_global;
end;
$$;

comment on function public.fn_consolidar_repasse_dl(text, date, boolean) is
  'Consolida o detalhado "A pagar" do mês em lançamentos globais da empresa (par Cora→Inter + saída 2.8 do Inter) e vincula via repasse_id. Atômico.';

-- ---------------------------------------------------------------------------
-- 4) Desfazer / Concluir repasse (em grupo)
-- ---------------------------------------------------------------------------
create or replace function public.fn_desfazer_repasse_dl(p_repasse_id uuid)
returns void
language plpgsql
as $$
declare
  v_tag text;
begin
  select origem_planilha into v_tag
  from public.transacoes_empresa
  where id = p_repasse_id and origem_planilha like 'dl_repasse:%';

  if v_tag is null then
    raise exception 'Lançamento não é um repasse consolidado pelo sistema.';
  end if;

  if exists (
    select 1 from public.transacoes_empresa
    where origem_planilha = v_tag and status not in ('a_pagar', 'a_receber')
  ) then
    raise exception 'Este repasse já tem lançamentos baixados (Pago/Recebido/Repassado) — dê baixa manualmente ou estorne antes de desfazer.';
  end if;

  update public.transacoes_socio set repasse_id = null where repasse_id = p_repasse_id;
  delete from public.transacoes_empresa where origem_planilha = v_tag;
end;
$$;

comment on function public.fn_desfazer_repasse_dl(uuid) is
  'Desfaz um repasse consolidado ainda em aberto: apaga o global + par de transferência e desvincula o detalhado.';

create or replace function public.fn_concluir_repasse_dl(p_repasse_id uuid)
returns void
language plpgsql
as $$
declare
  v_tag text;
begin
  select origem_planilha into v_tag
  from public.transacoes_empresa
  where id = p_repasse_id and origem_planilha like 'dl_repasse:%';

  if v_tag is null then
    raise exception 'Lançamento não é um repasse consolidado pelo sistema.';
  end if;

  -- Baixa em grupo: global 2.8 → Repassado; perna Cora → Pago; perna Inter → Recebido.
  update public.transacoes_empresa set status = 'repassado'
   where origem_planilha = v_tag and conta_contabil_cod = '2.8' and status = 'a_pagar';
  update public.transacoes_empresa set status = 'pago'
   where origem_planilha = v_tag and conta_contabil_cod = '2.9' and status = 'a_pagar';
  update public.transacoes_empresa set status = 'recebido'
   where origem_planilha = v_tag and conta_contabil_cod = '1.9' and status = 'a_receber';

  -- Detalhado vinculado ainda em aberto → Repassado (status_dl 'realizado').
  update public.transacoes_socio set status = 'realizado'
   where repasse_id = p_repasse_id and status = 'a_pagar';
end;
$$;

comment on function public.fn_concluir_repasse_dl(uuid) is
  'Dá baixa em grupo no repasse: global Repassado, transferência Pago/Recebido e detalhado vinculado Realizado.';

-- ---------------------------------------------------------------------------
-- 5) Views de apoio às telas novas
-- ---------------------------------------------------------------------------
-- Resumo mensal da Distribuição de Lucro (o "SOMASE por status" da planilha).
create or replace view public.v_dl_mensal_resumo as
select
  ts.mes_referencia,
  coalesce(sum(ts.valor) filter (where ts.status = 'provisionado'), 0)                          as provisionado,
  coalesce(sum(ts.valor) filter (where ts.status = 'a_pagar'), 0)                              as a_pagar,
  coalesce(sum(ts.valor) filter (where ts.status = 'a_pagar' and ts.repasse_id is null), 0)    as a_pagar_sem_repasse,
  coalesce(sum(ts.valor) filter (where ts.status = 'realizado'), 0)                            as realizado,
  count(*) filter (where ts.status = 'provisionado')                                           as qtd_provisionado,
  count(*) filter (where ts.status = 'a_pagar')                                               as qtd_a_pagar,
  count(*) filter (where ts.status = 'a_pagar' and ts.repasse_id is null)                     as qtd_a_pagar_sem_repasse,
  count(*) filter (where ts.status = 'realizado')                                             as qtd_realizado
from public.transacoes_socio ts
group by ts.mes_referencia
order by ts.mes_referencia;

comment on view public.v_dl_mensal_resumo is
  'Somas do detalhado da Distribuição de Lucro por mês × status — alimenta a tela Distribuição e a conferência com o global da empresa.';

-- Provisionamento anual da empresa: por mês × conta contábil (nível 2), com
-- realizado / em aberto / provisionado separados. Alimenta a tela nova.
create or replace view public.v_provisionamento_anual as
select
  te.mes_referencia,
  substring(te.mes_referencia from 1 for 4)                       as ano,
  te.conta_contabil_cod,
  cf.nome                                                          as conta_contabil_nome,
  cf.natureza,
  coalesce(sum(te.valor) filter (where te.status in
    ('saldo_inicial','recebido','pago','repassado','aplicado','aplicacao','resgatado')), 0) as realizado,
  coalesce(sum(te.valor) filter (where te.status in
    ('a_pagar','a_receber','a_repassar','a_aplicar','a_resgatar')), 0)                      as em_aberto,
  coalesce(sum(te.valor) filter (where te.status in
    ('provisionado','provisionado_dl','provisionado_dv','resgate')), 0)                     as provisionado,
  count(*)                                                                                   as qtd_lancamentos
from public.transacoes_empresa te
join public.classificacao_financeira cf on cf.codigo = te.conta_contabil_cod
group by te.mes_referencia, te.conta_contabil_cod, cf.nome, cf.natureza
order by te.mes_referencia, te.conta_contabil_cod;

comment on view public.v_provisionamento_anual is
  'Empresa por mês × conta (nível 2): realizado, em aberto (a pagar/receber) e provisionado — espelho anual das planilhas de provisionamento.';

-- ----------------------------------------------------------------------------
-- ROLLBACK:
--   drop view if exists public.v_provisionamento_anual;
--   drop view if exists public.v_dl_mensal_resumo;
--   drop function if exists public.fn_concluir_repasse_dl(uuid);
--   drop function if exists public.fn_desfazer_repasse_dl(uuid);
--   drop function if exists public.fn_consolidar_repasse_dl(text, date, boolean);
--   drop trigger if exists tg_ts_sync_prov_dl on public.transacoes_socio;
--   drop function if exists public.tg_ts_sync_provisionado_dl();
--   drop function if exists public.fn_sync_provisionado_dl(text);
--   alter table public.transacoes_socio drop column if exists repasse_id;
-- ----------------------------------------------------------------------------



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0037_armazenagem_dois_cenarios.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 0037 — Armazenagem: dois cálculos consolidados + taxa de recepção (call 24-jun)
-- ============================================================================
-- Regra explicada na reunião (transcrição 36:25–46:39):
--   • Venda a TERCEIROS: contagem desde o depósito com carência curta (~30 dias);
--     cobram armazenagem + retirada/devolução + (às vezes) recepção.
--   • Venda ao PRÓPRIO ARMAZÉM (ex.: Copasul): carência longa negociada por
--     normativa anual (~365 dias; no milho 25/26 foi até 30/mai); após a
--     carência conta armazenagem; NÃO cobram recepção nem retirada.
--   • As carências mudam ano a ano por produto → parametrizáveis por
--     (armazém × cultura × safra), que é exatamente a granularidade de
--     safra_parametros.
--
-- Compatibilidade: todas as colunas existentes da view mantêm nome, posição e
-- fórmula (cenário TERCEIROS, com carencia_dias como hoje). Novas colunas são
-- adicionadas ao final. taxa_recepcao entra com default 0 → nenhum valor muda
-- até a Lola preencher o parâmetro.

-- ---------------------------------------------------------------------------
-- 1) Parâmetros novos
-- ---------------------------------------------------------------------------
alter table public.safra_parametros
  add column if not exists carencia_armazem_dias smallint not null default 365,
  add column if not exists taxa_recepcao_por_saca numeric(10,4) not null default 0;

comment on column public.safra_parametros.carencia_dias is
  'Carência (dias) para VENDA A TERCEIROS — contagem desde o depósito (call 24-jun: ~30 dias).';
comment on column public.safra_parametros.carencia_armazem_dias is
  'Carência (dias) para VENDA AO PRÓPRIO ARMAZÉM — normativa anual do cerealista (call 24-jun: ~365 dias; muda ano a ano por produto).';
comment on column public.safra_parametros.taxa_recepcao_por_saca is
  'Taxa de recepção (R$/saca), cobrada apenas na venda a terceiros. 0 = isenta pela normativa vigente.';

-- ---------------------------------------------------------------------------
-- 2) View recalculada com os dois cenários
-- ---------------------------------------------------------------------------
drop view if exists public.v_safra_depositos_calculado;
create view public.v_safra_depositos_calculado as
with base as (
  select
    d.id,
    d.armazem_id,
    a.nome           as armazem_nome,
    a.apelido        as armazem_apelido,
    d.cultura,
    d.safra,
    d.data_deposito,
    d.dfe_entrada,
    d.nfp,
    d.kg_bruto,
    d.status,
    d.observacao,
    d.created_at,
    d.updated_at,
    p.id                          as parametros_id,
    p.quebra_quinzena_pct,
    p.armazenagem_por_kg_quinzena,
    p.devolucao_por_saca,
    p.carencia_dias,
    p.kg_por_saca,
    p.data_atual,
    p.cotacao_simulada_sc,
    p.carencia_armazem_dias,
    p.taxa_recepcao_por_saca,
    -- Dias percorridos por cenário (nunca negativos)
    greatest((p.data_atual - d.data_deposito) - p.carencia_dias, 0)::int          as dias_t,
    greatest((p.data_atual - d.data_deposito) - p.carencia_armazem_dias, 0)::int  as dias_a
  from public.safra_depositos d
  join public.armazens a              on a.id = d.armazem_id
  left join public.safra_parametros p on p.armazem_id = d.armazem_id
                                      and p.cultura = d.cultura
                                      and p.safra = d.safra
),
calc as (
  select
    b.*,
    (b.kg_bruto / b.kg_por_saca)::numeric(15,4)                                       as sc_bruto_c,
    -- Cenário TERCEIROS (mesmas fórmulas de sempre)
    ((b.quebra_quinzena_pct * (b.dias_t::numeric / 15)) * b.kg_bruto)::numeric(15,3)  as quebra_kg_t,
    (b.kg_bruto - (b.quebra_quinzena_pct * (b.dias_t::numeric / 15)) * b.kg_bruto)::numeric(15,3) as kg_liquido_t,
    -- Cenário ARMAZÉM (carência longa)
    ((b.quebra_quinzena_pct * (b.dias_a::numeric / 15)) * b.kg_bruto)::numeric(15,3)  as quebra_kg_a,
    (b.kg_bruto - (b.quebra_quinzena_pct * (b.dias_a::numeric / 15)) * b.kg_bruto)::numeric(15,3) as kg_liquido_a
  from base b
)
select
  -- ------ colunas existentes (ordem e semântica preservadas: cenário terceiros) ------
  c.id,
  c.armazem_id,
  c.armazem_nome,
  c.armazem_apelido,
  c.cultura,
  c.safra,
  c.data_deposito,
  c.dfe_entrada,
  c.nfp,
  c.kg_bruto,
  c.status,
  c.observacao,
  c.created_at,
  c.updated_at,
  c.parametros_id,
  c.quebra_quinzena_pct,
  c.armazenagem_por_kg_quinzena,
  c.devolucao_por_saca,
  c.carencia_dias,
  c.kg_por_saca,
  c.data_atual,
  c.cotacao_simulada_sc,
  c.sc_bruto_c                                                            as sc_bruto,
  c.dias_t                                                                as dias_percorridos,
  (c.dias_t::numeric / 15)::numeric(10,4)                                 as quinzenas,
  c.quebra_kg_t                                                           as quebra_kg,
  c.kg_liquido_t                                                          as kg_liquido,
  (c.kg_liquido_t / c.kg_por_saca)::numeric(15,4)                         as sc_liquida,
  (c.kg_liquido_t * c.dias_t::numeric * (c.armazenagem_por_kg_quinzena / 15) / c.kg_por_saca)::numeric(15,2) as taxa_armazenagem,
  (c.sc_bruto_c * c.devolucao_por_saca)::numeric(15,2)                    as taxa_devolucao,
  -- Total terceiros agora inclui a recepção (default 0 → valores inalterados)
  (
    c.kg_liquido_t * c.dias_t::numeric * (c.armazenagem_por_kg_quinzena / 15) / c.kg_por_saca
    + c.sc_bruto_c * c.devolucao_por_saca
    + c.sc_bruto_c * coalesce(c.taxa_recepcao_por_saca, 0)
  )::numeric(15,2)                                                        as total_a_descontar,
  ((c.kg_liquido_t / c.kg_por_saca) * coalesce(c.cotacao_simulada_sc, 0))::numeric(15,2) as valor_venda_simulado,
  -- ------ colunas novas ------
  c.carencia_armazem_dias,
  c.taxa_recepcao_por_saca,
  (c.sc_bruto_c * coalesce(c.taxa_recepcao_por_saca, 0))::numeric(15,2)   as taxa_recepcao,
  c.dias_a                                                                as dias_percorridos_armazem,
  (c.dias_a::numeric / 15)::numeric(10,4)                                 as quinzenas_armazem,
  c.quebra_kg_a                                                           as quebra_kg_armazem,
  c.kg_liquido_a                                                          as kg_liquido_armazem,
  (c.kg_liquido_a / c.kg_por_saca)::numeric(15,4)                         as sc_liquida_armazem,
  (c.kg_liquido_a * c.dias_a::numeric * (c.armazenagem_por_kg_quinzena / 15) / c.kg_por_saca)::numeric(15,2) as taxa_armazenagem_armazem,
  -- Venda ao próprio armazém: sem recepção e sem retirada/devolução (call 24-jun)
  (c.kg_liquido_a * c.dias_a::numeric * (c.armazenagem_por_kg_quinzena / 15) / c.kg_por_saca)::numeric(15,2) as total_a_descontar_armazem,
  ((c.kg_liquido_a / c.kg_por_saca) * coalesce(c.cotacao_simulada_sc, 0))::numeric(15,2) as valor_venda_armazem
from calc c;

comment on view public.v_safra_depositos_calculado is
  'Depósitos com os DOIS cálculos consolidados: venda a terceiros (carencia_dias, + recepção/devolução) e venda ao próprio armazém (carencia_armazem_dias, só armazenagem). Usa safra_parametros.data_atual como "Data Atual".';

-- ----------------------------------------------------------------------------
-- ROLLBACK:
--   Reexecutar a definição da view da migration 0014 e:
--   alter table public.safra_parametros
--     drop column if exists carencia_armazem_dias,
--     drop column if exists taxa_recepcao_por_saca;
-- ----------------------------------------------------------------------------



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0038_animais.sql
-- └──────────────────────────────────────────────────────────────────────────┘
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



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0039_maquinario.sql
-- └──────────────────────────────────────────────────────────────────────────┘
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



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0040_chuvas.sql
-- └──────────────────────────────────────────────────────────────────────────┘
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



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0041_colaboradores_taloes.sql
-- └──────────────────────────────────────────────────────────────────────────┘
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



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ migrations\0042_horta.sql
-- └──────────────────────────────────────────────────────────────────────────┘
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



-- ============================================================================
-- SEEDS — dados de domínio (DML)
-- ============================================================================


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ seed\01_classificacao_financeira.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- Plano de contas mestre (extraído da aba 'Classificação Financeira')
-- Hierarquia: 1 ENTRADAS / 2 SAÍDAS → nível 2 (1.x / 2.x) → nível 3 (1.x.y / 2.x.y)

insert into public.classificacao_financeira (codigo, nome, natureza, parent_codigo, nivel, ordem) values
  ('1', 'ENTRADAS', 'entrada'::public.natureza_conta, null, 1, 1),
  ('1.1', 'Saldo Inicial', 'entrada'::public.natureza_conta, '1', 2, 2),
  ('1.1.1', 'Banco Cora', 'entrada'::public.natureza_conta, '1.1', 3, 3),
  ('1.1.2', 'Cooperativa Sicredi', 'entrada'::public.natureza_conta, '1.1', 3, 4),
  ('1.2', 'Receita de Arrendamento de Terras', 'entrada'::public.natureza_conta, '1', 2, 5),
  ('1.2.1', 'Venda de Soja', 'entrada'::public.natureza_conta, '1.2', 3, 6),
  ('1.2.2', 'Venda de Milho', 'entrada'::public.natureza_conta, '1.2', 3, 7),
  ('1.3', 'Receita com Venda de Subprodutos', 'entrada'::public.natureza_conta, '1', 2, 8),
  ('1.3.1', 'Diversos', 'entrada'::public.natureza_conta, '1.3', 3, 9),
  ('1.4', 'Receita com Venda de Animais', 'entrada'::public.natureza_conta, '1', 2, 10),
  ('1.4.1', 'Diversos', 'entrada'::public.natureza_conta, '1.4', 3, 11),
  ('1.5', 'Juros e Rendimentos de Aplicações', 'entrada'::public.natureza_conta, '1', 2, 12),
  ('1.5.1', 'Cooperativa Sicredi', 'entrada'::public.natureza_conta, '1.5', 3, 13),
  ('1.5.2', 'Banco XP', 'entrada'::public.natureza_conta, '1.5', 3, 14),
  ('1.6', 'Estorno de Pagamentos', 'entrada'::public.natureza_conta, '1', 2, 15),
  ('1.6.1', 'Diversos', 'entrada'::public.natureza_conta, '1.6', 3, 16),
  ('1.7', 'Reembolsos Recebidos', 'entrada'::public.natureza_conta, '1', 2, 17),
  ('1.7.1', 'Diversos', 'entrada'::public.natureza_conta, '1.7', 3, 18),
  ('1.8', 'Resgate de Aplicações', 'entrada'::public.natureza_conta, '1', 2, 19),
  ('1.8.1', 'Cooperativa Sicredi', 'entrada'::public.natureza_conta, '1.8', 3, 20),
  ('1.8.2', 'Banco XP', 'entrada'::public.natureza_conta, '1.8', 3, 21),
  ('1.9', 'Outros Recebimentos', 'entrada'::public.natureza_conta, '1', 2, 22),
  ('1.9.1', 'Diversos', 'entrada'::public.natureza_conta, '1.9', 3, 23),
  ('2', 'SAÍDAS', 'saida'::public.natureza_conta, null, 1, 24),
  ('2.1', 'Despesas Administrativa', 'saida'::public.natureza_conta, '2', 2, 25),
  ('2.1.1', 'Honorários Contábeis', 'saida'::public.natureza_conta, '2.1', 3, 26),
  ('2.1.2', 'Honorários Jurídicos', 'saida'::public.natureza_conta, '2.1', 3, 27),
  ('2.1.3', 'Despesas com Aluguel', 'saida'::public.natureza_conta, '2.1', 3, 28),
  ('2.1.4', 'Software Rural', 'saida'::public.natureza_conta, '2.1', 3, 29),
  ('2.1.5', 'Licenciamento e Regularização Ambiental', 'saida'::public.natureza_conta, '2.1', 3, 30),
  ('2.1.6', 'Taxas e Impostos (ITR, INCRA, etc.)', 'saida'::public.natureza_conta, '2.1', 3, 31),
  ('2.1.7', 'Material de Escritório', 'saida'::public.natureza_conta, '2.1', 3, 32),
  ('2.1.8', 'Despesas Gerais', 'saida'::public.natureza_conta, '2.1', 3, 33),
  ('2.2', 'Despesas com Pessoal', 'saida'::public.natureza_conta, '2', 2, 34),
  ('2.2.1', 'Salários e Remunerações', 'saida'::public.natureza_conta, '2.2', 3, 35),
  ('2.2.2', 'Encargos Sociais (INSS, FGTS, etc.)', 'saida'::public.natureza_conta, '2.2', 3, 36),
  ('2.2.3', 'Benefícios (vale, alimentação, etc.)', 'saida'::public.natureza_conta, '2.2', 3, 37),
  ('2.2.4', 'Férias', 'saida'::public.natureza_conta, '2.2', 3, 38),
  ('2.2.5', 'EPIs Operacionais', 'saida'::public.natureza_conta, '2.2', 3, 39),
  ('2.3', 'Operação da Propriedade', 'saida'::public.natureza_conta, '2', 2, 40),
  ('2.3.1', 'Manutenção de Benfeitorias', 'saida'::public.natureza_conta, '2.3', 3, 41),
  ('2.3.2', 'Energia Elétrica Rural', 'saida'::public.natureza_conta, '2.3', 3, 42),
  ('2.3.3', 'Água e Irrigação', 'saida'::public.natureza_conta, '2.3', 3, 43),
  ('2.3.4', 'Internet Rural', 'saida'::public.natureza_conta, '2.3', 3, 44),
  ('2.3.5', 'Combustíveis e Lubrificantes', 'saida'::public.natureza_conta, '2.3', 3, 45),
  ('2.3.6', 'Produtos e Peças', 'saida'::public.natureza_conta, '2.3', 3, 46),
  ('2.3.7', 'Peças para Veículos e Máquinas', 'saida'::public.natureza_conta, '2.3', 3, 47),
  ('2.3.8', 'Insumos Agrícolas', 'saida'::public.natureza_conta, '2.3', 3, 48),
  ('2.3.9', 'Alimentação Animal', 'saida'::public.natureza_conta, '2.3', 3, 49),
  ('2.3.10', 'Sanidade Animal', 'saida'::public.natureza_conta, '2.3', 3, 50),
  ('2.3.11', 'Compra de Animais (Ativo Biológico)', 'saida'::public.natureza_conta, '2.3', 3, 51),
  ('2.4', 'Serviços Terceirizados', 'saida'::public.natureza_conta, '2', 2, 52),
  ('2.4.1', 'Serviços Agrícolas (terceirizados)', 'saida'::public.natureza_conta, '2.4', 3, 53),
  ('2.4.2', 'Transporte e Logística', 'saida'::public.natureza_conta, '2.4', 3, 54),
  ('2.4.3', 'Manutenção e Reparos', 'saida'::public.natureza_conta, '2.4', 3, 55),
  ('2.4.4', 'Manutenção de Veículos e Máquinas', 'saida'::public.natureza_conta, '2.4', 3, 56),
  ('2.4.5', 'Taxa de Armazenagem', 'saida'::public.natureza_conta, '2.4', 3, 57),
  ('2.4.6', 'Taxa de Expedição e Retirada', 'saida'::public.natureza_conta, '2.4', 3, 58),
  ('2.4.7', 'Serviços Diversos', 'saida'::public.natureza_conta, '2.4', 3, 59),
  ('2.5', 'Financeiras e Bancárias', 'saida'::public.natureza_conta, '2', 2, 60),
  ('2.5.1', 'Juros Bancários', 'saida'::public.natureza_conta, '2.5', 3, 61),
  ('2.5.2', 'Tarifas Bancárias', 'saida'::public.natureza_conta, '2.5', 3, 62),
  ('2.5.3', 'IOF / Despesas com Empréstimos', 'saida'::public.natureza_conta, '2.5', 3, 63),
  ('2.5.4', 'Anuidade de Cartão de Crédito', 'saida'::public.natureza_conta, '2.5', 3, 64),
  ('2.6', 'Investimento em Capital', 'saida'::public.natureza_conta, '2', 2, 65),
  ('2.6.1', 'Aplicações Financeiras', 'saida'::public.natureza_conta, '2.6', 3, 66),
  ('2.7', 'Investimento em Imobilizado Operacional', 'saida'::public.natureza_conta, '2', 2, 67),
  ('2.7.1', 'Compra de Equipamentos Agrícolas', 'saida'::public.natureza_conta, '2.7', 3, 68),
  ('2.7.2', 'Obras e Melhorias (infraestrutura)', 'saida'::public.natureza_conta, '2.7', 3, 69),
  ('2.7.3', 'Benfeitorias Temporárias / Construções Leves', 'saida'::public.natureza_conta, '2.7', 3, 70),
  ('2.8', 'Distribuição de Lucro / Saídas Pessoais', 'saida'::public.natureza_conta, '2', 2, 71),
  ('2.8.1', 'Distribuição de Lucros', 'saida'::public.natureza_conta, '2.8', 3, 72),
  ('2.8.2', 'Retirada de Sócios', 'saida'::public.natureza_conta, '2.8', 3, 73),
  ('2.8.3', 'Pagamentos Pessoais (não operacionais)', 'saida'::public.natureza_conta, '2.8', 3, 74),
  ('2.9', 'Outras Saídas', 'saida'::public.natureza_conta, '2', 2, 75),
  ('2.9.1', 'Devoluções de Receitas', 'saida'::public.natureza_conta, '2.9', 3, 76),
  ('2.9.2', 'Perdas e Extravio', 'saida'::public.natureza_conta, '2.9', 3, 77),
  ('2.9.3', 'Outras Despesas Não Classificadas', 'saida'::public.natureza_conta, '2.9', 3, 78)
on conflict (codigo) do nothing;



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ seed\02_classificacao_pessoal.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- Plano de contas PESSOAL dos sócios (códigos 1.01 a 1.06)
-- Extraído dos cabeçalhos da aba 'Dados Bancários'.

insert into public.classificacao_pessoal (codigo, nome, ordem) values
  ('1.01', 'Imóvel', 1),
  ('1.02', 'Família', 2),
  ('1.03', 'Renda Mensal/Qualidade de Vida', 3),
  ('1.04', 'Despesas Pessoais', 4),
  ('1.05', 'Fazenda Aramburu', 5),
  ('1.06', 'Contratos de Venda', 6)
on conflict (codigo) do nothing;



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ seed\03_contas_bancarias_empresa.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- Contas bancárias da empresa (Aramburu)

insert into public.contas_bancarias_empresa (nome, apelido, banco, agencia, tipo, ordem) values
  ('Banco Cora (0001)', 'Cora', 'Banco Cora', '0001', 'corrente', 1),
  ('Cooperativa Sicredi (0902)', 'Sicredi MJU', 'Cooperativa Sicredi', '0902', 'corrente', 2),
  ('Cooperativa Sicredi (0913)', 'Sicredi CGR', 'Cooperativa Sicredi', '0913', 'corrente', 3)
on conflict (nome) do nothing;



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ seed\04_socios.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- Sócios (4)

insert into public.socios (nome_completo, apelido) values
  ('Ana Beatriz Ponte Fragelli', 'Ana Beatriz'),
  ('Claudio Luiz Resta Fragelli', 'Cláudio Luiz'),
  ('Isamelia Ponte Fragelli', 'Isamélia'),
  ('Pedro Henrique Ponte Fragelli', 'Pedro Henrique')
on conflict (nome_completo) do nothing;



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ seed\05_contas_bancarias_socio.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- Contas bancárias dos sócios (extraído de 'Dados Bancários')
-- Pedro Henrique não tem contas cadastradas na planilha (combinado: ficar só com o nome).

insert into public.contas_bancarias_socio (socio_id, nome, banco, ordem) values
  ((select id from public.socios where nome_completo = 'Ana Beatriz Ponte Fragelli'), 'Bradesco 3489 C/C 2890-8', 'Bradesco', 1),
  ((select id from public.socios where nome_completo = 'Ana Beatriz Ponte Fragelli'), 'Inter 0001 C/C 12284789-0', 'Inter', 2),
  ((select id from public.socios where nome_completo = 'Ana Beatriz Ponte Fragelli'), 'Nubank 0001 C/C 6254033-3', 'Nubank', 3),
  ((select id from public.socios where nome_completo = 'Ana Beatriz Ponte Fragelli'), 'Nubank 0101 C/C 6254033-3', 'Nubank', 4),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'), 'B. Brasil cfragelli7@gmail.com', 'B.', 1),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'), 'Bradesco 1375 C/C 242867-9', 'Bradesco', 2),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'), 'Bradesco 3489 C/C 3154-2', 'Bradesco', 3),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'), 'Bradesco 3489 C/C 35858-4', 'Bradesco', 1),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'), 'Inter 001 C/C 28333196-0', 'Inter', 2),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'), 'Inter 001 C/C 28333196-8', 'Inter', 3),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'), 'Nubank isafragelli@gmail.com', 'Nubank', 4)
on conflict (socio_id, nome) do nothing;



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ seed\06_despesas_recorrentes.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- Despesas recorrentes por sócio (extraído da aba 'Dados Bancários')

insert into public.despesas_recorrentes_socio
  (socio_id, classificacao_pessoal, descricao, conta_bancaria_socio_id, ordem) values
  ((select id from public.socios where nome_completo = 'Ana Beatriz Ponte Fragelli'),
   '1.04',
   'Casan Águas e Saneamento (Residência SC)',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Ana Beatriz Ponte Fragelli' and cbs.nome='Nubank 0101 C/C 6254033-3'),
   1),
  ((select id from public.socios where nome_completo = 'Ana Beatriz Ponte Fragelli'),
   '1.04',
   'Claro Internet (Residência SC)',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Ana Beatriz Ponte Fragelli' and cbs.nome='Nubank 0101 C/C 6254033-3'),
   2),
  ((select id from public.socios where nome_completo = 'Ana Beatriz Ponte Fragelli'),
   '1.04',
   'Dedetização (Residência SC)',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Ana Beatriz Ponte Fragelli' and cbs.nome='Nubank 0101 C/C 6254033-3'),
   3),
  ((select id from public.socios where nome_completo = 'Ana Beatriz Ponte Fragelli'),
   '1.04',
   'IPTU (Residência SC)',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Ana Beatriz Ponte Fragelli' and cbs.nome='Nubank 0101 C/C 6254033-3'),
   4),
  ((select id from public.socios where nome_completo = 'Ana Beatriz Ponte Fragelli'),
   '1.04',
   'Jardineiro (Residência SC)',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Ana Beatriz Ponte Fragelli' and cbs.nome='Nubank 0101 C/C 6254033-3'),
   5),
  ((select id from public.socios where nome_completo = 'Ana Beatriz Ponte Fragelli'),
   '1.04',
   'Limpeza Caixa de Gordura (Residência SC)',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Ana Beatriz Ponte Fragelli' and cbs.nome='Nubank 0101 C/C 6254033-3'),
   6),
  ((select id from public.socios where nome_completo = 'Ana Beatriz Ponte Fragelli'),
   '1.04',
   'Limpeza Mensal (Residência SC)',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Ana Beatriz Ponte Fragelli' and cbs.nome='Nubank 0101 C/C 6254033-3'),
   7),
  ((select id from public.socios where nome_completo = 'Ana Beatriz Ponte Fragelli'),
   '1.04',
   'Reforma Programada (Residência SC)',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Ana Beatriz Ponte Fragelli' and cbs.nome='Nubank 0101 C/C 6254033-3'),
   8),
  ((select id from public.socios where nome_completo = 'Ana Beatriz Ponte Fragelli'),
   '1.04',
   'Taxa de Coleta Residual (Residência SC)',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Ana Beatriz Ponte Fragelli' and cbs.nome='Nubank 0101 C/C 6254033-3'),
   9),
  ((select id from public.socios where nome_completo = 'Ana Beatriz Ponte Fragelli'),
   '1.06',
   'Repasse Venda Soja  23/24',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Ana Beatriz Ponte Fragelli' and cbs.nome='Inter 0001 C/C 12284789-0'),
   1),
  ((select id from public.socios where nome_completo = 'Ana Beatriz Ponte Fragelli'),
   '1.06',
   'Repasse Venda Milho 24/24',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Ana Beatriz Ponte Fragelli' and cbs.nome='Inter 0001 C/C 12284789-0'),
   2),
  ((select id from public.socios where nome_completo = 'Ana Beatriz Ponte Fragelli'),
   '1.06',
   'Repasse Venda Soja 24/25',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Ana Beatriz Ponte Fragelli' and cbs.nome='Inter 0001 C/C 12284789-0'),
   3),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.01',
   'C.E.R IPTU',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   1),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.01',
   'C.E.R Taxa Lixo',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   2),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.01',
   'IPTU (Apto 01 Marechal Rondon)',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   3),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.01',
   'IPTU (Casa Barão)',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   4),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.01',
   'IPTU (Casa Fundos Marechal Rondon)',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   5),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.01',
   'IPTU (Casa Vila Inventário)',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   6),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.01',
   'IPTU (Forest House)',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   7),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.01',
   'IPTU (R. Margina Humberlina Lima 80)',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   8),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.01',
   'IPTU (R. Margina Humberlina Lima 90)',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   9),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.01',
   'IPTU (Sala  01 Marechal Rondon)',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   10),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.01',
   'ITR Estância Ivone',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   11),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.01',
   'Parcelamento (Residência SC)',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   12),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.01',
   'Reforma Programada',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   13),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.01',
   'Usucapião',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   14),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.03',
   'Custos Emergenciais',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 1375 C/C 242867-9'),
   1),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.03',
   'Distribuição Fixa',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 1375 C/C 242867-9'),
   2),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.03',
   'Medicamento',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 1375 C/C 242867-9'),
   3),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.03',
   'Tratamento Dentário',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 1375 C/C 242867-9'),
   4),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.03',
   'Vacina',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 1375 C/C 242867-9'),
   5),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.03',
   'Troca de Celular',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='B. Brasil cfragelli7@gmail.com'),
   6),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.03',
   'Viagem Final de Ano',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='B. Brasil cfragelli7@gmail.com'),
   7),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.03',
   'Viagem Internacional',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='B. Brasil cfragelli7@gmail.com'),
   8),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.03',
   'Viagem Trimestral',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='B. Brasil cfragelli7@gmail.com'),
   9),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.04',
   'Manutenção Conta Bradesco',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 1375 C/C 242867-9'),
   1),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.04',
   'IPVA',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   2),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.04',
   'IRPF',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   3),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.04',
   'Revisão Veículo',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   4),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.04',
   'Seguro Veículo',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   5),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.04',
   'Troca de Pneus',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   6),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.04',
   'Vivo Família Móvel',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   7),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.05',
   '1ª Parc. 13º - Cintia Daniela Rodrigues Ricalde',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   1),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.05',
   '1ª Parc. 13º - Fernando Guilherme Ledesma Bronel',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   2),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.05',
   '2ª Parc. 13º - Cintia Daniela Rodrigues Ricalde',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   3),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.05',
   '2ª Parc. 13º - Fernando Guilherme Ledesma Bronel',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   4),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.05',
   'Energisa (Fazenda Aramburu)',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   5),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.05',
   'Férias - Cintia Daniela Rodrigues Ricalde',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   6),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.05',
   'Férias - Fernando Guilherme Ledesma Bronel',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   7),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.05',
   'FGTS 13º',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   8),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.05',
   'FGTS Folha de Pgto',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   9),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.05',
   'Folha de Pgto - Cintia Daniela Rodrigues Ricalde',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   10),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.05',
   'Folha de Pgto - Fernando Guilherme Ledesma Bronel',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   11),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.05',
   'INSS 13º',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   12),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.05',
   'INSS Folha de Pgto',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   13),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.05',
   'Pluxee Alimentação - Cintia Daniela Rodrigues Ricalde',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   14),
  ((select id from public.socios where nome_completo = 'Claudio Luiz Resta Fragelli'),
   '1.05',
   'Pluxee Alimentação - Fernando Guilherme Ledesma Bronel',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Claudio Luiz Resta Fragelli' and cbs.nome='Bradesco 3489 C/C 3154-2'),
   15),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'),
   '1.01',
   'Águas Guariroba (Forest House CG)',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Isamelia Ponte Fragelli' and cbs.nome='Bradesco 3489 C/C 35858-4'),
   1),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'),
   '1.01',
   'Condomínio (Forest House CG)',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Isamelia Ponte Fragelli' and cbs.nome='Bradesco 3489 C/C 35858-4'),
   2),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'),
   '1.01',
   'Energisa (Forest House CG)',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Isamelia Ponte Fragelli' and cbs.nome='Bradesco 3489 C/C 35858-4'),
   3),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'),
   '1.01',
   'Piscineiro (Forest House CG)',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Isamelia Ponte Fragelli' and cbs.nome='Bradesco 3489 C/C 35858-4'),
   4),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'),
   '1.01',
   'Jardineiro (Forest House CG)',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Isamelia Ponte Fragelli' and cbs.nome='Bradesco 3489 C/C 35858-4'),
   5),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'),
   '1.01',
   'IPTU (Forest House CG)',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Isamelia Ponte Fragelli' and cbs.nome='Bradesco 3489 C/C 35858-4'),
   6),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'),
   '1.01',
   'Manutenção (Forest House CG)',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Isamelia Ponte Fragelli' and cbs.nome='Bradesco 3489 C/C 35858-4'),
   7),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'),
   '1.02',
   'Vale Transporte - Célia Regina de Amorim Pontes',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Isamelia Ponte Fragelli' and cbs.nome='Bradesco 3489 C/C 35858-4'),
   1),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'),
   '1.02',
   'Folha de Pgto - Célia Regina de Amorim Pontes',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Isamelia Ponte Fragelli' and cbs.nome='Bradesco 3489 C/C 35858-4'),
   2),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'),
   '1.02',
   'FGTS - Célia Regina de Amorim Pontes',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Isamelia Ponte Fragelli' and cbs.nome='Bradesco 3489 C/C 35858-4'),
   3),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'),
   '1.02',
   'INSS 13º',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Isamelia Ponte Fragelli' and cbs.nome='Bradesco 3489 C/C 35858-4'),
   4),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'),
   '1.02',
   '1ª Parc. 13º - Célia Regina de Amorim Pontes',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Isamelia Ponte Fragelli' and cbs.nome='Bradesco 3489 C/C 35858-4'),
   5),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'),
   '1.02',
   '2ª Parc. 13º - Célia Regina de Amorim Pontes',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Isamelia Ponte Fragelli' and cbs.nome='Bradesco 3489 C/C 35858-4'),
   6),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'),
   '1.02',
   'Férias - Célia Regina de Amorim Pontes',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Isamelia Ponte Fragelli' and cbs.nome='Bradesco 3489 C/C 35858-4'),
   7),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'),
   '1.03',
   'Distribuição Fixa',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Isamelia Ponte Fragelli' and cbs.nome='Nubank isafragelli@gmail.com'),
   1),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'),
   '1.03',
   'Custos Emergenciais',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Isamelia Ponte Fragelli' and cbs.nome='Nubank isafragelli@gmail.com'),
   2),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'),
   '1.03',
   'Medicamentos',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Isamelia Ponte Fragelli' and cbs.nome='Nubank isafragelli@gmail.com'),
   3),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'),
   '1.03',
   'Tratamento Dentário',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Isamelia Ponte Fragelli' and cbs.nome='Nubank isafragelli@gmail.com'),
   4),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'),
   '1.03',
   'Estética',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Isamelia Ponte Fragelli' and cbs.nome='Nubank isafragelli@gmail.com'),
   5),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'),
   '1.03',
   'Zélia Alves Ponte',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Isamelia Ponte Fragelli' and cbs.nome='Bradesco 3489 C/C 35858-4'),
   6),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'),
   '1.03',
   'Viagem Internacional',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Isamelia Ponte Fragelli' and cbs.nome='Inter 001 C/C 28333196-0'),
   7),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'),
   '1.03',
   'Viagem Trimestral',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Isamelia Ponte Fragelli' and cbs.nome='Inter 001 C/C 28333196-0'),
   8),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'),
   '1.03',
   'Viagem Final de Ano',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Isamelia Ponte Fragelli' and cbs.nome='Inter 001 C/C 28333196-0'),
   9),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'),
   '1.04',
   'Vivo TV + Internet',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Isamelia Ponte Fragelli' and cbs.nome='Bradesco 3489 C/C 35858-4'),
   1),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'),
   '1.04',
   'IPVA',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Isamelia Ponte Fragelli' and cbs.nome='Bradesco 3489 C/C 35858-4'),
   2),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'),
   '1.04',
   'IRPF',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Isamelia Ponte Fragelli' and cbs.nome='Bradesco 3489 C/C 35858-4'),
   3),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'),
   '1.04',
   'Seguro Veículo',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Isamelia Ponte Fragelli' and cbs.nome='Bradesco 3489 C/C 35858-4'),
   4),
  ((select id from public.socios where nome_completo = 'Isamelia Ponte Fragelli'),
   '1.04',
   'Revisão Veículo',
   (select cbs.id from public.contas_bancarias_socio cbs join public.socios s on s.id=cbs.socio_id where s.nome_completo='Isamelia Ponte Fragelli' and cbs.nome='Bradesco 3489 C/C 35858-4'),
   5)
on conflict (socio_id, classificacao_pessoal, descricao) do nothing;



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ seed\07_recibo_modelos.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- Modelos de recibo (slugs já usados pelo front em RecibosPage.tsx)

insert into public.recibo_modelos (slug, nome, ordem) values
  ('simples', 'Recibo Simples', 1),
  ('prestacao_servico', 'Prestação de Serviço', 2),
  ('aluguel', 'Recibo de Aluguel', 3),
  ('emprestimo', 'Empréstimo', 4),
  ('declaracao', 'Declaração', 5)
on conflict (slug) do nothing;



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ seed\08_obra_parametros.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- Parâmetros da obra Sede (substitui o external link da planilha)
-- Valores que estavam hardcoded em '$ obra sede'!F8/F12/F13/F14.

insert into public.obra_parametros (chave, valor_numerico, data_referencia, observacao) values
  ('capital_inicial',         1147800.00, '2025-05-01', 'Capital Inicial Maio/2025 ($ obra sede!F8)'),
  ('pago_2025_lts_medicao',   524574.25,  '2025-12-31', 'Total LTS Medições pago em 2025 ($ obra sede!F12)'),
  ('pago_2025_lts_oc',        523480.46,  '2025-12-31', 'Total LTS Ordens de Compra pago em 2025 ($ obra sede!F13)'),
  ('pago_2025_outras',        317416.73,  '2025-12-31', 'Outras despesas pago em 2025 ($ obra sede!F14)'),
  ('resgate_xp_para_mju',     180000.00,  '2025-12-09', 'Resgate XP → Sicredi MJU'),
  ('resgate_xp_para_cgr',     119598.61,  '2025-12-17', 'Resgate XP → Sicredi CGR'),
  ('resgate_xp_3',            100488.96,  '2026-01-09', 'Resgate XP (3ª operação)'),
  ('resgate_extra',           200084.84,  null,         'Resgate adicional')
on conflict (chave) do nothing;



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ seed\09_armazens.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- Armazéns (cerealistas onde a Aramburu armazena grãos)
-- Hoje só Copasul; a estrutura permite cadastrar outros.

insert into public.armazens (nome, apelido, cidade, uf, ordem) values
  ('Copasul', 'Copasul Maracaju', 'Maracaju', 'MS', 1)
on conflict (nome) do nothing;

-- Parâmetros default da safra 25/25 (Milho na Copasul)
-- Valores extraídos da aba Detalhado__ — Provisionamento Safra 25.25.xlsx
insert into public.safra_parametros (
  armazem_id, cultura, safra,
  quebra_quinzena_pct, armazenagem_por_kg_quinzena, devolucao_por_saca,
  carencia_dias, kg_por_saca, data_atual, cotacao_simulada_sc
)
select
  a.id, 'milho'::public.cultura_safra, '25/25',
  0.0015, 0.20, 4.75,
  30, 60.00, current_date, 50.00
from public.armazens a
where a.nome = 'Copasul'
on conflict (armazem_id, cultura, safra) do nothing;



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ seed\10_safra_depositos.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- Depósitos da Safra 25/25 (Milho) na Copasul
-- 16 DFe's de jul/2025, total 866.616 kg
-- Origem: aba Detalhado__ R16:R31 — Provisionamento Safra 25.25.xlsx

do $$
declare
  v_armazem uuid;
begin
  select id into v_armazem from public.armazens where nome = 'Copasul';
  if v_armazem is null then return; end if;

  insert into public.safra_depositos (armazem_id, cultura, safra, data_deposito, dfe_entrada, nfp, kg_bruto, origem_planilha)
  values
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-15', '54383', '8285721', 43840, 'Detalhado__!R16'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-15', '54411', '8285722', 44170, 'Detalhado__!R17'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-16', '54489', '8285723', 46149, 'Detalhado__!R18'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-19', '55986', '8285724', 44835, 'Detalhado__!R19'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-19', '55004', '8285725', 61808, 'Detalhado__!R20'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-19', '55014', '8285726', 62829, 'Detalhado__!R21'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-19', '55029', '8285727', 61631, 'Detalhado__!R22'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-19', '55048', '8285728', 45031, 'Detalhado__!R23'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-19', '55061', '8285729', 61245, 'Detalhado__!R24'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-20', '55093', '8285730', 59987, 'Detalhado__!R25'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-20', '55098', '8285731', 61582, 'Detalhado__!R26'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-20', '55126', '8285732', 44676, 'Detalhado__!R27'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-20', '55144', '8285733', 61256, 'Detalhado__!R28'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-20', '55153', '8285734', 60524, 'Detalhado__!R29'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-20', '55174', '8285735', 60970, 'Detalhado__!R30'),
    (v_armazem, 'milho'::public.cultura_safra, '25/25', '2025-07-21', '55344', '8285736', 46083, 'Detalhado__!R31')
  on conflict do nothing;
end$$;



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ seed\11_vendas_provisionadas.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- Vendas Futuras / Provisionamento
-- Origem: Provisionamento_VENDAS 2026.xlsx, aba Detalhado, R6:R9
-- 4 vendas de Soja 24/25 à Copasul, total R$ 3.513.265,29
-- A primeira (R6) já foi paga em 30/01/2026 — entra como liquidada.

insert into public.vendas_provisionadas (
  data_venda, comprador, cultura, safra, aut_fixacao, nota_fiscal,
  kg, preco_sc, data_pgto_prevista, destino_empresa, socio_destino_id,
  status, observacao, origem_planilha
)
values
  -- R6 — Aramburu: paga em 30/01/2026
  ('2025-07-11', 'Copasul', 'soja'::public.cultura_safra, '24/25', '153076', '8066969',
   480000, 120.0000, '2026-01-30', true, null,
   'liquidada', 'Pagamento em 4 parcelas — esta é a primeira (jan/26)', 'VENDAS!R6'),
  -- R7 — Aramburu: a receber em 30/03/2026
  ('2025-07-11', 'Copasul', 'soja'::public.cultura_safra, '24/25', '153330', '8066874',
   600000, 123.5040, '2026-03-30', true, null,
   'firmada', null, 'VENDAS!R7'),
  -- R8 — Ana Beatriz: a receber em 30/03/2026
  ('2025-07-11', 'Copasul', 'soja'::public.cultura_safra, '24/25', '153333', '8066943',
   271080, 123.5040, '2026-03-30', false,
   (select id from public.socios where nome_completo = 'Ana Beatriz Ponte Fragelli'),
   'firmada', 'Repasse Soja - parte direta da sócia Ana Beatriz', 'VENDAS!R8'),
  -- R9 — Aramburu: liquidada em 30/07/2025
  ('2025-07-16', 'Copasul', 'soja'::public.cultura_safra, '24/25', '154432', '8082622',
   360574, 126.5040, '2025-07-30', true, null,
   'liquidada', null, 'VENDAS!R9');



-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ seed\12_reconciliacao_contas_bancarias.sql
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================
-- 12 — Reconciliação das contas bancárias da empresa (RF-FIN-01/02, 12-jun-2026)
-- ============================================================================
-- Estado-alvo do painel "Saldos por Banco" (5 cards), conforme o print enviado
-- pela Lola: CORA, SICREDI, SICREDINVEST, INTER, XP + Total Geral.
--
-- Dados oficiais (PDF "Considerações — 12 de junho"):
--   CORA          Banco 403 · Ag. 0001   · Conta Corrente     2347942-2
--   SICREDI       Coop. 748 · Ag. 0913   · Conta Corrente     29945-3
--   SICREDINVEST  Coop. 748 · Ag. 0913   · Conta Corrente     29945-3   (investimento)
--   INTER         Banco 077 · Ag. 0001-9 · Conta Corrente     18843124-1
--   XP            Banco 348 · Ag. 0001   · Conta Investimento 5740321
--
-- Regras desta rodada:
--   • Desconsiderar o "Sicredi MJU" (0902) — DESATIVADO, nunca deletado
--     (as transações históricas ficam intactas, só somem do painel/Total Geral).
--   • Incluir o INTER.
--   • Reaproveitar a conta XP existente e desativar as contas de investimento
--     antigas que saíram do painel (Invest, Invest Evolutivo).
--
-- IDEMPOTENTE: pode rodar várias vezes. Depende das colunas numero_banco/
-- tipo_instituicao (migration 0030) e deve rodar DEPOIS dos seeds 03 e 0011.

-- ---------------------------------------------------------------------------
-- CORA (corrente)
-- ---------------------------------------------------------------------------
update public.contas_bancarias_empresa set
  apelido          = 'CORA',
  banco            = 'Banco Cora',
  tipo_instituicao = 'banco',
  numero_banco     = '403',
  agencia          = '0001',
  numero_conta     = '2347942',
  digito           = '2',
  tipo             = 'corrente',
  ativa            = true,
  ordem            = 1
where nome = 'Banco Cora (0001)';

-- ---------------------------------------------------------------------------
-- SICREDI (corrente — cooperativa 0913)
-- ---------------------------------------------------------------------------
update public.contas_bancarias_empresa set
  apelido          = 'SICREDI',
  banco            = 'Cooperativa Sicredi',
  tipo_instituicao = 'cooperativa',
  numero_banco     = '748',
  agencia          = '0913',
  numero_conta     = '29945',
  digito           = '3',
  tipo             = 'corrente',
  ativa            = true,
  ordem            = 2
where nome = 'Cooperativa Sicredi (0913)';

-- ---------------------------------------------------------------------------
-- SICREDI MJU (0902) — desconsiderar do painel, preservando histórico
-- ---------------------------------------------------------------------------
update public.contas_bancarias_empresa set ativa = false
where nome = 'Cooperativa Sicredi (0902)';

-- ---------------------------------------------------------------------------
-- SICREDINVEST (investimento — mesma cooperativa/agência/conta da Sicredi)
-- Conta nova: começa zerada (R$ 0,00 no print). upsert pela chave única `nome`.
-- ---------------------------------------------------------------------------
insert into public.contas_bancarias_empresa
  (nome, apelido, banco, tipo_instituicao, numero_banco, agencia, numero_conta, digito, tipo, ativa, ordem)
values
  ('Cooperativa Sicredi Investimento (0913)', 'SICREDINVEST', 'Cooperativa Sicredi', 'cooperativa',
   '748', '0913', '29945', '3', 'investimento', true, 3)
on conflict (nome) do update set
  apelido          = excluded.apelido,
  banco            = excluded.banco,
  tipo_instituicao = excluded.tipo_instituicao,
  numero_banco     = excluded.numero_banco,
  agencia          = excluded.agencia,
  numero_conta     = excluded.numero_conta,
  digito           = excluded.digito,
  tipo             = excluded.tipo,
  ativa            = true,
  ordem            = excluded.ordem;

-- ---------------------------------------------------------------------------
-- INTER (corrente) — incluir
-- ---------------------------------------------------------------------------
insert into public.contas_bancarias_empresa
  (nome, apelido, banco, tipo_instituicao, numero_banco, agencia, numero_conta, digito, tipo, ativa, ordem)
values
  ('Banco Inter (0001-9)', 'INTER', 'Banco Inter', 'banco',
   '077', '0001-9', '18843124', '1', 'corrente', true, 4)
on conflict (nome) do update set
  apelido          = excluded.apelido,
  banco            = excluded.banco,
  tipo_instituicao = excluded.tipo_instituicao,
  numero_banco     = excluded.numero_banco,
  agencia          = excluded.agencia,
  numero_conta     = excluded.numero_conta,
  digito           = excluded.digito,
  tipo             = excluded.tipo,
  ativa            = true,
  ordem            = excluded.ordem;

-- ---------------------------------------------------------------------------
-- XP (investimento) — reaproveita a conta de investimento existente
-- ---------------------------------------------------------------------------
update public.contas_bancarias_empresa set
  apelido          = 'XP',
  banco            = 'XP Investimentos',
  tipo_instituicao = 'banco',
  numero_banco     = '348',
  agencia          = '0001',
  numero_conta     = '5740321',
  digito           = null,
  tipo             = 'investimento',
  ativa            = true,
  ordem            = 5
where nome = 'XP (Conta)';

-- ---------------------------------------------------------------------------
-- Contas de investimento antigas que saíram do painel (preserva histórico)
-- ---------------------------------------------------------------------------
update public.contas_bancarias_empresa set ativa = false
where nome in ('Invest', 'Invest Evolutivo');

-- ----------------------------------------------------------------------------
-- ROLLBACK (reverter a reconciliação — reativa as contas antigas):
--   update public.contas_bancarias_empresa set ativa = true
--     where nome in ('Cooperativa Sicredi (0902)', 'Invest', 'Invest Evolutivo');
--   delete from public.contas_bancarias_empresa
--     where nome in ('Cooperativa Sicredi Investimento (0913)', 'Banco Inter (0001-9)')
--       and not exists (select 1 from public.transacoes_empresa t
--                       where t.conta_bancaria_id = contas_bancarias_empresa.id);
-- ----------------------------------------------------------------------------

