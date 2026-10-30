-- ============================================================================
-- 0067 — Assistentes: escolha do modelo de IA
-- ============================================================================
-- Pedido do Luiz (29-out-2026): a Adri e a Lola escolhem qual modelo responde
-- os assistentes — um GPT mais antigo e barato ou um mais novo. O provedor
-- ativo já mora em config_ia (0017); o modelo de cada provedor fica ao lado.
--
-- Vazio (null) = padrão do código (gpt-4o-mini / gemini-2.5-flash), que é
-- exatamente o comportamento de antes desta migration. O app funciona com ou
-- sem ela: lê config_ia com select *, e o seletor só aparece depois dela.
-- As políticas de config_ia (0017/0020: leitura e escrita só admin/editor)
-- já cobrem as colunas novas.
--
-- Idempotente. Não mexe em dado nenhum.

alter table public.config_ia
  add column if not exists openai_model text,
  add column if not exists gemini_model text;

comment on column public.config_ia.openai_model is
  'Modelo da OpenAI usado pelos assistentes (ex.: gpt-4o-mini, gpt-5-mini). Vazio = padrão do código. Migration 0067.';
comment on column public.config_ia.gemini_model is
  'Modelo do Gemini usado pelos assistentes (ex.: gemini-2.5-flash). Vazio = padrão do código. Migration 0067.';
