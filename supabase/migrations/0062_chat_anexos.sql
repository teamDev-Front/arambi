-- ============================================================================
-- 0062 — Anexos (PDF e imagem) no chat dos Assistentes IA
-- ============================================================================
-- Pedido (reunião de 20-out-2026): "Habilite o envio de documentos aos
-- assistentes para análise" — anexar contratos em PDF (e imagens) no chat
-- para o assistente ler, analisar e comparar.
--
-- Fluxo (o arquivo NÃO passa pela API do site — o corpo das Functions da
-- Vercel é limitado a 4,5 MB):
--   1) o navegador pede a /api/assistentes/anexos um token de upload; o
--      servidor confere login + módulo Assistentes, tipo e tamanho, e monta o
--      caminho <id do usuário>/<uuid>-<nome>.<ext>;
--   2) o navegador sobe o arquivo direto para o Storage com esse token
--      (uploadToSignedUrl);
--   3) /api/assistentes/chat recebe só os metadados, confere que o caminho é
--      da pasta do próprio usuário, baixa com a service role e manda ao
--      provedor (Gemini/OpenAI) em base64.
--
-- Bucket PRIVADO `chat-anexos`: até 10 MB por arquivo, só PDF/PNG/JPEG/WEBP
-- (o Storage recusa o resto no upload). NENHUMA política para usuários em
-- storage.objects — de propósito: com a chave pública ninguém lista, baixa
-- ou sobe nada nesse bucket. Subir só com o token emitido pelo servidor; ler
-- só pelo servidor (service role). O link "abrir anexo" do chat é uma signed
-- URL de 10 min que a rota só emite para o dono do arquivo.
--
-- chat_mensagens.anexos (jsonb, existe desde a 0007 e estava sem uso) passa a
-- guardar, na mensagem do USUÁRIO, a lista dos arquivos (até 3; null = sem
-- anexo):
--   [{"path":    "<uuid do usuário>/<uuid>-contrato-arrendamento.pdf",
--     "nome":    "Contrato Arrendamento.pdf",
--     "mime":    "application/pdf",       -- application/pdf | image/png | image/jpeg | image/webp
--     "tamanho": 482113}]                  -- bytes
-- Linhas antigas podem ter outro formato (métricas de antes da 0020): o app
-- ignora o que não for lista nesse formato.
--
-- O RLS de chat_mensagens NÃO muda (qualquer usuário ativo lê as conversas;
-- só o dono escreve): os metadados ficam visíveis como o resto da conversa,
-- o ARQUIVO não — as rotas só abrem/baixam caminhos da pasta de quem pede.
--
-- Não depende de migration nova. Aplicar no SQL Editor. Idempotente
-- (reaplicar só reafirma privado/limite/tipos do bucket). Sem custo para o
-- resto do sistema: nenhuma tabela/view/política existente é alterada.

-- ---------------------------------------------------------------------------
-- 1) Bucket privado chat-anexos
-- ---------------------------------------------------------------------------
-- Em bloco próprio: se o papel que roda a migration não puder gravar em
-- storage.buckets, segue com aviso — a conferência do fim decide se aborta.
do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'chat-anexos',
    'chat-anexos',
    false,
    10485760,                                                       -- 10 MB
    array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
  )
  on conflict (id) do update
     set public             = excluded.public,
         file_size_limit    = excluded.file_size_limit,
         allowed_mime_types = excluded.allowed_mime_types;
exception
  when insufficient_privilege then
    raise notice '0062: sem permissão para gravar em storage.buckets pelo SQL — confira o bucket pelo painel (Storage).';
end $$;

-- ---------------------------------------------------------------------------
-- 2) Documenta o formato de chat_mensagens.anexos
-- ---------------------------------------------------------------------------
comment on column public.chat_mensagens.anexos is
  'Anexos da mensagem do usuário (migration 0062): [{path, nome, mime, tamanho}] — até 3; path = <uuid do usuário>/<uuid>-<nome>.<ext> no bucket privado chat-anexos; mime application/pdf|image/png|image/jpeg|image/webp; tamanho em bytes (≤ 10 MB). null = sem anexo.';

-- ---------------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------------
-- O bucket TEM de existir e ser privado — senão aborta (nada é aplicado).
do $$
declare b record;
begin
  select public, file_size_limit, allowed_mime_types
    into b
    from storage.buckets
   where id = 'chat-anexos';
  if not found then
    raise exception '0062: o bucket chat-anexos não existe. Crie pelo painel (Storage → New bucket): nome chat-anexos, PRIVADO, limite 10 MB, tipos application/pdf, image/png, image/jpeg, image/webp — e rode esta migration de novo.';
  end if;
  if b.public then
    raise exception '0062: o bucket chat-anexos está PÚBLICO. Desmarque "Public bucket" no painel (Storage → chat-anexos → Edit bucket) e rode esta migration de novo.';
  end if;
  raise notice '0062 · bucket chat-anexos: privado, limite % bytes, tipos %', b.file_size_limit, b.allowed_mime_types;
end $$;

-- Política em storage.objects que não filtra bucket_id valeria TAMBÉM para o
-- chat-anexos (ex.: "autenticado lê tudo" criada pelo painel). Só avisa.
do $$
declare r record;
begin
  for r in
    select policyname, cmd
      from pg_policies
     where schemaname = 'storage'
       and tablename  = 'objects'
       and coalesce(qual, '')       not like '%bucket_id%'
       and coalesce(with_check, '') not like '%bucket_id%'
  loop
    raise warning '0062: a política "%" (%) em storage.objects não filtra bucket_id — ela também abriria o chat-anexos. Revise em Storage → Policies.', r.policyname, r.cmd;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- ROLLBACK (manual):
--   • o app volta a ser só texto tirando o clipe do ChatPage e as rotas
--     /api/assistentes/anexos e o campo `anexos` de /api/assistentes/chat;
--   • esvaziar e apagar o bucket PELO PAINEL (Storage → chat-anexos → Empty
--     bucket → Delete bucket) — apagar linhas de storage.objects pelo SQL não
--     remove os arquivos guardados;
--   • (opcional) update public.chat_mensagens set anexos = null
--       where jsonb_typeof(anexos) = 'array';
--   • comment on column public.chat_mensagens.anexos is null;
-- ----------------------------------------------------------------------------
