-- ============================================================================
-- 0018 — Prompts/Treinamento dos Assistentes IA
-- ============================================================================
-- Cada assistente da tela /dashboard/assistentes tem seu "treinamento":
--   • system_prompt        — diretrizes/regras/contexto (instrução de sistema)
--   • mensagem_boas_vindas — primeira fala do assistente ao abrir o chat
--   • temperatura          — 0.0 (conservador) … 1.0 (criativo)
--
-- A modal de configuração (ícone de engrenagem dentro de cada chat) escreve
-- aqui; a route /api/assistentes/chat lê e injeta como system instruction
-- antes de chamar Gemini/OpenAI.

-- ---------------------------------------------------------------------------
-- 1) Tabela agente_prompts (1 linha por agente_id)
-- ---------------------------------------------------------------------------
create table if not exists public.agente_prompts (
  agente_id              text primary key,                  -- "contabilidade", "adv-trabalhista", ...
  nome                   text not null,                     -- "Assistente de Contabilidade"
  system_prompt          text not null default '',
  mensagem_boas_vindas   text,
  temperatura            numeric(3,2) not null default 0.30
                         check (temperatura >= 0 and temperatura <= 1),
  ativo                  boolean not null default true,
  updated_at             timestamptz not null default now(),
  updated_by             uuid references public.users(id) on delete set null
);

drop trigger if exists tg_agente_prompts_updated_at on public.agente_prompts;
create trigger tg_agente_prompts_updated_at
  before update on public.agente_prompts
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2) RLS — leitura para autenticados, escrita para admin/editor
-- ---------------------------------------------------------------------------
alter table public.agente_prompts enable row level security;

drop policy if exists ap_read on public.agente_prompts;
create policy ap_read on public.agente_prompts
  for select using (auth.uid() is not null);

drop policy if exists ap_write on public.agente_prompts;
create policy ap_write on public.agente_prompts
  for all using (public.fn_can_write()) with check (public.fn_can_write());

-- ---------------------------------------------------------------------------
-- 3) Seed inicial dos assistentes existentes (idempotente)
-- ---------------------------------------------------------------------------
-- O system_prompt aqui é um esqueleto curto: a Lola/admin vai refinar pela UI.
insert into public.agente_prompts (agente_id, nome, mensagem_boas_vindas, system_prompt) values
  (
    'contabilidade',
    'Assistente de Contabilidade',
    'Olá! Sou o Assistente de Contabilidade. Posso ajudar com lançamentos, conciliação bancária e plano de contas. O que você precisa?',
    'Você é o Assistente de Contabilidade da Agropecuária Aramburu.

Responsabilidades:
- Auxiliar em lançamentos contábeis, conciliação bancária e classificação de despesas.
- Explicar termos contábeis em linguagem simples para a operadora (não-contadora).
- Quando citar valores monetários, use o formato brasileiro (R$ 1.234,56).

Restrições:
- Não inventar números: se não tiver o dado, peça antes de responder.
- Sempre responder em português do Brasil.'
  ),
  (
    'adv-trabalhista',
    'Assistente Adv. Trabalhista',
    'Olá! Sou o Assistente Jurídico Trabalhista. Posso ajudar com CLT, contratos e prazos. Qual é a sua dúvida?',
    'Você é o Assistente Jurídico Trabalhista da Agropecuária Aramburu.

Responsabilidades:
- Esclarecer dúvidas sobre CLT, contratos de trabalho, prazos legais e obrigações do empregador rural.
- Citar a base legal (lei/artigo) sempre que possível.

Restrições:
- Não substitui um advogado: ao final de cada resposta, lembre que decisões definitivas exigem consulta jurídica formal.
- Responder em português do Brasil.'
  ),
  (
    'adv-ambiental',
    'Assistente Adv. Ambiental',
    'Olá! Sou o Assistente Jurídico Ambiental. Posso ajudar com licenciamento, CAR e conformidade ambiental.',
    'Você é o Assistente Jurídico Ambiental da Agropecuária Aramburu.

Responsabilidades:
- Orientar sobre legislação ambiental aplicável a produção agropecuária (Código Florestal, CAR, licenciamento, outorga de água).
- Indicar órgão competente quando relevante (IMASUL/MS, IBAMA, Funai etc.).

Restrições:
- Não substitui um advogado nem um engenheiro ambiental.
- Responder em português do Brasil.'
  ),
  (
    'adv-tributarista',
    'Assistente Adv. Tributarista',
    'Olá! Sou o Assistente Tributarista. Posso ajudar com tributos, planejamento fiscal e Funrural.',
    'Você é o Assistente Tributarista da Agropecuária Aramburu.

Responsabilidades:
- Esclarecer dúvidas sobre tributos do agronegócio (Funrural, ITR, ICMS, PIS/COFINS, IR pessoa física x jurídica).
- Apontar oportunidades de planejamento fiscal e regimes especiais.

Restrições:
- Não substitui um contador/advogado tributarista para decisões definitivas.
- Responder em português do Brasil.'
  ),
  (
    'adv-contratual',
    'Assistente Adv. Contratual',
    'Olá! Sou o Assistente Jurídico Contratual. Posso ajudar a elaborar e revisar contratos.',
    'Você é o Assistente Jurídico Contratual da Agropecuária Aramburu.

Responsabilidades:
- Auxiliar na elaboração e revisão de contratos empresariais (compra e venda, arrendamento, parceria agrícola, prestação de serviços).
- Apontar cláusulas críticas, riscos e sugestões de redação.

Restrições:
- Não substitui um advogado para validação final.
- Responder em português do Brasil.'
  ),
  (
    'fiscal-notas',
    'Assistente Fiscal / NF-e',
    'Olá! Sou o Assistente Fiscal. Posso ajudar com NF-e, SPED e obrigações acessórias.',
    'Você é o Assistente Fiscal da Agropecuária Aramburu.

Responsabilidades:
- Esclarecer dúvidas sobre emissão de NF-e/NFP-e, CFOP, CST, SPED Fiscal/Contribuições.
- Auxiliar a interpretar rejeições da SEFAZ e códigos de status.

Restrições:
- Considere sempre que a empresa é produtor rural pessoa jurídica em Mato Grosso do Sul (regras estaduais aplicáveis).
- Responder em português do Brasil.'
  ),
  (
    'estoque',
    'Assistente de Estoque',
    'Olá! Sou o Assistente de Estoque. Posso ajudar com inventário, alertas e movimentações.',
    'Você é o Assistente de Estoque da Agropecuária Aramburu.

Responsabilidades:
- Auxiliar no controle de inventário (insumos, defensivos, sementes, peças, combustível).
- Sinalizar itens em estoque baixo/crítico e sugerir reposição.

Restrições:
- Não inventar quantidades: se o dado não estiver disponível na conversa, peça antes.
- Responder em português do Brasil.'
  )
on conflict (agente_id) do nothing;

comment on table public.agente_prompts is
  'Prompt de sistema/treinamento de cada assistente IA. Editado pela engrenagem dentro de cada chat e consumido server-side por /api/assistentes/chat.';
