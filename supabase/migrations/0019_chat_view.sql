-- ============================================================================
-- 0019 — Views/utilidades para o módulo de Assistentes IA
-- ============================================================================
-- Sustenta o card "Conversas Recentes" do hub /dashboard/assistentes:
-- traz a sessão + texto da última mensagem em uma única query.

-- ---------------------------------------------------------------------------
-- 1) View v_chat_sessoes_recentes
-- ---------------------------------------------------------------------------
-- Uma linha por chat_session, junto com a última mensagem (conteúdo + role +
-- created_at). Ordenada pelo updated_at da sessão DESC.
--
-- Usa LATERAL para evitar GROUP BY + window function — o índice
-- idx_cm_session (session_id, created_at) cobre a sub-query.
create or replace view public.v_chat_sessoes_recentes as
select
  s.id              as session_id,
  s.agente_id,
  s.agente_nome,
  s.usuario_id,
  s.usuario_nome,
  s.titulo,
  s.fechada,
  s.created_at,
  s.updated_at,
  last_msg.conteudo   as ultima_mensagem,
  last_msg.role       as ultima_mensagem_role,
  last_msg.created_at as ultima_mensagem_at
from public.chat_sessions s
left join lateral (
  select cm.conteudo, cm.role, cm.created_at
  from public.chat_mensagens cm
  where cm.session_id = s.id
  order by cm.created_at desc
  limit 1
) last_msg on true;

comment on view public.v_chat_sessoes_recentes is
  'Sessões de chat com a última mensagem associada. Alimenta o card "Conversas Recentes".';
