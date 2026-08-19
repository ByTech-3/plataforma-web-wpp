-- ============================================================================
--  BYTECH3 — PLATAFORMA WEB (CRM + WhatsApp)
--  FASE 2 — FUNDAÇÃO MULTI-TENANT (Auth + Organizations + Memberships + Trial)
--  Arquivo: supabase/migrations/0001_fase2_fundacao_multitenant.sql
--
--  COMO RODAR:
--    Supabase Dashboard > SQL Editor > cole este arquivo inteiro > Run.
--    O script é IDEMPOTENTE: pode ser rodado mais de uma vez sem quebrar.
--
--  >>> LEIA ANTES DE RODAR <<<
--    1) O PASSO 7.3 APAGA os leads da POC (linhas sem organização).
--       Se quiser preservá-los, leia o comentário do passo 7.3 antes de rodar.
--    2) O PASSO 7.1 remove a policy `poc_permite_tudo_temporario`. Depois disso
--       a extensão PARA de salvar leads até fazer login (previsto na Fase 6).
--       Isso é intencional: o acesso anônimo à tabela é exatamente o furo que a
--       Fase 2 existe para fechar.
--
--  PRINCÍPIO DE SEGURANÇA DESTE ARQUIVO (CLAUDE.md §6.4 e §12):
--    O isolamento entre empresas NÃO depende do frontend. Toda leitura e
--    escrita passa por RLS. O frontend só enxerga o que o banco já autorizou.
--    Vazamento entre organizações = fim do negócio. Trate este arquivo como
--    código de segurança, não como "schema".
-- ============================================================================


-- ============================================================================
-- PASSO 0 — PRÉ-REQUISITOS
-- ============================================================================

-- gen_random_uuid() vem de pgcrypto (já habilitado por padrão no Supabase).
create extension if not exists pgcrypto;


-- ============================================================================
-- PASSO 1 — TIPOS (ENUMS)
-- ============================================================================

-- Papéis dentro de UMA organização (CLAUDE.md §5).
--   admin    -> dono da conta: gerencia usuários, faturamento, tudo da org
--   gestor   -> vê e gerencia todos os leads da org, não mexe em faturamento
--   vendedor -> vê apenas a própria carteira (regra de carteira, CLAUDE.md §5)
do $enum$
begin
  create type public.papel_membro as enum ('admin', 'gestor', 'vendedor');
exception
  when duplicate_object then null;
end
$enum$;

-- Status comercial da organização.
--   trial        -> período gratuito, expira em trial_fim
--   ativa        -> assinatura paga em dia
--   inadimplente -> pagamento falhou (acesso bloqueado, dados preservados)
--   cancelada    -> cliente cancelou
--   expirada     -> trial acabou sem conversão
do $enum$
begin
  create type public.status_assinatura as enum
    ('trial', 'ativa', 'inadimplente', 'cancelada', 'expirada');
exception
  when duplicate_object then null;
end
$enum$;


-- ============================================================================
-- PASSO 2 — UTILITÁRIO: atualizado_em automático
-- ============================================================================

create or replace function public.tg_set_atualizado_em()
returns trigger
language plpgsql
as $fn$
begin
  new.atualizado_em := now();
  return new;
end
$fn$;


-- ============================================================================
-- PASSO 3 — PROFILES (identidade individual)
-- ============================================================================
-- A identidade REAL vive em auth.users (gerenciada pelo Supabase Auth).
-- `profiles` é o espelho consultável dela dentro do schema public.
-- Nunca guardamos senha aqui — auth.users cuida disso.
--
-- OBS DE ESCOPO: o Bloco 1 pediu organizations/memberships/subscriptions.
-- `profiles` foi incluída porque sem ela é impossível mostrar "quem é o
-- responsável pelo lead" ou listar a equipe sem expor a tabela auth.users
-- (que contém hashes e tokens de recuperação). É fundação, não CRM.

create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  nome_completo  text,
  email          text,
  avatar_url     text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

comment on table public.profiles is
  'Dados públicos do usuário. Espelho de auth.users. Visível apenas para quem compartilha organização.';

drop trigger if exists set_atualizado_em on public.profiles;
create trigger set_atualizado_em
  before update on public.profiles
  for each row execute function public.tg_set_atualizado_em();

-- Cria o profile automaticamente quando o Supabase Auth cria o usuário.
-- SECURITY DEFINER porque roda no cadastro, antes de existir sessão.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  insert into public.profiles (id, email, nome_completo)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'nome_completo',
      new.raw_user_meta_data ->> 'full_name',
      split_part(coalesce(new.email, ''), '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end
$fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: usuários que já existiam antes deste script ganham profile agora.
insert into public.profiles (id, email)
select u.id, u.email from auth.users u
on conflict (id) do nothing;


-- ============================================================================
-- PASSO 4 — ORGANIZATIONS (o tenant)
-- ============================================================================
-- Uma organização = uma empresa cliente. É a fronteira de isolamento de dados.
-- TODA tabela de negócio criada daqui em diante DEVE ter organization_id.

create table if not exists public.organizations (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null check (length(btrim(nome)) between 2 and 120),
  slug           text unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  documento      text,                    -- CNPJ/CPF (opcional, faturamento)
  criado_por     uuid references auth.users(id) on delete set null,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

comment on table public.organizations is
  'Tenant. Fronteira de isolamento de dados entre empresas clientes.';

drop trigger if exists set_atualizado_em on public.organizations;
create trigger set_atualizado_em
  before update on public.organizations
  for each row execute function public.tg_set_atualizado_em();


-- ============================================================================
-- PASSO 5 — MEMBERSHIPS (usuário <-> organização + papel)
-- ============================================================================
-- Um usuário pode pertencer a mais de uma organização (consultor, dono de duas
-- unidades). O papel é POR ORGANIZAÇÃO, nunca global.

create table if not exists public.memberships (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  papel            public.papel_membro not null default 'vendedor',
  ativo            boolean not null default true,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  unique (organization_id, user_id)
);

comment on table public.memberships is
  'Vínculo usuário<->organização com papel. Fonte da verdade de TODAS as policies de RLS.';

create index if not exists idx_memberships_user on public.memberships (user_id) where ativo;
create index if not exists idx_memberships_org  on public.memberships (organization_id) where ativo;

drop trigger if exists set_atualizado_em on public.memberships;
create trigger set_atualizado_em
  before update on public.memberships
  for each row execute function public.tg_set_atualizado_em();


-- ============================================================================
-- PASSO 6 — SUBSCRIPTIONS (plano, status, trial)
-- ============================================================================
-- Uma assinatura por organização. Esta tabela é DINHEIRO: nenhum usuário final
-- pode escrever nela (ver PASSO 10). Só service_role ou o futuro webhook de
-- billing (Fase 10).

create table if not exists public.subscriptions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null unique references public.organizations(id) on delete cascade,
  plano            text not null default 'trial',
  status           public.status_assinatura not null default 'trial',
  trial_inicio     timestamptz,
  trial_fim        timestamptz,
  periodo_fim      timestamptz,            -- fim do ciclo pago corrente
  cancelada_em     timestamptz,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  constraint trial_coerente check (
    trial_inicio is null or trial_fim is null or trial_fim > trial_inicio
  )
);

comment on table public.subscriptions is
  'Plano/trial da organização. SOMENTE LEITURA para usuários finais. Escrita apenas via service_role.';

create index if not exists idx_subscriptions_org on public.subscriptions (organization_id);

drop trigger if exists set_atualizado_em on public.subscriptions;
create trigger set_atualizado_em
  before update on public.subscriptions
  for each row execute function public.tg_set_atualizado_em();


-- ============================================================================
-- PASSO 7 — MIGRAÇÃO DA TABELA `leads` (POC -> multi-tenant)
-- ============================================================================

-- 7.1 — Remove a policy temporária da POC que abria a tabela para `anon`.
--       (CLAUDE.md §4: "DEVE ser removida quando o multi-tenant real for
--       implementado"). O bloco abaixo derruba TODAS as policies existentes de
--       `leads` para garantir que nada da POC sobreviva escondido.
drop policy if exists poc_permite_tudo_temporario on public.leads;

do $limpa$
declare
  r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'leads'
  loop
    execute format('drop policy if exists %I on public.leads', r.policyname);
  end loop;
end
$limpa$;

-- 7.2 — Novas colunas.
alter table public.leads
  add column if not exists organization_id uuid,
  add column if not exists responsavel_id  uuid,
  add column if not exists criado_por      uuid,
  add column if not exists atualizado_em   timestamptz not null default now();

-- 7.3 — DADOS DA POC.
--   Os leads antigos não pertencem a nenhuma organização, então não podem
--   existir num mundo multi-tenant (não há a quem pertencer, e RLS os tornaria
--   invisíveis para todos de qualquer forma).
--
--   >>> ESCOLHA <<<
--   (A) PADRÃO — apagar os dados de teste da POC. É a linha ativa abaixo.
--   (B) PRESERVAR — comente a linha do delete, rode o script até o fim, crie
--       sua organização pelo app (Bloco 3) e então rode manualmente:
--           update public.leads
--              set organization_id = '<uuid-da-sua-org>'
--            where organization_id is null;
--           alter table public.leads alter column organization_id set not null;
delete from public.leads where organization_id is null;

-- 7.4 — Constraints e integridade referencial.
--   organization_id é NOT NULL: um lead órfão é um lead sem dono e sem RLS.
alter table public.leads
  alter column organization_id set not null;

do $fk$
begin
  alter table public.leads
    add constraint leads_organization_id_fkey
    foreign key (organization_id) references public.organizations(id) on delete cascade;
exception when duplicate_object then null;
end
$fk$;

do $fk$
begin
  alter table public.leads
    add constraint leads_responsavel_id_fkey
    foreign key (responsavel_id) references auth.users(id) on delete set null;
exception when duplicate_object then null;
end
$fk$;

do $fk$
begin
  alter table public.leads
    add constraint leads_criado_por_fkey
    foreign key (criado_por) references auth.users(id) on delete set null;
exception when duplicate_object then null;
end
$fk$;

-- 7.5 — Origem do lead: valores fixos do CLAUDE.md §9.
--   "Não identificado" é obrigatório e é o default (nunca forçar o vendedor a
--   inventar origem).
update public.leads
   set origem = 'Não identificado'
 where origem is null
    or origem not in ('Instagram','Facebook','Google','Indicação',
                      'Campanha específica','Site','WhatsApp direto',
                      'Outro','Não identificado');

alter table public.leads alter column origem set default 'Não identificado';
alter table public.leads alter column origem set not null;

do $ck$
begin
  alter table public.leads
    add constraint leads_origem_valida check (
      origem in ('Instagram','Facebook','Google','Indicação',
                 'Campanha específica','Site','WhatsApp direto',
                 'Outro','Não identificado')
    );
exception when duplicate_object then null;
end
$ck$;

-- 7.6 — Índices (RLS filtra por organização em toda query: precisa de índice).
create index if not exists idx_leads_org         on public.leads (organization_id);
create index if not exists idx_leads_responsavel on public.leads (organization_id, responsavel_id);

drop trigger if exists set_atualizado_em on public.leads;
create trigger set_atualizado_em
  before update on public.leads
  for each row execute function public.tg_set_atualizado_em();


-- ============================================================================
-- PASSO 8 — FUNÇÕES DE AUTORIZAÇÃO (o coração do RLS)
-- ============================================================================
-- POR QUE SECURITY DEFINER:
--   Uma policy em `memberships` que consultasse `memberships` causaria
--   RECURSÃO INFINITA no Postgres. Estas funções rodam com o privilégio do
--   dono (ignorando RLS), retornam SÓ o necessário e quebram o ciclo.
--   Todas são STABLE (o planner as executa uma vez por query) e têm
--   search_path fixo (blindagem contra search_path hijacking).

-- Organizações ativas do usuário logado.
create or replace function public.orgs_do_usuario()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select m.organization_id
    from public.memberships m
   where m.user_id = (select auth.uid())
     and m.ativo
$fn$;

-- Papel do usuário logado numa organização (null se não for membro).
create or replace function public.papel_na_org(p_org uuid)
returns public.papel_membro
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select m.papel
    from public.memberships m
   where m.organization_id = p_org
     and m.user_id = (select auth.uid())
     and m.ativo
   limit 1
$fn$;

create or replace function public.e_membro(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select public.papel_na_org(p_org) is not null
$fn$;

-- Gestor OU admin: enxerga todos os leads da organização.
create or replace function public.e_gestor(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select public.papel_na_org(p_org) in ('admin', 'gestor')
$fn$;

create or replace function public.e_admin(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select public.papel_na_org(p_org) = 'admin'
$fn$;

-- Dois usuários compartilham alguma organização? (usado por `profiles`)
create or replace function public.compartilha_org(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1
      from public.memberships m
     where m.user_id = p_user
       and m.ativo
       and m.organization_id in (select public.orgs_do_usuario())
  )
$fn$;

-- BLOQUEIO DE TRIAL/LICENÇA — REGRA DE BACKEND (CLAUDE.md §6.5).
-- Retorna false quando o trial venceu ou a assinatura não está em dia.
-- Nenhuma escrita em dados de negócio passa por RLS com isto false.
-- Esconder botões no frontend NÃO é bloqueio; isto é.
create or replace function public.org_acesso_ativo(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1
      from public.subscriptions s
     where s.organization_id = p_org
       and (
            (s.status = 'trial' and s.trial_fim is not null and s.trial_fim > now())
         or (s.status = 'ativa' and (s.periodo_fim is null or s.periodo_fim > now()))
       )
  )
$fn$;

comment on function public.org_acesso_ativo(uuid) is
  'Licença/trial como regra de backend. Falso = organização em leitura apenas.';


-- ============================================================================
-- PASSO 9 — TRIGGERS DE INTEGRIDADE
-- ============================================================================

-- 9.1 — A organização nunca pode ficar sem admin ativo (senão vira conta órfã,
--       sem ninguém capaz de gerenciar usuários ou faturamento).
create or replace function public.tg_protege_ultimo_admin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_perdeu_admin boolean := false;
  v_outros_admins int;
begin
  -- Só interessa quando a linha alterada ERA um admin ativo.
  -- (IF aninhado de propósito: PL/pgSQL não garante curto-circuito em AND/OR,
  --  e num DELETE o registro NEW não existe.)
  if old.papel <> 'admin' or not old.ativo then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    v_perdeu_admin := true;
  else
    if new.papel <> 'admin' or not new.ativo then
      v_perdeu_admin := true;
    end if;
  end if;

  if v_perdeu_admin then
    select count(*) into v_outros_admins
      from public.memberships m
     where m.organization_id = old.organization_id
       and m.papel = 'admin'
       and m.ativo
       and m.id <> old.id;

    if v_outros_admins = 0 then
      raise exception 'A organização precisa de pelo menos um admin ativo.'
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$fn$;

drop trigger if exists protege_ultimo_admin on public.memberships;
create trigger protege_ultimo_admin
  before update or delete on public.memberships
  for each row execute function public.tg_protege_ultimo_admin();

-- 9.2 — Um membership nunca muda de organização nem de usuário.
--       (defesa extra: sem isto, um UPDATE criativo poderia mover um vínculo
--       para outro tenant.)
create or replace function public.tg_membership_imutavel()
returns trigger
language plpgsql
as $fn$
begin
  if new.organization_id <> old.organization_id then
    raise exception 'organization_id de um membership é imutável.';
  end if;
  if new.user_id <> old.user_id then
    raise exception 'user_id de um membership é imutável.';
  end if;
  return new;
end
$fn$;

drop trigger if exists membership_imutavel on public.memberships;
create trigger membership_imutavel
  before update on public.memberships
  for each row execute function public.tg_membership_imutavel();

-- 9.3 — Leads: organização imutável + responsável tem que ser da mesma org.
--       Impede o vazamento clássico: UPDATE trocando organization_id para
--       "empurrar" um lead de uma empresa para outra.
create or replace function public.tg_valida_lead()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  -- IF aninhado: no INSERT o registro OLD não existe e PL/pgSQL não garante
  -- curto-circuito em AND.
  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id then
      raise exception 'Um lead não pode mudar de organização.';
    end if;
  end if;

  if new.responsavel_id is not null then
    if not exists (
      select 1 from public.memberships m
       where m.organization_id = new.organization_id
         and m.user_id = new.responsavel_id
         and m.ativo
    ) then
      raise exception 'O responsável precisa ser membro ativo da organização do lead.';
    end if;
  end if;

  return new;
end
$fn$;

drop trigger if exists valida_lead on public.leads;
create trigger valida_lead
  before insert or update on public.leads
  for each row execute function public.tg_valida_lead();


-- ============================================================================
-- PASSO 10 — RLS: ATIVAÇÃO E POLICIES
-- ============================================================================
-- Modelo de acesso desta fase:
--
--   TABELA         SELECT                    INSERT/UPDATE/DELETE
--   -------------  ------------------------  ----------------------------------
--   organizations  membros da org            UPDATE: admin | INSERT: só via RPC
--   memberships    membros da org            admin da org (com triggers de guarda)
--   subscriptions  membros da org            NINGUÉM (service_role/billing)
--   profiles       si mesmo + colegas de org UPDATE: só o próprio
--   leads          carteira (ver abaixo)     membro + licença ativa
--
-- Regra de carteira (CLAUDE.md §5):
--   admin/gestor -> todos os leads da organização
--   vendedor     -> os seus + os sem responsável (pool da equipe)

alter table public.organizations enable row level security;
alter table public.memberships   enable row level security;
alter table public.subscriptions enable row level security;
alter table public.profiles      enable row level security;
alter table public.leads         enable row level security;

-- ---------------------------------------------------------------- ORGANIZATIONS
drop policy if exists org_select_membro on public.organizations;
create policy org_select_membro on public.organizations
  for select to authenticated
  using (id in (select public.orgs_do_usuario()));

drop policy if exists org_update_admin on public.organizations;
create policy org_update_admin on public.organizations
  for update to authenticated
  using (public.e_admin(id))
  with check (public.e_admin(id));

-- SEM policy de INSERT: organizações nascem SOMENTE pela função
-- public.criar_organizacao() (PASSO 11), que cria org + admin + trial de forma
-- atômica. Assim ninguém cria uma org solta, sem dono ou sem assinatura.
-- SEM policy de DELETE: apagar uma empresa é operação de suporte (service_role).

-- ------------------------------------------------------------------ MEMBERSHIPS
drop policy if exists membership_select_org on public.memberships;
create policy membership_select_org on public.memberships
  for select to authenticated
  using (organization_id in (select public.orgs_do_usuario()));

-- Admin adiciona membros na PRÓPRIA organização (convites reais: Fase 8).
drop policy if exists membership_insert_admin on public.memberships;
create policy membership_insert_admin on public.memberships
  for insert to authenticated
  with check (public.e_admin(organization_id));

drop policy if exists membership_update_admin on public.memberships;
create policy membership_update_admin on public.memberships
  for update to authenticated
  using (public.e_admin(organization_id))
  with check (public.e_admin(organization_id));

drop policy if exists membership_delete_admin on public.memberships;
create policy membership_delete_admin on public.memberships
  for delete to authenticated
  using (public.e_admin(organization_id));

-- ---------------------------------------------------------------- SUBSCRIPTIONS
-- Leitura para os membros (a UI precisa mostrar plano e dias de trial).
-- NENHUMA policy de escrita: o usuário não estende o próprio trial.
drop policy if exists subscription_select_membro on public.subscriptions;
create policy subscription_select_membro on public.subscriptions
  for select to authenticated
  using (organization_id in (select public.orgs_do_usuario()));

-- --------------------------------------------------------------------- PROFILES
drop policy if exists profile_select_proprio_ou_colega on public.profiles;
create policy profile_select_proprio_ou_colega on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or public.compartilha_org(id)
  );

drop policy if exists profile_update_proprio on public.profiles;
create policy profile_update_proprio on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ------------------------------------------------------------------------ LEADS
-- LEITURA: escopo da organização + regra de carteira.
drop policy if exists lead_select_carteira on public.leads;
create policy lead_select_carteira on public.leads
  for select to authenticated
  using (
    organization_id in (select public.orgs_do_usuario())
    and (
      public.e_gestor(organization_id)
      or responsavel_id = (select auth.uid())
      or responsavel_id is null
    )
  );

-- ESCRITA: exige membro + LICENÇA ATIVA (trial válido ou assinatura em dia).
-- Trial vencido => a organização continua LENDO os dados, mas não escreve.
-- (Para bloquear também a leitura, acrescente
--  `and public.org_acesso_ativo(organization_id)` na policy de SELECT acima.)
drop policy if exists lead_insert_membro on public.leads;
create policy lead_insert_membro on public.leads
  for insert to authenticated
  with check (
    organization_id in (select public.orgs_do_usuario())
    and public.org_acesso_ativo(organization_id)
    and (
      responsavel_id is null
      or responsavel_id = (select auth.uid())
      or public.e_gestor(organization_id)
    )
  );

drop policy if exists lead_update_carteira on public.leads;
create policy lead_update_carteira on public.leads
  for update to authenticated
  using (
    organization_id in (select public.orgs_do_usuario())
    and public.org_acesso_ativo(organization_id)
    and (
      public.e_gestor(organization_id)
      or responsavel_id = (select auth.uid())
      or responsavel_id is null
    )
  )
  with check (
    organization_id in (select public.orgs_do_usuario())
    and public.org_acesso_ativo(organization_id)
  );

-- Apagar lead: só gestor/admin (vendedor não destrói histórico da empresa).
drop policy if exists lead_delete_gestor on public.leads;
create policy lead_delete_gestor on public.leads
  for delete to authenticated
  using (
    organization_id in (select public.orgs_do_usuario())
    and public.e_gestor(organization_id)
  );


-- ============================================================================
-- PASSO 11 — RPC: CRIAR ORGANIZAÇÃO + ADMIN + TRIAL (atômico)
-- ============================================================================
-- Chamada pelo app no signup: supabase.rpc('criar_organizacao', { p_nome })
--
-- Por que uma função e não 3 inserts no frontend:
--   1) Atômico: ou nasce org + membership admin + trial, ou não nasce nada.
--   2) O cliente NÃO escolhe quantos dias de trial nem o status da assinatura.
--      Esses valores são constantes do servidor. Se viessem por parâmetro,
--      qualquer um daria a si mesmo 9999 dias grátis.
--   3) Permite manter organizations/subscriptions sem policy de INSERT.

create or replace function public.gerar_slug(p_texto text)
returns text
language sql
immutable
as $fn$
  select btrim(
    regexp_replace(
      lower(translate(
        coalesce(p_texto, ''),
        'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
        'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
      )),
      '[^a-z0-9]+', '-', 'g'
    ),
    '-'
  )
$fn$;

create or replace function public.criar_organizacao(
  p_nome text,
  p_slug text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  -- Duração do trial: constante de servidor. NUNCA parâmetro do cliente.
  c_trial_dias constant int := 14;
  v_user  uuid := (select auth.uid());
  v_org   uuid;
  v_base  text;
  v_slug  text;
  v_i     int := 0;
begin
  if v_user is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;

  if p_nome is null or length(btrim(p_nome)) < 2 then
    raise exception 'Informe um nome de organização com pelo menos 2 caracteres.';
  end if;

  -- Slug: a partir do parâmetro ou derivado do nome; garante unicidade.
  v_base := public.gerar_slug(coalesce(nullif(btrim(p_slug), ''), p_nome));
  if length(v_base) < 3 then
    v_base := v_base || 'org';
  end if;
  v_base := left(v_base, 50);
  v_slug := v_base;

  while exists (select 1 from public.organizations o where o.slug = v_slug) loop
    v_i := v_i + 1;
    v_slug := left(v_base, 45) || '-' || v_i;
  end loop;

  insert into public.organizations (nome, slug, criado_por)
  values (btrim(p_nome), v_slug, v_user)
  returning id into v_org;

  -- Quem cria a empresa é o admin dela.
  insert into public.memberships (organization_id, user_id, papel, ativo)
  values (v_org, v_user, 'admin', true);

  -- Trial começa agora (CLAUDE.md §7: trial gratuito configurável).
  insert into public.subscriptions
    (organization_id, plano, status, trial_inicio, trial_fim)
  values
    (v_org, 'trial', 'trial', now(), now() + make_interval(days => c_trial_dias));

  -- Garante o profile (caso o trigger de auth.users não tenha rodado).
  insert into public.profiles (id, email)
  select v_user, u.email from auth.users u where u.id = v_user
  on conflict (id) do nothing;

  return v_org;
end
$fn$;

comment on function public.criar_organizacao(text, text) is
  'Cria organização + membership admin + assinatura em trial de forma atômica. Único caminho de criação de tenant.';


-- ============================================================================
-- PASSO 12 — RPC: CONTEXTO DO USUÁRIO LOGADO (para a tela pós-login)
-- ============================================================================
-- Uma chamada devolve organização, papel, status e dias restantes de trial —
-- evita 3 queries no frontend. Chamada: supabase.rpc('meu_contexto')

create or replace function public.meu_contexto()
returns table (
  organization_id   uuid,
  organizacao_nome  text,
  organizacao_slug  text,
  papel             public.papel_membro,
  plano             text,
  status            public.status_assinatura,
  trial_inicio      timestamptz,
  trial_fim         timestamptz,
  dias_restantes    int,
  acesso_ativo      boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select
    o.id,
    o.nome,
    o.slug,
    m.papel,
    s.plano,
    s.status,
    s.trial_inicio,
    s.trial_fim,
    case
      when s.trial_fim is null then null
      else greatest(0, ceil(extract(epoch from (s.trial_fim - now())) / 86400))::int
    end,
    public.org_acesso_ativo(o.id)
  from public.memberships m
  join public.organizations o on o.id = m.organization_id
  left join public.subscriptions s on s.organization_id = o.id
  where m.user_id = (select auth.uid())
    and m.ativo
  order by m.criado_em
$fn$;


-- ============================================================================
-- PASSO 13 — GRANTS (defesa em profundidade)
-- ============================================================================
-- RLS já protege as linhas. Aqui removemos o acesso do papel `anon` às tabelas
-- de negócio: sem sessão, sem dados. Nem tentativa.
--
-- >>> É ESTE PASSO QUE FAZ A EXTENSÃO PARAR DE SALVAR LEADS ANONIMAMENTE. <<<
--     Correto e intencional. A extensão passa a precisar de login (Fase 6).

revoke all on table public.organizations from anon;
revoke all on table public.memberships   from anon;
revoke all on table public.subscriptions from anon;
revoke all on table public.profiles      from anon;
revoke all on table public.leads         from anon;

grant select                         on table public.organizations to authenticated;
grant update                         on table public.organizations to authenticated;
grant select, insert, update, delete on table public.memberships   to authenticated;
grant select                         on table public.subscriptions to authenticated;
grant select, update                 on table public.profiles      to authenticated;
grant select, insert, update, delete on table public.leads         to authenticated;

-- Funções: nenhuma delas deve ser chamável por visitante anônimo.
revoke execute on function public.criar_organizacao(text, text) from public, anon;
revoke execute on function public.meu_contexto()                from public, anon;
revoke execute on function public.orgs_do_usuario()             from public, anon;
revoke execute on function public.papel_na_org(uuid)            from public, anon;
revoke execute on function public.e_membro(uuid)                from public, anon;
revoke execute on function public.e_gestor(uuid)                from public, anon;
revoke execute on function public.e_admin(uuid)                 from public, anon;
revoke execute on function public.compartilha_org(uuid)         from public, anon;
revoke execute on function public.org_acesso_ativo(uuid)        from public, anon;

grant execute on function public.criar_organizacao(text, text) to authenticated;
grant execute on function public.meu_contexto()                to authenticated;
grant execute on function public.orgs_do_usuario()             to authenticated;
grant execute on function public.papel_na_org(uuid)            to authenticated;
grant execute on function public.e_membro(uuid)                to authenticated;
grant execute on function public.e_gestor(uuid)                to authenticated;
grant execute on function public.e_admin(uuid)                 to authenticated;
grant execute on function public.compartilha_org(uuid)         to authenticated;
grant execute on function public.org_acesso_ativo(uuid)        to authenticated;


-- ============================================================================
-- PASSO 14 — VERIFICAÇÃO (rode e confira o resultado)
-- ============================================================================

-- 14.1 — Todas as tabelas de negócio precisam estar com RLS ligado (rowsecurity = true).
select c.relname as tabela, c.relrowsecurity as rls_ligado
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('organizations','memberships','subscriptions','profiles','leads')
 order by c.relname;

-- 14.2 — Policies criadas (a policy da POC NÃO pode aparecer nesta lista).
select tablename, policyname, cmd
  from pg_policies
 where schemaname = 'public'
 order by tablename, policyname;

-- 14.3 — Confirmação explícita de que a policy da POC morreu (esperado: 0).
select count(*) as policies_poc_restantes
  from pg_policies
 where schemaname = 'public'
   and policyname = 'poc_permite_tudo_temporario';

-- 14.4 — Nenhum lead pode existir sem organização (esperado: 0).
select count(*) as leads_sem_organizacao
  from public.leads
 where organization_id is null;
