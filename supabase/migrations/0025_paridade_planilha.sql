-- ============================================================================
-- 0025 — Paridade com a planilha Excel original
-- ============================================================================
-- Implementa os itens IMPORTANTES + NICE-TO-HAVE da AUDITORIA-PLANILHA-vs-SISTEMA.md:
--   • orcamentos_mensais (substitui o hardcoded -20.000 da E37 da Memória)
--   • v_memoria_calculo_mensal (espelho do mês sem pares de transferência interna)
--   • v_obra_lts_status_calculado (status do contrato LTS recalculado por data)
--   • v_distribuicao_lucro_ytd (acumulado anual por sócio × classificação — pág.11 PDF)
--   • v_fazenda_aramburu_ytd (acumulado 1.05 por sócio — pág.12 PDF)

-- ---------------------------------------------------------------------------
-- 1) orcamentos_mensais — Lola configura o teto de cada (mês, tipo_despesa)
-- ---------------------------------------------------------------------------
-- A planilha Memória de Cálculo tinha o orçamento de "Despesas Variáveis"
-- como literal `-20000` dentro da fórmula E37. Aqui viramos isso editável,
-- por mês, e dá pra Lola ajustar conforme a temporada.
create table if not exists public.orcamentos_mensais (
  id              uuid primary key default gen_random_uuid(),
  mes_referencia  text not null,                              -- "YYYY-MM"
  tipo_despesa    public.tipo_despesa not null,
  valor_orcado    numeric(14,2) not null check (valor_orcado >= 0),
  observacao      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.users(id) on delete set null,
  unique (mes_referencia, tipo_despesa)
);

create index if not exists idx_om_mes  on public.orcamentos_mensais(mes_referencia);
create index if not exists idx_om_tipo on public.orcamentos_mensais(tipo_despesa);

drop trigger if exists tg_om_updated_at on public.orcamentos_mensais;
create trigger tg_om_updated_at
  before update on public.orcamentos_mensais
  for each row execute function public.tg_set_updated_at();

alter table public.orcamentos_mensais enable row level security;

drop policy if exists om_read on public.orcamentos_mensais;
create policy om_read on public.orcamentos_mensais
  for select using (auth.uid() is not null);

drop policy if exists om_write on public.orcamentos_mensais;
create policy om_write on public.orcamentos_mensais
  for all using (public.fn_can_write()) with check (public.fn_can_write());

comment on table public.orcamentos_mensais is
  'Teto mensal por tipo_despesa — substitui o hardcoded -20.000 de E37 da Memória de Cálculo.';

-- ---------------------------------------------------------------------------
-- 2) v_memoria_calculo_mensal — espelho "limpo" do mês
-- ---------------------------------------------------------------------------
-- Replica o trabalho manual que a Lola fazia na aba `Agrop. Aramburu_Detalhado`
-- da Memória de Cálculo V5: copiar lançamentos do mês e REMOVER pares de
-- transferência entre contas (status='Recebido'+'Pago' com descrição
-- "Transf. Entre Contas...", valores opostos), pois eles inflacionam 1.9 e 2.9
-- sem representar entrada/saída real.
--
-- Critério de pareamento (escolhido como o mais conservador):
--   • Descrição contém "Transf. Entre Contas" (case-insensitive)
--   • Existe OUTRA linha com EXATAMENTE a mesma descrição + valor oposto
--
-- Não exigimos mesma data porque na planilha as duas pernas podem cair em
-- dias diferentes (ex.: resgate em XP cai dia 16, deposito em CGR dia 19,
-- mas descrição "Transf. Entre Contas_Resgate Investimento XP" é idêntica).
create or replace view public.v_memoria_calculo_mensal as
select te.*
from public.transacoes_empresa te
where te.descricao is null
   or te.descricao not ilike '%transf%entre%contas%'
   or not exists (
     select 1
     from public.transacoes_empresa pair
     where pair.id <> te.id
       and pair.descricao = te.descricao
       and pair.valor = -te.valor
   );

comment on view public.v_memoria_calculo_mensal is
  'Espelho de transacoes_empresa SEM pares de transferência interna (mesma descrição + valor oposto). Replica o trabalho manual da Memória de Cálculo V5.';

-- ---------------------------------------------------------------------------
-- 3) v_obra_lts_status_calculado — semáforo de vencimento
-- ---------------------------------------------------------------------------
-- Replica a fórmula `J<row> = IFS(I<row><TODAY(), "VENCIDO", I=TODAY, "VENCE HOJE", I>TODAY, "EM ABERTO")`
-- da aba LTS da planilha. Recalcula o status em tempo de consulta, mas só
-- quando o estado-mãe não é definitivo (pago/cancelado mantém-se inalterado).
create or replace view public.v_obra_lts_status_calculado as
select
  i.id,
  i.oc_numero,
  i.data_compra,
  i.loja,
  i.nf,
  i.forma_pagamento,
  i.valor,
  i.vencimento,
  i.status as status_cadastrado,
  case
    when i.status in ('pago', 'cancelado') then i.status
    when i.vencimento is null              then i.status
    when i.vencimento <  current_date      then 'vencido'::public.lts_status
    when i.vencimento =  current_date      then 'vence_hoje'::public.lts_status
    when i.vencimento >  current_date      then 'em_aberto'::public.lts_status
    else i.status
  end as status_calculado,
  i.contrato,
  i.parcela,
  i.observacao,
  i.origem_planilha,
  i.created_at,
  i.updated_at
from public.obra_lts_itens i;

comment on view public.v_obra_lts_status_calculado is
  'OCs/Medições com status recalculado dinamicamente (vencido/em_aberto/vence_hoje), preservando estados definitivos (pago/cancelado).';

-- ---------------------------------------------------------------------------
-- 4) v_distribuicao_lucro_ytd — acumulado anual por sócio × classificação
-- ---------------------------------------------------------------------------
-- Alimenta a página 11 do PDF mensal (donut + barras: Imóvel R$ 348.621,68,
-- Família R$ 39.853,75, Renda Mensal R$ 763.476,74, Despesas Pessoais
-- R$ 74.231,52, Fazenda Aramburu R$ 158.287,63, Contratos de Venda R$ 715.300,25).
-- Numbers vinham do Aramburu_Mensal mestre via SUMIFS sobre o ano inteiro.
create or replace view public.v_distribuicao_lucro_ytd as
select
  extract(year from ts.data)::int  as ano,
  ts.classificacao_pessoal,
  cp.nome                          as classificacao_nome,
  ts.socio_id,
  s.nome_completo                  as socio_nome,
  s.apelido                        as socio_apelido,
  sum(ts.valor)                    as valor_acumulado,
  count(*)                         as qtd_lancamentos
from public.transacoes_socio ts
join public.socios s              on s.id = ts.socio_id
join public.classificacao_pessoal cp on cp.codigo = ts.classificacao_pessoal
group by 1, ts.classificacao_pessoal, cp.nome, ts.socio_id, s.nome_completo, s.apelido;

comment on view public.v_distribuicao_lucro_ytd is
  'Distribuição de Lucro acumulada por (ano, sócio, classificacao) — alimenta a página 11 do PDF mensal.';

-- ---------------------------------------------------------------------------
-- 5) v_fazenda_aramburu_ytd — total acumulado 1.05 por sócio × ano
-- ---------------------------------------------------------------------------
-- Alimenta a página 12 do PDF (sub-bloco "Fazenda Aramburu" — R$ 158.287,63).
-- A planilha decompõe esse total em Energia / Operacionais / Pessoal, mas
-- essa subclassificação não existia no schema (era categorização manual da
-- Lola). Aqui retornamos o total — quem precisar da decomposição usa a
-- busca textual em descricao ou cria uma view secundária no futuro.
create or replace view public.v_fazenda_aramburu_ytd as
select
  extract(year from ts.data)::int as ano,
  ts.socio_id,
  s.nome_completo                 as socio_nome,
  sum(ts.valor)                   as valor_acumulado,
  count(*)                        as qtd_lancamentos
from public.transacoes_socio ts
join public.socios s on s.id = ts.socio_id
where ts.classificacao_pessoal = '1.05'
group by 1, ts.socio_id, s.nome_completo;

comment on view public.v_fazenda_aramburu_ytd is
  '1.05 Fazenda Aramburu acumulado por sócio × ano — alimenta a página 12 do PDF mensal.';
