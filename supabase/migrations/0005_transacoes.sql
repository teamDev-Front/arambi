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
