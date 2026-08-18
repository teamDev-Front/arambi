-- ============================================================================
-- 0055 — A linha automática de Despesa Variável precisa ADOTAR a linha que já
--        existe no mês, mesmo quando ela veio da importação da planilha
-- ============================================================================
-- SINTOMA (Adriane, 18-ago-2026, minutos depois de a 0054 subir):
--   "Desse excedeu, mas vi que tem um Provisionado DV, neste caso ele deveria
--    sumir, pois excedeu os 20 mil mensal. Ele é um manual? Olhando para
--    Agosto."
--
--   Agosto ficou com DUAS linhas Provisionado DV:
--     • 30/08 · 2.3/2.3.6 · "Despesas Variáveis" · ref Ago/2026 · −2.579,27
--       → a dela, que já existia
--     • 31/08 · 2.9/2.9.3 · "Despesa Variável — Saldo do mês (automático)" · 0,00
--       → a que a 0054 criou
--
-- DIAGNÓSTICO: a adoção da 0054 procurava a linha existente com
--
--     and origem_planilha is null
--
-- e as linhas dela NÃO têm origem nula — vieram dos seeds/importações da
-- planilha e carregam a etiqueta de procedência. A condição nunca casava, então
-- o "adota em vez de duplicar" que a tela promete nunca acontecia na base real:
-- só funcionava numa linha digitada do zero pela interface.
--
-- O erro de projeto foi usar `origem_planilha is null` como sinônimo de "linha
-- manual". Ela não significa isso — significa "sem procedência registrada".
-- O que de fato precisa ficar de fora da adoção são as linhas de OUTRAS
-- automações (dl_auto:, auto:resgate_*, dl_repasse:, venda_*), que já têm dono.
--
-- Esta migration:
--   1. corrige a adoção (reconhece a linha importada, e se recusa a escolher
--      quando houver mais de uma candidata);
--   2. desfaz o estrago: apaga as linhas 0,00 que a 0054 criou em meses que já
--      tinham a linha da Adriane. NÃO adota nem recalcula nada por conta
--      própria — os valores dela ficam exatamente como estão, e a adoção volta
--      a ser uma decisão dela, mês a mês, pelo botão da tela.
--
-- Aplicar após a 0054.

-- SEGUNDO PONTO, da mesma conversa:
--   "neste caso ele deveria sumir, pois excedeu os 20 mil mensal"
--   "Cliquei no botão de atualizar. Zerou." / "Eu posso apagar? Depois de zerado."
--
-- Ela está certa, e aqui eu fui incoerente com o próprio sistema: quando não há
-- saldo, a 0054 deixava uma linha de R$ 0,00 parada no Financeiro. O
-- Provisionado DL (fn_sync_provisionado_dl, 0047/0052) já resolve isso do jeito
-- certo há tempos — quando não há o que mostrar, ele APAGA a própria linha.
--
-- Passa a valer o mesmo para a DV, com uma ressalva que importa: só some a
-- linha que o SISTEMA criou. Uma linha ADOTADA é dela — tem centro de custo,
-- referência e histórico próprios —, então essa é zerada, nunca apagada.
--
-- ---------------------------------------------------------------------------
-- 1) Quem pode ser adotada como a linha de saldo do mês
-- ---------------------------------------------------------------------------
-- Etiquetas que pertencem a outra automação — essas jamais são adotadas.
create or replace function public.fn_origem_de_outra_automacao(p_origem text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_origem, '') ~ '^(auto:|dl_auto:|dv_auto:|dl_repasse:|venda_auto:|venda_taxa_auto:)'
$$;

comment on function public.fn_origem_de_outra_automacao(text) is
  'true = a etiqueta de procedência pertence a uma automação do sistema (resgate, DL, saldo DV, venda). Linhas assim não são adotadas por outra automação. Migration 0055.';

-- ---------------------------------------------------------------------------
-- 1b) Sem saldo, a linha do sistema some (a adotada é dela, só zera)
-- ---------------------------------------------------------------------------
create or replace function public.fn_dv_sync_linha(p_mes text)
returns void
language plpgsql
as $$
declare
  v_tag    text := 'dv_auto:' || p_mes;
  v_id     uuid;
  v_desc   text;
  v_saldo  numeric(15,2);
  v_obs    text;
begin
  if p_mes is null then return; end if;

  select id, descricao into v_id, v_desc
    from public.transacoes_empresa where origem_planilha = v_tag limit 1;
  if v_id is null then return; end if;

  v_saldo := public.fn_dv_limite_mensal() - public.fn_dv_utilizado(p_mes);

  if v_saldo <= 0 then
    -- Estourou o teto: não há saldo nenhum a programar no mês.
    if v_desc = public.fn_dv_descricao_auto() then
      -- Linha criada pelo sistema → some (mesma regra do Provisionado DL).
      delete from public.transacoes_empresa where id = v_id;
    else
      -- Linha ADOTADA: é dela. Zera o valor, mas não apaga o lançamento.
      update public.transacoes_empresa
         set valor = 0,
             observacao = 'Saldo automático: a competência já passou do teto de ' ||
                          to_char(public.fn_dv_limite_mensal(), 'FM999G999G990D00') ||
                          ' em ' || to_char(-v_saldo, 'FM999G999G990D00') ||
                          ', então não há saldo a programar. Não editar o valor à mão.'
       where id = v_id and valor is distinct from 0;
    end if;
    return;
  end if;

  v_obs := 'Linha mantida automaticamente: teto de ' ||
           to_char(public.fn_dv_limite_mensal(), 'FM999G999G990D00') ||
           ' menos ' || to_char(public.fn_dv_utilizado(p_mes), 'FM999G999G990D00') ||
           ' já lançados como Despesa Variável no mês. Não editar o valor à mão.';

  update public.transacoes_empresa
     set valor = -v_saldo,
         observacao = v_obs
   where id = v_id
     and (valor is distinct from -v_saldo or observacao is distinct from v_obs);
exception when others then
  -- Nunca bloquear o lançamento da despesa por causa da linha de saldo.
  null;
end;
$$;

comment on function public.fn_dv_sync_linha(text) is
  'Mantém a linha Provisionado DV do mês igual ao saldo do teto. Sem saldo, a linha criada pelo sistema é apagada e a adotada é zerada. Migration 0054/0055.';

-- Devolve null quando o mês não tem saldo a programar (a tela avisa em vez de
-- dizer que lançou algo que não existe).
create or replace function public.fn_dv_gerar_linha(p_mes text)
returns uuid
language plpgsql
as $$
declare
  v_tag    text := 'dv_auto:' || p_mes;
  v_id     uuid;
  v_qtd    int;
  v_banco  uuid;
  v_conta  text := '2.9';
  v_centro text := '2.9.3';
begin
  if p_mes is null or p_mes !~ '^\d{4}-\d{2}$' then
    raise exception 'Competência inválida (esperado AAAA-MM): %', p_mes;
  end if;

  select id into v_id from public.transacoes_empresa where origem_planilha = v_tag limit 1;

  if v_id is null then
    -- Adota a linha Provisionado DV que o mês já tiver — inclusive a importada
    -- da planilha (0055). Só não adota o que já é de outra automação.
    -- (array_agg(...))[1] e não min(id): o Postgres não tem min/max para uuid.
    select count(*), (array_agg(id order by created_at))[1]
      into v_qtd, v_id
      from public.transacoes_empresa
     where mes_referencia = p_mes
       and status = 'provisionado_dv'
       and not public.fn_origem_de_outra_automacao(origem_planilha);

    -- Com duas ou mais, o sistema não escolhe: escolher errado significaria
    -- passar a sobrescrever o valor da linha errada todo mês, em silêncio.
    if v_qtd > 1 then
      raise exception
        'A competência % tem % lançamentos com status Provisionado DV. Deixe apenas um (exclua ou troque o status dos demais) e clique de novo — o sistema não escolhe sozinho qual deles passa a ser a linha automática do saldo.',
        p_mes, v_qtd;
    end if;

    if v_qtd = 1 then
      update public.transacoes_empresa set origem_planilha = v_tag where id = v_id;
    else
      v_id := null;
    end if;
  end if;

  if v_id is null then
    if not exists (select 1 from public.classificacao_financeira where codigo = v_centro) then
      -- Plano de contas sem 2.9.3 → cai em qualquer centro de saída existente.
      select codigo, parent_codigo into v_centro, v_conta
        from public.classificacao_financeira
       where nivel = 3 and natureza = 'saida' and ativo
       order by ordem nulls last, codigo
       limit 1;
      if v_centro is null then
        raise exception 'Plano de contas sem nenhum centro de custo de saída — cadastre em Configurações → Plano de Contas.';
      end if;
    end if;

    select id into v_banco
      from public.contas_bancarias_empresa
     where ativa = true and banco ilike '%cora%'
     order by ordem nulls last limit 1;

    insert into public.transacoes_empresa (
      data, conta_contabil_cod, centro_custo_cod, tipo_despesa,
      descricao, obs_obra, forma_pgto, conta_bancaria_id,
      status, valor, observacao, origem_planilha
    ) values (
      public.fn_fim_do_mes(to_date(p_mes || '-01', 'YYYY-MM-DD')),
      v_conta, v_centro, 'variavel',
      public.fn_dv_descricao_auto(),
      'sem', 'sem', v_banco,
      'provisionado_dv', -public.fn_dv_limite_mensal(),
      'Linha mantida automaticamente pelo saldo do teto de Despesa Variável.',
      v_tag
    )
    returning id into v_id;
  end if;

  perform public.fn_dv_sync_linha(p_mes);

  -- A sincronização pode ter apagado a linha (mês sem saldo). Devolver o id de
  -- uma linha que não existe mais faria a tela dizer "lançado" para nada.
  select id into v_id from public.transacoes_empresa where id = v_id;
  return v_id;
end;
$$;

comment on function public.fn_dv_gerar_linha(text) is
  'Cria ou ADOTA a linha Provisionado DV do mês (inclusive a importada da planilha — 0055) e a mantém igual ao saldo do teto. Recusa-se a escolher quando houver mais de uma candidata no mês. Migration 0054/0055.';

-- ---------------------------------------------------------------------------
-- 2) Reparo: tira a linha duplicada que a 0054 criou
-- ---------------------------------------------------------------------------
-- Só apaga a linha AUTOMÁTICA, e só nos meses onde já existia outra linha
-- Provisionado DV. Os valores da Adriane não são tocados: a adoção volta a ser
-- escolha dela, mês a mês, pelo botão da tela.
do $$
declare
  r     record;
  v_qtd int := 0;
begin
  for r in
    select a.id, a.origem_planilha, a.mes_referencia
      from public.transacoes_empresa a
     where a.origem_planilha like 'dv_auto:%'
       and exists (
         select 1 from public.transacoes_empresa m
          where m.mes_referencia = a.mes_referencia
            and m.status = 'provisionado_dv'
            and m.id <> a.id
            and not public.fn_origem_de_outra_automacao(m.origem_planilha)
       )
  loop
    delete from public.transacoes_empresa where id = r.id;
    v_qtd := v_qtd + 1;
    raise notice '0055: linha automática duplicada de % removida (a linha que já existia no mês foi preservada).', r.mes_referencia;
  end loop;

  if v_qtd = 0 then
    raise notice '0055: nenhuma linha automática duplicada encontrada.';
  else
    raise notice '0055: % linha(s) duplicada(s) removida(s).', v_qtd;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Conferência: nenhum mês pode ficar com duas linhas Provisionado DV
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select mes_referencia, count(*) as qtd
      from public.transacoes_empresa
     where status = 'provisionado_dv'
       and not public.fn_origem_de_outra_automacao(origem_planilha)
     group by mes_referencia
    having count(*) > 1
  loop
    raise warning '0055: a competência % tem % lançamentos Provisionado DV — o botão "Lançar/atualizar saldo" vai pedir para deixar só um.', r.mes_referencia, r.qtd;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- ROLLBACK:
--   -- restaurar fn_dv_gerar_linha da migration 0054 e:
--   drop function if exists public.fn_origem_de_outra_automacao(text);
--   -- as linhas 0,00 removidas no reparo eram criadas pela própria 0054;
--   -- para recriá-las, basta clicar em "Lançar/atualizar saldo" no mês.
-- ----------------------------------------------------------------------------
