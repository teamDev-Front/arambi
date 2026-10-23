-- ============================================================================
-- 0065 — Fluxo de Caixa: dezembro fecha o ano
-- ============================================================================
-- Pedido da Adri (22-out-2026): "o valor apresentado no fechamento de dezembro
-- deve ser exatamente igual ao valor indicado em Saldo Fluxo de Caixa. Idem a
-- planilha do fluxo de caixa."
--
-- Na VS4 (uma planilha por ano), o "SALDO (−) CONTAS DO PRÓXIMO MÊS" de
-- dezembro é só o saldo final das contas do fluxo — não existe janeiro do ano
-- seguinte para descontar. O sistema já tem lançamentos de 2027, e a 0060/0061
-- descontava as saídas de janeiro/2027 do valor de dezembro/2026. Agora o
-- "próximo mês" fica dentro do mesmo ano (lead … partition by ano): dezembro =
-- saldo final das contas do fluxo = o card "Saldo Fluxo de Caixa" da Home com o
-- ano inteiro marcado (padrão da Home desde 22-out).
--
-- Só muda a coluna saldo_menos_proximo_mes de DEZEMBRO; nenhuma outra coluna,
-- nenhum outro mês. Mesmas colunas, na mesma ordem (create or replace).
-- Depende da 0061. Idempotente.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'v_fluxo_caixa_planilha'
       and column_name = 'entradas_realizadas'
  ) then
    raise exception 'Aplique a 0061_fluxo_realizado_provisionado.sql antes da 0065.';
  end if;
end $$;

create or replace view public.v_fluxo_caixa_planilha
with (security_invoker = true) as
with limites as (
  select min(mes_referencia) as ini, max(mes_referencia) as fim
    from public.transacoes_empresa
   where mes_referencia ~ '^[0-9]{4}-[0-9]{2}$'
),
meses as (
  select to_char(g, 'YYYY-MM') as mes_referencia
    from limites,
         generate_series(to_date(limites.ini, 'YYYY-MM'), to_date(limites.fim, 'YYYY-MM'), interval '1 month') g
),
transf as (
  select codigo
    from public.classificacao_financeira
   where codigo = '2.9'
      or (nivel = 2 and natureza = 'saida' and nome ilike '%transfer%')
),
lanc as (
  select te.mes_referencia, te.valor, te.status, te.conta_contabil_cod, te.centro_custo_cod, te.tipo_despesa,
         coalesce(c.compoe_fluxo_caixa, false)                as conta_fluxo,
         c.tipo                                              as conta_tipo,
         -- A linha automática de saldo DV mora em 2.9.3, mas é despesa (VS4).
         te.conta_contabil_cod in (select codigo from transf)
           and te.status <> 'provisionado_dv'                as eh_transferencia
    from public.transacoes_empresa te
    left join public.contas_bancarias_empresa c on c.id = te.conta_bancaria_id
   where te.mes_referencia is not null
),
por_mes as (
  select mes_referencia,
    -- Entradas
    sum(valor) filter (where status = 'saldo_inicial')                                         as saldo_inicial,
    sum(valor) filter (where conta_contabil_cod = '1.2' and status in ('a_receber','recebido'))  as vendas,
    sum(valor) filter (where status in ('resgate','a_resgatar','resgatado')
                         and conta_fluxo and conta_tipo = 'corrente')                           as resgates_entrada,
    sum(valor) filter (where status in ('a_receber','recebido'))                                as recebimentos,
    -- Saídas
    sum(valor) filter (where status in ('provisionado','a_pagar','pago','provisionado_dv'))     as despesas_brutas,
    sum(valor) filter (where centro_custo_cod = '2.7.2'
                         and status in ('provisionado','a_pagar','pago'))                       as despesas_obra,
    sum(valor) filter (where eh_transferencia
                         and status in ('provisionado','a_pagar','pago','provisionado_dv'))     as transferencias,
    sum(valor) filter (where status in ('provisionado_dl','a_repassar','repassado'))            as distribuicao_lucro,
    sum(valor) filter (where status in ('a_aplicar','aplicado','aplicacao'))                    as aplicacoes,
    sum(valor) filter (where status in ('resgate','a_resgatar','resgatado')
                         and conta_fluxo and conta_tipo = 'investimento')                       as resgates_saida,
    -- Despesa Variável (linhas 49-50; o saldo DV automático 'provisionado_dv' não entra)
    sum(valor) filter (where tipo_despesa = 'variavel'
                         and status in ('a_pagar','pago','recebido','a_receber'))               as dv_mov_utilizado,
    sum(valor) filter (where tipo_despesa = 'variavel' and status = 'provisionado')             as dv_mov_provisionado,
    -- Realizado × provisionado (0061)
    sum(valor) filter (where status = 'recebido'
                          or (status = 'resgatado' and conta_fluxo and conta_tipo = 'corrente')) as ent_realizado,
    sum(valor) filter (where status = 'a_receber'
                          or (status in ('resgate','a_resgatar') and conta_fluxo and conta_tipo = 'corrente')) as ent_provisionado,
    sum(valor) filter (where status in ('pago','repassado','aplicado')
                          or (status = 'resgatado' and conta_fluxo and conta_tipo = 'investimento')) as sai_realizado,
    sum(valor) filter (where status in ('provisionado','a_pagar','provisionado_dv','provisionado_dl',
                                        'a_repassar','a_aplicar','aplicacao')
                          or (status in ('resgate','a_resgatar') and conta_fluxo and conta_tipo = 'investimento')) as sai_provisionado
  from lanc
  group by mes_referencia
),
contas as (
  select mes_referencia,
         sum(saldo_final) filter (where compoe_fluxo_caixa) as saldo_contas_fluxo,
         sum(saldo_final)                                   as saldo_todas_contas
    from public.v_fluxo_caixa_contas
   group by mes_referencia
),
linhas as (
  select m.mes_referencia,
         coalesce(p.saldo_inicial, 0)                                                      as saldo_inicial,
         coalesce(p.vendas, 0)                                                             as vendas,
         coalesce(p.resgates_entrada, 0)                                                   as resgates_entrada,
         coalesce(p.recebimentos, 0) - coalesce(p.vendas, 0)                               as outras_entradas,
         coalesce(p.despesas_brutas, 0) - coalesce(p.despesas_obra, 0) - coalesce(p.transferencias, 0) as despesas_aramburu,
         coalesce(p.distribuicao_lucro, 0)                                                 as distribuicao_lucro,
         coalesce(p.despesas_obra, 0)                                                      as despesas_obra,
         coalesce(p.aplicacoes, 0)                                                         as aplicacoes,
         coalesce(p.resgates_saida, 0)                                                     as resgates_saida,
         coalesce(p.transferencias, 0)                                                     as transferencias,
         coalesce(c.saldo_contas_fluxo, 0)                                                 as saldo_contas_fluxo,
         coalesce(c.saldo_todas_contas, 0)                                                 as saldo_todas_contas,
         public.fn_dv_limite_mensal()                                                      as dv_limite,
         -coalesce(p.dv_mov_utilizado, 0)                                                  as dv_utilizado,
         -coalesce(p.dv_mov_provisionado, 0)                                               as dv_provisionado,
         coalesce(p.saldo_inicial, 0) + coalesce(p.ent_realizado, 0)                       as entradas_realizadas,
         coalesce(p.ent_provisionado, 0)                                                   as entradas_provisionadas,
         coalesce(p.sai_realizado, 0)                                                      as saidas_realizadas,
         coalesce(p.sai_provisionado, 0)                                                   as saidas_provisionadas
    from meses m
    left join por_mes p using (mes_referencia)
    left join contas  c using (mes_referencia)
),
calc as (
  select l.*,
         saldo_inicial + vendas + resgates_entrada + outras_entradas                                        as entradas,
         despesas_aramburu + distribuicao_lucro + despesas_obra + aplicacoes + resgates_saida + transferencias as saidas
    from linhas l
)
select
  mes_referencia,
  saldo_inicial::numeric(15,2),
  vendas::numeric(15,2),
  resgates_entrada::numeric(15,2),
  outras_entradas::numeric(15,2),
  entradas::numeric(15,2),
  despesas_aramburu::numeric(15,2),
  distribuicao_lucro::numeric(15,2),
  despesas_obra::numeric(15,2),
  aplicacoes::numeric(15,2),
  resgates_saida::numeric(15,2),
  transferencias::numeric(15,2),
  saidas::numeric(15,2),
  (entradas + saidas)::numeric(15,2)                                                          as resultado,
  saldo_contas_fluxo::numeric(15,2),
  -- Linha 43: saldo final das contas do fluxo + o que o mês seguinte já tem de
  -- certo (saídas, outras entradas e resgates) — SEM vendas. Dezembro fecha o
  -- ano: não olha janeiro do ano seguinte (0065), então dezembro = saldo final.
  (saldo_contas_fluxo
    + coalesce(lead(saidas + outras_entradas + resgates_entrada)
               over (partition by left(mes_referencia, 4) order by mes_referencia), 0))::numeric(15,2)
                                                                                             as saldo_menos_proximo_mes,
  saldo_todas_contas::numeric(15,2),
  dv_limite::numeric(15,2),
  dv_utilizado::numeric(15,2),
  dv_provisionado::numeric(15,2),
  (dv_limite - dv_utilizado - dv_provisionado)::numeric(15,2)                                  as dv_saldo,
  entradas_realizadas::numeric(15,2),
  entradas_provisionadas::numeric(15,2),
  saidas_realizadas::numeric(15,2),
  saidas_provisionadas::numeric(15,2)
from calc;

comment on view public.v_fluxo_caixa_planilha is
  'Fluxo de Caixa mensal no formato da aba Saldo Disponível (VS4): entradas, saídas, resultado, saldo das contas do fluxo, "saldo (−) contas do próximo mês" (dezembro fecha o ano), despesa variável e realizado × provisionado. Migrations 0060/0061/0065.';

revoke all on public.v_fluxo_caixa_planilha from anon;

-- ----------------------------------------------------------------------------
-- ROLLBACK (manual): reaplicar o create or replace view da 0061 (mesmas
-- colunas) — volta a descontar janeiro do ano seguinte em dezembro.
-- ----------------------------------------------------------------------------
