-- ============================================================================
-- 0031 — Escopo do relatório registrado na geração (RF-FIN-09 / 12-jun-2026)
-- ============================================================================
-- A Lola passou a gerar relatórios por RECORTE (filtros aplicados ou itens
-- selecionados manualmente) e não mais "todas as contas pagas no mês". Para
-- auditoria e reprodutibilidade, registramos em cada geração EXATAMENTE qual
-- escopo foi usado (tipo, filtros, ids de lançamentos, contas incluídas, totais).
--
-- Reversível (ver ROLLBACK no fim).

alter table public.pdfmonkey_geracoes
  add column if not exists scope_applied jsonb;

comment on column public.pdfmonkey_geracoes.scope_applied is
  'Recorte usado na geração (RF-FIN-09): { scope_type: por_mes|por_filtros|por_selecao, '
  'filtros:{...}, transacao_ids:[...], conta_ids:[...], totais:{...} }. Para auditoria/reprodutibilidade.';

-- ----------------------------------------------------------------------------
-- ROLLBACK (reverter esta migration):
--   alter table public.pdfmonkey_geracoes drop column if exists scope_applied;
-- ----------------------------------------------------------------------------
