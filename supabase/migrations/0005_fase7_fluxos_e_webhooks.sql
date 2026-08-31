-- ============================================================================
--  BYTECH3 — PLATAFORMA WEB (CRM + WhatsApp)
--  FASE 7 — FLUXOS DE ATENDIMENTO + WEBHOOKS COM ENTREGA CONFIÁVEL
--  Arquivo: supabase/migrations/0005_fase7_fluxos_e_webhooks.sql
--
--  COMO RODAR:
--    Supabase Dashboard > SQL Editor > cole este arquivo inteiro > Run.
--    O script é IDEMPOTENTE: pode ser rodado mais de uma vez sem quebrar.
--
--    ANTES DE RODAR, habilite duas extensões em
--    Dashboard > Database > Extensions:  `pg_cron`  e  `pg_net`.
--    O PASSO 0 tenta habilitá-las sozinho; se o seu projeto não permitir via
--    SQL, ele avisa com NOTICE e o resto do arquivo continua funcionando —
--    só o agendamento automático fica de fora até você ligar pelo painel.
--
--  O QUE ESTE ARQUIVO FAZ:
--    1) `webhooks`           — os endereços de destino (n8n, API oficial…).
--    2) `webhook_entregas`   — uma linha por entrega, com tentativas e
--                              recuo exponencial. Nada se perde em silêncio.
--    3) `fluxos`, `fluxo_gatilhos`, `fluxo_acoes` — o construtor: o que
--                              começa o fluxo e o que ele faz.
--    4) `fluxo_execucoes`    — cada ação agendada para cada lead, com o
--                              estado dela. É o histórico do que a automação
--                              fez, e o que impede um fluxo de rodar duas
--                              vezes para o mesmo fato.
--    5) O motor: gatilho em `activities` + dois jobs de `pg_cron`.
--    6) `simular_fluxo()`    — mostra o que ACONTECERIA, sem fazer nada.
--
--  A RESTRIÇÃO QUE MANDA NO DESENHO (briefing §14 e Apêndice B):
--    A ação de ENVIAR MENSAGEM dentro de um fluxo automático sai como CHAMADA
--    DE WEBHOOK — para o n8n ou para a API oficial do WhatsApp. NUNCA como
--    disparo pela extensão. Automatizar envio pelo WhatsApp Web é o caminho
--    mais curto para o número do cliente ser banido, e o número é o ativo do
--    cliente, não nosso.
--
--    Isso não é só uma convenção: não existe, em lugar nenhum deste arquivo,
--    caminho do banco para a extensão. A ação `mensagem` só sabe criar uma
--    linha em `webhook_entregas`. O envio manual, um por vez, iniciado por um
--    clique do vendedor, continua exatamente como está — e continua sendo o
--    único jeito de a extensão enviar qualquer coisa.
-- ============================================================================


-- ============================================================================
-- PASSO 0 — EXTENSÕES
-- ============================================================================
-- `pg_net`  faz a chamada HTTP de dentro do banco, de forma ASSÍNCRONA: ele
--           devolve um id na hora e a resposta chega depois, numa tabela
--           própria. É por isso que existem DOIS jobs adiante — um que envia
--           e outro que confere o que voltou.
-- `pg_cron` acorda os jobs de minuto em minuto.
-- `pgcrypto` assina o corpo de cada entrega (HMAC-SHA256), para o n8n poder
--           conferir que o pedido veio mesmo daqui.

do $ext$
begin
  create extension if not exists pgcrypto with schema extensions;
exception when others then
  raise notice '[0005] pgcrypto não pôde ser criado aqui: %. Habilite em Dashboard > Database > Extensions.', sqlerrm;
end
$ext$;

do $ext$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice '[0005] pg_net não pôde ser criado aqui: %. Habilite em Dashboard > Database > Extensions.', sqlerrm;
end
$ext$;

do $ext$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice '[0005] pg_cron não pôde ser criado aqui: %. Habilite em Dashboard > Database > Extensions.', sqlerrm;
end
$ext$;


-- ============================================================================
-- PASSO 1 — A GUARDA DE SSRF: QUE ENDEREÇOS PODEM SER CHAMADOS
-- ============================================================================
-- LEIA ISTO ANTES DE AFROUXAR QUALQUER LINHA ABAIXO.
--
-- A partir desta migration, o BANCO faz chamadas HTTP para um endereço que um
-- usuário digitou. Sem guarda, qualquer gestor poderia cadastrar um webhook
-- apontando para `http://169.254.169.254/...` (o serviço de metadados da
-- nuvem), para `http://localhost:5432` ou para um IP interno — e usar o nosso
-- banco como ponte para dentro da infraestrutura. Isso tem nome: SSRF.
--
-- A regra: só `https`, só porta padrão ou explícita acima de 1023, e nunca
-- um host que seja loopback, rede privada, link-local ou nome sem ponto.
--
-- LIMITAÇÃO HONESTA: a checagem é sobre o TEXTO da URL. Um domínio público
-- que resolve para 10.0.0.1 (DNS rebinding) passa por aqui. Fechar isso de
-- verdade exige um proxy de saída com lista de permissões, que é infra e não
-- SQL. O que esta função entrega é a barreira contra o erro comum e contra o
-- abuso óbvio — não contra um atacante determinado com controle de DNS.

create or replace function public.url_de_webhook_segura(p_url text)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = public, pg_temp
as $fn$
declare
  v_host text;
begin
  if p_url is null or length(p_url) > 2000 then
    return false;
  end if;

  -- Só https. `http` puro mandaria segredo e dado de lead em texto claro.
  if p_url !~* '^https://' then
    return false;
  end if;

  -- Host = o que vem depois de "https://" e antes de "/", "?" ou "#".
  -- Também descarta "usuario:senha@host", truque clássico para enganar
  -- validação escrita às pressas.
  v_host := lower(split_part(regexp_replace(p_url, '^https://', ''), '/', 1));
  v_host := split_part(v_host, '?', 1);
  v_host := split_part(v_host, '#', 1);
  if position('@' in v_host) > 0 then
    return false;
  end if;
  v_host := split_part(v_host, ':', 1);

  if v_host = '' then
    return false;
  end if;

  -- Sem ponto não é nome público: "localhost", "metadata", "db".
  if position('.' in v_host) = 0 then
    return false;
  end if;

  -- Loopback, link-local (metadados da nuvem) e faixas privadas — pelo nome
  -- e pelo número.
  if v_host in ('localhost.localdomain') then
    return false;
  end if;

  if v_host ~ '^127\.'                       -- loopback
     or v_host ~ '^10\.'                     -- privada A
     or v_host ~ '^192\.168\.'               -- privada C
     or v_host ~ '^169\.254\.'               -- link-local / metadados
     or v_host ~ '^0\.'                      -- "este host"
     or v_host ~ '^172\.(1[6-9]|2[0-9]|3[01])\.'   -- privada B
     or v_host ~ '\.local$'
     or v_host ~ '\.internal$'
  then
    return false;
  end if;

  return true;
end
$fn$;

comment on function public.url_de_webhook_segura(text) is
  'A URL do webhook é aceitável? https, host público, sem loopback/rede privada. Barreira contra SSRF.';


-- ============================================================================
-- PASSO 2 — WEBHOOKS: OS DESTINOS
-- ============================================================================
create table if not exists public.webhooks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,

  nome             text not null check (length(btrim(nome)) between 1 and 80),
  url              text not null check (public.url_de_webhook_segura(url)),

  -- Segredo do HMAC. NUNCA sai desta tabela para o app: veja os GRANTs de
  -- coluna no PASSO 11. Quem lê é só o motor, que roda com privilégio próprio.
  segredo          text not null default encode(gen_random_bytes(32), 'hex')
                     check (length(segredo) between 16 and 200),

  ativo            boolean not null default true,

  -- Quantas vezes insistir antes de desistir de uma entrega.
  max_tentativas   int not null default 5 check (max_tentativas between 1 and 10),
  -- Tempo limite de cada chamada. Curto de propósito: o job roda a cada
  -- minuto e não pode ficar preso esperando um destino que não responde.
  timeout_ms       int not null default 8000 check (timeout_ms between 1000 and 30000),

  criado_por       uuid references auth.users(id) on delete set null,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),

  unique (organization_id, nome)
);

-- Chave composta para as FKs de `webhook_entregas` e `fluxo_acoes` apontarem
-- para (id, organization_id) — a mesma defesa em profundidade das outras
-- tabelas: nada aponta para o webhook de outra empresa, nem por acidente.
-- Precisa existir ANTES das FKs que a usam.
do $uk$
begin
  alter table public.webhooks add constraint webhooks_id_org_key unique (id, organization_id);
exception when duplicate_object then null; when duplicate_table then null;
end
$uk$;

comment on table public.webhooks is
  'Destinos HTTP da organização (n8n, API oficial do WhatsApp). O segredo assina cada entrega e não é legível pelo app.';
comment on column public.webhooks.segredo is
  'Chave do HMAC-SHA256 enviado no cabeçalho X-ByTech3-Assinatura. Sem SELECT para authenticated (PASSO 11).';

create index if not exists idx_webhooks_org on public.webhooks (organization_id) where ativo;

drop trigger if exists set_atualizado_em on public.webhooks;
create trigger set_atualizado_em
  before update on public.webhooks
  for each row execute function public.tg_set_atualizado_em();


-- ============================================================================
-- PASSO 3 — ENTREGAS: UMA LINHA POR TENTATIVA DE CHEGAR AO DESTINO
-- ============================================================================
-- POR QUE UMA TABELA, E NÃO "CHAMA E TORCE":
--   O destino cai, a rede oscila, o n8n reinicia. Sem fila persistida, o
--   disparo some e ninguém fica sabendo — e "o cliente não recebeu a mensagem
--   e não há como saber por quê" é o pior defeito possível num produto de
--   atendimento. Aqui cada entrega tem estado, contagem de tentativas, o
--   último código HTTP e o último erro, visíveis na tela.
--
-- SOBRE O CONTEÚDO GUARDADO EM `payload` — LEIA, É UMA DECISÃO:
--   A regra do produto é não guardar HISTÓRICO DE CONVERSA: nada do que o
--   cliente escreveu, nada do que foi lido do WhatsApp Web. Isso continua
--   valendo e não é afetado por esta tabela.
--
--   O que entra aqui é DIFERENTE em natureza: é o texto que a própria empresa
--   escreveu no modelo do fluxo, já preenchido com os dados do lead, a
--   caminho do destino. Precisa estar gravado porque uma entrega que falha
--   precisa ser repetida com o mesmo corpo — senão "tentar de novo" não
--   existe. E, por ser mensagem automática da empresa, ela também é a prova
--   do que foi disparado em nome dela.
--
--   Mesmo assim não fica para sempre: `limpar_entregas_antigas()` apaga o que
--   já foi entregue depois de 30 dias (PASSO 9). Se você preferir outro prazo,
--   ou preferir zerar o `payload` assim que a entrega é confirmada, é uma
--   linha de mudança — me diga antes de rodar.

create table if not exists public.webhook_entregas (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  webhook_id       uuid not null,

  -- Nome do evento que gerou a entrega. Vocabulário de `activities`, ou
  -- 'fluxo.mensagem' / 'fluxo.webhook' quando vem de uma ação de fluxo.
  evento           text not null check (length(btrim(evento)) between 1 and 60),
  payload          jsonb not null default '{}'::jsonb,

  -- Para a tela mostrar "a quem" sem precisar abrir o payload.
  lead_id          uuid,

  situacao         text not null default 'pendente'
                     check (situacao in ('pendente', 'enviando', 'entregue', 'falhou', 'desistiu')),

  tentativas       int not null default 0 check (tentativas >= 0),
  proxima_em       timestamptz not null default now(),

  -- Id que o pg_net devolve na hora do envio. A resposta chega depois, e é
  -- por ele que a encontramos em `net._http_response`.
  requisicao_id    bigint,

  ultimo_status    int,
  ultimo_erro      text,

  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  entregue_em      timestamptz
);

comment on table public.webhook_entregas is
  'Fila de entregas com tentativas e recuo exponencial. Guarda o corpo enviado (mensagem da empresa, não conversa do cliente) e é limpa aos 30 dias.';
comment on column public.webhook_entregas.proxima_em is
  'Quando tentar de novo. Recuo exponencial: 1, 2, 4, 8, 16 minutos.';

do $fk$
begin
  alter table public.webhook_entregas
    add constraint webhook_entregas_webhook_fkey
    foreign key (webhook_id, organization_id)
    references public.webhooks(id, organization_id) on delete cascade;
exception when duplicate_object then null;
end
$fk$;

do $fk$
begin
  alter table public.webhook_entregas
    add constraint webhook_entregas_lead_fkey
    foreign key (lead_id, organization_id)
    references public.leads(id, organization_id) on delete set null;
exception when duplicate_object then null;
end
$fk$;

-- O índice que o job usa: só o que está para sair, na ordem em que vence.
create index if not exists idx_entregas_a_enviar
  on public.webhook_entregas (proxima_em)
  where situacao in ('pendente', 'falhou');

create index if not exists idx_entregas_em_voo
  on public.webhook_entregas (requisicao_id)
  where situacao = 'enviando';

create index if not exists idx_entregas_org_data
  on public.webhook_entregas (organization_id, criado_em desc);

drop trigger if exists set_atualizado_em on public.webhook_entregas;
create trigger set_atualizado_em
  before update on public.webhook_entregas
  for each row execute function public.tg_set_atualizado_em();


-- ============================================================================
-- PASSO 4 — FLUXOS, GATILHOS E AÇÕES
-- ============================================================================
create table if not exists public.fluxos (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,

  nome             text not null check (length(btrim(nome)) between 1 and 80),
  descricao        text check (descricao is null or length(descricao) <= 500),

  -- Nasce DESLIGADO, sempre. Um fluxo que começa ativo dispara para a base
  -- inteira antes de alguém conferir o que ele faz.
  ativo            boolean not null default false,

  -- O fluxo pode rodar mais de uma vez para o mesmo lead?
  --   false (padrão) — "boas-vindas" roda uma vez por lead e pronto.
  --   true            — "mudou de etapa" pode valer a cada mudança.
  repetir          boolean not null default false,

  criado_por       uuid references auth.users(id) on delete set null,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),

  unique (organization_id, nome)
);

comment on table public.fluxos is
  'Automação de atendimento: um gatilho e uma sequência de ações. Nasce desativado de propósito.';
comment on column public.fluxos.repetir is
  'Pode rodar de novo para o mesmo lead? Falso evita o clássico "cliente recebeu boas-vindas quatro vezes".';

do $uk$
begin
  alter table public.fluxos add constraint fluxos_id_org_key unique (id, organization_id);
exception when duplicate_object then null; when duplicate_table then null;
end
$uk$;

drop trigger if exists set_atualizado_em on public.fluxos;
create trigger set_atualizado_em
  before update on public.fluxos
  for each row execute function public.tg_set_atualizado_em();


-- ---------------------------------------------------------------- GATILHOS
-- O que faz o fluxo começar. Os nomes de evento são os MESMOS de
-- `activities.tipo` — de propósito: o vocabulário que já alimenta o histórico
-- e o n8n serve de gatilho sem tradução no meio do caminho.
--
-- Os filtros são opcionais e se somam (E, não OU): "entrou na etapa X" +
-- "origem Instagram" só dispara quando as duas coisas valem.

create table if not exists public.fluxo_gatilhos (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  fluxo_id         uuid not null,

  evento           text not null check (
    evento in (
      'lead.created',
      'lead.assigned',
      'lead.stage_changed',
      'lead.pipeline_added',
      'lead.archived',
      'lead.restored',
      'tag.added',
      'tag.removed',
      'message.received'
    )
  ),

  -- Filtros. `null` = não filtra por isso.
  pipeline_id      uuid,
  stage_id         uuid,
  tag_id           uuid,
  origem           text,

  criado_em        timestamptz not null default now()
);

comment on table public.fluxo_gatilhos is
  'O que começa o fluxo. Evento do vocabulário de activities, com filtros opcionais que se somam.';

do $fk$
begin
  alter table public.fluxo_gatilhos
    add constraint fluxo_gatilhos_fluxo_fkey
    foreign key (fluxo_id, organization_id)
    references public.fluxos(id, organization_id) on delete cascade;
exception when duplicate_object then null;
end
$fk$;

create index if not exists idx_gatilhos_por_evento
  on public.fluxo_gatilhos (organization_id, evento);
create index if not exists idx_gatilhos_do_fluxo
  on public.fluxo_gatilhos (fluxo_id);


-- ------------------------------------------------------------------ AÇÕES
-- O que o fluxo FAZ, em ordem, com atraso opcional entre uma e outra.
--
-- OS QUATRO TIPOS, E POR QUE SÃO SÓ QUATRO:
--   mensagem     -> monta o texto do modelo e MANDA PARA UM WEBHOOK. É o
--                   único caminho de envio automático que existe. Config:
--                   { "webhook_id": uuid, "modelo": "Olá {{nome}}…" }
--   webhook      -> chamada crua, para o gestor plugar o que quiser no n8n.
--                   Config: { "webhook_id": uuid, "extra": { … } }
--   etiqueta     -> aplica uma tag no lead. Config: { "tag_id": uuid }
--   mover_etapa  -> move o lead para uma etapa. Config:
--                   { "pipeline_id": uuid, "stage_id": uuid }
--
--   Ficaram de fora, de propósito, ações que apagam ou reatribuem coisas.
--   Automação que remove dado é a que ninguém percebe até faltar.

create table if not exists public.fluxo_acoes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  fluxo_id         uuid not null,

  ordem            int not null default 0 check (ordem >= 0),
  tipo             text not null check (tipo in ('mensagem', 'webhook', 'etiqueta', 'mover_etapa')),
  config           jsonb not null default '{}'::jsonb,

  -- Espera antes de executar, contada do momento do gatilho. Teto de 30 dias:
  -- mais que isso é agendamento de campanha, não fluxo de atendimento.
  atraso_minutos   int not null default 0 check (atraso_minutos between 0 and 43200),

  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),

  unique (fluxo_id, ordem)
);

comment on table public.fluxo_acoes is
  'Passos do fluxo, em ordem. A ação "mensagem" sai por webhook — nunca pela extensão.';
comment on column public.fluxo_acoes.atraso_minutos is
  'Espera contada do gatilho, não da ação anterior. Assim mudar o passo 2 não desloca o passo 3.';

do $fk$
begin
  alter table public.fluxo_acoes
    add constraint fluxo_acoes_fluxo_fkey
    foreign key (fluxo_id, organization_id)
    references public.fluxos(id, organization_id) on delete cascade;
exception when duplicate_object then null;
end
$fk$;

do $uk$
begin
  alter table public.fluxo_acoes add constraint fluxo_acoes_id_org_key unique (id, organization_id);
exception when duplicate_object then null; when duplicate_table then null;
end
$uk$;

create index if not exists idx_acoes_do_fluxo
  on public.fluxo_acoes (fluxo_id, ordem);

drop trigger if exists set_atualizado_em on public.fluxo_acoes;
create trigger set_atualizado_em
  before update on public.fluxo_acoes
  for each row execute function public.tg_set_atualizado_em();


-- A CONFIG TEM QUE FAZER SENTIDO PARA O TIPO, E APONTAR PARA DENTRO DA
-- ORGANIZAÇÃO. Sem isto, um gestor poderia salvar uma ação `mensagem` sem
-- webhook (que só falharia meses depois, na primeira execução) ou apontando
-- para o webhook de OUTRA empresa. A validação é aqui, no banco, porque o
-- formulário do app não é a barreira — é a conveniência.
create or replace function public.tg_valida_acao_de_fluxo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_webhook uuid;
  v_tag     uuid;
  v_stage   uuid;
  v_pipe    uuid;
begin
  if new.tipo in ('mensagem', 'webhook') then
    v_webhook := nullif(new.config->>'webhook_id', '')::uuid;
    if v_webhook is null then
      raise exception 'A ação "%" precisa de um webhook de destino.', new.tipo
        using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.webhooks w
       where w.id = v_webhook and w.organization_id = new.organization_id
    ) then
      raise exception 'O webhook escolhido não é desta organização.' using errcode = '23503';
    end if;
  end if;

  if new.tipo = 'mensagem' then
    if coalesce(btrim(new.config->>'modelo'), '') = '' then
      raise exception 'A ação "mensagem" precisa de um modelo de texto.' using errcode = '23514';
    end if;
    if length(new.config->>'modelo') > 2000 then
      raise exception 'O modelo da mensagem passa de 2000 caracteres.' using errcode = '23514';
    end if;
  end if;

  if new.tipo = 'etiqueta' then
    v_tag := nullif(new.config->>'tag_id', '')::uuid;
    if v_tag is null or not exists (
      select 1 from public.tags t
       where t.id = v_tag and t.organization_id = new.organization_id
    ) then
      raise exception 'A etiqueta escolhida não é desta organização.' using errcode = '23503';
    end if;
  end if;

  if new.tipo = 'mover_etapa' then
    v_pipe  := nullif(new.config->>'pipeline_id', '')::uuid;
    v_stage := nullif(new.config->>'stage_id', '')::uuid;
    if v_pipe is null or v_stage is null then
      raise exception 'A ação "mover_etapa" precisa de funil e etapa.' using errcode = '23514';
    end if;
    if not exists (
      select 1
        from public.pipeline_stages s
        join public.pipelines p on p.id = s.pipeline_id
       where s.id = v_stage
         and s.pipeline_id = v_pipe
         and p.organization_id = new.organization_id
    ) then
      raise exception 'A etapa escolhida não pertence a esse funil desta organização.'
        using errcode = '23503';
    end if;
  end if;

  return new;
end
$fn$;

drop trigger if exists valida_acao_de_fluxo on public.fluxo_acoes;
create trigger valida_acao_de_fluxo
  before insert or update on public.fluxo_acoes
  for each row execute function public.tg_valida_acao_de_fluxo();


-- ============================================================================
-- PASSO 5 — EXECUÇÕES: O QUE A AUTOMAÇÃO FEZ, E O QUE VAI FAZER
-- ============================================================================
-- Uma linha por (ação, lead, fato que disparou). É ao mesmo tempo a AGENDA
-- (o job procura o que venceu) e o HISTÓRICO (a tela mostra o que rodou e o
-- que deu errado).
--
-- `activity_id` é a chave da IDEMPOTÊNCIA. O gatilho roda por linha inserida
-- em `activities`; se o mesmo fato chegar duas vezes — retentativa, script de
-- correção, dedo pesado no Dashboard — o índice único recusa a segunda. E
-- para fluxo com `repetir = false` existe um segundo índice, que ignora o
-- fato e trava por lead.

create table if not exists public.fluxo_execucoes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,

  fluxo_id         uuid not null,
  acao_id          uuid not null,
  lead_id          uuid,

  -- O evento que disparou. `null` quando veio da simulação/execução manual.
  activity_id      uuid,

  executar_em      timestamptz not null default now(),

  situacao         text not null default 'agendada'
                     check (situacao in ('agendada', 'executada', 'falhou', 'cancelada')),

  tentativas       int not null default 0 check (tentativas >= 0),
  erro             text,

  -- Preenchido quando a ação virou uma entrega de webhook, para a tela ligar
  -- o passo do fluxo ao que aconteceu na fila.
  entrega_id       uuid references public.webhook_entregas(id) on delete set null,

  criado_em        timestamptz not null default now(),
  executado_em     timestamptz
);

comment on table public.fluxo_execucoes is
  'Agenda e histórico da automação: cada ação de cada fluxo para cada lead, com o estado.';

do $fk$
begin
  alter table public.fluxo_execucoes
    add constraint fluxo_execucoes_fluxo_fkey
    foreign key (fluxo_id, organization_id)
    references public.fluxos(id, organization_id) on delete cascade;
exception when duplicate_object then null;
end
$fk$;

do $fk$
begin
  alter table public.fluxo_execucoes
    add constraint fluxo_execucoes_acao_fkey
    foreign key (acao_id, organization_id)
    references public.fluxo_acoes(id, organization_id) on delete cascade;
exception when duplicate_object then null;
end
$fk$;

do $fk$
begin
  alter table public.fluxo_execucoes
    add constraint fluxo_execucoes_lead_fkey
    foreign key (lead_id, organization_id)
    references public.leads(id, organization_id) on delete cascade;
exception when duplicate_object then null;
end
$fk$;

-- Mesmo fato, mesma ação, mesmo lead: uma vez só.
create unique index if not exists idx_execucao_por_fato
  on public.fluxo_execucoes (acao_id, lead_id, activity_id)
  where activity_id is not null;

-- NÃO existe índice único por (fluxo, ação, lead): ele impediria o fluxo com
-- `repetir = true` de rodar uma segunda vez, que é justamente para o que essa
-- opção serve. Quem garante a vez única do `repetir = false` é a checagem no
-- gatilho (PASSO 6) — e a janela de corrida ali é de milissegundos, entre
-- dois eventos do mesmo lead, com consequência pequena e visível na tela.

create index if not exists idx_execucoes_a_rodar
  on public.fluxo_execucoes (executar_em)
  where situacao = 'agendada';

create index if not exists idx_execucoes_do_lead
  on public.fluxo_execucoes (organization_id, lead_id, criado_em desc);


-- ============================================================================
-- PASSO 6 — O GATILHO: DE `activities` PARA A AGENDA
-- ============================================================================
-- POR QUE ELE NÃO PODE FALHAR RUIDOSAMENTE:
--   `activities` é preenchida por triggers em `leads`, `lead_pipeline` e
--   `lead_tags`. Se este gatilho levantar exceção, ele derruba a transação
--   INTEIRA — ou seja, um fluxo mal configurado impediria o vendedor de
--   arrastar um cartão no Kanban. Inaceitável.
--
--   Por isso o corpo inteiro fica dentro de um bloco com EXCEPTION: em
--   plpgsql isso abre uma subtransação, e o erro é registrado como WARNING
--   sem tocar no que já foi gravado. A automação pode falhar; o CRM, não.

create or replace function public.tg_disparar_fluxos()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_origem text;
begin
  begin
    -- Sem lead não há a quem aplicar a automação.
    if new.lead_id is null then
      return new;
    end if;

    -- DISJUNTOR CONTRA LAÇO. Um fluxo pode aplicar uma etiqueta, e etiqueta
    -- aplicada é `tag.added`, que pode ser gatilho de outro fluxo. Na prática
    -- o ciclo trava sozinho (`on conflict do nothing` no lead_tags impede o
    -- segundo evento igual, e `repetir = false` impede a repetição), mas
    -- "na prática trava" não é garantia. Isto é a garantia: acima de quatro
    -- níveis de gatilho encadeado, a automação para de agendar.
    if pg_trigger_depth() > 4 then
      raise warning '[fluxos] profundidade de gatilho alta (%): não agendei para a activity %.',
        pg_trigger_depth(), new.id;
      return new;
    end if;

    -- LICENÇA: organização bloqueada não dispara automação. O mesmo bloqueio
    -- que recusa a escrita na tela vale aqui — senão um cliente com o teste
    -- vencido continuaria mandando mensagem em nome da plataforma.
    if not public.org_acesso_ativo(new.organization_id) then
      return new;
    end if;

    select l.origem into v_origem from public.leads l where l.id = new.lead_id;

    insert into public.fluxo_execucoes (
      organization_id, fluxo_id, acao_id, lead_id, activity_id, executar_em
    )
    select f.organization_id,
           f.id,
           a.id,
           new.lead_id,
           new.id,
           new.criado_em + make_interval(mins => a.atraso_minutos)
      from public.fluxos f
      join public.fluxo_gatilhos g on g.fluxo_id = f.id
      join public.fluxo_acoes    a on a.fluxo_id = f.id
     where f.organization_id = new.organization_id
       and f.ativo
       and g.evento = new.tipo
       -- Filtros do gatilho. Cada um só restringe quando foi preenchido.
       and (g.pipeline_id is null or g.pipeline_id::text = new.dados->>'pipeline_id')
       and (
         g.stage_id is null
         or g.stage_id::text = new.dados->>'stage_id'                    -- pipeline_added
         or g.stage_id::text = new.dados->'para'->>'stage_id'            -- stage_changed
       )
       and (g.tag_id is null or g.tag_id::text = new.dados->>'tag_id')
       and (g.origem is null or g.origem = v_origem)
       -- Fluxo que não repete: só se este lead ainda não passou por ele.
       and (
         f.repetir
         or not exists (
           select 1 from public.fluxo_execucoes e
            where e.fluxo_id = f.id
              and e.lead_id = new.lead_id
              and e.situacao <> 'cancelada'
         )
       )
    on conflict do nothing;

  exception when others then
    -- A automação falhou; o fato que a disparou continua gravado.
    raise warning '[fluxos] não consegui agendar para a activity %: %', new.id, sqlerrm;
  end;

  return new;
end
$fn$;

drop trigger if exists disparar_fluxos on public.activities;
create trigger disparar_fluxos
  after insert on public.activities
  for each row execute function public.tg_disparar_fluxos();


-- ============================================================================
-- PASSO 7 — O MOTOR: EXECUTA AS AÇÕES QUE VENCERAM
-- ============================================================================
-- Preenche o modelo da mensagem com os dados do lead. Deliberadamente burro:
-- substituição de texto, sem expressão, sem condicional, sem laço. Modelo que
-- vira linguagem de programação vira superfície de ataque e fonte de erro que
-- só aparece na frente do cliente.
create or replace function public.montar_texto_do_modelo(p_modelo text, p_lead uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_lead   public.leads%rowtype;
  v_texto  text := coalesce(p_modelo, '');
  v_etapa  text;
  v_resp   text;
begin
  select * into v_lead from public.leads where id = p_lead;
  if not found then
    return v_texto;
  end if;

  select s.nome into v_etapa
    from public.lead_pipeline lp
    join public.pipeline_stages s on s.id = lp.stage_id
   where lp.lead_id = p_lead
   order by lp.atualizado_em desc
   limit 1;

  select p.nome_completo into v_resp
    from public.profiles p
   where p.id = v_lead.responsavel_id;

  -- `primeiro_nome` existe porque "Olá João Carlos da Silva Pereira," soa
  -- como formulário, e "Olá João," soa como gente.
  v_texto := replace(v_texto, '{{nome}}',           coalesce(v_lead.nome, ''));
  v_texto := replace(v_texto, '{{primeiro_nome}}',  coalesce(split_part(v_lead.nome, ' ', 1), ''));
  v_texto := replace(v_texto, '{{telefone}}',       coalesce(v_lead.telefone, ''));
  v_texto := replace(v_texto, '{{email}}',          coalesce(v_lead.email, ''));
  v_texto := replace(v_texto, '{{origem}}',         coalesce(v_lead.origem, ''));
  v_texto := replace(v_texto, '{{etapa}}',          coalesce(v_etapa, ''));
  v_texto := replace(v_texto, '{{responsavel}}',    coalesce(v_resp, ''));

  return v_texto;
end
$fn$;

comment on function public.montar_texto_do_modelo(text, uuid) is
  'Troca {{nome}}, {{primeiro_nome}}, {{telefone}}, {{email}}, {{origem}}, {{etapa}} e {{responsavel}}. Substituição pura, sem lógica.';


-- O recorte do lead que vai no corpo do webhook. Função própria para o
-- formato ser UM só: mudou aqui, mudou em toda entrega.
create or replace function public.lead_para_webhook(p_lead uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select jsonb_build_object(
    'id',          l.id,
    'nome',        l.nome,
    'telefone',    l.telefone,
    'email',       l.email,
    'origem',      l.origem,
    'valor',       l.valor,
    'responsavel', (select p.nome_completo from public.profiles p where p.id = l.responsavel_id),
    'etapa',       (
      select s.nome
        from public.lead_pipeline lp
        join public.pipeline_stages s on s.id = lp.stage_id
       where lp.lead_id = l.id
       order by lp.atualizado_em desc
       limit 1
    ),
    'tags', coalesce(
      (select jsonb_agg(t.nome order by t.nome)
         from public.lead_tags lt
         join public.tags t on t.id = lt.tag_id
        where lt.lead_id = l.id),
      '[]'::jsonb
    )
  )
  from public.leads l
 where l.id = p_lead
$fn$;

comment on function public.lead_para_webhook(uuid) is
  'O recorte do lead enviado nos webhooks. Um formato só, num lugar só.';


create or replace function public.processar_fluxos(p_limite int default 200)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_passo    record;
  v_acao     public.fluxo_acoes%rowtype;
  v_entrega  uuid;
  v_feitos   int := 0;
begin
  for v_passo in
    select e.*
      from public.fluxo_execucoes e
     where e.situacao = 'agendada'
       and e.executar_em <= now()
     order by e.executar_em
     limit p_limite
     -- Duas execuções do job ao mesmo tempo não pegam o mesmo passo.
     for update skip locked
  loop
    begin
      select * into v_acao from public.fluxo_acoes where id = v_passo.acao_id;

      -- A licença é conferida DE NOVO aqui: entre o agendamento e a execução
      -- podem ter passado dias, e o teste do cliente pode ter vencido no meio.
      if not public.org_acesso_ativo(v_passo.organization_id) then
        update public.fluxo_execucoes
           set situacao = 'cancelada',
               erro = 'Organização sem acesso ativo no momento da execução.',
               executado_em = now()
         where id = v_passo.id;
        continue;
      end if;

      if v_acao.tipo in ('mensagem', 'webhook') then
        insert into public.webhook_entregas (
          organization_id, webhook_id, evento, lead_id, payload
        )
        values (
          v_passo.organization_id,
          (v_acao.config->>'webhook_id')::uuid,
          'fluxo.' || v_acao.tipo,
          v_passo.lead_id,
          jsonb_build_object(
            'evento',    'fluxo.' || v_acao.tipo,
            'fluxo_id',  v_passo.fluxo_id,
            'acao_id',   v_acao.id,
            'lead',      public.lead_para_webhook(v_passo.lead_id),
            'texto',     case
                           when v_acao.tipo = 'mensagem'
                           then public.montar_texto_do_modelo(v_acao.config->>'modelo', v_passo.lead_id)
                           else null
                         end,
            'extra',     coalesce(v_acao.config->'extra', '{}'::jsonb),
            'gerado_em', now()
          )
        )
        returning id into v_entrega;

      elsif v_acao.tipo = 'etiqueta' then
        insert into public.lead_tags (organization_id, lead_id, tag_id)
        values (v_passo.organization_id, v_passo.lead_id, (v_acao.config->>'tag_id')::uuid)
        on conflict do nothing;

      elsif v_acao.tipo = 'mover_etapa' then
        -- `update` e não `insert`: se o lead não está nesse funil, a automação
        -- não o empurra para dentro — mover é mover, não é matricular.
        update public.lead_pipeline
           set stage_id = (v_acao.config->>'stage_id')::uuid
         where lead_id = v_passo.lead_id
           and pipeline_id = (v_acao.config->>'pipeline_id')::uuid
           and stage_id <> (v_acao.config->>'stage_id')::uuid;
      end if;

      update public.fluxo_execucoes
         set situacao = 'executada',
             executado_em = now(),
             tentativas = tentativas + 1,
             entrega_id = v_entrega,
             erro = null
       where id = v_passo.id;

      v_entrega := null;
      v_feitos := v_feitos + 1;

    exception when others then
      -- Uma ação quebrada não pode parar a fila inteira.
      update public.fluxo_execucoes
         set situacao = 'falhou',
             tentativas = tentativas + 1,
             erro = left(sqlerrm, 500),
             executado_em = now()
       where id = v_passo.id;
    end;
  end loop;

  return v_feitos;
end
$fn$;

comment on function public.processar_fluxos(int) is
  'Executa as ações de fluxo que venceram. Chamada pelo pg_cron a cada minuto.';


-- ============================================================================
-- PASSO 8 — A ENTREGA: ENVIAR E CONFERIR O QUE VOLTOU
-- ============================================================================
-- O pg_net é ASSÍNCRONO. `net.http_post` devolve um id na hora e a resposta
-- aparece depois em `net._http_response`. Daí os dois lados:
--   `entregar_webhooks()` — pega o que venceu e dispara, guardando o id.
--   `conferir_entregas()` — lê o que voltou e decide: entregue, tenta de
--                           novo, ou desiste.

create or replace function public.entregar_webhooks(p_limite int default 100)
returns int
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_item   record;
  v_hook   public.webhooks%rowtype;
  v_corpo  text;
  v_id     bigint;
  v_saiu   int := 0;
begin
  for v_item in
    select e.*
      from public.webhook_entregas e
     where e.situacao in ('pendente', 'falhou')
       and e.proxima_em <= now()
     order by e.proxima_em
     limit p_limite
     for update skip locked
  loop
    begin
      select * into v_hook from public.webhooks where id = v_item.webhook_id;

      if not found or not v_hook.ativo then
        update public.webhook_entregas
           set situacao = 'desistiu',
               ultimo_erro = 'Webhook desativado ou removido.'
         where id = v_item.id;
        continue;
      end if;

      if v_item.tentativas >= v_hook.max_tentativas then
        update public.webhook_entregas
           set situacao = 'desistiu',
               ultimo_erro = coalesce(v_item.ultimo_erro, 'Tentativas esgotadas.')
         where id = v_item.id;
        continue;
      end if;

      v_corpo := v_item.payload::text;

      -- A ASSINATURA. Sem ela, qualquer um que descubra a URL do n8n pode
      -- inventar leads e disparar mensagens em nome do cliente. O destino
      -- confere `sha256(corpo, segredo)` antes de acreditar no pedido.
      select net.http_post(
               url := v_hook.url,
               body := v_item.payload,
               headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'X-ByTech3-Evento', v_item.evento,
                 'X-ByTech3-Entrega', v_item.id::text,
                 'X-ByTech3-Tentativa', (v_item.tentativas + 1)::text,
                 'X-ByTech3-Assinatura',
                   'sha256=' || encode(hmac(v_corpo, v_hook.segredo, 'sha256'), 'hex')
               ),
               timeout_milliseconds := v_hook.timeout_ms
             )
        into v_id;

      update public.webhook_entregas
         set situacao = 'enviando',
             requisicao_id = v_id,
             tentativas = tentativas + 1,
             ultimo_erro = null
       where id = v_item.id;

      v_saiu := v_saiu + 1;

    exception when others then
      update public.webhook_entregas
         set situacao = 'falhou',
             tentativas = tentativas + 1,
             ultimo_erro = left(sqlerrm, 500),
             -- Recuo exponencial: 1, 2, 4, 8, 16 minutos.
             proxima_em = now() + make_interval(mins => least(power(2, tentativas)::int, 16))
       where id = v_item.id;
    end;
  end loop;

  return v_saiu;
end
$fn$;

comment on function public.entregar_webhooks(int) is
  'Dispara as entregas vencidas via pg_net, assinando o corpo com HMAC-SHA256.';


create or replace function public.conferir_entregas(p_limite int default 200)
returns int
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_item      record;
  v_resposta  record;
  v_fechadas  int := 0;
begin
  for v_item in
    select e.id, e.requisicao_id, e.tentativas, e.webhook_id, e.atualizado_em
      from public.webhook_entregas e
     where e.situacao = 'enviando'
       and e.requisicao_id is not null
     order by e.atualizado_em
     limit p_limite
     for update skip locked
  loop
    select r.status_code, r.error_msg, r.timed_out
      into v_resposta
      from net._http_response r
     where r.id = v_item.requisicao_id;

    if not found then
      -- O pg_net descarta as respostas depois de algumas horas. Passado esse
      -- prazo, "não achei" deixa de significar "ainda está voando" e passa a
      -- significar "perdi a resposta" — e a entrega ficaria em 'enviando'
      -- para sempre, sem ninguém tentar de novo e sem ninguém perceber.
      if v_item.atualizado_em < now() - interval '1 hour' then
        update public.webhook_entregas
           set situacao = 'falhou',
               ultimo_erro = 'Resposta não encontrada: a entrega será repetida.',
               proxima_em = now()
         where id = v_item.id;
        v_fechadas := v_fechadas + 1;
      end if;
      -- Ainda dentro da janela: fica em 'enviando' e confere no próximo minuto.
      continue;
    end if;

    if v_resposta.status_code between 200 and 299 then
      update public.webhook_entregas
         set situacao = 'entregue',
             ultimo_status = v_resposta.status_code,
             ultimo_erro = null,
             entregue_em = now()
       where id = v_item.id;

    else
      -- 4xx que não seja 408/429 é pedido errado: insistir não conserta e só
      -- enche o destino. 5xx, tempo esgotado e erro de rede, sim.
      update public.webhook_entregas e
         set situacao = case
               when v_resposta.status_code between 400 and 499
                    and v_resposta.status_code not in (408, 429) then 'desistiu'
               when e.tentativas >= coalesce(
                      (select w.max_tentativas from public.webhooks w where w.id = e.webhook_id), 5
                    ) then 'desistiu'
               else 'falhou'
             end,
             ultimo_status = v_resposta.status_code,
             ultimo_erro = left(
               coalesce(
                 v_resposta.error_msg,
                 case when v_resposta.timed_out then 'Tempo de resposta esgotado.' end,
                 'HTTP ' || coalesce(v_resposta.status_code::text, '?')
               ), 500),
             proxima_em = now() + make_interval(mins => least(power(2, e.tentativas)::int, 16))
       where e.id = v_item.id;
    end if;

    v_fechadas := v_fechadas + 1;
  end loop;

  return v_fechadas;
end
$fn$;

comment on function public.conferir_entregas(int) is
  'Lê as respostas do pg_net e fecha, reagenda ou desiste de cada entrega.';


-- ============================================================================
-- PASSO 9 — LIMPEZA
-- ============================================================================
-- Fila que ninguém limpa vira a maior tabela do banco em três meses. E, no
-- caso das entregas, é a única coisa que guarda o texto disparado — quanto
-- menos tempo ele fica, melhor.
create or replace function public.limpar_entregas_antigas(p_dias int default 30)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_apagadas int;
begin
  delete from public.webhook_entregas
   where situacao in ('entregue', 'desistiu')
     and criado_em < now() - make_interval(days => greatest(p_dias, 1));
  get diagnostics v_apagadas = row_count;

  delete from public.fluxo_execucoes
   where situacao in ('executada', 'cancelada', 'falhou')
     and criado_em < now() - make_interval(days => greatest(p_dias * 3, 3));

  return v_apagadas;
end
$fn$;


-- ============================================================================
-- PASSO 10 — AGENDAMENTO (pg_cron)
-- ============================================================================
-- `cron.schedule` com o mesmo nome SUBSTITUI o job — por isso rodar este
-- arquivo de novo não cria duplicata.
--
-- Se o pg_cron não estiver habilitado, o bloco avisa e segue. Nesse caso as
-- três funções acima continuam existindo e podem ser chamadas à mão:
--   select public.processar_fluxos();
--   select public.entregar_webhooks();
--   select public.conferir_entregas();

do $cron$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '[0005] pg_cron ausente: os jobs NÃO foram agendados. Habilite a extensão e rode de novo só o PASSO 10.';
    return;
  end if;

  perform cron.schedule('bytech3_fluxos',    '* * * * *', 'select public.processar_fluxos();');
  perform cron.schedule('bytech3_entregas',  '* * * * *', 'select public.entregar_webhooks();');
  perform cron.schedule('bytech3_conferir',  '* * * * *', 'select public.conferir_entregas();');
  perform cron.schedule('bytech3_limpeza',   '17 4 * * *', 'select public.limpar_entregas_antigas();');
exception when others then
  raise notice '[0005] não consegui agendar no pg_cron: %', sqlerrm;
end
$cron$;


-- ============================================================================
-- PASSO 11 — RLS E GRANTS
-- ============================================================================
alter table public.webhooks         enable row level security;
alter table public.webhook_entregas enable row level security;
alter table public.fluxos           enable row level security;
alter table public.fluxo_gatilhos   enable row level security;
alter table public.fluxo_acoes      enable row level security;
alter table public.fluxo_execucoes  enable row level security;

-- ------------------------------------------------------------- webhooks
-- Ler: qualquer membro (o vendedor merece saber o que está automatizado em
-- nome dele). Escrever: gestor/admin, com licença ativa.
drop policy if exists webhook_select_membro on public.webhooks;
create policy webhook_select_membro on public.webhooks
  for select to authenticated
  using (organization_id in (select public.orgs_do_usuario()));

drop policy if exists webhook_insert_gestor on public.webhooks;
create policy webhook_insert_gestor on public.webhooks
  for insert to authenticated
  with check (public.e_gestor(organization_id) and public.org_acesso_ativo(organization_id));

drop policy if exists webhook_update_gestor on public.webhooks;
create policy webhook_update_gestor on public.webhooks
  for update to authenticated
  using (public.e_gestor(organization_id) and public.org_acesso_ativo(organization_id))
  with check (public.e_gestor(organization_id));

drop policy if exists webhook_delete_gestor on public.webhooks;
create policy webhook_delete_gestor on public.webhooks
  for delete to authenticated
  using (public.e_gestor(organization_id));

-- ----------------------------------------------------------- entregas
-- Só leitura pelo app: quem cria entrega é o motor. "Tentar de novo" na tela
-- é um UPDATE restrito, tratado logo abaixo.
drop policy if exists entrega_select_membro on public.webhook_entregas;
create policy entrega_select_membro on public.webhook_entregas
  for select to authenticated
  using (
    organization_id in (select public.orgs_do_usuario())
    and (public.e_gestor(organization_id) or lead_id is null or public.pode_ver_lead(lead_id))
  );

-- Escrita nenhuma pela tabela. "Tentar de novo" é a função
-- `reenfileirar_entrega()` do PASSO 12: um UPDATE solto teria que liberar
-- `tentativas` junto (senão a entrega que esgotou as tentativas desiste de
-- novo no mesmo minuto), e liberar `tentativas` é liberar burlar o limite.
drop policy if exists entrega_update_gestor on public.webhook_entregas;

-- ------------------------------------------------------------- fluxos
drop policy if exists fluxo_select_membro on public.fluxos;
create policy fluxo_select_membro on public.fluxos
  for select to authenticated
  using (organization_id in (select public.orgs_do_usuario()));

drop policy if exists fluxo_insert_gestor on public.fluxos;
create policy fluxo_insert_gestor on public.fluxos
  for insert to authenticated
  with check (public.e_gestor(organization_id) and public.org_acesso_ativo(organization_id));

drop policy if exists fluxo_update_gestor on public.fluxos;
create policy fluxo_update_gestor on public.fluxos
  for update to authenticated
  using (public.e_gestor(organization_id) and public.org_acesso_ativo(organization_id))
  with check (public.e_gestor(organization_id));

drop policy if exists fluxo_delete_gestor on public.fluxos;
create policy fluxo_delete_gestor on public.fluxos
  for delete to authenticated
  using (public.e_gestor(organization_id));

-- ------------------------------------------------- gatilhos e ações
-- Mesmas quatro regras dos fluxos: todo membro lê, só gestor escreve, e a
-- escrita depende de licença ativa. Escritas por extenso, e não geradas num
-- laço, porque policy é a barreira de isolamento — quem revisa este arquivo
-- precisa ler o que vai rodar, não deduzir.
drop policy if exists gatilho_select_membro on public.fluxo_gatilhos;
create policy gatilho_select_membro on public.fluxo_gatilhos
  for select to authenticated
  using (organization_id in (select public.orgs_do_usuario()));

drop policy if exists gatilho_insert_gestor on public.fluxo_gatilhos;
create policy gatilho_insert_gestor on public.fluxo_gatilhos
  for insert to authenticated
  with check (public.e_gestor(organization_id) and public.org_acesso_ativo(organization_id));

drop policy if exists gatilho_update_gestor on public.fluxo_gatilhos;
create policy gatilho_update_gestor on public.fluxo_gatilhos
  for update to authenticated
  using (public.e_gestor(organization_id) and public.org_acesso_ativo(organization_id))
  with check (public.e_gestor(organization_id));

drop policy if exists gatilho_delete_gestor on public.fluxo_gatilhos;
create policy gatilho_delete_gestor on public.fluxo_gatilhos
  for delete to authenticated
  using (public.e_gestor(organization_id));

drop policy if exists acao_select_membro on public.fluxo_acoes;
create policy acao_select_membro on public.fluxo_acoes
  for select to authenticated
  using (organization_id in (select public.orgs_do_usuario()));

drop policy if exists acao_insert_gestor on public.fluxo_acoes;
create policy acao_insert_gestor on public.fluxo_acoes
  for insert to authenticated
  with check (public.e_gestor(organization_id) and public.org_acesso_ativo(organization_id));

drop policy if exists acao_update_gestor on public.fluxo_acoes;
create policy acao_update_gestor on public.fluxo_acoes
  for update to authenticated
  using (public.e_gestor(organization_id) and public.org_acesso_ativo(organization_id))
  with check (public.e_gestor(organization_id));

drop policy if exists acao_delete_gestor on public.fluxo_acoes;
create policy acao_delete_gestor on public.fluxo_acoes
  for delete to authenticated
  using (public.e_gestor(organization_id));

-- --------------------------------------------------------- execuções
-- Histórico da automação: leitura pela regra de carteira, escrita nenhuma.
-- Como `activities`, é registro do que aconteceu — não se edita.
drop policy if exists execucao_select_carteira on public.fluxo_execucoes;
create policy execucao_select_carteira on public.fluxo_execucoes
  for select to authenticated
  using (
    organization_id in (select public.orgs_do_usuario())
    and (public.e_gestor(organization_id) or lead_id is null or public.pode_ver_lead(lead_id))
  );

-- Cancelar um agendamento que ainda não rodou. É a única escrita permitida:
-- serve para o gestor parar um fluxo disparado por engano antes de a
-- mensagem sair.
drop policy if exists execucao_cancelar_gestor on public.fluxo_execucoes;
create policy execucao_cancelar_gestor on public.fluxo_execucoes
  for update to authenticated
  using (public.e_gestor(organization_id) and situacao = 'agendada')
  with check (public.e_gestor(organization_id) and situacao = 'cancelada');


-- ------------------------------------------------------------- GRANTS
revoke all on table public.webhooks         from anon, authenticated;
revoke all on table public.webhook_entregas from anon, authenticated;
revoke all on table public.fluxos           from anon, authenticated;
revoke all on table public.fluxo_gatilhos   from anon, authenticated;
revoke all on table public.fluxo_acoes      from anon, authenticated;
revoke all on table public.fluxo_execucoes  from anon, authenticated;

-- O SEGREDO NÃO ESTÁ NESTA LISTA, E É DE PROPÓSITO.
--   RLS é por LINHA; para esconder uma COLUNA, o instrumento é o GRANT de
--   coluna. Sem isto, qualquer membro da organização daria um `select *` pela
--   API e levaria embora a chave que assina as entregas — e com ela poderia
--   forjar chamadas ao n8n do cliente.
--   O app grava o segredo (INSERT/UPDATE) mas nunca o lê de volta. Quem lê é
--   `entregar_webhooks()`, que roda como dona da função.
grant select (id, organization_id, nome, url, ativo, max_tentativas, timeout_ms,
              criado_por, criado_em, atualizado_em)
  on table public.webhooks to authenticated;
grant insert (organization_id, nome, url, segredo, ativo, max_tentativas, timeout_ms, criado_por)
  on table public.webhooks to authenticated;
grant update (nome, url, segredo, ativo, max_tentativas, timeout_ms)
  on table public.webhooks to authenticated;
grant delete on table public.webhooks to authenticated;

grant select on table public.webhook_entregas to authenticated;

grant select, insert, update, delete on table public.fluxos         to authenticated;
grant select, insert, update, delete on table public.fluxo_gatilhos to authenticated;
grant select, insert, update, delete on table public.fluxo_acoes    to authenticated;

grant select on table public.fluxo_execucoes to authenticated;
grant update (situacao) on table public.fluxo_execucoes to authenticated;

-- As funções do MOTOR não são chamáveis pela API. Só o cron as usa, e elas
-- rodam com privilégio de dona: exposta, `entregar_webhooks()` deixaria
-- qualquer usuário forçar o disparo da fila de outra organização.
revoke execute on function public.processar_fluxos(int)          from public, anon, authenticated;
revoke execute on function public.entregar_webhooks(int)         from public, anon, authenticated;
revoke execute on function public.conferir_entregas(int)         from public, anon, authenticated;
revoke execute on function public.limpar_entregas_antigas(int)   from public, anon, authenticated;
revoke execute on function public.lead_para_webhook(uuid)        from public, anon, authenticated;
revoke execute on function public.montar_texto_do_modelo(text, uuid) from public, anon, authenticated;

revoke execute on function public.url_de_webhook_segura(text) from public, anon;
grant  execute on function public.url_de_webhook_segura(text) to authenticated;


-- ============================================================================
-- PASSO 12 — AÇÕES DO GESTOR SOBRE A FILA
-- ============================================================================
-- Colocar de volta na fila uma entrega que falhou ou que desistiu.
--
-- POR QUE UMA FUNÇÃO E NÃO UM UPDATE COM POLICY:
--   Reenfileirar exige zerar `tentativas` — senão a entrega que esgotou o
--   limite volta a 'pendente' e desiste de novo no minuto seguinte, e o botão
--   da tela não faz nada. Só que dar UPDATE em `tentativas` para o gestor é
--   dar a ele o poder de burlar o limite de tentativas e martelar o destino
--   indefinidamente. A função faz exatamente as três coisas certas e nada
--   além delas.

create or replace function public.reenfileirar_entrega(p_entrega uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.webhook_entregas where id = p_entrega;

  if v_org is null then
    raise exception 'Entrega não encontrada.' using errcode = 'P0002';
  end if;
  if not public.e_gestor(v_org) then
    raise exception 'Só gestor ou administrador reenvia uma entrega.' using errcode = '42501';
  end if;
  if not public.org_acesso_ativo(v_org) then
    raise exception 'Organização sem acesso ativo.' using errcode = '42501';
  end if;

  update public.webhook_entregas
     set situacao = 'pendente',
         tentativas = 0,
         proxima_em = now(),
         requisicao_id = null,
         ultimo_erro = null
   where id = p_entrega
     -- Entrega já concluída não se reenvia: mandaria a mesma mensagem duas
     -- vezes para o cliente, que é o defeito que a fila existe para evitar.
     and situacao in ('falhou', 'desistiu');
end
$fn$;

comment on function public.reenfileirar_entrega(uuid) is
  'Devolve à fila uma entrega que falhou ou desistiu, zerando as tentativas. Não toca em entrega já concluída.';

revoke execute on function public.reenfileirar_entrega(uuid) from public, anon;
grant  execute on function public.reenfileirar_entrega(uuid) to authenticated;


-- ============================================================================
-- PASSO 12.1 — SIMULADOR: O QUE ACONTECERIA, SEM ACONTECER
-- ============================================================================
-- Ninguém deveria ligar um fluxo sem ver antes o que ele faria. Esta função
-- monta a lista de ações e o texto JÁ PREENCHIDO com os dados de um lead de
-- verdade, e não escreve nada — nem execução, nem entrega, nem activity.
--
-- A guarda de membro é obrigatória: sem ela, um usuário qualquer poderia
-- pedir a simulação de um fluxo de outra empresa e ler o modelo de mensagem
-- dela, com dado de lead junto.

create or replace function public.simular_fluxo(p_fluxo uuid, p_lead uuid)
returns table (
  ordem          int,
  tipo           text,
  quando         timestamptz,
  resumo         text,
  texto          text,
  destino        text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.fluxos where id = p_fluxo;

  if v_org is null or not public.e_membro(v_org) then
    raise exception 'Acesso negado a este fluxo.' using errcode = '42501';
  end if;

  -- O lead precisa ser da mesma organização E estar na carteira de quem
  -- pergunta. Simular com o lead do colega mostraria dado que a RLS esconde.
  if p_lead is not null and not public.pode_ver_lead(p_lead) then
    raise exception 'Este lead não está na sua carteira.' using errcode = '42501';
  end if;

  return query
  select a.ordem,
         a.tipo,
         now() + make_interval(mins => a.atraso_minutos),
         case a.tipo
           when 'mensagem'    then 'Envia mensagem por webhook'
           when 'webhook'     then 'Chama o webhook'
           when 'etiqueta'    then 'Aplica a etiqueta ' ||
                                   coalesce((select t.nome from public.tags t
                                              where t.id = (a.config->>'tag_id')::uuid), '?')
           when 'mover_etapa' then 'Move para a etapa ' ||
                                   coalesce((select s.nome from public.pipeline_stages s
                                              where s.id = (a.config->>'stage_id')::uuid), '?')
         end,
         case when a.tipo = 'mensagem'
              then public.montar_texto_do_modelo(a.config->>'modelo', p_lead)
         end,
         (select w.nome from public.webhooks w where w.id = (a.config->>'webhook_id')::uuid)
    from public.fluxo_acoes a
   where a.fluxo_id = p_fluxo
   order by a.ordem;
end
$fn$;

comment on function public.simular_fluxo(uuid, uuid) is
  'Mostra o que o fluxo faria com um lead real, sem executar nada. Guarda de membro + carteira.';

revoke execute on function public.simular_fluxo(uuid, uuid) from public, anon;
grant  execute on function public.simular_fluxo(uuid, uuid) to authenticated;


-- ============================================================================
-- PASSO 13 — MODELO DE PRÉ-ATENDIMENTO (opcional, e desligado)
-- ============================================================================
-- Cria um fluxo de exemplo para a organização, DESATIVADO, com as três ações
-- que quase todo cliente quer no começo: dar boas-vindas, etiquetar e, se
-- ninguém responder, cutucar no dia seguinte.
--
-- É modelo, não configuração: o gestor abre, ajusta o texto, aponta o webhook
-- e só então liga. Nada dispara enquanto ele não ligar.

create or replace function public.criar_fluxo_pre_atendimento(p_org uuid, p_webhook uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_fluxo uuid;
  v_tag   uuid;
begin
  if not public.e_gestor(p_org) then
    raise exception 'Só gestor ou administrador cria fluxos.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.webhooks w where w.id = p_webhook and w.organization_id = p_org) then
    raise exception 'O webhook escolhido não é desta organização.' using errcode = '23503';
  end if;

  insert into public.fluxos (organization_id, nome, descricao, ativo, repetir, criado_por)
  values (
    p_org,
    'Pré-atendimento',
    'Recebe o lead novo, responde na hora e cutuca no dia seguinte. Revise os textos antes de ativar.',
    false,
    false,
    (select auth.uid())
  )
  on conflict (organization_id, nome) do nothing
  returning id into v_fluxo;

  -- Já existia: devolve o que está lá em vez de duplicar.
  if v_fluxo is null then
    select id into v_fluxo from public.fluxos
     where organization_id = p_org and nome = 'Pré-atendimento';
    return v_fluxo;
  end if;

  insert into public.fluxo_gatilhos (organization_id, fluxo_id, evento)
  values (p_org, v_fluxo, 'lead.created');

  insert into public.tags (organization_id, nome, cor)
  values (p_org, 'Em pré-atendimento', '#0284c7')
  on conflict do nothing;

  select id into v_tag from public.tags
   where organization_id = p_org and lower(nome) = lower('Em pré-atendimento');

  insert into public.fluxo_acoes (organization_id, fluxo_id, ordem, tipo, config, atraso_minutos)
  values
    (p_org, v_fluxo, 0, 'mensagem',
     jsonb_build_object(
       'webhook_id', p_webhook,
       'modelo', 'Olá {{primeiro_nome}}! Aqui é da equipe. Recebi seu contato e já estou vendo o seu caso — respondo em instantes.'
     ), 0),
    (p_org, v_fluxo, 1, 'etiqueta',
     jsonb_build_object('tag_id', v_tag), 0),
    (p_org, v_fluxo, 2, 'mensagem',
     jsonb_build_object(
       'webhook_id', p_webhook,
       'modelo', 'Oi {{primeiro_nome}}, passando para saber se você ainda tem interesse. Fico à disposição!'
     ), 1440);

  return v_fluxo;
end
$fn$;

comment on function public.criar_fluxo_pre_atendimento(uuid, uuid) is
  'Cria o fluxo de exemplo "Pré-atendimento", DESATIVADO, para o gestor revisar e ligar.';

revoke execute on function public.criar_fluxo_pre_atendimento(uuid, uuid) from public, anon;
grant  execute on function public.criar_fluxo_pre_atendimento(uuid, uuid) to authenticated;


-- ============================================================================
-- PASSO 14 — VERIFICAÇÃO (rode e confira os resultados)
-- ============================================================================

-- 14.1 — As seis tabelas existem com RLS ligada (esperado: 6 linhas, todas t).
select c.relname as tabela, c.relrowsecurity as rls_ligado
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('webhooks','webhook_entregas','fluxos','fluxo_gatilhos',
                     'fluxo_acoes','fluxo_execucoes')
 order by c.relname;

-- 14.2 — A guarda de SSRF (esperado: t, f, f, f, f, f).
select public.url_de_webhook_segura('https://n8n.minhaempresa.com.br/webhook/abc') as valida,
       public.url_de_webhook_segura('http://n8n.minhaempresa.com.br/webhook/abc')  as sem_tls,
       public.url_de_webhook_segura('https://169.254.169.254/latest/meta-data/')   as metadados,
       public.url_de_webhook_segura('https://localhost/webhook')                   as loopback,
       public.url_de_webhook_segura('https://10.0.0.5/webhook')                    as rede_privada,
       public.url_de_webhook_segura('https://user:senha@evil.com@10.0.0.5/x')      as arroba;

-- 14.3 — O SEGREDO não é legível por `authenticated` (esperado: 0 linhas).
select column_name
  from information_schema.column_privileges
 where table_schema = 'public'
   and table_name = 'webhooks'
   and grantee = 'authenticated'
   and privilege_type = 'SELECT'
   and column_name = 'segredo';

-- 14.3.1 — O gestor NÃO tem UPDATE direto nas entregas (esperado: 0 linhas).
--          Reenviar é só pela função `reenfileirar_entrega`.
select policyname
  from pg_policies
 where schemaname = 'public' and tablename = 'webhook_entregas' and cmd <> 'SELECT';

-- 14.4 — As funções do motor NÃO são chamáveis pela API (esperado: 0 linhas).
select p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('processar_fluxos','entregar_webhooks','conferir_entregas',
                     'limpar_entregas_antigas','lead_para_webhook','montar_texto_do_modelo')
   and has_function_privilege('authenticated', p.oid, 'execute');

-- 14.5 — Os quatro jobs do cron (esperado: 4 linhas, active = t).
--        Se der erro de tabela inexistente, o pg_cron não está habilitado.
select jobname, schedule, active from cron.job where jobname like 'bytech3_%' order by jobname;

-- 14.6 — O gatilho está pendurado em `activities` (esperado: 1).
select count(*) as gatilho_de_fluxos
  from pg_trigger
 where tgname = 'disparar_fluxos' and not tgisinternal;

-- 14.7 — `activities` continua SEM policy de update/delete (esperado: 0).
--        A migration não pode ter afrouxado o livro-caixa.
select count(*) as policies_de_escrita_indevida
  from pg_policies
 where schemaname = 'public' and tablename = 'activities' and cmd in ('UPDATE','DELETE');

-- 14.8 — Preenchimento do modelo (esperado: o texto com o primeiro nome).
--        Troque o uuid por um lead seu.
-- select public.montar_texto_do_modelo('Olá {{primeiro_nome}}, tudo bem?', '<uuid-do-lead>'::uuid);

-- 14.9 — Simulação sem efeito colateral. Rode, depois confira que
--        `fluxo_execucoes` e `webhook_entregas` continuam com a mesma contagem.
-- select * from public.simular_fluxo('<uuid-do-fluxo>'::uuid, '<uuid-do-lead>'::uuid);
