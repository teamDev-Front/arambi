-- ============================================================================
-- 0010 — Saldo atual por banco (conciliação bancária)
-- ============================================================================
-- Reproduz a lógica que a Lola usa hoje na aba "Saldo Disponível":
-- saldo atual = saldo_inicial + todos os status realizados (Pago, Recebido,
-- Aplicado, Resgatado, Repassado, Aplicação, Resgate).
--
-- Status NÃO contam:
--   • a_pagar / a_receber / a_repassar / a_aplicar / a_resgatar  → futuros
--   • provisionado / provisionado_dl / provisionado_dv          → previsão
--
-- Esses status entram em colunas separadas (a_pagar, a_receber, provisionado)
-- pra ela ter visão de "o que vai sair/entrar" sem misturar com saldo real.

create or replace view public.v_saldo_atual_por_banco as
select
  cb.id                                                           as conta_bancaria_id,
  cb.nome                                                         as banco_nome,
  cb.apelido                                                      as banco_apelido,
  cb.banco                                                        as banco_instituicao,
  cb.agencia                                                      as banco_agencia,
  cb.ordem                                                        as banco_ordem,

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
  -- Usado pra responder "se eu honrar tudo que está em aberto, fico com quanto?"
  coalesce(sum(te.valor) filter (
    where te.status in (
      'saldo_inicial','recebido','pago','repassado','aplicado','aplicacao',
      'resgatado','resgate','a_pagar','a_receber','a_repassar','a_resgatar',
      'provisionado','provisionado_dl','provisionado_dv'
    )
  ), 0)                                                           as saldo_projetado,

  count(te.id)                                                    as total_lancamentos
from public.contas_bancarias_empresa cb
left join public.transacoes_empresa te on te.conta_bancaria_id = cb.id
where cb.ativa = true
group by cb.id, cb.nome, cb.apelido, cb.banco, cb.agencia, cb.ordem
order by cb.ordem;

comment on view public.v_saldo_atual_por_banco is
  'Saldo bancário conciliado por banco — espelha a lógica de "Saldo Disponível" da planilha. Inclui projetado (saldo + a receber - a pagar - provisionado) para visão de fluxo.';
