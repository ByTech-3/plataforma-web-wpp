-- ============================================================================
--  BYTECH3 — PLATAFORMA WEB (CRM + WhatsApp)
--  FASE 6 — REGISTRO DE ENVIO DE MENSAGEM
--  Arquivo: supabase/migrations/0004_fase6_envio_de_mensagem.sql
--
--  COMO RODAR:
--    Supabase Dashboard > SQL Editor > cole este arquivo inteiro > Run.
--    O script é IDEMPOTENTE: pode ser rodado mais de uma vez sem quebrar.
--
--  POR QUE ELE EXISTE:
--    O vocabulário de eventos da 0002 tem `message.received`, mas não tem
--    `message.sent` — o check de `activities.tipo` recusa qualquer outro valor.
--    Sem esta migration, registrar o envio falharia com violação de check.
--
--  O QUE ELE NÃO FAZ:
--    Nenhuma tabela nova. Nenhuma coluna de texto. O CONTEÚDO da mensagem não
--    é gravado em lugar nenhum — nem aqui, nem em `activities.dados`. O que
--    fica registrado é que uma mensagem foi enviada, para qual lead, por quem
--    e quando. Guardar conversa de cliente de terceiros é responsabilidade
--    jurídica que este produto não tem motivo para assumir (briefing §2.1 e §9).
-- ============================================================================


-- ============================================================================
-- PASSO 1 — VOCABULÁRIO DE EVENTOS: ACRESCENTA `message.sent`
-- ============================================================================
-- O check é recriado inteiro porque não há como "acrescentar um valor" a um
-- check existente. A lista abaixo é a da 0002 mais o evento novo — se algum
-- valor sumir daqui, o histórico antigo continua no banco, mas eventos novos
-- daquele tipo passam a ser recusados.

alter table public.activities drop constraint if exists activities_tipo_valido;

alter table public.activities
  add constraint activities_tipo_valido check (
    tipo in (
      'lead.created',
      'lead.updated',
      'lead.assigned',
      'lead.archived',
      'lead.restored',
      'lead.stage_changed',
      'lead.pipeline_added',
      'lead.pipeline_removed',
      'tag.added',
      'tag.removed',
      'note.created',
      'task.created',
      'task.completed',
      'task.overdue',
      'message.received',
      'message.sent',          -- NOVO nesta migration
      'appointment.created'
    )
  );

comment on constraint activities_tipo_valido on public.activities is
  'Vocabulário fechado de eventos. Os mesmos nomes servem de gatilho no n8n, sem tradução no meio do caminho.';


-- ============================================================================
-- PASSO 2 — VERIFICAÇÃO (rode e confira os resultados)
-- ============================================================================

-- 2.1 — `message.sent` está no check? (esperado: t)
select pg_get_constraintdef(oid) like '%message.sent%' as aceita_message_sent
  from pg_constraint
 where conname = 'activities_tipo_valido';

-- 2.2 — A tabela continua sem coluna de conteúdo de mensagem (esperado: 0).
select count(*) as colunas_de_conteudo
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'activities'
   and column_name ~* 'mensagem|message|texto|conteudo|corpo|preview';

-- 2.3 — `activities` segue sem policy de UPDATE ou DELETE (esperado: 0).
--       Histórico que pode ser reescrito não serve de histórico.
select count(*) as policies_de_escrita_indevida
  from pg_policies
 where schemaname = 'public'
   and tablename = 'activities'
   and cmd in ('UPDATE', 'DELETE');
