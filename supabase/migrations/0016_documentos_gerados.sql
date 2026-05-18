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
