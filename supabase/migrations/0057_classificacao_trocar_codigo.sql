-- ============================================================================
-- 0057 — Trocar o CÓDIGO de uma classificação do Plano de Contas (14-out-2026)
-- ============================================================================
-- Pedido (Lola, 14-out): "habilitar editar o código" — no modal "Editar
-- classificação" o campo vinha travado ("crie uma nova e inative esta"). Em
-- 12-out ela criou 1.10/1.10.1 e 2.10/2.10.1 (Transferências Entre Contas).
--
-- Por que precisa do banco (e não dá só pelo front):
--   • os lançamentos (conta_contabil_cod / centro_custo_cod) já têm ON UPDATE
--     CASCADE desde a 0005 — acompanham a troca sozinhos;
--   • mas o FILHO aponta para o pai por parent_codigo, SEM cascade: trocar 1.10
--     sozinho é recusado enquanto 1.10.1 existir. Pai e filhos mudam no MESMO
--     comando (a FK confere no fim do comando, quando tudo já bate);
--   • centro de custo que muda de conta (1.10.1 → 1.9.2) leva a conta dos seus
--     lançamentos junto — segundo comando, na mesma transação;
--   • a Lixeira (0054) guarda o lançamento excluído em JSON e o restaura com
--     insert: com o código antigo lá dentro, a restauração cairia na FK.
-- Daí a RPC fn_classificacao_trocar_codigo(de, para): tudo ou nada.
--

--
-- Efeitos colaterais conferidos (testado em Postgres local):
--   • o cascade atualiza os lançamentos de dentro de um gatilho: os BEFORE de
--     transacoes_empresa rodam com pg_trigger_depth() = 2 (o vínculo do resgate
--     sai na guarda "> 1"), mas os AFTER são enfileirados para o fim do comando
--     e rodam com profundidade 1 — ou seja, o recálculo do resgate (0044) e o
--     saldo DV (0054) RODAM. Ambos dão o mesmo resultado (nenhum valor muda),
--     mas o recálculo valida o saldo do Invest e, sem saldo, barraria a troca
--     de código com "saldo insuficiente". Por isso a validação fica desligada
--     durante a troca (arambi.invest_sem_validacao, como no reparo da 0054);
--   • o espelho do Invest (0045) só age em linha 1.8 da corrente Sicredi, e o
--     1.8.1 e as entradas/saídas de centro no 1.8 ficam travados aqui.
--
-- Regras:
--   • só administradores;
--   • níveis 2 e 3 — os grupos raiz (1 Entradas, 2 Saídas) não mudam;
--   • o código novo mantém o nível e o grupo raiz, e não pode existir ainda;
--   • conta (nível 2): as subcategorias são renumeradas junto (1.10.1 → 1.11.1);
--   • centro (nível 3): pode mudar de conta se a conta nova existir — menos
--     entrar ou sair de 1.8 (Resgate) e 2.8 (DL), que têm automação pela conta;
--   • códigos que o sistema procura PELO NÚMERO (automações do banco e
--     relatórios PDF) ficam travados: fn_classificacao_codigos_sistema(),
--     espelhada em src/lib/queries/configuracoes.ts (CODIGOS_DO_SISTEMA).
--
-- Independe da 0056. Aplicar no SQL Editor.

-- ---------------------------------------------------------------------------
-- 1) Garantia: as FKs dos lançamentos acompanham a troca (ON UPDATE CASCADE)
-- ---------------------------------------------------------------------------
-- É o que a 0005 já declara. Se em algum ambiente a FK estiver sem o cascade,
-- ela é recriada igual, só com o cascade. Onde já está certa, não faz nada.
do $$
declare
  r record;
begin
  for r in
    select c.conname, a.attname
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.conrelid  = 'public.transacoes_empresa'::regclass
       and c.confrelid = 'public.classificacao_financeira'::regclass
       and c.confupdtype <> 'c'
  loop
    execute format('alter table public.transacoes_empresa drop constraint %I', r.conname);
    execute format(
      'alter table public.transacoes_empresa add constraint %I foreign key (%I) '
      'references public.classificacao_financeira(codigo) on update cascade',
      r.conname, r.attname);
    raise notice '0057: % passou a acompanhar a troca de código (on update cascade).', r.conname;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Códigos que o sistema procura pelo número
-- ---------------------------------------------------------------------------
create or replace function public.fn_classificacao_codigos_sistema()
returns text[]
language sql
immutable
as $$
  select array[
    -- automações do banco: resgate do Invest, DL, transferências da DL, saldo DV
    '1.8', '1.8.1', '1.9', '1.9.1', '2.8', '2.8.1', '2.9', '2.9.3',
    -- relatórios PDF (capas, contábil) e telas de Vendas/Provisionamento
    '1.2', '1.2.1', '1.2.2', '1.3', '1.6',
    '2.1', '2.1.6', '2.2', '2.2.2', '2.3', '2.3.2', '2.4', '2.4.5',
    '2.5', '2.6', '2.7', '2.7.2'
  ]
$$;

comment on function public.fn_classificacao_codigos_sistema() is
  'Códigos do plano de contas que automações e relatórios procuram pelo número — não podem mudar de código. Espelho: CODIGOS_DO_SISTEMA em src/lib/queries/configuracoes.ts. Migration 0057.';

-- ---------------------------------------------------------------------------
-- 3) A troca
-- ---------------------------------------------------------------------------
create or replace function public.fn_classificacao_trocar_codigo(p_de text, p_para text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_de         text := btrim(coalesce(p_de, ''));
  v_para       text := btrim(coalesce(p_para, ''));
  v_item       public.classificacao_financeira%rowtype;
  v_raiz       text;
  v_pai_novo   text;
  v_muda_conta boolean;
  v_mapa       jsonb;            -- {"1.10": "1.11", "1.10.1": "1.11.1"}
  v_travados   text;
  v_lanc       int := 0;
  v_lixeira    int := 0;
  v_validacao  text;
begin
  -- coalesce: sem login, fn_is_admin() é NULL e "if not NULL" deixaria passar.
  if not coalesce(public.fn_is_admin(), false) then
    raise exception 'Apenas administradores podem alterar o código de uma classificação.';
  end if;

  select * into v_item
    from public.classificacao_financeira
   where codigo = v_de
   for update;
  if not found then
    raise exception 'A classificação % não existe mais — recarregue a tela.', v_de;
  end if;

  if v_para = v_de then
    return jsonb_build_object('codigos', '[]'::jsonb, 'lancamentos', 0, 'lixeira', 0, 'mudou_conta', false);
  end if;

  if v_item.nivel = 1 then
    raise exception 'Os grupos raiz (1 Entradas e 2 Saídas) não mudam de código.';
  end if;

  if v_para !~ '^[0-9]+(\.[0-9]+){1,2}$' then
    raise exception 'Código novo inválido: use o formato 1.11 (conta contábil) ou 1.11.2 (centro de custo).';
  end if;

  if array_length(string_to_array(v_para, '.'), 1) <> v_item.nivel then
    raise exception 'O código novo precisa continuar no mesmo nível de % (%).', v_de,
      case v_item.nivel when 2 then 'conta contábil, ex.: 1.11' else 'centro de custo, ex.: 1.11.2' end;
  end if;

  v_raiz := split_part(v_de, '.', 1);
  if split_part(v_para, '.', 1) <> v_raiz then
    raise exception 'O código novo precisa continuar começando por % (%). Para passar de Entradas para Saídas (ou o contrário), crie uma classificação nova.',
      v_raiz, case v_raiz when '1' then 'Entradas' when '2' then 'Saídas' else 'mesmo grupo' end;
  end if;

  -- O próprio código ou alguma subcategoria dele é procurada pelo número.
  select string_agg(c, ', ' order by c) into v_travados
    from unnest(public.fn_classificacao_codigos_sistema()) c
   where c = v_de or c like v_de || '.%';
  if v_travados is not null then
    raise exception 'O código % não pode ser alterado: as automações e os relatórios do sistema procuram % pelo número.', v_de, v_travados;
  end if;

  v_pai_novo   := regexp_replace(v_para, '\.[0-9]+$', '');
  v_muda_conta := v_item.nivel = 3 and v_pai_novo is distinct from v_item.parent_codigo;

  if not exists (select 1 from public.classificacao_financeira where codigo = v_pai_novo) then
    raise exception 'A conta % não existe. Crie-a antes de usar o código %.', v_pai_novo, v_para;
  end if;

  if v_muda_conta and (v_item.parent_codigo in ('1.8', '2.8') or v_pai_novo in ('1.8', '2.8')) then
    raise exception 'Um centro de custo não entra nem sai de 1.8 (Resgate de Aplicações) ou 2.8 (Distribuição de Lucro) pela troca de código — essas contas têm automações. Crie a classificação nova lá e reclassifique os lançamentos.';
  end if;

  if exists (select 1 from public.classificacao_financeira
              where codigo = v_para or codigo like v_para || '.%') then
    raise exception 'O código % já existe.', v_para;
  end if;

  -- De-para da sub-árvore (o próprio + subcategorias, se for conta).
  select jsonb_object_agg(codigo, v_para || substr(codigo, length(v_de) + 1))
    into v_mapa
    from public.classificacao_financeira
   where codigo = v_de or codigo like v_de || '.%';

  select count(*) into v_lanc
    from public.transacoes_empresa
   where v_mapa ? conta_contabil_cod or v_mapa ? centro_custo_cod;

  -- Os gatilhos dos lançamentos recalculam os resgates dos títulos tocados —
  -- mesmo valor de antes, então a validação de saldo do Invest não se aplica.
  v_validacao := current_setting('arambi.invest_sem_validacao', true);
  perform set_config('arambi.invest_sem_validacao', 'on', true);

  -- Pai e filhos num comando só: a FK de parent_codigo confere no fim dele. Os
  -- lançamentos vêm junto pelo ON UPDATE CASCADE.
  update public.classificacao_financeira
     set codigo        = v_para || substr(codigo, length(v_de) + 1),
         parent_codigo = case when codigo = v_de then v_pai_novo else v_para end
   where codigo = v_de or codigo like v_de || '.%';

  -- Centro que mudou de conta: a conta dos lançamentos acompanha.
  if v_muda_conta then
    update public.transacoes_empresa
       set conta_contabil_cod = v_pai_novo
     where centro_custo_cod = v_para
       and conta_contabil_cod is distinct from v_pai_novo;
  end if;

  perform set_config('arambi.invest_sem_validacao', coalesce(v_validacao, 'off'), true);

  -- Lixeira: o lançamento excluído volta já com o código novo. A conta segue o
  -- centro (pai do centro novo); sem centro afetado, troca só a conta.
  if to_regclass('public.lixeira') is not null then
    with alvo as (
      select l.id,
             v_mapa ->> (l.dados ->> 'centro_custo_cod')   as centro_novo,
             v_mapa ->> (l.dados ->> 'conta_contabil_cod') as conta_nova
        from public.lixeira l
       where l.tabela = 'transacoes_empresa'
         and l.restaurado_em is null
         and (v_mapa ? (l.dados ->> 'centro_custo_cod') or v_mapa ? (l.dados ->> 'conta_contabil_cod'))
    ), feitos as (
      update public.lixeira l
         set dados = l.dados || case
               when a.centro_novo is not null then jsonb_build_object(
                 'centro_custo_cod',   a.centro_novo,
                 'conta_contabil_cod', regexp_replace(a.centro_novo, '\.[0-9]+$', ''))
               else jsonb_build_object('conta_contabil_cod', a.conta_nova)
             end
        from alvo a
       where l.id = a.id
      returning 1
    )
    select count(*) into v_lixeira from feitos;
  end if;

  return jsonb_build_object(
    'codigos',     (select jsonb_agg(jsonb_build_object('de', key, 'para', value) order by key)
                      from jsonb_each_text(v_mapa)),
    'lancamentos', v_lanc,
    'lixeira',     v_lixeira,
    'mudou_conta', v_muda_conta
  );
end;
$$;

comment on function public.fn_classificacao_trocar_codigo(text, text) is
  'Troca o código de uma classificação (nível 2 ou 3): subcategorias renumeradas junto, lançamentos e itens da Lixeira acompanham; centro que muda de conta leva a conta dos lançamentos. Só admin; códigos do sistema travados. Migration 0057.';

grant execute on function public.fn_classificacao_trocar_codigo(text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- ROLLBACK:
--   drop function if exists public.fn_classificacao_trocar_codigo(text, text);
--   drop function if exists public.fn_classificacao_codigos_sistema();
--   (as FKs com on update cascade são as da 0005 — ficam.)
-- ----------------------------------------------------------------------------
