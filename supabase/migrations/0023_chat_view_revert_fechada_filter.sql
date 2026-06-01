-- ============================================================================
-- 0023 — View de sessões recentes volta a mostrar conversas ARQUIVADAS
-- ============================================================================
-- A migration 0020 fez a view filtrar `fechada = false`, com a intenção de
-- esconder sessões arquivadas. Mas o card "Conversas Recentes" do hub é
-- explicitamente o lugar onde a Lola vai consultar histórico — incluindo
-- conversas encerradas. O Hub agora controla a diferenciação visualmente
-- (badge "Arquivada") e o ChatPage aceita ?session=<uuid> para reabrir
-- uma sessão específica passada pelo link.

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
  'Sessões de chat (abertas + arquivadas) com a última mensagem. Hub diferencia pelo campo fechada.';
