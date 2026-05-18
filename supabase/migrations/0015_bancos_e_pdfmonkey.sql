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
