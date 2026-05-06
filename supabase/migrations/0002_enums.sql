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
