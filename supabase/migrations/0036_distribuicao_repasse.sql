-- ============================================================================
-- 0036 — Distribuição de Lucro: detalhado ↔ global integrados (call 24-jun-2026)
-- ============================================================================
-- Fluxo operacional da Adriane (transcrição 19:14–27:59): ela lança/confere o
-- DETALHADO por sócio primeiro, marca item a item como "A pagar" e só então
-- consolida o valor GLOBAL na empresa (Cora → Inter → contas pessoais).
--
-- O que esta migration entrega:
--   1. transacoes_socio.repasse_id — vincula cada linha detalhada ao lançamento
--      global consolidado em transacoes_empresa (sem duplicidade: o global é
--      GERADO a partir do detalhado, nunca digitado à mão).
--   2. Trigger "SOMASE": mantém automaticamente a linha global PROVISIONADA
--      da empresa (status provisionado_dl, conta 2.8) igual à soma do detalhado
--      provisionado do mês — replica a fórmula SOMASE que ela criou na planilha.
--   3. fn_consolidar_repasse_dl — cria atomicamente os lançamentos do repasse:
--        a) saída Cora  (2.9, "Transf. Entre Contas_…")  ┐ par de transferência
--        b) entrada Inter (1.9, mesma descrição)         ┘ (removido da Memória)
--        c) saída Inter (2.8 Distribuição de Lucro) — a "linha só" global que
--           alimenta DRE/Memória/Capa Empresa, exatamente como ela faz hoje.
--      Saldo resultante: Cora −X, Inter 0 (entra e sai), despesa 2.8 contada 1x.
--   4. fn_desfazer_repasse_dl / fn_concluir_repasse_dl — desfaz (enquanto em
--      aberto) ou dá baixa em grupo no repasse.
--   5. Views v_dl_mensal_resumo e v_provisionamento_anual (telas novas).
--
-- Nenhuma view existente é alterada — zero risco de regressão em saldos/KPIs.

-- ---------------------------------------------------------------------------
-- 1) Vínculo detalhado → global
-- ---------------------------------------------------------------------------
alter table public.transacoes_socio
  add column if not exists repasse_id uuid references public.transacoes_empresa(id) on delete set null;

create index if not exists idx_ts_repasse on public.transacoes_socio(repasse_id);

comment on column public.transacoes_socio.repasse_id is
  'Lançamento global (transacoes_empresa, conta 2.8) que consolidou esta linha detalhada. Preenchido por fn_consolidar_repasse_dl.';

-- ---------------------------------------------------------------------------
-- 2) Trigger "SOMASE" — global provisionado da empresa segue o detalhado
-- ---------------------------------------------------------------------------
-- Replica o comportamento da planilha: mudou férias/rescisão/valor no detalhado
-- → o provisionado global da empresa muda sozinho ("ele já mudava automático").
--
-- Segurança:
--   • Só gerencia a linha marcada com origem_planilha = 'dl_auto:<YYYY-MM>'.
--   • Se o mês tiver linha provisionada 2.8 MANUAL (importada da planilha ou
--     digitada), NÃO mexe em nada — a tela de Distribuição avisa a divergência.
--   • Nunca levanta exceção (não pode bloquear o save do detalhado).
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

  -- Plano de contas precisa ter 2.8/2.8.1 (seeds padrão); se não tiver, não faz nada.
  if not exists (select 1 from public.classificacao_financeira where codigo = '2.8')
     or not exists (select 1 from public.classificacao_financeira where codigo = '2.8.1') then
    return;
  end if;

  -- Mês com provisionado 2.8 manual → gestão manual, trigger não interfere.
  if exists (
    select 1 from public.transacoes_empresa
    where mes_referencia = p_mes
      and conta_contabil_cod = '2.8'
      and status in ('provisionado', 'provisionado_dl')
      and (origem_planilha is null or origem_planilha not like 'dl_auto:%')
  ) then
    return;
  end if;

  select coalesce(sum(valor), 0) into v_soma
  from public.transacoes_socio
  where mes_referencia = p_mes and status = 'provisionado';

  if v_soma <= 0 then
    delete from public.transacoes_empresa where origem_planilha = v_tag;
    return;
  end if;

  update public.transacoes_empresa
     set valor = -v_soma
   where origem_planilha = v_tag
  returning id into v_id;

  if v_id is null then
    select id into v_banco
    from public.contas_bancarias_empresa
    where ativa = true and banco ilike '%cora%'
    order by ordem nulls last limit 1;

    insert into public.transacoes_empresa (
      data, conta_contabil_cod, centro_custo_cod, tipo_despesa,
      descricao, obs_obra, forma_pgto, conta_bancaria_id,
      status, valor, observacao, origem_planilha
    ) values (
      to_date(p_mes || '-01', 'YYYY-MM-DD'), '2.8', '2.8.1', 'sem',
      'Distribuição de Lucro — Provisionado (automático do detalhado)',
      'sem', 'sem', v_banco,
      'provisionado_dl', -v_soma,
      'Linha mantida automaticamente pela soma do detalhado por sócio (tela Distribuição de Lucro). Não editar o valor à mão.',
      v_tag
    );
  end if;
exception when others then
  -- Nunca bloquear a operação no detalhado por causa da sincronização.
  null;
end;
$$;

create or replace function public.tg_ts_sync_provisionado_dl()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.fn_sync_provisionado_dl(old.mes_referencia);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and
     (tg_op = 'INSERT' or new.mes_referencia is distinct from old.mes_referencia) then
    perform public.fn_sync_provisionado_dl(new.mes_referencia);
  elsif tg_op = 'UPDATE' then
    -- mesmo mês: já sincronizado acima pelo old
    null;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists tg_ts_sync_prov_dl on public.transacoes_socio;
create trigger tg_ts_sync_prov_dl
  after insert or update or delete on public.transacoes_socio
  for each row execute function public.tg_ts_sync_provisionado_dl();

-- ---------------------------------------------------------------------------
-- 3) Consolidar repasse do mês (detalhado "A pagar" → global na empresa)
-- ---------------------------------------------------------------------------
create or replace function public.fn_consolidar_repasse_dl(
  p_mes text,                               -- "YYYY-MM"
  p_data date default current_date,         -- data programada do repasse
  p_incluir_transferencia boolean default true
)
returns uuid
language plpgsql
as $$
declare
  v_soma   numeric(15,2);
  v_qtd    int;
  v_grupo  text := 'dl_repasse:' || gen_random_uuid();
  v_cora   uuid;
  v_inter  uuid;
  v_global uuid;
  v_mes_humano text;
begin
  if p_mes is null or p_mes !~ '^\d{4}-\d{2}$' then
    raise exception 'Mês inválido (esperado YYYY-MM).';
  end if;

  select coalesce(sum(valor), 0), count(*) into v_soma, v_qtd
  from public.transacoes_socio
  where mes_referencia = p_mes and status = 'a_pagar' and repasse_id is null;

  if v_qtd = 0 then
    raise exception 'Nenhum lançamento detalhado com status "A pagar" (e sem repasse) em %.', p_mes;
  end if;
  if v_soma <= 0 then
    raise exception 'A soma do detalhado "A pagar" de % é R$ % — verifique os valores antes de consolidar.', p_mes, v_soma;
  end if;

  -- Classificações exigidas (seeds padrão do plano de contas)
  perform 1 from public.classificacao_financeira where codigo in ('2.8','2.8.1','2.9','2.9.3','1.9','1.9.1')
  having count(*) = 6;
  if not found then
    raise exception 'Plano de contas incompleto: são necessárias as classificações 2.8/2.8.1, 2.9/2.9.3 e 1.9/1.9.1 (Configurações → Plano de Contas).';
  end if;

  select id into v_inter from public.contas_bancarias_empresa
   where ativa = true and banco ilike '%inter%' order by ordem nulls last limit 1;
  if v_inter is null then
    raise exception 'Conta do Banco Inter não encontrada em Bancos (necessária para o repasse).';
  end if;

  if p_incluir_transferencia then
    select id into v_cora from public.contas_bancarias_empresa
     where ativa = true and banco ilike '%cora%' order by ordem nulls last limit 1;
    if v_cora is null then
      raise exception 'Conta do Banco Cora não encontrada em Bancos (necessária para a transferência Cora → Inter).';
    end if;
  end if;

  -- "2026-07" → "07/2026" (determinístico, independe do locale do banco)
  v_mes_humano := substring(p_mes from 6 for 2) || '/' || substring(p_mes from 1 for 4);

  -- (c) Global 2.8 — a "linha só" da empresa. Sai do Inter (é de lá que o valor
  -- vai para as contas pessoais). Alimenta DRE/Memória/Capa como hoje.
  insert into public.transacoes_empresa (
    data, conta_contabil_cod, centro_custo_cod, tipo_despesa,
    descricao, obs_obra, forma_pgto, conta_bancaria_id,
    status, valor, observacao, origem_planilha
  ) values (
    p_data, '2.8', '2.8.1', 'sem',
    'Distribuição de Lucro — repasse ' || v_mes_humano,
    'sem', 'transferencia', v_inter,
    'a_pagar', -v_soma,
    'Consolidado automaticamente de ' || v_qtd || ' lançamento(s) detalhado(s) por sócio (tela Distribuição de Lucro).',
    v_grupo
  ) returning id into v_global;

  -- (a)+(b) Par de transferência Cora → Inter (mesma descrição, valores opostos:
  -- a Memória de Cálculo remove o par, como nas transferências internas de hoje).
  if p_incluir_transferencia then
    insert into public.transacoes_empresa (
      data, conta_contabil_cod, centro_custo_cod, tipo_despesa,
      descricao, obs_obra, forma_pgto, conta_bancaria_id,
      status, valor, observacao, origem_planilha
    ) values (
      p_data, '2.9', '2.9.3', 'sem',
      'Transf. Entre Contas_Distribuição de Lucro ' || v_mes_humano,
      'sem', 'transferencia', v_cora,
      'a_pagar', -v_soma, null, v_grupo
    ), (
      p_data, '1.9', '1.9.1', 'sem',
      'Transf. Entre Contas_Distribuição de Lucro ' || v_mes_humano,
      'sem', 'transferencia', v_inter,
      'a_receber', v_soma, null, v_grupo
    );
  end if;

  update public.transacoes_socio
     set repasse_id = v_global
   where mes_referencia = p_mes and status = 'a_pagar' and repasse_id is null;

  return v_global;
end;
$$;

comment on function public.fn_consolidar_repasse_dl(text, date, boolean) is
  'Consolida o detalhado "A pagar" do mês em lançamentos globais da empresa (par Cora→Inter + saída 2.8 do Inter) e vincula via repasse_id. Atômico.';

-- ---------------------------------------------------------------------------
-- 4) Desfazer / Concluir repasse (em grupo)
-- ---------------------------------------------------------------------------
create or replace function public.fn_desfazer_repasse_dl(p_repasse_id uuid)
returns void
language plpgsql
as $$
declare
  v_tag text;
begin
  select origem_planilha into v_tag
  from public.transacoes_empresa
  where id = p_repasse_id and origem_planilha like 'dl_repasse:%';

  if v_tag is null then
    raise exception 'Lançamento não é um repasse consolidado pelo sistema.';
  end if;

  if exists (
    select 1 from public.transacoes_empresa
    where origem_planilha = v_tag and status not in ('a_pagar', 'a_receber')
  ) then
    raise exception 'Este repasse já tem lançamentos baixados (Pago/Recebido/Repassado) — dê baixa manualmente ou estorne antes de desfazer.';
  end if;

  update public.transacoes_socio set repasse_id = null where repasse_id = p_repasse_id;
  delete from public.transacoes_empresa where origem_planilha = v_tag;
end;
$$;

comment on function public.fn_desfazer_repasse_dl(uuid) is
  'Desfaz um repasse consolidado ainda em aberto: apaga o global + par de transferência e desvincula o detalhado.';

create or replace function public.fn_concluir_repasse_dl(p_repasse_id uuid)
returns void
language plpgsql
as $$
declare
  v_tag text;
begin
  select origem_planilha into v_tag
  from public.transacoes_empresa
  where id = p_repasse_id and origem_planilha like 'dl_repasse:%';

  if v_tag is null then
    raise exception 'Lançamento não é um repasse consolidado pelo sistema.';
  end if;

  -- Baixa em grupo: global 2.8 → Repassado; perna Cora → Pago; perna Inter → Recebido.
  update public.transacoes_empresa set status = 'repassado'
   where origem_planilha = v_tag and conta_contabil_cod = '2.8' and status = 'a_pagar';
  update public.transacoes_empresa set status = 'pago'
   where origem_planilha = v_tag and conta_contabil_cod = '2.9' and status = 'a_pagar';
  update public.transacoes_empresa set status = 'recebido'
   where origem_planilha = v_tag and conta_contabil_cod = '1.9' and status = 'a_receber';

  -- Detalhado vinculado ainda em aberto → Repassado (status_dl 'realizado').
  update public.transacoes_socio set status = 'realizado'
   where repasse_id = p_repasse_id and status = 'a_pagar';
end;
$$;

comment on function public.fn_concluir_repasse_dl(uuid) is
  'Dá baixa em grupo no repasse: global Repassado, transferência Pago/Recebido e detalhado vinculado Realizado.';

-- ---------------------------------------------------------------------------
-- 5) Views de apoio às telas novas
-- ---------------------------------------------------------------------------
-- Resumo mensal da Distribuição de Lucro (o "SOMASE por status" da planilha).
create or replace view public.v_dl_mensal_resumo as
select
  ts.mes_referencia,
  coalesce(sum(ts.valor) filter (where ts.status = 'provisionado'), 0)                          as provisionado,
  coalesce(sum(ts.valor) filter (where ts.status = 'a_pagar'), 0)                              as a_pagar,
  coalesce(sum(ts.valor) filter (where ts.status = 'a_pagar' and ts.repasse_id is null), 0)    as a_pagar_sem_repasse,
  coalesce(sum(ts.valor) filter (where ts.status = 'realizado'), 0)                            as realizado,
  count(*) filter (where ts.status = 'provisionado')                                           as qtd_provisionado,
  count(*) filter (where ts.status = 'a_pagar')                                               as qtd_a_pagar,
  count(*) filter (where ts.status = 'a_pagar' and ts.repasse_id is null)                     as qtd_a_pagar_sem_repasse,
  count(*) filter (where ts.status = 'realizado')                                             as qtd_realizado
from public.transacoes_socio ts
group by ts.mes_referencia
order by ts.mes_referencia;

comment on view public.v_dl_mensal_resumo is
  'Somas do detalhado da Distribuição de Lucro por mês × status — alimenta a tela Distribuição e a conferência com o global da empresa.';

-- Provisionamento anual da empresa: por mês × conta contábil (nível 2), com
-- realizado / em aberto / provisionado separados. Alimenta a tela nova.
create or replace view public.v_provisionamento_anual as
select
  te.mes_referencia,
  substring(te.mes_referencia from 1 for 4)                       as ano,
  te.conta_contabil_cod,
  cf.nome                                                          as conta_contabil_nome,
  cf.natureza,
  coalesce(sum(te.valor) filter (where te.status in
    ('saldo_inicial','recebido','pago','repassado','aplicado','aplicacao','resgatado')), 0) as realizado,
  coalesce(sum(te.valor) filter (where te.status in
    ('a_pagar','a_receber','a_repassar','a_aplicar','a_resgatar')), 0)                      as em_aberto,
  coalesce(sum(te.valor) filter (where te.status in
    ('provisionado','provisionado_dl','provisionado_dv','resgate')), 0)                     as provisionado,
  count(*)                                                                                   as qtd_lancamentos
from public.transacoes_empresa te
join public.classificacao_financeira cf on cf.codigo = te.conta_contabil_cod
group by te.mes_referencia, te.conta_contabil_cod, cf.nome, cf.natureza
order by te.mes_referencia, te.conta_contabil_cod;

comment on view public.v_provisionamento_anual is
  'Empresa por mês × conta (nível 2): realizado, em aberto (a pagar/receber) e provisionado — espelho anual das planilhas de provisionamento.';

-- ----------------------------------------------------------------------------
-- ROLLBACK:
--   drop view if exists public.v_provisionamento_anual;
--   drop view if exists public.v_dl_mensal_resumo;
--   drop function if exists public.fn_concluir_repasse_dl(uuid);
--   drop function if exists public.fn_desfazer_repasse_dl(uuid);
--   drop function if exists public.fn_consolidar_repasse_dl(text, date, boolean);
--   drop trigger if exists tg_ts_sync_prov_dl on public.transacoes_socio;
--   drop function if exists public.tg_ts_sync_provisionado_dl();
--   drop function if exists public.fn_sync_provisionado_dl(text);
--   alter table public.transacoes_socio drop column if exists repasse_id;
-- ----------------------------------------------------------------------------
