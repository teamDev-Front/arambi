-- ============================================================================
-- 0051 — Armazenagem: carência do armazém por DATA-LIMITE + ajuste de saldo
--        residual da quebra técnica (retorno da Adriane, 10-ago-2026)
-- ============================================================================
-- CONTEXTO (WhatsApp 10-ago, milho 25/25 × Copasul, fixação de 07/08/2026):
--
--   • Copasul (autorização de fixação) ......... R$ 6.503,98
--   • Planilha antiga da Adriane ............... R$ 6.424,02
--   • Sistema .................................. R$ 1.732,86   ← muito abaixo
--
-- A FÓRMULA do sistema estava certa; errado era o número de DIAS cobrados.
-- Conferência com os dados da própria autorização de fixação:
--
--   taxa = (kg_liquido / kg_por_saca) × armazenagem_por_kg_quinzena × dias/15
--   Copasul: (430.410/60) × 0,20 × 68/15 = 6.503,97  ≡  R$ 6.503,98  ✔
--
-- ou seja, a Copasul cobrou 68 dias — de 31/05/2026 (fim da carência da
-- normativa da safra) até 07/08/2026 (data da fixação). A planilha da Adriane
-- usa 67 dias (conta a partir de 01/06) e por isso dá R$ 6.424,02.
--
-- O sistema, por sua vez, tratava a carência do armazém como 365 dias CORRIDOS
-- a partir da data de cada depósito (0037). Como os depósitos são de jul-2025
-- em diante, cada nota "vencia" a carência numa data diferente e a média
-- ponderada deu ~18 dias cobráveis → R$ 1.732,86.
--
-- A carência da Copasul não é um prazo por nota: é uma DATA-LIMITE única da
-- normativa da safra ("armazenagem gratuita até 31/05"), valendo para todas as
-- notas. Esta migration passa a permitir configurá-la como data.
--
-- Entregas:
--   1. safra_parametros.carencia_armazem_ate (date, opcional) — quando
--      preenchida, manda no cenário "venda ao armazém"; vazia = comportamento
--      atual (carencia_armazem_dias por nota). Nada muda até a Lola preencher.
--   2. View recriada com o novo dias_a. Todas as colunas existentes mantêm
--      nome, posição e fórmula; carencia_armazem_ate entra AO FINAL.
--   3. Baixa de estoque com motivo 'quebra_tecnica' + fn_zerar_saldo_quebra:
--      procedimento para zerar o saldo residual que sobra quando 100% do
--      estoque já foi comercializado (o armazém fixa o peso LÍQUIDO, então o
--      bruto depositado menos as baixas deixa a quebra "presa" no estoque).
--   4. fn_desfazer_baixas(uuid[]) — desfaz baixas avulsas (sem venda), para o
--      "Desfazer" de 8 segundos da tela.
--
-- Rollback ao final do arquivo.

-- ---------------------------------------------------------------------------
-- 1) Parâmetro novo: carência do armazém como DATA-LIMITE
-- ---------------------------------------------------------------------------
alter table public.safra_parametros
  add column if not exists carencia_armazem_ate date;

comment on column public.safra_parametros.carencia_armazem_ate is
  'Data-limite da armazenagem gratuita na venda ao PRÓPRIO armazém (normativa da safra — ex.: milho 25/25 Copasul: 31/05/2026). Quando preenchida, PREVALECE sobre carencia_armazem_dias: a cobrança começa no dia seguinte a esta data para todas as notas (ou na data do depósito, se a nota entrou depois). Vazia = contagem por nota (carencia_armazem_dias).';

-- ---------------------------------------------------------------------------
-- 2) View recriada — só muda o cálculo de dias_a (cenário ARMAZÉM)
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
    p.carencia_armazem_ate,
    p.taxa_recepcao_por_saca,
    -- Saldo remanescente da nota (0043): bruto − baixas registradas
    coalesce(bx.kg_baixado, 0)::numeric(15,3)                          as kg_baixado_c,
    greatest(d.kg_bruto - coalesce(bx.kg_baixado, 0), 0)::numeric(15,3) as kg_saldo_c,
    -- Dias percorridos por cenário (nunca negativos)
    greatest((p.data_atual - d.data_deposito) - p.carencia_dias, 0)::int as dias_t,
    -- Cenário ARMAZÉM (0051): com data-limite da normativa, a contagem começa
    -- nela para TODAS as notas (nota que entrou depois conta da própria
    -- entrada); sem data-limite, mantém a carência em dias por nota (0037).
    case
      when p.carencia_armazem_ate is not null
        then greatest(p.data_atual - greatest(p.carencia_armazem_ate, d.data_deposito), 0)
      else greatest((p.data_atual - d.data_deposito) - p.carencia_armazem_dias, 0)
    end::int                                                            as dias_a
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
    -- Cenário ARMAZÉM
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
  -- ------ colunas existentes (ordem e semântica preservadas — 0014/0037/0043) ------
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
  -- ------ colunas de saldo (0043) ------
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
  ((c.kg_liquido_saldo_a / c.kg_por_saca) * coalesce(c.cotacao_simulada_sc, 0))::numeric(15,2) as valor_venda_saldo_armazem,
  -- ------ coluna nova (0051) ------
  c.carencia_armazem_ate
from calc c;

comment on view public.v_safra_depositos_calculado is
  'Depósitos com os cálculos dos dois cenários (terceiros × armazém) sobre o volume TOTAL e sobre o SALDO remanescente após baixas. No cenário armazém a carência pode ser uma DATA-LIMITE da normativa da safra (safra_parametros.carencia_armazem_ate — migration 0051) em vez de dias por nota. Usa safra_parametros.data_atual como "Data Atual".';

-- ---------------------------------------------------------------------------
-- 3) Baixa por quebra técnica — motivo novo em safra_baixas
-- ---------------------------------------------------------------------------
-- A restrição de motivo foi criada inline em 0043 (nome esperado:
-- safra_baixas_motivo_check). O DO abaixo remove qualquer CHECK sobre a coluna,
-- independente do nome, para ser idempotente em bases divergentes.
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel     on rel.oid = con.conrelid
      join pg_namespace n   on n.oid = rel.relnamespace
     where n.nspname = 'public'
       and rel.relname = 'safra_baixas'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%motivo%'
  loop
    execute format('alter table public.safra_baixas drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.safra_baixas
  add constraint safra_baixas_motivo_check
  check (motivo in ('venda', 'retirada', 'perda', 'quebra_tecnica'));

comment on column public.safra_baixas.motivo is
  'venda | retirada | perda | quebra_tecnica. "quebra_tecnica" é o ajuste que zera o saldo residual deixado pela diferença entre o peso bruto depositado e o peso líquido fixado pelo armazém (migration 0051).';

-- ---------------------------------------------------------------------------
-- 4) fn_baixar_estoque_fifo — aceita 'quebra_tecnica' e devolve o id da baixa
-- ---------------------------------------------------------------------------
-- Mudanças em relação a 0043 (mesma assinatura):
--   • motivo 'quebra_tecnica' aceito (nota zerada → status 'baixa');
--   • cada item de "notas" ganha o campo baixa_id, para o Desfazer da tela.
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
  v_baixa_id    uuid;
  v_notas       jsonb := '[]'::jsonb;
  v_qtd_total   int := 0;
  v_qtd_parcial int := 0;
  v_status_novo public.safra_deposito_status;
  r             record;
begin
  if v_kg <= 0 then
    raise exception 'Volume inválido: informe uma quantidade em kg maior que zero.';
  end if;
  if p_motivo not in ('venda', 'retirada', 'perda', 'quebra_tecnica') then
    raise exception 'Motivo inválido: use venda, retirada, perda ou quebra_tecnica.';
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
    values (r.id, p_venda_id, p_data, v_alloc, p_motivo, p_observacao, auth.uid())
    returning id into v_baixa_id;

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
        else              r.status   -- retirada/perda/quebra parcial: nota segue como está
      end;
      v_qtd_parcial := v_qtd_parcial + 1;
    end if;

    update public.safra_depositos set status = v_status_novo where id = r.id;

    v_notas := v_notas || jsonb_build_object(
      'baixa_id', v_baixa_id,
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
  'Dá baixa de um volume (kg) no estoque da cultura×safra por FIFO (notas mais antigas primeiro), registrando em safra_baixas e atualizando os status das notas. Motivos: venda, retirada, perda, quebra_tecnica. Atômica. Migrations 0043 + 0051.';

-- ---------------------------------------------------------------------------
-- 5) fn_zerar_saldo_quebra — o "procedimento para zerar o estoque"
-- ---------------------------------------------------------------------------
-- Situação: a venda foi lançada pelo peso LÍQUIDO que o armazém fixou
-- (ex.: 430.410 kg), mas as notas guardam o peso BRUTO depositado
-- (ex.: 434.374 kg). A diferença — a quebra técnica real apurada pelo armazém —
-- fica como saldo fantasma no estoque. Esta função baixa exatamente esse
-- resíduo, com motivo 'quebra_tecnica', preservando o histórico: o bruto
-- depositado continua íntegro e a saída fica registrada em safra_baixas.
--
-- Não recebe quantidade: zera o que estiver sobrando no momento da chamada
-- (dentro da mesma transação do lock), evitando divergência com o que a tela
-- mostrava.
create or replace function public.fn_zerar_saldo_quebra(
  p_cultura    public.cultura_safra,
  p_safra      text,
  p_armazem_id uuid default null,
  p_data       date default current_date,
  p_observacao text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_saldo numeric := 0;
begin
  -- Trava as notas antes de medir o saldo (a fn_baixar_estoque_fifo retrava —
  -- locks são reentrantes na mesma transação).
  perform 1
    from public.safra_depositos d
   where d.cultura = p_cultura
     and d.safra = p_safra
     and (p_armazem_id is null or d.armazem_id = p_armazem_id)
     for update;

  select coalesce(sum(greatest(d.kg_bruto - coalesce(bx.kg_baixado, 0), 0)), 0)
    into v_saldo
    from public.safra_depositos d
    left join lateral (
      select sum(b.kg) as kg_baixado
        from public.safra_baixas b
       where b.deposito_id = d.id
    ) bx on true
   where d.cultura = p_cultura
     and d.safra = p_safra
     and (p_armazem_id is null or d.armazem_id = p_armazem_id);

  if v_saldo <= 0 then
    raise exception 'Não há saldo em estoque de % % para zerar.', p_cultura, p_safra;
  end if;

  return public.fn_baixar_estoque_fifo(
    p_cultura, p_safra, v_saldo, p_data,
    null, p_armazem_id, 'quebra_tecnica',
    coalesce(nullif(btrim(p_observacao), ''), 'Ajuste de saldo — quebra técnica apurada pelo armazém')
  );
end;
$$;

comment on function public.fn_zerar_saldo_quebra(public.cultura_safra, text, uuid, date, text) is
  'Zera o saldo remanescente de uma cultura×safra (opcionalmente de um armazém) lançando baixas com motivo quebra_tecnica — usado quando 100% do estoque já foi comercializado e sobra apenas a diferença entre o peso bruto depositado e o peso líquido fixado. Retorna o mesmo resumo de fn_baixar_estoque_fifo. Migration 0051.';

-- ---------------------------------------------------------------------------
-- 6) fn_desfazer_baixas — desfaz baixas avulsas (sem venda vinculada)
-- ---------------------------------------------------------------------------
-- fn_desfazer_baixas_venda(uuid) continua atendendo o fluxo de vendas. Esta
-- trabalha por id de baixa, para o "Desfazer" de 8 segundos do ajuste de saldo.
create or replace function public.fn_desfazer_baixas(p_ids uuid[])
returns int
language plpgsql
as $$
declare
  v_deps uuid[];
  v_qtd  int;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;

  select array_agg(distinct b.deposito_id) into v_deps
    from public.safra_baixas b
   where b.id = any(p_ids);

  if v_deps is null then
    return 0;  -- já desfeito (não é erro)
  end if;

  perform 1 from public.safra_depositos d where d.id = any(v_deps) for update;

  delete from public.safra_baixas where id = any(p_ids);
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

comment on function public.fn_desfazer_baixas(uuid[]) is
  'Remove baixas de estoque por id e recalcula o status das notas afetadas (o volume volta ao estoque). Usada pelo Desfazer do ajuste de saldo por quebra técnica. Migration 0051.';

-- ----------------------------------------------------------------------------
-- PÓS-MIGRATION (opcional) — ligar a data-limite do milho 25/25 na Copasul.
--
-- A migration não mexe em dado: enquanto carencia_armazem_ate ficar nula, tudo
-- continua exatamente como estava. O caminho recomendado é a Lola preencher
-- "Carência Armazém até (data)" no painel de Parâmetros da tela de Estoque.
-- Para fazer direto no banco, descomente:
--
--   update public.safra_parametros p
--      set carencia_armazem_ate = date '2026-05-31'   -- normativa Copasul
--     from public.armazens a
--    where a.id = p.armazem_id
--      and a.nome ilike '%copasul%'
--      and p.cultura = 'milho'
--      and p.safra = '25/25';
--
-- 31/05/2026 reproduz a Copasul (68 dias cobrados). 01/06/2026 reproduz a
-- planilha antiga da Adriane (67 dias, R$ 6.424,02) — a diferença entre as
-- duas é de um único dia de contagem.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- ROLLBACK:
--   Reexecutar a definição da view e da fn_baixar_estoque_fifo da migration
--   0043 e:
--   drop function if exists public.fn_desfazer_baixas(uuid[]);
--   drop function if exists public.fn_zerar_saldo_quebra(public.cultura_safra, text, uuid, date, text);
--   delete from public.safra_baixas where motivo = 'quebra_tecnica';
--   alter table public.safra_baixas drop constraint if exists safra_baixas_motivo_check;
--   alter table public.safra_baixas add constraint safra_baixas_motivo_check
--     check (motivo in ('venda', 'retirada', 'perda'));
--   alter table public.safra_parametros drop column if exists carencia_armazem_ate;
-- ----------------------------------------------------------------------------
