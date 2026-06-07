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
