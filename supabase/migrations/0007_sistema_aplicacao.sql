-- ============================================================================
-- 0007 — Sistema da aplicação (estoque, documentos, recibos, chats, logs)
-- ============================================================================
-- Tabelas que sustentam os módulos do front que NÃO vêm da planilha,
-- mas estão no escopo do AramBI (NOVO PROJETO AGRO.pdf).

-- ---------------------------------------------------------------------------
-- Estoque
-- ---------------------------------------------------------------------------
create table if not exists public.estoque (
  id             uuid primary key default gen_random_uuid(),
  produto        text not null,
  categoria      text,
  quantidade     numeric(12,3) not null default 0,
  unidade        text not null default 'un',
  valor_unitario numeric(15,2) not null default 0,
  status         public.estoque_status not null default 'em_estoque',
  fornecedor_id  uuid references public.fornecedores(id) on delete set null,
  fornecedor_nome text,
  observacao     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references public.users(id) on delete set null
);

create index if not exists idx_estoque_status on public.estoque(status);
create index if not exists idx_estoque_categoria on public.estoque(categoria);

drop trigger if exists tg_estoque_updated_at on public.estoque;
create trigger tg_estoque_updated_at
  before update on public.estoque
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Documentos (anexos)
-- ---------------------------------------------------------------------------
-- Vinculados a um mês de referência para alimentar o filtro do dashboard.
create table if not exists public.documentos (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  tipo            text,                                -- PDF / Excel / PPT / XML / Imagem...
  tamanho_bytes   bigint,
  storage_path    text,                                -- caminho no Supabase Storage
  url_publica     text,
  mes_referencia  text,                                -- "YYYY-MM"
  numero_nota     text,
  descricao       text,
  vinculado_a_transacao_empresa_id  uuid references public.transacoes_empresa(id) on delete set null,
  vinculado_a_transacao_socio_id    uuid references public.transacoes_socio(id) on delete set null,
  vinculado_a_obra_lts_item_id      uuid references public.obra_lts_itens(id) on delete set null,
  observacao      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.users(id) on delete set null
);

create index if not exists idx_doc_mes_ref     on public.documentos(mes_referencia);
create index if not exists idx_doc_numero_nota on public.documentos(numero_nota);
create index if not exists idx_doc_te          on public.documentos(vinculado_a_transacao_empresa_id);
create index if not exists idx_doc_ts          on public.documentos(vinculado_a_transacao_socio_id);

drop trigger if exists tg_doc_updated_at on public.documentos;
create trigger tg_doc_updated_at
  before update on public.documentos
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Recibos / Termos
-- ---------------------------------------------------------------------------
create table if not exists public.recibo_modelos (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,                -- "simples", "prestacao_servico", "aluguel"...
  nome            text not null,                       -- "Recibo Simples"
  template_html   text,                                -- conteúdo com placeholders {{nome}}, {{valor}}...
  campos_extras   jsonb,                               -- definição dos campos dinâmicos
  pdfmonkey_id    text,                                -- id do template no PDFMonkey, quando integrar
  ativo           boolean not null default true,
  ordem           smallint,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists tg_rm_updated_at on public.recibo_modelos;
create trigger tg_rm_updated_at
  before update on public.recibo_modelos
  for each row execute function public.tg_set_updated_at();

create table if not exists public.recibos (
  id              uuid primary key default gen_random_uuid(),
  numero          text unique not null,                -- "REC-001"
  modelo_id       uuid references public.recibo_modelos(id) on delete restrict,
  beneficiario    text not null,
  descricao       text,
  valor           numeric(15,2) not null default 0,
  data            date not null,
  campos_extras   jsonb not null default '{}'::jsonb,
  status          public.recibo_status not null default 'rascunho',
  pdf_url         text,
  observacao      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.users(id) on delete set null
);

create index if not exists idx_recibos_status on public.recibos(status);
create index if not exists idx_recibos_data   on public.recibos(data);

drop trigger if exists tg_recibos_updated_at on public.recibos;
create trigger tg_recibos_updated_at
  before update on public.recibos
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Assistentes IA — chats persistidos
-- ---------------------------------------------------------------------------
-- A chave de sessão é "<usuario>-<ia>" no escopo: salvar a sessão completa
-- para QUALQUER usuário poder ver o histórico de qualquer outro.
create table if not exists public.chat_sessions (
  id            uuid primary key default gen_random_uuid(),
  agente_id     text not null,                          -- "financeiro", "adv-trabalhista"...
  agente_nome   text not null,                          -- "Assistente Financeiro"
  usuario_id    uuid not null references public.users(id) on delete cascade,
  usuario_nome  text not null,
  titulo        text,                                   -- gerado a partir da 1ª mensagem
  fechada       boolean not null default false,
  metadata      jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_cs_agente   on public.chat_sessions(agente_id);
create index if not exists idx_cs_usuario  on public.chat_sessions(usuario_id);
create index if not exists idx_cs_updated  on public.chat_sessions(updated_at desc);

drop trigger if exists tg_cs_updated_at on public.chat_sessions;
create trigger tg_cs_updated_at
  before update on public.chat_sessions
  for each row execute function public.tg_set_updated_at();

create table if not exists public.chat_mensagens (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.chat_sessions(id) on delete cascade,
  role        public.chat_role not null,
  conteudo    text not null,
  anexos      jsonb,
  tokens      integer,
  created_at  timestamptz not null default now()
);

create index if not exists idx_cm_session on public.chat_mensagens(session_id, created_at);

-- ---------------------------------------------------------------------------
-- Logs (auditoria)
-- ---------------------------------------------------------------------------
create table if not exists public.logs (
  id            uuid primary key default gen_random_uuid(),
  tipo          public.log_tipo not null,
  acao          text not null,                         -- "LOGIN", "CREATE", "EXPORT_PDF"...
  descricao     text,
  usuario_id    uuid references public.users(id) on delete set null,
  usuario_nome  text,
  metadados     jsonb,
  ip            inet,
  user_agent    text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_logs_tipo    on public.logs(tipo);
create index if not exists idx_logs_usuario on public.logs(usuario_id);
create index if not exists idx_logs_created on public.logs(created_at desc);
