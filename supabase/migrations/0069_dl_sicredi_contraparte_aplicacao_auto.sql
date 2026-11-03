-- ============================================================================
-- 0069 — DL pelo SICREDI + contraparte padronizada + aplicação automática
-- ============================================================================
-- Pedidos da Adri (documento de 30-out-2026, ajustes-29-outubro-2026/):
--
--   1) DISTRIBUIÇÃO DE LUCRO — NOVA MODALIDADE DE PGTO PELO SICREDI (pág. 7)
--      A saída dos repasses deixa de ser o CORA e passa a ser o SICREDI, com o
--      parâmetro "Conta bancária de origem – Distribuição de Lucros" em
--      Configurações → Automações (chave dl_conta_origem). Vale para a perna de
--      saída do par de transferência do repasse e para a linha provisionada
--      automática do mês (SOMASE). Saindo da corrente Sicredi, a perna nasce
--      com origem do recurso = conta da programação mensal (Fundo Empresarial,
--      0068): é coberta pelo resgate global do 1º dia útil, não pelo Automático.
--
--   2) FORNECEDOR / CONTRAPARTE – DISTRIBUIÇÃO DE LUCRO (pág. 7) — "Ltda", não
--      "Limitada" (Luiz, 30-out):
--        entrada no INTER (1.9.1)              → Agropecuária Aramburu Ltda
--        saída do INTER (2.8.1, a repassar…)   → Sócios Aramburu Participações
--        saída da conta de origem (2.9.1 / DL) → Aramburu Participações Ltda
--      Passado, atual e futuro.
--
--   3) AUTOMATIZAÇÃO DOS LANÇAMENTOS - APLICAÇÕES FINANCEIRAS (pág. 2)
--      Saída em 2.6 / 2.6.1 (Aplicações Financeiras) com "Aplicar em qual
--      conta?" (coluna aplicacao_destino_id) gera sozinha a ENTRADA na conta de
--      investimento: 1.10 / 1.10.1, mesma data, valor e descrição; "A aplicar"
--      → "A receber", "Aplicado" → "Recebido" (respostas dela em 30-out). A
--      entrada acompanha a saída (editar, trocar status, excluir).
--
-- Lição da 0068 (03-nov): coluna nova que aponta para contas_bancarias_empresa
-- NÃO leva foreign key — uma 2ª FK deixa ambíguo o embed do PostgREST e as
-- telas caem com "more than one relationship was found".
--
-- Depende da 0066 (papéis) e da 0068 (origem do recurso). Idempotente.

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'fn_conta_resgate_programacao') then
    raise exception 'Aplique a 0068_resgates_modelo_automatico.sql antes da 0069.';
  end if;
end $$;

-- ###########################################################################
-- 1) Papéis novos (aplicação automática)
-- ###########################################################################
do $$
begin
  if exists (select 1 from public.classificacao_financeira where codigo = '2.6.1')
     and not exists (select 1 from public.classificacao_papel where papel = 'aplicacoes_financeiras')
     and not exists (select 1 from public.classificacao_papel where codigo = '2.6.1') then
    insert into public.classificacao_papel (papel, codigo, descricao) values
      ('aplicacoes_financeiras', '2.6.1',
       'Aplicações Financeiras: a saída com "Aplicar em qual conta?" gera sozinha a entrada na conta de investimento (0069).');
  end if;
  if exists (select 1 from public.classificacao_financeira where codigo = '1.10.1')
     and not exists (select 1 from public.classificacao_papel where papel = 'outros_recebimentos_diversos')
     and not exists (select 1 from public.classificacao_papel where codigo = '1.10.1') then
    insert into public.classificacao_papel (papel, codigo, descricao) values
      ('outros_recebimentos_diversos', '1.10.1',
       'Centro da entrada automática na conta de investimento quando uma aplicação é lançada na corrente (0069).');
  end if;
end $$;

-- ###########################################################################
-- 2) Contrapartes da DL
-- ###########################################################################
insert into public.fornecedores (nome, observacao)
select 'Sócios Aramburu Participações', 'Contraparte da saída do INTER no repasse da Distribuição de Lucro (0069).'
 where not exists (select 1 from public.fornecedores where nome = 'Sócios Aramburu Participações');

-- Id de um fornecedor pelo nome exato (null se não existir).
create or replace function public.fn_fornecedor_id(p_nome text)
returns uuid language sql stable as $$
  select id from public.fornecedores where nome = p_nome limit 1
$$;

-- ###########################################################################
-- 3) Conta bancária de origem da DL
-- ###########################################################################
insert into public.app_config (chave, valor, descricao) values
  ('dl_conta_origem', '',
   'Conta bancária de origem da Distribuição de Lucros (id em Bancos): de onde sai a transferência do repasse para o INTER e onde nasce a linha provisionada do mês. Vazio = CORA (como era até out-2026). Migration 0069.')
on conflict (chave) do nothing;

create or replace function public.fn_conta_origem_dl()
returns uuid language sql stable as $$
  select coalesce(
    (select c.id
       from public.app_config a
       join public.contas_bancarias_empresa c on c.id::text = lower(btrim(a.valor))
      where a.chave = 'dl_conta_origem' and c.ativa = true
      limit 1),
    (select id from public.contas_bancarias_empresa
      where ativa = true and banco ilike '%cora%'
      order by ordem nulls last limit 1))
$$;

comment on function public.fn_conta_origem_dl() is
  'Conta de onde saem os repasses da DL: a configurada em dl_conta_origem (Configurações → Automações), senão o CORA. Migration 0069.';

-- Origem do recurso da saída da DL: saindo da corrente Sicredi, é coberta pelo
-- resgate global do Fundo (conta da programação mensal) — não gera o Automático.
create or replace function public.fn_dl_origem_recurso(p_conta uuid)
returns uuid language sql stable as $$
  select case when p_conta is not null and p_conta = public.fn_conta_sicredi_corrente()
              then public.fn_conta_resgate_programacao() end
$$;

-- Pedido da Adri: hoje a conta é o SICREDI. Só grava se ainda estiver vazia.
update public.app_config
   set valor = public.fn_conta_sicredi_corrente()::text, updated_at = now()
 where chave = 'dl_conta_origem'
   and coalesce(btrim(valor), '') = ''
   and public.fn_conta_sicredi_corrente() is not null;

-- ###########################################################################
-- 4) Consolidar repasse — corpo da 0066 + conta de origem + contrapartes
-- ###########################################################################
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
      status, valor, observacao, origem_planilha, fornecedor_id, fornecedor_nome, resgate_origem_id
    ) values (
      p_data, public.fn_cod('transf_enviadas_conta'), public.fn_cod('transf_enviadas'), 'sem',
      'Transf. Entre Contas_Distribuição de Lucro ' || v_mes_humano,
      'sem', 'transferencia', v_origem,
      'a_pagar', -v_soma, null, v_grupo, v_f_part, 'Aramburu Participações Ltda',
      public.fn_dl_origem_recurso(v_origem)
    ), (
      p_data, public.fn_cod('transf_recebidas_conta'), public.fn_cod('transf_recebidas'), 'sem',
      'Transf. Entre Contas_Distribuição de Lucro ' || v_mes_humano,
      'sem', 'transferencia', v_inter,
      'a_receber', v_soma, null, v_grupo, v_f_agro, 'Agropecuária Aramburu Ltda', null
    );
  end if;

  update public.transacoes_socio
     set repasse_id = v_global
   where mes_referencia = p_mes and status = 'a_pagar' and repasse_id is null;

  return v_global;
end;
$$;

comment on function public.fn_consolidar_repasse_dl(text,date,boolean) is
  'Consolida o detalhado "A repassar" do mês em lançamentos globais da empresa: par conta de origem (dl_conta_origem — SICREDI desde 0069) → INTER nos centros transf_enviadas/transf_recebidas + saída do INTER no centro dl_lucros, status a_repassar; contrapartes padronizadas (0069). Atômico. Migrations 0044/0063/0066/0069.';

-- ###########################################################################
-- 5) SOMASE da DL — corpo da 0066 + conta de origem + contraparte
-- ###########################################################################
-- A linha provisionada da DL nasce e muda DE DENTRO do gatilho do detalhado
-- (transacoes_socio). Ali os gatilhos de vínculo/recálculo do resgate (0044)
-- saem pela guarda pg_trigger_depth() > 1 — com o CORA isso não importava; na
-- corrente Sicredi a linha precisa entrar na programação mensal. Esta função
-- faz à mão o que aqueles gatilhos fariam.
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
     and public.fn_titulo_puxa_resgate(v_t.conta_bancaria_id, v_t.valor, v_t.status, v_t.dispensa_resgate)
     and public.fn_titulo_origem_gera_resgate(v_t.resgate_origem_id, v_t.status, v_t.forma_pgto) then
    v_alvo := public.fn_resgate_alvo_do_titulo(v_t.forma_pgto, v_t.data, v_t.status, public.fn_resgate_lote());
  end if;

  if v_alvo is distinct from v_antigo then
    update public.transacoes_empresa set resgate_auto_id = v_alvo where id = p_id;
    if v_antigo is not null then perform public.fn_resgate_invest_recalc(v_antigo, false); end if;
  end if;
  if v_alvo is not null then perform public.fn_resgate_invest_recalc(v_alvo, false); end if;
end;
$$;

comment on function public.fn_resgate_religar_titulo(uuid) is
  'Vincula o lançamento ao resgate certo e recalcula o antigo e o novo — o que tg_te_resgate_invest_link/recalc fazem, para quando a mudança vem de dentro de outro gatilho (guarda de profundidade). Sem validação de saldo. Migration 0069.';
create or replace function public.fn_sync_provisionado_dl(p_mes text)
returns void
language plpgsql
as $$
declare
  v_tag   text := 'dl_auto:' || p_mes;
  v_soma  numeric(15,2);
  v_banco uuid;
  v_id    uuid;
begin
  if p_mes is null then return; end if;

  if not exists (select 1 from public.classificacao_financeira where codigo = (select public.fn_cod('dl')))
     or not exists (select 1 from public.classificacao_financeira where codigo = (select public.fn_cod('dl_lucros'))) then
    return;
  end if;

  begin
    perform public.fn_dl_readotar_orfa(p_mes);
  exception when others then
    null;
  end;

  if exists (
    select 1 from public.transacoes_empresa
    where mes_referencia = p_mes
      and centro_custo_cod = (select public.fn_cod('dl_lucros'))
      and status in ('provisionado', 'provisionado_dl')
      and (origem_planilha is null or origem_planilha not like 'dl_auto:%')
  ) then
    return;
  end if;

  select coalesce(sum(valor), 0) into v_soma
  from public.transacoes_socio
  where mes_referencia = p_mes and status = 'provisionado';

  if v_soma <= 0 then
    -- O resgate mensal que a linha alimentava encolhe junto (0069).
    for v_id in
      delete from public.transacoes_empresa where origem_planilha = v_tag
      returning resgate_auto_id
    loop
      if v_id is not null then perform public.fn_resgate_invest_recalc(v_id, false); end if;
    end loop;
    return;
  end if;

  update public.transacoes_empresa
     set valor = -v_soma
   where origem_planilha = v_tag
  returning id into v_id;

  if v_id is not null then
    perform public.fn_resgate_religar_titulo(v_id);   -- 0069
  else
    v_banco := public.fn_conta_origem_dl();   -- 0069 (era o CORA fixo)

    insert into public.transacoes_empresa (
      data, conta_contabil_cod, centro_custo_cod, tipo_despesa,
      descricao, obs_obra, forma_pgto, conta_bancaria_id,
      status, valor, observacao, origem_planilha, fornecedor_id, fornecedor_nome
    ) values (
      to_date(p_mes || '-01', 'YYYY-MM-DD'), public.fn_cod('dl'), public.fn_cod('dl_lucros'), 'sem',
      public.fn_dl_descricao_auto(),
      'sem', 'sem', v_banco,
      'provisionado_dl', -v_soma,
      'Linha mantida automaticamente pela soma do detalhado por sócio (tela Distribuição de Lucro). Não editar o valor à mão.',
      v_tag, public.fn_fornecedor_id('Aramburu Participações Ltda'), 'Aramburu Participações Ltda'
    )
    returning id into v_id;
    perform public.fn_resgate_religar_titulo(v_id);   -- 0069
  end if;
exception when others then
  null;
end;
$$;

comment on function public.fn_sync_provisionado_dl(text) is
  'SOMASE da DL: mantém o global Provisionado DL (papéis dl/dl_lucros) igual à soma do detalhado provisionado do mês, na conta de origem da DL (dl_conta_origem, 0069). Bloqueado só por provisionado MANUAL no centro dl_lucros (0047); readota a linha que perdeu a etiqueta (0052).';

-- ###########################################################################
-- 6) Aplicação automática
-- ###########################################################################
alter table public.transacoes_empresa
  add column if not exists aplicacao_destino_id uuid;   -- SEM FK de propósito (ver cabeçalho)

comment on column public.transacoes_empresa.aplicacao_destino_id is
  '"Aplicar em qual conta?" (0069): conta de investimento que recebe a aplicação. Na saída em Aplicações Financeiras, gera e mantém a entrada correspondente nessa conta (etiqueta auto:aplicacao:<id da saída>).';

create or replace function public.fn_aplicacao_status_entrada(p_status public.status_aramburu)
returns public.status_aramburu language sql immutable as $$
  select (case
    when p_status in ('aplicado', 'pago', 'recebido') then 'recebido'
    when p_status in ('provisionado', 'provisionado_dl', 'provisionado_dv') then 'provisionado'
    else 'a_receber'
  end)::public.status_aramburu
$$;

comment on function public.fn_aplicacao_status_entrada(public.status_aramburu) is
  'Status da entrada automática da aplicação a partir do status da saída: Aplicado → Recebido; A aplicar/Aplicação/A pagar → A receber; provisionado → Provisionado. Migration 0069.';

create or replace function public.tg_te_aplicacao_auto()
returns trigger
language plpgsql
as $$
declare
  v_tag     text;
  v_destino public.contas_bancarias_empresa%rowtype;
  v_ok      boolean;
  v_forn    uuid;
  v_fnome   text;
  v_entrada uuid;
begin
  if tg_op = 'DELETE' then
    if old.aplicacao_destino_id is not null then
      delete from public.transacoes_empresa where origem_planilha = 'auto:aplicacao:' || old.id::text;
    end if;
    return old;
  end if;

  -- A própria entrada automática nunca gera outra.
  if new.origem_planilha like 'auto:aplicacao:%' then return new; end if;
  -- Nada a fazer: nunca teve destino e continua sem.
  if new.aplicacao_destino_id is null and (tg_op = 'INSERT' or old.aplicacao_destino_id is null) then
    return new;
  end if;

  v_tag := 'auto:aplicacao:' || new.id::text;
  select * into v_destino from public.contas_bancarias_empresa where id = new.aplicacao_destino_id;

  v_ok := new.aplicacao_destino_id is not null
      and v_destino.id is not null
      and v_destino.ativa
      and v_destino.tipo = 'investimento'
      and v_destino.id is distinct from new.conta_bancaria_id
      and new.valor < 0
      and new.status <> 'saldo_inicial'
      and new.centro_custo_cod = (select public.fn_cod('aplicacoes_financeiras'));

  if not v_ok then
    delete from public.transacoes_empresa where origem_planilha = v_tag;
    return new;
  end if;

  -- Contraparte da entrada: o banco da conta de investimento (como ela lança —
  -- ex.: "Banco Cooperativa Sicredi"); sem cadastro, o nome da instituição.
  select id, nome into v_forn, v_fnome from public.fornecedores
   where nome = 'Banco ' || v_destino.banco or nome = v_destino.banco
   order by length(nome) desc limit 1;
  v_fnome := coalesce(v_fnome, v_destino.banco);

  select id into v_entrada from public.transacoes_empresa where origem_planilha = v_tag limit 1;

  if v_entrada is null then
    insert into public.transacoes_empresa (
      data, data_emissao, conta_contabil_cod, centro_custo_cod, tipo_despesa,
      descricao, obs_obra, forma_pgto, conta_bancaria_id,
      status, valor, fornecedor_id, fornecedor_nome, observacao, origem_planilha
    ) values (
      new.data, new.data_emissao, (select public.fn_cod('outros_recebimentos')),
      (select public.fn_cod('outros_recebimentos_diversos')), 'sem',
      new.descricao, 'sem', new.forma_pgto, v_destino.id,
      public.fn_aplicacao_status_entrada(new.status), -new.valor, v_forn, v_fnome,
      'Entrada automática da aplicação lançada na conta corrente (Aplicar em qual conta?). Acompanha a saída: edite a saída, não esta linha.',
      v_tag
    );
  else
    update public.transacoes_empresa set
      data              = new.data,
      data_emissao      = new.data_emissao,
      descricao         = new.descricao,
      forma_pgto        = new.forma_pgto,
      conta_bancaria_id = v_destino.id,
      status            = public.fn_aplicacao_status_entrada(new.status),
      valor             = -new.valor,
      fornecedor_id     = v_forn,
      fornecedor_nome   = v_fnome
    where id = v_entrada
      and (data is distinct from new.data
        or data_emissao is distinct from new.data_emissao
        or descricao is distinct from new.descricao
        or forma_pgto is distinct from new.forma_pgto
        or conta_bancaria_id is distinct from v_destino.id
        or status is distinct from public.fn_aplicacao_status_entrada(new.status)
        or valor is distinct from -new.valor
        or fornecedor_id is distinct from v_forn
        or fornecedor_nome is distinct from v_fnome);
  end if;
  return new;
end;
$$;

comment on function public.tg_te_aplicacao_auto() is
  'Aplicação automática (0069): saída em Aplicações Financeiras com aplicacao_destino_id gera e mantém a entrada 1.10/1.10.1 na conta de investimento (mesma data, valor e descrição; status pelo fn_aplicacao_status_entrada); sem destino ou excluída, a entrada some.';

drop trigger if exists tg_te_aplicacao_auto on public.transacoes_empresa;
create trigger tg_te_aplicacao_auto
  after insert or update or delete on public.transacoes_empresa
  for each row execute function public.tg_te_aplicacao_auto();

-- ###########################################################################
-- 7) Reparo — contrapartes (passado, atual, futuro) e DL na conta de origem
-- ###########################################################################
do $$
declare
  v_origem   uuid := public.fn_conta_origem_dl();
  v_inter    uuid;
  v_f_socios uuid := public.fn_fornecedor_id('Sócios Aramburu Participações');
  v_f_part   uuid := public.fn_fornecedor_id('Aramburu Participações Ltda');
  v_f_agro   uuid := public.fn_fornecedor_id('Agropecuária Aramburu Ltda');
  v_qtd      int;
begin
  perform set_config('arambi.invest_sem_validacao', 'on', true);

  select id into v_inter from public.contas_bancarias_empresa
   where ativa = true and banco ilike '%inter%' order by ordem nulls last limit 1;

  -- (a) Entrada no INTER do par do repasse → Agropecuária Aramburu Ltda.
  update public.transacoes_empresa
     set fornecedor_id = v_f_agro, fornecedor_nome = 'Agropecuária Aramburu Ltda'
   where origem_planilha like 'dl_repasse:%'
     and valor > 0
     and centro_custo_cod = (select public.fn_cod('transf_recebidas'))
     and (fornecedor_id is distinct from v_f_agro or fornecedor_nome is distinct from 'Agropecuária Aramburu Ltda');
  get diagnostics v_qtd = row_count;
  raise notice '0069: % entrada(s) no INTER → Agropecuária Aramburu Ltda.', v_qtd;

  -- (b) Saída do INTER (global 2.8.1 do repasse) → Sócios Aramburu Participações.
  update public.transacoes_empresa
     set fornecedor_id = v_f_socios, fornecedor_nome = 'Sócios Aramburu Participações'
   where origem_planilha like 'dl_repasse:%'
     and valor < 0
     and centro_custo_cod = (select public.fn_cod('dl_lucros'))
     and (fornecedor_id is distinct from v_f_socios or fornecedor_nome is distinct from 'Sócios Aramburu Participações');
  get diagnostics v_qtd = row_count;
  raise notice '0069: % saída(s) do INTER → Sócios Aramburu Participações.', v_qtd;

  -- (c) Saída da conta de origem (perna 2.9.1 do repasse, CORA ou SICREDI) e a
  --     linha provisionada automática → Aramburu Participações Ltda.
  update public.transacoes_empresa
     set fornecedor_id = v_f_part, fornecedor_nome = 'Aramburu Participações Ltda'
   where ((origem_planilha like 'dl_repasse:%' and valor < 0
           and centro_custo_cod = (select public.fn_cod('transf_enviadas')))
       or origem_planilha like 'dl_auto:%')
     and (fornecedor_id is distinct from v_f_part or fornecedor_nome is distinct from 'Aramburu Participações Ltda');
  get diagnostics v_qtd = row_count;
  raise notice '0069: % saída(s) da conta de origem/provisionado → Aramburu Participações Ltda.', v_qtd;

  -- (d) Linhas provisionadas automáticas da DL (pendentes por natureza) passam
  --     para a conta de origem configurada.
  if v_origem is not null then
    update public.transacoes_empresa
       set conta_bancaria_id = v_origem
     where origem_planilha like 'dl_auto:%'
       and status in ('provisionado', 'provisionado_dl')
       and conta_bancaria_id is distinct from v_origem;
    get diagnostics v_qtd = row_count;
    raise notice '0069: % linha(s) provisionada(s) da DL passaram para a conta de origem.', v_qtd;

    -- (e) Pernas de saída do repasse ainda A Pagar na corrente Sicredi sem
    --     origem do recurso → Fundo (coberta pelo resgate global).
    update public.transacoes_empresa
       set resgate_origem_id = public.fn_dl_origem_recurso(conta_bancaria_id)
     where origem_planilha like 'dl_repasse:%'
       and valor < 0
       and status = 'a_pagar'
       and conta_bancaria_id = public.fn_conta_sicredi_corrente()
       and resgate_origem_id is null;
    get diagnostics v_qtd = row_count;
    raise notice '0069: % perna(s) A Pagar da DL na corrente Sicredi com origem = programação mensal.', v_qtd;
  end if;
end $$;

notify pgrst, 'reload schema';
