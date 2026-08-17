-- ============================================================================
-- 0053 — O resgate segue o status do título (amarelo mensal, vermelho por lote)
-- ============================================================================
-- Regra confirmada pela Adri (WhatsApp, 14-ago-2026):
--
--   "As linhas em amarelo representam as programações, enquanto as linhas em
--    vermelho correspondem aos lançamentos efetivamente realizados no banco.
--    Ou seja, esses lançamentos não sofrerão alterações."
--
--   🟡 Provisionado  → o resgate fica como Resgate (amarelo), UMA linha por mês,
--                      no ÚLTIMO DIA DO MÊS ("último dia do mês", resposta dela).
--                      Era exatamente o que a planilha fazia com um SOMASES:
--                      "não lançava um resgate para cada título provisionado,
--                       porque o provisionado ainda pode sofrer alterações".
--
--   🔴 A Pagar       → o título sai da linha mensal e entra numa linha A Resgatar
--                      do dia útil anterior (regra da 0050), que a partir daí
--                      não muda mais.
--
--   🔴➕ Complemento  → se depois surgir outro título para o mesmo dia, ele NÃO
--                      soma na linha vermelha que já existe: nasce uma linha
--                      nova. Nas palavras dela:
--                      "se houver um agendamento de R$ 1,00 e outro extra de
--                       R$ 2,00 no mesmo dia, ambos aparecerão separadamente no
--                       extrato bancário, e não como um único lançamento de
--                       R$ 3,00. O sistema deve ser o espelho do extrato."
--
-- O agrupamento do vermelho é por LOTE = a transação de banco de dados em que
-- os títulos mudaram de status. Ou seja: o que ela mudar de uma vez (seleção em
-- massa) vira UMA linha; o que ela mudar depois vira OUTRA. É a leitura que
-- respeita "soma do dia" (ela confirmou que o vermelho continua somando o dia,
-- não um por título) sem quebrar a conciliação lançamento a lançamento.
--
-- Caso real que motivou: o resgate de 19/08 estava em R$ 3.209,03 marcado como
-- A Resgatar, mas por dentro tinha R$ 1.620,00 ainda Provisionados e só
-- R$ 1.589,03 de fato agendados no banco.
--
-- Aplicar após a 0052.

-- ---------------------------------------------------------------------------
-- 1) Peças novas: lote e fim do mês
-- ---------------------------------------------------------------------------
-- O lote identifica a "leva": tudo que muda dentro da mesma transação de banco
-- compartilha o mesmo txid, então uma alteração em massa gera um lote só.
create or replace function public.fn_resgate_lote()
returns text
language sql
volatile
as $$
  select 'L' || txid_current()::text
$$;

comment on function public.fn_resgate_lote() is
  'Identificador da leva de títulos que mudou de status junta (txid da transação). Agrupa a linha vermelha de resgate. Migration 0053.';

create or replace function public.fn_fim_do_mes(p_data date)
returns date
language sql
immutable
as $$
  select (date_trunc('month', p_data) + interval '1 month - 1 day')::date
$$;

comment on function public.fn_fim_do_mes(date) is
  'Último dia do mês da data informada. Migration 0053.';

-- Um título está apenas PROGRAMADO (ainda não foi para o banco)?
create or replace function public.fn_titulo_provisionado(p_status public.status_aramburu)
returns boolean
language sql
immutable
as $$
  select p_status in ('provisionado', 'provisionado_dl', 'provisionado_dv')
$$;

comment on function public.fn_titulo_provisionado(public.status_aramburu) is
  'true = título apenas programado, que ainda pode mudar (vai para o resgate mensal amarelo). Migration 0053.';

-- ---------------------------------------------------------------------------
-- 2) 🟡 A linha mensal dos provisionados
-- ---------------------------------------------------------------------------
create or replace function public.fn_resgate_prov_mensal_obter(p_venc date)
returns uuid
language plpgsql
as $$
declare
  v_sic  uuid := public.fn_conta_sicredi_corrente();
  v_forn uuid;
  v_id   uuid;
  v_mes  text := to_char(p_venc, 'YYYY-MM');
  v_tag  text := 'auto:resgate_invest_prov:' || to_char(p_venc, 'YYYY-MM');
  v_dia  date := public.fn_fim_do_mes(p_venc);
begin
  if v_sic is null or p_venc is null then return null; end if;

  select id into v_id
    from public.transacoes_empresa
   where origem_planilha = v_tag
     and status = 'resgate'
   order by created_at
   limit 1;
  if v_id is not null then return v_id; end if;

  select id into v_forn from public.fornecedores
   where nome = 'Banco Cooperativa Sicredi' limit 1;

  insert into public.transacoes_empresa
    (data, conta_contabil_cod, centro_custo_cod, tipo_despesa, obs_obra,
     forma_pgto, conta_bancaria_id, status, valor,
     fornecedor_id, fornecedor_nome, descricao, origem_planilha, observacao)
  values
    (v_dia, '1.8', '1.8.1', 'sem', 'sem', 'sem',
     v_sic, 'resgate', 0,
     v_forn, 'Banco Cooperativa Sicredi',
     'Resgate da Conta Investimento Invest - Provisionados de ' ||
       substring(v_mes from 6 for 2) || '/' || substring(v_mes from 1 for 4),
     v_tag,
     'Programação: soma de tudo que está provisionado no mês na conta corrente ' ||
     'Sicredi. Cada título sai desta linha quando passa para A Pagar, e vira uma ' ||
     'linha própria de A Resgatar no dia do agendamento.')
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.fn_resgate_prov_mensal_obter(date) is
  'Localiza (ou cria) o resgate PROGRAMADO do mês (amarelo), no último dia do mês do vencimento, que soma os títulos provisionados da corrente Sicredi. Migration 0053.';

-- ---------------------------------------------------------------------------
-- 3) 🔴 As linhas confirmadas passam a ter lote
-- ---------------------------------------------------------------------------
-- Diária (0044/0050) — agora nasce já como A Resgatar, porque só recebe título
-- que saiu do provisionado, e com o lote no fim da etiqueta.
create or replace function public.fn_resgate_invest_obter(p_dia date, p_lote text)
returns uuid
language plpgsql
as $$
declare
  v_sic  uuid := public.fn_conta_sicredi_corrente();
  v_forn uuid;
  v_id   uuid;
  v_tag  text := 'auto:resgate_invest:' || to_char(p_dia, 'YYYY-MM-DD') || '#' || p_lote;
begin
  if v_sic is null or p_dia is null then return null; end if;

  select id into v_id
    from public.transacoes_empresa
   where origem_planilha = v_tag
     and status in ('resgate', 'a_resgatar')
   order by created_at
   limit 1;
  if v_id is not null then return v_id; end if;

  select id into v_forn from public.fornecedores
   where nome = 'Banco Cooperativa Sicredi' limit 1;

  insert into public.transacoes_empresa
    (data, conta_contabil_cod, centro_custo_cod, tipo_despesa, obs_obra,
     forma_pgto, conta_bancaria_id, status, valor,
     fornecedor_id, fornecedor_nome, descricao, origem_planilha, observacao)
  values
    (p_dia, '1.8', '1.8.1', 'sem', 'sem', 'sem',
     v_sic, 'a_resgatar', 0,
     v_forn, 'Banco Cooperativa Sicredi',
     'Resgate da Conta Investimento Invest - Reserva p/ Construção da Sede',
     v_tag,
     'Resgate de um agendamento: soma os títulos que foram para o banco juntos, ' ||
     'com vencimento no dia útil seguinte. Um agendamento novo no mesmo dia gera ' ||
     'outra linha, para o extrato bater lançamento a lançamento.')
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.fn_resgate_invest_obter(date, text) is
  'Localiza (ou cria) o resgate CONFIRMADO (vermelho) de um agendamento: um por dia e por lote de títulos que foram ao banco juntos. Migrations 0044/0050/0053.';

-- Compatibilidade: a versão de um argumento continua existindo e usa o lote da
-- transação corrente.
create or replace function public.fn_resgate_invest_obter(p_dia date)
returns uuid
language sql
as $$
  select public.fn_resgate_invest_obter(p_dia, public.fn_resgate_lote())
$$;

-- Fatura do cartão (0048/0050) — mesma ideia de lote.
create or replace function public.fn_resgate_fatura_cartao_obter(p_mes_venc date, p_lote text)
returns uuid
language plpgsql
as $$
declare
  v_sic   uuid := public.fn_conta_sicredi_corrente();
  v_forn  uuid;
  v_id    uuid;
  v_mes   text := to_char(p_mes_venc, 'YYYY-MM');
  v_tag   text := 'auto:resgate_invest_fatura:' || to_char(p_mes_venc, 'YYYY-MM') || '#' || p_lote;
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

  v_venc := make_date(
    extract(year from p_mes_venc)::int,
    extract(month from p_mes_venc)::int,
    least(public.fn_fatura_cartao_sicredi_dia(),
          extract(day from (date_trunc('month', p_mes_venc) + interval '1 month - 1 day'))::int)
  );
  v_data := public.fn_dia_resgate(v_venc);   -- 0050: não atravessa o mês

  select id into v_forn from public.fornecedores
   where nome = 'Banco Cooperativa Sicredi' limit 1;

  insert into public.transacoes_empresa
    (data, conta_contabil_cod, centro_custo_cod, tipo_despesa, obs_obra,
     forma_pgto, conta_bancaria_id, status, valor,
     fornecedor_id, fornecedor_nome, descricao, origem_planilha, observacao)
  values
    (v_data, '1.8', '1.8.1', 'sem', 'sem', 'sem',
     v_sic, 'a_resgatar', 0,
     v_forn, 'Banco Cooperativa Sicredi',
     'Resgate da Conta Investimento Invest - Fatura Cartão de Crédito ' ||
       substring(v_mes from 6 for 2) || '/' || substring(v_mes from 1 for 4),
     v_tag,
     'Resgate da fatura do cartão: soma os lançamentos de Cartão de Crédito do ' ||
     'Sicredi que foram para o banco juntos, com vencimento em ' ||
       substring(v_mes from 6 for 2) || '/' || substring(v_mes from 1 for 4) ||
     '. Programado para o dia útil anterior ao vencimento da fatura.')
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.fn_resgate_fatura_cartao_obter(date, text) is
  'Localiza (ou cria) o resgate CONFIRMADO da fatura do cartão Sicredi do mês, por lote de agendamento. Migrations 0048/0050/0053.';

create or replace function public.fn_resgate_fatura_cartao_obter(p_mes_venc date)
returns uuid
language sql
as $$
  select public.fn_resgate_fatura_cartao_obter(p_mes_venc, public.fn_resgate_lote())
$$;

-- ---------------------------------------------------------------------------
-- 4) O alvo de um título passa a olhar o STATUS
-- ---------------------------------------------------------------------------
create or replace function public.fn_resgate_alvo_do_titulo(
  p_forma  public.forma_pgto,
  p_venc   date,
  p_status public.status_aramburu,
  p_lote   text
)
returns uuid
language plpgsql
as $$
begin
  if p_venc is null then return null; end if;

  -- 🟡 Ainda é programação → linha única do mês.
  if public.fn_titulo_provisionado(p_status) then
    return public.fn_resgate_prov_mensal_obter(p_venc);
  end if;

  -- 🔴 Já foi para o banco → linha do agendamento.
  if p_forma = 'cartao_credito' then
    return public.fn_resgate_fatura_cartao_obter(p_venc, p_lote);
  end if;
  return public.fn_resgate_invest_obter(public.fn_dia_resgate(p_venc), p_lote);
end;
$$;

comment on function public.fn_resgate_alvo_do_titulo(public.forma_pgto, date, public.status_aramburu, text) is
  'Resgate que deve receber um título do Sicredi: mensal programado enquanto provisionado (0053), consolidado da fatura no cartão (0048) ou do agendamento do dia (0044/0050) depois que vai para o banco.';

-- A assinatura antiga (forma, venc) fica como compatibilidade, tratando o
-- título como já confirmado — é o que ela significava antes da 0053.
create or replace function public.fn_resgate_alvo_do_titulo(p_forma public.forma_pgto, p_venc date)
returns uuid
language sql
as $$
  select public.fn_resgate_alvo_do_titulo(p_forma, p_venc, 'a_pagar'::public.status_aramburu, public.fn_resgate_lote())
$$;

-- ---------------------------------------------------------------------------
-- 5) Recalc: o status da linha vem da FAMÍLIA dela, não dos títulos
-- ---------------------------------------------------------------------------
-- Antes (0044/0048): a linha virava A Resgatar assim que UM título saísse do
-- provisionado — que é exatamente o defeito que a Adri apontou. Agora cada
-- família tem seu status fixo: prov = 'resgate' (amarelo), diária/fatura =
-- 'a_resgatar' (vermelho). Resgatado continua congelando a linha.
create or replace function public.fn_resgate_invest_recalc(p_resgate_id uuid, p_validar boolean default true)
returns void
language plpgsql
as $$
declare
  v_resgate      public.transacoes_empresa%rowtype;
  v_total        numeric(15,2);
  v_eh_prog      boolean;
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
       or origem_planilha like 'auto:resgate_invest_fatura:%'
       or origem_planilha like 'auto:resgate_invest_prov:%')
   for update;
  if not found then return; end if;

  if v_resgate.status = 'resgatado' then return; end if;

  v_eh_prog := v_resgate.origem_planilha like 'auto:resgate_invest_prov:%';

  select coalesce(sum(-valor), 0)
    into v_total
    from public.transacoes_empresa
   where resgate_auto_id = p_resgate_id;

  if v_total <= 0 then
    delete from public.transacoes_empresa where id = p_resgate_id;
    return;
  end if;

  v_status_novo := case when v_eh_prog then 'resgate' else 'a_resgatar' end;

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
  'Recalcula um resgate automático do Invest a partir dos títulos vinculados. O status vem da família da linha: programada do mês fica Resgate (amarelo), agendamento fica A Resgatar (vermelho). Migrations 0044/0048/0053.';

-- ---------------------------------------------------------------------------
-- 6) Trigger de vínculo: migra o título quando ele sai do provisionado
-- ---------------------------------------------------------------------------
create or replace function public.tg_te_resgate_invest_link()
returns trigger
language plpgsql
as $$
declare
  v_sic            uuid;
  v_eh_driver      boolean;
  v_era_driver     boolean;
  v_status_resgate public.status_aramburu;
  v_alvo           uuid;
  v_prov_old       boolean;
  v_prov_new       boolean;
begin
  if pg_trigger_depth() > 1 then return new; end if;

  v_sic := public.fn_conta_sicredi_corrente();
  if v_sic is null then return new; end if;

  -- As próprias linhas de resgate (todas as famílias e o espelho) nunca são título.
  if new.origem_planilha like 'auto:resgate_invest%' then
    return new;
  end if;

  v_eh_driver := new.conta_bancaria_id = v_sic
             and new.valor < 0
             and new.status <> 'saldo_inicial'
             and not coalesce(new.dispensa_resgate, false);

  if tg_op = 'INSERT' then
    if v_eh_driver and public.fn_resgates_auto_sicredi_ativos() then
      new.resgate_auto_id := public.fn_resgate_alvo_do_titulo(
        new.forma_pgto, new.data, new.status, public.fn_resgate_lote());
    end if;
    return new;
  end if;

  -- UPDATE
  v_era_driver := old.conta_bancaria_id = v_sic
              and old.valor < 0
              and old.status <> 'saldo_inicial'
              and not coalesce(old.dispensa_resgate, false);

  if not v_eh_driver then
    -- Saiu do escopo (mudou de banco, virou entrada, ou foi marcado como pago
    -- pelo saldo da conta) → desvincula; o AFTER recalcula o resgate antigo.
    new.resgate_auto_id := null;
    return new;
  end if;

  if new.resgate_auto_id is null then
    if not v_era_driver and public.fn_resgates_auto_sicredi_ativos() then
      new.resgate_auto_id := public.fn_resgate_alvo_do_titulo(
        new.forma_pgto, new.data, new.status, public.fn_resgate_lote());
    end if;
    return new;
  end if;

  v_prov_old := public.fn_titulo_provisionado(old.status);
  v_prov_new := public.fn_titulo_provisionado(new.status);

  -- Muda de resgate quando muda o vencimento, a forma de pagamento OU quando
  -- o título sai da programação e vai para o banco (o caso novo da 0053).
  if new.data is distinct from old.data
     or new.forma_pgto is distinct from old.forma_pgto
     or v_prov_new is distinct from v_prov_old then

    select status into v_status_resgate
      from public.transacoes_empresa where id = new.resgate_auto_id;

    if v_status_resgate is null then
      new.resgate_auto_id := public.fn_resgate_alvo_do_titulo(
        new.forma_pgto, new.data, new.status, public.fn_resgate_lote());
    elsif v_status_resgate <> 'resgatado' then
      v_alvo := public.fn_resgate_alvo_do_titulo(
        new.forma_pgto, new.data, new.status, public.fn_resgate_lote());
      if v_alvo is distinct from new.resgate_auto_id then
        new.resgate_auto_id := v_alvo;
      end if;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.tg_te_resgate_invest_link() is
  'Vincula títulos do Sicredi ao resgate certo: mensal programado enquanto provisionado, do agendamento depois que vai para o banco (0053); fatura no cartão (0048); ignora os pagos pelo saldo da conta (0049).';

-- ---------------------------------------------------------------------------
-- 7) Reparo do que já está na base
-- ---------------------------------------------------------------------------
-- Tira os títulos provisionados de dentro das linhas vermelhas e joga na linha
-- mensal do mês deles. O AFTER de recalc encolhe a linha antiga (e apaga se
-- ficar vazia) e enche a mensal. Linhas já Resgatadas não são tocadas.
do $$
declare
  r      record;
  v_alvo uuid;
  v_qtd  int := 0;
begin
  if public.fn_conta_sicredi_corrente() is null then
    raise notice '0053: conta Sicredi corrente não encontrada — reparo pulado.';
    return;
  end if;

  -- Durante o reparo o dinheiro só troca de linha; a validação de saldo do
  -- Invest atrapalharia no meio do caminho.
  perform set_config('arambi.invest_sem_validacao', 'on', true);

  for r in
    select t.id, t.data
      from public.transacoes_empresa t
      join public.transacoes_empresa g on g.id = t.resgate_auto_id
     where public.fn_titulo_provisionado(t.status)
       and g.status in ('resgate', 'a_resgatar')
       and g.origem_planilha not like 'auto:resgate_invest_prov:%'
     order by t.data
  loop
    v_alvo := public.fn_resgate_prov_mensal_obter(r.data);
    if v_alvo is not null then
      update public.transacoes_empresa
         set resgate_auto_id = v_alvo
       where id = r.id;
      v_qtd := v_qtd + 1;
    end if;
  end loop;

  raise notice '0053: % títulos provisionados movidos para a linha mensal.', v_qtd;
end;
$$;

-- Sobra do modelo antigo: linha de agendamento que ficou sem nenhum título
-- (todos os seus títulos eram provisionados e foram para a mensal) já foi
-- apagada pelo recalc. E linha amarela que só tinha confirmados não existe,
-- porque a família mensal nasce agora.

-- ---------------------------------------------------------------------------
-- 8) Conferência final: nenhum resgate pendente pode misturar as duas coisas
-- ---------------------------------------------------------------------------
do $$
declare v_mistos int;
begin
  select count(*) into v_mistos
    from (
      select g.id
        from public.transacoes_empresa g
        join public.transacoes_empresa t on t.resgate_auto_id = g.id
       where g.status in ('resgate', 'a_resgatar')
         and g.origem_planilha like 'auto:resgate_invest%'
       group by g.id, g.origem_planilha
      having bool_or(public.fn_titulo_provisionado(t.status))
         and bool_or(not public.fn_titulo_provisionado(t.status))
    ) x;

  if v_mistos > 0 then
    raise warning '0053: ainda existem % resgates misturando provisionado e confirmado — conferir.', v_mistos;
  else
    raise notice '0053: nenhum resgate pendente mistura provisionado e confirmado.';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- ROLLBACK:
--   -- 1) devolver os provisionados para as linhas diárias/fatura:
--   --    update transacoes_empresa t set resgate_auto_id =
--   --      public.fn_resgate_alvo_do_titulo(t.forma_pgto, t.data)
--   --    from transacoes_empresa g
--   --    where g.id = t.resgate_auto_id
--   --      and g.origem_planilha like 'auto:resgate_invest_prov:%';
--   -- 2) restaurar fn_resgate_invest_recalc, tg_te_resgate_invest_link,
--   --    fn_resgate_alvo_do_titulo, fn_resgate_invest_obter e
--   --    fn_resgate_fatura_cartao_obter das migrations 0048/0049/0050
--   drop function if exists public.fn_resgate_prov_mensal_obter(date);
--   drop function if exists public.fn_resgate_alvo_do_titulo(public.forma_pgto, date, public.status_aramburu, text);
--   drop function if exists public.fn_resgate_invest_obter(date, text);
--   drop function if exists public.fn_resgate_fatura_cartao_obter(date, text);
--   drop function if exists public.fn_titulo_provisionado(public.status_aramburu);
--   drop function if exists public.fn_resgate_lote();
--   drop function if exists public.fn_fim_do_mes(date);
-- ----------------------------------------------------------------------------
