-- ============================================================================
-- 0052 — Distribuição de Lucro: a sincronização do Provisionado não pode mais
--        travar em silêncio (retorno da Adriane, 11-ago-2026)
-- ============================================================================
-- SINTOMA: "a partir do momento que estou consolidando um novo repasse, ele não
-- está debitando do provisionado no financeiro". Em 11-ago:
--   • Financeiro, Provisionado DL ....... R$ 2.579,27  (congelado)
--   • Detalhado por sócio, provisionado .. R$ 1.718,36  (valor correto)
--
-- DIAGNÓSTICO (produção): a linha global de ago/2026 —
--   id 87e321a2-ec60-4505-bad8-e14b990c8c9a
--   "Distribuição de Lucro — Provisionado (automático do detalhado)"
--   conta 2.8 / centro 2.8.1 / status provisionado_dl / valor -2.579,27
-- estava com `origem_planilha` NULO desde 03-ago (updated_at 2026-08-03 19:46,
-- sem nenhuma escrita depois). Sem a etiqueta `dl_auto:2026-08`, o guard de
-- fn_sync_provisionado_dl a lê como "provisionado manual" e desiste do mês —
-- para sempre e sem avisar ninguém. Resíduo do bug de origem_planilha corrigido
-- em 03-ago (src/lib/queries/preservar-origem.ts), não uma reincidência: nada
-- escreveu na linha desde então.
--
-- O problema de fundo é de PROJETO, não daquele bug: a identidade da linha
-- automática mora num único campo de texto, qualquer escrita que o zere é
-- irreversível pela interface, e a falha resultante é silenciosa. Esta migration
-- ataca as três pontas:
--
--   1. TRAVA no banco: UPDATE não pode mais apagar uma etiqueta existente.
--      Vale para qualquer caminho de escrita (app, script, SQL manual) — a
--      proteção deixa de depender de disciplina no front.
--   2. AUTOCURA: fn_sync_provisionado_dl readota a linha órfã que ela mesma
--      criou (reconhecida pela descrição/observação que só ela escreve) em vez
--      de tratá-la como manual.
--   3. BOTÃO: fn_religar_sync_dl(mes) para a tela oferecer "religar
--      sincronização" quando a linha for genuinamente manual — hoje o aviso
--      manda a Lola "ajustar no Financeiro", coisa que ela não tem como fazer
--      (a etiqueta é interna).
--
-- Não altera valor de lançamento nenhum por conta própria: a autocura só
-- devolve a etiqueta e deixa o SOMASE fazer o que sempre fez.

-- ---------------------------------------------------------------------------
-- 1) Trava: UPDATE nunca apaga procedência
-- ---------------------------------------------------------------------------
-- Regra: não-nulo → nulo é ignorado (mantém o valor antigo). Preencher uma
-- etiqueta que estava nula, ou trocar por outra não-nula, continua liberado —
-- é o que os reparos e as próprias RPCs fazem.
create or replace function public.tg_preserva_origem_planilha()
returns trigger
language plpgsql
as $$
begin
  if old.origem_planilha is not null and new.origem_planilha is null then
    new.origem_planilha := old.origem_planilha;
  end if;
  return new;
end;
$$;

comment on function public.tg_preserva_origem_planilha() is
  'BEFORE UPDATE: impede que uma etiqueta de procedência (origem_planilha) existente seja apagada. É ela que amarra dl_auto:, dl_repasse:, auto:resgate_invest: e venda_auto: — apagá-la desliga a automação sem avisar. Migration 0052.';

drop trigger if exists tg_te_preserva_origem on public.transacoes_empresa;
create trigger tg_te_preserva_origem
  before update on public.transacoes_empresa
  for each row execute function public.tg_preserva_origem_planilha();

drop trigger if exists tg_ts_preserva_origem on public.transacoes_socio;
create trigger tg_ts_preserva_origem
  before update on public.transacoes_socio
  for each row execute function public.tg_preserva_origem_planilha();

-- ---------------------------------------------------------------------------
-- 2) Autocura + guard mais esperto
-- ---------------------------------------------------------------------------
-- Texto exato que só fn_sync_provisionado_dl escreve. Serve de assinatura para
-- reconhecer a linha órfã: nenhum humano digita isso à mão.
create or replace function public.fn_dl_descricao_auto()
returns text
language sql
immutable
as $$ select 'Distribuição de Lucro — Provisionado (automático do detalhado)'::text $$;

-- Readota a linha automática órfã do mês (tag nula + descrição-assinatura).
-- Retorna o id readotado, ou null se não havia nada a readotar.
-- Conservadora: não faz nada se já existir linha com a tag do mês, e não toca em
-- linha com descrição diferente (essa é manual de verdade).
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
     and centro_custo_cod = '2.8.1'
     and status in ('provisionado', 'provisionado_dl')
     and origem_planilha is null
     and descricao = public.fn_dl_descricao_auto();

  if v_qtd <> 1 then return null; end if;   -- 0 = nada órfão; >1 = ambíguo, não adivinha

  update public.transacoes_empresa set origem_planilha = v_tag where id = v_id;
  return v_id;
end;
$$;

comment on function public.fn_dl_readotar_orfa(text) is
  'Devolve a etiqueta dl_auto:<mes> à linha global do Provisionado DL que perdeu a procedência, identificando-a pela descrição que só o SOMASE escreve. Não age se já houver linha etiquetada no mês ou se houver mais de uma candidata. Migration 0052.';

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

  if not exists (select 1 from public.classificacao_financeira where codigo = '2.8')
     or not exists (select 1 from public.classificacao_financeira where codigo = '2.8.1') then
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
      and centro_custo_cod = '2.8.1'
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
      to_date(p_mes || '-01', 'YYYY-MM-DD'), '2.8', '2.8.1', 'sem',
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
  'SOMASE da DL: mantém o global Provisionado DL (2.8/2.8.1) igual à soma do detalhado provisionado do mês. Bloqueado só por provisionado MANUAL no centro 2.8.1 (0047), e desde a 0052 readota sozinho a linha automática que tenha perdido a etiqueta.';

-- ---------------------------------------------------------------------------
-- 3) fn_religar_sync_dl — o botão da tela
-- ---------------------------------------------------------------------------
-- Para quando a linha divergente NÃO tem a descrição-assinatura (foi digitada
-- ou importada). Aqui a adoção é explícita: o usuário está dizendo "essa linha
-- é a global automática, passe a mantê-la". Ao contrário da autocura, exige que
-- exista exatamente uma candidata — com duas ou mais o sistema não escolhe.
-- Diferente das demais, esta função LEVANTA erro: quem clicou precisa saber.
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
     and centro_custo_cod = '2.8.1'
     and status in ('provisionado', 'provisionado_dl')
     and (origem_planilha is null or origem_planilha not like 'dl_auto:%');

  if v_qtd > 1 then
    raise exception 'Há % linhas provisionadas no centro 2.8.1 em % — deixe apenas uma no Financeiro e tente de novo.', v_qtd, p_mes;
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
     and centro_custo_cod = '2.8.1'
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
  'Religa a sincronização automática do Provisionado DL de um mês: adota a linha provisionada do centro 2.8.1 como a linha automática (etiqueta dl_auto:<mes>) e roda o SOMASE. Levanta erro se houver mais de uma candidata. Alimenta o botão do aviso de divergência da tela de Distribuição de Lucro. Migration 0052.';

-- ---------------------------------------------------------------------------
-- 4) Reparo: readota as órfãs de todos os meses e ressincroniza
-- ---------------------------------------------------------------------------
-- Idempotente. Resolve ago/2026 (a linha de -2.579,27 volta a valer -1.718,36)
-- e qualquer outro mês em que a etiqueta tenha se perdido pelo mesmo motivo.
do $$
declare v_mes text;
begin
  for v_mes in
    select distinct mes_referencia from public.transacoes_socio where mes_referencia is not null
    union
    select distinct mes_referencia from public.transacoes_empresa
     where centro_custo_cod = '2.8.1' and mes_referencia is not null
  loop
    perform public.fn_dl_readotar_orfa(v_mes);
    perform public.fn_sync_provisionado_dl(v_mes);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- ROLLBACK:
--   drop trigger if exists tg_te_preserva_origem on public.transacoes_empresa;
--   drop trigger if exists tg_ts_preserva_origem on public.transacoes_socio;
--   drop function if exists public.tg_preserva_origem_planilha();
--   drop function if exists public.fn_religar_sync_dl(text);
--   drop function if exists public.fn_dl_readotar_orfa(text);
--   drop function if exists public.fn_dl_descricao_auto();
--   -- restaurar fn_sync_provisionado_dl da migration 0047.
-- ----------------------------------------------------------------------------
