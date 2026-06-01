-- ============================================================================
-- 0020 — Hardening do módulo de Assistentes IA
-- ============================================================================
-- Corrige achados do review adversarial:
--   • config_ia: SELECT só admin/editor (chaves de API não devem ser legíveis
--     pelo browser de qualquer usuário autenticado).
--   • agente_prompts: SELECT só admin/editor + view pública sem system_prompt
--     para o front conseguir ler boas-vindas/nome.
--   • chat_sessions / chat_mensagens: escrita restrita ao dono da sessão
--     (leitura continua aberta — escopo do produto).
--   • Índice único parcial para evitar duas sessões "vivas" no mesmo
--     (usuario_id, agente_id) — corta race condition.
--   • Trigger AFTER INSERT em chat_mensagens atualizando chat_sessions.updated_at
--     (o trigger pré-existente só dispara em UPDATE).
--   • Novas colunas em chat_mensagens (tokens_input, model, provider) — métricas
--     deixam de poluir o jsonb `anexos`.
--   • View v_chat_sessoes_recentes só conta sessões abertas (fechada = false).

-- ---------------------------------------------------------------------------
-- 1) config_ia — SELECT restrito
-- ---------------------------------------------------------------------------
drop policy if exists config_ia_read  on public.config_ia;
create policy config_ia_read on public.config_ia
  for select using (public.fn_can_write());

-- (escrita já era admin/editor — mantida)

-- ---------------------------------------------------------------------------
-- 2) agente_prompts — SELECT restrito + view pública só com metadados
-- ---------------------------------------------------------------------------
drop policy if exists ap_read on public.agente_prompts;
create policy ap_read on public.agente_prompts
  for select using (public.fn_can_write());

create or replace view public.v_agente_prompts_publico as
select
  agente_id,
  nome,
  mensagem_boas_vindas,
  ativo
from public.agente_prompts
where ativo = true;

comment on view public.v_agente_prompts_publico is
  'Subconjunto não-sensível de agente_prompts (sem system_prompt/temperatura) — consumido pelo ChatPage para mostrar boas-vindas.';

-- Views herdam a RLS da tabela base, mas o ChatPage precisa que QUALQUER
-- usuário autenticado leia daqui. Como a tabela base agora só permite SELECT
-- para admin/editor, criamos uma SECURITY DEFINER function pra contornar
-- (alternativamente daria pra criar política específica na view; views simples
-- aplicam policies da tabela base). Optamos por marcar a view com security_invoker=false.
alter view public.v_agente_prompts_publico set (security_invoker = false);

-- Garante SELECT explícito para anon/authenticated, já que a tabela base
-- agora tem SELECT restrito por RLS — sem isso, a view também ficaria fechada.
grant select on public.v_agente_prompts_publico to authenticated;
grant select on public.v_agente_prompts_publico to anon;

-- ---------------------------------------------------------------------------
-- 3) chat_sessions — escrita só do dono
-- ---------------------------------------------------------------------------
drop policy if exists cs_write on public.chat_sessions;
create policy cs_write on public.chat_sessions
  for all
  using       (auth.uid() is not null and usuario_id = auth.uid())
  with check  (auth.uid() is not null and usuario_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4) chat_mensagens — escrita só em sessões do dono
-- ---------------------------------------------------------------------------
drop policy if exists cm_write on public.chat_mensagens;
create policy cm_write on public.chat_mensagens
  for all
  using (
    auth.uid() is not null and exists (
      select 1 from public.chat_sessions s
      where s.id = chat_mensagens.session_id
        and s.usuario_id = auth.uid()
    )
  )
  with check (
    auth.uid() is not null and exists (
      select 1 from public.chat_sessions s
      where s.id = chat_mensagens.session_id
        and s.usuario_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 5) Índice único parcial — no máximo UMA sessão "viva" por (user, agente)
-- ---------------------------------------------------------------------------
create unique index if not exists uniq_cs_open
  on public.chat_sessions (usuario_id, agente_id)
  where fechada = false;

-- ---------------------------------------------------------------------------
-- 6) Trigger AFTER INSERT em chat_mensagens → bump chat_sessions.updated_at
-- ---------------------------------------------------------------------------
create or replace function public.tg_bump_session_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_sessions
     set updated_at = new.created_at
   where id = new.session_id;
  return new;
end;
$$;

drop trigger if exists tg_cm_bump_session on public.chat_mensagens;
create trigger tg_cm_bump_session
  after insert on public.chat_mensagens
  for each row execute function public.tg_bump_session_updated_at();

-- ---------------------------------------------------------------------------
-- 7) Novas colunas em chat_mensagens (telemetria/usage)
-- ---------------------------------------------------------------------------
alter table public.chat_mensagens
  add column if not exists tokens_input integer,
  add column if not exists model        text,
  add column if not exists provider     public.ia_provider;

-- ---------------------------------------------------------------------------
-- 8) View de sessões recentes — só conta abertas
-- ---------------------------------------------------------------------------
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
) last_msg on true
where s.fechada = false;
