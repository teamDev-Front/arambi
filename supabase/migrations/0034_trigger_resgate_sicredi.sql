-- ============================================================================
-- 0034 — Gatilho: resgate provisionado do Sicredi 0913 calculado automático
-- ============================================================================
-- Replica no banco a fórmula SOMASE que a Lola usa na planilha:
--   Resgate(0913, mês) = -1 × Σ( status 'Provisionado' + tipo 'Despesas Eventuais'
--                                 + conta 'Cooperativa Sicredi (0913)' + mesmo mês )
--
-- Assim, quando ela lança/edita/paga um provisionado eventual do 0913 pelo app,
-- a linha "Resgate" daquele mês é criada / atualizada / removida sozinha — ela
-- nunca ajusta na mão. O 'Resgate' não afeta saldo_atual (ver migration 0033),
-- só o projetado, onde anula o provisionado.
--
-- Escopo (decisão do usuário): SOMENTE a conta corrente 'Cooperativa Sicredi (0913)'.
-- Comportamento: 100% automático (cria/atualiza/zera-remove).
--
-- ⚠ Reimport da planilha: se um dia for reimportar via script, DESABILITE este
--   gatilho durante o import (alter table ... disable trigger) para não duplicar
--   as linhas de resgate — o script já calcula os resgates. No fluxo normal (app)
--   deixe sempre habilitado.

create or replace function public.fn_sync_resgate_sicredi()
returns trigger
language plpgsql
as $$
declare
  v_sic0913  uuid;
  v_forn     uuid;
  v_meses    text[] := array[]::text[];
  v_mes      text;
  v_total    numeric(15,2);
  v_existe   uuid;
begin
  -- Evita recursão: quando o próprio gatilho grava a linha de resgate, ele
  -- dispara de novo em profundidade > 1; aí não faz nada.
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  -- Conta corrente Sicredi 0913 (CGR). Se não existir, não há o que sincronizar.
  select id into v_sic0913
    from public.contas_bancarias_empresa
   where nome = 'Cooperativa Sicredi (0913)'
   limit 1;
  if v_sic0913 is null then
    return null;
  end if;

  -- Coleta os meses afetados a partir de linhas "driver"
  -- (provisionado + eventual + 0913). Em UPDATE, considera mês antigo e novo.
  if tg_op in ('INSERT','UPDATE')
     and NEW.status = 'provisionado'
     and NEW.tipo_despesa = 'eventual'
     and NEW.conta_bancaria_id = v_sic0913 then
    v_meses := array_append(v_meses, NEW.mes_referencia);
  end if;
  if tg_op in ('UPDATE','DELETE')
     and OLD.status = 'provisionado'
     and OLD.tipo_despesa = 'eventual'
     and OLD.conta_bancaria_id = v_sic0913 then
    v_meses := array_append(v_meses, OLD.mes_referencia);
  end if;

  -- Nada relevante mudou.
  if array_length(v_meses, 1) is null then
    return null;
  end if;

  -- Fornecedor padrão da linha de resgate (snapshot da planilha).
  select id into v_forn
    from public.fornecedores
   where nome = 'Banco Cooperativa Sicredi'
   limit 1;

  -- Recomputa o resgate de cada mês afetado (distinto).
  for v_mes in select distinct unnest(v_meses) loop
    select coalesce(sum(valor), 0) into v_total
      from public.transacoes_empresa
     where status = 'provisionado'
       and tipo_despesa = 'eventual'
       and conta_bancaria_id = v_sic0913
       and mes_referencia = v_mes;

    select id into v_existe
      from public.transacoes_empresa
     where status = 'resgate'
       and conta_bancaria_id = v_sic0913
       and mes_referencia = v_mes
     limit 1;

    if v_total = 0 then
      -- Não sobrou nenhum provisionado eventual no mês → remove o resgate automático.
      if v_existe is not null then
        delete from public.transacoes_empresa where id = v_existe;
      end if;
    elsif v_existe is not null then
      -- Já existe a linha do mês → atualiza o valor (sinal invertido).
      update public.transacoes_empresa
         set valor = -1 * v_total
       where id = v_existe;
    else
      -- Não existe → cria a linha de resgate do mês (último dia do mês).
      insert into public.transacoes_empresa
        (data, conta_contabil_cod, centro_custo_cod, tipo_despesa, obs_obra,
         forma_pgto, conta_bancaria_id, status, valor,
         fornecedor_id, fornecedor_nome, descricao, origem_planilha)
      values
        ((to_date(v_mes, 'YYYY-MM') + interval '1 month - 1 day')::date,
         '1.8', '1.8.1', 'sem', 'sem', 'sem',
         v_sic0913, 'resgate', -1 * v_total,
         v_forn, 'Banco Cooperativa Sicredi',
         'Resgate da Conta Investimento Invest - Reserva p/ Construção da Sede',
         'auto:resgate_sicredi');
    end if;
  end loop;

  return null;
end;
$$;

comment on function public.fn_sync_resgate_sicredi is
  'Mantém automaticamente a linha "Resgate" (status=resgate) da conta Sicredi 0913 '
  '= -1 × soma dos Provisionados de Despesas Eventuais do mesmo mês/conta. '
  'Cria/atualiza/remove. Anti-recursão via pg_trigger_depth(). Migration 0034.';

drop trigger if exists tg_sync_resgate_sicredi on public.transacoes_empresa;
create trigger tg_sync_resgate_sicredi
  after insert or update or delete on public.transacoes_empresa
  for each row execute function public.fn_sync_resgate_sicredi();
