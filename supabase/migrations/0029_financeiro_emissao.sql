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
