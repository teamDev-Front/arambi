-- ============================================================================
-- 0044 — Ajustes 23-jul-2026 (doc "Sistema AramBI - dia 23.07")
-- ============================================================================
-- Entregas desta migration (a parte de banco do pacote; o resto é frontend):
--
--   1. transacoes_socio.data_vencimento_despesa — o campo "Vencimento" novo da
--      Distribuição de Lucro (vencimento da FATURA). O data_vencimento existente
--      passa a se chamar "Data do Repasse" NA UI (a coluna do banco não muda de
--      nome para não quebrar views/relatórios/scripts).
--
--   2. Consolidação da Distribuição de Lucro: o lançamento global 2.8 passa a
--      nascer como "A repassar" (a_repassar) em vez de "A pagar" — pedido
--      explícito: "por se tratar de um repasse de distribuição de lucros".
--      fn_desfazer/fn_concluir aceitam ambos (linhas antigas continuam ok).
--
--   3. RESGATES AUTOMÁTICOS SICREDI INVEST — substitui o gatilho mensal da
--      migration 0034 por um modelo por DATA: todo lançamento de saída na conta
--      corrente "Cooperativa Sicredi (0913)" programa um resgate para o DIA ÚTIL
--      ANTERIOR ao vencimento; títulos que caem no mesmo dia útil são
--      consolidados num único resgate. Regras de status:
--        • título Provisionado  → resgate nasce/fica "Resgate"
--        • título A pagar       → resgate vira "A resgatar"
--        • título Pago          → NENHUMA alteração automática (baixa do resgate
--          continua manual: A resgatar → Resgatado, conferindo o extrato)
--      Validação de saldo da conta "Cooperativa Sicredi Investimento (0913)":
--      só ativa quando a conta Invest tiver lançamentos no sistema (ex.: um
--      "Saldo inicial" lançado nela pelo Financeiro). Hoje ela está zerada/sem
--      uso — validar contra 0 bloquearia TODO lançamento do Sicredi.
--
--   4. v_fluxo_caixa_bancos — saldo inicial/final POR BANCO por mês (contas
--      correntes ativas: CORA, SICREDI 0913, INTER) para a conferência com os
--      extratos no Fluxo de Caixa da Home.
--
-- ⚠ Reimport/seed da planilha: como na 0034, DESABILITE os triggers de resgate
--   durante o import (alter table public.transacoes_empresa disable trigger
--   tg_te_resgate_invest_link; ... disable trigger tg_te_resgate_invest_recalc;)
--   e reabilite ao final — senão o import duplica resgates.
--
-- Rollback ao final do arquivo.

-- ---------------------------------------------------------------------------
-- 1) Distribuição de Lucro — campo "Vencimento" (da despesa/fatura)
-- ---------------------------------------------------------------------------
alter table public.transacoes_socio
  add column if not exists data_vencimento_despesa date;

comment on column public.transacoes_socio.data_vencimento_despesa is
  'Vencimento da DESPESA/fatura (campo "Vencimento" da tela). O data_vencimento existente é a "Data do Repasse" (data programada do repasse ao sócio). Migration 0044.';

comment on column public.transacoes_socio.data_vencimento is
  '"Data do Repasse" na UI — data programada para realização do repasse ao sócio. (O vencimento da fatura fica em data_vencimento_despesa — migration 0044.)';

create index if not exists idx_ts_venc_despesa on public.transacoes_socio(data_vencimento_despesa);
create index if not exists idx_ts_vencimento   on public.transacoes_socio(data_vencimento);

-- ---------------------------------------------------------------------------
-- 2) Consolidação DL → global nasce "A repassar"
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
    raise exception 'Nenhum lançamento detalhado com status "A repassar" (e sem repasse) em %.', p_mes;
  end if;
  if v_soma <= 0 then
    raise exception 'A soma do detalhado "A repassar" de % é R$ % — verifique os valores antes de consolidar.', p_mes, v_soma;
  end if;

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

  v_mes_humano := substring(p_mes from 6 for 2) || '/' || substring(p_mes from 1 for 4);

  -- (c) Global 2.8 — nasce "A repassar" (ajuste 23-jul; antes era a_pagar).
  insert into public.transacoes_empresa (
    data, conta_contabil_cod, centro_custo_cod, tipo_despesa,
    descricao, obs_obra, forma_pgto, conta_bancaria_id,
    status, valor, observacao, origem_planilha
  ) values (
    p_data, '2.8', '2.8.1', 'sem',
    'Distribuição de Lucro — repasse ' || v_mes_humano,
    'sem', 'transferencia', v_inter,
    'a_repassar', -v_soma,
    'Consolidado automaticamente de ' || v_qtd || ' lançamento(s) detalhado(s) por sócio (tela Distribuição de Lucro).',
    v_grupo
  ) returning id into v_global;

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
  'Consolida o detalhado "A repassar" do mês em lançamentos globais da empresa (par Cora→Inter + saída 2.8 do Inter, status a_repassar) e vincula via repasse_id. Atômico. Atualizada na migration 0044.';

-- Desfazer: aceita o global novo (a_repassar) e os antigos (a_pagar).
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
    where origem_planilha = v_tag and status not in ('a_pagar', 'a_receber', 'a_repassar')
  ) then
    raise exception 'Este repasse já tem lançamentos baixados (Pago/Recebido/Repassado) — dê baixa manualmente ou estorne antes de desfazer.';
  end if;

  update public.transacoes_socio set repasse_id = null where repasse_id = p_repasse_id;
  delete from public.transacoes_empresa where origem_planilha = v_tag;
end;
$$;

-- Concluir: baixa o global 2.8 tanto a_repassar (novo) quanto a_pagar (legado).
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

  update public.transacoes_empresa set status = 'repassado'
   where origem_planilha = v_tag and conta_contabil_cod = '2.8' and status in ('a_pagar', 'a_repassar');
  update public.transacoes_empresa set status = 'pago'
   where origem_planilha = v_tag and conta_contabil_cod = '2.9' and status = 'a_pagar';
  update public.transacoes_empresa set status = 'recebido'
   where origem_planilha = v_tag and conta_contabil_cod = '1.9' and status = 'a_receber';

  update public.transacoes_socio set status = 'realizado'
   where repasse_id = p_repasse_id and status = 'a_pagar';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) RESGATES AUTOMÁTICOS SICREDI INVEST
-- ---------------------------------------------------------------------------
-- Modelo: cada TÍTULO (saída na conta corrente Sicredi 0913) fica VINCULADO ao
-- seu lançamento de resgate via transacoes_empresa.resgate_auto_id. O resgate
-- automático (origem_planilha = 'auto:resgate_invest:<data>') vale a soma dos
-- títulos vinculados. O vínculo explícito evita dupla contagem com os resgates
-- manuais/importados da planilha (que NÃO têm vínculo e seguem intocados).

alter table public.transacoes_empresa
  add column if not exists resgate_auto_id uuid references public.transacoes_empresa(id) on delete set null;

create index if not exists idx_te_resgate_auto on public.transacoes_empresa(resgate_auto_id);

comment on column public.transacoes_empresa.resgate_auto_id is
  'Resgate automático (lançamento 1.8 no Sicredi 0913) que cobre este título. Mantido pelos triggers tg_te_resgate_invest_*. Migration 0044.';

-- Dia útil imediatamente anterior: pula sábado/domingo, feriados nacionais
-- fixos (incl. 20/11 — Lei 14.759/2023) e Sexta-feira Santa (computus).
create or replace function public.fn_pascoa(p_ano int)
returns date
language sql
immutable
as $$
  -- Algoritmo de Meeus/Jones/Butcher (calendário gregoriano).
  with c as (
    select p_ano as y,
           p_ano % 19 as a,
           p_ano / 100 as b,
           p_ano % 100 as cc
  ), d as (
    select y, a, b, cc,
           b / 4 as dd, b % 4 as e, (b + 8) / 25 as f
    from c
  ), g as (
    select *, (b - f + 1) / 3 as gg from d
  ), h as (
    select *, (19 * a + b - dd - gg + 15) % 30 as hh from g
  ), i as (
    select *, cc / 4 as ii, cc % 4 as k from h
  ), l as (
    select *, (32 + 2 * e + 2 * ii - hh - k) % 7 as ll from i
  ), m as (
    select *, (a + 11 * hh + 22 * ll) / 451 as mm from l
  )
  select make_date(y, (hh + ll - 7 * mm + 114) / 31, ((hh + ll - 7 * mm + 114) % 31) + 1)
  from m
$$;

create or replace function public.fn_eh_feriado_nacional(p_data date)
returns boolean
language sql
immutable
as $$
  select
    (extract(month from p_data)::int, extract(day from p_data)::int) in
      ((1,1),(4,21),(5,1),(9,7),(10,12),(11,2),(11,15),(11,20),(12,25))
    or p_data = public.fn_pascoa(extract(year from p_data)::int) - 2  -- Sexta-feira Santa
$$;

comment on function public.fn_eh_feriado_nacional(date) is
  'Feriados nacionais fixos + Sexta-feira Santa. Feriados móveis facultativos (Carnaval, Corpus Christi) e municipais NÃO entram — nesses dias o resgate cai no dia mesmo assim (ajuste manual se necessário). Migration 0044.';

create or replace function public.fn_dia_util_anterior(p_data date)
returns date
language plpgsql
immutable
as $$
declare
  d date := p_data - 1;
  guard int := 0;
begin
  if p_data is null then return null; end if;
  while (extract(isodow from d)::int in (6, 7) or public.fn_eh_feriado_nacional(d)) and guard < 30 loop
    d := d - 1;
    guard := guard + 1;
  end loop;
  return d;
end;
$$;

comment on function public.fn_dia_util_anterior(date) is
  'Dia útil imediatamente anterior à data (pula fins de semana e feriados nacionais). Migration 0044.';

-- Contas fixas do fluxo (mesma identificação da 0034).
create or replace function public.fn_conta_sicredi_corrente()
returns uuid language sql stable as $$
  select id from public.contas_bancarias_empresa
   where nome = 'Cooperativa Sicredi (0913)' limit 1
$$;

create or replace function public.fn_conta_sicredi_invest()
returns uuid language sql stable as $$
  select id from public.contas_bancarias_empresa
   where nome = 'Cooperativa Sicredi Investimento (0913)'
      or apelido = 'SICREDINVEST'
   order by ativa desc limit 1
$$;

-- Recalcula um resgate automático a partir dos títulos vinculados:
-- valor = soma dos títulos; status resgate/a_resgatar conforme os títulos;
-- some os vínculos → o resgate é removido. NUNCA mexe em resgate 'resgatado'
-- (a confirmação é manual e congela a linha).
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

  -- Provisionado → 'resgate'; qualquer título já confirmado (A pagar em diante)
  -- → 'a_resgatar'. A baixa do título (Pago) NÃO muda nada aqui: 'pago' também
  -- está no grupo "confirmado", então valor e status permanecem como estavam.
  v_status_novo := case when v_tem_confirmado then 'a_resgatar' else 'resgate' end;

  -- Validação de saldo do Invest — só quando o valor AUMENTA e a conta Invest
  -- tem lançamentos no sistema (senão o saldo é desconhecido e não bloqueia).
  -- p_validar=false na transição da migration (reorganização de resgates que
  -- já existiam não pode ser bloqueada).
  if p_validar
     and v_total > v_resgate.valor
     and v_invest is not null
     and exists (select 1 from public.transacoes_empresa where conta_bancaria_id = v_invest) then

    select coalesce(sum(valor) filter (where status in
      ('saldo_inicial','recebido','pago','repassado','aplicado','aplicacao','resgatado')), 0)
      into v_saldo_invest
      from public.transacoes_empresa
     where conta_bancaria_id = v_invest;

    -- Todos os resgates ainda pendentes na corrente (menos este) já "reservam"
    -- dinheiro do Invest.
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
  'Recalcula um resgate automático Sicredi Invest a partir dos títulos vinculados (valor/status), removendo-o se ficar sem vínculo. Não toca em resgates já Resgatados. Valida o saldo do Invest quando a conta tem lançamentos. Migration 0044.';

-- Localiza (ou cria) o resgate automático ABERTO do dia útil D.
create or replace function public.fn_resgate_invest_obter(p_dia date)
returns uuid
language plpgsql
as $$
declare
  v_sic  uuid := public.fn_conta_sicredi_corrente();
  v_forn uuid;
  v_id   uuid;
  v_tag  text := 'auto:resgate_invest:' || to_char(p_dia, 'YYYY-MM-DD');
begin
  select id into v_id
    from public.transacoes_empresa
   where origem_planilha = v_tag
     and status in ('resgate', 'a_resgatar')
   order by created_at
   limit 1;
  if v_id is not null then return v_id; end if;

  select id into v_forn
    from public.fornecedores
   where nome = 'Banco Cooperativa Sicredi'
   limit 1;

  insert into public.transacoes_empresa
    (data, conta_contabil_cod, centro_custo_cod, tipo_despesa, obs_obra,
     forma_pgto, conta_bancaria_id, status, valor,
     fornecedor_id, fornecedor_nome, descricao, origem_planilha)
  values
    (p_dia, '1.8', '1.8.1', 'sem', 'sem', 'sem',
     v_sic, 'resgate', 0,
     v_forn, 'Banco Cooperativa Sicredi',
     'Resgate da Conta Investimento Invest - Reserva p/ Construção da Sede',
     v_tag)
  returning id into v_id;
  return v_id;
end;
$$;

-- BEFORE: mantém o VÍNCULO título → resgate.
--   • INSERT de saída no Sicredi 0913 → vincula ao resgate do dia útil anterior
--     ao vencimento (cria se não existir).
--   • UPDATE que muda o vencimento → move o vínculo para o novo dia (a menos
--     que o resgate atual já esteja Resgatado — aí fica congelado).
--   • UPDATE que tira o lançamento do Sicredi (troca de banco / vira entrada)
--     → desfaz o vínculo.
--   • Títulos ANTIGOS sem vínculo (cobertos pelos resgates manuais importados
--     da planilha) NUNCA ganham vínculo por mudança de status — só quem entra
--     no Sicredi a partir de agora.
create or replace function public.tg_te_resgate_invest_link()
returns trigger
language plpgsql
as $$
declare
  v_sic         uuid;
  v_eh_driver   boolean;
  v_era_driver  boolean;
  v_status_resgate public.status_aramburu;
  v_dia         date;
  v_tag_dia     text;
begin
  -- Mudanças feitas pelos próprios triggers (recalc/criação de resgate) não
  -- re-entram na lógica de vínculo.
  if pg_trigger_depth() > 1 then return new; end if;

  v_sic := public.fn_conta_sicredi_corrente();
  if v_sic is null then return new; end if;

  -- O próprio resgate automático nunca é "título".
  if new.origem_planilha like 'auto:resgate_invest:%' then return new; end if;

  v_eh_driver := new.conta_bancaria_id = v_sic
             and new.valor < 0
             and new.status <> 'saldo_inicial';

  if tg_op = 'INSERT' then
    if v_eh_driver then
      new.resgate_auto_id := public.fn_resgate_invest_obter(public.fn_dia_util_anterior(new.data));
    end if;
    return new;
  end if;

  -- UPDATE
  v_era_driver := old.conta_bancaria_id = v_sic
              and old.valor < 0
              and old.status <> 'saldo_inicial';

  if not v_eh_driver then
    -- Saiu do escopo (trocou de banco, virou entrada…) → desvincula; o AFTER
    -- recalcula o resgate antigo pelo old.resgate_auto_id.
    new.resgate_auto_id := null;
    return new;
  end if;

  if new.resgate_auto_id is null then
    -- Entrou no escopo AGORA (veio de outro banco) → vincula. Se já era do
    -- Sicredi e estava sem vínculo (histórico da planilha), permanece manual.
    if not v_era_driver then
      new.resgate_auto_id := public.fn_resgate_invest_obter(public.fn_dia_util_anterior(new.data));
    end if;
    return new;
  end if;

  -- Vinculado e mudou o vencimento → move para o resgate do novo dia útil,
  -- exceto se o resgate atual já foi confirmado (Resgatado = congelado).
  if new.data is distinct from old.data then
    select status, origem_planilha into v_status_resgate, v_tag_dia
      from public.transacoes_empresa where id = new.resgate_auto_id;
    if v_status_resgate is null then
      new.resgate_auto_id := public.fn_resgate_invest_obter(public.fn_dia_util_anterior(new.data));
    elsif v_status_resgate <> 'resgatado' then
      v_dia := public.fn_dia_util_anterior(new.data);
      if v_tag_dia is distinct from ('auto:resgate_invest:' || to_char(v_dia, 'YYYY-MM-DD')) then
        new.resgate_auto_id := public.fn_resgate_invest_obter(v_dia);
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- AFTER: recalcula os resgates afetados (o antigo e o novo, quando mudou).
create or replace function public.tg_te_resgate_invest_recalc()
returns trigger
language plpgsql
as $$
declare
  v_old uuid := case when tg_op in ('UPDATE', 'DELETE') then old.resgate_auto_id end;
  v_new uuid := case when tg_op in ('INSERT', 'UPDATE') then new.resgate_auto_id end;
begin
  if pg_trigger_depth() > 1 then return null; end if;

  if v_old is not null and v_old is distinct from v_new then
    perform public.fn_resgate_invest_recalc(v_old);
  end if;
  if v_new is not null then
    perform public.fn_resgate_invest_recalc(v_new);
  end if;
  return null;
end;
$$;

drop trigger if exists tg_te_resgate_invest_link on public.transacoes_empresa;
create trigger tg_te_resgate_invest_link
  before insert or update on public.transacoes_empresa
  for each row execute function public.tg_te_resgate_invest_link();

drop trigger if exists tg_te_resgate_invest_recalc on public.transacoes_empresa;
create trigger tg_te_resgate_invest_recalc
  after insert or update or delete on public.transacoes_empresa
  for each row execute function public.tg_te_resgate_invest_recalc();

-- Desliga o modelo antigo (0034 — resgate mensal do provisionado eventual).
drop trigger if exists tg_sync_resgate_sicredi on public.transacoes_empresa;
drop function if exists public.fn_sync_resgate_sicredi();

-- ---------------------------------------------------------------------------
-- 3b) Transição: troca as linhas mensais automáticas pelo modelo por data
-- ---------------------------------------------------------------------------
-- As linhas mensais 'auto:resgate_sicredi' ainda em status 'resgate' são pura
-- projeção (não entram no saldo realizado — 0033) e cobrem exatamente os
-- títulos PROVISIONADOS do Sicredi. Removemos essas linhas e geramos os
-- resgates por data para os mesmos títulos — o total projetado não muda, só a
-- granularidade. Títulos A pagar/Pagos antigos já têm resgates manuais
-- importados da planilha e ficam FORA (sem vínculo, sem dupla contagem).
do $$
declare
  v_sic uuid := public.fn_conta_sicredi_corrente();
  r record;
  v_resgate uuid;
begin
  if v_sic is null then return; end if;

  -- Triggers de vínculo não devem rodar durante a transição.
  alter table public.transacoes_empresa disable trigger tg_te_resgate_invest_link;
  alter table public.transacoes_empresa disable trigger tg_te_resgate_invest_recalc;

  delete from public.transacoes_empresa
   where origem_planilha = 'auto:resgate_sicredi'
     and status = 'resgate';

  for r in
    select id, data
      from public.transacoes_empresa
     where conta_bancaria_id = v_sic
       and valor < 0
       and resgate_auto_id is null
       and status in ('provisionado', 'provisionado_dl', 'provisionado_dv')
     order by data
  loop
    v_resgate := public.fn_resgate_invest_obter(public.fn_dia_util_anterior(r.data));
    update public.transacoes_empresa set resgate_auto_id = v_resgate where id = r.id;
  end loop;

  alter table public.transacoes_empresa enable trigger tg_te_resgate_invest_link;
  alter table public.transacoes_empresa enable trigger tg_te_resgate_invest_recalc;

  -- Consolida valores/status dos resgates recém-criados (sem validação de
  -- saldo: é reorganização de projeções que já existiam).
  for r in
    select distinct resgate_auto_id as id
      from public.transacoes_empresa
     where resgate_auto_id is not null
  loop
    perform public.fn_resgate_invest_recalc(r.id, false);
  end loop;
end$$;

-- ---------------------------------------------------------------------------
-- 3c) Fornecedores: editores também podem cadastrar (autocomplete 23-jul)
-- ---------------------------------------------------------------------------
-- O campo Fornecedor do lançamento virou caixa de seleção com busca e o nome
-- digitado vira cadastro automaticamente ao salvar. Na 0009 a escrita em
-- `fornecedores` era admin-only; como o cadastro agora cresce pelo fluxo de
-- lançamento (que editores já executam), liberamos escrita para admin/editor.
drop policy if exists fornecedores_write on public.fornecedores;
create policy fornecedores_write on public.fornecedores
  for all using (public.fn_can_write()) with check (public.fn_can_write());

-- ---------------------------------------------------------------------------
-- 4) Fluxo de Caixa — saldo inicial/final por banco (conferência de extrato)
-- ---------------------------------------------------------------------------
-- Só contas correntes ATIVAS (hoje: CORA, SICREDI 0913, INTER — o pedido do
-- doc 23-jul). Considera apenas o REALIZADO (mesmo conjunto de status do
-- saldo_atual da 0033: 'resgate' provisionado fica de fora) — é o que bate com
-- o extrato bancário no fechamento do mês.
create or replace view public.v_fluxo_caixa_bancos as
with meses as (
  select distinct mes_referencia
    from public.transacoes_empresa
   where mes_referencia is not null
),
contas as (
  select id, nome, apelido, banco, ordem
    from public.contas_bancarias_empresa
   where ativa = true and tipo = 'corrente'
),
mov as (
  select te.mes_referencia, te.conta_bancaria_id,
         coalesce(sum(te.valor) filter (where te.status in
           ('saldo_inicial','recebido','pago','repassado','aplicado','aplicacao','resgatado')), 0) as movimento
    from public.transacoes_empresa te
   where te.mes_referencia is not null
   group by 1, 2
),
grade as (
  select m.mes_referencia, c.id as conta_bancaria_id, c.nome, c.apelido, c.banco, c.ordem,
         coalesce(v.movimento, 0) as movimento
    from meses m
   cross join contas c
    left join mov v on v.mes_referencia = m.mes_referencia and v.conta_bancaria_id = c.id
),
acc as (
  select *,
         sum(movimento) over (partition by conta_bancaria_id order by mes_referencia
                              rows between unbounded preceding and current row) as saldo_final
    from grade
)
select
  mes_referencia,
  conta_bancaria_id,
  nome    as banco_nome,
  apelido as banco_apelido,
  banco   as banco_instituicao,
  ordem   as banco_ordem,
  (saldo_final - movimento)::numeric(15,2) as saldo_inicial,
  movimento::numeric(15,2)                 as movimento_mes,
  saldo_final::numeric(15,2)               as saldo_final
from acc
order by mes_referencia, ordem nulls last;

comment on view public.v_fluxo_caixa_bancos is
  'Saldo inicial/final REALIZADO por banco (contas correntes ativas) por mês — conferência com os extratos bancários no Fluxo de Caixa da Home. Migration 0044.';

-- ----------------------------------------------------------------------------
-- ROLLBACK:
--   drop view if exists public.v_fluxo_caixa_bancos;
--   drop trigger if exists tg_te_resgate_invest_recalc on public.transacoes_empresa;
--   drop trigger if exists tg_te_resgate_invest_link on public.transacoes_empresa;
--   drop function if exists public.tg_te_resgate_invest_recalc();
--   drop function if exists public.tg_te_resgate_invest_link();
--   drop function if exists public.fn_resgate_invest_obter(date);
--   drop function if exists public.fn_resgate_invest_recalc(uuid, boolean);
--   drop function if exists public.fn_conta_sicredi_invest();
--   drop function if exists public.fn_conta_sicredi_corrente();
--   drop function if exists public.fn_dia_util_anterior(date);
--   drop function if exists public.fn_eh_feriado_nacional(date);
--   drop function if exists public.fn_pascoa(int);
--   delete from public.transacoes_empresa where origem_planilha like 'auto:resgate_invest:%' and status in ('resgate','a_resgatar');
--   alter table public.transacoes_empresa drop column if exists resgate_auto_id;
--   alter table public.transacoes_socio drop column if exists data_vencimento_despesa;
--   -- Reexecutar as fn_*_repasse_dl da migration 0036 e o trigger da 0034.
-- ----------------------------------------------------------------------------
