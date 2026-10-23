-- ============================================================================
-- 0066 — TESTE A SECO
-- ============================================================================
-- >>> NÃO é migration. NÃO muda nada no banco. Serve só para conferir. <<<
--
-- Roda a 0066 inteira dentro de uma transação e, no fim, DESFAZ tudo
-- (rollback). Serve para ver, no SQL Editor de PRODUÇÃO, que a 0066 aplica
-- sem erro — antes de aplicar de verdade.
--
-- Como usar: colar este arquivo inteiro no SQL Editor e clicar em Run.
--   • Deu certo: aparece a tabela de conferência (coluna "situacao" toda OK)
--     — ou só "Success. No rows returned". Nada fica gravado. Aí sim, rode a
--     0066_papeis_plano_contas.sql.
--   • Deu erro (mensagem em vermelho): NÃO aplique a 0066 e envie o texto do
--     erro ao suporte. Também não fica nada gravado.
--
-- O trecho entre "INÍCIO DA 0066" e "FIM DA 0066" é cópia fiel da
-- 0066_papeis_plano_contas.sql (os dois arquivos são gerados juntos).
-- ============================================================================
begin;

-- Foto de antes (só para a conferência; some no rollback)
create temp table _seco_antes on commit drop as
select (select count(*) from public.transacoes_empresa)               as lancamentos,
       (select coalesce(sum(valor), 0) from public.transacoes_empresa) as soma,
       (select string_agg(tgname || '=' || tgenabled::text, ', ' order by tgname)
          from pg_trigger
         where tgrelid = 'public.transacoes_empresa'::regclass and not tgisinternal) as gatilhos,
       (select md5(string_agg(v::text, ',' order by v::text)) from public.v_fluxo_caixa_planilha v) as h_planilha,
       (select md5(string_agg(v::text, ',' order by v::text)) from public.v_fluxo_caixa_contas v)   as h_contas,
       (select md5(string_agg(v::text, ',' order by v::text)) from public.v_fluxo_caixa_mensal v)   as h_mensal,
       (select md5(string_agg(v::text, ',' order by v::text)) from public.v_obra_resumo_atual v)    as h_obra_resumo,
       (select md5(string_agg(v::text, ',' order by v::text)) from public.v_obra_totais v)          as h_obra_totais;

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>> INÍCIO DA 0066 >>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- ============================================================================
-- 0066 — Papéis do Plano de Contas: automações e relatórios acham os códigos
--        pelo PAPEL, e qualquer código pode ser trocado (menos 1 e 2)
-- ============================================================================
-- Pedido (22-out-2026): a cliente quer trocar o código de QUALQUER item do
-- Plano de Contas (Configurações). Até aqui 28 códigos ficavam travados
-- ("código usado pelas automações e relatórios do sistema"), porque o banco e
-- os relatórios procuravam esses itens PELO NÚMERO — '1.8', '2.8.1', '2.10.3'…
--
-- O QUE MUDA
--   • Tabela nova public.classificacao_papel (papel → código), ex.:
--     dv_saldo → 2.10.3. A FK do código é ON UPDATE CASCADE: quando a troca de
--     código renumera o item, o papel acompanha sozinho — inclusive pai e
--     filhos no mesmo comando (2.8 → 2.11 leva dl e dl_lucros juntos).
--     ON DELETE RESTRICT: item com papel não pode ser excluído do plano.
--   • public.fn_cod('papel') devolve o código ATUAL do papel. Papel que não
--     existe → erro: a automação falha alto em vez de gravar em código errado.
--   • As 14 funções e as 4 views que tinham código escrito no corpo foram
--     recriadas a partir da versão VIGENTE (migration de origem citada em cada
--     uma), trocando só o literal pelo fn_cod(...) do papel. Além disso, 3
--     mensagens de erro que citavam o número passam a citar o código atual.
--     Dentro de consultas usa-se (select public.fn_cod('x')): é avaliado uma
--     vez por comando (não por linha) e continua usando os índices.
--   • fn_classificacao_codigos_sistema() passa a devolver só {1,2} — o front
--     lê esta função para saber o que travar.
--   • fn_classificacao_trocar_codigo: sai a trava dos 28; continuam as regras
--     de estrutura (só admin, mesmo nível, mesma raiz, código novo
--     inexistente, conta nova existente). "Centro não entra nem sai de
--     1.8/2.8" passa a valer para as contas dos papéis resgate e dl, onde
--     estiverem. REGRA NOVA: centro de custo com papel troca de número só
--     dentro da conta dele — as automações gravam o centro junto com a conta
--     do papel (ex.: saldo DV = conta outras_saidas + centro dv_saldo), e
--     movê-lo para outra conta deixaria lançamentos com conta e centro
--     desencontrados. Trocar o código da CONTA leva os centros junto.
--   • NENHUM lançamento é tocado. Com os códigos de hoje, o resultado de cada
--     automação e de cada view é idêntico ao de antes (testado linha a linha
--     numa cópia de produção de 21-out-2026).
--
-- PROTEÇÕES (para não aplicar pela metade nem por cima de mudança desconhecida)
--   1. Uma transação só. O SQL Editor roda o script inteiro numa transação:
--      qualquer erro desfaz tudo. O LOCK logo abaixo só funciona dentro de uma
--      transação — rodado fora de uma (psql sem --single-transaction), ele
--      falha de propósito antes de qualquer mudança.
--   2. Pré-requisitos (0057, 0058, 0064, 0065) conferidos, com mensagem clara.
--   3. Trava de conferência: antes de recriar, cada função precisa ter
--      EXATAMENTE o corpo testado (md5 do texto) e cada view a definição
--      vigente (comparada no próprio banco — o que torna a comparação
--      independente da versão do Postgres). Se algo foi mudado direto em
--      produção, a migration aborta inteira dizendo qual objeto. Para
--      reaplicar, aceita também a versão da própria 0066 (idempotente).
--   4. lock_timeout de 15 s: se outra escrita estiver segurando o Plano de
--      Contas, desiste sem mudar nada (é só rodar de novo).
--
-- DESEMPENHO: fn_cod é uma busca pela chave numa tabela de 28 linhas, ~3 µs
-- por chamada. É SECURITY DEFINER para não pagar o RLS a cada chamada (os
-- gatilhos chamam por linha; passando pelo RLS seriam ~35 µs) e para
-- funcionar igual para qualquer usuário que dispare uma automação.
--
-- FRONT (à parte): CODIGOS_DO_SISTEMA (src/lib/queries/configuracoes.ts) e os
-- relatórios (src/lib/pdfmonkey/builders.ts…) passam a ler classificacao_papel
-- e fn_classificacao_codigos_sistema().
--
-- COMO APLICAR (depois da 0065): primeiro rodar 0066_TESTE_A_SECO.sql no SQL
-- Editor (aplica e desfaz). Depois colar ESTE arquivo inteiro no SQL Editor e
-- rodar de uma vez. Via psql: psql --single-transaction -v ON_ERROR_STOP=1 -f.
-- Os md5 da seção 1 são gerados a partir dos corpos da seção 6 — não edite
-- esses corpos sem regerar a lista.

-- ---------------------------------------------------------------------------
-- 0) Transação única, trava do Plano de Contas e pré-requisitos
-- ---------------------------------------------------------------------------
-- O LOCK segura escritas no Plano de Contas até o fim (leitura segue livre;
-- lançamentos novos também). Fora de uma transação ele dá erro — de propósito.
set local lock_timeout = '15s';
lock table public.classificacao_financeira in share row exclusive mode;

do $$
declare
  v_falta text[] := '{}';
begin
  if to_regprocedure('public.fn_classificacao_trocar_codigo(text,text)') is null then
    v_falta := v_falta || '0057_classificacao_trocar_codigo'::text;
  end if;
  if to_regprocedure('public.fn_usuario_ativo()') is null then
    v_falta := v_falta || '0058_acessos'::text;
  end if;
  if to_regprocedure('public.fn_resgate_conta_do_par(uuid)') is null
     or to_regprocedure('public.fn_conta_sicredi_invest_padrao()') is null then
    v_falta := v_falta || '0064_resgate_conta_origem'::text;
  end if;
  -- 0065: dezembro fecha o ano (lead … partition by ano) na v_fluxo_caixa_planilha.
  if to_regclass('public.v_fluxo_caixa_planilha') is null
     or coalesce(pg_get_viewdef(to_regclass('public.v_fluxo_caixa_planilha')), '') !~* 'partition by' then
    v_falta := v_falta || '0065_fluxo_dezembro_fecha_ano'::text;
  end if;
  if cardinality(v_falta) > 0 then
    raise exception '0066 NÃO aplicada — nada foi alterado. Pré-requisito: falta aplicar % (nesta ordem). Aplique e rode a 0066 depois.',
      array_to_string(v_falta, ', ');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Trava: o corpo atual de cada função é o que foi testado?
-- ---------------------------------------------------------------------------
-- md5 do texto da função (prosrc, sem \r) na versão VIGENTE — migrations até a
-- 0065, conferidas numa cópia de produção — e na versão desta 0066 (para
-- reaplicar). Qualquer outro valor = a função foi mudada fora das migrations
-- (ou falta uma migration anterior): aborta tudo, dizendo quais.
do $$
declare
  r     record;
  v_md5 text;
  v_div text[] := '{}';
begin
  for r in
    select * from (values
      ('public.fn_concluir_repasse_dl(uuid)', 'ed77a8259e7de911045c73058c87741a', '79c287665606c8b1cb42b53e2efc11ba'),
      ('public.fn_consolidar_repasse_dl(text,date,boolean)', '9c40c3e5d2d268db605b494689422723', '39d2ce444059f1a5433384f232b00e09'),
      ('public.fn_dl_readotar_orfa(text)', 'c85c9515a1e093f81df06a432c4a51b7', '30633793613669b5a2162e6df06d51b9'),
      ('public.fn_dv_gerar_linha(text)', 'a00ba73bfb60abf23efea24babc93c1e', '5273dcd017d881e40c308ae46eb09236'),
      ('public.fn_religar_sync_dl(text)', '4780c21788e2cc1fc6263d093c7b4473', 'cf7ce370bbc34b5520989dde93069ef6'),
      ('public.fn_resgate_fatura_cartao_obter(date,text)', 'ed1e5502bdc376e95da9b0f6e385f807', '2a6ae191a80b68b66ed36bd9c0479273'),
      ('public.fn_resgate_invest_espelho_sync(uuid)', '5a500c063c94ec1f01b57f5f8d73ec07', '4319462a2dfef79b2681a04138c87fc8'),
      ('public.fn_resgate_invest_obter(date,text)', 'fddb8aa2d7899cc2b0140778fd72e334', '6051490fdeb089ee676de60337fbaabb'),
      ('public.fn_resgate_invest_recalc(uuid,boolean)', '0208de3d6b9aa71dbecd115de9dc3979', 'e9486088cd1b03319a051181b7022723'),
      ('public.fn_resgate_prov_mensal_obter(date)', '7449c32b89664e5d4ad718e378b0c11b', 'd184210a0c6a872f54201143c644f2d3'),
      ('public.fn_sync_provisionado_dl(text)', 'd102d8e58226c5a45331947bf84c08e5', 'a34eb513900e5bda14c94a478200369e'),
      ('public.fn_validar_consistencia()', 'db654b3432ccd6fba2d9184430561a16', '2777d0c67a74a4dab4524befd6fbdfd0'),
      ('public.tg_te_resgate_espelho_invest()', '76fa54deca5745f61415f3526d55a40b', '4a8478050e17c8ed093c11cc21d15c30'),
      ('public.fn_classificacao_trocar_codigo(text,text)', '868812103351183545e09b9599d6d6f4', 'da5cc84f643425808c9d764f36073718'),
      ('public.fn_classificacao_codigos_sistema()', '1cc255f30a86746c3e033767a59a5f62', '9a164b853c6d8ea845a5d74f9701cbda')
    ) as e(funcao, md5_vigente, md5_0066)
  loop
    v_md5 := (select md5(replace(p.prosrc, E'\r', ''))
                from pg_proc p
               where p.oid = to_regprocedure(r.funcao));
    if v_md5 is null then
      v_div := v_div || format('%s (não existe)', r.funcao);
    elsif v_md5 not in (r.md5_vigente, r.md5_0066) then
      v_div := v_div || r.funcao;
    end if;
  end loop;

  if cardinality(v_div) > 0 then
    raise exception '0066 NÃO aplicada — nada foi alterado. O corpo destas funções no banco não é o que foi testado (nem o vigente até a 0065, nem o da 0066): %. Alguém pode ter mudado direto no banco, ou falta aplicar uma migration anterior (0063–0065). Envie esta mensagem ao suporte antes de seguir.',
      array_to_string(v_div, '; ');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Tabela de papéis
-- ---------------------------------------------------------------------------
create table if not exists public.classificacao_papel (
  papel     text not null,
  codigo    text not null,
  descricao text not null,
  constraint classificacao_papel_pkey primary key (papel),
  constraint classificacao_papel_codigo_key unique (codigo),
  constraint classificacao_papel_codigo_fkey foreign key (codigo)
    references public.classificacao_financeira (codigo)
    on update cascade on delete restrict
);

comment on table public.classificacao_papel is
  'Papel de cada item do Plano de Contas que automações e relatórios usam (papel → código atual). A FK acompanha a troca de código (ON UPDATE CASCADE) e impede excluir o item (ON DELETE RESTRICT). Leia o código com public.fn_cod(papel). Só leitura pelo app. Migration 0066.';
comment on column public.classificacao_papel.papel is 'Nome fixo usado pelo código (ex.: dv_saldo). Nunca muda.';
comment on column public.classificacao_papel.codigo is 'Código atual do item no Plano de Contas — acompanha a troca de código sozinho.';
comment on column public.classificacao_papel.descricao is 'O que o sistema faz com este item.';

-- Leitura: usuário ativo (padrão da 0058). Escrita: ninguém pelo app — sem
-- política de escrita e sem privilégio (anon não lê nada).
alter table public.classificacao_papel enable row level security;

drop policy if exists classificacao_papel_read on public.classificacao_papel;
create policy classificacao_papel_read on public.classificacao_papel
  for select using ((select public.fn_usuario_ativo()));

revoke all on public.classificacao_papel from anon, authenticated;
grant select on public.classificacao_papel to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Os 28 papéis — com os códigos de HOJE (os mesmos que a 0063 travou)
-- ---------------------------------------------------------------------------
-- Só insere papel AUSENTE: reaplicar não mexe em nada, nem no papel cujo item
-- já mudou de código. Para papel ausente, o código precisa existir no plano.
-- Depois confere a estrutura (vale também ao reaplicar).
do $$
declare
  v_msg text;
begin
  create temp table _m0066_papeis (
    papel     text primary key,
    codigo    text not null,
    nivel     smallint not null,
    descricao text not null
  );
  insert into _m0066_papeis (papel, codigo, nivel, descricao) values
    ('receita_parceria', '1.2', 2, 'Receita de parceria rural (vendas): o Fluxo de Caixa conta como Vendas e a deixa de fora do "saldo (−) contas do próximo mês"; relatórios PDF e telas de Vendas/Provisionamento.'),
    ('venda_soja', '1.2.1', 3, 'Venda de soja: linha própria nos relatórios PDF e na tela de Vendas.'),
    ('venda_milho', '1.2.2', 3, 'Venda de milho: linha própria nos relatórios PDF e na tela de Vendas.'),
    ('receita_subprodutos', '1.3', 2, 'Receita com venda de subprodutos: linha própria nos relatórios PDF.'),
    ('estorno', '1.6', 2, 'Estorno de pagamentos: linha própria nos relatórios PDF.'),
    ('resgate', '1.8', 2, 'Resgates automáticos do Invest: a linha da corrente Sicredi e o espelho na conta de investimento nascem nesta conta; o espelho e a validação de saldo procuram por ela. Nenhum centro entra ou sai dela pela troca de código.'),
    ('resgate_sicredi', '1.8.1', 3, 'Centro dos resgates automáticos (linha da corrente Sicredi + espelho na conta de investimento).'),
    ('transf_recebidas_conta', '1.9', 2, 'Conta da perna de ENTRADA do par de transferência do repasse da DL (Cora → Inter); concluir o repasse procura por ela.'),
    ('transf_recebidas', '1.9.1', 3, 'Centro da perna de ENTRADA do par de transferência do repasse da DL.'),
    ('outros_recebimentos', '1.10', 2, 'Outros recebimentos: linha própria nos relatórios PDF.'),
    ('desp_administrativas', '2.1', 2, 'Despesas administrativas: bloco próprio nos relatórios PDF.'),
    ('taxas_impostos', '2.1.6', 3, 'Taxas e impostos (ITR, INCRA…): linha própria nos relatórios PDF.'),
    ('desp_pessoal', '2.2', 2, 'Despesas com pessoal: bloco próprio nos relatórios PDF.'),
    ('encargos_sociais', '2.2.2', 3, 'Encargos sociais (INSS, FGTS…): linha própria nos relatórios PDF.'),
    ('operacao', '2.3', 2, 'Operação da propriedade: bloco próprio nos relatórios PDF.'),
    ('energia', '2.3.2', 3, 'Energia elétrica rural: linha própria nos relatórios PDF.'),
    ('servicos_terceiros', '2.4', 2, 'Serviços terceirizados: bloco próprio nos relatórios PDF.'),
    ('taxa_armazenagem', '2.4.5', 3, 'Taxa de armazenagem: relatórios PDF e tela de Vendas (custo de armazenagem).'),
    ('financeiras', '2.5', 2, 'Despesas financeiras e bancárias: bloco próprio nos relatórios PDF.'),
    ('investimento_capital', '2.6', 2, 'Investimento em capital (aplicações): bloco próprio nos relatórios PDF.'),
    ('imobilizado', '2.7', 2, 'Investimento em imobilizado operacional: bloco próprio nos relatórios PDF.'),
    ('obra', '2.7.2', 3, 'Obra da sede: o Fluxo de Caixa separa como Despesas Obra; painéis da obra (v_obra_resumo_atual, v_obra_totais) e fn_validar_consistencia.'),
    ('dl', '2.8', 2, 'Distribuição de Lucro: a linha global do repasse e a linha provisionada automática (SOMASE do detalhado) nascem nesta conta; concluir o repasse procura por ela. Nenhum centro entra ou sai dela pela troca de código.'),
    ('dl_lucros', '2.8.1', 3, 'Centro da DL: linha provisionada automática do mês (SOMASE), linha global do repasse e a trava de provisionado manual.'),
    ('transf_enviadas_conta', '2.9', 2, 'Conta da perna de SAÍDA do par de transferência do repasse da DL; o Fluxo de Caixa trata esta conta como Transferências (fora das despesas).'),
    ('transf_enviadas', '2.9.1', 3, 'Centro da perna de SAÍDA do par de transferência do repasse da DL (Cora → Inter).'),
    ('outras_saidas', '2.10', 2, 'Outras saídas: conta da linha automática do saldo de Despesa Variável; linha própria nos relatórios PDF.'),
    ('dv_saldo', '2.10.3', 3, 'Linha automática do saldo de Despesa Variável (status Provisionado DV) nasce neste centro.');

  select string_agg(format('%s (%s)', s.papel, s.codigo), ', ' order by s.codigo) into v_msg
    from _m0066_papeis s
   where not exists (select 1 from public.classificacao_papel p where p.papel = s.papel)
     and not exists (select 1 from public.classificacao_financeira c where c.codigo = s.codigo);
  if v_msg is not null then
    raise exception '0066 NÃO aplicada — nada foi alterado. Estes códigos não existem no Plano de Contas: %. A 0066 parte do plano da VS4 (0063).', v_msg;
  end if;

  select string_agg(format('%s (%s, já é do papel %s)', s.papel, s.codigo, p.papel), ', ' order by s.codigo) into v_msg
    from _m0066_papeis s
    join public.classificacao_papel p on p.codigo = s.codigo and p.papel <> s.papel
   where not exists (select 1 from public.classificacao_papel q where q.papel = s.papel);
  if v_msg is not null then
    raise exception '0066 NÃO aplicada — nada foi alterado. Código já usado por outro papel: %.', v_msg;
  end if;

  insert into public.classificacao_papel (papel, codigo, descricao)
  select s.papel, s.codigo, s.descricao
    from _m0066_papeis s
   where not exists (select 1 from public.classificacao_papel p where p.papel = s.papel);

  -- Cada papel no nível certo (conta = 2, centro = 3)…
  select string_agg(format('%s (%s)', s.papel, coalesce(p.codigo, 'sem código')), ', ' order by s.papel) into v_msg
    from _m0066_papeis s
    left join public.classificacao_papel p on p.papel = s.papel
    left join public.classificacao_financeira c on c.codigo = p.codigo
   where c.nivel is distinct from s.nivel;
  if v_msg is not null then
    raise exception '0066 NÃO aplicada — nada foi alterado. Papéis fora do nível esperado (conta = 2, centro = 3): %.', v_msg;
  end if;

  -- … e cada centro com papel debaixo da conta do papel que as automações
  -- gravam junto com ele.
  select string_agg(format('%s (%s) não está na conta %s (%s)', pf.papel, pf.codigo, pc.papel, pc.codigo), ', ') into v_msg
    from (values
      ('receita_parceria', 'venda_soja'),
      ('receita_parceria', 'venda_milho'),
      ('resgate', 'resgate_sicredi'),
      ('transf_recebidas_conta', 'transf_recebidas'),
      ('desp_administrativas', 'taxas_impostos'),
      ('desp_pessoal', 'encargos_sociais'),
      ('operacao', 'energia'),
      ('servicos_terceiros', 'taxa_armazenagem'),
      ('imobilizado', 'obra'),
      ('dl', 'dl_lucros'),
      ('transf_enviadas_conta', 'transf_enviadas'),
      ('outras_saidas', 'dv_saldo')
    ) as par(conta, centro)
    join public.classificacao_papel pc on pc.papel = par.conta
    join public.classificacao_papel pf on pf.papel = par.centro
    join public.classificacao_financeira cf on cf.codigo = pf.codigo
   where cf.parent_codigo is distinct from pc.codigo;
  if v_msg is not null then
    raise exception '0066 NÃO aplicada — nada foi alterado. Centro com papel fora da conta esperada: %.', v_msg;
  end if;

  drop table _m0066_papeis;
end $$;

-- ---------------------------------------------------------------------------
-- 4) fn_cod(papel) → código atual
-- ---------------------------------------------------------------------------
-- STABLE: dentro de um comando o código não muda. SECURITY DEFINER + search_path
-- fixo: lê a tabela sem passar pelo RLS a cada chamada e funciona igual para
-- qualquer usuário que dispare uma automação (o mapa papel → código não é
-- sigiloso: é o mesmo Plano de Contas que todo usuário ativo já lê).
create or replace function public.fn_cod(p_papel text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_codigo text;
begin
  select p.codigo into v_codigo
    from public.classificacao_papel p
   where p.papel = p_papel;
  if v_codigo is null then
    raise exception 'O papel "%" não existe no Plano de Contas (tabela classificacao_papel) — a automação parou para não gravar em código errado. Avise o suporte.',
      coalesce(p_papel, '(vazio)');
  end if;
  return v_codigo;
end;
$$;

comment on function public.fn_cod(text) is
  'Código ATUAL do item do Plano de Contas que tem o papel informado (classificacao_papel). Papel inexistente = erro. Em consultas, use (select public.fn_cod(''x'')) para avaliar uma vez por comando. Migration 0066.';

revoke all on function public.fn_cod(text) from public, anon;
grant execute on function public.fn_cod(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) Trava das views: a definição atual é a vigente?
-- ---------------------------------------------------------------------------
-- Cria, só nesta transação, uma cópia TEMPORÁRIA de cada view com o texto
-- vigente (migration de origem) e compara o que o próprio banco devolve para
-- as duas (pg_get_viewdef). Igual = vigente. Diferente = ou já é a versão da
-- 0066 (reaplicação — conferido na seção 8, depois de recriar) ou alguém mudou
-- a view fora das migrations (aí a migration aborta inteira na seção 8).
create temp table _m0066_views (
  view_nome text primary key,
  def_antes text not null,
  vigente   boolean not null
) on commit drop;

create temp view _m0066_ref_v_fluxo_caixa_planilha as
with limites as (
  select min(mes_referencia) as ini, max(mes_referencia) as fim
    from public.transacoes_empresa
   where mes_referencia ~ '^[0-9]{4}-[0-9]{2}$'
),
meses as (
  select to_char(g, 'YYYY-MM') as mes_referencia
    from limites,
         generate_series(to_date(limites.ini, 'YYYY-MM'), to_date(limites.fim, 'YYYY-MM'), interval '1 month') g
),
transf as (
  select codigo
    from public.classificacao_financeira
   where codigo = '2.9'
      or (nivel = 2 and natureza = 'saida' and nome ilike '%transfer%')
),
lanc as (
  select te.mes_referencia, te.valor, te.status, te.conta_contabil_cod, te.centro_custo_cod, te.tipo_despesa,
         coalesce(c.compoe_fluxo_caixa, false)                as conta_fluxo,
         c.tipo                                              as conta_tipo,
         -- A linha automática de saldo DV mora em 2.9.3, mas é despesa (VS4).
         te.conta_contabil_cod in (select codigo from transf)
           and te.status <> 'provisionado_dv'                as eh_transferencia
    from public.transacoes_empresa te
    left join public.contas_bancarias_empresa c on c.id = te.conta_bancaria_id
   where te.mes_referencia is not null
),
por_mes as (
  select mes_referencia,
    -- Entradas
    sum(valor) filter (where status = 'saldo_inicial')                                         as saldo_inicial,
    sum(valor) filter (where conta_contabil_cod = '1.2' and status in ('a_receber','recebido'))  as vendas,
    sum(valor) filter (where status in ('resgate','a_resgatar','resgatado')
                         and conta_fluxo and conta_tipo = 'corrente')                           as resgates_entrada,
    sum(valor) filter (where status in ('a_receber','recebido'))                                as recebimentos,
    -- Saídas
    sum(valor) filter (where status in ('provisionado','a_pagar','pago','provisionado_dv'))     as despesas_brutas,
    sum(valor) filter (where centro_custo_cod = '2.7.2'
                         and status in ('provisionado','a_pagar','pago'))                       as despesas_obra,
    sum(valor) filter (where eh_transferencia
                         and status in ('provisionado','a_pagar','pago','provisionado_dv'))     as transferencias,
    sum(valor) filter (where status in ('provisionado_dl','a_repassar','repassado'))            as distribuicao_lucro,
    sum(valor) filter (where status in ('a_aplicar','aplicado','aplicacao'))                    as aplicacoes,
    sum(valor) filter (where status in ('resgate','a_resgatar','resgatado')
                         and conta_fluxo and conta_tipo = 'investimento')                       as resgates_saida,
    -- Despesa Variável (linhas 49-50; o saldo DV automático 'provisionado_dv' não entra)
    sum(valor) filter (where tipo_despesa = 'variavel'
                         and status in ('a_pagar','pago','recebido','a_receber'))               as dv_mov_utilizado,
    sum(valor) filter (where tipo_despesa = 'variavel' and status = 'provisionado')             as dv_mov_provisionado,
    -- Realizado × provisionado (0061)
    sum(valor) filter (where status = 'recebido'
                          or (status = 'resgatado' and conta_fluxo and conta_tipo = 'corrente')) as ent_realizado,
    sum(valor) filter (where status = 'a_receber'
                          or (status in ('resgate','a_resgatar') and conta_fluxo and conta_tipo = 'corrente')) as ent_provisionado,
    sum(valor) filter (where status in ('pago','repassado','aplicado')
                          or (status = 'resgatado' and conta_fluxo and conta_tipo = 'investimento')) as sai_realizado,
    sum(valor) filter (where status in ('provisionado','a_pagar','provisionado_dv','provisionado_dl',
                                        'a_repassar','a_aplicar','aplicacao')
                          or (status in ('resgate','a_resgatar') and conta_fluxo and conta_tipo = 'investimento')) as sai_provisionado
  from lanc
  group by mes_referencia
),
contas as (
  select mes_referencia,
         sum(saldo_final) filter (where compoe_fluxo_caixa) as saldo_contas_fluxo,
         sum(saldo_final)                                   as saldo_todas_contas
    from public.v_fluxo_caixa_contas
   group by mes_referencia
),
linhas as (
  select m.mes_referencia,
         coalesce(p.saldo_inicial, 0)                                                      as saldo_inicial,
         coalesce(p.vendas, 0)                                                             as vendas,
         coalesce(p.resgates_entrada, 0)                                                   as resgates_entrada,
         coalesce(p.recebimentos, 0) - coalesce(p.vendas, 0)                               as outras_entradas,
         coalesce(p.despesas_brutas, 0) - coalesce(p.despesas_obra, 0) - coalesce(p.transferencias, 0) as despesas_aramburu,
         coalesce(p.distribuicao_lucro, 0)                                                 as distribuicao_lucro,
         coalesce(p.despesas_obra, 0)                                                      as despesas_obra,
         coalesce(p.aplicacoes, 0)                                                         as aplicacoes,
         coalesce(p.resgates_saida, 0)                                                     as resgates_saida,
         coalesce(p.transferencias, 0)                                                     as transferencias,
         coalesce(c.saldo_contas_fluxo, 0)                                                 as saldo_contas_fluxo,
         coalesce(c.saldo_todas_contas, 0)                                                 as saldo_todas_contas,
         public.fn_dv_limite_mensal()                                                      as dv_limite,
         -coalesce(p.dv_mov_utilizado, 0)                                                  as dv_utilizado,
         -coalesce(p.dv_mov_provisionado, 0)                                               as dv_provisionado,
         coalesce(p.saldo_inicial, 0) + coalesce(p.ent_realizado, 0)                       as entradas_realizadas,
         coalesce(p.ent_provisionado, 0)                                                   as entradas_provisionadas,
         coalesce(p.sai_realizado, 0)                                                      as saidas_realizadas,
         coalesce(p.sai_provisionado, 0)                                                   as saidas_provisionadas
    from meses m
    left join por_mes p using (mes_referencia)
    left join contas  c using (mes_referencia)
),
calc as (
  select l.*,
         saldo_inicial + vendas + resgates_entrada + outras_entradas                                        as entradas,
         despesas_aramburu + distribuicao_lucro + despesas_obra + aplicacoes + resgates_saida + transferencias as saidas
    from linhas l
)
select
  mes_referencia,
  saldo_inicial::numeric(15,2),
  vendas::numeric(15,2),
  resgates_entrada::numeric(15,2),
  outras_entradas::numeric(15,2),
  entradas::numeric(15,2),
  despesas_aramburu::numeric(15,2),
  distribuicao_lucro::numeric(15,2),
  despesas_obra::numeric(15,2),
  aplicacoes::numeric(15,2),
  resgates_saida::numeric(15,2),
  transferencias::numeric(15,2),
  saidas::numeric(15,2),
  (entradas + saidas)::numeric(15,2)                                                          as resultado,
  saldo_contas_fluxo::numeric(15,2),
  -- Linha 43: saldo final das contas do fluxo + o que o mês seguinte já tem de
  -- certo (saídas, outras entradas e resgates) — SEM vendas. Dezembro fecha o
  -- ano: não olha janeiro do ano seguinte (0065), então dezembro = saldo final.
  (saldo_contas_fluxo
    + coalesce(lead(saidas + outras_entradas + resgates_entrada)
               over (partition by left(mes_referencia, 4) order by mes_referencia), 0))::numeric(15,2)
                                                                                             as saldo_menos_proximo_mes,
  saldo_todas_contas::numeric(15,2),
  dv_limite::numeric(15,2),
  dv_utilizado::numeric(15,2),
  dv_provisionado::numeric(15,2),
  (dv_limite - dv_utilizado - dv_provisionado)::numeric(15,2)                                  as dv_saldo,
  entradas_realizadas::numeric(15,2),
  entradas_provisionadas::numeric(15,2),
  saidas_realizadas::numeric(15,2),
  saidas_provisionadas::numeric(15,2)
from calc;

create temp view _m0066_ref_v_obra_resumo_atual as
with base as (
  select
    obs_obra,
    status,
    sum(-valor) as valor   -- negativo na transação = saída → positivo aqui
  from public.transacoes_empresa
  where centro_custo_cod = '2.7.2'
  group by obs_obra, status
)
select
  obs_obra::text as bucket,
  status::text   as status,
  valor
from base
order by 1, 2;

create temp view _m0066_ref_v_obra_totais as
select
  sum(case when status = 'pago'         and obs_obra in ('ordem_compra','projeto') then -valor else 0 end) as pago_oc_projeto,
  sum(case when status = 'pago'         and obs_obra::text like 'medicao_%'              then -valor else 0 end) as pago_medicoes,
  sum(case when status = 'pago'         and obs_obra = 'outras'                    then -valor else 0 end) as pago_outras,
  sum(case when status = 'a_pagar'      and obs_obra = 'outras'                    then -valor else 0 end) as a_pagar_outras,
  sum(case when status = 'provisionado' and obs_obra::text like 'medicao_%'              then -valor else 0 end) as provisionado_medicoes,
  sum(case when status = 'provisionado' and obs_obra = 'outras'                    then -valor else 0 end) as provisionado_outras,
  sum(case when status = 'provisionado' and obs_obra = 'retencao'                  then -valor else 0 end) as provisionado_retencao
from public.transacoes_empresa
where centro_custo_cod = '2.7.2';

create temp view _m0066_ref_v_fluxo_caixa_mensal as
with por_mes as (
  select
    te.mes_referencia,
    -- Saldo disponível: SÓ contas-corrente (igual à planilha — investimentos ficam
    -- de fora; o dinheiro investido entra de volta via "resgate" do próximo mês).
    coalesce(sum(te.valor) filter (where te.status in
      ('saldo_inicial','recebido','pago','repassado','aplicado','aplicacao','resgatado','resgate')
      and cbe.tipo = 'corrente'), 0)                                                   as movimento_realizado,
    -- Saídas do mês (todas as contas): realizadas + provisionadas + a pagar — negativas
    coalesce(sum(te.valor) filter (where te.status in
      ('provisionado','provisionado_dv','provisionado_dl','a_pagar','a_repassar','a_aplicar','pago','repassado','aplicado','aplicacao')), 0) as saidas_mes,
    -- Resgates de investimento (entradas "certas" que caem na conta-corrente)
    coalesce(sum(te.valor) filter (where te.status in ('resgate','a_resgatar','resgatado')), 0) as resgate_mes,
    -- Outras entradas = a receber/recebido que NÃO são vendas (conta 1.2)
    coalesce(sum(te.valor) filter (where te.status in ('a_receber','recebido') and te.conta_contabil_cod not like '1.2%'), 0) as outros_entradas_mes,
    -- Vendas (conta 1.2) — excluídas do indicador de próximo mês
    coalesce(sum(te.valor) filter (where te.status in ('a_receber','recebido') and te.conta_contabil_cod like '1.2%'), 0) as vendas_mes
  from public.transacoes_empresa te
  left join public.contas_bancarias_empresa cbe on cbe.id = te.conta_bancaria_id
  where te.mes_referencia is not null
  group by te.mes_referencia
),
acc as (
  select
    *,
    sum(movimento_realizado) over (order by mes_referencia rows between unbounded preceding and current row) as saldo_final_acumulado
  from por_mes
)
select
  mes_referencia,
  saldo_final_acumulado,
  saidas_mes,
  resgate_mes,
  outros_entradas_mes,
  vendas_mes,
  coalesce(lead(saidas_mes) over (order by mes_referencia), 0)                         as saidas_proximo_mes,
  coalesce(lead(resgate_mes + outros_entradas_mes) over (order by mes_referencia), 0)  as entradas_garantidas_proximo_mes,
  saldo_final_acumulado
    + coalesce(lead(saidas_mes + resgate_mes + outros_entradas_mes) over (order by mes_referencia), 0) as saldo_menos_proximo_mes
from acc
order by mes_referencia;

insert into _m0066_views (view_nome, def_antes, vigente)
select v,
       coalesce(pg_get_viewdef(to_regclass('public.' || v), true), '(não existe)'),
       coalesce(pg_get_viewdef(to_regclass('public.' || v), true)
                  = pg_get_viewdef(to_regclass('pg_temp._m0066_ref_' || v), true), false)
  from unnest(array['v_fluxo_caixa_planilha', 'v_obra_resumo_atual', 'v_obra_totais', 'v_fluxo_caixa_mensal']) as v;

drop view pg_temp._m0066_ref_v_fluxo_caixa_planilha, pg_temp._m0066_ref_v_obra_resumo_atual,
          pg_temp._m0066_ref_v_obra_totais, pg_temp._m0066_ref_v_fluxo_caixa_mensal;

-- ---------------------------------------------------------------------------
-- 6) Funções recriadas: corpo VIGENTE, só os literais de código → fn_cod
-- ---------------------------------------------------------------------------
-- Comentários dentro dos corpos citam os números de hoje (2.8.1, 2.10.3…) —
-- ficaram como estavam; quem manda agora é o papel.

-- fn_concluir_repasse_dl(uuid) — corpo da 0044 (vigente). Troca: '2.8' → dl, '2.9' → transf_enviadas_conta, '1.9' → transf_recebidas_conta.
create or replace function public.fn_concluir_repasse_dl(p_repasse_id uuid)
returns void
language plpgsql
as $$
declare
  v_tag text;
begin
  select origem_planilha into v_tag
  from public.transacoes_empresa
  where id = p_repasse_id and origem_planilha like 'dl_repasse:%';

  if v_tag is null then
    raise exception 'Lançamento não é um repasse consolidado pelo sistema.';
  end if;

  update public.transacoes_empresa set status = 'repassado'
   where origem_planilha = v_tag and conta_contabil_cod = (select public.fn_cod('dl')) and status in ('a_pagar', 'a_repassar');
  update public.transacoes_empresa set status = 'pago'
   where origem_planilha = v_tag and conta_contabil_cod = (select public.fn_cod('transf_enviadas_conta')) and status = 'a_pagar';
  update public.transacoes_empresa set status = 'recebido'
   where origem_planilha = v_tag and conta_contabil_cod = (select public.fn_cod('transf_recebidas_conta')) and status = 'a_receber';

  update public.transacoes_socio set status = 'realizado'
   where repasse_id = p_repasse_id and status = 'a_pagar';
end;
$$;

-- fn_consolidar_repasse_dl(text,date,boolean) — corpo da 0063 (vigente). Troca: '2.8'/'2.8.1' → dl/dl_lucros, '2.9'/'2.9.1' → transf_enviadas_conta/transf_enviadas, '1.9'/'1.9.1' → transf_recebidas_conta/transf_recebidas; mensagem de plano incompleto passa a citar os códigos atuais.
create or replace function public.fn_consolidar_repasse_dl(
  p_mes text,
  p_data date default current_date,
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

  perform 1 from public.classificacao_financeira where codigo in ((select public.fn_cod('dl')),(select public.fn_cod('dl_lucros')),(select public.fn_cod('transf_enviadas_conta')),(select public.fn_cod('transf_enviadas')),(select public.fn_cod('transf_recebidas_conta')),(select public.fn_cod('transf_recebidas')))
  having count(*) = 6;
  if not found then
    raise exception 'Plano de contas incompleto: são necessárias as classificações %/%, %/% e %/% (Configurações → Plano de Contas).',
      public.fn_cod('dl'), public.fn_cod('dl_lucros'), public.fn_cod('transf_enviadas_conta'), public.fn_cod('transf_enviadas'), public.fn_cod('transf_recebidas_conta'), public.fn_cod('transf_recebidas');
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
    p_data, public.fn_cod('dl'), public.fn_cod('dl_lucros'), 'sem',
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
      p_data, public.fn_cod('transf_enviadas_conta'), public.fn_cod('transf_enviadas'), 'sem',
      'Transf. Entre Contas_Distribuição de Lucro ' || v_mes_humano,
      'sem', 'transferencia', v_cora,
      'a_pagar', -v_soma, null, v_grupo
    ), (
      p_data, public.fn_cod('transf_recebidas_conta'), public.fn_cod('transf_recebidas'), 'sem',
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

comment on function public.fn_consolidar_repasse_dl(text,date,boolean) is
  'Consolida o detalhado "A repassar" do mês em lançamentos globais da empresa (par Cora→Inter nos centros dos papéis transf_enviadas/transf_recebidas — hoje 2.9.1/1.9.1 — + saída do Inter no centro do papel dl_lucros — hoje 2.8.1 —, status a_repassar) e vincula via repasse_id. Atômico. Migrations 0044/0063/0066.';

-- fn_dl_readotar_orfa(text) — corpo da 0052 (vigente). Troca: '2.8.1' → dl_lucros.
create or replace function public.fn_dl_readotar_orfa(p_mes text)
returns uuid
language plpgsql
as $$
declare
  v_tag text := 'dl_auto:' || p_mes;
  v_id  uuid;
  v_qtd int;
begin
  if p_mes is null then return null; end if;

  if exists (select 1 from public.transacoes_empresa where origem_planilha = v_tag) then
    return null;
  end if;

  -- (array_agg(...))[1] e não min(id): o Postgres não tem agregado min/max para uuid.
  select count(*), (array_agg(id))[1] into v_qtd, v_id
    from public.transacoes_empresa
   where mes_referencia = p_mes
     and centro_custo_cod = (select public.fn_cod('dl_lucros'))
     and status in ('provisionado', 'provisionado_dl')
     and origem_planilha is null
     and descricao = public.fn_dl_descricao_auto();

  if v_qtd <> 1 then return null; end if;   -- 0 = nada órfão; >1 = ambíguo, não adivinha

  update public.transacoes_empresa set origem_planilha = v_tag where id = v_id;
  return v_id;
end;
$$;

-- fn_dv_gerar_linha(text) — corpo da 0063 (vigente). Troca: '2.10'/'2.10.3' → outras_saidas/dv_saldo.
create or replace function public.fn_dv_gerar_linha(p_mes text)
returns uuid
language plpgsql
as $$
declare
  v_tag    text := 'dv_auto:' || p_mes;
  v_id     uuid;
  v_qtd    int;
  v_banco  uuid;
  v_conta  text := public.fn_cod('outras_saidas');
  v_centro text := public.fn_cod('dv_saldo');
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
  'Cria (no centro do papel dv_saldo — hoje 2.10/2.10.3) ou ADOTA a linha Provisionado DV do mês (inclusive a importada da planilha — 0055) e a mantém igual ao saldo do teto. Recusa-se a escolher quando houver mais de uma candidata no mês. Migrations 0054/0055/0063/0066.';

-- fn_religar_sync_dl(text) — corpo da 0052 (vigente). Troca: '2.8.1' → dl_lucros (2×); mensagem passa a citar o código atual.
create or replace function public.fn_religar_sync_dl(p_mes text)
returns jsonb
language plpgsql
as $$
declare
  v_tag       text := 'dl_auto:' || p_mes;
  v_qtd       int;
  v_id        uuid;
  v_adotou    boolean := false;
  v_valor_dep numeric(15,2);
  v_soma      numeric(15,2);
begin
  if p_mes is null or p_mes !~ '^\d{4}-\d{2}$' then
    raise exception 'Mês inválido (esperado AAAA-MM).';
  end if;

  select count(*), (array_agg(id))[1] into v_qtd, v_id
    from public.transacoes_empresa
   where mes_referencia = p_mes
     and centro_custo_cod = (select public.fn_cod('dl_lucros'))
     and status in ('provisionado', 'provisionado_dl')
     and (origem_planilha is null or origem_planilha not like 'dl_auto:%');

  if v_qtd > 1 then
    raise exception 'Há % linhas provisionadas no centro % em % — deixe apenas uma no Financeiro e tente de novo.', v_qtd, public.fn_cod('dl_lucros'), p_mes;
  end if;

  if v_qtd = 1 then
    if exists (select 1 from public.transacoes_empresa where origem_planilha = v_tag) then
      raise exception 'Já existe uma linha automática em % — exclua a linha provisionada manual no Financeiro para religar a sincronização.', p_mes;
    end if;
    update public.transacoes_empresa set origem_planilha = v_tag where id = v_id;
    v_adotou := true;
  end if;

  perform public.fn_sync_provisionado_dl(p_mes);

  select coalesce(sum(valor), 0) into v_soma
    from public.transacoes_socio
   where mes_referencia = p_mes and status = 'provisionado';

  select coalesce(sum(valor), 0) into v_valor_dep
    from public.transacoes_empresa
   where mes_referencia = p_mes
     and centro_custo_cod = (select public.fn_cod('dl_lucros'))
     and status in ('provisionado', 'provisionado_dl');

  return jsonb_build_object(
    'mes', p_mes,
    'adotou_linha', v_adotou,
    'linha_id', v_id,
    'soma_detalhado', v_soma,
    'global_depois', abs(v_valor_dep),
    'sincronizado', abs(v_valor_dep) = v_soma
  );
end;
$$;

comment on function public.fn_religar_sync_dl(text) is
  'Religa a sincronização automática do Provisionado DL de um mês: adota a linha provisionada do centro do papel dl_lucros (hoje 2.8.1) como a linha automática (etiqueta dl_auto:<mes>) e roda o SOMASE. Levanta erro se houver mais de uma candidata. Alimenta o botão do aviso de divergência da tela de Distribuição de Lucro. Migrations 0052/0066.';

-- fn_resgate_fatura_cartao_obter(date,text) — corpo da 0053 (vigente). Troca: '1.8'/'1.8.1' → resgate/resgate_sicredi.
create or replace function public.fn_resgate_fatura_cartao_obter(p_mes_venc date, p_lote text)
returns uuid
language plpgsql
as $$
declare
  v_sic   uuid := public.fn_conta_sicredi_corrente();
  v_forn  uuid;
  v_id    uuid;
  v_mes   text := to_char(p_mes_venc, 'YYYY-MM');
  v_tag   text := 'auto:resgate_invest_fatura:' || to_char(p_mes_venc, 'YYYY-MM') || '#' || p_lote;
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
    (v_data, public.fn_cod('resgate'), public.fn_cod('resgate_sicredi'), 'sem', 'sem', 'sem',
     v_sic, 'a_resgatar', 0,
     v_forn, 'Banco Cooperativa Sicredi',
     'Resgate da Conta Investimento Invest - Fatura Cartão de Crédito ' ||
       substring(v_mes from 6 for 2) || '/' || substring(v_mes from 1 for 4),
     v_tag,
     'Resgate da fatura do cartão: soma os lançamentos de Cartão de Crédito do ' ||
     'Sicredi que foram para o banco juntos, com vencimento em ' ||
       substring(v_mes from 6 for 2) || '/' || substring(v_mes from 1 for 4) ||
     '. Programado para o dia útil anterior ao vencimento da fatura.')
  returning id into v_id;
  return v_id;
end;
$$;

-- fn_resgate_invest_espelho_sync(uuid) — corpo da 0064 (vigente). Troca: '1.8'/'1.8.1' → resgate/resgate_sicredi.
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
      (v_row.data, public.fn_cod('resgate'), public.fn_cod('resgate_sicredi'), 'sem', 'sem', 'sem',
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

-- fn_resgate_invest_obter(date,text) — corpo da 0053 (vigente). Troca: '1.8'/'1.8.1' → resgate/resgate_sicredi.
create or replace function public.fn_resgate_invest_obter(p_dia date, p_lote text)
returns uuid
language plpgsql
as $$
declare
  v_sic  uuid := public.fn_conta_sicredi_corrente();
  v_forn uuid;
  v_id   uuid;
  v_tag  text := 'auto:resgate_invest:' || to_char(p_dia, 'YYYY-MM-DD') || '#' || p_lote;
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
     'Resgate da Conta Investimento Invest - Reserva p/ Construção da Sede',
     v_tag,
     'Resgate de um agendamento: soma os títulos que foram para o banco juntos, ' ||
     'com vencimento no dia útil seguinte. Um agendamento novo no mesmo dia gera ' ||
     'outra linha, para o extrato bater lançamento a lançamento.')
  returning id into v_id;
  return v_id;
end;
$$;

-- fn_resgate_invest_recalc(uuid,boolean) — corpo da 0064 (vigente). Troca: '1.8' → resgate.
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
         and conta_contabil_cod = (select public.fn_cod('resgate'))
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

-- fn_resgate_prov_mensal_obter(date) — corpo da 0053 (vigente). Troca: '1.8'/'1.8.1' → resgate/resgate_sicredi.
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
     'Resgate da Conta Investimento Invest - Provisionados de ' ||
       substring(v_mes from 6 for 2) || '/' || substring(v_mes from 1 for 4),
     v_tag,
     'Programação: soma de tudo que está provisionado no mês na conta corrente ' ||
     'Sicredi. Cada título sai desta linha quando passa para A Pagar, e vira uma ' ||
     'linha própria de A Resgatar no dia do agendamento.')
  returning id into v_id;
  return v_id;
end;
$$;

-- fn_sync_provisionado_dl(text) — corpo da 0052 (vigente). Troca: '2.8'/'2.8.1' → dl/dl_lucros.
create or replace function public.fn_sync_provisionado_dl(p_mes text)
returns void
language plpgsql
as $$
declare
  v_tag   text := 'dl_auto:' || p_mes;
  v_soma  numeric(15,2);
  v_banco uuid;
  v_id    uuid;
begin
  if p_mes is null then return; end if;

  if not exists (select 1 from public.classificacao_financeira where codigo = (select public.fn_cod('dl')))
     or not exists (select 1 from public.classificacao_financeira where codigo = (select public.fn_cod('dl_lucros'))) then
    return;
  end if;

  -- 0052: antes de julgar o mês como "manual", recupera a própria linha órfã.
  -- Em bloco próprio de propósito: o handler geral lá embaixo aborta o resto da
  -- função, então um erro aqui derrubaria o SOMASE inteiro em silêncio — foi o
  -- que aconteceu no primeiro teste desta migration (min(uuid) não existe).
  begin
    perform public.fn_dl_readotar_orfa(p_mes);
  exception when others then
    null;
  end;

  -- Mês com provisionado MANUAL no centro 2.8.1 → gestão manual, não interfere.
  -- (Outros centros da 2.8 — ex.: 2.8.3 Plano de Saúde — não bloqueiam — 0047.)
  if exists (
    select 1 from public.transacoes_empresa
    where mes_referencia = p_mes
      and centro_custo_cod = (select public.fn_cod('dl_lucros'))
      and status in ('provisionado', 'provisionado_dl')
      and (origem_planilha is null or origem_planilha not like 'dl_auto:%')
  ) then
    return;
  end if;

  select coalesce(sum(valor), 0) into v_soma
  from public.transacoes_socio
  where mes_referencia = p_mes and status = 'provisionado';

  if v_soma <= 0 then
    delete from public.transacoes_empresa where origem_planilha = v_tag;
    return;
  end if;

  update public.transacoes_empresa
     set valor = -v_soma
   where origem_planilha = v_tag
  returning id into v_id;

  if v_id is null then
    select id into v_banco
    from public.contas_bancarias_empresa
    where ativa = true and banco ilike '%cora%'
    order by ordem nulls last limit 1;

    insert into public.transacoes_empresa (
      data, conta_contabil_cod, centro_custo_cod, tipo_despesa,
      descricao, obs_obra, forma_pgto, conta_bancaria_id,
      status, valor, observacao, origem_planilha
    ) values (
      to_date(p_mes || '-01', 'YYYY-MM-DD'), public.fn_cod('dl'), public.fn_cod('dl_lucros'), 'sem',
      public.fn_dl_descricao_auto(),
      'sem', 'sem', v_banco,
      'provisionado_dl', -v_soma,
      'Linha mantida automaticamente pela soma do detalhado por sócio (tela Distribuição de Lucro). Não editar o valor à mão.',
      v_tag
    );
  end if;
exception when others then
  -- Nunca bloquear a operação no detalhado por causa da sincronização.
  null;
end;
$$;

comment on function public.fn_sync_provisionado_dl(text) is
  'SOMASE da DL: mantém o global Provisionado DL (conta/centro dos papéis dl/dl_lucros — hoje 2.8/2.8.1) igual à soma do detalhado provisionado do mês. Bloqueado só por provisionado MANUAL no centro dl_lucros (0047), e desde a 0052 readota sozinho a linha automática que tenha perdido a etiqueta. Códigos pelo papel desde a 0066.';

-- fn_validar_consistencia() — corpo da 0026 (vigente). Troca: '2.7.2' → obra.
create or replace function public.fn_validar_consistencia()
returns table(codigo text, descricao text, severidade text, esperado numeric, realizado numeric, diferenca numeric, detalhes text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_capital_inicial numeric;
  v_total_lts_oc     numeric;
  v_total_lts_med    numeric;
  v_total_contrato   numeric;
  v_pago_oc_proj     numeric;
  v_pago_medicoes    numeric;
  v_a_pagar          numeric;
  v_provisionado     numeric;
  v_saldo_mju        numeric;
  v_saldo_cgr        numeric;
  v_saldo_cora       numeric;
begin
  -- Capital inicial e total contrato (parâmetros + somatórios)
  select coalesce(valor_numerico, 0) into v_capital_inicial
    from public.obra_parametros where chave = 'capital_inicial';

  select coalesce(sum(valor), 0) into v_total_contrato
    from public.obra_lts_itens where status <> 'cancelado';

  select coalesce(sum(valor), 0) into v_total_lts_oc
    from public.obra_lts_itens where status <> 'cancelado'
      and (oc_numero ilike 'OC%' or contrato ilike '%OC%');

  select coalesce(sum(valor), 0) into v_total_lts_med
    from public.obra_lts_itens where status <> 'cancelado'
      and (oc_numero ilike 'MED%' or contrato ilike '%medi%' );

  -- Pago/A pagar/Provisionado do centro_custo 2.7.2 (obra)
  select
    coalesce(sum(case when status = 'pago'         and obs_obra in ('ordem_compra','projeto') then -valor else 0 end), 0),
    coalesce(sum(case when status = 'pago'         and obs_obra::text like 'medicao_%'        then -valor else 0 end), 0),
    coalesce(sum(case when status = 'a_pagar'                                                 then -valor else 0 end), 0),
    coalesce(sum(case when status = 'provisionado'                                            then -valor else 0 end), 0)
    into v_pago_oc_proj, v_pago_medicoes, v_a_pagar, v_provisionado
  from public.transacoes_empresa
  where centro_custo_cod = (select public.fn_cod('obra'));

  -- Saldos atuais por banco (apelido) — replica $ obra sede!I50/I56
  select coalesce(saldo_atual, 0) into v_saldo_mju
    from public.v_saldo_atual_por_banco
    where banco_apelido ilike '%MJU%' or banco_nome ilike '%0902%'
    limit 1;
  select coalesce(saldo_atual, 0) into v_saldo_cgr
    from public.v_saldo_atual_por_banco
    where banco_apelido ilike '%CGR%' or banco_nome ilike '%0913%'
    limit 1;
  select coalesce(saldo_atual, 0) into v_saldo_cora
    from public.v_saldo_atual_por_banco
    where banco_apelido ilike '%Cora%' or banco_nome ilike '%Cora%'
    limit 1;

  -- VALIDAÇÃO 1: LTS!K85 — total contrato bate com soma dos itens
  if v_total_contrato = 0 and v_total_lts_oc + v_total_lts_med = 0 then
    -- ambos zero, nada a validar
    null;
  elsif abs(v_total_contrato - (v_total_lts_oc + v_total_lts_med)) > 0.5 then
    codigo := 'lts_k85';
    descricao := 'Total do contrato LTS difere da soma de OCs + Medições.';
    severidade := 'aviso';
    esperado := v_total_contrato;
    realizado := v_total_lts_oc + v_total_lts_med;
    diferenca := esperado - realizado;
    detalhes := format('OCs: %s | Medições: %s', v_total_lts_oc, v_total_lts_med);
    return next;
  end if;

  -- VALIDAÇÃO 2: obra sede!H32 — saldo bancário cobre A pagar?
  if v_saldo_mju + v_saldo_cgr + v_saldo_cora > 0 and v_a_pagar > 0 then
    if v_saldo_mju + v_saldo_cgr + v_saldo_cora < v_a_pagar then
      codigo := 'obra_saldo_a_pagar';
      descricao := 'Saldo total dos bancos NÃO cobre o A Pagar da obra.';
      severidade := 'erro';
      esperado := v_a_pagar;
      realizado := v_saldo_mju + v_saldo_cgr + v_saldo_cora;
      diferenca := esperado - realizado;
      detalhes := format('Cora: %s | MJU: %s | CGR: %s', v_saldo_cora, v_saldo_mju, v_saldo_cgr);
      return next;
    end if;
  end if;

  -- VALIDAÇÃO 3: obra sede!I60 — saldo cobre A pagar + Provisionado?
  if v_saldo_mju + v_saldo_cgr + v_saldo_cora > 0 and (v_a_pagar + v_provisionado) > 0 then
    if v_saldo_mju + v_saldo_cgr + v_saldo_cora < (v_a_pagar + v_provisionado) then
      codigo := 'obra_saldo_provisionado';
      descricao := 'Saldo total dos bancos NÃO cobre A Pagar + Provisionado da obra.';
      severidade := 'aviso';
      esperado := v_a_pagar + v_provisionado;
      realizado := v_saldo_mju + v_saldo_cgr + v_saldo_cora;
      diferenca := esperado - realizado;
      detalhes := format('A pagar: %s | Provisionado: %s', v_a_pagar, v_provisionado);
      return next;
    end if;
  end if;

  -- VALIDAÇÃO 4: Capital inicial vs custo total (placeholder se cadastrado)
  if v_capital_inicial > 0 then
    declare
      v_custo_total numeric := v_pago_oc_proj + v_pago_medicoes + v_a_pagar + v_provisionado;
    begin
      if v_custo_total > v_capital_inicial then
        codigo := 'obra_capital';
        descricao := 'Custo total da obra ultrapassou o capital inicial declarado.';
        severidade := 'aviso';
        esperado := v_capital_inicial;
        realizado := v_custo_total;
        diferenca := esperado - realizado;
        detalhes := format('Capital: %s | Pago + A pagar + Provisionado: %s', v_capital_inicial, v_custo_total);
        return next;
      end if;
    end;
  end if;

  -- VALIDAÇÃO 5: pares de transferência interna órfãos
  -- (lançamento "Transf. Entre Contas..." sem par com valor oposto)
  for codigo, descricao, severidade, esperado, realizado, diferenca, detalhes in
    select
      'transf_orfa'::text,
      format('Transferência interna sem par: "%s" (%s)', t.descricao, t.data),
      'aviso'::text,
      0::numeric,
      t.valor,
      t.valor,
      format('Lançamento id=%s. Esperado um par com valor=%s e descrição idêntica.', t.id, -t.valor)
    from public.transacoes_empresa t
    where t.descricao ilike '%transf%entre%contas%'
      and not exists (
        select 1 from public.transacoes_empresa p
        where p.id <> t.id
          and p.descricao = t.descricao
          and p.valor = -t.valor
      )
  loop
    return next;
  end loop;

  return;
end;
$$;

-- tg_te_resgate_espelho_invest() — corpo da 0045 (vigente). Troca: '1.8' → resgate (2×; só chamada para linha da corrente Sicredi — o teste do banco vem antes no AND).
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
        and new.conta_bancaria_id = v_sic and new.conta_contabil_cod = public.fn_cod('resgate'))
     or (tg_op in ('UPDATE', 'DELETE')
        and old.conta_bancaria_id = v_sic and old.conta_contabil_cod = public.fn_cod('resgate')) then
    v_alvo := case when tg_op = 'DELETE' then old.id else new.id end;
    perform public.fn_resgate_invest_espelho_sync(v_alvo);
  end if;
  return null;
end;
$$;

-- fn_classificacao_trocar_codigo(text,text) — corpo da 0057 (vigente). Troca: regra "centro não entra nem sai" passa a usar as contas dos papéis resgate/dl (e cita os códigos atuais); regra NOVA: centro com papel não muda de conta.
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
  v_papeis     text;             -- 0066: papéis do centro (classificacao_papel)
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

  if v_muda_conta and (v_item.parent_codigo in (public.fn_cod('resgate'), public.fn_cod('dl')) or v_pai_novo in (public.fn_cod('resgate'), public.fn_cod('dl'))) then
    raise exception 'Um centro de custo não entra nem sai de % (Resgate de Aplicações) ou % (Distribuição de Lucro) pela troca de código — essas contas têm automações. Crie a classificação nova lá e reclassifique os lançamentos.',
      public.fn_cod('resgate'), public.fn_cod('dl');
  end if;

  -- 0066: centro de custo com papel no sistema (classificacao_papel) troca de
  -- número só DENTRO da conta dele — as automações gravam o centro junto com a
  -- conta do papel (ex.: saldo DV = outras_saidas + dv_saldo) e os relatórios
  -- leem os dois juntos. Trocar o código da conta leva o centro junto.
  if v_muda_conta then
    select string_agg(p.papel, ', ' order by p.papel) into v_papeis
      from public.classificacao_papel p
     where p.codigo = v_de;
    if v_papeis is not null then
      raise exception 'O centro de custo % é usado pelo sistema (papel: %): pode trocar de número dentro da conta %, mas não mudar de conta. Para levar o grupo inteiro, troque o código da conta %.',
        v_de, v_papeis, v_item.parent_codigo, v_item.parent_codigo;
    end if;
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

comment on function public.fn_classificacao_trocar_codigo(text,text) is
  'Troca o código de uma classificação (nível 2 ou 3): subcategorias renumeradas junto; lançamentos, itens da Lixeira e papéis do sistema (classificacao_papel, ON UPDATE CASCADE) acompanham; centro que muda de conta leva a conta dos lançamentos. Só admin; só os grupos raiz são travados (0066). Centro não entra/sai das contas dos papéis resgate e dl; centro com papel troca de número só dentro da conta. Migrations 0057/0066.';

-- fn_classificacao_codigos_sistema — corpo NOVO: só {1,2} (era a lista de 28 da 0063).
-- O front lê esta função para saber o que travar no Plano de Contas.
create or replace function public.fn_classificacao_codigos_sistema()
returns text[]
language sql
immutable
as $$
  -- 0066: só os grupos raiz. Os demais códigos que automações e relatórios usam
  -- são achados pelo PAPEL (classificacao_papel / fn_cod), que acompanha a troca.
  select array['1', '2']
$$;

comment on function public.fn_classificacao_codigos_sistema() is
  'Códigos do plano de contas que não podem mudar de código: só os grupos raiz (1 Entradas, 2 Saídas). Automações e relatórios acham os demais pelo papel (classificacao_papel / fn_cod). Espelho no front: src/lib/queries/configuracoes.ts. Migrations 0057/0063/0066.';

-- ---------------------------------------------------------------------------
-- 7) Views recriadas: fonte VIGENTE, só os literais de código → fn_cod
-- ---------------------------------------------------------------------------
-- Mesmas colunas, na mesma ordem. security_invoker como desde a 0060.

-- v_fluxo_caixa_planilha — fonte da 0065 (vigente). Troca: '2.9' → transf_enviadas_conta, '1.2' → receita_parceria, '2.7.2' → obra.
create or replace view public.v_fluxo_caixa_planilha
with (security_invoker = true) as
with limites as (
  select min(mes_referencia) as ini, max(mes_referencia) as fim
    from public.transacoes_empresa
   where mes_referencia ~ '^[0-9]{4}-[0-9]{2}$'
),
meses as (
  select to_char(g, 'YYYY-MM') as mes_referencia
    from limites,
         generate_series(to_date(limites.ini, 'YYYY-MM'), to_date(limites.fim, 'YYYY-MM'), interval '1 month') g
),
transf as (
  select codigo
    from public.classificacao_financeira
   where codigo = (select public.fn_cod('transf_enviadas_conta'))
      or (nivel = 2 and natureza = 'saida' and nome ilike '%transfer%')
),
lanc as (
  select te.mes_referencia, te.valor, te.status, te.conta_contabil_cod, te.centro_custo_cod, te.tipo_despesa,
         coalesce(c.compoe_fluxo_caixa, false)                as conta_fluxo,
         c.tipo                                              as conta_tipo,
         -- A linha automática de saldo DV (papel dv_saldo) é despesa, nunca transferência (VS4).
         te.conta_contabil_cod in (select codigo from transf)
           and te.status <> 'provisionado_dv'                as eh_transferencia
    from public.transacoes_empresa te
    left join public.contas_bancarias_empresa c on c.id = te.conta_bancaria_id
   where te.mes_referencia is not null
),
por_mes as (
  select mes_referencia,
    -- Entradas
    sum(valor) filter (where status = 'saldo_inicial')                                         as saldo_inicial,
    sum(valor) filter (where conta_contabil_cod = (select public.fn_cod('receita_parceria')) and status in ('a_receber','recebido'))  as vendas,
    sum(valor) filter (where status in ('resgate','a_resgatar','resgatado')
                         and conta_fluxo and conta_tipo = 'corrente')                           as resgates_entrada,
    sum(valor) filter (where status in ('a_receber','recebido'))                                as recebimentos,
    -- Saídas
    sum(valor) filter (where status in ('provisionado','a_pagar','pago','provisionado_dv'))     as despesas_brutas,
    sum(valor) filter (where centro_custo_cod = (select public.fn_cod('obra'))
                         and status in ('provisionado','a_pagar','pago'))                       as despesas_obra,
    sum(valor) filter (where eh_transferencia
                         and status in ('provisionado','a_pagar','pago','provisionado_dv'))     as transferencias,
    sum(valor) filter (where status in ('provisionado_dl','a_repassar','repassado'))            as distribuicao_lucro,
    sum(valor) filter (where status in ('a_aplicar','aplicado','aplicacao'))                    as aplicacoes,
    sum(valor) filter (where status in ('resgate','a_resgatar','resgatado')
                         and conta_fluxo and conta_tipo = 'investimento')                       as resgates_saida,
    -- Despesa Variável (linhas 49-50; o saldo DV automático 'provisionado_dv' não entra)
    sum(valor) filter (where tipo_despesa = 'variavel'
                         and status in ('a_pagar','pago','recebido','a_receber'))               as dv_mov_utilizado,
    sum(valor) filter (where tipo_despesa = 'variavel' and status = 'provisionado')             as dv_mov_provisionado,
    -- Realizado × provisionado (0061)
    sum(valor) filter (where status = 'recebido'
                          or (status = 'resgatado' and conta_fluxo and conta_tipo = 'corrente')) as ent_realizado,
    sum(valor) filter (where status = 'a_receber'
                          or (status in ('resgate','a_resgatar') and conta_fluxo and conta_tipo = 'corrente')) as ent_provisionado,
    sum(valor) filter (where status in ('pago','repassado','aplicado')
                          or (status = 'resgatado' and conta_fluxo and conta_tipo = 'investimento')) as sai_realizado,
    sum(valor) filter (where status in ('provisionado','a_pagar','provisionado_dv','provisionado_dl',
                                        'a_repassar','a_aplicar','aplicacao')
                          or (status in ('resgate','a_resgatar') and conta_fluxo and conta_tipo = 'investimento')) as sai_provisionado
  from lanc
  group by mes_referencia
),
contas as (
  select mes_referencia,
         sum(saldo_final) filter (where compoe_fluxo_caixa) as saldo_contas_fluxo,
         sum(saldo_final)                                   as saldo_todas_contas
    from public.v_fluxo_caixa_contas
   group by mes_referencia
),
linhas as (
  select m.mes_referencia,
         coalesce(p.saldo_inicial, 0)                                                      as saldo_inicial,
         coalesce(p.vendas, 0)                                                             as vendas,
         coalesce(p.resgates_entrada, 0)                                                   as resgates_entrada,
         coalesce(p.recebimentos, 0) - coalesce(p.vendas, 0)                               as outras_entradas,
         coalesce(p.despesas_brutas, 0) - coalesce(p.despesas_obra, 0) - coalesce(p.transferencias, 0) as despesas_aramburu,
         coalesce(p.distribuicao_lucro, 0)                                                 as distribuicao_lucro,
         coalesce(p.despesas_obra, 0)                                                      as despesas_obra,
         coalesce(p.aplicacoes, 0)                                                         as aplicacoes,
         coalesce(p.resgates_saida, 0)                                                     as resgates_saida,
         coalesce(p.transferencias, 0)                                                     as transferencias,
         coalesce(c.saldo_contas_fluxo, 0)                                                 as saldo_contas_fluxo,
         coalesce(c.saldo_todas_contas, 0)                                                 as saldo_todas_contas,
         public.fn_dv_limite_mensal()                                                      as dv_limite,
         -coalesce(p.dv_mov_utilizado, 0)                                                  as dv_utilizado,
         -coalesce(p.dv_mov_provisionado, 0)                                               as dv_provisionado,
         coalesce(p.saldo_inicial, 0) + coalesce(p.ent_realizado, 0)                       as entradas_realizadas,
         coalesce(p.ent_provisionado, 0)                                                   as entradas_provisionadas,
         coalesce(p.sai_realizado, 0)                                                      as saidas_realizadas,
         coalesce(p.sai_provisionado, 0)                                                   as saidas_provisionadas
    from meses m
    left join por_mes p using (mes_referencia)
    left join contas  c using (mes_referencia)
),
calc as (
  select l.*,
         saldo_inicial + vendas + resgates_entrada + outras_entradas                                        as entradas,
         despesas_aramburu + distribuicao_lucro + despesas_obra + aplicacoes + resgates_saida + transferencias as saidas
    from linhas l
)
select
  mes_referencia,
  saldo_inicial::numeric(15,2),
  vendas::numeric(15,2),
  resgates_entrada::numeric(15,2),
  outras_entradas::numeric(15,2),
  entradas::numeric(15,2),
  despesas_aramburu::numeric(15,2),
  distribuicao_lucro::numeric(15,2),
  despesas_obra::numeric(15,2),
  aplicacoes::numeric(15,2),
  resgates_saida::numeric(15,2),
  transferencias::numeric(15,2),
  saidas::numeric(15,2),
  (entradas + saidas)::numeric(15,2)                                                          as resultado,
  saldo_contas_fluxo::numeric(15,2),
  -- Linha 43: saldo final das contas do fluxo + o que o mês seguinte já tem de
  -- certo (saídas, outras entradas e resgates) — SEM vendas. Dezembro fecha o
  -- ano: não olha janeiro do ano seguinte (0065), então dezembro = saldo final.
  (saldo_contas_fluxo
    + coalesce(lead(saidas + outras_entradas + resgates_entrada)
               over (partition by left(mes_referencia, 4) order by mes_referencia), 0))::numeric(15,2)
                                                                                             as saldo_menos_proximo_mes,
  saldo_todas_contas::numeric(15,2),
  dv_limite::numeric(15,2),
  dv_utilizado::numeric(15,2),
  dv_provisionado::numeric(15,2),
  (dv_limite - dv_utilizado - dv_provisionado)::numeric(15,2)                                  as dv_saldo,
  entradas_realizadas::numeric(15,2),
  entradas_provisionadas::numeric(15,2),
  saidas_realizadas::numeric(15,2),
  saidas_provisionadas::numeric(15,2)
from calc;

revoke all on public.v_fluxo_caixa_planilha from anon;

-- v_obra_resumo_atual — fonte da 0008 (vigente). Troca: '2.7.2' → obra.
create or replace view public.v_obra_resumo_atual
with (security_invoker = true) as
with base as (
  select
    obs_obra,
    status,
    sum(-valor) as valor   -- negativo na transação = saída → positivo aqui
  from public.transacoes_empresa
  where centro_custo_cod = (select public.fn_cod('obra'))
  group by obs_obra, status
)
select
  obs_obra::text as bucket,
  status::text   as status,
  valor
from base
order by 1, 2;

revoke all on public.v_obra_resumo_atual from anon;

-- v_obra_totais — fonte da 0008 (vigente). Troca: '2.7.2' → obra.
create or replace view public.v_obra_totais
with (security_invoker = true) as
select
  sum(case when status = 'pago'         and obs_obra in ('ordem_compra','projeto') then -valor else 0 end) as pago_oc_projeto,
  sum(case when status = 'pago'         and obs_obra::text like 'medicao_%'              then -valor else 0 end) as pago_medicoes,
  sum(case when status = 'pago'         and obs_obra = 'outras'                    then -valor else 0 end) as pago_outras,
  sum(case when status = 'a_pagar'      and obs_obra = 'outras'                    then -valor else 0 end) as a_pagar_outras,
  sum(case when status = 'provisionado' and obs_obra::text like 'medicao_%'              then -valor else 0 end) as provisionado_medicoes,
  sum(case when status = 'provisionado' and obs_obra = 'outras'                    then -valor else 0 end) as provisionado_outras,
  sum(case when status = 'provisionado' and obs_obra = 'retencao'                  then -valor else 0 end) as provisionado_retencao
from public.transacoes_empresa
where centro_custo_cod = (select public.fn_cod('obra'));

revoke all on public.v_obra_totais from anon;

-- v_fluxo_caixa_mensal — fonte da 0032 (vigente). Troca: '1.2%' → receita_parceria || '%' (2×, mesmo padrão LIKE de antes).
create or replace view public.v_fluxo_caixa_mensal
with (security_invoker = true) as
with por_mes as (
  select
    te.mes_referencia,
    -- Saldo disponível: SÓ contas-corrente (igual à planilha — investimentos ficam
    -- de fora; o dinheiro investido entra de volta via "resgate" do próximo mês).
    coalesce(sum(te.valor) filter (where te.status in
      ('saldo_inicial','recebido','pago','repassado','aplicado','aplicacao','resgatado','resgate')
      and cbe.tipo = 'corrente'), 0)                                                   as movimento_realizado,
    -- Saídas do mês (todas as contas): realizadas + provisionadas + a pagar — negativas
    coalesce(sum(te.valor) filter (where te.status in
      ('provisionado','provisionado_dv','provisionado_dl','a_pagar','a_repassar','a_aplicar','pago','repassado','aplicado','aplicacao')), 0) as saidas_mes,
    -- Resgates de investimento (entradas "certas" que caem na conta-corrente)
    coalesce(sum(te.valor) filter (where te.status in ('resgate','a_resgatar','resgatado')), 0) as resgate_mes,
    -- Outras entradas = a receber/recebido que NÃO são vendas (conta 1.2)
    coalesce(sum(te.valor) filter (where te.status in ('a_receber','recebido') and te.conta_contabil_cod not like ((select public.fn_cod('receita_parceria')) || '%')), 0) as outros_entradas_mes,
    -- Vendas (conta 1.2) — excluídas do indicador de próximo mês
    coalesce(sum(te.valor) filter (where te.status in ('a_receber','recebido') and te.conta_contabil_cod like ((select public.fn_cod('receita_parceria')) || '%')), 0) as vendas_mes
  from public.transacoes_empresa te
  left join public.contas_bancarias_empresa cbe on cbe.id = te.conta_bancaria_id
  where te.mes_referencia is not null
  group by te.mes_referencia
),
acc as (
  select
    *,
    sum(movimento_realizado) over (order by mes_referencia rows between unbounded preceding and current row) as saldo_final_acumulado
  from por_mes
)
select
  mes_referencia,
  saldo_final_acumulado,
  saidas_mes,
  resgate_mes,
  outros_entradas_mes,
  vendas_mes,
  coalesce(lead(saidas_mes) over (order by mes_referencia), 0)                         as saidas_proximo_mes,
  coalesce(lead(resgate_mes + outros_entradas_mes) over (order by mes_referencia), 0)  as entradas_garantidas_proximo_mes,
  saldo_final_acumulado
    + coalesce(lead(saidas_mes + resgate_mes + outros_entradas_mes) over (order by mes_referencia), 0) as saldo_menos_proximo_mes
from acc
order by mes_referencia;

revoke all on public.v_fluxo_caixa_mensal from anon;

-- ---------------------------------------------------------------------------
-- 8) Conferência final (qualquer falha aqui desfaz a migration inteira)
-- ---------------------------------------------------------------------------
do $$
declare
  v_msg text;
begin
  -- Views que não eram a vigente só passam se já eram exatamente a da 0066.
  select string_agg(w.view_nome, ', ' order by w.view_nome) into v_msg
    from _m0066_views w
   where not w.vigente
     and w.def_antes is distinct from pg_get_viewdef(to_regclass('public.' || w.view_nome), true);
  if v_msg is not null then
    raise exception '0066 NÃO aplicada — nada foi alterado. A definição atual da(s) view(s) % não é a vigente (0008/0032/0065) nem a da 0066: alguém mudou fora das migrations. Envie esta mensagem ao suporte antes de seguir.', v_msg;
  end if;

  -- O papel precisa acompanhar a troca de código e barrar a exclusão.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.classificacao_papel'::regclass
       and conname = 'classificacao_papel_codigo_fkey'
       and confupdtype = 'c' and confdeltype = 'r'
  ) then
    raise exception '0066 NÃO aplicada — nada foi alterado. A FK classificacao_papel_codigo_fkey precisa ser ON UPDATE CASCADE / ON DELETE RESTRICT.';
  end if;

  if (select count(*) from public.classificacao_papel) < 28 then
    raise exception '0066 NÃO aplicada — nada foi alterado. classificacao_papel ficou com menos de 28 papéis.';
  end if;
end $$;

-- O SQL Editor mostra este resultado: cada papel, o código e o nome de hoje.
select p.papel,
       p.codigo,
       c.nome,
       c.ativo,
       (select count(*) from public.transacoes_empresa te
         where te.conta_contabil_cod = p.codigo or te.centro_custo_cod = p.codigo) as lancamentos,
       p.descricao
  from public.classificacao_papel p
  join public.classificacao_financeira c on c.codigo = p.codigo
 order by c.ordem nulls last, p.codigo;

-- ----------------------------------------------------------------------------
-- ROLLBACK (manual, numa transação só — só se precisar voltar ao modelo antigo)
--   0) Se algum código com papel já foi trocado, volte-o antes ao número
--      original (Configurações → Plano de Contas): os corpos antigos procuram
--      pelo número.
--   1) Recriar as definições vigentes (as mesmas que a seção 1 confere) —
--      só o create or replace de cada uma, copiado da migration de origem:
--        fn_validar_consistencia ........................ 0026
--        fn_concluir_repasse_dl ......................... 0044
--        tg_te_resgate_espelho_invest ................... 0045
--        fn_dl_readotar_orfa, fn_religar_sync_dl,
--        fn_sync_provisionado_dl ........................ 0052
--        fn_resgate_invest_obter(date, text),
--        fn_resgate_fatura_cartao_obter(date, text),
--        fn_resgate_prov_mensal_obter ................... 0053
--        fn_classificacao_trocar_codigo ................. 0057
--        fn_consolidar_repasse_dl, fn_dv_gerar_linha,
--        fn_classificacao_codigos_sistema ............... 0063
--        fn_resgate_invest_espelho_sync,
--        fn_resgate_invest_recalc ....................... 0064
--        v_fluxo_caixa_planilha ......................... 0065
--        v_obra_resumo_atual, v_obra_totais ............. 0008 (com "with (security_invoker = true)")
--        v_fluxo_caixa_mensal ........................... 0032 (com "with (security_invoker = true)")
--      e, para cada view, revoke all on public.<view> from anon;
--   2) drop function if exists public.fn_cod(text);
--      drop table if exists public.classificacao_papel;
--   3) Front: CODIGOS_DO_SISTEMA volta à lista de 28 (0063).
-- ----------------------------------------------------------------------------
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<< FIM DA 0066 <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- Conferência (é esta a tabela que o SQL Editor mostra)
select x.item as conferencia,
       x.valor,
       case when x.ok then 'OK' else 'VERIFICAR' end as situacao
  from (
    select 1 as ordem, 'Papéis cadastrados (esperado 28)' as item, count(*)::text as valor, count(*) = 28 as ok
      from public.classificacao_papel
    union all
    select 2, 'Papéis cujo código existe no Plano de Contas', count(*)::text, count(*) = 28
      from public.classificacao_papel p
      join public.classificacao_financeira c on c.codigo = p.codigo
    union all
    select 3, 'fn_cod: dv_saldo · dl · dl_lucros · resgate · obra · receita_parceria',
           public.fn_cod('dv_saldo') || ' · ' || public.fn_cod('dl') || ' · ' || public.fn_cod('dl_lucros') || ' · '
             || public.fn_cod('resgate') || ' · ' || public.fn_cod('obra') || ' · ' || public.fn_cod('receita_parceria'),
           true
    union all
    select 4, 'Códigos travados no Plano de Contas (esperado {1,2})',
           public.fn_classificacao_codigos_sistema()::text,
           public.fn_classificacao_codigos_sistema() = array['1', '2']
    union all
    select 5, 'Lançamentos: quantidade antes → depois', a.lancamentos || ' → ' || d.qtd, a.lancamentos = d.qtd
      from _seco_antes a, (select count(*) as qtd from public.transacoes_empresa) d
    union all
    select 6, 'Lançamentos: soma antes → depois', a.soma || ' → ' || d.soma, a.soma = d.soma
      from _seco_antes a, (select coalesce(sum(valor), 0) as soma from public.transacoes_empresa) d
    union all
    select 7, 'Gatilhos de transacoes_empresa (mesmos nomes e modos)', d.gatilhos, a.gatilhos = d.gatilhos
      from _seco_antes a,
           (select string_agg(tgname || '=' || tgenabled::text, ', ' order by tgname) as gatilhos
              from pg_trigger
             where tgrelid = 'public.transacoes_empresa'::regclass and not tgisinternal) d
    union all
    select 8, 'Funções/views com código do plano escrito no corpo (esperado 0)',
           coalesce(string_agg(z.objeto || ' ' || z.literal, ', '), '0'), count(*) = 0
      from (
        select p.proname::text as objeto, m[1] as literal
          from pg_proc p,
               lateral regexp_matches(p.prosrc, '''([12](\.[0-9]+){1,2})%?''', 'g') as m
         where p.pronamespace = 'public'::regnamespace
           and exists (select 1 from public.classificacao_financeira f where f.codigo = m[1])
        union all
        select c.relname::text, m[1]
          from pg_class c,
               lateral regexp_matches(pg_get_viewdef(c.oid), '''([12](\.[0-9]+){1,2})%?''', 'g') as m
         where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')
           and exists (select 1 from public.classificacao_financeira f where f.codigo = m[1])
      ) z
    union all
    select 9, 'fn_cod devolve o código de cada um dos 28 papéis', count(*)::text, count(*) = 28
      from public.classificacao_papel p where public.fn_cod(p.papel) = p.codigo
    union all
    select 10, 'Fluxo de Caixa (v_fluxo_caixa_planilha): mesmos valores antes e depois', d.h, a.h_planilha = d.h
      from _seco_antes a, (select md5(string_agg(v::text, ',' order by v::text)) as h from public.v_fluxo_caixa_planilha v) d
    union all
    select 11, 'Saldos por conta (v_fluxo_caixa_contas): mesmos valores antes e depois', d.h, a.h_contas = d.h
      from _seco_antes a, (select md5(string_agg(v::text, ',' order by v::text)) as h from public.v_fluxo_caixa_contas v) d
    union all
    select 12, 'Fluxo mensal antigo (v_fluxo_caixa_mensal): mesmos valores antes e depois', d.h, a.h_mensal = d.h
      from _seco_antes a, (select md5(string_agg(v::text, ',' order by v::text)) as h from public.v_fluxo_caixa_mensal v) d
    union all
    select 13, 'Obra (v_obra_resumo_atual + v_obra_totais): mesmos valores antes e depois', d1.h || ' · ' || d2.h, a.h_obra_resumo = d1.h and a.h_obra_totais = d2.h
      from _seco_antes a,
           (select md5(string_agg(v::text, ',' order by v::text)) as h from public.v_obra_resumo_atual v) d1,
           (select md5(string_agg(v::text, ',' order by v::text)) as h from public.v_obra_totais v) d2
  ) x
 order by x.ordem;

rollback;
