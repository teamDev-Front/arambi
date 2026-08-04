-- ============================================================================
-- 0049 — Despesa paga pelo saldo da própria conta (não exige resgate)
-- ============================================================================
-- Resposta da Adri (WhatsApp, 04-ago-2026), sobre os R$ 156,50 que apareciam
-- todo mês na conferência do Sicredi:
--
--   "sim, eles não resgatam, pq eu deixei eles disponíveis na conta em janeiro.
--    Então por isso a conta sempre fica com um saldo, pequeno, mas tem, para
--    poder cobrir as txs de manutenção da conta."
--
-- Ou seja: a corrente Sicredi mantém de propósito um saldo próprio para as
-- tarifas, e esses lançamentos NÃO devem puxar resgate do Invest. Sem registrar
-- isso, a conferência acusaria −R$ 156,50 todo mês para sempre — ruído justo na
-- tela que existe para dar segurança rápida.
--
-- O que entra:
--   1. transacoes_empresa.dispensa_resgate — marca o lançamento como pago pelo
--      saldo da conta.
--   2. O trigger de vínculo passa a respeitar a marca (não cria nem vincula).
--   3. Backfill das duas recorrências que ela citou (Integralização de Capital
--      Subscrito e Cesta Relacionamento na conta Sicredi).
--
-- Aplicar após a 0048.

-- ---------------------------------------------------------------------------
-- 1) Coluna
-- ---------------------------------------------------------------------------
alter table public.transacoes_empresa
  add column if not exists dispensa_resgate boolean not null default false;

comment on column public.transacoes_empresa.dispensa_resgate is
  'true = despesa paga pelo saldo da própria conta corrente, sem resgate do Invest (ex.: tarifas de manutenção). Não gera vínculo automático e sai da conferência "o Sicredi zera". Migration 0049.';

create index if not exists idx_te_dispensa_resgate
  on public.transacoes_empresa(dispensa_resgate)
  where dispensa_resgate = true;

-- ---------------------------------------------------------------------------
-- 2) Trigger de vínculo respeita a dispensa
-- ---------------------------------------------------------------------------
-- Idêntica à 0048, com dois acréscimos:
--   • `dispensa_resgate` entra no teste de "é título que puxa resgate";
--   • marcar a dispensa num lançamento JÁ vinculado solta o vínculo (o AFTER
--     recalcula o resgate antigo, que encolhe ou some).
create or replace function public.tg_te_resgate_invest_link()
returns trigger
language plpgsql
as $$
declare
  v_sic         uuid;
  v_eh_driver   boolean;
  v_era_driver  boolean;
  v_status_resgate public.status_aramburu;
  v_tag_atual   text;
  v_alvo        uuid;
begin
  if pg_trigger_depth() > 1 then return new; end if;

  v_sic := public.fn_conta_sicredi_corrente();
  if v_sic is null then return new; end if;

  if new.origem_planilha like 'auto:resgate_invest:%'
     or new.origem_planilha like 'auto:resgate_invest_fatura:%' then
    return new;
  end if;

  v_eh_driver := new.conta_bancaria_id = v_sic
             and new.valor < 0
             and new.status <> 'saldo_inicial'
             and not coalesce(new.dispensa_resgate, false);

  if tg_op = 'INSERT' then
    if v_eh_driver and public.fn_resgates_auto_sicredi_ativos() then
      new.resgate_auto_id := public.fn_resgate_alvo_do_titulo(new.forma_pgto, new.data);
    end if;
    return new;
  end if;

  -- UPDATE
  v_era_driver := old.conta_bancaria_id = v_sic
              and old.valor < 0
              and old.status <> 'saldo_inicial'
              and not coalesce(old.dispensa_resgate, false);

  if not v_eh_driver then
    -- Saiu do escopo (mudou de banco, virou entrada, ou foi marcado como pago
    -- pelo saldo da conta) → desvincula.
    new.resgate_auto_id := null;
    return new;
  end if;

  if new.resgate_auto_id is null then
    if not v_era_driver and public.fn_resgates_auto_sicredi_ativos() then
      new.resgate_auto_id := public.fn_resgate_alvo_do_titulo(new.forma_pgto, new.data);
    end if;
    return new;
  end if;

  if new.data is distinct from old.data
     or new.forma_pgto is distinct from old.forma_pgto then
    select status, origem_planilha into v_status_resgate, v_tag_atual
      from public.transacoes_empresa where id = new.resgate_auto_id;

    if v_status_resgate is null then
      new.resgate_auto_id := public.fn_resgate_alvo_do_titulo(new.forma_pgto, new.data);
    elsif v_status_resgate <> 'resgatado' then
      v_alvo := public.fn_resgate_alvo_do_titulo(new.forma_pgto, new.data);
      if v_alvo is distinct from new.resgate_auto_id then
        new.resgate_auto_id := v_alvo;
      end if;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.tg_te_resgate_invest_link() is
  'Vincula títulos do Sicredi ao resgate automático do Invest: consolidado por FATURA no cartão (0048), diário nos demais casos (0044/0047). Ignora lançamentos marcados como pagos pelo saldo da conta (0049).';

-- ---------------------------------------------------------------------------
-- 3) Backfill — as duas recorrências que a Adri identificou
-- ---------------------------------------------------------------------------
-- Só na conta Sicredi corrente e só saídas. Idempotente.
do $$
declare
  v_sic uuid := public.fn_conta_sicredi_corrente();
  v_qtd int;
begin
  if v_sic is null then
    raise notice '0049: conta Sicredi corrente não encontrada — backfill pulado.';
    return;
  end if;

  update public.transacoes_empresa
     set dispensa_resgate = true
   where conta_bancaria_id = v_sic
     and valor < 0
     and dispensa_resgate = false
     and (descricao ilike 'Integraliza%o de Capital Subscrito'
       or descricao ilike 'Cesta Relacionamento');
  get diagnostics v_qtd = row_count;

  raise notice '0049: % lançamento(s) marcados como pagos pelo saldo da conta.', v_qtd;
end $$;

-- ----------------------------------------------------------------------------
-- ROLLBACK:
--   -- restaurar tg_te_resgate_invest_link da 0048 (sem o teste de dispensa)
--   drop index if exists public.idx_te_dispensa_resgate;
--   alter table public.transacoes_empresa drop column if exists dispensa_resgate;
-- ----------------------------------------------------------------------------
