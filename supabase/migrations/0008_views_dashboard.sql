-- ============================================================================
-- 0008 — Views para o dashboard
-- ============================================================================
-- Reproduzem em SQL os cálculos que hoje estão em fórmulas SUMIFS/SUMPRODUCT
-- da planilha. O front consome essas views direto via Supabase JS.

-- ---------------------------------------------------------------------------
-- KPIs por mês (geral)
-- ---------------------------------------------------------------------------
create or replace view public.v_kpi_mensal as
select
  mes_referencia,
  sum(case when status in ('recebido','resgatado','aplicacao') then valor else 0 end) as entradas_realizadas,
  sum(case when status in ('a_receber','a_resgatar') then valor else 0 end)            as entradas_a_receber,
  sum(case when status in ('pago','repassado','aplicado','resgate') then -valor else 0 end) as saidas_realizadas,
  sum(case when status in ('a_pagar','a_repassar','a_aplicar') then -valor else 0 end)      as saidas_a_pagar,
  sum(case when status in ('provisionado','provisionado_dl','provisionado_dv') then -valor else 0 end) as saidas_provisionadas,
  sum(valor)                                                                            as saldo_movimentacao
from public.transacoes_empresa
group by mes_referencia
order by mes_referencia;

-- ---------------------------------------------------------------------------
-- Soma por classificação (para PieChart "Despesa por Categoria")
-- ---------------------------------------------------------------------------
create or replace view public.v_por_conta_contabil_mensal as
select
  mes_referencia,
  conta_contabil_cod,
  cf.nome as conta_contabil_nome,
  cf.natureza,
  sum(valor) as valor_total,
  count(*)   as qtd_lancamentos
from public.transacoes_empresa te
join public.classificacao_financeira cf on cf.codigo = te.conta_contabil_cod
group by mes_referencia, conta_contabil_cod, cf.nome, cf.natureza;

create or replace view public.v_por_centro_custo_mensal as
select
  mes_referencia,
  centro_custo_cod,
  cf.nome as centro_custo_nome,
  cf.parent_codigo,
  cf.natureza,
  sum(valor) as valor_total,
  count(*)   as qtd_lancamentos
from public.transacoes_empresa te
join public.classificacao_financeira cf on cf.codigo = te.centro_custo_cod
group by mes_referencia, centro_custo_cod, cf.nome, cf.parent_codigo, cf.natureza;

-- ---------------------------------------------------------------------------
-- Saldo por banco (replica "Saldo Disponível")
-- ---------------------------------------------------------------------------
create or replace view public.v_saldo_por_banco_mensal as
select
  mes_referencia,
  conta_bancaria_id,
  cbe.nome as conta_bancaria_nome,
  sum(valor) as variacao_no_mes,
  sum(case when status = 'saldo_inicial' then valor else 0 end) as saldo_inicial_no_mes,
  sum(case when status in ('recebido','resgatado','aplicacao') then valor else 0 end) as entradas,
  sum(case when status in ('pago','repassado','aplicado','resgate') then valor else 0 end) as saidas
from public.transacoes_empresa te
left join public.contas_bancarias_empresa cbe on cbe.id = te.conta_bancaria_id
group by mes_referencia, conta_bancaria_id, cbe.nome;

-- ---------------------------------------------------------------------------
-- Obra LTS — espelha 'obra sede' I16:I28 (bloco "atual 2026")
-- ---------------------------------------------------------------------------
create or replace view public.v_obra_resumo_atual as
with base as (
  select
    obs_obra,
    status,
    sum(-valor) as valor   -- negativo na transação = saída → positivo aqui
  from public.transacoes_empresa
  where centro_custo_cod = '2.7.2'
  group by obs_obra, status
)
select
  obs_obra::text as bucket,
  status::text   as status,
  valor
from base
order by 1, 2;

-- ---------------------------------------------------------------------------
-- Obra LTS — totais de Pago/A pagar/Provisionado para os cards de '$ obra sede'
-- ---------------------------------------------------------------------------
create or replace view public.v_obra_totais as
select
  sum(case when status = 'pago'         and obs_obra in ('ordem_compra','projeto') then -valor else 0 end) as pago_oc_projeto,
  sum(case when status = 'pago'         and obs_obra::text like 'medicao_%'              then -valor else 0 end) as pago_medicoes,
  sum(case when status = 'pago'         and obs_obra = 'outras'                    then -valor else 0 end) as pago_outras,
  sum(case when status = 'a_pagar'      and obs_obra = 'outras'                    then -valor else 0 end) as a_pagar_outras,
  sum(case when status = 'provisionado' and obs_obra::text like 'medicao_%'              then -valor else 0 end) as provisionado_medicoes,
  sum(case when status = 'provisionado' and obs_obra = 'outras'                    then -valor else 0 end) as provisionado_outras,
  sum(case when status = 'provisionado' and obs_obra = 'retencao'                  then -valor else 0 end) as provisionado_retencao
from public.transacoes_empresa
where centro_custo_cod = '2.7.2';

-- ---------------------------------------------------------------------------
-- Capinhas por sócio (replica abas Ana Beatriz, Cláudio Luiz, Isamélia, Pedro)
-- ---------------------------------------------------------------------------
create or replace view public.v_capinha_socio_mensal as
select
  socio_id,
  s.nome_completo as socio_nome,
  mes_referencia,
  classificacao_pessoal,
  cp.nome as classificacao_nome,
  status,
  sum(valor) as valor_total,
  count(*)   as qtd_lancamentos
from public.transacoes_socio ts
join public.socios s              on s.id = ts.socio_id
join public.classificacao_pessoal cp on cp.codigo = ts.classificacao_pessoal
group by socio_id, s.nome_completo, mes_referencia, classificacao_pessoal, cp.nome, status;

-- ---------------------------------------------------------------------------
-- Distribuição de Lucro consolidada (replica aba "_")
-- ---------------------------------------------------------------------------
create or replace view public.v_distribuicao_lucro_mensal as
select
  mes_referencia,
  classificacao_pessoal,
  cp.nome as classificacao_nome,
  sum(valor) as valor_total
from public.transacoes_socio ts
join public.classificacao_pessoal cp on cp.codigo = ts.classificacao_pessoal
group by mes_referencia, classificacao_pessoal, cp.nome
order by mes_referencia, classificacao_pessoal;
