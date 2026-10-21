-- ============================================================================
-- 0059 — Acessos sem e-mail: senha provisória + pedidos de nova senha (21-out-2026)
-- ============================================================================
-- Mudança de dinâmica pedida pelo Luiz (21-out): o e-mail embutido do Supabase
-- só entrega para a equipe do projeto, manda 2 por hora e (plano Free) não usa
-- modelo personalizado. Então o processo deixa de depender de e-mail:
--
--   1. O Super Admin cria o acesso já com uma SENHA PROVISÓRIA e manda para a
--      pessoa (WhatsApp). users.trocar_senha = true.
--   2. No primeiro acesso, o sistema obriga a pessoa a criar a própria senha
--      (proxy, páginas e APIs barram tudo até isso). trocar_senha = false.
--   3. Esqueceu a senha: na tela de login a pessoa informa e-mail + nova senha;
--      vira um PEDIDO em solicitacoes_senha que o Super Admin aprova ou recusa
--      na tela Acessos. A senha pedida fica CIFRADA (AES-GCM, chave só no
--      servidor) até a decisão e é apagada logo depois.
--
-- Depende da 0058. Aplicar no SQL Editor. Idempotente.

-- ---------------------------------------------------------------------------
-- 1) users.trocar_senha
-- ---------------------------------------------------------------------------
-- Não entra no grant de coluna da 0058 (só full_name/avatar_url): o próprio
-- usuário não consegue limpar a marca pelo console — só o servidor, depois
-- de trocar a senha de fato.
alter table public.users
  add column if not exists trocar_senha boolean not null default false;

comment on column public.users.trocar_senha is
  'true = entrou (ou vai entrar) com senha provisória; o sistema exige criar a própria senha antes de liberar as telas. Migration 0059.';

-- A marca de "senha definida" (0058) não vale enquanto a senha for provisória.
create or replace function public.fn_marcar_senha_definida()
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.users
     set senha_definida_em = coalesce(senha_definida_em, now())
   where id = auth.uid()
     and senha_definida_em is null
     and not trocar_senha
$$;

-- ---------------------------------------------------------------------------
-- 2) Pedidos de nova senha (tela de login → aprovação na tela Acessos)
-- ---------------------------------------------------------------------------
create table if not exists public.solicitacoes_senha (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  -- AES-256-GCM com chave derivada no servidor (src/lib/acessos/cifra.ts);
  -- vira NULL assim que o pedido é decidido. Nunca a senha em texto puro.
  senha_cifrada  text,
  status         text not null default 'pendente'
                 check (status in ('pendente', 'aprovada', 'recusada', 'cancelada', 'expirada')),
  ip             inet,
  user_agent     text,
  criado_em      timestamptz not null default now(),
  decidido_em    timestamptz,
  decidido_por   uuid references public.users(id) on delete set null,
  motivo         text
);

comment on table public.solicitacoes_senha is
  'Pedidos de nova senha feitos na tela de login; o Super Admin aprova ou recusa na tela Acessos. Só o servidor (service role) lê e grava. Migration 0059.';

-- No máximo um pedido pendente por pessoa (o novo cancela o anterior).
create unique index if not exists uq_solicitacoes_senha_pendente
  on public.solicitacoes_senha(user_id) where status = 'pendente';
create index if not exists idx_solicitacoes_senha_status
  on public.solicitacoes_senha(status, criado_em desc);

-- RLS ligado e SEM políticas: usuário logado (ou anônimo) não lê nem grava;
-- tudo passa pelas rotas /api/auth/solicitar-senha e /api/acessos/*.
alter table public.solicitacoes_senha enable row level security;
revoke all on public.solicitacoes_senha from anon, authenticated;

-- ----------------------------------------------------------------------------
-- ROLLBACK (manual):
--   drop table if exists public.solicitacoes_senha;
--   alter table public.users drop column if exists trocar_senha;
--   (fn_marcar_senha_definida: recriar a versão da 0058)
-- ----------------------------------------------------------------------------
