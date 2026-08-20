-- ============================================================================
-- 0056 — Status do resgate muda nos DOIS sentidos (19-ago-2026)
-- ============================================================================
-- Pedido (docx 19-08): "Igualar a operação de mudança de status dos resgates:
-- atualmente, ao alterar o SICREDI/positivo, o sistema também altera
-- automaticamente o SICREDINVEST/negativo. Porém, quando ocorre o inverso, a
-- alteração é feita somente no SICREDINVEST. Igualar nos dois sentidos. Como
-- são operações casadas, realizadas no mesmo dia e de forma simultânea, essa
-- vinculação pode ser automatizada."
--
-- Contexto: a 0045 criou o ESPELHO — para cada linha de resgate na corrente
-- Sicredi (1.8, valor positivo), uma linha negativa na conta Invest, com
-- origem_planilha = 'auto:resgate_invest_saida:<id da linha da corrente>'. O
-- trigger de lá sincroniza corrente → espelho, mas ignora de propósito
-- qualquer mudança feita NO espelho (para não entrar em recursão). Resultado:
-- mudar o status pela linha do SICREDINVEST deixava as duas divergentes.
--
-- Esta migration fecha o circuito: mudança de STATUS no espelho é devolvida à
-- linha-mãe da corrente — e a sincronização normal da 0045 (disparada pela
-- linha-mãe) confere o resto. A guarda contra eco é a profundidade de trigger:
-- quando é a própria sincronização quem mexe no espelho, a mudança chega com
-- pg_trigger_depth() > 1 e não é devolvida.
--
-- Aplicar após a 0055.

create or replace function public.tg_te_resgate_espelho_reverso()
returns trigger
language plpgsql
as $$
declare
  v_pai uuid;
begin
  -- Eco da sincronização 0045 (corrente → espelho): veio de dentro de outro
  -- trigger, não devolve — senão os dois lados ficariam se chamando.
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  -- O id da linha-mãe vive no fim da etiqueta. Formato inesperado = não mexe.
  if new.origem_planilha !~ '^auto:resgate_invest_saida:[0-9a-fA-F-]{36}$' then
    return null;
  end if;
  v_pai := substring(new.origem_planilha from 'auto:resgate_invest_saida:(.*)$')::uuid;

  -- Devolve só o STATUS. O UPDATE dispara o trigger da 0045 na linha-mãe, que
  -- re-sincroniza o espelho (data/valor/status) — já iguais, então para ali.
  update public.transacoes_empresa
     set status = new.status
   where id = v_pai
     and status is distinct from new.status;

  return null;
end;
$$;

comment on function public.tg_te_resgate_espelho_reverso() is
  'Devolve à linha de resgate da corrente Sicredi a mudança de status feita no espelho do Invest (auto:resgate_invest_saida:) — a vinculação passa a valer nos dois sentidos. Migration 0056.';

drop trigger if exists tg_te_resgate_espelho_reverso on public.transacoes_empresa;
create trigger tg_te_resgate_espelho_reverso
  after update on public.transacoes_empresa
  for each row
  when (new.origem_planilha like 'auto:resgate_invest_saida:%'
        and new.status is distinct from old.status)
  execute function public.tg_te_resgate_espelho_reverso();

-- ---------------------------------------------------------------------------
-- Reparo: espelhos que já divergiram da linha-mãe voltam a bater
-- ---------------------------------------------------------------------------
-- A regra é a mesma da tela: quem manda é o lado que a Adri mexeu por último —
-- mas isso o banco não sabe. Aqui vale a fonte da 0045: a linha-mãe da
-- corrente. O espelho divergente é re-sincronizado a partir dela (é o mesmo
-- resultado de rodar a sync normal uma vez).
do $$
declare
  r record;
  v_qtd int := 0;
begin
  for r in
    select p.id
      from public.transacoes_empresa e
      join public.transacoes_empresa p
        on p.id = substring(e.origem_planilha from 'auto:resgate_invest_saida:(.*)$')::uuid
     where e.origem_planilha ~ '^auto:resgate_invest_saida:[0-9a-fA-F-]{36}$'
       and (e.status is distinct from p.status
         or e.valor  is distinct from -p.valor
         or e.data   is distinct from p.data)
  loop
    perform public.fn_resgate_invest_espelho_sync(r.id);
    v_qtd := v_qtd + 1;
  end loop;

  raise notice '0056: % espelho(s) divergente(s) re-sincronizado(s) a partir da linha da corrente.', v_qtd;
end $$;

-- ----------------------------------------------------------------------------
-- ROLLBACK:
--   drop trigger if exists tg_te_resgate_espelho_reverso on public.transacoes_empresa;
--   drop function if exists public.tg_te_resgate_espelho_reverso();
-- ----------------------------------------------------------------------------
