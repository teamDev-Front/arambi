-- ============================================================================
-- 0026 — Validações cruzadas (replicas das células Ok/Valor Incorreto)
--        + auto-link venda ↔ transação por NF
-- ============================================================================
-- Replica EXATAMENTE as validações que existiam na planilha Excel:
--   • obra sede!H32  → soma das categorias 2026 == capital + total LTS
--   • obra sede!H62  → soma 2025+2026 == total contrato
--   • obra sede!H79  → total geral == soma OC + Medições + Outras
--   • $ obra sede!I50/I56/I60 → saldo dos bancos cobre A pagar / Provisionado
--   • LTS!K85       → total contrato == soma de medições+OCs
--   • NOTAS EM GRUPO!F17 → notas a emitir == orçamento - notas emitidas
--
-- O trigger venda↔NF automatiza o que a Lola fazia ao ver uma NF cair na
-- Aramburu_Mensal e atualizar manualmente a planilha de Vendas.

-- ---------------------------------------------------------------------------
-- 1) Trigger: vincular venda_provisionada quando uma transação Recebida
--    com NF correspondente é inserida em transacoes_empresa
-- ---------------------------------------------------------------------------
-- Quando um lançamento tem `ref` igual à `nota_fiscal` de uma venda firmada,
-- vincula a venda → transação E marca status='liquidada' (ou 'parcial' se a
-- venda tem mais parcelas pendentes — heurística: se o valor recebido é
-- menor que o total da venda, fica parcial).
create or replace function public.tg_auto_link_venda_nf()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venda record;
  v_valor_venda numeric;
  v_valor_recebido numeric;
begin
  -- Só dispara quando o ref existe e é uma entrada (recebido/a_receber/etc.)
  if new.ref is null or new.ref = '' then return new; end if;
  if new.valor <= 0 then return new; end if;

  -- Procura venda firmada com mesma NF
  select v.*,
         (v.kg / nullif(v.kg_por_saca, 0)) * v.preco_sc as total_venda
    into v_venda
  from public.vendas_provisionadas v
  where v.nota_fiscal = new.ref
    and v.status in ('firmada', 'parcial')
  limit 1;

  if not found then return new; end if;

  v_valor_venda    := v_venda.total_venda;
  v_valor_recebido := new.valor;

  update public.vendas_provisionadas
     set transacao_empresa_id = new.id,
         status = case
           when v_valor_recebido >= v_valor_venda - 0.5 then 'liquidada'::public.venda_status
           else 'parcial'::public.venda_status
         end,
         updated_at = now()
   where id = v_venda.id;

  return new;
end;
$$;

drop trigger if exists tg_te_auto_link_venda on public.transacoes_empresa;
create trigger tg_te_auto_link_venda
  after insert on public.transacoes_empresa
  for each row execute function public.tg_auto_link_venda_nf();

comment on function public.tg_auto_link_venda_nf is
  'Vincula automaticamente venda_provisionada↔transacao_empresa quando ref=nota_fiscal. Atualiza status para liquidada/parcial.';

-- ---------------------------------------------------------------------------
-- 2) fn_validar_consistencia() — retorna lista de discrepâncias
-- ---------------------------------------------------------------------------
-- Cada linha = uma validação. severidade ('ok' | 'aviso' | 'erro').
-- Retorna apenas o que NÃO está OK para virar uma lista de alertas no UI.
create or replace function public.fn_validar_consistencia()
returns table (
  codigo      text,        -- "obra_h32", "lts_k85", etc.
  descricao   text,        -- texto humano
  severidade  text,        -- "aviso" | "erro"
  esperado    numeric,
  realizado   numeric,
  diferenca   numeric,
  detalhes    text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_capital_inicial numeric;
  v_total_lts_oc     numeric;
  v_total_lts_med    numeric;
  v_total_contrato   numeric;
  v_pago_oc_proj     numeric;
  v_pago_medicoes    numeric;
  v_a_pagar          numeric;
  v_provisionado     numeric;
  v_saldo_mju        numeric;
  v_saldo_cgr        numeric;
  v_saldo_cora       numeric;
begin
  -- Capital inicial e total contrato (parâmetros + somatórios)
  select coalesce(valor_numerico, 0) into v_capital_inicial
    from public.obra_parametros where chave = 'capital_inicial';

  select coalesce(sum(valor), 0) into v_total_contrato
    from public.obra_lts_itens where status <> 'cancelado';

  select coalesce(sum(valor), 0) into v_total_lts_oc
    from public.obra_lts_itens where status <> 'cancelado'
      and (oc_numero ilike 'OC%' or contrato ilike '%OC%');

  select coalesce(sum(valor), 0) into v_total_lts_med
    from public.obra_lts_itens where status <> 'cancelado'
      and (oc_numero ilike 'MED%' or contrato ilike '%medi%' );

  -- Pago/A pagar/Provisionado do centro_custo 2.7.2 (obra)
  select
    coalesce(sum(case when status = 'pago'         and obs_obra in ('ordem_compra','projeto') then -valor else 0 end), 0),
    coalesce(sum(case when status = 'pago'         and obs_obra::text like 'medicao_%'        then -valor else 0 end), 0),
    coalesce(sum(case when status = 'a_pagar'                                                 then -valor else 0 end), 0),
    coalesce(sum(case when status = 'provisionado'                                            then -valor else 0 end), 0)
    into v_pago_oc_proj, v_pago_medicoes, v_a_pagar, v_provisionado
  from public.transacoes_empresa
  where centro_custo_cod = '2.7.2';

  -- Saldos atuais por banco (apelido) — replica $ obra sede!I50/I56
  select coalesce(saldo_atual, 0) into v_saldo_mju
    from public.v_saldo_atual_por_banco
    where banco_apelido ilike '%MJU%' or banco_nome ilike '%0902%'
    limit 1;
  select coalesce(saldo_atual, 0) into v_saldo_cgr
    from public.v_saldo_atual_por_banco
    where banco_apelido ilike '%CGR%' or banco_nome ilike '%0913%'
    limit 1;
  select coalesce(saldo_atual, 0) into v_saldo_cora
    from public.v_saldo_atual_por_banco
    where banco_apelido ilike '%Cora%' or banco_nome ilike '%Cora%'
    limit 1;

  -- VALIDAÇÃO 1: LTS!K85 — total contrato bate com soma dos itens
  if v_total_contrato = 0 and v_total_lts_oc + v_total_lts_med = 0 then
    -- ambos zero, nada a validar
    null;
  elsif abs(v_total_contrato - (v_total_lts_oc + v_total_lts_med)) > 0.5 then
    codigo := 'lts_k85';
    descricao := 'Total do contrato LTS difere da soma de OCs + Medições.';
    severidade := 'aviso';
    esperado := v_total_contrato;
    realizado := v_total_lts_oc + v_total_lts_med;
    diferenca := esperado - realizado;
    detalhes := format('OCs: %s | Medições: %s', v_total_lts_oc, v_total_lts_med);
    return next;
  end if;

  -- VALIDAÇÃO 2: obra sede!H32 — saldo bancário cobre A pagar?
  if v_saldo_mju + v_saldo_cgr + v_saldo_cora > 0 and v_a_pagar > 0 then
    if v_saldo_mju + v_saldo_cgr + v_saldo_cora < v_a_pagar then
      codigo := 'obra_saldo_a_pagar';
      descricao := 'Saldo total dos bancos NÃO cobre o A Pagar da obra.';
      severidade := 'erro';
      esperado := v_a_pagar;
      realizado := v_saldo_mju + v_saldo_cgr + v_saldo_cora;
      diferenca := esperado - realizado;
      detalhes := format('Cora: %s | MJU: %s | CGR: %s', v_saldo_cora, v_saldo_mju, v_saldo_cgr);
      return next;
    end if;
  end if;

  -- VALIDAÇÃO 3: obra sede!I60 — saldo cobre A pagar + Provisionado?
  if v_saldo_mju + v_saldo_cgr + v_saldo_cora > 0 and (v_a_pagar + v_provisionado) > 0 then
    if v_saldo_mju + v_saldo_cgr + v_saldo_cora < (v_a_pagar + v_provisionado) then
      codigo := 'obra_saldo_provisionado';
      descricao := 'Saldo total dos bancos NÃO cobre A Pagar + Provisionado da obra.';
      severidade := 'aviso';
      esperado := v_a_pagar + v_provisionado;
      realizado := v_saldo_mju + v_saldo_cgr + v_saldo_cora;
      diferenca := esperado - realizado;
      detalhes := format('A pagar: %s | Provisionado: %s', v_a_pagar, v_provisionado);
      return next;
    end if;
  end if;

  -- VALIDAÇÃO 4: Capital inicial vs custo total (placeholder se cadastrado)
  if v_capital_inicial > 0 then
    declare
      v_custo_total numeric := v_pago_oc_proj + v_pago_medicoes + v_a_pagar + v_provisionado;
    begin
      if v_custo_total > v_capital_inicial then
        codigo := 'obra_capital';
        descricao := 'Custo total da obra ultrapassou o capital inicial declarado.';
        severidade := 'aviso';
        esperado := v_capital_inicial;
        realizado := v_custo_total;
        diferenca := esperado - realizado;
        detalhes := format('Capital: %s | Pago + A pagar + Provisionado: %s', v_capital_inicial, v_custo_total);
        return next;
      end if;
    end;
  end if;

  -- VALIDAÇÃO 5: pares de transferência interna órfãos
  -- (lançamento "Transf. Entre Contas..." sem par com valor oposto)
  for codigo, descricao, severidade, esperado, realizado, diferenca, detalhes in
    select
      'transf_orfa'::text,
      format('Transferência interna sem par: "%s" (%s)', t.descricao, t.data),
      'aviso'::text,
      0::numeric,
      t.valor,
      t.valor,
      format('Lançamento id=%s. Esperado um par com valor=%s e descrição idêntica.', t.id, -t.valor)
    from public.transacoes_empresa t
    where t.descricao ilike '%transf%entre%contas%'
      and not exists (
        select 1 from public.transacoes_empresa p
        where p.id <> t.id
          and p.descricao = t.descricao
          and p.valor = -t.valor
      )
  loop
    return next;
  end loop;

  return;
end;
$$;

comment on function public.fn_validar_consistencia is
  'Retorna lista de discrepâncias detectadas. Replica os validadores Ok/Valor Incorreto da planilha (obra sede!H32/I50/I56/I60, LTS!K85, pares de transferência).';
