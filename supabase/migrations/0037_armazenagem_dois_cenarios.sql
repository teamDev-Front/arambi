-- ============================================================================
-- 0037 — Armazenagem: dois cálculos consolidados + taxa de recepção (call 24-jun)
-- ============================================================================
-- Regra explicada na reunião (transcrição 36:25–46:39):
--   • Venda a TERCEIROS: contagem desde o depósito com carência curta (~30 dias);
--     cobram armazenagem + retirada/devolução + (às vezes) recepção.
--   • Venda ao PRÓPRIO ARMAZÉM (ex.: Copasul): carência longa negociada por
--     normativa anual (~365 dias; no milho 25/26 foi até 30/mai); após a
--     carência conta armazenagem; NÃO cobram recepção nem retirada.
--   • As carências mudam ano a ano por produto → parametrizáveis por
--     (armazém × cultura × safra), que é exatamente a granularidade de
--     safra_parametros.
--
-- Compatibilidade: todas as colunas existentes da view mantêm nome, posição e
-- fórmula (cenário TERCEIROS, com carencia_dias como hoje). Novas colunas são
-- adicionadas ao final. taxa_recepcao entra com default 0 → nenhum valor muda
-- até a Lola preencher o parâmetro.

-- ---------------------------------------------------------------------------
-- 1) Parâmetros novos
-- ---------------------------------------------------------------------------
alter table public.safra_parametros
  add column if not exists carencia_armazem_dias smallint not null default 365,
  add column if not exists taxa_recepcao_por_saca numeric(10,4) not null default 0;

comment on column public.safra_parametros.carencia_dias is
  'Carência (dias) para VENDA A TERCEIROS — contagem desde o depósito (call 24-jun: ~30 dias).';
comment on column public.safra_parametros.carencia_armazem_dias is
  'Carência (dias) para VENDA AO PRÓPRIO ARMAZÉM — normativa anual do cerealista (call 24-jun: ~365 dias; muda ano a ano por produto).';
comment on column public.safra_parametros.taxa_recepcao_por_saca is
  'Taxa de recepção (R$/saca), cobrada apenas na venda a terceiros. 0 = isenta pela normativa vigente.';

-- ---------------------------------------------------------------------------
-- 2) View recalculada com os dois cenários
-- ---------------------------------------------------------------------------
drop view if exists public.v_safra_depositos_calculado;
create view public.v_safra_depositos_calculado as
with base as (
  select
    d.id,
    d.armazem_id,
    a.nome           as armazem_nome,
    a.apelido        as armazem_apelido,
    d.cultura,
    d.safra,
    d.data_deposito,
    d.dfe_entrada,
    d.nfp,
    d.kg_bruto,
    d.status,
    d.observacao,
    d.created_at,
    d.updated_at,
    p.id                          as parametros_id,
    p.quebra_quinzena_pct,
    p.armazenagem_por_kg_quinzena,
    p.devolucao_por_saca,
    p.carencia_dias,
    p.kg_por_saca,
    p.data_atual,
    p.cotacao_simulada_sc,
    p.carencia_armazem_dias,
    p.taxa_recepcao_por_saca,
    -- Dias percorridos por cenário (nunca negativos)
    greatest((p.data_atual - d.data_deposito) - p.carencia_dias, 0)::int          as dias_t,
    greatest((p.data_atual - d.data_deposito) - p.carencia_armazem_dias, 0)::int  as dias_a
  from public.safra_depositos d
  join public.armazens a              on a.id = d.armazem_id
  left join public.safra_parametros p on p.armazem_id = d.armazem_id
                                      and p.cultura = d.cultura
                                      and p.safra = d.safra
),
calc as (
  select
    b.*,
    (b.kg_bruto / b.kg_por_saca)::numeric(15,4)                                       as sc_bruto_c,
    -- Cenário TERCEIROS (mesmas fórmulas de sempre)
    ((b.quebra_quinzena_pct * (b.dias_t::numeric / 15)) * b.kg_bruto)::numeric(15,3)  as quebra_kg_t,
    (b.kg_bruto - (b.quebra_quinzena_pct * (b.dias_t::numeric / 15)) * b.kg_bruto)::numeric(15,3) as kg_liquido_t,
    -- Cenário ARMAZÉM (carência longa)
    ((b.quebra_quinzena_pct * (b.dias_a::numeric / 15)) * b.kg_bruto)::numeric(15,3)  as quebra_kg_a,
    (b.kg_bruto - (b.quebra_quinzena_pct * (b.dias_a::numeric / 15)) * b.kg_bruto)::numeric(15,3) as kg_liquido_a
  from base b
)
select
  -- ------ colunas existentes (ordem e semântica preservadas: cenário terceiros) ------
  c.id,
  c.armazem_id,
  c.armazem_nome,
  c.armazem_apelido,
  c.cultura,
  c.safra,
  c.data_deposito,
  c.dfe_entrada,
  c.nfp,
  c.kg_bruto,
  c.status,
  c.observacao,
  c.created_at,
  c.updated_at,
  c.parametros_id,
  c.quebra_quinzena_pct,
  c.armazenagem_por_kg_quinzena,
  c.devolucao_por_saca,
  c.carencia_dias,
  c.kg_por_saca,
  c.data_atual,
  c.cotacao_simulada_sc,
  c.sc_bruto_c                                                            as sc_bruto,
  c.dias_t                                                                as dias_percorridos,
  (c.dias_t::numeric / 15)::numeric(10,4)                                 as quinzenas,
  c.quebra_kg_t                                                           as quebra_kg,
  c.kg_liquido_t                                                          as kg_liquido,
  (c.kg_liquido_t / c.kg_por_saca)::numeric(15,4)                         as sc_liquida,
  (c.kg_liquido_t * c.dias_t::numeric * (c.armazenagem_por_kg_quinzena / 15) / c.kg_por_saca)::numeric(15,2) as taxa_armazenagem,
  (c.sc_bruto_c * c.devolucao_por_saca)::numeric(15,2)                    as taxa_devolucao,
  -- Total terceiros agora inclui a recepção (default 0 → valores inalterados)
  (
    c.kg_liquido_t * c.dias_t::numeric * (c.armazenagem_por_kg_quinzena / 15) / c.kg_por_saca
    + c.sc_bruto_c * c.devolucao_por_saca
    + c.sc_bruto_c * coalesce(c.taxa_recepcao_por_saca, 0)
  )::numeric(15,2)                                                        as total_a_descontar,
  ((c.kg_liquido_t / c.kg_por_saca) * coalesce(c.cotacao_simulada_sc, 0))::numeric(15,2) as valor_venda_simulado,
  -- ------ colunas novas ------
  c.carencia_armazem_dias,
  c.taxa_recepcao_por_saca,
  (c.sc_bruto_c * coalesce(c.taxa_recepcao_por_saca, 0))::numeric(15,2)   as taxa_recepcao,
  c.dias_a                                                                as dias_percorridos_armazem,
  (c.dias_a::numeric / 15)::numeric(10,4)                                 as quinzenas_armazem,
  c.quebra_kg_a                                                           as quebra_kg_armazem,
  c.kg_liquido_a                                                          as kg_liquido_armazem,
  (c.kg_liquido_a / c.kg_por_saca)::numeric(15,4)                         as sc_liquida_armazem,
  (c.kg_liquido_a * c.dias_a::numeric * (c.armazenagem_por_kg_quinzena / 15) / c.kg_por_saca)::numeric(15,2) as taxa_armazenagem_armazem,
  -- Venda ao próprio armazém: sem recepção e sem retirada/devolução (call 24-jun)
  (c.kg_liquido_a * c.dias_a::numeric * (c.armazenagem_por_kg_quinzena / 15) / c.kg_por_saca)::numeric(15,2) as total_a_descontar_armazem,
  ((c.kg_liquido_a / c.kg_por_saca) * coalesce(c.cotacao_simulada_sc, 0))::numeric(15,2) as valor_venda_armazem
from calc c;

comment on view public.v_safra_depositos_calculado is
  'Depósitos com os DOIS cálculos consolidados: venda a terceiros (carencia_dias, + recepção/devolução) e venda ao próprio armazém (carencia_armazem_dias, só armazenagem). Usa safra_parametros.data_atual como "Data Atual".';

-- ----------------------------------------------------------------------------
-- ROLLBACK:
--   Reexecutar a definição da view da migration 0014 e:
--   alter table public.safra_parametros
--     drop column if exists carencia_armazem_dias,
--     drop column if exists taxa_recepcao_por_saca;
-- ----------------------------------------------------------------------------
