-- ============================================================================
-- 0032 — Fluxo de Caixa mensal + "Saldo − contas do próximo mês"
-- ============================================================================
-- Espelha a aba "Saldo Disponível" da planilha Provisionamento_FLUXO DE CAIXA.
-- O indicador-chave (linha 37 da planilha "SALDO (-) CONTAS DO PRÓXIMO MÊS"):
--
--   saldo_menos_proximo_mes(M) = saldo acumulado no fim de M
--                              + Saídas(M+1)              (negativas)
--                              + Resgates(M+1)            (entradas de investimento)
--                              + Outras Entradas(M+1)     (a receber/recebido que NÃO são vendas)
--
-- Ou seja: "se eu pegar meu saldo de hoje e passar TODO o mês que vem contando só
-- com resgates e outras entradas — SEM depender de vendas — sobra isso?".
-- Verde (>= 0) = passa o mês tranquila; Vermelho (< 0) = vai precisar de vendas/resgates.
--
-- Fórmula original (aba Saldo Disponível): F37 = SUM(F33:F35) + H26 + H25 + H24.
-- "Vendas" = conta contábil 1.2 (Receita de Arrendamento / Venda de Soja/Milho) —
-- propositalmente EXCLUÍDA do próximo mês.

create or replace view public.v_fluxo_caixa_mensal as
with por_mes as (
  select
    te.mes_referencia,
    -- Saldo disponível: SÓ contas-corrente (igual à planilha — investimentos ficam
    -- de fora; o dinheiro investido entra de volta via "resgate" do próximo mês).
    coalesce(sum(te.valor) filter (where te.status in
      ('saldo_inicial','recebido','pago','repassado','aplicado','aplicacao','resgatado','resgate')
      and cbe.tipo = 'corrente'), 0)                                                   as movimento_realizado,
    -- Saídas do mês (todas as contas): realizadas + provisionadas + a pagar — negativas
    coalesce(sum(te.valor) filter (where te.status in
      ('provisionado','provisionado_dv','provisionado_dl','a_pagar','a_repassar','a_aplicar','pago','repassado','aplicado','aplicacao')), 0) as saidas_mes,
    -- Resgates de investimento (entradas "certas" que caem na conta-corrente)
    coalesce(sum(te.valor) filter (where te.status in ('resgate','a_resgatar','resgatado')), 0) as resgate_mes,
    -- Outras entradas = a receber/recebido que NÃO são vendas (conta 1.2)
    coalesce(sum(te.valor) filter (where te.status in ('a_receber','recebido') and te.conta_contabil_cod not like '1.2%'), 0) as outros_entradas_mes,
    -- Vendas (conta 1.2) — excluídas do indicador de próximo mês
    coalesce(sum(te.valor) filter (where te.status in ('a_receber','recebido') and te.conta_contabil_cod like '1.2%'), 0) as vendas_mes
  from public.transacoes_empresa te
  left join public.contas_bancarias_empresa cbe on cbe.id = te.conta_bancaria_id
  where te.mes_referencia is not null
  group by te.mes_referencia
),
acc as (
  select
    *,
    sum(movimento_realizado) over (order by mes_referencia rows between unbounded preceding and current row) as saldo_final_acumulado
  from por_mes
)
select
  mes_referencia,
  saldo_final_acumulado,
  saidas_mes,
  resgate_mes,
  outros_entradas_mes,
  vendas_mes,
  coalesce(lead(saidas_mes) over (order by mes_referencia), 0)                         as saidas_proximo_mes,
  coalesce(lead(resgate_mes + outros_entradas_mes) over (order by mes_referencia), 0)  as entradas_garantidas_proximo_mes,
  saldo_final_acumulado
    + coalesce(lead(saidas_mes + resgate_mes + outros_entradas_mes) over (order by mes_referencia), 0) as saldo_menos_proximo_mes
from acc
order by mes_referencia;

comment on view public.v_fluxo_caixa_mensal is
  'Fluxo de caixa mensal (espelha aba "Saldo Disponível"). saldo_menos_proximo_mes = saldo acumulado no fim do mês + saídas/resgates/outras entradas do mês seguinte, SEM vendas — mostra se o mês seguinte aperta sem depender de vendas.';

-- ----------------------------------------------------------------------------
-- ROLLBACK:
--   drop view if exists public.v_fluxo_caixa_mensal;
-- ----------------------------------------------------------------------------
