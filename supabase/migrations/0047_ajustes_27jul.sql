-- ============================================================================
-- 0047 — Pacote de ajustes 27-jul-2026 (doc "Sistema AramBI - dia 27.07")
-- ============================================================================
-- O que esta migration entrega:
--   1. safra_parametros.deposito_total_programado_kg — o "Depósito Total
--      Programado" do acompanhamento do andamento do depósito da safra
--      (quantidade que o parceiro do arrendamento se compromete a depositar).
--   2. vendas_provisionadas: campos da Taxa de Armazenagem (data de pagamento,
--      ND e banco) + vínculo com a despesa gerada no Financeiro.
--   3. Integração Financeiro ↔ Vendas Futuras:
--      • O trigger de INSERT (0026) passa a SÓ liquidar quando a entrada já
--        nasce Recebida; caso contrário apenas VINCULA (a venda segue Firmada).
--      • Novo trigger de UPDATE: baixa do título como "Recebido" no Financeiro
--        → a venda vinculada (por id ou por NF) vira Liquidada/Parcial.
--      • O casamento por NF aceita ref = "8066969" E ref = "NF 8066969".
--   4. app_config (chave/valor) + toggle 'resgates_automaticos_sicredi':
--      quando 'off', o sistema PARA de criar resgates automáticos do Invest
--      para novos lançamentos no Sicredi (pedido: "deixar no sistema para não
--      ter que reconfigurar" quando passarem a operar direto na conta corrente).
--      Resgates já existentes não são tocados.
--   5. fn_primeiro_dia_util_mes — 1º dia útil do mês (regra da Data do Repasse
--      da Distribuição de Lucro; usada pela nova integralização da planilha).
--
-- Aplicar após a 0046. Nenhuma view existente é alterada.

-- ---------------------------------------------------------------------------
-- 1) Depósito Total Programado (por armazém × cultura × safra)
-- ---------------------------------------------------------------------------
alter table public.safra_parametros
  add column if not exists deposito_total_programado_kg numeric(15,3) not null default 0;

comment on column public.safra_parametros.deposito_total_programado_kg is
  'Quantidade total (kg) que o parceiro do arrendamento se compromete a depositar neste armazém como pagamento — alimenta o painel "Andamento do Depósito da Safra" (ajuste 27-jul). 0 = não configurado.';

-- ---------------------------------------------------------------------------
-- 2) Taxa de Armazenagem na venda: data de pagamento, ND, banco e vínculo
-- ---------------------------------------------------------------------------
alter table public.vendas_provisionadas
  add column if not exists taxa_data_pgto     date,
  add column if not exists taxa_nd            text,
  add column if not exists taxa_banco_id      uuid references public.contas_bancarias_empresa(id) on delete set null,
  add column if not exists taxa_transacao_id  uuid references public.transacoes_empresa(id) on delete set null;

comment on column public.vendas_provisionadas.taxa_data_pgto is
  'Data de pagamento da Taxa de Armazenagem (ajuste 27-jul).';
comment on column public.vendas_provisionadas.taxa_nd is
  'ND (Nota de Débito) da Taxa de Armazenagem (ajuste 27-jul).';
comment on column public.vendas_provisionadas.taxa_banco_id is
  'Banco de pagamento da Taxa de Armazenagem (ajuste 27-jul).';
comment on column public.vendas_provisionadas.taxa_transacao_id is
  'Despesa a pagar gerada no Financeiro para a Taxa de Armazenagem — SEMPRE no Financeiro da empresa, nunca em DL (ajuste 27-jul).';

create index if not exists idx_vp_transacao on public.vendas_provisionadas(transacao_empresa_id);

-- A view v_vendas_provisionadas usa v.* e congela a lista de colunas na
-- criação — precisa ser RECRIADA para expor os campos novos da taxa.
-- (drop + recreate porque a posição das colunas muda; as views agregadas
-- v_vendas_por_trimestre / v_vendas_por_mes dependem dela.)
drop view if exists public.v_vendas_por_mes;
drop view if exists public.v_vendas_por_trimestre;
drop view if exists public.v_vendas_provisionadas;

create view public.v_vendas_provisionadas as
select
  v.*,
  (v.kg / v.kg_por_saca)::numeric(15,4) as sacas,
  ((v.kg / v.kg_por_saca) * v.preco_sc)::numeric(15,2) as valor_total,
  s.nome_completo as socio_destino_nome,
  s.apelido       as socio_destino_apelido,
  public.fn_mes_referencia(v.data_pgto_prevista) as mes_recebimento,
  case
    when extract(month from v.data_pgto_prevista) <= 3 then '1º TRI'
    when extract(month from v.data_pgto_prevista) <= 6 then '2º TRI'
    when extract(month from v.data_pgto_prevista) <= 9 then '3º TRI'
    else '4º TRI'
  end as trimestre_recebimento
from public.vendas_provisionadas v
left join public.socios s on s.id = v.socio_destino_id;

comment on view public.v_vendas_provisionadas is
  'Vendas com sacas, valor_total e mês/trim de recebimento calculados. Recriada na 0047 para expor os campos da Taxa de Armazenagem.';

create view public.v_vendas_por_trimestre as
select
  destino_empresa,
  socio_destino_id,
  cultura,
  safra,
  trimestre_recebimento,
  count(*)                 as qtd,
  sum(sacas)               as sacas_total,
  sum(valor_total)         as valor_total
from public.v_vendas_provisionadas
group by destino_empresa, socio_destino_id, cultura, safra, trimestre_recebimento
order by safra, trimestre_recebimento;

create view public.v_vendas_por_mes as
select
  destino_empresa,
  socio_destino_id,
  cultura,
  safra,
  mes_recebimento,
  count(*)                 as qtd,
  sum(sacas)               as sacas_total,
  sum(valor_total)         as valor_total
from public.v_vendas_provisionadas
group by destino_empresa, socio_destino_id, cultura, safra, mes_recebimento
order by safra, mes_recebimento;

-- ---------------------------------------------------------------------------
-- 3) Integração Financeiro ↔ Vendas Futuras
-- ---------------------------------------------------------------------------
-- Encontra a venda "casada" com uma transação: primeiro pelo vínculo direto
-- (transacao_empresa_id), depois pela NF (ref = nota_fiscal ou "NF <nf>").
-- Retorna também o valor total da venda para decidir liquidada × parcial.
create or replace function public.fn_venda_da_transacao(p_transacao_id uuid, p_ref text)
returns table (venda_id uuid, total_venda numeric)
language sql
stable
as $$
  select v.id,
         (v.kg / nullif(v.kg_por_saca, 0)) * v.preco_sc
    from public.vendas_provisionadas v
   where v.status in ('firmada', 'parcial')
     and (
       v.transacao_empresa_id = p_transacao_id
       or (
         p_ref is not null and p_ref <> ''
         and v.nota_fiscal is not null and v.nota_fiscal <> ''
         and (v.nota_fiscal = p_ref or ('NF ' || v.nota_fiscal) = p_ref)
       )
     )
   order by (v.transacao_empresa_id = p_transacao_id) desc, v.created_at
   limit 1
$$;

comment on function public.fn_venda_da_transacao(uuid, text) is
  'Localiza a venda futura correspondente a uma transação (vínculo direto ou NF, aceitando "NF 123" no ref). Migration 0047.';

-- INSERT: vincula a venda à entrada; só marca Liquidada/Parcial se a entrada
-- já nasce RECEBIDA (antes, 0026, qualquer insert com NF casada liquidava —
-- o que atropelaria as contas a receber geradas pela própria venda).
create or replace function public.tg_auto_link_venda_nf()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venda record;
begin
  if new.valor <= 0 then return new; end if;

  select * into v_venda from public.fn_venda_da_transacao(new.id, new.ref);
  if v_venda.venda_id is null then return new; end if;

  update public.vendas_provisionadas
     set transacao_empresa_id = new.id,
         status = case
           when new.status = 'recebido' and new.valor >= v_venda.total_venda - 0.5 then 'liquidada'::public.venda_status
           when new.status = 'recebido'                                            then 'parcial'::public.venda_status
           else status  -- ainda não recebido → só vincula, venda segue como está
         end,
         updated_at = now()
   where id = v_venda.venda_id
     and transacao_empresa_id is distinct from new.id;

  return new;
end;
$$;

comment on function public.tg_auto_link_venda_nf is
  'Vincula venda_provisionada ↔ transacao_empresa no INSERT (por id ou NF). Só liquida se a entrada já nasce Recebida. Migrations 0026/0047.';

-- (o trigger de INSERT tg_te_auto_link_venda já existe desde a 0026 e passa a
-- usar a nova versão da função acima; recriamos por segurança.)
drop trigger if exists tg_te_auto_link_venda on public.transacoes_empresa;
create trigger tg_te_auto_link_venda
  after insert on public.transacoes_empresa
  for each row execute function public.tg_auto_link_venda_nf();

-- UPDATE: baixa como "Recebido" → venda Firmada vira Liquidada (ou Parcial).
create or replace function public.tg_venda_baixa_recebido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venda record;
begin
  if new.status <> 'recebido' or old.status = 'recebido' then return new; end if;
  if new.valor <= 0 then return new; end if;

  select * into v_venda from public.fn_venda_da_transacao(new.id, new.ref);
  if v_venda.venda_id is null then return new; end if;

  update public.vendas_provisionadas
     set transacao_empresa_id = new.id,
         status = case
           when new.valor >= v_venda.total_venda - 0.5 then 'liquidada'::public.venda_status
           else 'parcial'::public.venda_status
         end,
         updated_at = now()
   where id = v_venda.venda_id;

  return new;
end;
$$;

comment on function public.tg_venda_baixa_recebido is
  'Ao dar baixa de um título como Recebido no Financeiro, a venda futura vinculada (por id ou NF) muda de Firmada para Liquidada/Parcial automaticamente. Migration 0047.';

drop trigger if exists tg_te_venda_baixa_recebido on public.transacoes_empresa;
create trigger tg_te_venda_baixa_recebido
  after update of status on public.transacoes_empresa
  for each row execute function public.tg_venda_baixa_recebido();

-- ---------------------------------------------------------------------------
-- 4) app_config + toggle dos resgates automáticos do Sicredi
-- ---------------------------------------------------------------------------
create table if not exists public.app_config (
  chave       text primary key,
  valor       text not null,
  descricao   text,
  updated_at  timestamptz not null default now()
);

comment on table public.app_config is
  'Configurações gerais do sistema (chave/valor) — editáveis em Configurações → Automações. Migration 0047.';

drop trigger if exists tg_app_config_updated_at on public.app_config;
create trigger tg_app_config_updated_at
  before update on public.app_config
  for each row execute function public.tg_set_updated_at();

alter table public.app_config enable row level security;
drop policy if exists app_config_read on public.app_config;
create policy app_config_read on public.app_config
  for select using (auth.uid() is not null);
drop policy if exists app_config_write on public.app_config;
create policy app_config_write on public.app_config
  for all using (public.fn_is_admin()) with check (public.fn_is_admin());

insert into public.app_config (chave, valor, descricao) values
  ('resgates_automaticos_sicredi', 'on',
   'on = despesas na conta Sicredi geram resgate automático do Invest (modelo atual). off = sem resgates automáticos (operação direta na conta corrente).')
on conflict (chave) do nothing;

-- Helper: os resgates automáticos estão ativos? (default: sim)
create or replace function public.fn_resgates_auto_sicredi_ativos()
returns boolean
language sql
stable
as $$
  select coalesce(
    (select valor from public.app_config where chave = 'resgates_automaticos_sicredi'),
    'on'
  ) <> 'off'
$$;

comment on function public.fn_resgates_auto_sicredi_ativos() is
  'Toggle dos resgates automáticos Sicredi Invest (Configurações → Automações). Migration 0047.';

-- Patch no trigger de vínculo (0044): com o toggle OFF, novos lançamentos no
-- Sicredi NÃO ganham vínculo com resgate automático (nada é criado). Vínculos
-- e resgates já existentes permanecem intocados — dá para religar a qualquer
-- momento sem perder nada.
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
    -- Toggle OFF (0047): não cria vínculo/resgate para lançamentos novos.
    if v_eh_driver and public.fn_resgates_auto_sicredi_ativos() then
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
    -- Toggle OFF (0047): não cria vínculo novo.
    if not v_era_driver and public.fn_resgates_auto_sicredi_ativos() then
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

comment on function public.tg_te_resgate_invest_link() is
  'Mantém o vínculo título → resgate automático Sicredi Invest (0044). Respeita o toggle resgates_automaticos_sicredi (0047): OFF = não cria vínculos novos.';

-- ---------------------------------------------------------------------------
-- 5) 1º dia útil do mês (regra da Data do Repasse — DL)
-- ---------------------------------------------------------------------------
-- Usa fn_eh_feriado_nacional (0044). Ex.: agosto/2026 → 03/08/2026 (seg).
create or replace function public.fn_primeiro_dia_util_mes(p_mes date)
returns date
language plpgsql
immutable
as $$
declare
  v_dia date := date_trunc('month', p_mes)::date;
begin
  while extract(isodow from v_dia) in (6, 7) or public.fn_eh_feriado_nacional(v_dia) loop
    v_dia := v_dia + 1;
  end loop;
  return v_dia;
end;
$$;

comment on function public.fn_primeiro_dia_util_mes(date) is
  'Primeiro dia útil (seg–sex, fora feriado nacional) do mês da data informada. Regra da Data do Repasse dos provisionados da DL (ajuste 27-jul).';

-- ---------------------------------------------------------------------------
-- 6) SOMASE da DL: o guard de "provisionado manual" passa a olhar SÓ o centro
--    2.8.1 (Distribuição de Lucros) — antes qualquer provisionado na conta 2.8
--    (ex.: Plano de Saúde Bradesco, centro 2.8.3) bloqueava a sincronização
--    automática do Provisionado DL (caso real encontrado na reintegralização
--    de 28-jul: ago–dez travados por R$ 9.772,07/mês de Plano de Saúde).
-- ---------------------------------------------------------------------------
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

  if not exists (select 1 from public.classificacao_financeira where codigo = '2.8')
     or not exists (select 1 from public.classificacao_financeira where codigo = '2.8.1') then
    return;
  end if;

  -- Mês com provisionado MANUAL no centro 2.8.1 → gestão manual, não interfere.
  -- (Outros centros da 2.8 — ex.: 2.8.3 Plano de Saúde — não bloqueiam mais.)
  if exists (
    select 1 from public.transacoes_empresa
    where mes_referencia = p_mes
      and centro_custo_cod = '2.8.1'
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
  null;
end;
$$;

comment on function public.fn_sync_provisionado_dl(text) is
  'SOMASE da DL: mantém o global Provisionado DL (2.8/2.8.1) igual à soma do detalhado provisionado do mês. Só é bloqueado por provisionado MANUAL no centro 2.8.1 (0047 — antes a conta 2.8 inteira bloqueava).';

-- Ressincroniza TODOS os meses com detalhado provisionado (idempotente): com o
-- guard corrigido, os meses que estavam travados (ago–dez) ganham o dl_auto.
do $$
declare
  v_mes text;
begin
  for v_mes in select distinct mes_referencia from public.transacoes_socio where status = 'provisionado' loop
    perform public.fn_sync_provisionado_dl(v_mes);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- ROLLBACK:
--   -- restaurar fn_sync_provisionado_dl da 0036 (guard pela conta 2.8 inteira)
--   drop function if exists public.fn_primeiro_dia_util_mes(date);
--   -- restaurar tg_te_resgate_invest_link da 0044 (sem o toggle)
--   drop function if exists public.fn_resgates_auto_sicredi_ativos();
--   drop table if exists public.app_config;
--   drop trigger if exists tg_te_venda_baixa_recebido on public.transacoes_empresa;
--   drop function if exists public.tg_venda_baixa_recebido();
--   -- restaurar tg_auto_link_venda_nf da 0026
--   drop function if exists public.fn_venda_da_transacao(uuid, text);
--   alter table public.vendas_provisionadas
--     drop column if exists taxa_transacao_id,
--     drop column if exists taxa_banco_id,
--     drop column if exists taxa_nd,
--     drop column if exists taxa_data_pgto;
--   alter table public.safra_parametros drop column if exists deposito_total_programado_kg;
-- ----------------------------------------------------------------------------
