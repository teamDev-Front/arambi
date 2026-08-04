-- ============================================================================
-- 0050 — Resgate não atravessa a virada do mês
-- ============================================================================
-- Regra confirmada pela Adri (WhatsApp, 04-ago-2026):
--
--   "normalmente um dia antes, pra render mais e não concentrar risco, mas
--    quando cair em mês diferente do vencimento resgata no mesmo dia pra não
--    quebrar o fechamento"  →  "Sim é isso mesmo!!"
--
-- Por que o dia anterior é o padrão (palavras dela): o dinheiro fica aplicado
-- pelo máximo de tempo rendendo, e não se concentra tudo num dia só — se o
-- sistema estiver fora do ar, um resgate único poderia não sair a tempo e a
-- conta cairia no cheque especial.
--
-- Por que a exceção existe: ela confere o mês fechando em ZERO (saídas ×
-- resgates na conta corrente Sicredi). Se o título vence dia 03/08 e o resgate
-- cai em 31/07, julho fica sobrando e agosto faltando o mesmo valor — só bate
-- somando os dois meses, e o fechamento mensal quebra.
--
-- Caso real que motivou: títulos de R$ 3.088,00 e R$ 1.372,98 vencendo em
-- 03/08/2026 (segunda). Como 01 e 02/08 caíram no fim de semana, o sistema
-- programou o resgate para 31/07 — e ela, sem reconhecer a linha, apagava.
--
-- FORA DO ESCOPO desta migration: o outro caso em que ela resgata no mesmo dia
-- ("recebo no dia um pgto pra fazer no mesmo dia: sinal/entrada, compra à
-- vista"). Esse é julgamento dela, caso a caso — segue editando na tela.
--
-- Aplicar após a 0049.

-- ---------------------------------------------------------------------------
-- 1) Data do resgate de um título
-- ---------------------------------------------------------------------------
create or replace function public.fn_dia_resgate(p_venc date)
returns date
language plpgsql
immutable
as $$
declare
  v_dia date;
begin
  if p_venc is null then return null; end if;

  v_dia := public.fn_dia_util_anterior(p_venc);

  -- Atravessou a virada do mês → resgata no MESMO DIA do vencimento, para o
  -- mês fechar em zero. Vale também quando o vencimento cai em fim de semana:
  -- resgate e pagamento seguem juntos, que é o objetivo da regra.
  if to_char(v_dia, 'YYYY-MM') is distinct from to_char(p_venc, 'YYYY-MM') then
    return p_venc;
  end if;

  return v_dia;
end;
$$;

comment on function public.fn_dia_resgate(date) is
  'Data do resgate automático de um título: dia útil anterior ao vencimento, EXCETO quando isso cairia no mês anterior — aí resgata no próprio dia do vencimento, para o fechamento mensal do Sicredi bater em zero. Migration 0050.';

-- ---------------------------------------------------------------------------
-- 2) Escolha do resgate alvo passa a usar a regra
-- ---------------------------------------------------------------------------
create or replace function public.fn_resgate_alvo_do_titulo(p_forma public.forma_pgto, p_venc date)
returns uuid
language plpgsql
as $$
begin
  if p_venc is null then return null; end if;
  if p_forma = 'cartao_credito' then
    return public.fn_resgate_fatura_cartao_obter(p_venc);
  end if;
  return public.fn_resgate_invest_obter(public.fn_dia_resgate(p_venc));
end;
$$;

comment on function public.fn_resgate_alvo_do_titulo(public.forma_pgto, date) is
  'Resgate automático que deve receber um título do Sicredi: consolidado da fatura no Cartão de Crédito (0048), diário nos demais casos — sem atravessar a virada do mês (0050).';

-- ---------------------------------------------------------------------------
-- 3) O resgate da FATURA também respeita a regra
-- ---------------------------------------------------------------------------
-- Com o vencimento padrão (dia 15) isso nunca atravessa o mês, mas o dia é
-- configurável em app_config — se alguém puser 1 ou 2, o resgate cairia no mês
-- anterior e quebraria o mesmo fechamento.
create or replace function public.fn_resgate_fatura_cartao_obter(p_mes_venc date)
returns uuid
language plpgsql
as $$
declare
  v_sic   uuid := public.fn_conta_sicredi_corrente();
  v_forn  uuid;
  v_id    uuid;
  v_mes   text := to_char(p_mes_venc, 'YYYY-MM');
  v_tag   text := 'auto:resgate_invest_fatura:' || to_char(p_mes_venc, 'YYYY-MM');
  v_venc  date;
  v_data  date;
begin
  if v_sic is null or p_mes_venc is null then return null; end if;

  select id into v_id
    from public.transacoes_empresa
   where origem_planilha = v_tag
     and status in ('resgate', 'a_resgatar')
   order by created_at
   limit 1;
  if v_id is not null then return v_id; end if;

  v_venc := make_date(
    extract(year from p_mes_venc)::int,
    extract(month from p_mes_venc)::int,
    least(public.fn_fatura_cartao_sicredi_dia(),
          extract(day from (date_trunc('month', p_mes_venc) + interval '1 month - 1 day'))::int)
  );
  v_data := public.fn_dia_resgate(v_venc);   -- 0050: não atravessa o mês

  select id into v_forn from public.fornecedores
   where nome = 'Banco Cooperativa Sicredi' limit 1;

  insert into public.transacoes_empresa
    (data, conta_contabil_cod, centro_custo_cod, tipo_despesa, obs_obra,
     forma_pgto, conta_bancaria_id, status, valor,
     fornecedor_id, fornecedor_nome, descricao, origem_planilha, observacao)
  values
    (v_data, '1.8', '1.8.1', 'sem', 'sem', 'sem',
     v_sic, 'resgate', 0,
     v_forn, 'Banco Cooperativa Sicredi',
     'Resgate da Conta Investimento Invest - Fatura Cartão de Crédito ' ||
       substring(v_mes from 6 for 2) || '/' || substring(v_mes from 1 for 4),
     v_tag,
     'Resgate único da fatura do cartão: soma os lançamentos de Cartão de Crédito do Sicredi com vencimento em ' ||
       substring(v_mes from 6 for 2) || '/' || substring(v_mes from 1 for 4) ||
       '. Programado para o dia útil anterior ao vencimento da fatura.')
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.fn_resgate_fatura_cartao_obter(date) is
  'Localiza (ou cria) o resgate CONSOLIDADO da fatura do cartão Sicredi do mês da data informada, programado para o dia útil anterior ao vencimento da fatura, sem atravessar a virada do mês. Migrations 0048/0050.';

-- ---------------------------------------------------------------------------
-- 4) Sem backfill — de propósito
-- ---------------------------------------------------------------------------
-- Só existe UM resgate na base que atravessa o mês (31/07/2026, R$ 4.460,98,
-- cobrindo dois títulos de 03/08), e ele já está com status Resgatado, ou seja,
-- conferido contra o extrato. A regra da Adri para o passado é clara: "os
-- passados não, não muda, não apaga, porque o saldo bancário está batendo".
-- Ela mesma disse que vai editar esse caso na tela. Daqui para frente, os
-- lançamentos novos já nascem com a data certa.

-- ----------------------------------------------------------------------------
-- ROLLBACK:
--   -- restaurar fn_resgate_alvo_do_titulo e fn_resgate_fatura_cartao_obter da 0048
--   drop function if exists public.fn_dia_resgate(date);
-- ----------------------------------------------------------------------------
