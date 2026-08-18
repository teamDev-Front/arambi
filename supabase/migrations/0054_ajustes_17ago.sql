-- ============================================================================
-- 0054 — Pacote de ajustes 17-ago-2026 (doc "Sistema AramBI - dia 17.08")
-- ============================================================================
-- Três coisas que só o banco resolve (o resto do pacote é tela):
--
--   1. APLICAÇÃO NÃO GERA RESGATE.
--      "quando criado uma APLICAÇÃO, o sistema não deve gerar um RESGATE
--       (Sicredi ou Sicredi Invest). Da mesma forma, não deve exibir a mensagem
--       de saldo insuficiente na conta de investimento, pois essa operação
--       representa apenas uma transferência/aplicação de recursos para a conta
--       de investimento, e não uma saída financeira ou despesa."
--      Hoje o gatilho da 0053 olha só "Sicredi + valor negativo" e trata a
--      aplicação como se fosse uma conta a pagar — cria um resgate do Invest
--      para cobrir dinheiro que está justamente INDO para o Invest, e ainda
--      barra a gravação por saldo insuficiente. Aqui a família de status da
--      aplicação (A aplicar / Aplicação / Aplicado) sai do escopo do resgate.
--
--   2. LINHA AUTOMÁTICA DO SALDO DE DESPESA VARIÁVEL.
--      "quando eu lançar esse valor de 20k com o status PROVISIONADO DV, o
--       sistema entende que esse é o limite disponível e vai debitando
--       automático desse valor conforme as despesas variáveis forem sendo
--       lançadas?"
--      Até agora, NÃO: a linha era digitada à mão e o card do Financeiro só
--      calculava o saldo por fora. Passa a existir a linha `dv_auto:<mês>`,
--      que o banco mantém igual ao SALDO do mês (limite − utilizado), do mesmo
--      jeito que a `dl_auto:` já faz com a Distribuição de Lucro. Cada despesa
--      variável nova debita a linha sozinha; um lançamento POSITIVO (devolução,
--      reembolso) credita de volta — o pedido "somar/creditar a DV quando
--      existir um lançamento positivo".
--      É opt-in: sem a linha criada, nada muda. A tela oferece o botão.
--
--   3. LIXEIRA (30 dias).
--      "caso ela em algum lançamento exclua por acidente e perceba
--       posteriormente que não deveria ter excluído, o item poderá ficar
--       armazenado na lixeira para possível recuperação."
--      Arquivo por gatilho de DELETE, e não coluna `deleted_at`: nenhuma query
--      existente muda de comportamento, e todo caminho de exclusão (tela,
--      lote, script, SQL manual) cai na lixeira do mesmo jeito. Exclusões
--      feitas POR OUTRO GATILHO (o resgate que encolhe, o SOMASE que apaga a
--      linha do mês) não entram: são consequência, não decisão de ninguém.
--
-- Aplicar após a 0053.

-- ###########################################################################
-- 1) Aplicação não gera resgate do Invest
-- ###########################################################################

-- A família de status da APLICAÇÃO: dinheiro saindo da corrente PARA um
-- investimento. Não é despesa e não precisa de resgate para ser coberta.
create or replace function public.fn_titulo_aplicacao(p_status public.status_aramburu)
returns boolean
language sql
immutable
as $$
  select p_status in ('a_aplicar', 'aplicacao', 'aplicado')
$$;

comment on function public.fn_titulo_aplicacao(public.status_aramburu) is
  'true = o lançamento é uma APLICAÇÃO (transferência da conta corrente para investimento), não uma despesa. Fica fora do resgate automático do Invest. Migration 0054.';

-- Um único ponto de verdade para "este lançamento puxa resgate do Invest?".
-- Estava replicado em três lugares dentro do gatilho (INSERT, era-driver,
-- é-driver), que foi como a aplicação passou despercebida.
create or replace function public.fn_titulo_puxa_resgate(
  p_conta_bancaria_id uuid,
  p_valor             numeric,
  p_status            public.status_aramburu,
  p_dispensa_resgate  boolean
)
returns boolean
language sql
stable
as $$
  select p_conta_bancaria_id is not null
     and p_conta_bancaria_id = public.fn_conta_sicredi_corrente()
     and p_valor < 0
     and p_status <> 'saldo_inicial'
     and not public.fn_titulo_aplicacao(p_status)       -- 0054
     and not coalesce(p_dispensa_resgate, false)        -- 0049
$$;

comment on function public.fn_titulo_puxa_resgate(uuid, numeric, public.status_aramburu, boolean) is
  'Regra única do que vira título de um resgate automático do Invest: saída da corrente Sicredi que não seja saldo inicial, não seja aplicação (0054) e não esteja marcada como paga pelo saldo da conta (0049). Migration 0054.';

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

  v_eh_driver := public.fn_titulo_puxa_resgate(
    new.conta_bancaria_id, new.valor, new.status, new.dispensa_resgate);

  if tg_op = 'INSERT' then
    if v_eh_driver and public.fn_resgates_auto_sicredi_ativos() then
      new.resgate_auto_id := public.fn_resgate_alvo_do_titulo(
        new.forma_pgto, new.data, new.status, public.fn_resgate_lote());
    end if;
    return new;
  end if;

  -- UPDATE
  v_era_driver := public.fn_titulo_puxa_resgate(
    old.conta_bancaria_id, old.valor, old.status, old.dispensa_resgate);

  if not v_eh_driver then
    -- Saiu do escopo (mudou de banco, virou entrada, virou APLICAÇÃO, ou foi
    -- marcado como pago pelo saldo da conta) → desvincula; o AFTER recalcula o
    -- resgate antigo, que encolhe (ou some, se ficar sem nenhum título).
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
  -- o título sai da programação e vai para o banco (0053).
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
  'Vincula títulos do Sicredi ao resgate certo: mensal programado enquanto provisionado, do agendamento depois que vai para o banco (0053); fatura no cartão (0048); fora do escopo os pagos pelo saldo da conta (0049) e as APLICAÇÕES (0054).';

-- Reparo: solta as aplicações que já estavam penduradas em algum resgate. O
-- AFTER de recalc encolhe a linha e a apaga se ela ficar sem nenhum título.
do $$
declare v_qtd int;
begin
  if public.fn_conta_sicredi_corrente() is null then
    raise notice '0054: conta Sicredi corrente não encontrada — reparo das aplicações pulado.';
    return;
  end if;

  -- O dinheiro só está saindo de um resgate que não deveria existir; a
  -- validação de saldo do Invest atrapalharia no meio do caminho.
  perform set_config('arambi.invest_sem_validacao', 'on', true);

  with soltos as (
    update public.transacoes_empresa
       set resgate_auto_id = null
     where resgate_auto_id is not null
       and public.fn_titulo_aplicacao(status)
    returning 1
  )
  select count(*) into v_qtd from soltos;

  raise notice '0054: % aplicações desvinculadas de resgates automáticos.', v_qtd;
end;
$$;

-- ###########################################################################
-- 2) Linha automática do saldo de Despesa Variável (dv_auto:<mês>)
-- ###########################################################################

-- Teto mensal — mesma chave que a tela de Configurações → Automações edita.
create or replace function public.fn_dv_limite_mensal()
returns numeric
language sql
stable
as $$
  select coalesce(
    nullif(regexp_replace((select valor from public.app_config
                            where chave = 'limite_despesa_variavel_mensal'), '[^0-9.\-]', '', 'g'), '')::numeric,
    20000)
$$;

comment on function public.fn_dv_limite_mensal() is
  'Teto mensal de Despesas Variáveis (app_config.limite_despesa_variavel_mensal, padrão 20.000). Migration 0054.';

-- Utilizado do mês. Espelha exatamente a fórmula da planilha da Adriane:
--   SOMASES(valor; tipo; "Despesas Variáveis"; status; {A pagar|Pago|Provisionado})
-- com duas leituras que valem registrar:
--   • 'provisionado_dv' NÃO entra: aquela linha É o saldo, somá-la zeraria tudo;
--   • os status de ENTRADA entram com o sinal deles, então uma devolução
--     (valor positivo, "Recebido") CREDITA o mês de volta — pedido 17-ago:
--     "somar/creditar a DV quando existir um lançamento positivo".
create or replace function public.fn_dv_utilizado(p_mes text)
returns numeric
language sql
stable
as $$
  select coalesce(sum(-valor), 0)::numeric(15,2)
    from public.transacoes_empresa
   where mes_referencia = p_mes
     and tipo_despesa = 'variavel'
     and status in ('a_pagar', 'pago', 'provisionado', 'recebido', 'a_receber')
$$;

comment on function public.fn_dv_utilizado(text) is
  'Quanto do teto de Despesa Variável o mês já consumiu (positivo). Lançamentos positivos de devolução/reembolso creditam de volta. A linha Provisionado DV fica de fora — ela é o próprio saldo. Migration 0054.';

create or replace function public.fn_dv_descricao_auto()
returns text
language sql
immutable
as $$ select 'Despesa Variável — Saldo do mês (automático)'::text $$;

-- Mantém a linha do mês igual ao saldo restante. Nunca cria nada por conta
-- própria: se a linha `dv_auto:<mês>` não existe, a função sai calada (a
-- criação é um ato explícito da tela — fn_dv_gerar_linha).
create or replace function public.fn_dv_sync_linha(p_mes text)
returns void
language plpgsql
as $$
declare
  v_tag    text := 'dv_auto:' || p_mes;
  v_saldo  numeric(15,2);
  v_obs    text;
begin
  if p_mes is null then return; end if;
  if not exists (select 1 from public.transacoes_empresa where origem_planilha = v_tag) then
    return;
  end if;

  v_saldo := public.fn_dv_limite_mensal() - public.fn_dv_utilizado(p_mes);

  -- Estourou o teto: a linha vai a zero (não pode virar ENTRADA — isso
  -- inventaria dinheiro no fluxo). O card do Financeiro mostra o negativo real.
  v_obs := 'Linha mantida automaticamente: teto de ' ||
           to_char(public.fn_dv_limite_mensal(), 'FM999G999G990D00') ||
           ' menos ' || to_char(public.fn_dv_utilizado(p_mes), 'FM999G999G990D00') ||
           ' já lançados como Despesa Variável no mês. Não editar o valor à mão.' ||
           case when v_saldo < 0
                then ' ATENÇÃO: o mês estourou o teto em ' ||
                     to_char(-v_saldo, 'FM999G999G990D00') || '.'
                else '' end;

  update public.transacoes_empresa
     set valor = -greatest(v_saldo, 0),
         observacao = v_obs
   where origem_planilha = v_tag
     and (valor is distinct from -greatest(v_saldo, 0) or observacao is distinct from v_obs);
exception when others then
  -- Nunca bloquear o lançamento da despesa por causa da linha de saldo.
  null;
end;
$$;

comment on function public.fn_dv_sync_linha(text) is
  'Mantém a linha Provisionado DV do mês (etiqueta dv_auto:<mês>) igual ao saldo restante do teto. Não cria a linha — só mantém a que existir. Migration 0054.';

-- Cria (ou readota) a linha do mês e já sincroniza. É o que o botão da tela
-- chama. Idempotente: rodar de novo só atualiza.
create or replace function public.fn_dv_gerar_linha(p_mes text)
returns uuid
language plpgsql
as $$
declare
  v_tag   text := 'dv_auto:' || p_mes;
  v_id    uuid;
  v_banco uuid;
  v_conta text := '2.9';
  v_centro text := '2.9.3';
begin
  if p_mes is null or p_mes !~ '^\d{4}-\d{2}$' then
    raise exception 'Competência inválida (esperado AAAA-MM): %', p_mes;
  end if;

  select id into v_id from public.transacoes_empresa where origem_planilha = v_tag limit 1;

  if v_id is null then
    -- Readota a linha que a Lola já tinha digitado à mão no mês, se houver
    -- exatamente uma — evita a linha duplicada do "20k" na virada.
    select id into v_id
      from public.transacoes_empresa
     where mes_referencia = p_mes
       and status = 'provisionado_dv'
       and origem_planilha is null
     limit 1;

    if v_id is not null then
      update public.transacoes_empresa set origem_planilha = v_tag where id = v_id;
    end if;
  end if;

  if v_id is null then
    if not exists (select 1 from public.classificacao_financeira where codigo = v_centro) then
      -- Plano de contas sem 2.9.3 → cai em qualquer centro de saída existente.
      select codigo, parent_codigo into v_centro, v_conta
        from public.classificacao_financeira
       where nivel = 3 and natureza = 'saida' and ativo
       order by ordem nulls last, codigo
       limit 1;
      if v_centro is null then
        raise exception 'Plano de contas sem nenhum centro de custo de saída — cadastre em Configurações → Plano de Contas.';
      end if;
    end if;

    select id into v_banco
      from public.contas_bancarias_empresa
     where ativa = true and banco ilike '%cora%'
     order by ordem nulls last limit 1;

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
  return v_id;
end;
$$;

comment on function public.fn_dv_gerar_linha(text) is
  'Cria (ou readota) a linha Provisionado DV automática de um mês e sincroniza com o saldo do teto. Idempotente — alimenta o botão do card Despesa Variável. Migration 0054.';

-- Gatilho: qualquer movimento de Despesa Variável no mês re-sincroniza a linha.
create or replace function public.tg_te_dv_sync()
returns trigger
language plpgsql
as $$
declare
  v_mes_old text;
  v_mes_new text;
begin
  if pg_trigger_depth() > 1 then return null; end if;

  if tg_op <> 'INSERT' and old.tipo_despesa = 'variavel' then v_mes_old := old.mes_referencia; end if;
  if tg_op <> 'DELETE' and new.tipo_despesa = 'variavel' then v_mes_new := new.mes_referencia; end if;

  if v_mes_old is not null then perform public.fn_dv_sync_linha(v_mes_old); end if;
  if v_mes_new is not null and v_mes_new is distinct from v_mes_old then
    perform public.fn_dv_sync_linha(v_mes_new);
  end if;
  return null;
end;
$$;

comment on function public.tg_te_dv_sync() is
  'AFTER de transacoes_empresa: mantém a linha dv_auto:<mês> igual ao saldo do teto de Despesa Variável. Migration 0054.';

drop trigger if exists tg_te_dv_sync on public.transacoes_empresa;
create trigger tg_te_dv_sync
  after insert or update or delete on public.transacoes_empresa
  for each row execute function public.tg_te_dv_sync();

-- ###########################################################################
-- 3) Lixeira (recuperação por 30 dias)
-- ###########################################################################

insert into public.app_config (chave, valor, descricao)
values ('lixeira_retencao_dias', '30',
        'Dias que um item excluído fica na Lixeira antes do expurgo definitivo.')
on conflict (chave) do nothing;

create table if not exists public.lixeira (
  id            uuid primary key default gen_random_uuid(),
  tabela        text not null,
  registro_id   uuid not null,
  dados         jsonb not null,
  resumo        text,                 -- linha legível na tela (descrição · valor · data)
  excluido_em   timestamptz not null default now(),
  excluido_por  uuid references public.users(id) on delete set null,
  expira_em     timestamptz not null,
  restaurado_em timestamptz
);

comment on table public.lixeira is
  'Itens excluídos, guardados por N dias (app_config.lixeira_retencao_dias) para recuperação. Preenchida por gatilho de DELETE — nenhuma query de leitura do sistema precisou mudar. Migration 0054.';

create index if not exists idx_lixeira_excluido_em on public.lixeira (excluido_em desc);
create index if not exists idx_lixeira_tabela      on public.lixeira (tabela);
create index if not exists idx_lixeira_registro    on public.lixeira (registro_id);

alter table public.lixeira enable row level security;

drop policy if exists lixeira_select on public.lixeira;
create policy lixeira_select on public.lixeira
  for select using (public.fn_my_role() in ('admin', 'editor', 'viewer'));

drop policy if exists lixeira_write on public.lixeira;
create policy lixeira_write on public.lixeira
  for all using (public.fn_can_write()) with check (public.fn_can_write());

-- Quais tabelas a lixeira cobre. Acrescentar aqui + criar o gatilho embaixo.
create or replace function public.fn_lixeira_tabelas()
returns text[]
language sql
immutable
as $$ select array['transacoes_empresa', 'transacoes_socio', 'vendas_provisionadas'] $$;

-- Frase curta que a tela mostra sem precisar abrir o JSON.
create or replace function public.fn_lixeira_resumo(p_tabela text, p_dados jsonb)
returns text
language sql
immutable
as $$
  select case p_tabela
    when 'transacoes_empresa' then
      coalesce(nullif(p_dados->>'descricao', ''), p_dados->>'fornecedor_nome', 'Lançamento')
      || ' · ' || coalesce(p_dados->>'valor', '?') || ' · venc. ' || coalesce(p_dados->>'data', '?')
    when 'transacoes_socio' then
      coalesce(nullif(p_dados->>'descricao', ''), 'Lançamento detalhado')
      || ' · ' || coalesce(p_dados->>'valor', '?') || ' · comp. ' || coalesce(p_dados->>'data', '?')
    when 'vendas_provisionadas' then
      'Venda ' || coalesce(p_dados->>'cultura', '') || ' safra ' || coalesce(p_dados->>'safra', '')
      || ' · ' || coalesce(p_dados->>'comprador', '') || ' · ' || coalesce(p_dados->>'kg', '?') || ' kg'
    else p_tabela || ' ' || coalesce(p_dados->>'id', '')
  end
$$;

-- O gatilho é SECURITY DEFINER: o arquivamento não pode depender da RLS de
-- quem apagou, senão a linha some sem cópia e a lixeira mente por omissão.
create or replace function public.tg_lixeira_arquivar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dados jsonb := to_jsonb(old);
  v_dias  int;
  v_uid   uuid;
begin
  -- Exclusão em cascata de OUTRO gatilho (o resgate que ficou vazio, a linha
  -- dl_auto/dv_auto do mês) não é decisão de ninguém — não vai para a lixeira.
  if pg_trigger_depth() > 1 then return old; end if;

  -- Linhas automáticas também não: elas voltam sozinhas quando a origem volta.
  if coalesce(v_dados->>'origem_planilha', '') ~ '^(auto:|dl_auto:|dv_auto:)' then
    return old;
  end if;

  v_dias := coalesce(nullif(regexp_replace(
              (select valor from public.app_config where chave = 'lixeira_retencao_dias'),
              '[^0-9]', '', 'g'), '')::int, 30);

  begin v_uid := auth.uid(); exception when others then v_uid := null; end;

  insert into public.lixeira (tabela, registro_id, dados, resumo, excluido_por, expira_em)
  values (tg_table_name, old.id, v_dados,
          public.fn_lixeira_resumo(tg_table_name, v_dados),
          v_uid, now() + make_interval(days => v_dias));

  return old;
exception when others then
  -- A lixeira jamais impede uma exclusão pedida.
  return old;
end;
$$;

comment on function public.tg_lixeira_arquivar() is
  'BEFORE DELETE: copia a linha para public.lixeira. Ignora exclusões em cascata de outros gatilhos e linhas automáticas. Migration 0054.';

drop trigger if exists tg_te_lixeira on public.transacoes_empresa;
create trigger tg_te_lixeira before delete on public.transacoes_empresa
  for each row execute function public.tg_lixeira_arquivar();

drop trigger if exists tg_ts_lixeira on public.transacoes_socio;
create trigger tg_ts_lixeira before delete on public.transacoes_socio
  for each row execute function public.tg_lixeira_arquivar();

drop trigger if exists tg_vp_lixeira on public.vendas_provisionadas;
create trigger tg_vp_lixeira before delete on public.vendas_provisionadas
  for each row execute function public.tg_lixeira_arquivar();

-- View da tela: esconde o que já voltou (pelo botão ou pelo "Desfazer" de 8s,
-- que reinsere a linha com o mesmo id) e o que já expirou.
create or replace view public.v_lixeira as
select l.id,
       l.tabela,
       l.registro_id,
       l.resumo,
       l.dados,
       l.excluido_em,
       l.expira_em,
       greatest(0, ceil(extract(epoch from (l.expira_em - now())) / 86400))::int as dias_restantes,
       coalesce(u.full_name, u.email::text) as excluido_por_nome
  from public.lixeira l
  left join public.users u on u.id = l.excluido_por
 where l.restaurado_em is null
   and l.expira_em > now()
   and not exists (
     select 1 from public.transacoes_empresa   t where l.tabela = 'transacoes_empresa'   and t.id = l.registro_id
     union all
     select 1 from public.transacoes_socio     s where l.tabela = 'transacoes_socio'     and s.id = l.registro_id
     union all
     select 1 from public.vendas_provisionadas v where l.tabela = 'vendas_provisionadas' and v.id = l.registro_id
   );

comment on view public.v_lixeira is
  'Itens recuperáveis da Lixeira: fora os restaurados, os expirados e os que já voltaram por outro caminho (o Desfazer de 8 segundos reinsere com o mesmo id). Migration 0054.';

-- Restaurar. Reinsere a linha com o MESMO id, pulando colunas geradas
-- (mes_referencia é `generated always` — insert nela é erro).
create or replace function public.fn_lixeira_restaurar(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item   public.lixeira%rowtype;
  v_cols   text;
  v_existe boolean;
begin
  if not public.fn_can_write() then
    raise exception 'Sem permissão para restaurar (precisa ser admin ou editor).';
  end if;

  select * into v_item from public.lixeira where id = p_id for update;
  if not found then raise exception 'Item não encontrado na lixeira.'; end if;
  if v_item.restaurado_em is not null then
    raise exception 'Este item já foi restaurado em %.', to_char(v_item.restaurado_em, 'DD/MM/YYYY HH24:MI');
  end if;
  if not (v_item.tabela = any (public.fn_lixeira_tabelas())) then
    raise exception 'Tabela % não é restaurável.', v_item.tabela;
  end if;

  execute format('select exists (select 1 from public.%I where id = $1)', v_item.tabela)
     into v_existe using v_item.registro_id;
  if v_existe then
    update public.lixeira set restaurado_em = now() where id = p_id;
    raise exception 'O registro já existe de novo no sistema — nada a restaurar.';
  end if;

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name = v_item.tabela
     and is_generated = 'NEVER'
     and identity_generation is null;

  execute format(
    'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)',
    v_item.tabela, v_cols, v_cols, v_item.tabela
  ) using v_item.dados;

  update public.lixeira set restaurado_em = now() where id = p_id;
  return v_item.registro_id;
end;
$$;

comment on function public.fn_lixeira_restaurar(uuid) is
  'Devolve um item da Lixeira à tabela de origem, com o mesmo id. Migration 0054.';

-- Excluir DE VEZ um item (a Lola pode querer tirar da lista antes do prazo).
create or replace function public.fn_lixeira_descartar(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.fn_can_write() then
    raise exception 'Sem permissão para descartar (precisa ser admin ou editor).';
  end if;
  delete from public.lixeira where id = p_id;
end;
$$;

comment on function public.fn_lixeira_descartar(uuid) is
  'Apaga definitivamente um item da Lixeira, antes do prazo. Migration 0054.';

-- Expurgo do que passou do prazo. A tela chama ao abrir; não há cron aqui.
create or replace function public.fn_lixeira_expurgar()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_qtd int;
begin
  with mortos as (
    delete from public.lixeira
     where expira_em <= now()
        or (restaurado_em is not null and restaurado_em < now() - interval '7 days')
    returning 1
  )
  select count(*) into v_qtd from mortos;
  return v_qtd;
end;
$$;

comment on function public.fn_lixeira_expurgar() is
  'Apaga da Lixeira o que passou do prazo de retenção. Chamada pela tela ao abrir. Migration 0054.';

grant execute on function public.fn_lixeira_restaurar(uuid) to authenticated;
grant execute on function public.fn_lixeira_descartar(uuid) to authenticated;
grant execute on function public.fn_lixeira_expurgar()     to authenticated;
grant execute on function public.fn_dv_gerar_linha(text)   to authenticated;

-- ----------------------------------------------------------------------------
-- ROLLBACK:
--   drop trigger if exists tg_te_lixeira on public.transacoes_empresa;
--   drop trigger if exists tg_ts_lixeira on public.transacoes_socio;
--   drop trigger if exists tg_vp_lixeira on public.vendas_provisionadas;
--   drop trigger if exists tg_te_dv_sync on public.transacoes_empresa;
--   drop view if exists public.v_lixeira;
--   drop table if exists public.lixeira;
--   drop function if exists public.fn_lixeira_restaurar(uuid), public.fn_lixeira_descartar(uuid),
--                           public.fn_lixeira_expurgar(), public.tg_lixeira_arquivar(),
--                           public.fn_lixeira_resumo(text, jsonb), public.fn_lixeira_tabelas();
--   drop function if exists public.fn_dv_gerar_linha(text), public.fn_dv_sync_linha(text),
--                           public.tg_te_dv_sync(), public.fn_dv_utilizado(text),
--                           public.fn_dv_limite_mensal(), public.fn_dv_descricao_auto();
--   -- restaurar tg_te_resgate_invest_link da migration 0053 e:
--   drop function if exists public.fn_titulo_puxa_resgate(uuid, numeric, public.status_aramburu, boolean);
--   drop function if exists public.fn_titulo_aplicacao(public.status_aramburu);
-- ----------------------------------------------------------------------------
