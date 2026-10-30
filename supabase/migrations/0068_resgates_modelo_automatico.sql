-- ============================================================================
-- 0068 — Resgates no modelo novo: Sicredinvest Automático + origem do recurso
-- ============================================================================
-- Pedido da Adri (documentos de 29 e 30-out-2026, em ajustes-29-outubro-2026/).
-- Em 28-out a operação mudou:
--   • os pagamentos da corrente SICREDI passam a ser cobertos pelo SICREDINVEST
--     AUTOMÁTICO: o banco resgata no FIM DO DIA do pagamento, o total do dia;
--   • o grosso do caixa fica no SICREDI FUNDO EMPRESARIAL, que não resgata
--     sozinho. No 1º dia útil ela faz um resgate global de lá (cobre os títulos
--     do dia e a DL) e, no meio do mês, resgates avulsos para pagamentos do dia.
-- A automação seguia a regra da obra da sede (SICREDINVEST, dia útil anterior,
-- descrição e observação da obra, trava de saldo) e ela corrigia par por par.
-- Em 03/11 ela apagou à mão os resgates dos títulos cobertos pelo Fundo.
--
-- O que muda — tudo em Configurações → Automações. O padrão de cada chave nova
-- é o comportamento de antes; o passo 7 grava o que ela pediu por escrito.
--   1) ORIGEM DO RECURSO por lançamento (coluna resgate_origem_id): vazio = a
--      conta padrão dos resgates, que gera o par automático, como sempre; outra
--      conta = resgate feito à parte (ex.: Fundo Empresarial) e o título NÃO
--      gera resgate. Vale para o que já foi ao banco: a linha mensal dos
--      provisionados continua somando tudo, porque é a programação do mês.
--   2) Data do resgate: mesmo dia do pagamento ou dia útil anterior (0050).
--   3) Agrupamento do resgate do dia: um por DIA (o total do dia, como o
--      Automático faz) ou um por agendamento (lote, 0053).
--   4) Descrição e observação dos resgates; aviso de saldo liga/desliga (0046).
--   5) Conta da linha mensal "Provisionados" e da fatura do cartão (respostas
--      dela em 30-out: Fundo Empresarial; a fatura no mesmo dia).
--
-- Reparo (passo 8), só em pendentes: os resgates do dia ainda não resgatados
-- passam para o modelo novo; as linhas mensais pendentes passam a sair da conta
-- da programação; os títulos A Pagar a partir de 01/11 que ela deixou sem
-- resgate (cobertos pelo Fundo Empresarial) ficam com essa origem gravada.
--
-- Depende da 0064 (conta de origem configurável) e da 0066 (papéis/fn_cod).
-- As definições são idempotentes; o reparo só toca o que ainda estiver no
-- modelo antigo, então rodar de novo não muda nada.

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'fn_cod') then
    raise exception 'Aplique a 0066_papeis_plano_contas.sql antes da 0068.';
  end if;
  if not exists (select 1 from pg_proc where proname = 'fn_conta_resgate_origem_configurada') then
    raise exception 'Aplique a 0064_resgate_conta_origem.sql antes da 0068.';
  end if;
end $$;

-- ###########################################################################
-- 1) Origem do recurso por lançamento
-- ###########################################################################
alter table public.transacoes_empresa
  add column if not exists resgate_origem_id uuid
    references public.contas_bancarias_empresa(id) on delete set null;

comment on column public.transacoes_empresa.resgate_origem_id is
  'Origem do recurso (0068): conta de investimento que cobre esta saída da corrente Sicredi. Vazio = conta padrão dos resgates, que gera o par automático. Outra conta = resgate feito à parte (ex.: Fundo Empresarial) e o título não gera resgate.';

-- ###########################################################################
-- 2) Configuração — padrão = comportamento de antes da 0068
-- ###########################################################################
insert into public.app_config (chave, valor, descricao) values
  ('resgate_conta_programacao', '',
   'Conta de investimento da linha mensal "Provisionados" (programação do mês). Vazio = a mesma dos resgates do dia a dia. Migration 0068.'),
  ('resgate_conta_fatura', '',
   'Conta de investimento do resgate da fatura do cartão. Vazio = a mesma dos resgates do dia a dia. Migration 0068.'),
  ('resgate_data_regra', 'dia_util_anterior',
   'Data dos resgates: mesmo_dia (no dia do pagamento) ou dia_util_anterior (regra da 0050). Migration 0068.'),
  ('resgate_agrupamento', 'agendamento',
   'Resgate do dia: dia (um só, com o total do dia) ou agendamento (um por leva que foi ao banco junta — 0053). Migration 0068.'),
  ('resgate_descricao', '',
   'Descrição dos resgates do dia a dia, nas duas pernas. Vazio = texto antigo (obra da sede). Migration 0068.'),
  ('resgate_observacao_ativa', 'on',
   'on = os resgates automáticos recebem a observação explicativa; off = sem observação. Migration 0068.'),
  ('resgate_observacao', '',
   'Texto da observação dos resgates do dia a dia. Vazio = texto antigo. Migration 0068.'),
  ('resgate_validar_saldo', 'on',
   'on = avisa quando o resgate passa do saldo da conta de investimento (0046); off = não avisa. Migration 0068.')
on conflict (chave) do nothing;

update public.app_config
   set descricao = 'Conta padrão dos resgates automáticos do dia a dia (id em Bancos): é dela que sai o par de cada pagamento da corrente Sicredi. Lançamento com outra "origem do recurso" não gera resgate (0068). Vazio, inativa ou que não seja de investimento = SICREDINVEST. Migrations 0064/0068.'
 where chave = 'resgate_conta_origem';

-- Leitura de uma chave com padrão. Roda dentro dos gatilhos dos lançamentos:
-- nunca lança erro (chave ausente = padrão).
create or replace function public.fn_app_config(p_chave text, p_padrao text default null)
returns text language sql stable as $$
  select coalesce((select btrim(valor) from public.app_config where chave = p_chave), p_padrao)
$$;

comment on function public.fn_app_config(text, text) is
  'Valor de uma chave de app_config, ou o padrão se ela não existir. Migration 0068.';

-- Conta de investimento escolhida numa chave, SE válida (mesma régua da 0064:
-- existe, está ativa, é de investimento e não é a própria corrente Sicredi).
create or replace function public.fn_conta_investimento_configurada(p_chave text)
returns uuid language sql stable as $$
  select c.id
    from public.app_config a
    join public.contas_bancarias_empresa c
      on c.id::text = lower(btrim(a.valor))
   where a.chave = p_chave
     and c.ativa = true
     and c.tipo = 'investimento'
     and c.id is distinct from public.fn_conta_sicredi_corrente()
   limit 1
$$;

comment on function public.fn_conta_investimento_configurada(text) is
  'Conta de investimento gravada numa chave de app_config, ou null se vazia/inválida. Migration 0068.';

create or replace function public.fn_conta_resgate_programacao()
returns uuid language sql stable as $$
  select coalesce(public.fn_conta_investimento_configurada('resgate_conta_programacao'),
                  public.fn_conta_sicredi_invest())
$$;

create or replace function public.fn_conta_resgate_fatura()
returns uuid language sql stable as $$
  select coalesce(public.fn_conta_investimento_configurada('resgate_conta_fatura'),
                  public.fn_conta_sicredi_invest())
$$;

comment on function public.fn_conta_resgate_programacao() is
  'Conta de onde sai a linha mensal "Provisionados": a configurada, senão a dos resgates do dia a dia. Migration 0068.';
comment on function public.fn_conta_resgate_fatura() is
  'Conta de onde sai o resgate da fatura do cartão: a configurada, senão a dos resgates do dia a dia. Migration 0068.';

create or replace function public.fn_conta_apelido(p_conta uuid)
returns text language sql stable as $$
  select coalesce(nullif(btrim(apelido), ''), nome)
    from public.contas_bancarias_empresa where id = p_conta
$$;

-- ###########################################################################
-- 3) Regras: data, agrupamento, descrição, observação, origem
-- ###########################################################################

-- Data do resgate de um título. STABLE (era IMMUTABLE): agora lê a configuração.
create or replace function public.fn_dia_resgate(p_venc date)
returns date
language plpgsql
stable
as $$
declare
  v_dia date;
begin
  if p_venc is null then return null; end if;

  -- 0068: o Sicredinvest Automático resgata no fim do dia do pagamento.
  if public.fn_app_config('resgate_data_regra', 'dia_util_anterior') = 'mesmo_dia' then
    return p_venc;
  end if;

  v_dia := public.fn_dia_util_anterior(p_venc);
  -- 0050: atravessou a virada do mês → resgata no próprio dia do vencimento.
  if to_char(v_dia, 'YYYY-MM') is distinct from to_char(p_venc, 'YYYY-MM') then
    return p_venc;
  end if;
  return v_dia;
end;
$$;

comment on function public.fn_dia_resgate(date) is
  'Data do resgate automático de um título: no próprio dia (resgate_data_regra = mesmo_dia, 0068) ou no dia útil anterior, sem atravessar o mês (0050).';

-- Lote da etiqueta: um por dia ("D") ou o da transação (0053).
create or replace function public.fn_resgate_lote_efetivo(p_lote text)
returns text language sql stable as $$
  select case when public.fn_app_config('resgate_agrupamento', 'agendamento') = 'dia'
              then 'D' else p_lote end
$$;

comment on function public.fn_resgate_lote_efetivo(text) is
  'Lote usado na etiqueta do resgate: "D" (um por dia) quando resgate_agrupamento = dia; senão o lote da transação (0053). Migration 0068.';

create or replace function public.fn_resgate_descricao()
returns text language sql stable as $$
  select coalesce(nullif(public.fn_app_config('resgate_descricao', ''), ''),
                  'Resgate da Conta Investimento Invest - Reserva p/ Construção da Sede')
$$;

-- Observação de uma linha automática: some com a chave desligada; o texto
-- personalizado vale para o resgate do dia a dia (as outras famílias explicam
-- a própria regra).
create or replace function public.fn_resgate_observacao(p_padrao text, p_personalizavel boolean)
returns text language sql stable as $$
  select case
           when public.fn_app_config('resgate_observacao_ativa', 'on') = 'off' then null
           when p_personalizavel then coalesce(nullif(public.fn_app_config('resgate_observacao', ''), ''), p_padrao)
           else p_padrao
         end
$$;

-- Descrição nova ("Resgate <conta> - …") quando a conta da família foi
-- escolhida; senão o texto antigo.
create or replace function public.fn_resgate_descricao_familia(p_chave text, p_texto_antigo text, p_sufixo text)
returns text language sql stable as $$
  select case
           when public.fn_conta_investimento_configurada(p_chave) is not null
             then 'Resgate ' || public.fn_conta_apelido(public.fn_conta_investimento_configurada(p_chave)) || ' - ' || p_sufixo
           else p_texto_antigo
         end
$$;

-- A origem do recurso deixa o título gerar resgate? A programação do mês soma
-- tudo e a fatura do cartão é família própria; o resto que foi ao banco só gera
-- par se a origem for a conta padrão.
create or replace function public.fn_titulo_origem_gera_resgate(
  p_origem uuid,
  p_status public.status_aramburu,
  p_forma  public.forma_pgto
)
returns boolean language sql stable as $$
  select public.fn_titulo_provisionado(p_status)
      or p_forma = 'cartao_credito'
      or p_origem is null
      or p_origem = public.fn_conta_sicredi_invest()
$$;

comment on function public.fn_titulo_origem_gera_resgate(uuid, public.status_aramburu, public.forma_pgto) is
  'true = a origem do recurso deixa o título gerar resgate automático: provisionado (programação do mês), cartão (fatura), origem vazia ou igual à conta padrão. Outra origem = resgate feito à parte. Migration 0068.';

-- ###########################################################################
-- 4) Famílias de resgate (corpos da 0066 + regras acima)
-- ###########################################################################

-- 🔴 Do dia a dia.
create or replace function public.fn_resgate_invest_obter(p_dia date, p_lote text)
returns uuid
language plpgsql
as $$
declare
  v_sic  uuid := public.fn_conta_sicredi_corrente();
  v_forn uuid;
  v_id   uuid;
  v_tag  text := 'auto:resgate_invest:' || to_char(p_dia, 'YYYY-MM-DD') || '#' || public.fn_resgate_lote_efetivo(p_lote);
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
     public.fn_resgate_descricao(),
     v_tag,
     public.fn_resgate_observacao(
       case when public.fn_app_config('resgate_agrupamento', 'agendamento') = 'dia'
         then 'Resgate do dia: soma os títulos da conta corrente com vencimento neste dia.'
         else 'Resgate de um agendamento: soma os títulos que foram para o banco juntos, ' ||
              'com vencimento no dia útil seguinte. Um agendamento novo no mesmo dia gera ' ||
              'outra linha, para o extrato bater lançamento a lançamento.'
       end, true))
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.fn_resgate_invest_obter(date, text) is
  'Localiza (ou cria) o resgate CONFIRMADO (vermelho) do dia: um por dia ou por lote de títulos que foram ao banco juntos (resgate_agrupamento). Migrations 0044/0050/0053/0068.';

-- 🟡 Programação do mês.
create or replace function public.fn_resgate_prov_mensal_obter(p_venc date)
returns uuid
language plpgsql
as $$
declare
  v_sic  uuid := public.fn_conta_sicredi_corrente();
  v_forn uuid;
  v_id   uuid;
  v_mes  text := to_char(p_venc, 'YYYY-MM');
  v_tag  text := 'auto:resgate_invest_prov:' || to_char(p_venc, 'YYYY-MM');
  v_dia  date := public.fn_fim_do_mes(p_venc);
  v_mm   text := substring(v_mes from 6 for 2) || '/' || substring(v_mes from 1 for 4);
begin
  if v_sic is null or p_venc is null then return null; end if;

  select id into v_id
    from public.transacoes_empresa
   where origem_planilha = v_tag
     and status = 'resgate'
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
    (v_dia, public.fn_cod('resgate'), public.fn_cod('resgate_sicredi'), 'sem', 'sem', 'sem',
     v_sic, 'resgate', 0,
     v_forn, 'Banco Cooperativa Sicredi',
     public.fn_resgate_descricao_familia('resgate_conta_programacao',
       'Resgate da Conta Investimento Invest - Provisionados de ' || v_mm,
       'Provisionados de ' || v_mm),
     v_tag,
     public.fn_resgate_observacao(
       'Programação: soma de tudo que está provisionado no mês na conta corrente ' ||
       'Sicredi. Cada título sai desta linha quando passa para A Pagar, e vira uma ' ||
       'linha própria de A Resgatar no dia do agendamento.', false))
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.fn_resgate_prov_mensal_obter(date) is
  'Localiza (ou cria) o resgate PROGRAMADO do mês (amarelo), no último dia do mês do vencimento, que soma os títulos provisionados da corrente Sicredi. Sai da conta da programação (0068). Migrations 0053/0068.';

-- 💳 Fatura do cartão.
create or replace function public.fn_resgate_fatura_cartao_obter(p_mes_venc date, p_lote text)
returns uuid
language plpgsql
as $$
declare
  v_sic   uuid := public.fn_conta_sicredi_corrente();
  v_forn  uuid;
  v_id    uuid;
  v_mes   text := to_char(p_mes_venc, 'YYYY-MM');
  v_tag   text := 'auto:resgate_invest_fatura:' || to_char(p_mes_venc, 'YYYY-MM') || '#' || public.fn_resgate_lote_efetivo(p_lote);
  v_mm    text := substring(v_mes from 6 for 2) || '/' || substring(v_mes from 1 for 4);
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
  v_data := public.fn_dia_resgate(v_venc);   -- mesmo dia ou dia útil anterior (0050/0068)

  select id into v_forn from public.fornecedores
   where nome = 'Banco Cooperativa Sicredi' limit 1;

  insert into public.transacoes_empresa
    (data, conta_contabil_cod, centro_custo_cod, tipo_despesa, obs_obra,
     forma_pgto, conta_bancaria_id, status, valor,
     fornecedor_id, fornecedor_nome, descricao, origem_planilha, observacao)
  values
    (v_data, public.fn_cod('resgate'), public.fn_cod('resgate_sicredi'), 'sem', 'sem', 'sem',
     v_sic, 'a_resgatar', 0,
     v_forn, 'Banco Cooperativa Sicredi',
     public.fn_resgate_descricao_familia('resgate_conta_fatura',
       'Resgate da Conta Investimento Invest - Fatura Cartão de Crédito ' || v_mm,
       'Fatura Cartão de Crédito ' || v_mm),
     v_tag,
     public.fn_resgate_observacao(
       'Resgate da fatura do cartão: soma os lançamentos de Cartão de Crédito do ' ||
       'Sicredi que foram para o banco juntos, com vencimento em ' || v_mm || '. ' ||
       case when v_data = v_venc
         then 'Programado para o dia do vencimento da fatura.'
         else 'Programado para o dia útil anterior ao vencimento da fatura.'
       end, false))
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.fn_resgate_fatura_cartao_obter(date, text) is
  'Localiza (ou cria) o resgate CONFIRMADO da fatura do cartão Sicredi do mês. Sai da conta da fatura, na data da regra de resgate (0068). Migrations 0048/0050/0053/0068.';

-- ###########################################################################
-- 5) De qual conta sai cada par
-- ###########################################################################
-- A do espelho já gravado; par nascendo agora = a conta da família.
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
            end
       from public.transacoes_empresa r
      where r.id = p_resgate_id),
    public.fn_conta_sicredi_invest())
$$;

comment on function public.fn_resgate_conta_do_par(uuid) is
  'Conta de investimento de onde sai o resgate informado: a do espelho já gravado ou, sem espelho, a da família (programação, fatura ou dia a dia). Migrations 0064/0068.';

-- Espelho — corpo da 0066; a conta do espelho novo passa a ser a da família e,
-- com descrição configurada, as duas pernas levam o mesmo texto.
create or replace function public.fn_resgate_invest_espelho_sync(p_id uuid)
returns void
language plpgsql
as $$
declare
  v_row       public.transacoes_empresa%rowtype;
  v_sic       uuid := public.fn_conta_sicredi_corrente();
  v_invest    uuid := public.fn_resgate_conta_do_par(p_id);       -- conta do par (0068)
  v_padrao    uuid := public.fn_conta_sicredi_invest_padrao();    -- SICREDINVEST: régua do histórico (0064)
  v_tag       text := 'auto:resgate_invest_saida:' || p_id::text;
  v_espelho   uuid;
  v_baseline  date;
  v_eligivel  boolean;
begin
  if v_sic is null or v_invest is null then return; end if;

  select id into v_espelho
    from public.transacoes_empresa
   where origem_planilha = v_tag
   limit 1;

  select * into v_row from public.transacoes_empresa where id = p_id;

  v_eligivel := found
    and v_row.conta_bancaria_id = v_sic
    and v_row.conta_contabil_cod = public.fn_cod('resgate')
    and v_row.status in ('resgate', 'a_resgatar', 'resgatado')
    and v_row.valor > 0
    and coalesce(v_row.origem_planilha, '') not like 'auto:resgate_invest_saida:%';

  if not v_eligivel then
    if v_espelho is not null then
      delete from public.transacoes_empresa where id = v_espelho;
    end if;
    return;
  end if;

  if v_espelho is null then
    -- Criação: pendente sempre; resgatado só depois do baseline.
    if v_row.status = 'resgatado' then
      select max(data) into v_baseline
        from public.transacoes_empresa
       where conta_bancaria_id = v_padrao and status = 'saldo_inicial';
      if v_baseline is null or v_row.data <= v_baseline then
        return;  -- histórico já embutido no saldo lançado do Invest
      end if;
      if v_invest is distinct from v_padrao then
        select max(data) into v_baseline
          from public.transacoes_empresa
         where conta_bancaria_id = v_invest and status = 'saldo_inicial';
        if v_baseline is null or v_row.data <= v_baseline then
          return;
        end if;
      end if;
    end if;
    insert into public.transacoes_empresa
      (data, conta_contabil_cod, centro_custo_cod, tipo_despesa, obs_obra, forma_pgto,
       conta_bancaria_id, status, valor, fornecedor_id, fornecedor_nome,
       descricao, origem_planilha)
    values
      (v_row.data, public.fn_cod('resgate'), public.fn_cod('resgate_sicredi'), 'sem', 'sem', 'sem',
       v_invest, v_row.status, -v_row.valor, v_row.fornecedor_id, v_row.fornecedor_nome,
       case when public.fn_app_config('resgate_descricao', '') <> ''
         then coalesce(v_row.descricao, 'resgate')
         else 'Saída do Invest p/ Conta Corrente — ' || coalesce(v_row.descricao, 'resgate')
       end,
       v_tag);
    return;
  end if;

  -- Espelho existe → mantém em sincronia (data/valor/status). A CONTA dele
  -- nunca é reescrita: par já criado continua saindo da conta em que nasceu.
  update public.transacoes_empresa set
    data   = v_row.data,
    valor  = -v_row.valor,
    status = v_row.status
  where id = v_espelho
    and (data   is distinct from v_row.data
      or valor  is distinct from -v_row.valor
      or status is distinct from v_row.status);
end;
$$;

-- Recalc — corpo da 0066; o aviso de saldo passa a obedecer a chave.
create or replace function public.fn_resgate_invest_recalc(p_resgate_id uuid, p_validar boolean default true)
returns void
language plpgsql
as $$
declare
  v_resgate      public.transacoes_empresa%rowtype;
  v_total        numeric(15,2);
  v_eh_prog      boolean;
  v_status_novo  public.status_aramburu;
  v_invest       uuid := public.fn_resgate_conta_do_par(p_resgate_id);
  v_sic          uuid := public.fn_conta_sicredi_corrente();
  v_saldo_invest numeric(15,2);
  v_comprometido numeric(15,2);
  v_disponivel   numeric(15,2);
  v_nome_conta   text;
begin
  if p_resgate_id is null then return; end if;

  select * into v_resgate
    from public.transacoes_empresa
   where id = p_resgate_id
     and (origem_planilha like 'auto:resgate_invest:%'
       or origem_planilha like 'auto:resgate_invest_fatura:%'
       or origem_planilha like 'auto:resgate_invest_prov:%')
   for update;
  if not found then return; end if;

  if v_resgate.status = 'resgatado' then return; end if;

  v_eh_prog := v_resgate.origem_planilha like 'auto:resgate_invest_prov:%';

  select coalesce(sum(-valor), 0)
    into v_total
    from public.transacoes_empresa
   where resgate_auto_id = p_resgate_id;

  if v_total <= 0 then
    delete from public.transacoes_empresa where id = p_resgate_id;
    return;
  end if;

  v_status_novo := case when v_eh_prog then 'resgate' else 'a_resgatar' end;

  if p_validar and v_invest is not null
     and public.fn_app_config('resgate_validar_saldo', 'on') <> 'off' then   -- 0068
    select coalesce(sum(valor), 0) into v_saldo_invest
      from public.transacoes_empresa
     where conta_bancaria_id = v_invest
       and status in ('saldo_inicial', 'recebido', 'pago', 'repassado', 'aplicado', 'aplicacao', 'resgatado');

    if exists (select 1 from public.transacoes_empresa where conta_bancaria_id = v_invest) then
      select coalesce(sum(valor), 0) into v_comprometido
        from public.transacoes_empresa
       where conta_bancaria_id = v_sic
         and conta_contabil_cod = (select public.fn_cod('resgate'))
         and status in ('resgate', 'a_resgatar')
         and id <> p_resgate_id
         and public.fn_resgate_conta_do_par(id) = v_invest;

      v_disponivel := v_saldo_invest - v_comprometido;
      if v_total > v_disponivel
         and coalesce(current_setting('arambi.invest_sem_validacao', true), 'off') <> 'on' then
        if v_invest is not distinct from public.fn_conta_sicredi_invest_padrao() then
          raise exception
            'Saldo insuficiente na conta Sicredi Invest: o resgate de % excede o disponível de % (saldo % menos % já comprometidos em outros resgates).',
            to_char(v_total, 'FM999G999G990D00'), to_char(v_disponivel, 'FM999G999G990D00'),
            to_char(v_saldo_invest, 'FM999G999G990D00'), to_char(v_comprometido, 'FM999G999G990D00');
        end if;

        select coalesce(nullif(btrim(apelido), ''), nome) into v_nome_conta
          from public.contas_bancarias_empresa where id = v_invest;
        raise exception
          'Saldo insuficiente na conta de investimento %: o resgate de % excede o disponível de % (saldo % menos % já comprometidos em outros resgates).',
          coalesce(v_nome_conta, 'escolhida'),
          to_char(v_total, 'FM999G999G990D00'), to_char(v_disponivel, 'FM999G999G990D00'),
          to_char(v_saldo_invest, 'FM999G999G990D00'), to_char(v_comprometido, 'FM999G999G990D00');
      end if;
    end if;
  end if;

  update public.transacoes_empresa
     set valor = v_total, status = v_status_novo
   where id = p_resgate_id
     and (valor is distinct from v_total or status is distinct from v_status_novo);
end;
$$;

-- ###########################################################################
-- 6) Gatilho de vínculo — corpo da 0054 + origem do recurso
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

  -- 0068: com origem do recurso de fora (resgate feito à parte), o que já foi
  -- ao banco não puxa resgate — e soltar o vínculo encolhe o resgate antigo.
  v_eh_driver := public.fn_titulo_puxa_resgate(
                   new.conta_bancaria_id, new.valor, new.status, new.dispensa_resgate)
             and public.fn_titulo_origem_gera_resgate(new.resgate_origem_id, new.status, new.forma_pgto);

  if tg_op = 'INSERT' then
    if v_eh_driver and public.fn_resgates_auto_sicredi_ativos() then
      new.resgate_auto_id := public.fn_resgate_alvo_do_titulo(
        new.forma_pgto, new.data, new.status, public.fn_resgate_lote());
    end if;
    return new;
  end if;

  -- UPDATE
  v_era_driver := public.fn_titulo_puxa_resgate(
                    old.conta_bancaria_id, old.valor, old.status, old.dispensa_resgate)
              and public.fn_titulo_origem_gera_resgate(old.resgate_origem_id, old.status, old.forma_pgto);

  if not v_eh_driver then
    -- Saiu do escopo (mudou de banco, virou entrada, virou APLICAÇÃO, foi
    -- marcado como pago pelo saldo da conta ou ganhou outra origem do recurso)
    -- → desvincula; o AFTER recalcula o resgate antigo, que encolhe (ou some).
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
  'Vincula títulos do Sicredi ao resgate certo: mensal programado enquanto provisionado, do dia depois que vai para o banco (0053/0068); fatura no cartão (0048); fora do escopo os pagos pelo saldo da conta (0049), as APLICAÇÕES (0054) e os com outra origem do recurso (0068).';

-- ###########################################################################
-- 7) Configuração pedida pela Adri (documentos de 29/30-out)
-- ###########################################################################
-- Só preenche o que ainda estiver no padrão — rodar de novo (ou depois de ela
-- mudar algo em Automações) não sobrescreve escolha nenhuma.
do $$
declare
  v_auto  uuid;
  v_fundo uuid;
begin
  select id into v_auto from public.contas_bancarias_empresa
   where ativa and tipo = 'investimento'
     and (apelido ilike '%automátic%' or apelido ilike '%automatic%' or nome ilike '%aplicação automática%')
   order by ordem nulls last limit 1;
  select id into v_fundo from public.contas_bancarias_empresa
   where ativa and tipo = 'investimento'
     and (apelido ilike '%empresarial%' or nome ilike '%empresarial%')
   order by ordem nulls last limit 1;

  if v_auto is null or v_fundo is null then
    raise notice '0068: contas Sicredinvest Automático/Fundo Empresarial não encontradas — configuração NÃO gravada; ajuste em Configurações → Automações.';
    return;
  end if;

  update public.app_config set valor = v_auto::text,  updated_at = now()
   where chave = 'resgate_conta_origem' and coalesce(btrim(valor), '') = '';
  update public.app_config set valor = v_fundo::text, updated_at = now()
   where chave in ('resgate_conta_programacao', 'resgate_conta_fatura') and coalesce(btrim(valor), '') = '';
  update public.app_config set valor = 'mesmo_dia', updated_at = now()
   where chave = 'resgate_data_regra' and valor = 'dia_util_anterior';
  update public.app_config set valor = 'dia', updated_at = now()
   where chave = 'resgate_agrupamento' and valor = 'agendamento';
  update public.app_config set valor = 'Resgate Sicredinvest Automático', updated_at = now()
   where chave = 'resgate_descricao' and coalesce(btrim(valor), '') = '';
  update public.app_config set valor = 'off', updated_at = now()
   where chave in ('resgate_observacao_ativa', 'resgate_validar_saldo') and valor = 'on';
end $$;

-- ###########################################################################
-- 8) Reparo dos pendentes (só o que ainda está no modelo antigo)
-- ###########################################################################
do $$
declare
  v_sic    uuid := public.fn_conta_sicredi_corrente();
  v_auto   uuid := public.fn_conta_investimento_configurada('resgate_conta_origem');
  v_fundo  uuid := public.fn_conta_investimento_configurada('resgate_conta_programacao');
  v_qtd    int;
begin
  if v_sic is null or v_auto is null then
    raise notice '0068: reparo pulado (conta corrente Sicredi ou conta padrão dos resgates não configurada).';
    return;
  end if;
  -- O reparo refaz pares pendentes: a trava de saldo não pode barrá-lo.
  perform set_config('arambi.invest_sem_validacao', 'on', true);

  -- (a) Títulos A Pagar de novembro em diante que ela deixou SEM resgate (apagou
  --     o par: cobertos pelo resgate global do Fundo Empresarial) → origem Fundo.
  if v_fundo is not null then
    update public.transacoes_empresa t
       set resgate_origem_id = v_fundo
     where t.conta_bancaria_id = v_sic
       and t.valor < 0
       and t.status = 'a_pagar'
       and t.data >= date '2026-11-01'
       and t.resgate_auto_id is null
       and t.resgate_origem_id is null
       and t.forma_pgto is distinct from 'cartao_credito'
       and not coalesce(t.dispensa_resgate, false)
       and coalesce(t.origem_planilha, '') not like 'auto:resgate_invest%';
    get diagnostics v_qtd = row_count;
    raise notice '0068: % título(s) A Pagar sem resgate passaram a ter origem = Fundo Empresarial.', v_qtd;
  end if;

  -- (b) Títulos presos a resgates do dia PENDENTES → alvo da regra nova (dia,
  --     data, conta, descrição). O resgate antigo encolhe e some com o espelho.
  with alvo as (
    select t.id,
           public.fn_resgate_alvo_do_titulo(t.forma_pgto, t.data, t.status, 'R0068') as novo
      from public.transacoes_empresa t
      join public.transacoes_empresa r on r.id = t.resgate_auto_id
     where r.origem_planilha like 'auto:resgate_invest:%'
       and r.status = 'a_resgatar'
       and r.origem_planilha not like '%#' || public.fn_resgate_lote_efetivo('R0068')
  )
  update public.transacoes_empresa t
     set resgate_auto_id = a.novo
    from alvo a
   where t.id = a.id
     and t.resgate_auto_id is distinct from a.novo;
  get diagnostics v_qtd = row_count;
  raise notice '0068: % título(s) mudaram para o resgate do dia no modelo novo.', v_qtd;

  -- (c) Linhas mensais pendentes: espelho passa para a conta da programação e a
  --     descrição/observação seguem a configuração.
  update public.transacoes_empresa e
     set conta_bancaria_id = public.fn_conta_resgate_programacao(),
         descricao = r.descricao_nova
    from (select r.id,
                 public.fn_resgate_descricao_familia('resgate_conta_programacao', r.descricao,
                   'Provisionados de ' || substring(to_char(r.data, 'YYYY-MM') from 6 for 2) || '/' ||
                                          substring(to_char(r.data, 'YYYY-MM') from 1 for 4)) as descricao_nova
            from public.transacoes_empresa r
           where r.origem_planilha like 'auto:resgate_invest_prov:%'
             and r.status = 'resgate') r
   where e.origem_planilha = 'auto:resgate_invest_saida:' || r.id::text
     and e.status = 'resgate'
     and (e.conta_bancaria_id is distinct from public.fn_conta_resgate_programacao()
       or e.descricao is distinct from r.descricao_nova);
  get diagnostics v_qtd = row_count;
  raise notice '0068: % espelho(s) da programação mensal passaram para a conta da programação.', v_qtd;

  update public.transacoes_empresa r
     set descricao = public.fn_resgate_descricao_familia('resgate_conta_programacao', r.descricao,
                       'Provisionados de ' || substring(to_char(r.data, 'YYYY-MM') from 6 for 2) || '/' ||
                                              substring(to_char(r.data, 'YYYY-MM') from 1 for 4)),
         observacao = public.fn_resgate_observacao(r.observacao, false)
   where r.origem_planilha like 'auto:resgate_invest_prov:%'
     and r.status = 'resgate'
     and (r.descricao is distinct from public.fn_resgate_descricao_familia('resgate_conta_programacao', r.descricao,
                       'Provisionados de ' || substring(to_char(r.data, 'YYYY-MM') from 6 for 2) || '/' ||
                                              substring(to_char(r.data, 'YYYY-MM') from 1 for 4))
       or r.observacao is distinct from public.fn_resgate_observacao(r.observacao, false));
  get diagnostics v_qtd = row_count;
  raise notice '0068: % linha(s) mensal(is) com descrição/observação atualizadas.', v_qtd;
end $$;
