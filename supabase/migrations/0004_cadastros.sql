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
