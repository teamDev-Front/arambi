-- ============================================================================
-- HOTFIX (24-jul-2026) — erro em produção ao EDITAR documento e Gerar PDF:
--   "Could not find the function public.fn_registrar_versao_documento(...)
--    in the schema cache"
--
-- Diagnóstico: a migration 0027 (versionamento de documentos) não está ativa
-- no banco de produção — a assinatura da chamada bate 100% com a definição,
-- então ou a 0027 nunca foi aplicada, ou o schema cache do PostgREST está
-- desatualizado. Este arquivo é IDEMPOTENTE: replica a 0027 inteira com
-- guardas (IF NOT EXISTS / OR REPLACE) e força o reload do schema cache.
--
-- COMO APLICAR: colar tudo no SQL Editor do Supabase e executar 1x.
-- Pode rodar junto com as migrations 0043 e 0044 (também pendentes).
-- ============================================================================

-- 1) Colunas de controle na tabela principal
alter table public.documentos_gerados
  add column if not exists versao_atual int not null default 1,
  add column if not exists updated_at   timestamptz not null default now();

drop trigger if exists tg_dg_updated_at on public.documentos_gerados;
create trigger tg_dg_updated_at
  before update on public.documentos_gerados
  for each row execute function public.tg_set_updated_at();

-- 2) Tabela de histórico de versões
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

-- 3) Backfill: versão 1 para documentos já existentes (sem histórico ainda)
insert into public.documentos_gerados_versoes
  (documento_id, versao, numero, beneficiario, valor, descricao, mes_referencia, dados, pdf_path, pdf_size, created_by)
select d.id, 1, d.numero, d.beneficiario, d.valor, d.descricao, d.mes_referencia, d.dados, d.pdf_path, d.pdf_size, d.created_by
from public.documentos_gerados d
where not exists (
  select 1 from public.documentos_gerados_versoes v where v.documento_id = d.id
);

-- 4) RLS — leitura para autenticado, escrita para admin/editor
alter table public.documentos_gerados_versoes enable row level security;

drop policy if exists dgv_read on public.documentos_gerados_versoes;
create policy dgv_read on public.documentos_gerados_versoes
  for select using (auth.uid() is not null);

drop policy if exists dgv_write on public.documentos_gerados_versoes;
create policy dgv_write on public.documentos_gerados_versoes
  for all using (public.fn_can_write()) with check (public.fn_can_write());

-- 5) RPC: registra nova versão (insert + update atômicos)
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

-- 6) Recarrega o schema cache do PostgREST (o "in the schema cache" do erro)
notify pgrst, 'reload schema';
