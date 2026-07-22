-- ============================================================================
-- 0043 — Baixa de estoque por VOLUME (FIFO) — venda parcial (áudios 22-jul)
-- ============================================================================
-- Contexto (Adriane × Copasul): o armazém dá baixa pelo VOLUME vendido, não
-- por nota. O sistema passa a ratear: a venda informa o volume e o banco aloca
-- contra as notas mais antigas (FIFO). A nota "da fronteira" é dividida — a
-- parte vendida vira histórico em safra_baixas e o restante segue em estoque
-- com a data de depósito ORIGINAL (carência/quebra de cada nota continuam
-- contando da entrada dela, como a Adriane validou com o comercial da Copasul).
--
-- Entregas desta migration:
--   1. Tabela public.safra_baixas — livro-razão de saídas por nota (qual venda
--      consumiu quais notas e quantos kg; trilha p/ conferir a fatura).
--   2. fn_baixar_estoque_fifo(...)  — aloca um volume por FIFO. Atômica, com
--      lock das notas (concorrência), validações e retorno-resumo em jsonb.
--   3. fn_desfazer_baixas_venda(id) — desfaz as baixas de uma venda e
--      recalcula os status das notas (volume volta ao estoque).
--   4. v_safra_depositos_calculado recriada: TODAS as colunas existentes
--      permanecem idênticas (compatibilidade com relatórios/assistentes) e
--      novas colunas *_saldo entram AO FINAL — os mesmos cálculos aplicados
--      apenas ao volume REMANESCENTE de cada nota. É o que a tela de Estoque
--      passa a somar ("vendido não soma mais na taxa de armazenagem").
--
-- Rollback ao final do arquivo.

-- ---------------------------------------------------------------------------
-- 1) safra_baixas — livro-razão de saídas por nota
-- ---------------------------------------------------------------------------
create table if not exists public.safra_baixas (
  id            uuid primary key default gen_random_uuid(),
  deposito_id   uuid not null references public.safra_depositos(id) on delete cascade,
  -- on delete set null: excluir a venda NÃO ressuscita estoque sozinho (o grão
  -- saiu fisicamente). O app pergunta e chama fn_desfazer_baixas_venda antes.
  venda_id      uuid references public.vendas_provisionadas(id) on delete set null,
  data_baixa    date not null default current_date,
  kg            numeric(15,3) not null check (kg > 0),
  motivo        text not null default 'venda' check (motivo in ('venda', 'retirada', 'perda')),
  observacao    text,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.users(id) on delete set null
);

create index if not exists idx_sb_deposito on public.safra_baixas(deposito_id);
create index if not exists idx_sb_venda    on public.safra_baixas(venda_id);

comment on table public.safra_baixas is
  'Livro-razão de saídas de grão por nota (DFe). Cada linha = quantos kg saíram de qual depósito, por qual venda/motivo. Fonte da coluna kg_saldo da view calculada. Migration 0043.';
comment on column public.safra_baixas.venda_id is
  'Venda futura que consumiu este volume (null p/ retirada/perda ou venda excluída — a baixa permanece, o grão saiu fisicamente).';

alter table public.safra_baixas enable row level security;
drop policy if exists sb_read on public.safra_baixas;
create policy sb_read on public.safra_baixas
  for select using (auth.uid() is not null);
drop policy if exists sb_write on public.safra_baixas;
create policy sb_write on public.safra_baixas
  for all using (public.fn_can_write()) with check (public.fn_can_write());

-- ---------------------------------------------------------------------------
-- 2) fn_baixar_estoque_fifo — aloca um volume contra as notas mais antigas
-- ---------------------------------------------------------------------------
-- FIFO: ordena por data_deposito (desempate: created_at, id). Consome nota a
-- nota; a última pode ficar parcial. Status resultante por nota:
--   • saldo zerou  → vendido_total | retirado | baixa (conforme motivo)
--   • saldo parcial→ vendido_parcial (motivo venda) | status atual (demais)
-- Concorrência: SELECT ... FOR UPDATE nas notas da cultura×safra serializa
-- duas baixas simultâneas. Erros são exceptions com mensagem em PT-BR.
create or replace function public.fn_baixar_estoque_fifo(
  p_cultura    public.cultura_safra,
  p_safra      text,
  p_kg         numeric,
  p_data       date default current_date,
  p_venda_id   uuid default null,
  p_armazem_id uuid default null,
  p_motivo     text default 'venda',
  p_observacao text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_kg          numeric := round(coalesce(p_kg, 0), 3);
  v_disponivel  numeric := 0;
  v_restante    numeric;
  v_alloc       numeric;
  v_notas       jsonb := '[]'::jsonb;
  v_qtd_total   int := 0;
  v_qtd_parcial int := 0;
  v_status_novo public.safra_deposito_status;
  r             record;
begin
  if v_kg <= 0 then
    raise exception 'Volume inválido: informe uma quantidade em kg maior que zero.';
  end if;
  if p_motivo not in ('venda', 'retirada', 'perda') then
    raise exception 'Motivo inválido: use venda, retirada ou perda.';
  end if;
  if p_data is null then
    raise exception 'Data da baixa é obrigatória.';
  end if;

  if p_venda_id is not null then
    perform 1 from public.vendas_provisionadas v
      where v.id = p_venda_id and v.cultura = p_cultura and v.safra = p_safra;
    if not found then
      raise exception 'Venda não encontrada ou a cultura/safra dela não confere com a baixa.';
    end if;
    if exists (select 1 from public.safra_baixas b where b.venda_id = p_venda_id) then
      raise exception 'Esta venda já tem baixa de estoque vinculada — desfaça a baixa antes de repetir.';
    end if;
  end if;

  -- Trava as notas da cultura×safra (serializa baixas concorrentes).
  perform 1
    from public.safra_depositos d
   where d.cultura = p_cultura
     and d.safra = p_safra
     and (p_armazem_id is null or d.armazem_id = p_armazem_id)
   order by d.data_deposito, d.created_at, d.id
     for update;

  -- Disponível total (kg_bruto − baixas já registradas), já sob o lock.
  select coalesce(sum(d.kg_bruto - coalesce(bx.kg_baixado, 0)), 0)
    into v_disponivel
    from public.safra_depositos d
    left join lateral (
      select sum(b.kg) as kg_baixado
        from public.safra_baixas b
       where b.deposito_id = d.id
    ) bx on true
   where d.cultura = p_cultura
     and d.safra = p_safra
     and (p_armazem_id is null or d.armazem_id = p_armazem_id)
     and d.kg_bruto - coalesce(bx.kg_baixado, 0) > 0;

  if v_disponivel < v_kg then
    raise exception 'Estoque insuficiente de % %: disponível % kg, solicitado % kg.',
      p_cultura, p_safra, to_char(v_disponivel, 'FM999G999G990D999'), to_char(v_kg, 'FM999G999G990D999');
  end if;

  -- Alocação FIFO.
  v_restante := v_kg;
  for r in
    select d.id, d.dfe_entrada, d.nfp, d.status,
           (d.kg_bruto - coalesce(bx.kg_baixado, 0))::numeric(15,3) as kg_disp
      from public.safra_depositos d
      left join lateral (
        select sum(b.kg) as kg_baixado
          from public.safra_baixas b
         where b.deposito_id = d.id
      ) bx on true
     where d.cultura = p_cultura
       and d.safra = p_safra
       and (p_armazem_id is null or d.armazem_id = p_armazem_id)
       and d.kg_bruto - coalesce(bx.kg_baixado, 0) > 0
     order by d.data_deposito, d.created_at, d.id
  loop
    exit when v_restante <= 0;
    v_alloc := round(least(r.kg_disp, v_restante), 3);

    insert into public.safra_baixas (deposito_id, venda_id, data_baixa, kg, motivo, observacao, created_by)
    values (r.id, p_venda_id, p_data, v_alloc, p_motivo, p_observacao, auth.uid());

    if v_alloc >= r.kg_disp then
      v_status_novo := case p_motivo
        when 'venda'    then 'vendido_total'::public.safra_deposito_status
        when 'retirada' then 'retirado'::public.safra_deposito_status
        else                 'baixa'::public.safra_deposito_status
      end;
      v_qtd_total := v_qtd_total + 1;
    else
      v_status_novo := case p_motivo
        when 'venda' then 'vendido_parcial'::public.safra_deposito_status
        else              r.status   -- retirada/perda parcial: nota segue como está
      end;
      v_qtd_parcial := v_qtd_parcial + 1;
    end if;

    update public.safra_depositos set status = v_status_novo where id = r.id;

    v_notas := v_notas || jsonb_build_object(
      'deposito_id', r.id,
      'dfe', r.dfe_entrada,
      'nfp', r.nfp,
      'kg', v_alloc,
      'restante_na_nota', round(r.kg_disp - v_alloc, 3),
      'consumo_total', v_alloc >= r.kg_disp
    );

    v_restante := round(v_restante - v_alloc, 3);
  end loop;

  -- Sanidade: com o lock ativo isto nunca deve sobrar; se sobrar, aborta tudo.
  if v_restante > 0 then
    raise exception 'Falha na alocação FIFO: restaram % kg sem nota (operação desfeita).', v_restante;
  end if;

  return jsonb_build_object(
    'kg_solicitado', v_kg,
    'kg_baixado', v_kg,
    'saldo_restante_kg', round(v_disponivel - v_kg, 3),
    'notas_baixadas_total', v_qtd_total,
    'notas_parciais', v_qtd_parcial,
    'notas', v_notas
  );
end;
$$;

comment on function public.fn_baixar_estoque_fifo(public.cultura_safra, text, numeric, date, uuid, uuid, text, text) is
  'Dá baixa de um volume (kg) no estoque da cultura×safra por FIFO (notas mais antigas primeiro), registrando em safra_baixas e atualizando os status das notas. Atômica; valida disponibilidade e baixa duplicada por venda. Migration 0043.';

-- ---------------------------------------------------------------------------
-- 3) fn_desfazer_baixas_venda — o volume volta ao estoque
-- ---------------------------------------------------------------------------
create or replace function public.fn_desfazer_baixas_venda(p_venda_id uuid)
returns int
language plpgsql
as $$
declare
  v_deps uuid[];
  v_qtd  int;
begin
  if p_venda_id is null then
    raise exception 'Venda não informada.';
  end if;

  select array_agg(distinct b.deposito_id) into v_deps
    from public.safra_baixas b
   where b.venda_id = p_venda_id;

  if v_deps is null then
    return 0;  -- nada a desfazer (não é erro)
  end if;

  perform 1 from public.safra_depositos d where d.id = any(v_deps) for update;

  delete from public.safra_baixas where venda_id = p_venda_id;
  get diagnostics v_qtd = row_count;

  -- Recalcula o status das notas afetadas a partir do que SOBROU de baixas.
  update public.safra_depositos d
     set status = sub.novo_status
    from (
      select d2.id,
             case
               when coalesce(bx.kg_baixado, 0) <= 0
                 then 'armazenado'::public.safra_deposito_status
               when coalesce(bx.kg_baixado, 0) >= d2.kg_bruto
                 then d2.status  -- ainda 100% consumida por outras baixas
               when bx.tem_venda
                 then 'vendido_parcial'::public.safra_deposito_status
               else 'armazenado'::public.safra_deposito_status
             end as novo_status
        from public.safra_depositos d2
        left join lateral (
          select sum(b.kg) as kg_baixado, bool_or(b.motivo = 'venda') as tem_venda
            from public.safra_baixas b
           where b.deposito_id = d2.id
        ) bx on true
       where d2.id = any(v_deps)
    ) sub
   where d.id = sub.id
     and d.status is distinct from sub.novo_status;

  return v_qtd;
end;
$$;

comment on function public.fn_desfazer_baixas_venda(uuid) is
  'Remove as baixas de estoque vinculadas a uma venda e recalcula o status das notas afetadas (o volume volta ao estoque). Retorna o nº de baixas removidas. Migration 0043.';

-- ---------------------------------------------------------------------------
-- 4) View recriada — colunas existentes intactas + colunas *_saldo ao final
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
    -- Saldo remanescente da nota (0043): bruto − baixas registradas
    coalesce(bx.kg_baixado, 0)::numeric(15,3)                          as kg_baixado_c,
    greatest(d.kg_bruto - coalesce(bx.kg_baixado, 0), 0)::numeric(15,3) as kg_saldo_c,
    -- Dias percorridos por cenário (nunca negativos)
    greatest((p.data_atual - d.data_deposito) - p.carencia_dias, 0)::int          as dias_t,
    greatest((p.data_atual - d.data_deposito) - p.carencia_armazem_dias, 0)::int  as dias_a
  from public.safra_depositos d
  join public.armazens a              on a.id = d.armazem_id
  left join public.safra_parametros p on p.armazem_id = d.armazem_id
                                      and p.cultura = d.cultura
                                      and p.safra = d.safra
  left join lateral (
    select sum(b.kg) as kg_baixado
      from public.safra_baixas b
     where b.deposito_id = d.id
  ) bx on true
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
    (b.kg_bruto - (b.quebra_quinzena_pct * (b.dias_a::numeric / 15)) * b.kg_bruto)::numeric(15,3) as kg_liquido_a,
    -- ===== 0043: mesmos cálculos aplicados só ao SALDO remanescente =====
    (b.kg_saldo_c / b.kg_por_saca)::numeric(15,4)                                     as sc_saldo_x,
    ((b.quebra_quinzena_pct * (b.dias_t::numeric / 15)) * b.kg_saldo_c)::numeric(15,3) as quebra_kg_saldo_t,
    (b.kg_saldo_c - (b.quebra_quinzena_pct * (b.dias_t::numeric / 15)) * b.kg_saldo_c)::numeric(15,3) as kg_liquido_saldo_t,
    ((b.quebra_quinzena_pct * (b.dias_a::numeric / 15)) * b.kg_saldo_c)::numeric(15,3) as quebra_kg_saldo_a,
    (b.kg_saldo_c - (b.quebra_quinzena_pct * (b.dias_a::numeric / 15)) * b.kg_saldo_c)::numeric(15,3) as kg_liquido_saldo_a
  from base b
)
select
  -- ------ colunas existentes (ordem e semântica preservadas — 0014/0037) ------
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
  (
    c.kg_liquido_t * c.dias_t::numeric * (c.armazenagem_por_kg_quinzena / 15) / c.kg_por_saca
    + c.sc_bruto_c * c.devolucao_por_saca
    + c.sc_bruto_c * coalesce(c.taxa_recepcao_por_saca, 0)
  )::numeric(15,2)                                                        as total_a_descontar,
  ((c.kg_liquido_t / c.kg_por_saca) * coalesce(c.cotacao_simulada_sc, 0))::numeric(15,2) as valor_venda_simulado,
  c.carencia_armazem_dias,
  c.taxa_recepcao_por_saca,
  (c.sc_bruto_c * coalesce(c.taxa_recepcao_por_saca, 0))::numeric(15,2)   as taxa_recepcao,
  c.dias_a                                                                as dias_percorridos_armazem,
  (c.dias_a::numeric / 15)::numeric(10,4)                                 as quinzenas_armazem,
  c.quebra_kg_a                                                           as quebra_kg_armazem,
  c.kg_liquido_a                                                          as kg_liquido_armazem,
  (c.kg_liquido_a / c.kg_por_saca)::numeric(15,4)                         as sc_liquida_armazem,
  (c.kg_liquido_a * c.dias_a::numeric * (c.armazenagem_por_kg_quinzena / 15) / c.kg_por_saca)::numeric(15,2) as taxa_armazenagem_armazem,
  (c.kg_liquido_a * c.dias_a::numeric * (c.armazenagem_por_kg_quinzena / 15) / c.kg_por_saca)::numeric(15,2) as total_a_descontar_armazem,
  ((c.kg_liquido_a / c.kg_por_saca) * coalesce(c.cotacao_simulada_sc, 0))::numeric(15,2) as valor_venda_armazem,
  -- ------ colunas novas (0043): volume remanescente (saldo) ------
  c.kg_baixado_c                                                          as kg_baixado,
  c.kg_saldo_c                                                            as kg_saldo,
  c.sc_saldo_x                                                            as sc_saldo,
  c.quebra_kg_saldo_t                                                     as quebra_kg_saldo,
  c.kg_liquido_saldo_t                                                    as kg_liquido_saldo,
  (c.kg_liquido_saldo_t / c.kg_por_saca)::numeric(15,4)                   as sc_liquida_saldo,
  (c.kg_liquido_saldo_t * c.dias_t::numeric * (c.armazenagem_por_kg_quinzena / 15) / c.kg_por_saca)::numeric(15,2) as taxa_armazenagem_saldo,
  (c.sc_saldo_x * c.devolucao_por_saca)::numeric(15,2)                    as taxa_devolucao_saldo,
  (c.sc_saldo_x * coalesce(c.taxa_recepcao_por_saca, 0))::numeric(15,2)   as taxa_recepcao_saldo,
  (
    c.kg_liquido_saldo_t * c.dias_t::numeric * (c.armazenagem_por_kg_quinzena / 15) / c.kg_por_saca
    + c.sc_saldo_x * c.devolucao_por_saca
    + c.sc_saldo_x * coalesce(c.taxa_recepcao_por_saca, 0)
  )::numeric(15,2)                                                        as total_a_descontar_saldo,
  ((c.kg_liquido_saldo_t / c.kg_por_saca) * coalesce(c.cotacao_simulada_sc, 0))::numeric(15,2) as valor_venda_saldo,
  c.quebra_kg_saldo_a                                                     as quebra_kg_saldo_armazem,
  c.kg_liquido_saldo_a                                                    as kg_liquido_saldo_armazem,
  (c.kg_liquido_saldo_a / c.kg_por_saca)::numeric(15,4)                   as sc_liquida_saldo_armazem,
  (c.kg_liquido_saldo_a * c.dias_a::numeric * (c.armazenagem_por_kg_quinzena / 15) / c.kg_por_saca)::numeric(15,2) as taxa_armazenagem_saldo_armazem,
  (c.kg_liquido_saldo_a * c.dias_a::numeric * (c.armazenagem_por_kg_quinzena / 15) / c.kg_por_saca)::numeric(15,2) as total_a_descontar_saldo_armazem,
  ((c.kg_liquido_saldo_a / c.kg_por_saca) * coalesce(c.cotacao_simulada_sc, 0))::numeric(15,2) as valor_venda_saldo_armazem
from calc c;

comment on view public.v_safra_depositos_calculado is
  'Depósitos com os cálculos dos dois cenários (terceiros × armazém) sobre o volume TOTAL (colunas originais) e sobre o SALDO remanescente após baixas (colunas *_saldo — migration 0043). Usa safra_parametros.data_atual como "Data Atual".';

-- ----------------------------------------------------------------------------
-- ROLLBACK:
--   Reexecutar a definição da view da migration 0037 e:
--   drop function if exists public.fn_desfazer_baixas_venda(uuid);
--   drop function if exists public.fn_baixar_estoque_fifo(public.cultura_safra, text, numeric, date, uuid, uuid, text, text);
--   drop table if exists public.safra_baixas;
-- ----------------------------------------------------------------------------
