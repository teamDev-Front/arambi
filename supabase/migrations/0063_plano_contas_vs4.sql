-- ============================================================================
-- 0063 — Plano de Contas alinhado à planilha VS4: 1.9/2.9 = Transferências
--        Entre Contas; 1.10/2.10 = Outros Recebimentos / Outras Saídas
-- ============================================================================
-- Pedido (reunião de 20-out-2026 + aba "Classificação Financeira" da
-- "Provisionamento_FLUXO DE CAIXA 2026_VS 4.xlsx"): a Lola trabalha pela VS4,
-- e a VS4 inverteu os blocos do fim do plano. Com a numeração diferente, ela
-- desconfia do sistema.
--
--            HOJE (sistema, 21-out)                 DEPOIS (= VS4)
--   1.9      Outros Recebimentos                    Transferências Entre Contas
--   1.9.1    Diversos (35 transf. + 2 outros)       Transferências Recebidas (35)
--   1.10     Transferências Entre Contas (vazia)    Outros Recebimentos
--   1.10.1   Transferências Recebidas (vazia)       Diversos (2)
--   2.9      Outras Saídas                          Transferências Entre Contas
--   2.9.1    Devoluções de Receitas (vazia)         Transferências Enviadas (31)
--   2.9.2    Perdas e Extravio (vazia)              — (excluída; vira 2.10.2)
--   2.9.3    Outras Despesas Não Classificadas      — (excluída; vira 2.10.3)
--            (31 transf. + 4 linhas de saldo DV)
--   2.10     Transferências Entre Contas (vazia)    Outras Saídas
--   2.10.1   Transferências Enviadas (vazia)        Devoluções de Receitas
--   2.10.2   —                                      Perdas e Extravio
--   2.10.3   —                                      Outras Despesas Não Classificadas (4 DV)
--
-- COMO — sem mexer em id, valor, status nem data de nenhum lançamento:
--   • os CÓDIGOS ficam e trocam os NOMES. As 35 transferências recebidas já
--     moram em 1.9.1 e só passam a ser chamadas pelo nome certo;
--   • só 37 lançamentos mudam de conta/centro:
--       2 recebimentos que não são transferência   1.9.1 → 1.10.1
--         ("Aplicação Financeira - Extra Emergencial…" 84.550,80 e
--          "Capital Social - Encerramento de conta…" 6.009,49)
--       31 transferências enviadas                 2.9.3 → 2.9.1
--       4 linhas "Despesa Variável — Saldo do mês"  2.9.3 → 2.10.3
--     A regra é POR LANÇAMENTO, então vale também para o que entrar até a
--     migration subir (repasse novo da DL, linha de DV de mês novo,
--     transferência digitada à mão):
--       transferência = descrição "Transf… entre contas" (o mesmo critério da
--         Memória de Cálculo, 0025/0026) ou lançamento que já esteja num
--         centro chamado "Transferências…" (1.10.1/2.10.1, criados pela Lola
--         em 12-out); Provisionado DV nunca é transferência (0061);
--       o resto vai para o centro de MESMO NOME no bloco novo (Diversos →
--         1.10.1, Devoluções → 2.10.1, Perdas → 2.10.2, Outras Despesas Não
--         Classificadas → 2.10.3).
--   • 2.9.2 e 2.9.3 ficam vazias e são EXCLUÍDAS, não inativadas: a VS4 não
--     tem esses códigos; "2.9.3 Outras Despesas…" inativa embaixo de "2.9
--     Transferências" só confundiria; e um gravador esquecido que ainda usasse
--     2.9.3 passa a falhar na hora (FK) em vez de cair escondido num centro
--     inativo. Nada mais aponta para elas: os lançamentos saíram, a Lixeira é
--     corrigida e nenhuma outra tabela tem FK para o plano de contas.
--   • Lixeira (0054): o lançamento excluído volta com o código gravado no JSON
--     — recebe a mesma regra, senão a restauração cairia na FK (como na 0057).
--   • ordem: renumerada na ordem dos códigos, que é a ordem da VS4 (não havia
--     número livre entre 1.9.1 = 23 e 2 = 24). Nenhuma tela ordena por ela —
--     Financeiro e Configurações ordenam pelo código.
--
-- GATILHOS: mudar conta/centro dispara os gatilhos de transacoes_empresa, e o
-- ON UPDATE CASCADE não os evita (os AFTER rodam com pg_trigger_depth() = 1 —
-- ver 0057). Para estas linhas não há o que recalcular: nenhuma automação lê
-- esses códigos (saldo DV soma por tipo de despesa + status; resgate do Invest
-- olha banco/valor/status/data; espelho do Invest só a conta 1.8; DL só o
-- 2.8.1; venda só o status). Mas eles rodariam assim mesmo: o sync de DV
-- reescreveria valor/observação das 4 linhas (ou apagaria a do mês sem saldo)
-- e o recálculo do resgate revalidaria o saldo do Invest. Por isso os gatilhos
-- de usuário LIGADOS de transacoes_empresa são desligados pelo nome só durante
-- o UPDATE e religados no mesmo bloco, cada um no modo em que estava. As FKs
-- continuam valendo — são gatilhos internos (por isso NÃO
-- session_replication_role = replica, que desligaria as FKs junto). O
-- updated_at é preenchido à mão no lugar do tg_te_updated_at. O ALTER TABLE
-- segura as ESCRITAS em transacoes_empresa até o fim da transação
-- (milissegundos); leitura segue livre.
--
-- AUTOMAÇÕES que gravam pelo número (recriadas com o corpo vigente, trocando
-- só o código):
--   • fn_consolidar_repasse_dl (corpo da 0044): a perna de saída do par Cora →
--     Inter passa de 2.9/2.9.3 para 2.9/2.9.1; a entrada segue 1.9/1.9.1.
--     fn_concluir/fn_desfazer_repasse_dl filtram pela CONTA (2.9/1.9) e pela
--     etiqueta dl_repasse: — continuam certas, não mudam.
--   • fn_dv_gerar_linha (corpo da 0055): a linha de saldo DV nasce em
--     2.10/2.10.3. A linha do mês é achada pela etiqueta dv_auto:<mês> e a
--     adoção pelo status Provisionado DV — nenhum dos dois olha o código, então
--     as 4 linhas movidas continuam sendo as linhas dos seus meses (sem
--     duplicar). fn_dv_sync_linha (0055) não usa código — fica como está.
--   • fn_classificacao_codigos_sistema (0057): sai 2.9.3; entram 2.9.1 e
--     2.10.3 (automações) e 1.10 e 2.10 (lidos pelo número nos relatórios
--     PDF). Espelho no front: CODIGOS_DO_SISTEMA (src/lib/queries/configuracoes.ts).
-- As views do Fluxo de Caixa (0060/0061) tratam como transferência o 2.9 e
-- qualquer conta de saída com "transfer" no nome, nunca o Provisionado DV:
-- valem antes e depois, e os totais não mudam (só a divisão interna).
-- Relatórios PDF (src/lib/pdfmonkey/builders.ts) leem 1.9/1.10/2.9/2.10 pelo
-- número — ajustados no código, à parte.
--
-- Idempotente: só realinha enquanto existir o 2.9.3 (marca da estrutura
-- antiga: código travado e com lançamentos, que só esta migration remove).
-- Reaplicar só recria as funções. Aplicar no SQL Editor de uma vez — roda numa
-- transação só: se algo falhar, nada fica pela metade.
--
-- Depende da 0054 (lixeira), 0055 (fn_dv_gerar_linha) e 0057 (lista de
-- códigos travados). Testada em Postgres local sobre a cópia de produção de
-- 21-out-2026.

do $$
begin
  if to_regclass('public.lixeira') is null
     or to_regprocedure('public.fn_origem_de_outra_automacao(text)') is null
     or to_regprocedure('public.fn_classificacao_codigos_sistema()') is null then
    raise exception 'Aplique as migrations 0054, 0055 e 0057 antes da 0063.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Realinhamento do plano e dos lançamentos (só na estrutura antiga)
-- ---------------------------------------------------------------------------
do $$
declare
  v_inesperado text;
  v_t_1101     boolean;   -- o centro tem nome de "Transferências…" HOJE?
  v_t_2101     boolean;
  v_t_291      boolean;
  v_t_292      boolean;
  v_gatilhos   text[];
  v_modos      text[];
  v_i          int;
  v_te         int;
  v_lix        int;
  r            record;
begin
  if not exists (select 1 from public.classificacao_financeira where codigo = '2.9.3') then
    raise notice '0063: plano de contas já está no formato da VS4 (não há 2.9.3) — nenhum lançamento movido.';
    return;
  end if;

  -- Ninguém grava no plano, nos lançamentos nem na Lixeira enquanto isto roda.
  lock table public.classificacao_financeira, public.transacoes_empresa, public.lixeira
    in share row exclusive mode;

  -- Estrutura que a VS4 não prevê: não adivinhar — parar e avisar.
  select string_agg(codigo || ' ' || nome, '; ' order by codigo) into v_inesperado
    from public.classificacao_financeira
   where parent_codigo in ('1.9', '1.10', '2.9', '2.10')
     and codigo not in ('1.9.1', '1.10.1', '2.9.1', '2.9.2', '2.9.3', '2.10.1', '2.10.2', '2.10.3');
  if v_inesperado is not null then
    raise exception '0063: o plano tem sub-contas que a VS4 não tem em 1.9/1.10/2.9/2.10 (%). Reclassifique os lançamentos delas e exclua-as antes de aplicar.', v_inesperado;
  end if;

  select string_agg(distinct conta_contabil_cod || '/' || centro_custo_cod, ', ') into v_inesperado
    from public.transacoes_empresa
   where (conta_contabil_cod in ('1.9', '1.10', '2.9', '2.10')
          or centro_custo_cod in ('1.9.1', '1.10.1', '2.9.1', '2.9.2', '2.9.3', '2.10.1', '2.10.2', '2.10.3'))
     and conta_contabil_cod is distinct from regexp_replace(centro_custo_cod, '\.[0-9]+$', '');
  if v_inesperado is not null then
    raise exception '0063: há lançamentos com conta e centro de custo desencontrados (%). Corrija-os antes de aplicar.', v_inesperado;
  end if;

  -- Centros "puros" seguem o nome que têm HOJE (se algum já foi renomeado à
  -- mão, o nome atual manda): 1.10.1/2.10.1 nasceram "Transferências…".
  select coalesce(bool_or(codigo = '1.10.1' and nome ilike '%transfer%'), false),
         coalesce(bool_or(codigo = '2.10.1' and nome ilike '%transfer%'), false),
         coalesce(bool_or(codigo = '2.9.1'  and nome ilike '%transfer%'), false),
         coalesce(bool_or(codigo = '2.9.2'  and nome ilike '%transfer%'), false)
    into v_t_1101, v_t_2101, v_t_291, v_t_292
    from public.classificacao_financeira;

  -- Plano-alvo (= VS4).
  create temp table _vs4_plano on commit drop as
  select v.codigo, v.nome, v.natureza::public.natureza_conta as natureza, v.pai, v.nivel::smallint as nivel
    from (values
      ('1.9',    'Transferências Entre Contas',       'entrada', '1',    2),
      ('1.9.1',  'Transferências Recebidas',          'entrada', '1.9',  3),
      ('1.10',   'Outros Recebimentos',               'entrada', '1',    2),
      ('1.10.1', 'Diversos',                          'entrada', '1.10', 3),
      ('2.9',    'Transferências Entre Contas',       'saida',   '2',    2),
      ('2.9.1',  'Transferências Enviadas',           'saida',   '2.9',  3),
      ('2.10',   'Outras Saídas',                     'saida',   '2',    2),
      ('2.10.1', 'Devoluções de Receitas',            'saida',   '2.10', 3),
      ('2.10.2', 'Perdas e Extravio',                 'saida',   '2.10', 3),
      ('2.10.3', 'Outras Despesas Não Classificadas', 'saida',   '2.10', 3)
    ) as v(codigo, nome, natureza, pai, nivel);

  -- Códigos que faltarem (2.10.2/2.10.3 hoje) — contas antes dos centros.
  insert into public.classificacao_financeira (codigo, nome, natureza, parent_codigo, nivel, ativo)
  select codigo, nome, natureza, pai, nivel, true from _vs4_plano where nivel = 2
  on conflict (codigo) do nothing;
  insert into public.classificacao_financeira (codigo, nome, natureza, parent_codigo, nivel, ativo)
  select codigo, nome, natureza, pai, nivel, true from _vs4_plano where nivel = 3
  on conflict (codigo) do nothing;

  -- Destino de cada lançamento — e de cada lançamento da Lixeira, pela mesma
  -- regra. Quem já está no lugar certo fica (centro_novo = centro).
  create temp table _vs4_destino on commit drop as
  with fonte as (
    select 'transacoes_empresa'::text as alvo, te.id, te.centro_custo_cod as centro,
           te.descricao, te.status::text as status
      from public.transacoes_empresa te
     where te.centro_custo_cod in ('1.9.1', '1.10.1', '2.9.1', '2.9.2', '2.9.3', '2.10.1')
    union all
    select 'lixeira', l.id, l.dados ->> 'centro_custo_cod',
           l.dados ->> 'descricao', l.dados ->> 'status'
      from public.lixeira l
     where l.tabela = 'transacoes_empresa'
       and l.restaurado_em is null
       and l.dados ->> 'centro_custo_cod' in ('1.9.1', '1.10.1', '2.9.1', '2.9.2', '2.9.3', '2.10.1')
  ),
  classificado as (
    select f.*,
           f.status is distinct from 'provisionado_dv'
             and coalesce(f.descricao, '') ilike '%transf%entre%contas%' as desc_transferencia
      from fonte f
  )
  select alvo, id, centro, descricao, status,
         case centro
           -- misturado: transferências ficam; "Diversos" vai para 1.10.1
           when '1.9.1'  then case when desc_transferencia then '1.9.1' else '1.10.1' end
           when '1.10.1' then case when v_t_1101 or desc_transferencia then '1.9.1' else '1.10.1' end
           when '2.9.1'  then case when v_t_291  or desc_transferencia then '2.9.1' else '2.10.1' end
           when '2.9.2'  then case when v_t_292  or desc_transferencia then '2.9.1' else '2.10.2' end
           -- misturado: transferências → 2.9.1; saldo DV e o resto → 2.10.3
           when '2.9.3'  then case when desc_transferencia then '2.9.1' else '2.10.3' end
           when '2.10.1' then case when v_t_2101 or desc_transferencia then '2.9.1' else '2.10.1' end
         end as centro_novo
    from classificado;

  -- Lançamentos: desliga os gatilhos de usuário LIGADOS (guardando o modo),
  -- move, religa. As FKs (gatilhos internos) seguem conferindo.
  select coalesce(array_agg(tgname::text order by tgname), '{}'),
         coalesce(array_agg(tgenabled::text order by tgname), '{}')
    into v_gatilhos, v_modos
    from pg_trigger
   where tgrelid = 'public.transacoes_empresa'::regclass
     and not tgisinternal
     and tgenabled <> 'D';

  for v_i in 1 .. coalesce(array_length(v_gatilhos, 1), 0) loop
    execute format('alter table public.transacoes_empresa disable trigger %I', v_gatilhos[v_i]);
  end loop;

  update public.transacoes_empresa te
     set centro_custo_cod   = d.centro_novo,
         conta_contabil_cod = regexp_replace(d.centro_novo, '\.[0-9]+$', ''),
         updated_at         = now()
    from _vs4_destino d
   where d.alvo = 'transacoes_empresa'
     and te.id = d.id
     and te.centro_custo_cod is distinct from d.centro_novo;
  get diagnostics v_te = row_count;

  for v_i in 1 .. coalesce(array_length(v_gatilhos, 1), 0) loop
    execute format('alter table public.transacoes_empresa enable %s trigger %I',
                   case v_modos[v_i] when 'A' then 'always' when 'R' then 'replica' else '' end,
                   v_gatilhos[v_i]);
  end loop;

  -- Lixeira: o item volta já com o código novo (a conta segue o centro).
  update public.lixeira l
     set dados = l.dados || jsonb_build_object(
           'centro_custo_cod',   d.centro_novo,
           'conta_contabil_cod', regexp_replace(d.centro_novo, '\.[0-9]+$', ''))
    from _vs4_destino d
   where d.alvo = 'lixeira'
     and l.id = d.id
     and (l.dados ->> 'centro_custo_cod') is distinct from d.centro_novo;
  get diagnostics v_lix = row_count;

  -- Nomes, pais e natureza da VS4 (ativos: as automações usam 1.9.1/2.9.1/2.10.3).
  update public.classificacao_financeira c
     set nome          = p.nome,
         natureza      = p.natureza,
         parent_codigo = p.pai,
         nivel         = p.nivel,
         ativo         = true
    from _vs4_plano p
   where c.codigo = p.codigo
     and (c.nome, c.natureza, c.parent_codigo, c.nivel, c.ativo)
         is distinct from (p.nome, p.natureza, p.pai, p.nivel, true);

  -- 2.9.2 e 2.9.3 ficaram vazias. Conferência explícita antes de excluir (a FK
  -- também barraria lançamento, mas não o JSON da Lixeira).
  if exists (select 1 from public.transacoes_empresa
              where centro_custo_cod in ('2.9.2', '2.9.3') or conta_contabil_cod in ('2.9.2', '2.9.3'))
     or exists (select 1 from public.lixeira
                 where tabela = 'transacoes_empresa' and restaurado_em is null
                   and (dados ->> 'centro_custo_cod' in ('2.9.2', '2.9.3')
                        or dados ->> 'conta_contabil_cod' in ('2.9.2', '2.9.3'))) then
    raise exception '0063: 2.9.2/2.9.3 ainda são usados — nada foi alterado.';
  end if;
  delete from public.classificacao_financeira where codigo in ('2.9.2', '2.9.3');

  -- ordem = posição na ordem dos códigos (1 < 1.1 < 1.1.1 < … < 1.9.1 < 1.10 <
  -- … < 2.10.3), que é a ordem da aba "Classificação Financeira" da VS4.
  with ordenado as (
    select codigo,
           row_number() over (order by
             (case when split_part(codigo, '.', 1) ~ '^[0-9]+$' then split_part(codigo, '.', 1)::int end) nulls last,
             (case when split_part(codigo, '.', 2) ~ '^[0-9]+$' then split_part(codigo, '.', 2)::int end) nulls first,
             (case when split_part(codigo, '.', 3) ~ '^[0-9]+$' then split_part(codigo, '.', 3)::int end) nulls first,
             codigo) as rn
      from public.classificacao_financeira
  )
  update public.classificacao_financeira c
     set ordem = o.rn
    from ordenado o
   where c.codigo = o.codigo
     and c.ordem is distinct from o.rn;

  for r in
    select alvo, centro, centro_novo, count(*) as qtd
      from _vs4_destino
     where centro_novo is distinct from centro
     group by alvo, centro, centro_novo
     order by alvo, centro, centro_novo
  loop
    raise notice '0063: % · % → %: % item(ns).', r.alvo, r.centro, r.centro_novo, r.qtd;
  end loop;
  raise notice '0063: % lançamento(s) e % item(ns) da Lixeira reclassificados; 2.9.2/2.9.3 excluídas; gatilhos religados: %.',
    v_te, v_lix, array_to_string(v_gatilhos, ', ');
end $$;

-- ---------------------------------------------------------------------------
-- 2) DL — par de transferência do repasse: saída em 2.9.1 (era 2.9.3)
-- ---------------------------------------------------------------------------
-- Corpo da 0044 (definição vigente); muda só o centro da perna de saída e a
-- conferência do plano de contas.
create or replace function public.fn_consolidar_repasse_dl(
  p_mes text,                               -- "YYYY-MM"
  p_data date default current_date,         -- data programada do repasse
  p_incluir_transferencia boolean default true
)
returns uuid
language plpgsql
as $$
declare
  v_soma   numeric(15,2);
  v_qtd    int;
  v_grupo  text := 'dl_repasse:' || gen_random_uuid();
  v_cora   uuid;
  v_inter  uuid;
  v_global uuid;
  v_mes_humano text;
begin
  if p_mes is null or p_mes !~ '^\d{4}-\d{2}$' then
    raise exception 'Mês inválido (esperado YYYY-MM).';
  end if;

  select coalesce(sum(valor), 0), count(*) into v_soma, v_qtd
  from public.transacoes_socio
  where mes_referencia = p_mes and status = 'a_pagar' and repasse_id is null;

  if v_qtd = 0 then
    raise exception 'Nenhum lançamento detalhado com status "A repassar" (e sem repasse) em %.', p_mes;
  end if;
  if v_soma <= 0 then
    raise exception 'A soma do detalhado "A repassar" de % é R$ % — verifique os valores antes de consolidar.', p_mes, v_soma;
  end if;

  perform 1 from public.classificacao_financeira where codigo in ('2.8','2.8.1','2.9','2.9.1','1.9','1.9.1')
  having count(*) = 6;
  if not found then
    raise exception 'Plano de contas incompleto: são necessárias as classificações 2.8/2.8.1, 2.9/2.9.1 e 1.9/1.9.1 (Configurações → Plano de Contas).';
  end if;

  select id into v_inter from public.contas_bancarias_empresa
   where ativa = true and banco ilike '%inter%' order by ordem nulls last limit 1;
  if v_inter is null then
    raise exception 'Conta do Banco Inter não encontrada em Bancos (necessária para o repasse).';
  end if;

  if p_incluir_transferencia then
    select id into v_cora from public.contas_bancarias_empresa
     where ativa = true and banco ilike '%cora%' order by ordem nulls last limit 1;
    if v_cora is null then
      raise exception 'Conta do Banco Cora não encontrada em Bancos (necessária para a transferência Cora → Inter).';
    end if;
  end if;

  v_mes_humano := substring(p_mes from 6 for 2) || '/' || substring(p_mes from 1 for 4);

  -- (c) Global 2.8 — nasce "A repassar" (ajuste 23-jul; antes era a_pagar).
  insert into public.transacoes_empresa (
    data, conta_contabil_cod, centro_custo_cod, tipo_despesa,
    descricao, obs_obra, forma_pgto, conta_bancaria_id,
    status, valor, observacao, origem_planilha
  ) values (
    p_data, '2.8', '2.8.1', 'sem',
    'Distribuição de Lucro — repasse ' || v_mes_humano,
    'sem', 'transferencia', v_inter,
    'a_repassar', -v_soma,
    'Consolidado automaticamente de ' || v_qtd || ' lançamento(s) detalhado(s) por sócio (tela Distribuição de Lucro).',
    v_grupo
  ) returning id into v_global;

  -- (a)+(b) Par de transferência Cora → Inter: saída em 2.9.1 "Transferências
  -- Enviadas", entrada em 1.9.1 "Transferências Recebidas" (VS4 — 0063).
  if p_incluir_transferencia then
    insert into public.transacoes_empresa (
      data, conta_contabil_cod, centro_custo_cod, tipo_despesa,
      descricao, obs_obra, forma_pgto, conta_bancaria_id,
      status, valor, observacao, origem_planilha
    ) values (
      p_data, '2.9', '2.9.1', 'sem',
      'Transf. Entre Contas_Distribuição de Lucro ' || v_mes_humano,
      'sem', 'transferencia', v_cora,
      'a_pagar', -v_soma, null, v_grupo
    ), (
      p_data, '1.9', '1.9.1', 'sem',
      'Transf. Entre Contas_Distribuição de Lucro ' || v_mes_humano,
      'sem', 'transferencia', v_inter,
      'a_receber', v_soma, null, v_grupo
    );
  end if;

  update public.transacoes_socio
     set repasse_id = v_global
   where mes_referencia = p_mes and status = 'a_pagar' and repasse_id is null;

  return v_global;
end;
$$;

comment on function public.fn_consolidar_repasse_dl(text, date, boolean) is
  'Consolida o detalhado "A repassar" do mês em lançamentos globais da empresa (par Cora→Inter em 2.9.1/1.9.1 + saída 2.8 do Inter, status a_repassar) e vincula via repasse_id. Atômico. Migrations 0044/0063.';

-- ---------------------------------------------------------------------------
-- 3) Linha automática de saldo DV: nasce em 2.10.3 (era 2.9.3)
-- ---------------------------------------------------------------------------
-- Corpo da 0055 (definição vigente); muda só a conta/centro de nascimento.
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
  v_conta  text := '2.10';
  v_centro text := '2.10.3';
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
      -- Plano de contas sem 2.10.3 → cai em qualquer centro de saída existente.
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
  'Cria (em 2.10/2.10.3) ou ADOTA a linha Provisionado DV do mês (inclusive a importada da planilha — 0055) e a mantém igual ao saldo do teto. Recusa-se a escolher quando houver mais de uma candidata no mês. Migrations 0054/0055/0063.';

-- ---------------------------------------------------------------------------
-- 4) Códigos que o sistema procura pelo número (travados no Plano de Contas)
-- ---------------------------------------------------------------------------
-- Espelho: CODIGOS_DO_SISTEMA em src/lib/queries/configuracoes.ts — as duas
-- listas precisam ficar iguais.
create or replace function public.fn_classificacao_codigos_sistema()
returns text[]
language sql
immutable
as $$
  select array[
    -- automações do banco: resgate do Invest (1.8), DL (2.8), par de
    -- transferência da DL (1.9.1 ↔ 2.9.1), saldo DV (2.10.3)
    '1.8', '1.8.1', '1.9', '1.9.1', '2.8', '2.8.1', '2.9', '2.9.1', '2.10.3',
    -- relatórios PDF (capas, contábil, sócios) e telas de Vendas/Provisionamento
    '1.2', '1.2.1', '1.2.2', '1.3', '1.6', '1.10',
    '2.1', '2.1.6', '2.2', '2.2.2', '2.3', '2.3.2', '2.4', '2.4.5',
    '2.5', '2.6', '2.7', '2.7.2', '2.10'
  ]
$$;

comment on function public.fn_classificacao_codigos_sistema() is
  'Códigos do plano de contas que automações e relatórios procuram pelo número — não podem mudar de código. Espelho: CODIGOS_DO_SISTEMA em src/lib/queries/configuracoes.ts. Migrations 0057/0063.';

-- ---------------------------------------------------------------------------
-- 5) Conferência (o SQL Editor mostra este resultado)
-- ---------------------------------------------------------------------------
select cf.codigo,
       cf.nome,
       cf.ativo,
       (select count(*) from public.transacoes_empresa te
         where (cf.nivel = 2 and te.conta_contabil_cod = cf.codigo)
            or (cf.nivel = 3 and te.centro_custo_cod = cf.codigo)) as lancamentos
  from public.classificacao_financeira cf
 where cf.codigo ~ '^[12]\.(9|10)(\.[0-9]+)?$'
 order by cf.ordem nulls last, cf.codigo;

-- ----------------------------------------------------------------------------
-- ROLLBACK (manual — só para voltar ao plano antigo):
--   1) funções: recriar fn_consolidar_repasse_dl da 0044, fn_dv_gerar_linha da
--      0055 e fn_classificacao_codigos_sistema da 0057 (e CODIGOS_DO_SISTEMA
--      no front);
--   2) dados, num bloco só e com os gatilhos de transacoes_empresa desligados
--      como no passo 1 (senão o sync de DV/resgate roda à toa):
--        insert into public.classificacao_financeira (codigo, nome, natureza, parent_codigo, nivel, ativo) values
--          ('2.9.2', 'Perdas e Extravio', 'saida', '2.9', 3, true),
--          ('2.9.3', 'Outras Despesas Não Classificadas', 'saida', '2.9', 3, true);
--        update public.transacoes_empresa set centro_custo_cod = '2.9.3'                            where centro_custo_cod = '2.9.1';
--        update public.transacoes_empresa set conta_contabil_cod = '2.9', centro_custo_cod = '2.9.1' where centro_custo_cod = '2.10.1';
--        update public.transacoes_empresa set conta_contabil_cod = '2.9', centro_custo_cod = '2.9.2' where centro_custo_cod = '2.10.2';
--        update public.transacoes_empresa set conta_contabil_cod = '2.9', centro_custo_cod = '2.9.3' where centro_custo_cod = '2.10.3';
--        update public.transacoes_empresa set conta_contabil_cod = '1.9', centro_custo_cod = '1.9.1' where centro_custo_cod = '1.10.1';
--        -- nomes antigos:
--        --   1.9 Outros Recebimentos · 1.9.1 Diversos · 1.10 Transferências Entre Contas ·
--        --   1.10.1 Transferências Recebidas · 2.9 Outras Saídas · 2.9.1 Devoluções de Receitas ·
--        --   2.10 Transferências Entre Contas · 2.10.1 Transferências Enviadas
--        delete from public.classificacao_financeira where codigo in ('2.10.2', '2.10.3');
--      Lixeira: o mesmo de-para no JSON (dados->>'centro_custo_cod'/'conta_contabil_cod').
--      A coluna ordem não volta (só aparência; nenhuma tela ordena por ela).
-- ----------------------------------------------------------------------------
