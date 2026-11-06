-- ============================================================================
-- 0071 — Configurações e Acessos deixam de ser exclusivos do Super Admin
-- ============================================================================
-- Pedido do Luiz (06-nov-2026): o admin precisa poder atribuir estes dois módulos a
-- outros usuários na tela Acessos.
--
-- Acessos não precisa de nada aqui: toda escrita em public.users passa pelas rotas
-- /api/acessos (service role), e é lá que ficam as regras de delegação. A coluna
-- users.permissoes já aceita qualquer chave (fn_permissoes_validas só olha o nível).
--
-- Configurações grava direto pelo client, sob RLS, em quatro tabelas e duas RPCs
-- que só aceitavam admin. Passam a aceitar quem edita o módulo. Só amplia: para o
-- Super Admin nada muda (fn_pode_editar_modulo é true para ele), e usuário bloqueado
-- continua de fora (a função exige perfil ativo). A leitura dessas tabelas não muda.

begin;

-- ---------------------------------------------------------------------------
-- 1) Tabelas das abas de Configurações
-- ---------------------------------------------------------------------------
drop policy if exists classificacao_financeira_admin on public.classificacao_financeira;
drop policy if exists classificacao_financeira_write on public.classificacao_financeira;
create policy classificacao_financeira_write on public.classificacao_financeira
  for all
  using      ((select public.fn_pode_editar_modulo('configuracoes')))
  with check ((select public.fn_pode_editar_modulo('configuracoes')));

drop policy if exists status_config_admin on public.status_config;
drop policy if exists status_config_write on public.status_config;
create policy status_config_write on public.status_config
  for all
  using      ((select public.fn_pode_editar_modulo('configuracoes')))
  with check ((select public.fn_pode_editar_modulo('configuracoes')));

drop policy if exists colaboradores_admin on public.colaboradores;
drop policy if exists colaboradores_write on public.colaboradores;
create policy colaboradores_write on public.colaboradores
  for all
  using      ((select public.fn_pode_editar_modulo('configuracoes')))
  with check ((select public.fn_pode_editar_modulo('configuracoes')));

drop policy if exists app_config_write on public.app_config;
create policy app_config_write on public.app_config
  for all
  using      ((select public.fn_pode_editar_modulo('configuracoes')))
  with check ((select public.fn_pode_editar_modulo('configuracoes')));

-- ---------------------------------------------------------------------------
-- 2) RPCs das abas: troca SÓ a guarda, sem recopiar o corpo
-- ---------------------------------------------------------------------------
-- fn_classificacao_trocar_codigo tem cerca de 200 linhas e já foi reescrita pela 0066.
-- Recopiar aqui arriscaria desfazer algo; por isso o texto vem do próprio banco. Se a
-- guarda não for encontrada, a migration inteira falha em vez de aplicar pela metade.
do $$
declare
  v_troca record;
  v_def   text;
  v_novo  text;
begin
  for v_troca in
    select * from (values
      ('public.fn_status_add(text, text, text, text, text, int)'::regprocedure,
       'if not public.fn_is_admin() then',
       'Apenas administradores podem adicionar status',
       'Apenas quem edita Configurações pode adicionar status'),
      ('public.fn_classificacao_trocar_codigo(text, text)'::regprocedure,
       'if not coalesce(public.fn_is_admin(), false) then',
       'Apenas administradores podem alterar o código de uma classificação.',
       'Apenas quem edita Configurações pode alterar o código de uma classificação.')
    ) as t(funcao, guarda, msg_antiga, msg_nova)
  loop
    v_def := pg_get_functiondef(v_troca.funcao);
    -- Já aplicada: rodar de novo não muda nada.
    continue when position('fn_pode_editar_modulo(''configuracoes'')' in v_def) > 0;
    if position(v_troca.guarda in v_def) = 0 or position(v_troca.msg_antiga in v_def) = 0 then
      raise exception '0071: guarda não encontrada em %. Nada foi aplicado.', v_troca.funcao;
    end if;
    v_novo := replace(v_def, v_troca.guarda, 'if not public.fn_pode_editar_modulo(''configuracoes'') then');
    v_novo := replace(v_novo, v_troca.msg_antiga, v_troca.msg_nova);
    execute v_novo;
  end loop;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- Conferência depois de aplicar (deve listar 4 políticas e 2 funções):
--   select tablename, policyname from pg_policies
--    where schemaname = 'public'
--      and qual like '%fn_pode_editar_modulo(''configuracoes''%';
--   select proname from pg_proc
--    where proname in ('fn_status_add', 'fn_classificacao_trocar_codigo')
--      and prosrc like '%fn_pode_editar_modulo(''configuracoes'')%';
--
-- Reverter: recriar as 4 políticas com fn_is_admin() (nomes *_admin, e app_config_write)
-- e trocar a guarda das 2 RPCs de volta. Antes, retirar os módulos de quem os recebeu.
-- ---------------------------------------------------------------------------
