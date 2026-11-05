-- ============================================================================
-- 0070 — A origem do recurso GERA o resgate daquela conta
-- ============================================================================
-- Resposta da Adri em 05-nov-2026 à dúvida que a 0068 deixou aberta. Num título
-- A Pagar de R$ 365 com origem SICREDI FUNDO EMPRESARIAL: "neste caso ele deve
-- gerar o RESGATE. Com duas linhas, ENTRADA na conta corrente e a SAÍDA da conta
-- investimento (origem do recurso)". Até aqui, outra origem só deixava de gerar o
-- resgate do Automático e ela lançava o par à mão (ex.: os R$ 3.000 de 03/11).
--
-- Mas o documento dela (30-out, itens 2 e 5) também pede o contrário para o lote
-- do 1º dia útil: o resgate global do Fundo já cobre os títulos do dia e a DL, e
-- não pode haver programação duplicada. O global de 03/11 confere: R$ 134.645,47
-- = títulos do dia + DL + aplicação do restante + tarifa + R$ 1,00. Se todo título
-- com origem Fundo gerasse par, esse lote sairia em dobro. São dois casos:
--
--   origem vazia ........................ par na conta padrão (como sempre);
--   origem = conta ...................... par NAESSA conta (avulso do dia);
--   origem = conta + dispensa_resgate ... JÁ COBERTO por resgate lançado à parte
--                                         (global): não gera nada;
--   dispensa_resgate sem origem ......... pago pelo saldo da própria conta (0049).
--
-- Um resgate por dia POR CONTA (etiqueta …#D:C<id da conta>): o título do Fundo não
-- entra no resgate do Automático do mesmo dia. A linha mensal dos provisionados e
-- a fatura do cartão continuam com a conta da família (0068).
--
-- A perna de saída do repasse da DL nasce JÁ COBERTA: o global do 1º dia útil paga
-- a transferência (mesmo comportamento da 0069, agora com o estado explícito).
--
-- Reparo: o que já tem origem e está sem resgate — lançamentos cobertos pelos
-- resgates que ela lançou à mão — passa a "já coberto" e NÃO ganha par; os
-- avulsos ainda A Pagar de 04/11 em diante ganham o par (ex.: os R$ 365 de 05/11).
--
-- Sem coluna nova e sem foreign key (ver 0068/0069). Depende da 0069. Idempotente.

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'fn_resgate_religar_titulo') then
    raise exception 'Aplique a 0069_dl_sicredi_contraparte_aplicacao_auto.sql antes da 0070.';
  end if;
end $$;

comment on column public.transacoes_empresa.resgate_origem_id is
  'Origem do recurso: conta de investimento que cobre esta saída da corrente Sicredi. Vazio = conta padrão dos resgates. Outra conta = gera o par NESSA conta (0070). Com dispensa_resgate = já coberto por resgate lançado à parte (global): não gera nada.';

update public.app_config
   set descricao = 'Conta padrão dos resgates automáticos do dia a dia (id em Bancos): é dela que sai o par de cada pagamento da corrente Sicredi sem origem do recurso. Lançamento com outra origem gera o par naquela conta (0070). Vazio, inativa ou que não seja de investimento = SICREDINVEST. Migrations 0064/0068/0070.'
 where chave = 'resgate_conta_origem';

-- ###########################################################################
-- 1) De qual conta sai o resgate do título
-- ###########################################################################
-- A origem vale se for outra conta de investimento ativa. Vazia, igual à conta
-- padrão ou inválida (ex.: conta desativada) = conta padrão.
create or replace function public.fn_resgate_origem_efetiva(p_origem uuid)
returns uuid language sql stable as $$
  select c.id
    from public.contas_bancarias_empresa c
   where c.id = p_origem
     and c.ativa = true
     and c.tipo = 'investimento'
     and c.id is distinct from public.fn_conta_sicredi_invest()
     and c.id is distinct from public.fn_conta_sicredi_corrente()
$$;

comment on function public.fn_resgate_origem_efetiva(uuid) is
  'Conta de onde sai o par quando o título tem origem do recurso própria; null = conta padrão dos resgates. Migration 0070.';

-- ###########################################################################
-- 2) Resgate do dia, por conta
-- ###########################################################################
create or replace function public.fn_resgate_invest_obter(p_dia date, p_lote text, p_origem uuid)
returns uuid
language plpgsql
as $$
declare
  v_sic    uuid := public.fn_conta_sicredi_corrente();
  v_forn   uuid;
  v_id     uuid;
  v_conta  uuid := public.fn_resgate_origem_efetiva(p_origem);
  v_tag    text := 'auto:resgate_invest:' || to_char(p_dia, 'YYYY-MM-DD') || '#' || public.fn_resgate_lote_efetivo(p_lote)
                   || case when public.fn_resgate_origem_efetiva(p_origem) is not null
                           then ':C' || public.fn_resgate_origem_efetiva(p_origem)::text else '' end;
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
    (p_dia, public.fn_cod('resgate'), public.fn_cod('resgate_sicredi'), 'sem', 'sem', 'sem',
     v_sic, 'a_resgatar', 0,
     v_forn, 'Banco Cooperativa Sicredi',
     case when v_conta is not null
       then 'Resgate ' || public.fn_conta_apelido(v_conta)
       else public.fn_resgate_descricao()
     end,
     v_tag,
     public.fn_resgate_observacao(
       case
         when v_conta is not null
           then 'Resgate da conta escolhida na origem do recurso: soma os títulos da conta corrente com essa origem neste dia.'
         when public.fn_app_config('resgate_agrupamento', 'agendamento') = 'dia'
           then 'Resgate do dia: soma os títulos da conta corrente com vencimento neste dia.'
         else 'Resgate de um agendamento: soma os títulos que foram para o banco juntos, ' ||
              'com vencimento no dia útil seguinte. Um agendamento novo no mesmo dia gera ' ||
              'outra linha, para o extrato bater lançamento a lançamento.'
       end, v_conta is null))
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.fn_resgate_invest_obter(date, text, uuid) is
  'Localiza (ou cria) o resgate CONFIRMADO (vermelho) do dia para a conta do título: a da origem do recurso ou, sem ela, a padrão. Um por dia ou por lote (resgate_agrupamento), sempre por conta. Migrations 0044/0050/0053/0068/0070.';

-- A assinatura antiga segue valendo para a conta padrão.
create or replace function public.fn_resgate_invest_obter(p_dia date, p_lote text)
returns uuid language sql as $$
  select public.fn_resgate_invest_obter(p_dia, p_lote, null::uuid)
$$;

-- A etiqueta carrega a conta: enquanto o espelho não existe, é dela que vem.
create or replace function public.fn_resgate_conta_do_par(p_resgate_id uuid)
returns uuid language sql stable as $$
  select coalesce(
    (select e.conta_bancaria_id
       from public.transacoes_empresa e
      where e.origem_planilha = 'auto:resgate_invest_saida:' || p_resgate_id::text
        and e.conta_bancaria_id is not null
      order by e.created_at
      limit 1),
    (select case
              when r.origem_planilha like 'auto:resgate_invest_prov:%'   then public.fn_conta_resgate_programacao()
              when r.origem_planilha like 'auto:resgate_invest_fatura:%' then public.fn_conta_resgate_fatura()
              when r.origem_planilha ~ '^auto:resgate_invest:.*:C[0-9a-f-]{36}$'
                then substring(r.origem_planilha from ':C([0-9a-f-]{36})$')::uuid
            end
       from public.transacoes_empresa r
      where r.id = p_resgate_id),
    public.fn_conta_sicredi_invest())
$$;

comment on function public.fn_resgate_conta_do_par(uuid) is
  'Conta de investimento de onde sai o resgate informado: a do espelho já gravado ou, sem espelho, a da etiqueta (origem do recurso, 0070) ou da família (programação, fatura, dia a dia). Migrations 0064/0068/0070.';

-- ###########################################################################
-- 3) Qual resgate recebe o título
-- ###########################################################################
create or replace function public.fn_resgate_alvo_do_titulo(
  p_forma  public.forma_pgto,
  p_venc   date,
  p_status public.status_aramburu,
  p_lote   text,
  p_origem uuid
)
returns uuid
language plpgsql
as $$
begin
  if p_venc is null then return null; end if;

  -- 🟡 Ainda é programação → linha única do mês, qualquer que seja a origem.
  if public.fn_titulo_provisionado(p_status) then
    return public.fn_resgate_prov_mensal_obter(p_venc);
  end if;

  -- 🔴 Já foi para o banco.
  if p_forma = 'cartao_credito' then
    return public.fn_resgate_fatura_cartao_obter(p_venc, p_lote);
  end if;
  return public.fn_resgate_invest_obter(public.fn_dia_resgate(p_venc), p_lote, p_origem);
end;
$$;

comment on function public.fn_resgate_alvo_do_titulo(public.forma_pgto, date, public.status_aramburu, text, uuid) is
  'Resgate que deve receber um título do Sicredi: mensal programado enquanto provisionado (0053), consolidado da fatura no cartão (0048) ou do dia na conta da origem do recurso (0070) depois que vai para o banco.';

create or replace function public.fn_resgate_alvo_do_titulo(
  p_forma  public.forma_pgto,
  p_venc   date,
  p_status public.status_aramburu,
  p_lote   text
)
returns uuid language sql as $$
  select public.fn_resgate_alvo_do_titulo(p_forma, p_venc, p_status, p_lote, null::uuid)
$$;

-- Corpo da 0069; o que puxa resgate é só fn_titulo_puxa_resgate (dispensa_resgate
-- cobre "saldo da conta" e "já coberto") e o alvo olha a origem.
create or replace function public.fn_resgate_religar_titulo(p_id uuid)
returns void
language plpgsql
as $$
declare
  v_t      public.transacoes_empresa%rowtype;
  v_alvo   uuid;
  v_antigo uuid;
begin
  select * into v_t from public.transacoes_empresa where id = p_id;
  if not found then return; end if;
  v_antigo := v_t.resgate_auto_id;

  if public.fn_resgates_auto_sicredi_ativos()
     and public.fn_titulo_puxa_resgate(v_t.conta_bancaria_id, v_t.valor, v_t.status, v_t.dispensa_resgate) then
    v_alvo := public.fn_resgate_alvo_do_titulo(
      v_t.forma_pgto, v_t.data, v_t.status, public.fn_resgate_lote(), v_t.resgate_origem_id);
  end if;

  if v_alvo is distinct from v_antigo then
    update public.transacoes_empresa set resgate_auto_id = v_alvo where id = p_id;
    if v_antigo is not null then perform public.fn_resgate_invest_recalc(v_antigo, false); end if;
  end if;
  if v_alvo is not null then perform public.fn_resgate_invest_recalc(v_alvo, false); end if;
end;
$$;

comment on function public.fn_resgate_religar_titulo(uuid) is
  'Vincula o lançamento ao resgate certo e recalcula o antigo e o novo — o que tg_te_resgate_invest_link/recalc fazem, para quando a mudança vem de dentro de outro gatilho (guarda de profundidade). Sem validação de saldo. Migrations 0069/0070.';

-- ###########################################################################
-- 4) Gatilho de vínculo — corpo da 0068, com a origem escolhendo a conta
-- ###########################################################################
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
        new.forma_pgto, new.data, new.status, public.fn_resgate_lote(), new.resgate_origem_id);
    end if;
    return new;
  end if;

  -- UPDATE
  v_era_driver := public.fn_titulo_puxa_resgate(
    old.conta_bancaria_id, old.valor, old.status, old.dispensa_resgate);

  if not v_eh_driver then
    -- Saiu do escopo (mudou de banco, virou entrada, virou APLICAÇÃO, foi marcado
    -- como pago pelo saldo da conta ou já coberto por resgate lançado à parte)
    -- → desvincula; o AFTER recalcula o resgate antigo, que encolhe (ou some).
    new.resgate_auto_id := null;
    return new;
  end if;

  if new.resgate_auto_id is null then
    -- Título sem resgate porque ela apagou o par continua sem — a não ser que
    -- agora tenha passado a puxar, ou que ela tenha escolhido outra origem.
    if (not v_era_driver or new.resgate_origem_id is distinct from old.resgate_origem_id)
       and public.fn_resgates_auto_sicredi_ativos() then
      new.resgate_auto_id := public.fn_resgate_alvo_do_titulo(
        new.forma_pgto, new.data, new.status, public.fn_resgate_lote(), new.resgate_origem_id);
    end if;
    return new;
  end if;

  v_prov_old := public.fn_titulo_provisionado(old.status);
  v_prov_new := public.fn_titulo_provisionado(new.status);

  -- Muda de resgate quando muda o vencimento, a forma de pagamento, a origem do
  -- recurso OU quando o título sai da programação e vai para o banco (0053).
  if new.data is distinct from old.data
     or new.forma_pgto is distinct from old.forma_pgto
     or new.resgate_origem_id is distinct from old.resgate_origem_id
     or v_prov_new is distinct from v_prov_old then

    select status into v_status_resgate
      from public.transacoes_empresa where id = new.resgate_auto_id;

    if v_status_resgate is null then
      new.resgate_auto_id := public.fn_resgate_alvo_do_titulo(
        new.forma_pgto, new.data, new.status, public.fn_resgate_lote(), new.resgate_origem_id);
    elsif v_status_resgate <> 'resgatado' then
      v_alvo := public.fn_resgate_alvo_do_titulo(
        new.forma_pgto, new.data, new.status, public.fn_resgate_lote(), new.resgate_origem_id);
      if v_alvo is distinct from new.resgate_auto_id then
        new.resgate_auto_id := v_alvo;
      end if;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.tg_te_resgate_invest_link() is
  'Vincula títulos do Sicredi ao resgate certo: mensal programado enquanto provisionado, do dia na conta da origem do recurso depois que vai para o banco (0053/0070); fatura no cartão (0048); fora do escopo os pagos pelo saldo da conta (0049), os já cobertos por resgate à parte (0070) e as APLICAÇÕES (0054).';

drop function if exists public.fn_titulo_origem_gera_resgate(uuid, public.status_aramburu, public.forma_pgto);

-- ###########################################################################
-- 5) Repasse da DL: a perna de saída nasce JÁ COBERTA — corpo da 0069
-- ###########################################################################
comment on function public.fn_dl_origem_recurso(uuid) is
  'Origem do recurso da saída da DL: saindo da corrente Sicredi, a conta da programação mensal (Fundo). A perna nasce já coberta (dispensa_resgate): o resgate global do 1º dia útil paga a transferência. Migrations 0069/0070.';

create or replace function public.fn_consolidar_repasse_dl(
  p_mes text,
  p_data date default current_date,
  p_incluir_transferencia boolean default true
)
returns uuid
language plpgsql
as $$
declare
  v_soma   numeric(15,2);
  v_qtd    int;
  v_grupo  text := 'dl_repasse:' || gen_random_uuid();
  v_origem uuid;
  v_inter  uuid;
  v_global uuid;
  v_mes_humano text;
  v_f_socios uuid := public.fn_fornecedor_id('Sócios Aramburu Participações');
  v_f_part   uuid := public.fn_fornecedor_id('Aramburu Participações Ltda');
  v_f_agro   uuid := public.fn_fornecedor_id('Agropecuária Aramburu Ltda');
begin
  if p_mes is null or p_mes !~ '^\d{4}-\d{2}$' then
    raise exception 'Mês inválido (esperado YYYY-MM).';
  end if;

  select coalesce(sum(valor), 0), count(*) into v_soma, v_qtd
  from public.transacoes_socio
  where mes_referencia = p_mes and status = 'a_pagar' and repasse_id is null;

  if v_qtd = 0 then
    raise exception 'Nenhum lançamento detalhado com status "A repassar" (e sem repasse) em %.', p_mes;
  end if;
  if v_soma <= 0 then
    raise exception 'A soma do detalhado "A repassar" de % é R$ % — verifique os valores antes de consolidar.', p_mes, v_soma;
  end if;

  perform 1 from public.classificacao_financeira where codigo in ((select public.fn_cod('dl')),(select public.fn_cod('dl_lucros')),(select public.fn_cod('transf_enviadas_conta')),(select public.fn_cod('transf_enviadas')),(select public.fn_cod('transf_recebidas_conta')),(select public.fn_cod('transf_recebidas')))
  having count(*) = 6;
  if not found then
    raise exception 'Plano de contas incompleto: são necessárias as classificações %/%, %/% e %/% (Configurações → Plano de Contas).',
      public.fn_cod('dl'), public.fn_cod('dl_lucros'), public.fn_cod('transf_enviadas_conta'), public.fn_cod('transf_enviadas'), public.fn_cod('transf_recebidas_conta'), public.fn_cod('transf_recebidas');
  end if;

  select id into v_inter from public.contas_bancarias_empresa
   where ativa = true and banco ilike '%inter%' order by ordem nulls last limit 1;
  if v_inter is null then
    raise exception 'Conta do Banco Inter não encontrada em Bancos (necessária para o repasse).';
  end if;

  if p_incluir_transferencia then
    v_origem := public.fn_conta_origem_dl();
    if v_origem is null then
      raise exception 'Conta de origem da Distribuição de Lucros não encontrada — escolha em Configurações → Automações.';
    end if;
  end if;

  v_mes_humano := substring(p_mes from 6 for 2) || '/' || substring(p_mes from 1 for 4);

  -- Global 2.8 — saída do INTER para os sócios, "A repassar".
  insert into public.transacoes_empresa (
    data, conta_contabil_cod, centro_custo_cod, tipo_despesa,
    descricao, obs_obra, forma_pgto, conta_bancaria_id,
    status, valor, observacao, origem_planilha, fornecedor_id, fornecedor_nome
  ) values (
    p_data, public.fn_cod('dl'), public.fn_cod('dl_lucros'), 'sem',
    'Distribuição de Lucro — repasse ' || v_mes_humano,
    'sem', 'transferencia', v_inter,
    'a_repassar', -v_soma,
    'Consolidado automaticamente de ' || v_qtd || ' lançamento(s) detalhado(s) por sócio (tela Distribuição de Lucro).',
    v_grupo, v_f_socios, 'Sócios Aramburu Participações'
  ) returning id into v_global;

  -- Par de transferência conta de origem → INTER (2.9.1 / 1.9.1).
  if p_incluir_transferencia then
    insert into public.transacoes_empresa (
      data, conta_contabil_cod, centro_custo_cod, tipo_despesa,
      descricao, obs_obra, forma_pgto, conta_bancaria_id,
      status, valor, observacao, origem_planilha, fornecedor_id, fornecedor_nome,
      resgate_origem_id, dispensa_resgate
    ) values (
      p_data, public.fn_cod('transf_enviadas_conta'), public.fn_cod('transf_enviadas'), 'sem',
      'Transf. Entre Contas_Distribuição de Lucro ' || v_mes_humano,
      'sem', 'transferencia', v_origem,
      'a_pagar', -v_soma, null, v_grupo, v_f_part, 'Aramburu Participações Ltda',
      public.fn_dl_origem_recurso(v_origem),
      public.fn_dl_origem_recurso(v_origem) is not null   -- 0070: já coberta pelo global
    ), (
      p_data, public.fn_cod('transf_recebidas_conta'), public.fn_cod('transf_recebidas'), 'sem',
      'Transf. Entre Contas_Distribuição de Lucro ' || v_mes_humano,
      'sem', 'transferencia', v_inter,
      'a_receber', v_soma, null, v_grupo, v_f_agro, 'Agropecuária Aramburu Ltda',
      null, false
    );
  end if;

  update public.transacoes_socio
     set repasse_id = v_global
   where mes_referencia = p_mes and status = 'a_pagar' and repasse_id is null;

  return v_global;
end;
$$;

-- ###########################################################################
-- 6) Reparo
-- ###########################################################################
do $$
declare
  v_sic uuid := public.fn_conta_sicredi_corrente();
  v_qtd int := 0;
  r     record;
begin
  if v_sic is null then return; end if;
  perform set_config('arambi.invest_sem_validacao', 'on', true);

  -- (a) Avulsos ainda A Pagar de 04/11 em diante (depois do global de 03/11), com
  --     origem própria e sem resgate → ganham o par naquela conta. Roda antes de
  --     (b), que marca como já coberto o que sobrar sem vínculo.
  for r in
    select t.id
      from public.transacoes_empresa t
     where t.conta_bancaria_id = v_sic
       and t.valor < 0
       and t.status = 'a_pagar'
       and t.data >= date '2026-11-04'
       and t.resgate_origem_id is not null
       and public.fn_resgate_origem_efetiva(t.resgate_origem_id) is not null
       and t.resgate_auto_id is null
       and not coalesce(t.dispensa_resgate, false)
       and t.forma_pgto is distinct from 'cartao_credito'
       and coalesce(t.origem_planilha, '') !~ '^(auto:|dl_repasse:|dl_auto:)'
  loop
    perform public.fn_resgate_religar_titulo(r.id);
    v_qtd := v_qtd + 1;
  end loop;
  raise notice '0070: % avulso(s) A Pagar ganharam o resgate da conta de origem.', v_qtd;

  -- (b) O resto com origem própria e sem resgate foi coberto por resgate lançado
  --     à mão (o global de 03/11, os avulsos manuais): vira "já coberto".
  update public.transacoes_empresa t
     set dispensa_resgate = true
   where t.conta_bancaria_id = v_sic
     and t.valor < 0
     and t.resgate_origem_id is not null
     and t.resgate_auto_id is null
     and not coalesce(t.dispensa_resgate, false)
     and not public.fn_titulo_provisionado(t.status)
     and t.forma_pgto is distinct from 'cartao_credito'
     and coalesce(t.origem_planilha, '') not like 'auto:resgate_invest%';
  get diagnostics v_qtd = row_count;
  raise notice '0070: % lançamento(s) sem resgate marcados como já cobertos por resgate à parte.', v_qtd;
end $$;
