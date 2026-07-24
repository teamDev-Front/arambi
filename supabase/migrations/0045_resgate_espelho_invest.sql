-- ============================================================================
-- 0045 — Resgates com dupla movimentação: débito na SICREDINVEST (24-jul-2026)
-- ============================================================================
-- Pedido (docx 24-07): para todo lançamento de RESGATE, o débito (negativo)
-- deve ocorrer na conta SICREDINVEST e o crédito (positivo) na SICREDI
-- corrente (0913) — "haverá uma saída na conta SICREDINVEST e uma entrada na
-- conta SICREDI, de onde ocorre o pagamento do título, zerando a operação".
--
-- O modelo da 0044 já cria o CRÉDITO (linha 1.8 na corrente, status
-- resgate/a_resgatar/resgatado). Esta migration adiciona e mantém o ESPELHO:
-- uma linha 1.8 NEGATIVA na conta Invest, sempre sincronizada (data/valor/
-- status) com a linha da corrente — para lançamentos EXISTENTES e NOVOS.
--
-- Regras (idempotentes):
--   • Linha de resgate = conta bancária Sicredi corrente + conta contábil 1.8
--     + status resgate/a_resgatar/resgatado + valor > 0 (saldo_inicial fora).
--   • Espelho: mesma data, mesmo status, valor NEGATIVO, conta Invest,
--     origem_planilha = 'auto:resgate_invest_saida:<id da linha da corrente>'.
--   • BASELINE: espelho de resgate JÁ RESGATADO só é criado com data POSTERIOR
--     ao último saldo_inicial da conta Invest — o saldo que a Adri atualizou já
--     desconta os resgates antigos; espelhá-los descontaria em DOBRO. Sem
--     saldo_inicial no Invest, resgatados antigos ficam sem espelho (não se
--     fabrica história realizada). Pendentes (resgate/a_resgatar) sempre têm
--     espelho (projeção, não afeta saldo realizado); espelho criado enquanto
--     pendente é MANTIDO quando o resgate confirma.
--   • A linha da corrente sumiu/ficou fora do escopo → o espelho some junto.
--   • Bônus de consistência: com o débito realizado no Invest, a validação de
--     saldo da 0044 (fn_resgate_invest_recalc) passa a enxergar o saldo do
--     Invest DIMINUINDO a cada resgate confirmado — antes a confirmação
--     liberava orçamento sem debitar o Invest.
--
-- ⚠ Reimport/seed da planilha: desabilite TAMBÉM este trigger junto com os da
--   0044 (alter table ... disable trigger tg_te_resgate_espelho_invest;) e
--   reabilite ao final — senão o import espelha em dobro.

-- ---------------------------------------------------------------------------
-- 1) Sincroniza (cria/atualiza/remove) o espelho de UMA linha de resgate
-- ---------------------------------------------------------------------------
create or replace function public.fn_resgate_invest_espelho_sync(p_id uuid)
returns void
language plpgsql
as $$
declare
  v_row       public.transacoes_empresa%rowtype;
  v_sic       uuid := public.fn_conta_sicredi_corrente();
  v_invest    uuid := public.fn_conta_sicredi_invest();
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
    -- Criação: pendente sempre; resgatado só depois do baseline do Invest.
    if v_row.status = 'resgatado' then
      select max(data) into v_baseline
        from public.transacoes_empresa
       where conta_bancaria_id = v_invest and status = 'saldo_inicial';
      if v_baseline is null or v_row.data <= v_baseline then
        return;  -- histórico já embutido no saldo lançado do Invest
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

  -- Espelho existe → mantém em sincronia (data/valor/status).
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
  'Mantém o espelho (saída na conta Invest) de uma linha de resgate da corrente Sicredi — cria/atualiza/remove conforme o estado da linha. Migration 0045.';

-- ---------------------------------------------------------------------------
-- 2) Trigger: qualquer mudança numa linha 1.8 da corrente re-sincroniza
-- ---------------------------------------------------------------------------
create or replace function public.tg_te_resgate_espelho_invest()
returns trigger
language plpgsql
as $$
declare
  v_sic  uuid := public.fn_conta_sicredi_corrente();
  v_alvo uuid;
begin
  -- O espelho em si nunca dispara sincronização (evita recursão).
  if tg_op in ('INSERT', 'UPDATE')
     and coalesce(new.origem_planilha, '') like 'auto:resgate_invest_saida:%' then
    return null;
  end if;
  if tg_op in ('UPDATE', 'DELETE')
     and coalesce(old.origem_planilha, '') like 'auto:resgate_invest_saida:%' then
    return null;
  end if;

  if v_sic is null then return null; end if;

  -- Filtro barato: só linhas 1.8 que tocam a corrente (estado novo OU antigo)
  -- — não roda a sync em todo lançamento do sistema.
  if (tg_op in ('INSERT', 'UPDATE')
        and new.conta_bancaria_id = v_sic and new.conta_contabil_cod = '1.8')
     or (tg_op in ('UPDATE', 'DELETE')
        and old.conta_bancaria_id = v_sic and old.conta_contabil_cod = '1.8') then
    v_alvo := case when tg_op = 'DELETE' then old.id else new.id end;
    perform public.fn_resgate_invest_espelho_sync(v_alvo);
  end if;
  return null;
end;
$$;

drop trigger if exists tg_te_resgate_espelho_invest on public.transacoes_empresa;
create trigger tg_te_resgate_espelho_invest
  after insert or update or delete on public.transacoes_empresa
  for each row execute function public.tg_te_resgate_espelho_invest();

-- ---------------------------------------------------------------------------
-- 3) Backfill — espelha os resgates EXISTENTES (regras/baseline acima)
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_qtd int := 0;
begin
  if public.fn_conta_sicredi_corrente() is null
     or public.fn_conta_sicredi_invest() is null then
    raise notice '0045: contas Sicredi corrente/Invest não encontradas — backfill pulado.';
    return;
  end if;

  for r in
    select id
      from public.transacoes_empresa
     where conta_bancaria_id = public.fn_conta_sicredi_corrente()
       and conta_contabil_cod = '1.8'
       and status in ('resgate', 'a_resgatar', 'resgatado')
       and valor > 0
       and coalesce(origem_planilha, '') not like 'auto:resgate_invest_saida:%'
     order by data
  loop
    perform public.fn_resgate_invest_espelho_sync(r.id);
    v_qtd := v_qtd + 1;
  end loop;

  raise notice '0045: % linha(s) de resgate sincronizada(s) com espelho no Invest.', v_qtd;
end $$;
