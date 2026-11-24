-- ============================================================================
-- 0072 — Banco da linha de saldo DV configurável (CORA → SICREDI)
-- ============================================================================
-- Pedido da Adri (WhatsApp, 24-nov-2026): ela estava trocando uma a uma, de CORA
-- para SICREDI, as linhas "Despesa Variável — Saldo do mês" (dv_auto, status
-- Provisionado DV), e pediu o campo em Configurações → Automações → Parâmetros do
-- Financeiro "para alterar o banco". Confirmou que, daqui pra frente, a linha de
-- cada mês deve nascer no SICREDI, como a DL (0069).
--
--   1) Chave dv_conta_bancaria (id da conta em Bancos; vazio = CORA, como era).
--      Já sai gravada com a corrente Sicredi, que foi o que ela pediu.
--   2) fn_dv_gerar_linha cria a linha nessa conta (era o CORA fixo).
--   3) Trocar a chave move as linhas de saldo DV ainda provisionadas, do mês
--      atual em diante, para a conta nova. Meses anteriores ficam como estão.
--   4) fn_dv_sync_linha religa o resgate. Na corrente Sicredi o Provisionado DV
--      entra na linha amarela mensal (0053). O sync roda dentro do gatilho
--      tg_te_dv_sync, onde os gatilhos de vínculo/recálculo do resgate saem pela
--      guarda pg_trigger_depth() > 1. Sem isto, o resgate mensal ficava com o
--      saldo DV antigo quando uma despesa variável era lançada (mesmo caso da DL
--      na 0069).
--
-- Depende da 0069/0070 (fn_resgate_religar_titulo) e da 0066 (papéis). Idempotente.

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'fn_resgate_religar_titulo') then
    raise exception 'Aplique a 0069_dl_sicredi_contraparte_aplicacao_auto.sql antes da 0072.';
  end if;
end $$;

-- ###########################################################################
-- 1) Conta da linha de saldo DV
-- ###########################################################################
insert into public.app_config (chave, valor, descricao) values
  ('dv_conta_bancaria', '',
   'Conta bancária da linha automática "Despesa Variável — Saldo do mês" (id em Bancos). Trocar move as linhas de saldo DV ainda provisionadas, do mês atual em diante. Vazio = CORA (como era até nov-2026). Migration 0072.')
on conflict (chave) do nothing;

create or replace function public.fn_conta_dv()
returns uuid language sql stable as $$
  select coalesce(
    (select c.id
       from public.app_config a
       join public.contas_bancarias_empresa c on c.id::text = lower(btrim(a.valor))
      where a.chave = 'dv_conta_bancaria' and c.ativa = true
      limit 1),
    (select id from public.contas_bancarias_empresa
      where ativa = true and banco ilike '%cora%'
      order by ordem nulls last limit 1))
$$;

comment on function public.fn_conta_dv() is
  'Conta da linha de saldo DV: a configurada em dv_conta_bancaria (Configurações → Automações), senão o CORA. Migration 0072.';

-- ###########################################################################
-- 2) Sync da linha — corpo da 0055 + religar o resgate
-- ###########################################################################
create or replace function public.fn_dv_sync_linha(p_mes text)
returns void
language plpgsql
as $$
declare
  v_tag     text := 'dv_auto:' || p_mes;
  v_id      uuid;
  v_desc    text;
  v_saldo   numeric(15,2);
  v_obs     text;
  v_resgate uuid;
begin
  if p_mes is null then return; end if;

  select id, descricao into v_id, v_desc
    from public.transacoes_empresa where origem_planilha = v_tag limit 1;
  if v_id is null then return; end if;

  v_saldo := public.fn_dv_limite_mensal() - public.fn_dv_utilizado(p_mes);

  if v_saldo <= 0 then
    -- Estourou o teto: não há saldo nenhum a programar no mês.
    if v_desc = public.fn_dv_descricao_auto() then
      -- Linha criada pelo sistema → some (mesma regra do Provisionado DL).
      -- O resgate mensal que ela alimentava encolhe junto (0072).
      delete from public.transacoes_empresa where id = v_id
      returning resgate_auto_id into v_resgate;
      if v_resgate is not null then
        perform public.fn_resgate_invest_recalc(v_resgate, false);
      end if;
    else
      -- Linha ADOTADA: é dela. Zera o valor, mas não apaga o lançamento.
      update public.transacoes_empresa
         set valor = 0,
             observacao = 'Saldo automático: a competência já passou do teto de ' ||
                          to_char(public.fn_dv_limite_mensal(), 'FM999G999G990D00') ||
                          ' em ' || to_char(-v_saldo, 'FM999G999G990D00') ||
                          ', então não há saldo a programar. Não editar o valor à mão.'
       where id = v_id and valor is distinct from 0;
      perform public.fn_resgate_religar_titulo(v_id);   -- 0072: valor 0 sai do resgate
    end if;
    return;
  end if;

  v_obs := 'Linha mantida automaticamente: teto de ' ||
           to_char(public.fn_dv_limite_mensal(), 'FM999G999G990D00') ||
           ' menos ' || to_char(public.fn_dv_utilizado(p_mes), 'FM999G999G990D00') ||
           ' já lançados como Despesa Variável no mês. Não editar o valor à mão.';

  update public.transacoes_empresa
     set valor = -v_saldo,
         observacao = v_obs
   where id = v_id
     and (valor is distinct from -v_saldo or observacao is distinct from v_obs);

  perform public.fn_resgate_religar_titulo(v_id);   -- 0072
exception when others then
  -- Nunca bloquear o lançamento da despesa por causa da linha de saldo.
  null;
end;
$$;

comment on function public.fn_dv_sync_linha(text) is
  'Mantém a linha Provisionado DV do mês igual ao saldo do teto e religa o resgate mensal (0072). Sem saldo, a linha criada pelo sistema é apagada e a adotada é zerada. Migrations 0054/0055/0072.';

-- ###########################################################################
-- 3) Gerar a linha — corpo da 0066 + conta configurável
-- ###########################################################################
create or replace function public.fn_dv_gerar_linha(p_mes text)
returns uuid
language plpgsql
as $$
declare
  v_tag    text := 'dv_auto:' || p_mes;
  v_id     uuid;
  v_qtd    int;
  v_banco  uuid;
  v_conta  text := public.fn_cod('outras_saidas');
  v_centro text := public.fn_cod('dv_saldo');
begin
  if p_mes is null or p_mes !~ '^\d{4}-\d{2}$' then
    raise exception 'Competência inválida (esperado AAAA-MM): %', p_mes;
  end if;

  select id into v_id from public.transacoes_empresa where origem_planilha = v_tag limit 1;

  if v_id is null then
    -- Adota a linha Provisionado DV que o mês já tiver — inclusive a importada
    -- da planilha (0055). Só não adota o que já é de outra automação.
    -- (array_agg(...))[1] e não min(id): o Postgres não tem min/max para uuid.
    select count(*), (array_agg(id order by created_at))[1]
      into v_qtd, v_id
      from public.transacoes_empresa
     where mes_referencia = p_mes
       and status = 'provisionado_dv'
       and not public.fn_origem_de_outra_automacao(origem_planilha);

    -- Com duas ou mais, o sistema não escolhe: escolher errado significaria
    -- passar a sobrescrever o valor da linha errada todo mês, em silêncio.
    if v_qtd > 1 then
      raise exception
        'A competência % tem % lançamentos com status Provisionado DV. Deixe apenas um (exclua ou troque o status dos demais) e clique de novo — o sistema não escolhe sozinho qual deles passa a ser a linha automática do saldo.',
        p_mes, v_qtd;
    end if;

    if v_qtd = 1 then
      update public.transacoes_empresa set origem_planilha = v_tag where id = v_id;
    else
      v_id := null;
    end if;
  end if;

  if v_id is null then
    if not exists (select 1 from public.classificacao_financeira where codigo = v_centro) then
      -- Plano de contas sem o centro do papel dv_saldo → cai em qualquer centro de saída existente.
      select codigo, parent_codigo into v_centro, v_conta
        from public.classificacao_financeira
       where nivel = 3 and natureza = 'saida' and ativo
       order by ordem nulls last, codigo
       limit 1;
      if v_centro is null then
        raise exception 'Plano de contas sem nenhum centro de custo de saída — cadastre em Configurações → Plano de Contas.';
      end if;
    end if;

    v_banco := public.fn_conta_dv();   -- 0072 (era o CORA fixo)

    insert into public.transacoes_empresa (
      data, conta_contabil_cod, centro_custo_cod, tipo_despesa,
      descricao, obs_obra, forma_pgto, conta_bancaria_id,
      status, valor, observacao, origem_planilha
    ) values (
      public.fn_fim_do_mes(to_date(p_mes || '-01', 'YYYY-MM-DD')),
      v_conta, v_centro, 'variavel',
      public.fn_dv_descricao_auto(),
      'sem', 'sem', v_banco,
      'provisionado_dv', -public.fn_dv_limite_mensal(),
      'Linha mantida automaticamente pelo saldo do teto de Despesa Variável.',
      v_tag
    )
    returning id into v_id;
  end if;

  perform public.fn_dv_sync_linha(p_mes);

  -- A sincronização pode ter apagado a linha (mês sem saldo). Devolver o id de
  -- uma linha que não existe mais faria a tela dizer "lançado" para nada.
  select id into v_id from public.transacoes_empresa where id = v_id;
  return v_id;
end;
$$;

comment on function public.fn_dv_gerar_linha(text) is
  'Cria (no centro do papel dv_saldo, na conta de fn_conta_dv) ou ADOTA a linha Provisionado DV do mês (inclusive a importada da planilha — 0055) e a mantém igual ao saldo do teto. Recusa-se a escolher quando houver mais de uma candidata no mês. Migrations 0054/0055/0063/0066/0072.';

-- ###########################################################################
-- 4) Trocar a conta move as linhas em aberto
-- ###########################################################################
-- Do mês atual (horário de Brasília) em diante, só as ainda Provisionado DV.
-- SECURITY DEFINER: quem edita Configurações pode não editar o Financeiro, e a
-- RLS de transacoes_empresa faria o UPDATE mover zero linhas, em silêncio.
-- O UPDATE roda dentro deste gatilho (profundidade 2), então o vínculo do
-- resgate é refeito à mão, linha a linha.
create or replace function public.fn_dv_aplicar_conta()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_banco uuid := public.fn_conta_dv();
  v_mes   text := to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM');
  v_id    uuid;
  v_n     integer := 0;
begin
  if v_banco is null then return 0; end if;
  for v_id in
    update public.transacoes_empresa
       set conta_bancaria_id = v_banco
     where origem_planilha like 'dv_auto:%'
       and status = 'provisionado_dv'
       and mes_referencia >= v_mes
       and conta_bancaria_id is distinct from v_banco
    returning id
  loop
    perform public.fn_resgate_religar_titulo(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

comment on function public.fn_dv_aplicar_conta() is
  'Leva as linhas de saldo DV (dv_auto) ainda Provisionado DV, do mês atual em diante, para a conta de fn_conta_dv e religa o resgate de cada uma. Devolve quantas mudaram. Migration 0072.';

create or replace function public.tg_app_config_dv_conta()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.fn_dv_aplicar_conta();
  return null;
end;
$$;

drop trigger if exists tg_app_config_dv_conta on public.app_config;
create trigger tg_app_config_dv_conta
  after insert or update of valor on public.app_config
  for each row
  when (new.chave = 'dv_conta_bancaria')
  execute function public.tg_app_config_dv_conta();

-- Só os gatilhos chamam: a tela troca a conta gravando a chave.
revoke all on function public.fn_dv_aplicar_conta() from public, anon, authenticated;

-- ###########################################################################
-- 5) Pedido da Adri: SICREDI. Só grava se ainda estiver vazia. O gatilho acima
--    move as linhas em aberto e religa o resgate de cada uma.
-- ###########################################################################
update public.app_config
   set valor = public.fn_conta_sicredi_corrente()::text, updated_at = now()
 where chave = 'dv_conta_bancaria'
   and coalesce(btrim(valor), '') = ''
   and public.fn_conta_sicredi_corrente() is not null;

-- ###########################################################################
-- 6) Reparo: religa as linhas DV em aberto que ela já tinha movido à mão para o
--    SICREDI (jan–dez/2027 em produção, 24-nov). Se uma despesa variável foi
--    lançada antes desta migration, o resgate mensal ficou com o saldo antigo;
--    o recálculo acerta. Idempotente.
-- ###########################################################################
do $$
declare v_id uuid;
begin
  for v_id in
    select id from public.transacoes_empresa
     where origem_planilha like 'dv_auto:%'
       and status = 'provisionado_dv'
       and mes_referencia >= to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM')
  loop
    perform public.fn_resgate_religar_titulo(v_id);
  end loop;
end $$;
