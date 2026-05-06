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
