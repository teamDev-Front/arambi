-- ============================================================================
-- 0046 — Validação de saldo do Invest vira CONFIRMÁVEL (24-jul-2026, tarde)
-- ============================================================================
-- Pedido: a validação de saldo da conta SICREDI INVEST (0044) hoje BLOQUEIA o
-- lançamento com erro. Passa a funcionar assim:
--   • Fluxo normal: continua bloqueando (a regra não muda para nenhum outro
--     caminho — imports, scripts, API…).
--   • Tela Financeiro: ao receber ESTE erro, o front abre um modal
--     "Cancelar / Executar mesmo assim". Confirmando, refaz a operação pelas
--     RPCs *_sem_saldo_invest abaixo, que ligam um bypass LOCAL DA TRANSAÇÃO
--     (set_config(..., is_local => true)) — vale só para aquela gravação; a
--     próxima operação volta a validar normalmente.
--   • As RPCs são SECURITY INVOKER: a RLS de escrita continua valendo (admin/
--     editor); o bypass pula SÓ a checagem de saldo, nada mais.
--
-- Depende da 0044 (fn_resgate_invest_recalc). Aplicar após a 0045.

-- ---------------------------------------------------------------------------
-- 1) fn_resgate_invest_recalc — respeita o bypass transacional
--    (única mudança vs 0044: a condição do GUC 'arambi.invest_sem_validacao')
-- ---------------------------------------------------------------------------
create or replace function public.fn_resgate_invest_recalc(p_resgate_id uuid, p_validar boolean default true)
returns void
language plpgsql
as $$
declare
  v_resgate      public.transacoes_empresa%rowtype;
  v_total        numeric(15,2);
  v_tem_confirmado boolean;
  v_status_novo  public.status_aramburu;
  v_invest       uuid := public.fn_conta_sicredi_invest();
  v_sic          uuid := public.fn_conta_sicredi_corrente();
  v_saldo_invest numeric(15,2);
  v_comprometido numeric(15,2);
  v_disponivel   numeric(15,2);
begin
  if p_resgate_id is null then return; end if;

  select * into v_resgate
    from public.transacoes_empresa
   where id = p_resgate_id
     and origem_planilha like 'auto:resgate_invest:%'
   for update;
  if not found then return; end if;

  -- Resgate já confirmado no extrato (manual) → congelado, nada muda.
  if v_resgate.status = 'resgatado' then return; end if;

  select coalesce(sum(-valor), 0),
         bool_or(status not in ('provisionado', 'provisionado_dl', 'provisionado_dv'))
    into v_total, v_tem_confirmado
    from public.transacoes_empresa
   where resgate_auto_id = p_resgate_id
     and valor < 0;

  if v_total <= 0 then
    delete from public.transacoes_empresa where id = p_resgate_id;
    return;
  end if;

  v_status_novo := case when v_tem_confirmado then 'a_resgatar' else 'resgate' end;

  -- Validação de saldo do Invest — só quando o valor AUMENTA e a conta Invest
  -- tem lançamentos. Pulada quando o bypass transacional (0046) está ligado:
  -- o usuário viu o alerta e escolheu "Executar mesmo assim".
  if p_validar
     and coalesce(current_setting('arambi.invest_sem_validacao', true), '') <> 'on'
     and v_total > v_resgate.valor
     and v_invest is not null
     and exists (select 1 from public.transacoes_empresa where conta_bancaria_id = v_invest) then

    select coalesce(sum(valor) filter (where status in
      ('saldo_inicial','recebido','pago','repassado','aplicado','aplicacao','resgatado')), 0)
      into v_saldo_invest
      from public.transacoes_empresa
     where conta_bancaria_id = v_invest;

    select coalesce(sum(valor), 0) into v_comprometido
      from public.transacoes_empresa
     where conta_bancaria_id = v_sic
       and status in ('resgate', 'a_resgatar')
       and id <> p_resgate_id;

    v_disponivel := v_saldo_invest - v_comprometido;
    if v_total > v_disponivel then
      raise exception
        'Saldo insuficiente na conta Sicredi Invest: disponível R$ %, necessário R$ % para o resgate de %. Lançamento não gravado — ajuste o saldo do Invest (ou o valor) e tente de novo.',
        to_char(v_disponivel, 'FM999G999G990D00'),
        to_char(v_total, 'FM999G999G990D00'),
        to_char(v_resgate.data, 'DD/MM/YYYY');
    end if;
  end if;

  update public.transacoes_empresa
     set valor = v_total,
         status = v_status_novo
   where id = p_resgate_id
     and (valor is distinct from v_total or status is distinct from v_status_novo);
end;
$$;

comment on function public.fn_resgate_invest_recalc(uuid, boolean) is
  'Recalcula um resgate automático Sicredi Invest a partir dos títulos vinculados. Valida o saldo do Invest, exceto quando o bypass transacional arambi.invest_sem_validacao está ligado (0046 — "Executar mesmo assim").';

-- ---------------------------------------------------------------------------
-- 2) RPCs "Executar mesmo assim" — mesma operação, mesma RLS, sem a validação
-- ---------------------------------------------------------------------------

-- Criação (1 ou N payloads — cobre lançamento simples e parcelas geradas).
create or replace function public.fn_criar_transacoes_sem_saldo_invest(p_payloads jsonb)
returns setof public.transacoes_empresa
language plpgsql
as $$
declare
  p jsonb;
begin
  if p_payloads is null or jsonb_typeof(p_payloads) <> 'array' then
    raise exception 'p_payloads deve ser um array JSON de lançamentos';
  end if;
  perform set_config('arambi.invest_sem_validacao', 'on', true);  -- só esta transação
  for p in select * from jsonb_array_elements(p_payloads) loop
    return query
    insert into public.transacoes_empresa
      (data, data_emissao, conta_contabil_cod, centro_custo_cod, tipo_despesa,
       fornecedor_id, fornecedor_nome, descricao, obs_obra, ref, parcelas,
       forma_pgto, conta_bancaria_id, status, valor, observacao, origem_planilha, created_by)
    values
      ((p->>'data')::date,
       nullif(p->>'data_emissao', '')::date,
       p->>'conta_contabil_cod',
       p->>'centro_custo_cod',
       coalesce(nullif(p->>'tipo_despesa', ''), 'sem')::public.tipo_despesa,
       nullif(p->>'fornecedor_id', '')::uuid,
       p->>'fornecedor_nome',
       p->>'descricao',
       coalesce(nullif(p->>'obs_obra', ''), 'sem')::public.obs_obra,
       p->>'ref',
       p->>'parcelas',
       coalesce(nullif(p->>'forma_pgto', ''), 'sem')::public.forma_pgto,
       nullif(p->>'conta_bancaria_id', '')::uuid,
       (p->>'status')::public.status_aramburu,
       (p->>'valor')::numeric,
       p->>'observacao',
       p->>'origem_planilha',
       nullif(p->>'created_by', '')::uuid)
    returning *;
  end loop;
end;
$$;

-- Edição (payload parcial: só as chaves presentes são alteradas).
create or replace function public.fn_atualizar_transacao_sem_saldo_invest(p_id uuid, p_payload jsonb)
returns setof public.transacoes_empresa
language plpgsql
as $$
begin
  perform set_config('arambi.invest_sem_validacao', 'on', true);  -- só esta transação
  return query
  update public.transacoes_empresa t set
    data               = case when p_payload ? 'data'               then (p_payload->>'data')::date                       else t.data end,
    data_emissao       = case when p_payload ? 'data_emissao'       then nullif(p_payload->>'data_emissao', '')::date    else t.data_emissao end,
    conta_contabil_cod = case when p_payload ? 'conta_contabil_cod' then p_payload->>'conta_contabil_cod'                else t.conta_contabil_cod end,
    centro_custo_cod   = case when p_payload ? 'centro_custo_cod'   then p_payload->>'centro_custo_cod'                  else t.centro_custo_cod end,
    tipo_despesa       = case when p_payload ? 'tipo_despesa'       then (p_payload->>'tipo_despesa')::public.tipo_despesa else t.tipo_despesa end,
    fornecedor_id      = case when p_payload ? 'fornecedor_id'      then nullif(p_payload->>'fornecedor_id', '')::uuid   else t.fornecedor_id end,
    fornecedor_nome    = case when p_payload ? 'fornecedor_nome'    then p_payload->>'fornecedor_nome'                   else t.fornecedor_nome end,
    descricao          = case when p_payload ? 'descricao'          then p_payload->>'descricao'                         else t.descricao end,
    obs_obra           = case when p_payload ? 'obs_obra'           then (p_payload->>'obs_obra')::public.obs_obra       else t.obs_obra end,
    ref                = case when p_payload ? 'ref'                then p_payload->>'ref'                               else t.ref end,
    parcelas           = case when p_payload ? 'parcelas'           then p_payload->>'parcelas'                          else t.parcelas end,
    forma_pgto         = case when p_payload ? 'forma_pgto'         then (p_payload->>'forma_pgto')::public.forma_pgto   else t.forma_pgto end,
    conta_bancaria_id  = case when p_payload ? 'conta_bancaria_id'  then nullif(p_payload->>'conta_bancaria_id', '')::uuid else t.conta_bancaria_id end,
    status             = case when p_payload ? 'status'             then (p_payload->>'status')::public.status_aramburu  else t.status end,
    valor              = case when p_payload ? 'valor'              then (p_payload->>'valor')::numeric                  else t.valor end,
    observacao         = case when p_payload ? 'observacao'         then p_payload->>'observacao'                        else t.observacao end
  where t.id = p_id
  returning *;
end;
$$;

-- Status em massa.
create or replace function public.fn_status_massa_sem_saldo_invest(p_ids uuid[], p_status public.status_aramburu)
returns int
language plpgsql
as $$
declare
  v_qtd int;
begin
  perform set_config('arambi.invest_sem_validacao', 'on', true);  -- só esta transação
  update public.transacoes_empresa
     set status = p_status
   where id = any(p_ids);
  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

grant execute on function public.fn_criar_transacoes_sem_saldo_invest(jsonb) to authenticated;
grant execute on function public.fn_atualizar_transacao_sem_saldo_invest(uuid, jsonb) to authenticated;
grant execute on function public.fn_status_massa_sem_saldo_invest(uuid[], public.status_aramburu) to authenticated;

comment on function public.fn_criar_transacoes_sem_saldo_invest(jsonb) is
  '"Executar mesmo assim" (0046): cria lançamento(s) pulando SÓ a validação de saldo do Invest. RLS de escrita continua valendo.';
comment on function public.fn_atualizar_transacao_sem_saldo_invest(uuid, jsonb) is
  '"Executar mesmo assim" (0046): atualiza um lançamento (payload parcial) pulando SÓ a validação de saldo do Invest.';
comment on function public.fn_status_massa_sem_saldo_invest(uuid[], public.status_aramburu) is
  '"Executar mesmo assim" (0046): aplica status em massa pulando SÓ a validação de saldo do Invest.';
