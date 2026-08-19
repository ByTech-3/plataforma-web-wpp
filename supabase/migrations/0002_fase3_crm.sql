-- ============================================================================
--  BYTECH3 — PLATAFORMA WEB (CRM + WhatsApp)
--  FASE 3 / PASSO 1 — NÚCLEO DO CRM
--  Arquivo: app-web/supabase/migrations/0002_fase3_crm.sql
--
--  DEPENDE DE: 0001_fase2_fundacao_multitenant.sql (já rodado e validado).
--  Reaproveita as funções de autorização daquela migração —
--  orgs_do_usuario(), e_gestor(), org_acesso_ativo() — sem redefinir nenhuma.
--
--  COMO RODAR:
--    Supabase Dashboard > SQL Editor > cole este arquivo inteiro > Run.
--    Idempotente: pode rodar mais de uma vez sem quebrar.
--
--  O QUE ENTRA AQUI:
--    pipelines, pipeline_stages, lead_pipeline, tags, lead_tags, activities,
--    e a ampliação comercial da tabela leads.
--
--  TRÊS DECISÕES QUE VALEM SUA REVISÃO (detalhadas no lugar de cada uma):
--    1. `lead_pipeline` como tabela de vínculo, e não `pipeline_id` dentro de
--       leads — é o que o CLAUDE.md §5 especifica (PASSO 4).
--    2. As activities são gravadas por TRIGGER no banco, não pelo frontend
--       (PASSO 8). Assim o histórico não depende de a aplicação lembrar.
--    3. Isolamento reforçado por CHAVE ESTRANGEIRA COMPOSTA, além da RLS
--       (PASSO 3). Ligar um registro a outra organização passa a ser
--       impossível estruturalmente, não apenas proibido por policy.
-- ============================================================================


-- ============================================================================
-- PASSO 1 — TIPOS
-- ============================================================================

-- Natureza da etapa do funil. Serve para o Kanban saber o que é coluna de
-- fechamento e, mais adiante, para os relatórios calcularem taxa de conversão
-- sem depender do NOME que o cliente deu à coluna.
do $enum$
begin
  create type public.tipo_etapa as enum ('aberta', 'ganho', 'perdido');
exception
  when duplicate_object then null;
end
$enum$;


-- ============================================================================
-- PASSO 2 — AMPLIAÇÃO COMERCIAL DE `leads`
-- ============================================================================
-- `nome`, `telefone`, `origem`, `organization_id`, `responsavel_id` e
-- `criado_por` já existem desde a 0001. Aqui entram os campos comerciais.

alter table public.leads
  add column if not exists email               text,
  add column if not exists valor               numeric(14,2),
  add column if not exists previsao_fechamento date,
  add column if not exists ultimo_contato_em   timestamptz,
  add column if not exists arquivado           boolean not null default false;

comment on column public.leads.valor is
  'Valor potencial do negócio, em reais. Base do total por coluna no Kanban.';
comment on column public.leads.arquivado is
  'Descarte reversível. Nunca apagar lead: o histórico em activities perderia o contexto.';

do $ck$
begin
  alter table public.leads
    add constraint leads_valor_nao_negativo
    check (valor is null or valor >= 0);
exception when duplicate_object then null;
end
$ck$;

-- Índice para a listagem padrão (leads ativos da organização, mais recentes
-- primeiro), que é a query mais executada do CRM.
create index if not exists idx_leads_org_ativos
  on public.leads (organization_id, criado_em desc)
  where not arquivado;


-- ============================================================================
-- PASSO 3 — ISOLAMENTO ESTRUTURAL (chaves compostas)
-- ============================================================================
-- Toda tabela nova referencia o par (id, organization_id) do registro pai,
-- não apenas o id. Efeito prático: o banco RECUSA vincular um lead da empresa
-- A a um pipeline da empresa B — mesmo que uma policy tivesse furo, mesmo que
-- alguém rodasse o INSERT com service_role.
--
-- É defesa em profundidade: a RLS decide QUEM vê o quê; a FK composta garante
-- que os dados não se misturem nem por engano de código.

do $uk$
begin
  alter table public.leads
    add constraint leads_id_org_unico unique (id, organization_id);
exception when duplicate_object then null;
end
$uk$;


-- ============================================================================
-- PASSO 4 — PIPELINES E ETAPAS
-- ============================================================================

create table if not exists public.pipelines (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  nome             text not null check (length(btrim(nome)) between 2 and 80),
  descricao        text,
  posicao          int not null default 0,
  padrao           boolean not null default false,
  arquivado        boolean not null default false,
  criado_por       uuid references auth.users(id) on delete set null,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  unique (organization_id, nome)
);

comment on table public.pipelines is
  'Funis de venda da organização (ex.: Matrículas, Reativação, Campanha de verão).';

do $uk$
begin
  alter table public.pipelines
    add constraint pipelines_id_org_unico unique (id, organization_id);
exception when duplicate_object then null;
end
$uk$;

-- Um único pipeline padrão por organização (é o que a UI abre primeiro).
create unique index if not exists idx_pipelines_um_padrao
  on public.pipelines (organization_id)
  where padrao;

create index if not exists idx_pipelines_org on public.pipelines (organization_id);

drop trigger if exists set_atualizado_em on public.pipelines;
create trigger set_atualizado_em
  before update on public.pipelines
  for each row execute function public.tg_set_atualizado_em();


create table if not exists public.pipeline_stages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  pipeline_id      uuid not null,
  nome             text not null check (length(btrim(nome)) between 1 and 60),
  tipo             public.tipo_etapa not null default 'aberta',
  cor              text,
  posicao          int not null default 0,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  unique (pipeline_id, nome)
);

comment on table public.pipeline_stages is
  'Colunas do Kanban. A ordem visual é `posicao`, crescente.';

-- FK COMPOSTA: a etapa herda a organização do pipeline. Não há como criar uma
-- etapa apontando para pipeline de outra empresa.
do $fk$
begin
  alter table public.pipeline_stages
    add constraint pipeline_stages_pipeline_fkey
    foreign key (pipeline_id, organization_id)
    references public.pipelines(id, organization_id) on delete cascade;
exception when duplicate_object then null;
end
$fk$;

-- Necessária para o lead_pipeline provar que a etapa pertence ao pipeline.
do $uk$
begin
  alter table public.pipeline_stages
    add constraint pipeline_stages_id_pipeline_unico unique (id, pipeline_id);
exception when duplicate_object then null;
end
$uk$;

create index if not exists idx_stages_pipeline
  on public.pipeline_stages (pipeline_id, posicao);

drop trigger if exists set_atualizado_em on public.pipeline_stages;
create trigger set_atualizado_em
  before update on public.pipeline_stages
  for each row execute function public.tg_set_atualizado_em();


-- ============================================================================
-- PASSO 5 — VÍNCULO LEAD ↔ PIPELINE/ETAPA
-- ============================================================================
-- POR QUE UMA TABELA, E NÃO `leads.stage_id`:
--   O CLAUDE.md §5 lista `lead_pipeline` como entidade própria. A diferença
--   prática: o mesmo lead pode estar em mais de um funil ao mesmo tempo — na
--   "Matrícula" e também na "Campanha de verão" — cada um com sua etapa e seu
--   histórico. Com uma coluna em `leads` isso seria impossível sem migração
--   dolorosa depois.
--   Custo: as telas fazem um join a mais. É o preço de não pintar o produto
--   num canto.
--
-- Se você preferir o modelo simples (um lead = um funil), me diga: troco por
-- `leads.pipeline_id` + `leads.stage_id` antes de você rodar.

create table if not exists public.lead_pipeline (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  lead_id          uuid not null,
  pipeline_id      uuid not null,
  stage_id         uuid not null,
  posicao          numeric not null default 0,
  entrou_na_etapa_em timestamptz not null default now(),
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  unique (lead_id, pipeline_id)
);

comment on table public.lead_pipeline is
  'Em que etapa de qual funil cada lead está. Um lead pode estar em vários funis.';
comment on column public.lead_pipeline.posicao is
  'Ordem dentro da coluna do Kanban. Numérico para permitir soltar entre dois cartões (média dos vizinhos).';
comment on column public.lead_pipeline.entrou_na_etapa_em is
  'Quando entrou na etapa atual. Base do "tempo em cada etapa" nos relatórios.';

-- SOBRE OS `on delete cascade` ABAIXO — o que cada um apaga de fato:
--   apagar um LEAD      -> some do funil (e o lead some junto; prefira
--                          `arquivado = true`, que é reversível)
--   apagar um PIPELINE  -> some o funil e os vínculos dos leads a ele
--   apagar uma ETAPA    -> os cartões daquela coluna saem do funil
-- Em NENHUM desses casos o lead é perdido por causa do funil: o que cai é o
-- VÍNCULO. E toda saída fica registrada em activities como
-- 'lead.pipeline_removed', então nada some sem deixar rastro no histórico.

do $fk$
begin
  alter table public.lead_pipeline
    add constraint lead_pipeline_lead_fkey
    foreign key (lead_id, organization_id)
    references public.leads(id, organization_id) on delete cascade;
exception when duplicate_object then null;
end
$fk$;

do $fk$
begin
  alter table public.lead_pipeline
    add constraint lead_pipeline_pipeline_fkey
    foreign key (pipeline_id, organization_id)
    references public.pipelines(id, organization_id) on delete cascade;
exception when duplicate_object then null;
end
$fk$;

-- A etapa TEM que ser uma etapa daquele pipeline. Garantido pela FK composta,
-- sem precisar de trigger nem de confiança no frontend.
do $fk$
begin
  alter table public.lead_pipeline
    add constraint lead_pipeline_stage_fkey
    foreign key (stage_id, pipeline_id)
    references public.pipeline_stages(id, pipeline_id) on delete cascade;
exception when duplicate_object then null;
end
$fk$;

create index if not exists idx_lead_pipeline_kanban
  on public.lead_pipeline (pipeline_id, stage_id, posicao);
create index if not exists idx_lead_pipeline_lead
  on public.lead_pipeline (lead_id);

drop trigger if exists set_atualizado_em on public.lead_pipeline;
create trigger set_atualizado_em
  before update on public.lead_pipeline
  for each row execute function public.tg_set_atualizado_em();

-- Ao mudar de etapa, reinicia o cronômetro da etapa.
create or replace function public.tg_marca_entrada_na_etapa()
returns trigger
language plpgsql
as $fn$
begin
  if new.stage_id <> old.stage_id then
    new.entrou_na_etapa_em := now();
  end if;
  return new;
end
$fn$;

drop trigger if exists marca_entrada_na_etapa on public.lead_pipeline;
create trigger marca_entrada_na_etapa
  before update on public.lead_pipeline
  for each row execute function public.tg_marca_entrada_na_etapa();


-- ============================================================================
-- PASSO 6 — TAGS
-- ============================================================================

create table if not exists public.tags (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  nome             text not null check (length(btrim(nome)) between 1 and 40),
  cor              text,
  criado_por       uuid references auth.users(id) on delete set null,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

comment on table public.tags is 'Etiquetas livres da organização.';

-- Unicidade sem diferenciar maiúsculas: evita "VIP" e "vip" convivendo.
create unique index if not exists idx_tags_org_nome
  on public.tags (organization_id, lower(btrim(nome)));

do $uk$
begin
  alter table public.tags
    add constraint tags_id_org_unico unique (id, organization_id);
exception when duplicate_object then null;
end
$uk$;

drop trigger if exists set_atualizado_em on public.tags;
create trigger set_atualizado_em
  before update on public.tags
  for each row execute function public.tg_set_atualizado_em();


create table if not exists public.lead_tags (
  organization_id  uuid not null,
  lead_id          uuid not null,
  tag_id           uuid not null,
  criado_por       uuid references auth.users(id) on delete set null,
  criado_em        timestamptz not null default now(),
  primary key (lead_id, tag_id)
);

do $fk$
begin
  alter table public.lead_tags
    add constraint lead_tags_lead_fkey
    foreign key (lead_id, organization_id)
    references public.leads(id, organization_id) on delete cascade;
exception when duplicate_object then null;
end
$fk$;

do $fk$
begin
  alter table public.lead_tags
    add constraint lead_tags_tag_fkey
    foreign key (tag_id, organization_id)
    references public.tags(id, organization_id) on delete cascade;
exception when duplicate_object then null;
end
$fk$;

create index if not exists idx_lead_tags_tag on public.lead_tags (tag_id);


-- ============================================================================
-- PASSO 7 — ACTIVITIES (linha do tempo)
-- ============================================================================
-- CLAUDE.md §6.6: eventos registrados de forma consistente DESDE JÁ, porque
-- esta tabela é a base de todos os relatórios futuros e da integração com o
-- n8n (§10). Relatório não se inventa depois: ou o evento foi gravado na
-- hora, ou aquele período fica cego para sempre.
--
-- É um livro-caixa: só recebe INSERT. Não há policy de UPDATE nem de DELETE
-- para usuário nenhum, nem admin (ver PASSO 10).

create table if not exists public.activities (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  lead_id          uuid,
  user_id          uuid references auth.users(id) on delete set null,
  tipo             text not null,
  descricao        text,
  dados            jsonb not null default '{}'::jsonb,
  criado_em        timestamptz not null default now()
);

comment on table public.activities is
  'Histórico append-only de eventos. Base dos relatórios e dos webhooks do n8n.';
comment on column public.activities.dados is
  'Detalhe do evento (valores de/para). jsonb para o formato evoluir sem migração a cada evento novo.';

do $fk$
begin
  alter table public.activities
    add constraint activities_lead_fkey
    foreign key (lead_id, organization_id)
    references public.leads(id, organization_id) on delete cascade;
exception when duplicate_object then null;
end
$fk$;

-- Vocabulário de eventos. Os nomes seguem o CLAUDE.md §10 para que a mesma
-- string sirva de gatilho no n8n sem tradução no meio do caminho.
do $ck$
begin
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
        'appointment.created'
      )
    );
exception when duplicate_object then null;
end
$ck$;

create index if not exists idx_activities_org_data
  on public.activities (organization_id, criado_em desc);
create index if not exists idx_activities_lead_data
  on public.activities (lead_id, criado_em desc);
create index if not exists idx_activities_tipo
  on public.activities (organization_id, tipo, criado_em desc);


-- ============================================================================
-- PASSO 8 — REGISTRO AUTOMÁTICO DE EVENTOS (triggers)
-- ============================================================================
-- DECISÃO: quem grava o histórico é o BANCO, não o frontend.
--
-- Motivo: um histórico que depende de a aplicação lembrar de chamar o insert
-- é um histórico com buracos — basta um caminho novo de código, um script de
-- correção ou uma edição pelo Dashboard para o evento sumir. Como esta tabela
-- é a base dos relatórios e dos disparos do n8n, ela precisa ser inescapável.
--
-- CONSEQUÊNCIA PARA OS PASSOS 2, 3 e 4: o app NÃO deve inserir activities
-- para criação, edição, troca de etapa e tags. Sairia duplicado.

create or replace function public.registrar_activity(
  p_org       uuid,
  p_lead      uuid,
  p_tipo      text,
  p_descricao text,
  p_dados     jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  insert into public.activities (organization_id, lead_id, user_id, tipo, descricao, dados)
  values (p_org, p_lead, (select auth.uid()), p_tipo, p_descricao, coalesce(p_dados, '{}'::jsonb));
end
$fn$;

comment on function public.registrar_activity(uuid, uuid, text, text, jsonb) is
  'Grava um evento no histórico. SECURITY DEFINER: o registro não pode ser recusado por RLS.';


-- 8.1 — Eventos da própria ficha do lead.
create or replace function public.tg_log_lead()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if tg_op = 'INSERT' then
    perform public.registrar_activity(
      new.organization_id, new.id, 'lead.created',
      format('Lead "%s" criado', new.nome),
      jsonb_build_object('origem', new.origem, 'responsavel_id', new.responsavel_id)
    );
    return new;
  end if;

  -- Troca de dono é evento próprio: alimenta o lead.assigned do n8n (§10).
  if new.responsavel_id is distinct from old.responsavel_id then
    perform public.registrar_activity(
      new.organization_id, new.id, 'lead.assigned',
      'Responsável alterado',
      jsonb_build_object('de', old.responsavel_id, 'para', new.responsavel_id)
    );
  end if;

  if new.arquivado is distinct from old.arquivado then
    perform public.registrar_activity(
      new.organization_id, new.id,
      case when new.arquivado then 'lead.archived' else 'lead.restored' end,
      case when new.arquivado then 'Lead arquivado' else 'Lead restaurado' end,
      '{}'::jsonb
    );
  end if;

  -- Edição de conteúdo comercial. Só registra o que realmente mudou, para o
  -- histórico não virar ruído.
  if (new.nome, new.telefone, new.email, new.origem, new.valor, new.previsao_fechamento)
     is distinct from
     (old.nome, old.telefone, old.email, old.origem, old.valor, old.previsao_fechamento)
  then
    perform public.registrar_activity(
      new.organization_id, new.id, 'lead.updated',
      'Dados do lead atualizados',
      jsonb_strip_nulls(jsonb_build_object(
        'nome',   case when new.nome   is distinct from old.nome   then jsonb_build_object('de', old.nome,   'para', new.nome)   end,
        'telefone', case when new.telefone is distinct from old.telefone then jsonb_build_object('de', old.telefone, 'para', new.telefone) end,
        'email',  case when new.email  is distinct from old.email  then jsonb_build_object('de', old.email,  'para', new.email)  end,
        'origem', case when new.origem is distinct from old.origem then jsonb_build_object('de', old.origem, 'para', new.origem) end,
        'valor',  case when new.valor  is distinct from old.valor  then jsonb_build_object('de', old.valor,  'para', new.valor)  end,
        'previsao_fechamento', case when new.previsao_fechamento is distinct from old.previsao_fechamento
                                    then jsonb_build_object('de', old.previsao_fechamento, 'para', new.previsao_fechamento) end
      ))
    );
  end if;

  return new;
end
$fn$;

drop trigger if exists log_lead on public.leads;
create trigger log_lead
  after insert or update on public.leads
  for each row execute function public.tg_log_lead();


-- 8.2 — Movimentação no Kanban.
create or replace function public.tg_log_lead_pipeline()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_etapa_nova text;
  v_etapa_velha text;
  v_pipeline text;
begin
  if tg_op = 'DELETE' then
    select p.nome into v_pipeline from public.pipelines p where p.id = old.pipeline_id;
    perform public.registrar_activity(
      old.organization_id, old.lead_id, 'lead.pipeline_removed',
      format('Removido do funil "%s"', coalesce(v_pipeline, '?')),
      jsonb_build_object('pipeline_id', old.pipeline_id)
    );
    return old;
  end if;

  select s.nome into v_etapa_nova from public.pipeline_stages s where s.id = new.stage_id;
  select p.nome into v_pipeline   from public.pipelines p      where p.id = new.pipeline_id;

  if tg_op = 'INSERT' then
    perform public.registrar_activity(
      new.organization_id, new.lead_id, 'lead.pipeline_added',
      format('Entrou no funil "%s" na etapa "%s"', coalesce(v_pipeline, '?'), coalesce(v_etapa_nova, '?')),
      jsonb_build_object('pipeline_id', new.pipeline_id, 'stage_id', new.stage_id, 'etapa', v_etapa_nova)
    );
    return new;
  end if;

  -- UPDATE: só interessa quando a etapa muda. Reordenar cartão dentro da
  -- mesma coluna não é evento de negócio.
  if new.stage_id <> old.stage_id then
    select s.nome into v_etapa_velha from public.pipeline_stages s where s.id = old.stage_id;
    perform public.registrar_activity(
      new.organization_id, new.lead_id, 'lead.stage_changed',
      format('Movido de "%s" para "%s"', coalesce(v_etapa_velha, '?'), coalesce(v_etapa_nova, '?')),
      jsonb_build_object(
        'pipeline_id', new.pipeline_id,
        'de',   jsonb_build_object('stage_id', old.stage_id, 'etapa', v_etapa_velha),
        'para', jsonb_build_object('stage_id', new.stage_id, 'etapa', v_etapa_nova)
      )
    );
  end if;

  return new;
end
$fn$;

drop trigger if exists log_lead_pipeline on public.lead_pipeline;
create trigger log_lead_pipeline
  after insert or update or delete on public.lead_pipeline
  for each row execute function public.tg_log_lead_pipeline();


-- 8.3 — Tags.
create or replace function public.tg_log_lead_tags()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_tag text;
begin
  if tg_op = 'INSERT' then
    select t.nome into v_tag from public.tags t where t.id = new.tag_id;
    perform public.registrar_activity(
      new.organization_id, new.lead_id, 'tag.added',
      format('Tag "%s" aplicada', coalesce(v_tag, '?')),
      jsonb_build_object('tag_id', new.tag_id, 'tag', v_tag)
    );
    return new;
  end if;

  select t.nome into v_tag from public.tags t where t.id = old.tag_id;
  perform public.registrar_activity(
    old.organization_id, old.lead_id, 'tag.removed',
    format('Tag "%s" removida', coalesce(v_tag, '?')),
    jsonb_build_object('tag_id', old.tag_id, 'tag', v_tag)
  );
  return old;
end
$fn$;

drop trigger if exists log_lead_tags on public.lead_tags;
create trigger log_lead_tags
  after insert or delete on public.lead_tags
  for each row execute function public.tg_log_lead_tags();


-- ============================================================================
-- PASSO 9 — AUTORIZAÇÃO: A REGRA DE CARTEIRA EM UM LUGAR SÓ
-- ============================================================================
-- A regra do CLAUDE.md §5 — gestor/admin veem tudo da organização; vendedor vê
-- os seus mais os sem responsável — apareceria copiada em seis tabelas.
-- Copiada em seis lugares, um dia divergiria em um deles. Fica aqui, uma vez.

create or replace function public.pode_ver_lead(p_lead uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1
      from public.leads l
     where l.id = p_lead
       and l.organization_id in (select public.orgs_do_usuario())
       and (
            public.e_gestor(l.organization_id)
         or l.responsavel_id = (select auth.uid())
         or l.responsavel_id is null
       )
  )
$fn$;

comment on function public.pode_ver_lead(uuid) is
  'Regra de carteira (CLAUDE.md §5). Gestor/admin: toda a organização. Vendedor: os seus + os sem dono.';

-- Escrever exige, além da carteira, licença em dia — o bloqueio de trial é
-- regra de backend (CLAUDE.md §6.5), nunca botão escondido no frontend.
create or replace function public.pode_editar_lead(p_lead uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select public.pode_ver_lead(p_lead)
     and exists (
       select 1 from public.leads l
        where l.id = p_lead
          and public.org_acesso_ativo(l.organization_id)
     )
$fn$;


-- ============================================================================
-- PASSO 10 — RLS: ATIVAÇÃO E POLICIES
-- ============================================================================
-- Mesmo padrão da fundação:
--
--   TABELA           SELECT                    ESCRITA
--   ---------------  ------------------------  --------------------------------
--   pipelines        membros da org            gestor/admin + licença ativa
--   pipeline_stages  membros da org            gestor/admin + licença ativa
--   lead_pipeline    carteira do lead          carteira + licença ativa
--   tags             membros da org            criar: membro | apagar: gestor
--   lead_tags        carteira do lead          carteira + licença ativa
--   activities       carteira do lead          INSERT apenas. Nunca UPDATE/DELETE.
--
-- Estrutura do funil (pipelines e etapas) é decisão de gestão: vendedor usa,
-- não redesenha. Se um dia a academia quiser que vendedor crie funil, muda-se
-- aqui — e só aqui.

alter table public.pipelines       enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.lead_pipeline   enable row level security;
alter table public.tags            enable row level security;
alter table public.lead_tags       enable row level security;
alter table public.activities      enable row level security;

-- ------------------------------------------------------------------ PIPELINES
drop policy if exists pipeline_select_membro on public.pipelines;
create policy pipeline_select_membro on public.pipelines
  for select to authenticated
  using (organization_id in (select public.orgs_do_usuario()));

drop policy if exists pipeline_insert_gestor on public.pipelines;
create policy pipeline_insert_gestor on public.pipelines
  for insert to authenticated
  with check (
    public.e_gestor(organization_id)
    and public.org_acesso_ativo(organization_id)
  );

drop policy if exists pipeline_update_gestor on public.pipelines;
create policy pipeline_update_gestor on public.pipelines
  for update to authenticated
  using (public.e_gestor(organization_id) and public.org_acesso_ativo(organization_id))
  with check (public.e_gestor(organization_id) and public.org_acesso_ativo(organization_id));

drop policy if exists pipeline_delete_gestor on public.pipelines;
create policy pipeline_delete_gestor on public.pipelines
  for delete to authenticated
  using (public.e_gestor(organization_id));

-- ------------------------------------------------------------ PIPELINE_STAGES
drop policy if exists stage_select_membro on public.pipeline_stages;
create policy stage_select_membro on public.pipeline_stages
  for select to authenticated
  using (organization_id in (select public.orgs_do_usuario()));

drop policy if exists stage_insert_gestor on public.pipeline_stages;
create policy stage_insert_gestor on public.pipeline_stages
  for insert to authenticated
  with check (
    public.e_gestor(organization_id)
    and public.org_acesso_ativo(organization_id)
  );

drop policy if exists stage_update_gestor on public.pipeline_stages;
create policy stage_update_gestor on public.pipeline_stages
  for update to authenticated
  using (public.e_gestor(organization_id) and public.org_acesso_ativo(organization_id))
  with check (public.e_gestor(organization_id) and public.org_acesso_ativo(organization_id));

drop policy if exists stage_delete_gestor on public.pipeline_stages;
create policy stage_delete_gestor on public.pipeline_stages
  for delete to authenticated
  using (public.e_gestor(organization_id));

-- -------------------------------------------------------------- LEAD_PIPELINE
-- Mover cartão no Kanban é editar o lead: vale a mesma carteira.
drop policy if exists lead_pipeline_select_carteira on public.lead_pipeline;
create policy lead_pipeline_select_carteira on public.lead_pipeline
  for select to authenticated
  using (public.pode_ver_lead(lead_id));

drop policy if exists lead_pipeline_insert_carteira on public.lead_pipeline;
create policy lead_pipeline_insert_carteira on public.lead_pipeline
  for insert to authenticated
  with check (
    organization_id in (select public.orgs_do_usuario())
    and public.pode_editar_lead(lead_id)
  );

drop policy if exists lead_pipeline_update_carteira on public.lead_pipeline;
create policy lead_pipeline_update_carteira on public.lead_pipeline
  for update to authenticated
  using (public.pode_editar_lead(lead_id))
  with check (
    organization_id in (select public.orgs_do_usuario())
    and public.pode_editar_lead(lead_id)
  );

drop policy if exists lead_pipeline_delete_carteira on public.lead_pipeline;
create policy lead_pipeline_delete_carteira on public.lead_pipeline
  for delete to authenticated
  using (public.pode_editar_lead(lead_id));

-- ----------------------------------------------------------------------- TAGS
drop policy if exists tag_select_membro on public.tags;
create policy tag_select_membro on public.tags
  for select to authenticated
  using (organization_id in (select public.orgs_do_usuario()));

-- Criar tag é operação do dia a dia: qualquer membro com licença ativa.
drop policy if exists tag_insert_membro on public.tags;
create policy tag_insert_membro on public.tags
  for insert to authenticated
  with check (
    organization_id in (select public.orgs_do_usuario())
    and public.org_acesso_ativo(organization_id)
  );

-- Renomear e apagar afeta os leads de todo mundo: gestor/admin.
drop policy if exists tag_update_gestor on public.tags;
create policy tag_update_gestor on public.tags
  for update to authenticated
  using (public.e_gestor(organization_id) and public.org_acesso_ativo(organization_id))
  with check (public.e_gestor(organization_id) and public.org_acesso_ativo(organization_id));

drop policy if exists tag_delete_gestor on public.tags;
create policy tag_delete_gestor on public.tags
  for delete to authenticated
  using (public.e_gestor(organization_id));

-- ------------------------------------------------------------------ LEAD_TAGS
drop policy if exists lead_tag_select_carteira on public.lead_tags;
create policy lead_tag_select_carteira on public.lead_tags
  for select to authenticated
  using (public.pode_ver_lead(lead_id));

drop policy if exists lead_tag_insert_carteira on public.lead_tags;
create policy lead_tag_insert_carteira on public.lead_tags
  for insert to authenticated
  with check (
    organization_id in (select public.orgs_do_usuario())
    and public.pode_editar_lead(lead_id)
  );

drop policy if exists lead_tag_delete_carteira on public.lead_tags;
create policy lead_tag_delete_carteira on public.lead_tags
  for delete to authenticated
  using (public.pode_editar_lead(lead_id));

-- ----------------------------------------------------------------- ACTIVITIES
-- Leitura segue a carteira: vendedor não lê o histórico de lead que não vê.
-- Eventos sem lead (organizacionais) ficam para gestor/admin.
drop policy if exists activity_select_carteira on public.activities;
create policy activity_select_carteira on public.activities
  for select to authenticated
  using (
    organization_id in (select public.orgs_do_usuario())
    and (
      case
        when lead_id is null then public.e_gestor(organization_id)
        else public.pode_ver_lead(lead_id)
      end
    )
  );

-- INSERT existe para eventos que o app precise registrar por conta própria
-- (nota, tarefa, mensagem recebida). Os eventos de CRM já vêm por trigger.
-- `user_id` só pode ser o próprio usuário: ninguém assina evento no nome de
-- outro.
drop policy if exists activity_insert_membro on public.activities;
create policy activity_insert_membro on public.activities
  for insert to authenticated
  with check (
    organization_id in (select public.orgs_do_usuario())
    and public.org_acesso_ativo(organization_id)
    and (user_id is null or user_id = (select auth.uid()))
    and (lead_id is null or public.pode_ver_lead(lead_id))
  );

-- SEM policy de UPDATE. SEM policy de DELETE. Nem para admin.
-- Histórico que pode ser reescrito não serve de histórico — nem para o
-- relatório, nem para a auditoria, nem para resolver briga de comissão.


-- ============================================================================
-- PASSO 11 — FUNIL PADRÃO PARA ORGANIZAÇÃO NOVA
-- ============================================================================
-- Sem isto, a empresa entra no Kanban e encontra tela vazia, sem saber que
-- precisa criar um funil antes. As etapas são totalmente editáveis depois.

create or replace function public.criar_pipeline_padrao(p_org uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_pipeline uuid;
begin
  -- Já tem funil? Não faz nada (idempotente, seguro para backfill).
  select id into v_pipeline
    from public.pipelines
   where organization_id = p_org
   limit 1;

  if v_pipeline is not null then
    return v_pipeline;
  end if;

  insert into public.pipelines (organization_id, nome, descricao, padrao, posicao)
  values (p_org, 'Funil principal', 'Funil criado automaticamente. Renomeie as etapas como preferir.', true, 0)
  returning id into v_pipeline;

  insert into public.pipeline_stages (organization_id, pipeline_id, nome, tipo, posicao)
  values
    (p_org, v_pipeline, 'Novo',       'aberta',  0),
    (p_org, v_pipeline, 'Em contato', 'aberta',  1),
    (p_org, v_pipeline, 'Qualificado','aberta',  2),
    (p_org, v_pipeline, 'Negociação', 'aberta',  3),
    (p_org, v_pipeline, 'Ganho',      'ganho',   4),
    (p_org, v_pipeline, 'Perdido',    'perdido', 5);

  return v_pipeline;
end
$fn$;

-- Passa a fazer parte do nascimento de toda organização nova.
-- Mesma função da 0001, agora com o funil padrão no fim. O resto é idêntico:
-- duração do trial continua constante de servidor, nunca parâmetro do cliente.
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

  insert into public.memberships (organization_id, user_id, papel, ativo)
  values (v_org, v_user, 'admin', true);

  insert into public.subscriptions
    (organization_id, plano, status, trial_inicio, trial_fim)
  values
    (v_org, 'trial', 'trial', now(), now() + make_interval(days => c_trial_dias));

  insert into public.profiles (id, email)
  select v_user, u.email from auth.users u where u.id = v_user
  on conflict (id) do nothing;

  -- NOVO NA FASE 3: a empresa já entra com um funil utilizável.
  perform public.criar_pipeline_padrao(v_org);

  return v_org;
end
$fn$;

-- Backfill: as organizações que já existem (a sua, de teste) também ganham
-- o funil padrão.
do $seed$
declare
  r record;
begin
  for r in select id from public.organizations loop
    perform public.criar_pipeline_padrao(r.id);
  end loop;
end
$seed$;


-- ============================================================================
-- PASSO 12 — GRANTS (defesa em profundidade)
-- ============================================================================
-- Sem sessão, sem dados — nem tentativa. Mesmo tratamento da fundação.

revoke all on table public.pipelines       from anon;
revoke all on table public.pipeline_stages from anon;
revoke all on table public.lead_pipeline   from anon;
revoke all on table public.tags            from anon;
revoke all on table public.lead_tags       from anon;
revoke all on table public.activities      from anon;

grant select, insert, update, delete on table public.pipelines       to authenticated;
grant select, insert, update, delete on table public.pipeline_stages to authenticated;
grant select, insert, update, delete on table public.lead_pipeline   to authenticated;
grant select, insert, update, delete on table public.tags            to authenticated;
grant select, insert, delete         on table public.lead_tags       to authenticated;
-- activities: sem UPDATE e sem DELETE nem no nível de GRANT.
grant select, insert                 on table public.activities      to authenticated;

revoke execute on function public.pode_ver_lead(uuid)                       from public, anon;
revoke execute on function public.pode_editar_lead(uuid)                    from public, anon;
revoke execute on function public.criar_pipeline_padrao(uuid)               from public, anon;
revoke execute on function public.registrar_activity(uuid, uuid, text, text, jsonb) from public, anon;

grant execute on function public.pode_ver_lead(uuid)    to authenticated;
grant execute on function public.pode_editar_lead(uuid) to authenticated;
-- criar_pipeline_padrao e registrar_activity são chamadas por dentro do banco
-- (pela criar_organizacao e pelos triggers). O cliente não precisa delas.


-- ============================================================================
-- PASSO 13 — VERIFICAÇÃO (rode e confira os resultados)
-- ============================================================================

-- 13.1 — RLS ligado em TODAS as tabelas de negócio (esperado: 11 linhas true).
select c.relname as tabela, c.relrowsecurity as rls_ligado
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('organizations','memberships','subscriptions','profiles',
                     'leads','pipelines','pipeline_stages','lead_pipeline',
                     'tags','lead_tags','activities')
 order by c.relname;

-- 13.2 — Policies por tabela nova.
--   Esperado: pipelines 4, pipeline_stages 4, lead_pipeline 4, tags 4,
--             lead_tags 3, activities 2.
select tablename, count(*) as policies
  from pg_policies
 where schemaname = 'public'
   and tablename in ('pipelines','pipeline_stages','lead_pipeline','tags','lead_tags','activities')
 group by tablename
 order by tablename;

-- 13.3 — `activities` não pode ter policy de UPDATE nem de DELETE (esperado: 0).
select count(*) as policies_de_escrita_indevida
  from pg_policies
 where schemaname = 'public'
   and tablename = 'activities'
   and cmd in ('UPDATE', 'DELETE');

-- 13.4 — Toda organização tem funil padrão com 6 etapas.
select o.nome as organizacao,
       p.nome as funil,
       (select count(*) from public.pipeline_stages s where s.pipeline_id = p.id) as etapas
  from public.organizations o
  left join public.pipelines p on p.organization_id = o.id and p.padrao
 order by o.nome;

-- 13.5 — As FKs COMPOSTAS que impedem mistura entre organizações.
--   Esperado: 7 linhas —
--     pipeline_stages 1, lead_pipeline 3, lead_tags 2, activities 1.
select conrelid::regclass as tabela,
       conname            as constraint_name,
       array_length(conkey, 1) as colunas
  from pg_constraint
 where contype = 'f'
   and array_length(conkey, 1) > 1        -- só as compostas
   and conrelid::regclass::text in
       ('pipeline_stages','lead_pipeline','lead_tags','activities')
 order by tabela, conname;

-- 13.6 — Nenhum vínculo pode existir com organização divergente do lead
--        (esperado: 0 em todas as colunas). Se der diferente de zero, PARE.
select
  (select count(*) from public.lead_pipeline lp
     join public.leads l on l.id = lp.lead_id
    where l.organization_id <> lp.organization_id)      as lead_pipeline_divergente,
  (select count(*) from public.lead_tags lt
     join public.leads l on l.id = lt.lead_id
    where l.organization_id <> lt.organization_id)      as lead_tags_divergente,
  (select count(*) from public.activities a
     join public.leads l on l.id = a.lead_id
    where l.organization_id <> a.organization_id)       as activities_divergente;
