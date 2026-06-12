-- ============================================================================
-- 0030 — Identificação bancária completa nos cards (RF-FIN-01 / RF-FIN-02)
-- ============================================================================
-- A Lola pediu que cada card de "Saldos por Banco" exiba os dados completos:
--   "Banco 403 · Ag. 0001 · Cc. 2347942-2"   (banco)
--   "Cooperativa 748 · Ag. 0913 · Cc. 29945-3" (cooperativa)
--
-- Para isso faltavam duas informações no cadastro de contas:
--   • numero_banco     — código do banco no BACEN (403, 748, 077, 348)
--   • tipo_instituicao — "banco" ou "cooperativa" (define o rótulo do card)
--
-- A RECONCILIAÇÃO DOS DADOS (preencher esses campos para Cora/Sicredi/Inter/XP,
-- criar o SICREDINVEST e desativar o Sicredi MJU) fica no
-- seed 12_reconciliacao_contas_bancarias.sql — que roda DEPOIS dos seeds 03/0011,
-- garantindo que as contas já existem. Esta migration só altera o SCHEMA.
--
-- Reversível (ver ROLLBACK no fim).

-- ---------------------------------------------------------------------------
-- 1) Novas colunas de identificação
-- ---------------------------------------------------------------------------
alter table public.contas_bancarias_empresa
  add column if not exists numero_banco     text,
  add column if not exists tipo_instituicao text not null default 'banco';

comment on column public.contas_bancarias_empresa.numero_banco is
  'Código do banco no BACEN (3 dígitos). Ex: 403 Cora, 748 Sicredi, 077 Inter, 348 XP.';
comment on column public.contas_bancarias_empresa.tipo_instituicao is
  'banco | cooperativa — define o rótulo exibido no card ("Banco 403" vs "Cooperativa 748").';

-- ---------------------------------------------------------------------------
-- 2) View de saldo por banco recriada expondo a identificação completa
-- ---------------------------------------------------------------------------
-- Acrescenta banco_numero, banco_tipo_instituicao, banco_numero_conta,
-- banco_digito e banco_tipo (corrente/investimento) ao retorno. A lógica de
-- saldo/compromissos/projetado é idêntica à 0010.
-- Recriamos a view com DROP + CREATE (e não CREATE OR REPLACE) para ser
-- idempotente mesmo quando a view já existe numa forma diferente — re-aplicar
-- esta migration ou o apply_all não falha com "cannot drop columns from view".
-- O frontend lê por nome, então a posição das colunas não importa.
drop view if exists public.v_saldo_atual_por_banco;
create view public.v_saldo_atual_por_banco as
select
  cb.id                as conta_bancaria_id,
  cb.nome              as banco_nome,
  cb.apelido           as banco_apelido,
  cb.banco             as banco_instituicao,
  cb.agencia           as banco_agencia,
  cb.ordem             as banco_ordem,

  -- Saldo conciliado (soma de tudo que de fato entrou/saiu)
  coalesce(sum(te.valor) filter (
    where te.status in (
      'saldo_inicial',
      'recebido', 'pago',
      'repassado',
      'aplicado', 'aplicacao',
      'resgatado', 'resgate'
    )
  ), 0)                                                           as saldo_atual,

  -- Compromissos previstos
  coalesce(sum(te.valor) filter (where te.status = 'a_pagar'),    0) as a_pagar,
  coalesce(sum(te.valor) filter (where te.status = 'a_receber'),  0) as a_receber,
  coalesce(sum(te.valor) filter (where te.status = 'a_repassar'), 0) as a_repassar,
  coalesce(sum(te.valor) filter (where te.status = 'a_resgatar'), 0) as a_resgatar,
  coalesce(sum(te.valor) filter (
    where te.status in ('provisionado','provisionado_dl','provisionado_dv')
  ), 0)                                                           as provisionado,

  -- Quebra mais granular pro card (entradas / saídas realizadas separadas)
  coalesce(sum(te.valor) filter (
    where te.status in ('saldo_inicial','recebido','resgatado','resgate','aplicacao')
  ), 0)                                                           as entradas_realizadas,
  coalesce(sum(te.valor) filter (
    where te.status in ('pago','repassado','aplicado')
  ), 0)                                                           as saidas_realizadas,

  -- Saldo "projetado" = saldo atual + a_receber - a_pagar - provisionado
  coalesce(sum(te.valor) filter (
    where te.status in (
      'saldo_inicial','recebido','pago','repassado','aplicado','aplicacao',
      'resgatado','resgate','a_pagar','a_receber','a_repassar','a_resgatar',
      'provisionado','provisionado_dl','provisionado_dv'
    )
  ), 0)                                                           as saldo_projetado,

  count(te.id)                                                    as total_lancamentos,

  -- Identificação completa (RF-FIN-01/02) — anexadas ao FIM
  cb.numero_banco      as banco_numero,
  cb.tipo_instituicao  as banco_tipo_instituicao,
  cb.numero_conta      as banco_numero_conta,
  cb.digito            as banco_digito,
  cb.tipo              as banco_tipo
from public.contas_bancarias_empresa cb
left join public.transacoes_empresa te on te.conta_bancaria_id = cb.id
where cb.ativa = true
group by cb.id, cb.nome, cb.apelido, cb.banco, cb.agencia, cb.ordem,
         cb.numero_banco, cb.tipo_instituicao, cb.numero_conta, cb.digito, cb.tipo
order by cb.ordem;

comment on view public.v_saldo_atual_por_banco is
  'Saldo bancário conciliado por banco (espelha "Saldo Disponível" da planilha) + '
  'identificação completa para os cards: numero_banco, tipo_instituicao, conta, dígito e tipo.';

-- ----------------------------------------------------------------------------
-- ROLLBACK (reverter esta migration):
--   -- 1. Recriar a view sem as colunas novas (ver migration 0010_saldo_por_banco.sql)
--   -- 2. alter table public.contas_bancarias_empresa
--   --      drop column if exists tipo_instituicao,
--   --      drop column if exists numero_banco;
-- ----------------------------------------------------------------------------
