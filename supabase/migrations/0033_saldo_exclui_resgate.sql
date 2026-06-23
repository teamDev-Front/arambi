-- ============================================================================
-- 0033 — Corrige saldo_atual: 'Resgate' (provisionado) não é saldo realizado
-- ============================================================================
-- Contexto (explicado pela Lola):
--   Os pagamentos de obra pelo Sicredi saem de uma CONTA INVESTIMENTO (rendendo),
--   não da conta corrente. Para pagar, faz-se um RESGATE. Para o saldo bancário
--   não ser distorcido pelas despesas ainda PROVISIONADAS, a Lola provisiona
--   também os resgates: cada lançamento status "Resgate" é um SOMASE de tudo que
--   está "Provisionado" + "Despesas Eventuais" + pago pelo Sicredi naquele mês.
--   Assim Resgate(+) zera Provisionado(−) e NÃO entra no saldo realizado.
--
-- Bug: a view v_saldo_atual_por_banco contava 'resgate' como realizado em
--   saldo_atual e entradas_realizadas, inflando o Sicredi 0913 em R$ 38.724,65
--   (45.073,95 mostrado vs 6.349,30 real da planilha).
--
-- Correção: remover 'resgate' de saldo_atual e entradas_realizadas. Mantém-se
--   'resgatado' (resgate JÁ realizado). saldo_projetado continua somando tudo
--   (lá o 'resgate' segue anulando o 'provisionado'), então projeção não muda.

drop view if exists public.v_saldo_atual_por_banco;
create view public.v_saldo_atual_por_banco as
select
  cb.id                as conta_bancaria_id,
  cb.nome              as banco_nome,
  cb.apelido           as banco_apelido,
  cb.banco             as banco_instituicao,
  cb.agencia           as banco_agencia,
  cb.ordem             as banco_ordem,

  -- Saldo conciliado (soma de tudo que de fato entrou/saiu).
  -- 'resgate' (provisionado) REMOVIDO; 'resgatado' (realizado) mantido.
  coalesce(sum(te.valor) filter (
    where te.status in (
      'saldo_inicial',
      'recebido', 'pago',
      'repassado',
      'aplicado', 'aplicacao',
      'resgatado'
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

  -- Quebra mais granular pro card (entradas / saídas realizadas separadas).
  -- 'resgate' (provisionado) REMOVIDO daqui também — não é entrada realizada.
  coalesce(sum(te.valor) filter (
    where te.status in ('saldo_inicial','recebido','resgatado','aplicacao')
  ), 0)                                                           as entradas_realizadas,
  coalesce(sum(te.valor) filter (
    where te.status in ('pago','repassado','aplicado')
  ), 0)                                                           as saidas_realizadas,

  -- Saldo "projetado" = saldo atual + previstos (inclui 'resgate', que lá segue
  -- anulando o 'provisionado'). Inalterado.
  coalesce(sum(te.valor) filter (
    where te.status in (
      'saldo_inicial','recebido','pago','repassado','aplicado','aplicacao',
      'resgatado','resgate','a_pagar','a_receber','a_repassar','a_resgatar',
      'provisionado','provisionado_dl','provisionado_dv'
    )
  ), 0)                                                           as saldo_projetado,

  count(te.id)                                                    as total_lancamentos,

  -- Identificação completa (RF-FIN-01/02)
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
  'identificação completa. saldo_atual exclui "Resgate" provisionado (só "Resgatado" '
  'realizado conta), corrigido na migration 0033.';
