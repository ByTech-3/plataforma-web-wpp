-- ============================================================================
--  BYTECH3 — PLATAFORMA WEB (CRM + WhatsApp)
--  FASE 5 — INBOX DE CONVERSAS + CHECAGEM DE DUPLICIDADE
--  Arquivo: supabase/migrations/0003_fase5_inbox_e_duplicidade.sql
--
--  COMO RODAR:
--    Supabase Dashboard > SQL Editor > cole este arquivo inteiro > Run.
--    O script é IDEMPOTENTE: pode ser rodado mais de uma vez sem quebrar.
--
--  O QUE ESTE ARQUIVO FAZ:
--    1) Cria `whatsapp_conversas` — a Inbox: o MÍNIMO para identificar e
--       ordenar as conversas recentes que a extensão captura.
--    2) Cria as funções de telefone (`so_digitos`, `mesmo_telefone`) que
--       passam a ser a regra ÚNICA de "é a mesma pessoa" no banco.
--    3) Cria `situacao_por_contato()` — responde se um contato já é lead,
--       inclusive quando ele está na carteira de OUTRO vendedor, SEM revelar
--       nome, telefone, histórico ou de quem é.
--
--  O QUE ESTE ARQUIVO NÃO FAZ, DE PROPÓSITO:
--    NÃO guarda mensagens. Nenhuma. Não há coluna de texto de mensagem, nem
--    de prévia, nem de contagem de não lidas. A Inbox precisa saber QUEM é a
--    conversa e QUANDO ela apareceu na lista — nada além disso. Guardar
--    conversa de WhatsApp de cliente é responsabilidade jurídica que este
--    produto não tem motivo para assumir.
-- ============================================================================


-- ============================================================================
-- PASSO 1 — TELEFONE: UMA REGRA SÓ, NO BANCO
-- ============================================================================
-- Hoje a comparação de telefone vive na extensão (TypeScript). Duas regras
-- para a mesma pergunta divergem no primeiro ajuste — e "é a mesma pessoa?"
-- errado significa lead duplicado ou follow-up para o número errado.
--
-- A regra: compara pelo FIM, até 11 dígitos, exigindo pelo menos 8.
--   Pelo fim  -> absorve +55, DDD e máscara: "5511987654321" e
--                "(11) 98765-4321" são a mesma linha.
--   Até 11    -> impede o falso positivo clássico: "11 98765-4321" e
--                "21 98765-4321" são estados diferentes, não a mesma pessoa.
--   Mínimo 8  -> número curto demais não identifica ninguém.

create or replace function public.so_digitos(p_texto text)
returns text
language sql
immutable
parallel safe
as $fn$
  select regexp_replace(coalesce(p_texto, ''), '\D', '', 'g')
$fn$;

comment on function public.so_digitos(text) is
  'Remove tudo que não é dígito. Base da comparação de telefones.';

create or replace function public.mesmo_telefone(p_a text, p_b text)
returns boolean
language sql
immutable
parallel safe
as $fn$
  select case
    when length(public.so_digitos(p_a)) < 8 or length(public.so_digitos(p_b)) < 8
      then false
    else right(
           public.so_digitos(p_a),
           least(length(public.so_digitos(p_a)), length(public.so_digitos(p_b)), 11)
         )
       = right(
           public.so_digitos(p_b),
           least(length(public.so_digitos(p_a)), length(public.so_digitos(p_b)), 11)
         )
  end
$fn$;

comment on function public.mesmo_telefone(text, text) is
  'Dois telefones são a mesma linha? Compara pelo fim, até 11 dígitos, mínimo 8.';

-- LIMITAÇÃO CONHECIDA, e ela é real: telefone gravado no formato antigo, sem
-- o nono dígito ("11 8765-4321"), NÃO casa com o que o WhatsApp entrega hoje
-- ("11 98765-4321"). São 10 dígitos contra 11 e não há como decidir, sem
-- adivinhar, se é a mesma linha. Preferimos o falso negativo (lead duplicado,
-- que alguém percebe e junta) ao falso positivo (dois clientes virando um).


-- ============================================================================
-- PASSO 2 — INBOX: CONVERSAS RECENTES DO WHATSAPP
-- ============================================================================
-- POR QUE A CONVERSA É DO VENDEDOR, E NÃO DA ORGANIZAÇÃO:
--   O WhatsApp é da pessoa. A lista de conversas recentes dela inclui o
--   fornecedor, o médico e o grupo da família. A regra de carteira existe para
--   leads — que são da empresa —, e não pode ser esticada para transformar o
--   gestor em leitor da lista de conversas pessoais do time.
--
--   Por isso a RLS aqui é mais restrita que a dos leads: cada um vê as
--   próprias conversas. Nem gestor, nem admin veem as dos outros.

create table if not exists public.whatsapp_conversas (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,

  -- Identificador da conversa. Quando a extensão consegue ler o JID do
  -- WhatsApp ("5511987654321@c.us"), é ele. Quando não consegue, é uma chave
  -- derivada do título — mais fraca, e por isso `origem_do_id` registra qual
  -- dos dois é, para ninguém tratar as duas com a mesma confiança.
  chat_id          text not null check (length(btrim(chat_id)) between 1 and 300),
  origem_do_id     text not null default 'titulo' check (origem_do_id in ('jid', 'titulo')),

  titulo           text check (titulo is null or length(titulo) <= 300),
  -- Só dígitos, e só quando lido com confiança. Nunca deduzido.
  telefone         text check (telefone is null or telefone ~ '^[0-9]{8,20}$'),
  eh_grupo         boolean not null default false,

  -- Ordem na lista do WhatsApp no momento da captura (0 = mais recente).
  -- É o que preserva "conversas recentes" sem guardar data de mensagem.
  posicao          int not null default 0 check (posicao >= 0),

  -- Preenchido quando a conversa vira lead. Não é obrigatório: conversa que
  -- nunca virou lead é o caso normal da Inbox.
  lead_id          uuid,

  capturado_em     timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),

  unique (organization_id, user_id, chat_id)
);

comment on table public.whatsapp_conversas is
  'Inbox: conversas recentes capturadas pela extensão. NÃO guarda mensagens — só quem é a conversa e em que ordem apareceu.';
comment on column public.whatsapp_conversas.origem_do_id is
  'De onde veio o chat_id: "jid" (identificador real do WhatsApp) ou "titulo" (chave derivada, mais fraca).';

-- O lead apontado tem que ser da MESMA organização. Mesma defesa em
-- profundidade das tabelas da fase 3: a FK composta recusa a mistura mesmo
-- que uma policy tivesse furo.
do $fk$
begin
  alter table public.whatsapp_conversas
    add constraint whatsapp_conversas_lead_fkey
    foreign key (lead_id, organization_id)
    references public.leads(id, organization_id) on delete set null;
exception when duplicate_object then null;
end
$fk$;

create index if not exists idx_conversas_do_usuario
  on public.whatsapp_conversas (organization_id, user_id, posicao);

create index if not exists idx_conversas_lead
  on public.whatsapp_conversas (organization_id, lead_id)
  where lead_id is not null;

drop trigger if exists set_atualizado_em on public.whatsapp_conversas;
create trigger set_atualizado_em
  before update on public.whatsapp_conversas
  for each row execute function public.tg_set_atualizado_em();


-- ============================================================================
-- PASSO 3 — RLS DA INBOX
-- ============================================================================
alter table public.whatsapp_conversas enable row level security;

-- Só as próprias conversas, e só dentro de organização da qual se é membro.
-- As duas condições juntas: sem a segunda, um usuário removido da empresa
-- continuaria enxergando o que capturou lá dentro.
drop policy if exists conversa_select_propria on public.whatsapp_conversas;
create policy conversa_select_propria on public.whatsapp_conversas
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and organization_id in (select public.orgs_do_usuario())
  );

-- Escrita exige licença ativa, como toda escrita de dado de negócio.
drop policy if exists conversa_insert_propria on public.whatsapp_conversas;
create policy conversa_insert_propria on public.whatsapp_conversas
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and organization_id in (select public.orgs_do_usuario())
    and public.org_acesso_ativo(organization_id)
  );

drop policy if exists conversa_update_propria on public.whatsapp_conversas;
create policy conversa_update_propria on public.whatsapp_conversas
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and organization_id in (select public.orgs_do_usuario())
    and public.org_acesso_ativo(organization_id)
  )
  with check (
    user_id = (select auth.uid())
    and organization_id in (select public.orgs_do_usuario())
  );

-- Apagar a própria conversa da Inbox é limpeza de tela, não destruição de
-- histórico: o lead, se existir, continua intacto (a FK é `set null`).
drop policy if exists conversa_delete_propria on public.whatsapp_conversas;
create policy conversa_delete_propria on public.whatsapp_conversas
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and organization_id in (select public.orgs_do_usuario())
  );


-- ============================================================================
-- PASSO 4 — CHECAGEM DE DUPLICIDADE ENTRE CARTEIRAS
-- ============================================================================
-- O PROBLEMA QUE ELA RESOLVE (pendência do bloco 2 da fase 6):
--   A regra de carteira faz o vendedor não enxergar lead de colega. Efeito
--   colateral: ao abrir a conversa de alguém que JÁ é lead de outro vendedor,
--   a extensão dizia "não é lead" e o vendedor criava um duplicado.
--
-- O QUE ELA REVELA, E O QUE NÃO REVELA:
--   Devolve uma palavra por contato: 'nenhum', 'sua_carteira' ou
--   'outra_carteira'. Não devolve nome, telefone, valor, etapa, responsável
--   nem id. O vendedor descobre que não deve cadastrar de novo — e nada além
--   disso. Quem precisa saber de quem é, pergunta ao gestor.
--
-- POR QUE SECURITY DEFINER, E O QUE ISSO EXIGE:
--   Ela precisa enxergar além da carteira de quem chama, então roda com o
--   privilégio do dono e ignora a RLS. Isso a torna um ORÁCULO: sem a guarda
--   de membro logo na entrada, qualquer usuário autenticado poderia perguntar
--   "existe lead com este telefone?" para uma organização QUALQUER e mapear a
--   base de clientes da concorrência. A primeira linha do corpo é essa guarda.

create or replace function public.situacao_por_contato(
  p_org      uuid,
  p_contatos text[]
)
returns table (contato text, situacao text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  -- A GUARDA. Não mexa nela sem entender o parágrafo acima.
  if not public.e_membro(p_org) then
    raise exception 'Acesso negado a esta organização.' using errcode = '42501';
  end if;

  return query
  with pedidos as (
    select distinct nullif(btrim(entrada.valor), '') as bruto
      from unnest(coalesce(p_contatos, '{}'::text[])) as entrada(valor)
     where nullif(btrim(entrada.valor), '') is not null
  ),
  achados as (
    select p.bruto,
           bool_or(
             public.e_gestor(p_org)
             or l.responsavel_id = (select auth.uid())
             or l.responsavel_id is null
           ) as visivel
      from pedidos p
      join public.leads l
        on l.organization_id = p_org
       and not l.arquivado
       and public.mesmo_telefone(l.telefone, p.bruto)
     group by p.bruto
  )
  select p.bruto,
         case
           when a.bruto is null then 'nenhum'
           when a.visivel     then 'sua_carteira'
           else                    'outra_carteira'
         end
    from pedidos p
    left join achados a on a.bruto = p.bruto;
end
$fn$;

comment on function public.situacao_por_contato(uuid, text[]) is
  'Diz se cada telefone já é lead na organização — inclusive fora da carteira de quem pergunta — sem revelar dado nenhum do lead.';

-- NOTA DE DESEMPENHO: a comparação não usa índice (a regra de "mesmo
-- telefone" não é indexável do jeito que está escrita). O filtro por
-- organization_id, esse sim, usa — então a varredura fica restrita aos leads
-- de uma empresa. Suficiente para a escala do piloto. Se um dia incomodar, o
-- caminho é uma coluna gerada com os 11 dígitos finais, indexada.


-- ============================================================================
-- PASSO 5 — GRANTS
-- ============================================================================
revoke all on table public.whatsapp_conversas from anon;
grant select, insert, update, delete on table public.whatsapp_conversas to authenticated;

revoke execute on function public.so_digitos(text)                 from public, anon;
revoke execute on function public.mesmo_telefone(text, text)       from public, anon;
revoke execute on function public.situacao_por_contato(uuid, text[]) from public, anon;

grant execute on function public.so_digitos(text)                 to authenticated;
grant execute on function public.mesmo_telefone(text, text)       to authenticated;
grant execute on function public.situacao_por_contato(uuid, text[]) to authenticated;


-- ============================================================================
-- PASSO 6 — VERIFICAÇÃO (rode e confira os resultados)
-- ============================================================================

-- 6.1 — RLS ligada na tabela nova (esperado: true).
select c.relname as tabela, c.relrowsecurity as rls_ligado
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'whatsapp_conversas';

-- 6.2 — Policies da Inbox (esperado: 4 — select, insert, update, delete).
select policyname, cmd
  from pg_policies
 where schemaname = 'public' and tablename = 'whatsapp_conversas'
 order by policyname;

-- 6.3 — A tabela NÃO pode ter coluna de mensagem (esperado: 0).
select count(*) as colunas_de_mensagem
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'whatsapp_conversas'
   and column_name ~* 'mensagem|message|texto|conteudo|preview|corpo';

-- 6.4 — A regra de telefone (esperado: t, t, t, f, f).
select public.mesmo_telefone('5511987654321', '(11) 98765-4321') as com_mascara,
       public.mesmo_telefone('5511987654321', '11987654321')     as sem_ddi,
       public.mesmo_telefone('987654321',     '5511987654321')   as so_numero,
       public.mesmo_telefone('5511987654321', '5521987654321')   as ddd_diferente,
       public.mesmo_telefone('1234',          '1234')            as curto_demais;

-- 6.5 — A guarda de membro funciona (esperado: ERRO "Acesso negado").
--       Troque o uuid por uma organização da qual você NÃO é membro.
-- select * from public.situacao_por_contato(
--   '00000000-0000-0000-0000-000000000000'::uuid, array['5511999999999']);

-- 6.6 — A função responde para a sua organização (esperado: uma linha por
--       contato, com 'nenhum' / 'sua_carteira' / 'outra_carteira').
--       Troque o uuid pela SUA organização e o telefone por um lead real.
-- select * from public.situacao_por_contato(
--   '<uuid-da-sua-org>'::uuid, array['5511999999999', '5511888888888']);

-- 6.7 — FK composta da Inbox presente (esperado: 1).
select count(*) as fk_composta_conversa_lead
  from pg_constraint
 where conname = 'whatsapp_conversas_lead_fkey';
