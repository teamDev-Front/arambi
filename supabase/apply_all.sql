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

