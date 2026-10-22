-- ============================================================================
-- 0064 — Conta de origem dos resgates automáticos (SICREDINVEST ou as novas)
-- ============================================================================
-- Pedido (reunião de 20-out-2026): com as contas novas SICREDI EMPRESARIAL e
-- SICREDI APLICAÇÃO AUTOMÁTICA (0060), "implementar a função de resgate para
-- ambas as novas contas, seguindo a mesma lógica já utilizada no SICREDINVEST".
--
-- Como era: toda despesa paga pela corrente SICREDI (0913) gera um PAR de
-- resgate — linha positiva 1.8 na corrente (0044/0053) + espelho negativo na
-- conta de investimento (0045, etiqueta auto:resgate_invest_saida:<id>) —, e a
-- conta de investimento era sempre a SICREDINVEST (fn_conta_sicredi_invest,
-- fixa pelo nome desde a 0044).
--
-- O que muda (mesma lógica, só a conta passa a ser escolhida):
--   • app_config 'resgate_conta_origem' = id da conta de investimento de onde
--     saem os resgates NOVOS (Configurações → Automações). Vazio, ou conta
--     inativa / que não seja de investimento / inexistente → SICREDINVEST, o
--     comportamento de hoje. Sem mexer na tela, NADA muda.
--   • fn_conta_sicredi_invest() devolve a conta configurada quando válida. O
--     corpo antigo (busca da SICREDINVEST pelo nome/apelido) virou
--     fn_conta_sicredi_invest_padrao(), idêntico ao da 0044.
--
-- Pares que JÁ existem ficam na conta deles. Conferido em todas as definições
-- vigentes antes de mexer:
--   • fn_resgate_invest_espelho_sync (0045) é a única função que grava a linha
--     negativa. Espelho existente só tem data/valor/status atualizados — a
--     CONTA nunca é reescrita. A conta só é escolhida quando o espelho NASCE.
--   • fn_resgate_invest_recalc (0053) só grava a linha positiva da corrente;
--     tg_te_resgate_espelho_reverso (0056) só devolve o status à corrente.
--   Logo, recalcular um resgate antigo (título mudou de status, de valor, de
--   data…) mantém a linha negativa onde ela está. Dois ajustes, para isso
--   continuar verdade com mais de uma conta possível:
--
--   1. HISTÓRICO SEM ESPELHO (espelho_sync, corpo da 0045): resgate já
--      Resgatado na corrente e sem espelho só ganha espelho depois do
--      "baseline" (último saldo inicial) da conta — regra da 0045. Esse
--      baseline passa a ser medido SEMPRE pela SICREDINVEST (de onde o
--      histórico saiu) e, se a conta escolhida for outra, também pela dela. Sem
--      isso, os resgates antigos sem espelho (cópia de produção de 21-out: 139
--      linhas até 23/07/2026, R$ 462.697,07) ganhariam espelho na conta NOVA na
--      primeira vez que fossem tocados (edição, restauração da Lixeira, script
--      de reparo…), caso ela tenha um saldo inicial mais antigo — debitando
--      dela um dinheiro que saiu da SICREDINVEST.
--   2. VALIDAÇÃO DE SALDO (recalc, corpo da 0053): olha a conta de onde o par SAI —
--      a do espelho já gravado; par novo (ainda sem espelho) = a configurada.
--      O "já comprometido" passa a somar só os resgates pendentes da MESMA
--      conta. Com tudo na SICREDINVEST (sem configuração) a conta é exatamente
--      a de antes. A mensagem da SICREDINVEST é idêntica à de antes (a tela do
--      Financeiro abre o "Executar mesmo assim" por ela); nas outras contas sai
--      "Saldo insuficiente na conta de investimento <APELIDO>: …".
--      A regra de ativação não muda: a validação só vale quando a conta tem
--      algum lançamento — numa conta nova, lance o "Saldo inicial" dela antes
--      de trocar, senão a partir do 2º resgate o sistema alerta saldo 0.
--
-- Leitura prática da regra "par novo × par existente":
--   • Vermelho (A Pagar / fatura): cada agendamento é uma linha nova (lote,
--     0053) → sai sempre da conta configurada no momento.
--   • Amarelo (Provisionado): é UMA linha por mês (0053). Título provisionado
--     num mês que já tem a linha amarela entra nela e fica na conta dela; num
--     mês sem linha, a linha nasce na conta configurada. Quando o título vai
--     para A Pagar ele sai da amarela e nasce no vermelho → conta configurada.
--   • Para levar um par antigo para a conta nova, basta editar a CONTA da linha
--     negativa dele no Financeiro: daí em diante ele fica lá (e é validado lá).
--   • Espelho apagado à mão e recriado depois (raro) nasce na conta
--     configurada naquele momento.
--
-- Desempenho: índice em transacoes_empresa(origem_planilha) — as buscas por
-- etiqueta (espelho, linha do mês, DL/DV) eram varredura da tabela inteira e a
-- validação agora consulta a etiqueta do espelho de cada resgate pendente.
--
-- Independe da 0056 (não toca no gatilho reverso): funciona com ou sem ela.
-- Aplicar após a 0060 (contas novas) — sem ela também funciona, só não haverá
-- as contas novas para escolher. Idempotente: reaplicar não muda a escolha
-- já gravada.

-- ---------------------------------------------------------------------------
-- 1) Configuração (vazia = SICREDINVEST, o comportamento de hoje)
-- ---------------------------------------------------------------------------
insert into public.app_config (chave, valor, descricao) values
  ('resgate_conta_origem', '',
   'Conta de investimento de onde saem os resgates automáticos NOVOS (id em Bancos). Vazio, conta inativa ou que não seja de investimento = SICREDINVEST (padrão). Resgates já criados ficam na conta deles. Migration 0064.')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------------
-- 2) Qual conta de investimento recebe os pares NOVOS
-- ---------------------------------------------------------------------------
-- Corpo IDÊNTICO ao fn_conta_sicredi_invest() da 0044.
create or replace function public.fn_conta_sicredi_invest_padrao()
returns uuid language sql stable as $$
  select id from public.contas_bancarias_empresa
   where nome = 'Cooperativa Sicredi Investimento (0913)'
      or apelido = 'SICREDINVEST'
   order by ativa desc limit 1
$$;

comment on function public.fn_conta_sicredi_invest_padrao() is
  'A SICREDINVEST (busca pelo nome/apelido, como na 0044) — conta padrão dos resgates automáticos e referência do histórico. Migration 0064.';

-- Conta escolhida em Configurações → Automações, SE for válida: existe, está
-- ativa, é de investimento e não é a própria corrente Sicredi. Compara como
-- texto para nunca dar erro de conversão com um valor torto (este caminho roda
-- dentro dos gatilhos dos lançamentos — erro aqui travaria o Financeiro).
create or replace function public.fn_conta_resgate_origem_configurada()
returns uuid language sql stable as $$
  select c.id
    from public.app_config a
    join public.contas_bancarias_empresa c
      on c.id::text = lower(btrim(a.valor))
   where a.chave = 'resgate_conta_origem'
     and c.ativa = true
     and c.tipo = 'investimento'
     and c.id is distinct from public.fn_conta_sicredi_corrente()
   limit 1
$$;

comment on function public.fn_conta_resgate_origem_configurada() is
  'Conta de origem dos resgates automáticos escolhida em Automações (app_config resgate_conta_origem), ou null se vazia/inválida (inativa, não investimento, inexistente). Migration 0064.';

-- Mesma assinatura de sempre (as funções de resgate chamam por este nome).
create or replace function public.fn_conta_sicredi_invest()
returns uuid language sql stable as $$
  select coalesce(public.fn_conta_resgate_origem_configurada(),
                  public.fn_conta_sicredi_invest_padrao())
$$;

comment on function public.fn_conta_sicredi_invest() is
  'Conta de investimento que recebe o espelho (saída) dos resgates automáticos NOVOS: a configurada em Automações quando válida, senão a SICREDINVEST. Pares já criados ficam na conta deles (fn_resgate_conta_do_par). Migrations 0044/0064.';

-- ---------------------------------------------------------------------------
-- 3) De qual conta sai um par de resgate
-- ---------------------------------------------------------------------------
-- A do espelho já gravado; sem espelho (par nascendo agora) = a que vai
-- recebê-lo. É o que a validação de saldo usa.
create or replace function public.fn_resgate_conta_do_par(p_resgate_id uuid)
returns uuid language sql stable as $$
  select coalesce(
    (select e.conta_bancaria_id
       from public.transacoes_empresa e
      where e.origem_planilha = 'auto:resgate_invest_saida:' || p_resgate_id::text
        and e.conta_bancaria_id is not null
      order by e.created_at
      limit 1),
    public.fn_conta_sicredi_invest())
$$;

comment on function public.fn_resgate_conta_do_par(uuid) is
  'Conta de investimento de onde sai o resgate (linha da corrente) informado: a do espelho já gravado ou, se ainda não houver espelho, a que vai recebê-lo (fn_conta_sicredi_invest). Migration 0064.';

-- Só desempenho (não muda resultado): busca por etiqueta deixa de varrer a tabela.
create index if not exists idx_te_origem_planilha
  on public.transacoes_empresa (origem_planilha);

-- ---------------------------------------------------------------------------
-- 4) Espelho — corpo da 0045; muda só a criação de espelho de resgate que já
--    nasce/está Resgatado (histórico medido pela SICREDINVEST)
-- ---------------------------------------------------------------------------
create or replace function public.fn_resgate_invest_espelho_sync(p_id uuid)
returns void
language plpgsql
as $$
declare
  v_row       public.transacoes_empresa%rowtype;
  v_sic       uuid := public.fn_conta_sicredi_corrente();
  v_invest    uuid := public.fn_conta_sicredi_invest();         -- conta dos espelhos NOVOS (0064)
  v_padrao    uuid := public.fn_conta_sicredi_invest_padrao();  -- SICREDINVEST: régua do histórico (0064)
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
    and v_row.conta_contabil_cod = '1.8'
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
      -- 0064: o histórico saiu da SICREDINVEST — é o saldo lançado DELA que já
      -- desconta os resgates antigos. Sem configuração v_invest = v_padrao e
      -- esta é exatamente a checagem da 0045.
      select max(data) into v_baseline
        from public.transacoes_empresa
       where conta_bancaria_id = v_padrao and status = 'saldo_inicial';
      if v_baseline is null or v_row.data <= v_baseline then
        return;  -- histórico já embutido no saldo lançado do Invest
      end if;
      -- Conta escolhida é outra: a mesma regra vale para o saldo lançado dela.
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
      (v_row.data, '1.8', '1.8.1', 'sem', 'sem', 'sem',
       v_invest, v_row.status, -v_row.valor, v_row.fornecedor_id, v_row.fornecedor_nome,
       'Saída do Invest p/ Conta Corrente — ' || coalesce(v_row.descricao, 'resgate'),
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

comment on function public.fn_resgate_invest_espelho_sync(uuid) is
  'Mantém o espelho (saída na conta de investimento) de uma linha de resgate da corrente Sicredi — cria/atualiza/remove conforme o estado da linha. Espelho novo nasce na conta configurada (0064); espelho existente nunca muda de conta. Migrations 0045/0064.';

-- ---------------------------------------------------------------------------
-- 5) Recalc — corpo da 0053; muda só a conta usada na validação de saldo
-- ---------------------------------------------------------------------------
create or replace function public.fn_resgate_invest_recalc(p_resgate_id uuid, p_validar boolean default true)
returns void
language plpgsql
as $$
declare
  v_resgate      public.transacoes_empresa%rowtype;
  v_total        numeric(15,2);
  v_eh_prog      boolean;
  v_status_novo  public.status_aramburu;
  -- 0064: conta de onde ESTE par sai (a do espelho; par novo = a configurada).
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

  if p_validar and v_invest is not null then
    select coalesce(sum(valor), 0) into v_saldo_invest
      from public.transacoes_empresa
     where conta_bancaria_id = v_invest
       and status in ('saldo_inicial', 'recebido', 'pago', 'repassado', 'aplicado', 'aplicacao', 'resgatado');

    if exists (select 1 from public.transacoes_empresa where conta_bancaria_id = v_invest) then
      -- 0064: só os resgates pendentes que saem da MESMA conta reservam o saldo dela.
      select coalesce(sum(valor), 0) into v_comprometido
        from public.transacoes_empresa
       where conta_bancaria_id = v_sic
         and conta_contabil_cod = '1.8'
         and status in ('resgate', 'a_resgatar')
         and id <> p_resgate_id
         and public.fn_resgate_conta_do_par(id) = v_invest;

      v_disponivel := v_saldo_invest - v_comprometido;
      if v_total > v_disponivel
         and coalesce(current_setting('arambi.invest_sem_validacao', true), 'off') <> 'on' then
        -- SICREDINVEST: mensagem idêntica à de antes (a tela reconhece por ela).
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

comment on function public.fn_resgate_invest_recalc(uuid, boolean) is
  'Recalcula um resgate automático a partir dos títulos vinculados. O status vem da família da linha: programada do mês fica Resgate (amarelo), agendamento fica A Resgatar (vermelho). Valida o saldo da conta de onde o par sai (0064). Migrations 0044/0048/0053/0064.';

-- ---------------------------------------------------------------------------
-- 6) Conferência
-- ---------------------------------------------------------------------------
do $$
declare
  v_conta text;
begin
  select coalesce(nullif(btrim(apelido), ''), nome) into v_conta
    from public.contas_bancarias_empresa where id = public.fn_conta_sicredi_invest();
  raise notice '0064: resgates automáticos novos saem de: % (configurada: %).',
    coalesce(v_conta, '— nenhuma conta de investimento encontrada —'),
    case when public.fn_conta_resgate_origem_configurada() is null then 'não — padrão SICREDINVEST' else 'sim' end;
end $$;

-- ----------------------------------------------------------------------------
-- ROLLBACK (nesta ordem — as funções SQL não registram dependência entre si):
--   -- 1) Voltar os resgates NOVOS para a SICREDINVEST (não desfaz nada já criado):
--   update public.app_config set valor = '' where chave = 'resgate_conta_origem';
--   -- 2) Restaurar fn_conta_sicredi_invest da 0044:
--   create or replace function public.fn_conta_sicredi_invest()
--   returns uuid language sql stable as $f$
--     select id from public.contas_bancarias_empresa
--      where nome = 'Cooperativa Sicredi Investimento (0913)'
--         or apelido = 'SICREDINVEST'
--      order by ativa desc limit 1
--   $f$;
--   -- 3) Reexecutar a seção 1 da 0045 (fn_resgate_invest_espelho_sync) e a
--   --    seção 5 da 0053 (fn_resgate_invest_recalc). Pares que já tiverem
--   --    nascido em outra conta continuam lá, mas a validação volta a olhar só
--   --    a SICREDINVEST.
--   drop function if exists public.fn_resgate_conta_do_par(uuid);
--   drop function if exists public.fn_conta_resgate_origem_configurada();
--   drop function if exists public.fn_conta_sicredi_invest_padrao();
--   drop index if exists public.idx_te_origem_planilha;
--   delete from public.app_config where chave = 'resgate_conta_origem';
-- ----------------------------------------------------------------------------
