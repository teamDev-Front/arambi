-- ============================================================================
-- AramBI — Ajustes 12 de junho (Home > Financeiro) — DELTA
-- ============================================================================
-- Aplica SÓ as mudanças desta rodada, na ordem certa. 100% idempotente
-- (pode rodar várias vezes). Use isto no SQL Editor do Supabase em vez de
-- re-rodar o apply_all.sql inteiro.
--
-- Pré-requisitos (já existem na produção): transacoes_empresa,
-- contas_bancarias_empresa, pdfmonkey_geracoes.
--
-- Conteúdo:
--   0029 — coluna Emissão (data_emissao) em transacoes_empresa
--   0030 — numero_banco + tipo_instituicao + view v_saldo_atual_por_banco
--   0031 — scope_applied em pdfmonkey_geracoes
--   0032 — view v_fluxo_caixa_mensal (Saldo − contas do próximo mês)
--   seed 12 — reconciliação das contas bancárias (CORA/SICREDI/SICREDINVEST/INTER/XP)
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0029 — Emissão
-- ----------------------------------------------------------------------------
alter table public.transacoes_empresa
  add column if not exists data_emissao date;

comment on column public.transacoes_empresa.data_emissao is
  'Data de emissão da NF/documento (RF-FIN-06). Distinta de `data` (vencimento). Nullable.';

create index if not exists idx_te_data_emissao
  on public.transacoes_empresa(data_emissao);


-- ----------------------------------------------------------------------------
-- 0030 — Identificação bancária (numero_banco + tipo_instituicao) + view
-- ----------------------------------------------------------------------------
alter table public.contas_bancarias_empresa
  add column if not exists numero_banco     text,
  add column if not exists tipo_instituicao text not null default 'banco';

comment on column public.contas_bancarias_empresa.numero_banco is
  'Código do banco no BACEN (3 dígitos). Ex: 403 Cora, 748 Sicredi, 077 Inter, 348 XP.';
comment on column public.contas_bancarias_empresa.tipo_instituicao is
  'banco | cooperativa — define o rótulo exibido no card ("Banco 403" vs "Cooperativa 748").';

-- DROP + CREATE (não OR REPLACE) p/ ser idempotente mesmo com a view já em
-- outra forma — evita "cannot drop columns from view".
drop view if exists public.v_saldo_atual_por_banco;
create view public.v_saldo_atual_por_banco as
select
  cb.id                as conta_bancaria_id,
  cb.nome              as banco_nome,
  cb.apelido           as banco_apelido,
  cb.banco             as banco_instituicao,
  cb.agencia           as banco_agencia,
  cb.ordem             as banco_ordem,

  coalesce(sum(te.valor) filter (
    where te.status in (
      'saldo_inicial','recebido','pago','repassado','aplicado','aplicacao','resgatado','resgate'
    )
  ), 0)                                                           as saldo_atual,

  coalesce(sum(te.valor) filter (where te.status = 'a_pagar'),    0) as a_pagar,
  coalesce(sum(te.valor) filter (where te.status = 'a_receber'),  0) as a_receber,
  coalesce(sum(te.valor) filter (where te.status = 'a_repassar'), 0) as a_repassar,
  coalesce(sum(te.valor) filter (where te.status = 'a_resgatar'), 0) as a_resgatar,
  coalesce(sum(te.valor) filter (
    where te.status in ('provisionado','provisionado_dl','provisionado_dv')
  ), 0)                                                           as provisionado,

  coalesce(sum(te.valor) filter (
    where te.status in ('saldo_inicial','recebido','resgatado','resgate','aplicacao')
  ), 0)                                                           as entradas_realizadas,
  coalesce(sum(te.valor) filter (
    where te.status in ('pago','repassado','aplicado')
  ), 0)                                                           as saidas_realizadas,

  coalesce(sum(te.valor) filter (
    where te.status in (
      'saldo_inicial','recebido','pago','repassado','aplicado','aplicacao',
      'resgatado','resgate','a_pagar','a_receber','a_repassar','a_resgatar',
      'provisionado','provisionado_dl','provisionado_dv'
    )
  ), 0)                                                           as saldo_projetado,

  count(te.id)                                                    as total_lancamentos,

  cb.numero_banco      as banco_numero,
  cb.tipo_instituicao  as banco_tipo_instituicao,
  cb.numero_conta      as banco_numero_conta,
  cb.digito            as banco_digito,
  cb.tipo              as banco_tipo
from public.contas_bancarias_empresa cb
left join public.transacoes_empresa te on te.conta_bancaria_id = cb.id
where cb.ativa = true
group by cb.id, cb.nome, cb.apelido, cb.banco, cb.agencia, cb.ordem,
         cb.numero_banco, cb.tipo_instituicao, cb.numero_conta, cb.digito, cb.tipo
order by cb.ordem;


-- ----------------------------------------------------------------------------
-- 0031 — scope_applied (auditoria dos relatórios por escopo)
-- ----------------------------------------------------------------------------
alter table public.pdfmonkey_geracoes
  add column if not exists scope_applied jsonb;

comment on column public.pdfmonkey_geracoes.scope_applied is
  'Recorte usado na geração (RF-FIN-09): filtros/ids/contas/totais. Auditoria/reprodutibilidade.';


-- ----------------------------------------------------------------------------
-- 0032 — Fluxo de Caixa mensal ("Saldo − contas do próximo mês")
-- ----------------------------------------------------------------------------
create or replace view public.v_fluxo_caixa_mensal as
with por_mes as (
  select
    te.mes_referencia,
    coalesce(sum(te.valor) filter (where te.status in
      ('saldo_inicial','recebido','pago','repassado','aplicado','aplicacao','resgatado','resgate')
      and cbe.tipo = 'corrente'), 0)                                                   as movimento_realizado,
    coalesce(sum(te.valor) filter (where te.status in
      ('provisionado','provisionado_dv','provisionado_dl','a_pagar','a_repassar','a_aplicar','pago','repassado','aplicado','aplicacao')), 0) as saidas_mes,
    coalesce(sum(te.valor) filter (where te.status in ('resgate','a_resgatar','resgatado')), 0) as resgate_mes,
    coalesce(sum(te.valor) filter (where te.status in ('a_receber','recebido') and te.conta_contabil_cod not like '1.2%'), 0) as outros_entradas_mes,
    coalesce(sum(te.valor) filter (where te.status in ('a_receber','recebido') and te.conta_contabil_cod like '1.2%'), 0) as vendas_mes
  from public.transacoes_empresa te
  left join public.contas_bancarias_empresa cbe on cbe.id = te.conta_bancaria_id
  where te.mes_referencia is not null
  group by te.mes_referencia
),
acc as (
  select *,
    sum(movimento_realizado) over (order by mes_referencia rows between unbounded preceding and current row) as saldo_final_acumulado
  from por_mes
)
select
  mes_referencia,
  saldo_final_acumulado,
  saidas_mes,
  resgate_mes,
  outros_entradas_mes,
  vendas_mes,
  coalesce(lead(saidas_mes) over (order by mes_referencia), 0)                         as saidas_proximo_mes,
  coalesce(lead(resgate_mes + outros_entradas_mes) over (order by mes_referencia), 0)  as entradas_garantidas_proximo_mes,
  saldo_final_acumulado
    + coalesce(lead(saidas_mes + resgate_mes + outros_entradas_mes) over (order by mes_referencia), 0) as saldo_menos_proximo_mes
from acc
order by mes_referencia;


-- ----------------------------------------------------------------------------
-- seed 12 — Reconciliação das contas (CORA/SICREDI/SICREDINVEST/INTER/XP)
-- ----------------------------------------------------------------------------
update public.contas_bancarias_empresa set
  apelido='CORA', banco='Banco Cora', tipo_instituicao='banco',
  numero_banco='403', agencia='0001', numero_conta='2347942', digito='2',
  tipo='corrente', ativa=true, ordem=1
where nome = 'Banco Cora (0001)';

update public.contas_bancarias_empresa set
  apelido='SICREDI', banco='Cooperativa Sicredi', tipo_instituicao='cooperativa',
  numero_banco='748', agencia='0913', numero_conta='29945', digito='3',
  tipo='corrente', ativa=true, ordem=2
where nome = 'Cooperativa Sicredi (0913)';

update public.contas_bancarias_empresa set ativa = false
where nome = 'Cooperativa Sicredi (0902)';

insert into public.contas_bancarias_empresa
  (nome, apelido, banco, tipo_instituicao, numero_banco, agencia, numero_conta, digito, tipo, ativa, ordem)
values
  ('Cooperativa Sicredi Investimento (0913)', 'SICREDINVEST', 'Cooperativa Sicredi', 'cooperativa',
   '748', '0913', '29945', '3', 'investimento', true, 3)
on conflict (nome) do update set
  apelido=excluded.apelido, banco=excluded.banco, tipo_instituicao=excluded.tipo_instituicao,
  numero_banco=excluded.numero_banco, agencia=excluded.agencia, numero_conta=excluded.numero_conta,
  digito=excluded.digito, tipo=excluded.tipo, ativa=true, ordem=excluded.ordem;

insert into public.contas_bancarias_empresa
  (nome, apelido, banco, tipo_instituicao, numero_banco, agencia, numero_conta, digito, tipo, ativa, ordem)
values
  ('Banco Inter (0001-9)', 'INTER', 'Banco Inter', 'banco',
   '077', '0001-9', '18843124', '1', 'corrente', true, 4)
on conflict (nome) do update set
  apelido=excluded.apelido, banco=excluded.banco, tipo_instituicao=excluded.tipo_instituicao,
  numero_banco=excluded.numero_banco, agencia=excluded.agencia, numero_conta=excluded.numero_conta,
  digito=excluded.digito, tipo=excluded.tipo, ativa=true, ordem=excluded.ordem;

update public.contas_bancarias_empresa set
  apelido='XP', banco='XP Investimentos', tipo_instituicao='banco',
  numero_banco='348', agencia='0001', numero_conta='5740321', digito=null,
  tipo='investimento', ativa=true, ordem=5
where nome = 'XP (Conta)';

update public.contas_bancarias_empresa set ativa = false
where nome in ('Invest', 'Invest Evolutivo');

-- Fim. ✓
