-- ============================================================================
-- 0048 — Ajustes de 31-jul-2026
-- ============================================================================
-- 1. Resgate CONSOLIDADO da fatura do Cartão de Crédito Sicredi.
--
--    Hoje (0044/0047) todo título da conta corrente Sicredi puxa um resgate
--    automático do Invest agrupado pelo DIA ÚTIL ANTERIOR ao vencimento
--    (tag 'auto:resgate_invest:<AAAA-MM-DD>').
--
--    Pedido (docx 31-07): para Cartão de Crédito isso vira UM resgate por
--    FATURA. Como a fatura vence todo dia 15, o resgate fica programado para
--    1 dia antes (dia útil), somando todos os lançamentos de cartão daquele
--    mês numa linha só. Demais formas de pagamento seguem a regra atual.
--
--    Tag nova: 'auto:resgate_invest_fatura:<AAAA-MM>'. Namespace separado de
--    propósito — `like 'auto:resgate_invest:%'` NÃO casa com ela, então cada
--    guard existente precisou ser revisado (feito abaixo).
--
-- 2. app_config: dia de vencimento da fatura e limite mensal de Despesa
--    Variável (o "20k" que a Adriane controlava na planilha).
--
-- Aplicar após a 0047.

-- ---------------------------------------------------------------------------
-- 1) Configurações novas
-- ---------------------------------------------------------------------------
insert into public.app_config (chave, valor, descricao) values
  ('fatura_cartao_sicredi_dia', '15',
   'Dia do vencimento da fatura do cartão de crédito Sicredi. O resgate consolidado da fatura é programado para o dia útil anterior a esta data.'),
  ('limite_despesa_variavel_mensal', '20000',
   'Teto mensal de Despesas Variáveis (R$). Alimenta o card "Despesa Variável" do Financeiro: saldo = limite − utilizado (status A pagar, Pago e Provisionado).')
on conflict (chave) do nothing;

create or replace function public.fn_fatura_cartao_sicredi_dia()
returns int
language sql
stable
as $$
  select coalesce(
    (select nullif(regexp_replace(valor, '\D', '', 'g'), '')::int
       from public.app_config where chave = 'fatura_cartao_sicredi_dia'),
    15
  )
$$;

comment on function public.fn_fatura_cartao_sicredi_dia() is
  'Dia do vencimento da fatura do cartão Sicredi (app_config, default 15). Migration 0048.';

-- ---------------------------------------------------------------------------
-- 2) Resgate consolidado da fatura — localiza ou cria o do mês
-- ---------------------------------------------------------------------------
-- p_mes_venc: qualquer data DENTRO do mês da fatura (usa-se o vencimento do
-- título). A linha nasce com valor 0; fn_resgate_invest_recalc soma os títulos
-- vinculados, como já faz com o resgate diário.
create or replace function public.fn_resgate_fatura_cartao_obter(p_mes_venc date)
returns uuid
language plpgsql
as $$
declare
  v_sic   uuid := public.fn_conta_sicredi_corrente();
  v_forn  uuid;
  v_id    uuid;
  v_mes   text := to_char(p_mes_venc, 'YYYY-MM');
  v_tag   text := 'auto:resgate_invest_fatura:' || to_char(p_mes_venc, 'YYYY-MM');
  v_venc  date;
  v_data  date;
begin
  if v_sic is null or p_mes_venc is null then return null; end if;

  select id into v_id
    from public.transacoes_empresa
   where origem_planilha = v_tag
     and status in ('resgate', 'a_resgatar')
   order by created_at
   limit 1;
  if v_id is not null then return v_id; end if;

  -- Vencimento da fatura = dia configurado, dentro do mês do título.
  -- least(...) protege meses curtos caso o dia configurado passe de 28.
  v_venc := make_date(
    extract(year from p_mes_venc)::int,
    extract(month from p_mes_venc)::int,
    least(public.fn_fatura_cartao_sicredi_dia(),
          extract(day from (date_trunc('month', p_mes_venc) + interval '1 month - 1 day'))::int)
  );
  v_data := public.fn_dia_util_anterior(v_venc);

  select id into v_forn from public.fornecedores
   where nome = 'Banco Cooperativa Sicredi' limit 1;

  insert into public.transacoes_empresa
    (data, conta_contabil_cod, centro_custo_cod, tipo_despesa, obs_obra,
     forma_pgto, conta_bancaria_id, status, valor,
     fornecedor_id, fornecedor_nome, descricao, origem_planilha, observacao)
  values
    (v_data, '1.8', '1.8.1', 'sem', 'sem', 'sem',
     v_sic, 'resgate', 0,
     v_forn, 'Banco Cooperativa Sicredi',
     'Resgate da Conta Investimento Invest - Fatura Cartão de Crédito ' ||
       substring(v_mes from 6 for 2) || '/' || substring(v_mes from 1 for 4),
     v_tag,
     'Resgate único da fatura do cartão: soma os lançamentos de Cartão de Crédito do Sicredi com vencimento em ' ||
       substring(v_mes from 6 for 2) || '/' || substring(v_mes from 1 for 4) ||
       '. Programado para o dia útil anterior ao vencimento da fatura.')
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.fn_resgate_fatura_cartao_obter(date) is
  'Localiza (ou cria) o resgate CONSOLIDADO da fatura do cartão Sicredi do mês da data informada, programado para o dia útil anterior ao vencimento da fatura. Migration 0048.';

-- ---------------------------------------------------------------------------
-- 3) Escolha do resgate: cartão → fatura do mês; demais → dia útil anterior
-- ---------------------------------------------------------------------------
create or replace function public.fn_resgate_alvo_do_titulo(p_forma public.forma_pgto, p_venc date)
returns uuid
language plpgsql
as $$
begin
  if p_venc is null then return null; end if;
  if p_forma = 'cartao_credito' then
    return public.fn_resgate_fatura_cartao_obter(p_venc);
  end if;
  return public.fn_resgate_invest_obter(public.fn_dia_util_anterior(p_venc));
end;
$$;

comment on function public.fn_resgate_alvo_do_titulo(public.forma_pgto, date) is
  'Resgate automático que deve receber um título do Sicredi: consolidado da fatura quando a forma é Cartão de Crédito, diário nos demais casos. Migration 0048.';

-- ---------------------------------------------------------------------------
-- 4) recalc passa a enxergar as DUAS famílias de resgate automático
-- ---------------------------------------------------------------------------
-- Só muda o guard do SELECT (antes: `like 'auto:resgate_invest:%'`, que não
-- casa com a tag da fatura por causa do ':'). O resto é idêntico à 0044.
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
     and (origem_planilha like 'auto:resgate_invest:%'
       or origem_planilha like 'auto:resgate_invest_fatura:%')
   for update;
  if not found then return; end if;

  if v_resgate.status = 'resgatado' then return; end if;

  select coalesce(sum(-valor), 0),
         bool_or(status not in ('provisionado', 'provisionado_dl', 'provisionado_dv'))
    into v_total, v_tem_confirmado
    from public.transacoes_empresa
   where resgate_auto_id = p_resgate_id;

  if v_total <= 0 then
    delete from public.transacoes_empresa where id = p_resgate_id;
    return;
  end if;

  v_status_novo := case when coalesce(v_tem_confirmado, false) then 'a_resgatar' else 'resgate' end;

  if p_validar and v_invest is not null then
    select coalesce(sum(valor), 0) into v_saldo_invest
      from public.transacoes_empresa
     where conta_bancaria_id = v_invest
       and status in ('saldo_inicial', 'recebido', 'pago', 'repassado', 'aplicado', 'aplicacao', 'resgatado');

    if exists (select 1 from public.transacoes_empresa where conta_bancaria_id = v_invest) then
      select coalesce(sum(valor), 0) into v_comprometido
        from public.transacoes_empresa
       where conta_bancaria_id = v_sic
         and conta_contabil_cod = '1.8'
         and status in ('resgate', 'a_resgatar')
         and id <> p_resgate_id;

      v_disponivel := v_saldo_invest - v_comprometido;
      if v_total > v_disponivel
         and coalesce(current_setting('arambi.invest_sem_validacao', true), 'off') <> 'on' then
        raise exception
          'Saldo insuficiente na conta Sicredi Invest: o resgate de % excede o disponível de % (saldo % menos % já comprometidos em outros resgates).',
          to_char(v_total, 'FM999G999G990D00'), to_char(v_disponivel, 'FM999G999G990D00'),
          to_char(v_saldo_invest, 'FM999G999G990D00'), to_char(v_comprometido, 'FM999G999G990D00');
      end if;
    end if;
  end if;

  update public.transacoes_empresa
     set valor = v_total, status = v_status_novo
   where id = p_resgate_id
     and (valor is distinct from v_total or status is distinct from v_status_novo);
end;
$$;

comment on function public.fn_resgate_invest_recalc(uuid, boolean) is
  'Recalcula um resgate automático do Invest (diário OU consolidado da fatura do cartão) a partir dos títulos vinculados. Migrations 0044/0048.';

-- ---------------------------------------------------------------------------
-- 5) Trigger de vínculo: usa fn_resgate_alvo_do_titulo
-- ---------------------------------------------------------------------------
-- Diferenças para a 0047: (a) escolhe o alvo pela FORMA DE PGTO; (b) o guard
-- "sou um resgate automático" cobre a tag da fatura; (c) mudar a FORMA DE PGTO
-- (ex.: Boleto → Cartão de Crédito) também remaneja o título.
create or replace function public.tg_te_resgate_invest_link()
returns trigger
language plpgsql
as $$
declare
  v_sic         uuid;
  v_eh_driver   boolean;
  v_era_driver  boolean;
  v_status_resgate public.status_aramburu;
  v_tag_atual   text;
  v_alvo        uuid;
begin
  if pg_trigger_depth() > 1 then return new; end if;

  v_sic := public.fn_conta_sicredi_corrente();
  if v_sic is null then return new; end if;

  -- O próprio resgate automático (diário ou de fatura) nunca é "título".
  if new.origem_planilha like 'auto:resgate_invest:%'
     or new.origem_planilha like 'auto:resgate_invest_fatura:%' then
    return new;
  end if;

  v_eh_driver := new.conta_bancaria_id = v_sic
             and new.valor < 0
             and new.status <> 'saldo_inicial';

  if tg_op = 'INSERT' then
    if v_eh_driver and public.fn_resgates_auto_sicredi_ativos() then
      new.resgate_auto_id := public.fn_resgate_alvo_do_titulo(new.forma_pgto, new.data);
    end if;
    return new;
  end if;

  -- UPDATE
  v_era_driver := old.conta_bancaria_id = v_sic
              and old.valor < 0
              and old.status <> 'saldo_inicial';

  if not v_eh_driver then
    new.resgate_auto_id := null;
    return new;
  end if;

  if new.resgate_auto_id is null then
    if not v_era_driver and public.fn_resgates_auto_sicredi_ativos() then
      new.resgate_auto_id := public.fn_resgate_alvo_do_titulo(new.forma_pgto, new.data);
    end if;
    return new;
  end if;

  -- Mudou o vencimento OU a forma de pagamento → pode ter mudado o resgate de
  -- destino (inclusive migrando entre "diário" e "fatura do cartão").
  if new.data is distinct from old.data
     or new.forma_pgto is distinct from old.forma_pgto then
    select status, origem_planilha into v_status_resgate, v_tag_atual
      from public.transacoes_empresa where id = new.resgate_auto_id;

    if v_status_resgate is null then
      new.resgate_auto_id := public.fn_resgate_alvo_do_titulo(new.forma_pgto, new.data);
    elsif v_status_resgate <> 'resgatado' then
      -- Só remaneja se o alvo correto for OUTRA linha (evita churn à toa).
      v_alvo := public.fn_resgate_alvo_do_titulo(new.forma_pgto, new.data);
      if v_alvo is distinct from new.resgate_auto_id then
        new.resgate_auto_id := v_alvo;
      end if;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.tg_te_resgate_invest_link() is
  'Vincula títulos do Sicredi ao resgate automático do Invest: consolidado por FATURA quando a forma é Cartão de Crédito (0048), diário nos demais casos (0044/0047).';

-- ---------------------------------------------------------------------------
-- 6) Backfill — move os títulos de CARTÃO já existentes para o resgate da fatura
-- ---------------------------------------------------------------------------
-- Seguro por construção:
--   • só mexe em título cujo resgate atual NÃO está 'resgatado' (confirmado no
--     extrato = congelado, não se reescreve história);
--   • resgates diários que ficarem sem título são apagados pelo recalc;
--   • roda com os resgates automáticos ativos apenas (respeita o toggle).
do $$
declare
  r            record;
  v_antigo     uuid;
  v_novo       uuid;
  v_afetados   int := 0;
  v_antigos    uuid[] := '{}';
begin
  if public.fn_conta_sicredi_corrente() is null then
    raise notice '0048: conta Sicredi corrente não encontrada — backfill pulado.';
    return;
  end if;
  if not public.fn_resgates_auto_sicredi_ativos() then
    raise notice '0048: resgates automáticos desligados (app_config) — backfill pulado.';
    return;
  end if;

  for r in
    select t.id, t.data, t.resgate_auto_id
      from public.transacoes_empresa t
      join public.transacoes_empresa g on g.id = t.resgate_auto_id
     where t.conta_bancaria_id = public.fn_conta_sicredi_corrente()
       and t.forma_pgto = 'cartao_credito'
       and t.valor < 0
       and t.status <> 'saldo_inicial'
       and g.status <> 'resgatado'
       and coalesce(g.origem_planilha, '') like 'auto:resgate_invest:%'
     order by t.data
  loop
    v_antigo := r.resgate_auto_id;
    v_novo := public.fn_resgate_fatura_cartao_obter(r.data);
    if v_novo is not null and v_novo is distinct from v_antigo then
      update public.transacoes_empresa set resgate_auto_id = v_novo where id = r.id;
      if not (v_antigo = any(v_antigos)) then
        v_antigos := array_append(v_antigos, v_antigo);
      end if;
      v_afetados := v_afetados + 1;
    end if;
  end loop;

  -- Recalcula os resgates diários esvaziados (some quem ficou sem título) e,
  -- depois, os consolidados recém-criados. Validação de saldo DESLIGADA no
  -- backfill: é só remanejamento, o total resgatado não muda.
  foreach v_antigo in array v_antigos loop
    perform public.fn_resgate_invest_recalc(v_antigo, false);
  end loop;
  for r in
    select id from public.transacoes_empresa
     where origem_planilha like 'auto:resgate_invest_fatura:%'
  loop
    perform public.fn_resgate_invest_recalc(r.id, false);
  end loop;

  raise notice '0048: % título(s) de cartão migrados para o resgate consolidado da fatura.', v_afetados;
end $$;

-- ----------------------------------------------------------------------------
-- ROLLBACK:
--   -- 1) devolver os títulos de cartão ao resgate diário:
--   --    update public.transacoes_empresa t
--   --       set resgate_auto_id = public.fn_resgate_invest_obter(public.fn_dia_util_anterior(t.data))
--   --     where t.forma_pgto = 'cartao_credito'
--   --       and t.resgate_auto_id in (select id from public.transacoes_empresa
--   --                                  where origem_planilha like 'auto:resgate_invest_fatura:%');
--   --    delete from public.transacoes_empresa where origem_planilha like 'auto:resgate_invest_fatura:%';
--   -- 2) restaurar tg_te_resgate_invest_link e fn_resgate_invest_recalc da 0047/0044
--   drop function if exists public.fn_resgate_alvo_do_titulo(public.forma_pgto, date);
--   drop function if exists public.fn_resgate_fatura_cartao_obter(date);
--   drop function if exists public.fn_fatura_cartao_sicredi_dia();
--   delete from public.app_config where chave in ('fatura_cartao_sicredi_dia', 'limite_despesa_variavel_mensal');
-- ----------------------------------------------------------------------------
