-- ============================================================================
-- 0060 — Fluxo de Caixa da planilha VS4 + contas Sicredi novas + views fechadas
-- ============================================================================
-- Pedido (reunião "Fluxo de Caixa", 20-out-2026 + planilha
-- "Provisionamento_FLUXO DE CAIXA 2026_VS 4.xlsx"):
--
-- A) SEGURANÇA (achado ao preparar este pacote): as views do painel eram
--    "security definer" (padrão do Postgres) e tinham SELECT para `anon` —
--    saldos bancários, KPIs, DL, vendas e estoque respondiam SEM LOGIN, só com
--    a chave pública do site. A tabela transacoes_empresa estava protegida;
--    as views passavam por cima do RLS. Agora:
--      • todas as views do schema public viram security_invoker (o RLS das
--        tabelas vale também nelas: sem login ou bloqueado → vazio);
--      • `anon` perde o acesso a todas as views;
--      • fn_validar_consistencia (security definer, sem uso no app) devolvia
--        valores da obra e saldos para qualquer um → só service role;
--      • fn_lixeira_expurgar deixa de ser chamável sem login.
--    Exceção mantida: v_agente_prompts_publico continua definer (expõe só os
--    campos públicos dos agentes para quem não edita prompts — 0020).
--
-- B) CONTAS NOVAS: SICREDI EMPRESARIAL e SICREDI APLICAÇÃO AUTOMÁTICA
--    (investimento, Cooperativa Sicredi 748, ag. 0913 — número da conta fica
--    para a Lola completar em Bancos). Ordem igual à planilha: CORA, SICREDI,
--    SICREDINVEST, SICREDI EMPRESARIAL, SICREDI APLICAÇÃO AUTOMÁTICA, INTER, XP.
--    Resgate automático NÃO foi estendido a elas (a VS4 não tem regra de
--    resgate para essas contas — pergunta em aberto na reunião).
--
-- C) "SALDO FLUXO DE CAIXA" = Cora + Sicredi + Sicredinvest + Sicredi
--    Empresarial + Sicredi Aplicação Automática (+ Sicredi MJU, encerrada, que
--    a planilha ainda soma nos meses em que tinha saldo). Vira uma marca por
--    conta (contas_bancarias_empresa.compoe_fluxo_caixa), editável em Bancos.
--
-- D) VIEWS NOVAS (espelham a aba "Saldo Disponível" da VS4, linha a linha):
--      v_fluxo_caixa_contas   — saldo inicial/final PROJETADO por conta e mês
--                               (linhas 11-18 e 34-41: todos os status);
--      v_fluxo_caixa_planilha — Entradas (20) = saldo inicial (21) + vendas/
--                               receita de parceria rural (22) + resgates (23)
--                               + outras entradas (24); Saídas (25) = despesas
--                               Aramburu (26) + DL (27) + obra (28) + aplicações
--                               (29) + resgates do invest (30) + transferências
--                               (31); Resultado (32); "Saldo (−) contas do
--                               próximo mês" (43) e Despesa Variável (48-51).
--    As views antigas (v_fluxo_caixa_mensal, v_fluxo_caixa_bancos) ficam como
--    estão — a Home deixa de usá-las.
--
-- Transferências entre contas: na VS4 o código é 2.9 ("Transferência Entre
-- Contas"); no sistema 2.9 se chama "Outras Saídas" mas guarda justamente os
-- pares de transferência, e existe 2.10 "Transferências Entre Contas" (vazia).
-- A view trata como transferência o 2.9 E qualquer conta nível 2 de saída cujo
-- nome tenha "transfer" — funciona igual hoje e se os nomes forem alinhados
-- à planilha depois.
--
-- Depende da 0058. Aplicar no SQL Editor. Idempotente (reaplicar recoloca as
-- marcas de "compõe o fluxo" no padrão abaixo).

-- ---------------------------------------------------------------------------
-- B) Contas novas e ordem da planilha
-- ---------------------------------------------------------------------------
alter table public.contas_bancarias_empresa
  add column if not exists compoe_fluxo_caixa boolean not null default false;

comment on column public.contas_bancarias_empresa.compoe_fluxo_caixa is
  'Soma no "Saldo Fluxo de Caixa" (Home) e no "Saldo (−) contas do próximo mês". Padrão VS4: Cora, Sicredi, Sicredinvest, Sicredi Empresarial, Sicredi Aplicação Automática. Migration 0060.';

insert into public.contas_bancarias_empresa
  (nome, apelido, banco, agencia, tipo, ativa, ordem, numero_banco, tipo_instituicao)
select v.nome, v.apelido, 'Cooperativa Sicredi', '0913', 'investimento', true, v.ordem, '748', 'cooperativa'
  from (values
    ('Cooperativa Sicredi Empresarial (0913)',          'SICREDI EMPRESARIAL',          4),
    ('Cooperativa Sicredi Aplicação Automática (0913)', 'SICREDI APLICAÇÃO AUTOMÁTICA', 5)
  ) as v(nome, apelido, ordem)
 where not exists (
   select 1 from public.contas_bancarias_empresa c where upper(c.apelido) = upper(v.apelido)
 );

update public.contas_bancarias_empresa c
   set ordem = v.ordem
  from (values
    ('CORA', 1), ('SICREDI', 2), ('SICREDINVEST', 3), ('SICREDI EMPRESARIAL', 4),
    ('SICREDI APLICAÇÃO AUTOMÁTICA', 5), ('INTER', 6), ('XP', 7)
  ) as v(apelido, ordem)
 where upper(c.apelido) = upper(v.apelido)
   and c.ordem is distinct from v.ordem;

update public.contas_bancarias_empresa
   set compoe_fluxo_caixa = upper(coalesce(apelido, '')) in (
         'CORA', 'SICREDI', 'SICREDI MJU', 'SICREDINVEST',
         'SICREDI EMPRESARIAL', 'SICREDI APLICAÇÃO AUTOMÁTICA'
       );

-- ---------------------------------------------------------------------------
-- D) Views do Fluxo de Caixa (VS4)
-- ---------------------------------------------------------------------------
-- Saldo por conta e mês, PROJETADO como na planilha: todos os 16 status
-- movimentam o saldo (o 'resgate' provisionado anula o 'provisionado', ver 0033).
-- saldo_inicial(m) = saldo final de m-1 + lançamentos "Saldo inicial" de m
-- (em janeiro, só os lançamentos de saldo inicial — igual às linhas 11-18).
create or replace view public.v_fluxo_caixa_contas as
with limites as (
  select min(mes_referencia) as ini, max(mes_referencia) as fim
    from public.transacoes_empresa
   where mes_referencia ~ '^[0-9]{4}-[0-9]{2}$'
),
meses as (
  select to_char(g, 'YYYY-MM') as mes_referencia
    from limites,
         generate_series(to_date(limites.ini, 'YYYY-MM'), to_date(limites.fim, 'YYYY-MM'), interval '1 month') g
),
mov as (
  select te.mes_referencia, te.conta_bancaria_id,
         sum(te.valor) filter (where te.status in (
           'saldo_inicial','recebido','a_receber','pago','a_pagar','repassado','a_repassar',
           'aplicado','a_aplicar','aplicacao','resgatado','a_resgatar','resgate',
           'provisionado','provisionado_dl','provisionado_dv'))       as movimento,
         sum(te.valor) filter (where te.status = 'saldo_inicial')     as saldo_inicial_lancado
    from public.transacoes_empresa te
   where te.conta_bancaria_id is not null
   group by 1, 2
),
grade as (
  select m.mes_referencia, c.id, c.nome, c.apelido, c.banco, c.numero_banco, c.tipo_instituicao,
         c.tipo, c.ordem, c.ativa, c.compoe_fluxo_caixa,
         coalesce(v.movimento, 0)             as movimento,
         coalesce(v.saldo_inicial_lancado, 0) as saldo_inicial_lancado
    from meses m
   cross join public.contas_bancarias_empresa c
    left join mov v on v.mes_referencia = m.mes_referencia and v.conta_bancaria_id = c.id
),
acc as (
  select g.*,
         sum(g.movimento) over (partition by g.id order by g.mes_referencia
                                rows between unbounded preceding and current row) as saldo_final
    from grade g
)
select
  mes_referencia,
  id                 as conta_bancaria_id,
  nome               as banco_nome,
  apelido            as banco_apelido,
  banco              as banco_instituicao,
  numero_banco       as banco_numero,
  tipo_instituicao   as banco_tipo_instituicao,
  tipo               as banco_tipo,
  ordem              as banco_ordem,
  ativa,
  compoe_fluxo_caixa,
  (saldo_final - movimento + saldo_inicial_lancado)::numeric(15,2) as saldo_inicial,
  movimento::numeric(15,2)                                           as movimento_mes,
  saldo_final::numeric(15,2)                                         as saldo_final
from acc;

comment on view public.v_fluxo_caixa_contas is
  'Saldo inicial/final PROJETADO (todos os status) por conta bancária e mês — linhas 11-18 e 34-41 da aba Saldo Disponível (VS4). Migration 0060.';

create or replace view public.v_fluxo_caixa_planilha as
with limites as (
  select min(mes_referencia) as ini, max(mes_referencia) as fim
    from public.transacoes_empresa
   where mes_referencia ~ '^[0-9]{4}-[0-9]{2}$'
),
meses as (
  select to_char(g, 'YYYY-MM') as mes_referencia
    from limites,
         generate_series(to_date(limites.ini, 'YYYY-MM'), to_date(limites.fim, 'YYYY-MM'), interval '1 month') g
),
transf as (
  select codigo
    from public.classificacao_financeira
   where codigo = '2.9'
      or (nivel = 2 and natureza = 'saida' and nome ilike '%transfer%')
),
lanc as (
  select te.mes_referencia, te.valor, te.status, te.conta_contabil_cod, te.centro_custo_cod, te.tipo_despesa,
         coalesce(c.compoe_fluxo_caixa, false)                as conta_fluxo,
         c.tipo                                              as conta_tipo,
         te.conta_contabil_cod in (select codigo from transf) as eh_transferencia
    from public.transacoes_empresa te
    left join public.contas_bancarias_empresa c on c.id = te.conta_bancaria_id
   where te.mes_referencia is not null
),
por_mes as (
  select mes_referencia,
    -- Entradas
    sum(valor) filter (where status = 'saldo_inicial')                                         as saldo_inicial,
    sum(valor) filter (where conta_contabil_cod = '1.2' and status in ('a_receber','recebido'))  as vendas,
    sum(valor) filter (where status in ('resgate','a_resgatar','resgatado')
                         and conta_fluxo and conta_tipo = 'corrente')                           as resgates_entrada,
    sum(valor) filter (where status in ('a_receber','recebido'))                                as recebimentos,
    -- Saídas
    sum(valor) filter (where status in ('provisionado','a_pagar','pago','provisionado_dv'))     as despesas_brutas,
    sum(valor) filter (where centro_custo_cod = '2.7.2'
                         and status in ('provisionado','a_pagar','pago'))                       as despesas_obra,
    sum(valor) filter (where eh_transferencia
                         and status in ('provisionado','a_pagar','pago','provisionado_dv'))     as transferencias,
    sum(valor) filter (where status in ('provisionado_dl','a_repassar','repassado'))            as distribuicao_lucro,
    sum(valor) filter (where status in ('a_aplicar','aplicado','aplicacao'))                    as aplicacoes,
    sum(valor) filter (where status in ('resgate','a_resgatar','resgatado')
                         and conta_fluxo and conta_tipo = 'investimento')                       as resgates_saida,
    -- Despesa Variável (linhas 49-50; o saldo DV automático 'provisionado_dv' não entra)
    sum(valor) filter (where tipo_despesa = 'variavel'
                         and status in ('a_pagar','pago','recebido','a_receber'))               as dv_mov_utilizado,
    sum(valor) filter (where tipo_despesa = 'variavel' and status = 'provisionado')             as dv_mov_provisionado
  from lanc
  group by mes_referencia
),
contas as (
  select mes_referencia,
         sum(saldo_final) filter (where compoe_fluxo_caixa) as saldo_contas_fluxo,
         sum(saldo_final)                                   as saldo_todas_contas
    from public.v_fluxo_caixa_contas
   group by mes_referencia
),
linhas as (
  select m.mes_referencia,
         coalesce(p.saldo_inicial, 0)                                                      as saldo_inicial,
         coalesce(p.vendas, 0)                                                             as vendas,
         coalesce(p.resgates_entrada, 0)                                                   as resgates_entrada,
         coalesce(p.recebimentos, 0) - coalesce(p.vendas, 0)                               as outras_entradas,
         coalesce(p.despesas_brutas, 0) - coalesce(p.despesas_obra, 0) - coalesce(p.transferencias, 0) as despesas_aramburu,
         coalesce(p.distribuicao_lucro, 0)                                                 as distribuicao_lucro,
         coalesce(p.despesas_obra, 0)                                                      as despesas_obra,
         coalesce(p.aplicacoes, 0)                                                         as aplicacoes,
         coalesce(p.resgates_saida, 0)                                                     as resgates_saida,
         coalesce(p.transferencias, 0)                                                     as transferencias,
         coalesce(c.saldo_contas_fluxo, 0)                                                 as saldo_contas_fluxo,
         coalesce(c.saldo_todas_contas, 0)                                                 as saldo_todas_contas,
         public.fn_dv_limite_mensal()                                                      as dv_limite,
         -coalesce(p.dv_mov_utilizado, 0)                                                  as dv_utilizado,
         -coalesce(p.dv_mov_provisionado, 0)                                               as dv_provisionado
    from meses m
    left join por_mes p using (mes_referencia)
    left join contas  c using (mes_referencia)
),
calc as (
  select l.*,
         saldo_inicial + vendas + resgates_entrada + outras_entradas                                        as entradas,
         despesas_aramburu + distribuicao_lucro + despesas_obra + aplicacoes + resgates_saida + transferencias as saidas
    from linhas l
)
select
  mes_referencia,
  saldo_inicial::numeric(15,2),
  vendas::numeric(15,2),
  resgates_entrada::numeric(15,2),
  outras_entradas::numeric(15,2),
  entradas::numeric(15,2),
  despesas_aramburu::numeric(15,2),
  distribuicao_lucro::numeric(15,2),
  despesas_obra::numeric(15,2),
  aplicacoes::numeric(15,2),
  resgates_saida::numeric(15,2),
  transferencias::numeric(15,2),
  saidas::numeric(15,2),
  (entradas + saidas)::numeric(15,2)                                                          as resultado,
  saldo_contas_fluxo::numeric(15,2),
  -- Linha 43: saldo final das contas do fluxo + o que o mês seguinte já tem de
  -- certo (saídas, outras entradas e resgates) — SEM vendas.
  (saldo_contas_fluxo
    + coalesce(lead(saidas + outras_entradas + resgates_entrada) over (order by mes_referencia), 0))::numeric(15,2)
                                                                                             as saldo_menos_proximo_mes,
  saldo_todas_contas::numeric(15,2),
  dv_limite::numeric(15,2),
  dv_utilizado::numeric(15,2),
  dv_provisionado::numeric(15,2),
  (dv_limite - dv_utilizado - dv_provisionado)::numeric(15,2)                                  as dv_saldo
from calc;

comment on view public.v_fluxo_caixa_planilha is
  'Fluxo de Caixa mensal no formato da aba Saldo Disponível (VS4): entradas, saídas, resultado, saldo das contas do fluxo, "saldo (−) contas do próximo mês" e despesa variável. Migration 0060.';

-- ---------------------------------------------------------------------------
-- A) Segurança: views passam a respeitar o RLS; `anon` fora
-- ---------------------------------------------------------------------------
-- Nome de quem excluiu, na Lixeira: com a view em modo invoker o RLS de users
-- esconderia o nome de outra pessoa — a função devolve só o nome, e só para
-- usuário ativo.
create or replace function public.fn_nome_usuario(p_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when public.fn_usuario_ativo()
              then (select coalesce(u.full_name, u.email::text) from public.users u where u.id = p_id)
         end
$$;

revoke all on function public.fn_nome_usuario(uuid) from public, anon;
grant execute on function public.fn_nome_usuario(uuid) to authenticated;

-- Mesma view da 0054; só o nome passa pela função acima.
create or replace view public.v_lixeira as
select l.id,
       l.tabela,
       l.registro_id,
       l.resumo,
       l.dados,
       l.excluido_em,
       l.expira_em,
       greatest(0::numeric, ceil(extract(epoch from l.expira_em - now()) / 86400::numeric))::integer as dias_restantes,
       public.fn_nome_usuario(l.excluido_por) as excluido_por_nome
  from public.lixeira l
 where l.restaurado_em is null
   and l.expira_em > now()
   and not exists (
         select 1 from public.transacoes_empresa t
          where l.tabela = 'transacoes_empresa' and t.id = l.registro_id
         union all
         select 1 from public.transacoes_socio s
          where l.tabela = 'transacoes_socio' and s.id = l.registro_id
         union all
         select 1 from public.vendas_provisionadas v
          where l.tabela = 'vendas_provisionadas' and v.id = l.registro_id
       );

do $$
declare
  r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'
  loop
    -- security_invoker existe a partir do Postgres 15 (o Supabase atual é 15+).
    if r.relname <> 'v_agente_prompts_publico'
       and current_setting('server_version_num')::int >= 150000 then
      execute format('alter view public.%I set (security_invoker = true)', r.relname);
    end if;
    execute format('revoke all on public.%I from anon', r.relname);
  end loop;
end $$;

revoke all on function public.fn_validar_consistencia() from public, anon, authenticated;
revoke all on function public.fn_lixeira_expurgar() from public, anon;

-- ----------------------------------------------------------------------------
-- ROLLBACK (manual):
--   drop view if exists public.v_fluxo_caixa_planilha;
--   drop view if exists public.v_fluxo_caixa_contas;
--   alter view public.<view> set (security_invoker = false); grant select ... to anon (NÃO recomendado);
--   recriar v_lixeira da 0054; drop function public.fn_nome_usuario(uuid);
--   alter table public.contas_bancarias_empresa drop column compoe_fluxo_caixa;
--   (contas novas: desativar em Bancos se não forem usadas)
-- ----------------------------------------------------------------------------
