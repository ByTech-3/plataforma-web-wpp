/**
 * Leitura de dados do CRM (lado servidor).
 *
 * Toda query daqui usa o cliente do servidor, que envia o JWT do usuário. Ou
 * seja: a RLS decide o que volta. A regra de carteira (gestor/admin veem toda a
 * organização; vendedor vê os seus + os sem responsável) NÃO é aplicada por
 * este arquivo — ela já vem aplicada do banco, pela policy `lead_select_carteira`.
 * O filtro por `organization_id` que aparece aqui é otimização de índice e
 * clareza, nunca a barreira de isolamento.
 *
 * Este módulo é SÓ SERVIDOR. Não importe em componente com "use client".
 */
import { cache } from 'react';
import { criarClienteServidor } from '@/lib/supabase/server';
import { carregarContexto, type ContextoOrganizacao } from '@/lib/contexto';
import { paraNumero } from './formato';
import type {
  CartaoKanban,
  ColunaKanban,
  EtapaAtual,
  FunilPadrao,
  FunilResumo,
  ItemHistorico,
  Lead,
  LeadDaTela,
  MembroOrg,
  Quadro,
  TagLead,
  TipoEtapa,
} from './tipos';

/**
 * A organização em uso. Enquanto não existir troca de organização na interface
 * (multi-org é suportado pelo banco), vale a primeira — a mesma que o layout e
 * o dashboard já mostram.
 */
export async function organizacaoAtual(): Promise<ContextoOrganizacao> {
  const contexto = await carregarContexto();
  const organizacao = contexto[0];
  if (!organizacao) {
    throw new Error('Usuário sem organização ativa.');
  }
  return organizacao;
}

const CAMPOS_LEAD =
  'id, nome, telefone, email, origem, valor, previsao_fechamento, ' +
  'ultimo_contato_em, responsavel_id, arquivado, criado_em, atualizado_em';

type LinhaLead = Omit<Lead, 'valor'> & { valor: unknown };

/**
 * Quebra uma lista de ids em lotes para o filtro `in`.
 *
 * `in` vira query string: algumas centenas de UUIDs de uma vez passariam de
 * 7 KB de URL e esbarrariam no limite do proxy do Supabase.
 */
function emLotes(ids: string[], tamanho = 50): string[][] {
  const lotes: string[][] = [];
  for (let i = 0; i < ids.length; i += tamanho) {
    lotes.push(ids.slice(i, i + tamanho));
  }
  return lotes;
}

function normalizarLead(linha: LinhaLead): Lead {
  return { ...linha, valor: paraNumero(linha.valor) };
}

/**
 * Membros ativos da organização — opções de "responsável" e autores do
 * histórico.
 *
 * `cache()` porque a mesma tela pede isto mais de uma vez: o quadro do Kanban
 * chama para resolver os responsáveis dos cartões, a ficha chama para a linha
 * do tempo, a listagem chama para a coluna. Eram duas consultas repetidas por
 * chamada; agora são duas por requisição.
 */
export const listarMembros = cache(async function listarMembros(
  organizationId: string,
): Promise<MembroOrg[]> {
  const supabase = await criarClienteServidor();

  const { data: vinculos, error: erroVinculos } = await supabase
    .from('memberships')
    .select('user_id, papel')
    .eq('organization_id', organizationId)
    .eq('ativo', true);

  if (erroVinculos) {
    throw new Error(`Falha ao carregar a equipe: ${erroVinculos.message}`);
  }

  const linhas = (vinculos ?? []) as { user_id: string; papel: MembroOrg['papel'] }[];
  if (linhas.length === 0) return [];

  // `leads.responsavel_id` aponta para auth.users, não para profiles — então
  // não há embed automático do PostgREST. Buscamos os perfis em separado
  // (a policy de profiles só devolve colegas de organização).
  const { data: perfis, error: erroPerfis } = await supabase
    .from('profiles')
    .select('id, nome_completo, email')
    .in(
      'id',
      linhas.map((linha) => linha.user_id),
    );

  if (erroPerfis) {
    throw new Error(`Falha ao carregar os perfis da equipe: ${erroPerfis.message}`);
  }

  const porId = new Map(
    ((perfis ?? []) as { id: string; nome_completo: string | null; email: string | null }[]).map(
      (perfil) => [perfil.id, perfil],
    ),
  );

  return linhas
    .map((linha) => {
      const perfil = porId.get(linha.user_id);
      return {
        user_id: linha.user_id,
        nome: perfil?.nome_completo?.trim() || perfil?.email || 'Usuário sem nome',
        email: perfil?.email ?? null,
        papel: linha.papel,
      };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
});

/**
 * Em qual etapa cada lead está. Quando o lead está em mais de um funil
 * (o modelo permite), a listagem mostra o do funil padrão; na falta dele, o
 * primeiro vínculo encontrado.
 */
async function carregarEtapasPorLead(
  organizationId: string,
  leadIds: string[],
): Promise<Map<string, EtapaAtual>> {
  const mapa = new Map<string, EtapaAtual>();
  if (leadIds.length === 0) return mapa;

  const supabase = await criarClienteServidor();

  const [vinculosPorLote, etapasResposta, funisResposta] = await Promise.all([
    Promise.all(
      emLotes(leadIds).map((lote) =>
        supabase
          .from('lead_pipeline')
          .select('id, lead_id, pipeline_id, stage_id, entrou_na_etapa_em')
          .in('lead_id', lote),
      ),
    ),
    supabase
      .from('pipeline_stages')
      .select('id, nome, tipo, pipeline_id, posicao')
      .eq('organization_id', organizationId),
    supabase.from('pipelines').select('id, nome, padrao').eq('organization_id', organizationId),
  ]);

  const erroVinculos = vinculosPorLote.find((resposta) => resposta.error)?.error;
  if (erroVinculos) {
    throw new Error(`Falha ao carregar as etapas: ${erroVinculos.message}`);
  }
  if (etapasResposta.error) {
    throw new Error(`Falha ao carregar as etapas: ${etapasResposta.error.message}`);
  }
  if (funisResposta.error) {
    throw new Error(`Falha ao carregar os funis: ${funisResposta.error.message}`);
  }

  const etapas = new Map(
    (
      (etapasResposta.data ?? []) as {
        id: string;
        nome: string;
        tipo: TipoEtapa;
        pipeline_id: string;
      }[]
    ).map((etapa) => [etapa.id, etapa]),
  );

  const funis = new Map(
    ((funisResposta.data ?? []) as { id: string; nome: string; padrao: boolean }[]).map((funil) => [
      funil.id,
      funil,
    ]),
  );

  const vinculos = vinculosPorLote.flatMap(
    (resposta) =>
      (resposta.data ?? []) as {
        id: string;
        lead_id: string;
        pipeline_id: string;
        stage_id: string;
        entrou_na_etapa_em: string;
      }[],
  );

  for (const vinculo of vinculos) {
    const etapa = etapas.get(vinculo.stage_id);
    const funil = funis.get(vinculo.pipeline_id);
    if (!etapa || !funil) continue;

    const atual = mapa.get(vinculo.lead_id);
    // O funil padrão vence o empate quando o lead está em mais de um.
    if (atual && !(funil.padrao && !atual.pipeline_padrao)) continue;

    mapa.set(vinculo.lead_id, {
      vinculo_id: vinculo.id,
      pipeline_id: funil.id,
      pipeline_nome: funil.nome,
      pipeline_padrao: funil.padrao,
      stage_id: etapa.id,
      stage_nome: etapa.nome,
      tipo: etapa.tipo,
      entrou_na_etapa_em: vinculo.entrou_na_etapa_em,
    });
  }

  return mapa;
}

/**
 * Teto da listagem. A tela avisa quando ele é atingido, em vez de cortar em
 * silêncio — e os filtros existem justamente para caber abaixo dele.
 */
export const LIMITE_LISTAGEM = 200;

export type FiltrosLead = {
  /** Id do responsável, ou `'sem'` para os que não têm dono. */
  responsavel?: string;
  origem?: string;
  tag?: string;
  etapa?: string;
  busca?: string;
};

/** Há algum filtro além do "mostrar arquivados"? */
export function temFiltro(filtros: FiltrosLead): boolean {
  return Boolean(
    filtros.responsavel || filtros.origem || filtros.tag || filtros.etapa || filtros.busca,
  );
}

/**
 * Ids dos leads que satisfazem os filtros de TAG e ETAPA.
 *
 * Devolve `null` quando nenhum dos dois foi pedido — o que é diferente de
 * devolver lista vazia, que significa "filtrou e não sobrou ninguém".
 */
async function idsFiltradosPorVinculo(
  organizationId: string,
  filtros: FiltrosLead,
): Promise<string[] | null> {
  if (!filtros.tag && !filtros.etapa) return null;

  const supabase = await criarClienteServidor();
  const listas: string[][] = [];

  if (filtros.tag) {
    const { data } = await supabase
      .from('lead_tags')
      .select('lead_id')
      .eq('organization_id', organizationId)
      .eq('tag_id', filtros.tag);

    listas.push(((data ?? []) as { lead_id: string }[]).map((linha) => linha.lead_id));
  }

  if (filtros.etapa) {
    const { data } = await supabase
      .from('lead_pipeline')
      .select('lead_id')
      .eq('organization_id', organizationId)
      .eq('stage_id', filtros.etapa);

    listas.push(((data ?? []) as { lead_id: string }[]).map((linha) => linha.lead_id));
  }

  // Filtros combinados são "E", não "OU": tag VIP na etapa Negociação são os
  // leads que estão nos dois conjuntos.
  return listas.reduce((acumulado, lista) =>
    acumulado.filter((id) => lista.includes(id)),
  );
}

/** Totais dos filtros de arquivamento, independentes dos demais filtros. */
async function contarLeads(
  organizationId: string,
): Promise<{ totalAtivos: number; totalArquivados: number }> {
  const supabase = await criarClienteServidor();

  const [ativos, arquivados] = await Promise.all([
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('arquivado', false),
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('arquivado', true),
  ]);

  return { totalAtivos: ativos.count ?? 0, totalArquivados: arquivados.count ?? 0 };
}

/**
 * Listagem principal. Arquivados ficam FORA por padrão: arquivar é descarte
 * reversível, e a tela do dia a dia é a dos leads vivos.
 */
export async function listarLeads(
  organizationId: string,
  opcoes: { incluirArquivados?: boolean; filtros?: FiltrosLead } = {},
): Promise<{ leads: LeadDaTela[]; totalAtivos: number; totalArquivados: number }> {
  const supabase = await criarClienteServidor();
  const filtros = opcoes.filtros ?? {};

  // Tag e etapa não são colunas de `leads`: viram uma lista de ids antes.
  // Quando o filtro existe e não casa com nada, a lista sai vazia — e é isso
  // mesmo, em vez de ignorar o filtro e mostrar tudo.
  const idsPorVinculo = await idsFiltradosPorVinculo(organizationId, filtros);
  if (idsPorVinculo?.length === 0) {
    const totais = await contarLeads(organizationId);
    return { leads: [], ...totais };
  }

  let consulta = supabase
    .from('leads')
    .select(CAMPOS_LEAD)
    .eq('organization_id', organizationId)
    .order('criado_em', { ascending: false })
    .limit(LIMITE_LISTAGEM);

  if (!opcoes.incluirArquivados) {
    consulta = consulta.eq('arquivado', false);
  }
  if (filtros.responsavel === 'sem') {
    consulta = consulta.is('responsavel_id', null);
  } else if (filtros.responsavel) {
    consulta = consulta.eq('responsavel_id', filtros.responsavel);
  }
  if (filtros.origem) {
    consulta = consulta.eq('origem', filtros.origem);
  }
  if (idsPorVinculo) {
    consulta = consulta.in('id', idsPorVinculo.slice(0, 300));
  }
  if (filtros.busca) {
    // Nome OU telefone. O termo é escapado: vírgula e parêntese têm
    // significado na sintaxe do `or` do PostgREST e quebrariam a consulta.
    const termo = filtros.busca.replace(/[,()*%\\]/g, ' ').trim();
    if (termo) {
      consulta = consulta.or(`nome.ilike.%${termo}%,telefone.ilike.%${termo}%`);
    }
  }

  // As contagens alimentam os rótulos do filtro e não dependem do teto acima.
  // `head: true` traz só o número, sem as linhas. Os totais também respeitam a
  // carteira: quem conta é a mesma policy de SELECT.
  // A equipe entra nesta mesma janela: ela resolve a coluna "responsável" e
  // não depende de quais leads voltaram. Esperar os leads para só então pedir
  // os membros somava uma ida ao banco em série, à toa.
  const [leadsResposta, ativosResposta, arquivadosResposta, membros] = await Promise.all([
    consulta,
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('arquivado', false),
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('arquivado', true),
    listarMembros(organizationId),
  ]);

  if (leadsResposta.error) {
    throw new Error(`Falha ao carregar os leads: ${leadsResposta.error.message}`);
  }

  const leads = ((leadsResposta.data ?? []) as unknown as LinhaLead[]).map(normalizarLead);

  const etapas = await carregarEtapasPorLead(
    organizationId,
    leads.map((lead) => lead.id),
  );

  const membrosPorId = new Map(membros.map((membro) => [membro.user_id, membro]));

  return {
    leads: leads.map((lead) => ({
      ...lead,
      responsavel: lead.responsavel_id ? membrosPorId.get(lead.responsavel_id) ?? null : null,
      etapa: etapas.get(lead.id) ?? null,
    })),
    totalAtivos: ativosResposta.count ?? 0,
    totalArquivados: arquivadosResposta.count ?? 0,
  };
}

/** Um lead da carteira do usuário. `null` quando não existe OU não é dele. */
export async function carregarLead(
  organizationId: string,
  leadId: string,
): Promise<LeadDaTela | null> {
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase
    .from('leads')
    .select(CAMPOS_LEAD)
    .eq('organization_id', organizationId)
    .eq('id', leadId)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao carregar o lead: ${error.message}`);
  }
  if (!data) return null;

  const lead = normalizarLead(data as unknown as LinhaLead);

  const [membros, etapas] = await Promise.all([
    listarMembros(organizationId),
    carregarEtapasPorLead(organizationId, [lead.id]),
  ]);

  const responsavel = lead.responsavel_id
    ? membros.find((membro) => membro.user_id === lead.responsavel_id) ?? null
    : null;

  return { ...lead, responsavel, etapa: etapas.get(lead.id) ?? null };
}

/**
 * Linha do tempo do lead.
 *
 * Só LEITURA: quem escreve em `activities` são os triggers do banco. O app não
 * insere evento de criação, edição, troca de etapa ou tag — sairia duplicado.
 */
export async function listarHistorico(leadId: string): Promise<ItemHistorico[]> {
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase
    .from('activities')
    .select('id, tipo, descricao, dados, criado_em, user_id')
    .eq('lead_id', leadId)
    .order('criado_em', { ascending: false })
    .limit(100);

  if (error) {
    throw new Error(`Falha ao carregar o histórico: ${error.message}`);
  }

  const eventos = (data ?? []) as {
    id: string;
    tipo: string;
    descricao: string | null;
    dados: Record<string, unknown> | null;
    criado_em: string;
    user_id: string | null;
  }[];

  const autores = new Set(
    eventos.map((evento) => evento.user_id).filter((id): id is string => Boolean(id)),
  );

  const nomes = new Map<string, string>();
  if (autores.size > 0) {
    const { data: perfis } = await supabase
      .from('profiles')
      .select('id, nome_completo, email')
      .in('id', [...autores]);

    for (const perfil of (perfis ?? []) as {
      id: string;
      nome_completo: string | null;
      email: string | null;
    }[]) {
      nomes.set(perfil.id, perfil.nome_completo?.trim() || perfil.email || 'Usuário');
    }
  }

  return eventos.map((evento) => ({
    ...evento,
    dados: evento.dados ?? {},
    autor: evento.user_id ? nomes.get(evento.user_id) ?? 'Usuário removido' : null,
  }));
}

/**
 * O funil padrão da organização e sua primeira etapa — o destino de todo lead
 * novo. A migration 0002 cria esse funil junto com a organização; o fallback
 * para "qualquer funil" cobre a empresa que apagou o padrão pela tela.
 */
export async function carregarFunilPadrao(organizationId: string): Promise<FunilPadrao | null> {
  const supabase = await criarClienteServidor();

  const { data: funis, error: erroFunis } = await supabase
    .from('pipelines')
    .select('id, nome, padrao, posicao')
    .eq('organization_id', organizationId)
    .eq('arquivado', false)
    .order('padrao', { ascending: false })
    .order('posicao', { ascending: true })
    .limit(1);

  if (erroFunis) {
    throw new Error(`Falha ao carregar o funil padrão: ${erroFunis.message}`);
  }

  const funil = ((funis ?? []) as { id: string; nome: string }[])[0];
  if (!funil) return null;

  const { data: etapas, error: erroEtapas } = await supabase
    .from('pipeline_stages')
    .select('id, nome, posicao')
    .eq('pipeline_id', funil.id)
    .order('posicao', { ascending: true })
    .limit(1);

  if (erroEtapas) {
    throw new Error(`Falha ao carregar as etapas do funil: ${erroEtapas.message}`);
  }

  const etapa = ((etapas ?? []) as { id: string; nome: string }[])[0];
  if (!etapa) return null;

  return {
    pipeline_id: funil.id,
    pipeline_nome: funil.nome,
    primeira_etapa_id: etapa.id,
    primeira_etapa_nome: etapa.nome,
  };
}

// ============================================================================
// KANBAN
// ============================================================================

/**
 * Teto de cartões do quadro. Um funil com mais que isto vira tela ilegível
 * antes de virar problema de banco; o aviso na tela diz que o corte existe,
 * em vez de sumir com os cartões em silêncio.
 */
export const LIMITE_QUADRO = 500;

/** Funis ativos da organização, para o seletor. Padrão primeiro. */
export async function listarFunis(organizationId: string): Promise<FunilResumo[]> {
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase
    .from('pipelines')
    .select('id, nome, descricao, padrao, posicao')
    .eq('organization_id', organizationId)
    .eq('arquivado', false)
    .order('padrao', { ascending: false })
    .order('posicao', { ascending: true });

  if (error) {
    throw new Error(`Falha ao carregar os funis: ${error.message}`);
  }

  return ((data ?? []) as { id: string; nome: string; descricao: string | null; padrao: boolean }[])
    .map((funil) => ({
      id: funil.id,
      nome: funil.nome,
      descricao: funil.descricao,
      padrao: funil.padrao,
    }));
}

/** Etiquetas de cada lead, para os cartões. */
async function carregarTagsPorLead(
  organizationId: string,
  leadIds: string[],
): Promise<Map<string, TagLead[]>> {
  const mapa = new Map<string, TagLead[]>();
  if (leadIds.length === 0) return mapa;

  const supabase = await criarClienteServidor();

  const [vinculosPorLote, tagsResposta] = await Promise.all([
    Promise.all(
      emLotes(leadIds).map((lote) =>
        supabase.from('lead_tags').select('lead_id, tag_id').in('lead_id', lote),
      ),
    ),
    supabase.from('tags').select('id, nome, cor').eq('organization_id', organizationId),
  ]);

  const erro = vinculosPorLote.find((resposta) => resposta.error)?.error ?? tagsResposta.error;
  if (erro) {
    throw new Error(`Falha ao carregar as tags: ${erro.message}`);
  }

  const tags = new Map(
    ((tagsResposta.data ?? []) as TagLead[]).map((tag) => [tag.id, tag]),
  );

  for (const resposta of vinculosPorLote) {
    for (const vinculo of (resposta.data ?? []) as { lead_id: string; tag_id: string }[]) {
      const tag = tags.get(vinculo.tag_id);
      if (!tag) continue;
      const lista = mapa.get(vinculo.lead_id) ?? [];
      lista.push(tag);
      mapa.set(vinculo.lead_id, lista);
    }
  }

  for (const lista of mapa.values()) {
    lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  return mapa;
}

/**
 * Ordem dos cartões dentro da coluna.
 *
 * `posicao` manda; empate cai para o mais recente primeiro. O desempate
 * importa de verdade: os leads criados no passo 2 entraram todos com
 * `posicao = 0`, então sem ele a ordem seria a que o banco resolvesse
 * devolver, e mudaria de um refresh para o outro.
 */
function ordenarCartoes(cartoes: CartaoKanban[]): CartaoKanban[] {
  return [...cartoes].sort(
    (a, b) =>
      a.posicao - b.posicao ||
      new Date(b.entrou_na_etapa_em).getTime() - new Date(a.entrou_na_etapa_em).getTime(),
  );
}

/**
 * O quadro de um funil.
 *
 * A regra de carteira vem pronta do banco: `lead_pipeline` é filtrada pela
 * policy `lead_pipeline_select_carteira` (que chama `pode_ver_lead`). O
 * vendedor recebe menos cartões que o gestor na mesma coluna, e nada aqui
 * precisa saber disso.
 *
 * Leads arquivados não entram: o vínculo com o funil continua existindo, mas
 * cartão de lead descartado só polui o quadro.
 */
export async function carregarQuadro(
  organizationId: string,
  pipelineId: string,
  filtros: FiltrosLead = {},
): Promise<Quadro | null> {
  const supabase = await criarClienteServidor();

  // A equipe entra na primeira janela: ela resolve o responsável dos cartões e
  // não depende de quais leads o quadro tem. Antes ela só começava depois dos
  // leads, somando duas idas ao banco em série.
  const [funilResposta, etapasResposta, vinculosResposta, membros] = await Promise.all([
    supabase
      .from('pipelines')
      .select('id, nome, descricao, padrao')
      .eq('organization_id', organizationId)
      .eq('id', pipelineId)
      .maybeSingle(),
    supabase
      .from('pipeline_stages')
      .select('id, nome, tipo, cor, posicao')
      .eq('pipeline_id', pipelineId)
      .order('posicao', { ascending: true }),
    // A ordem aqui não é a da tela (quem ordena a coluna é `ordenarCartoes`),
    // mas sem ela o `limit` cortaria linhas ao acaso: com o corte por data de
    // entrada na etapa, o que fica de fora é sempre o mais parado.
    supabase
      .from('lead_pipeline')
      .select('id, lead_id, stage_id, posicao, entrou_na_etapa_em')
      .eq('pipeline_id', pipelineId)
      .order('entrou_na_etapa_em', { ascending: false })
      .limit(LIMITE_QUADRO),
    listarMembros(organizationId),
  ]);

  if (funilResposta.error) {
    throw new Error(`Falha ao carregar o funil: ${funilResposta.error.message}`);
  }
  if (!funilResposta.data) return null;

  if (etapasResposta.error) {
    throw new Error(`Falha ao carregar as etapas: ${etapasResposta.error.message}`);
  }
  if (vinculosResposta.error) {
    throw new Error(`Falha ao carregar os cartões: ${vinculosResposta.error.message}`);
  }

  const funil = funilResposta.data as FunilResumo;
  const etapas = (etapasResposta.data ?? []) as {
    id: string;
    nome: string;
    tipo: TipoEtapa;
    cor: string | null;
    posicao: number;
  }[];

  const vinculos = (vinculosResposta.data ?? []) as {
    id: string;
    lead_id: string;
    stage_id: string;
    posicao: unknown;
    entrou_na_etapa_em: string;
  }[];

  // Os leads dos vínculos, já sem os arquivados. O `in` volta em lotes; o que
  // não voltar (arquivado ou fora da carteira) simplesmente não vira cartão.
  const leadIds = [...new Set(vinculos.map((vinculo) => vinculo.lead_id))];

  const leadsPorLote = await Promise.all(
    emLotes(leadIds).map((lote) =>
      supabase
        .from('leads')
        .select('id, nome, telefone, valor, responsavel_id, origem')
        .eq('organization_id', organizationId)
        .eq('arquivado', false)
        .in('id', lote),
    ),
  );

  const erroLeads = leadsPorLote.find((resposta) => resposta.error)?.error;
  if (erroLeads) {
    throw new Error(`Falha ao carregar os leads do quadro: ${erroLeads.message}`);
  }

  const leads = new Map(
    leadsPorLote
      .flatMap(
        (resposta) =>
          (resposta.data ?? []) as {
            id: string;
            nome: string;
            telefone: string | null;
            valor: unknown;
            responsavel_id: string | null;
            origem: string;
          }[],
      )
      .map((lead) => [lead.id, lead]),
  );

  // `membros` já veio na primeira janela, lá em cima.
  const tagsPorLead = await carregarTagsPorLead(organizationId, [...leads.keys()]);

  const membrosPorId = new Map(membros.map((membro) => [membro.user_id, membro]));

  const termoBusca = (filtros.busca ?? '').trim().toLowerCase();
  const digitosBusca = termoBusca.replace(/\D/g, '');

  const cartoesPorEtapa = new Map<string, CartaoKanban[]>();
  for (const vinculo of vinculos) {
    const lead = leads.get(vinculo.lead_id);
    if (!lead) continue;

    // Os filtros do quadro são aplicados aqui, sobre os cartões já carregados:
    // são poucos (teto de LIMITE_QUADRO) e assim uma troca de filtro não custa
    // consulta nova ao banco.
    if (filtros.responsavel === 'sem' && lead.responsavel_id) continue;
    if (filtros.responsavel && filtros.responsavel !== 'sem' && lead.responsavel_id !== filtros.responsavel) {
      continue;
    }
    if (filtros.origem && lead.origem !== filtros.origem) continue;
    if (filtros.tag && !(tagsPorLead.get(lead.id) ?? []).some((tag) => tag.id === filtros.tag)) {
      continue;
    }
    if (termoBusca) {
      const nome = lead.nome.toLowerCase();
      const telefone = (lead.telefone ?? '').replace(/\D/g, '');
      const casa =
        nome.includes(termoBusca) || (digitosBusca.length >= 3 && telefone.includes(digitosBusca));
      if (!casa) continue;
    }

    const cartao: CartaoKanban = {
      vinculo_id: vinculo.id,
      lead_id: lead.id,
      nome: lead.nome,
      telefone: lead.telefone,
      valor: paraNumero(lead.valor),
      responsavel: lead.responsavel_id ? membrosPorId.get(lead.responsavel_id) ?? null : null,
      tags: tagsPorLead.get(lead.id) ?? [],
      posicao: paraNumero(vinculo.posicao) ?? 0,
      entrou_na_etapa_em: vinculo.entrou_na_etapa_em,
    };

    const lista = cartoesPorEtapa.get(vinculo.stage_id) ?? [];
    lista.push(cartao);
    cartoesPorEtapa.set(vinculo.stage_id, lista);
  }

  const colunas: ColunaKanban[] = etapas.map((etapa) => ({
    id: etapa.id,
    nome: etapa.nome,
    tipo: etapa.tipo,
    cor: etapa.cor,
    posicao: etapa.posicao,
    cartoes: ordenarCartoes(cartoesPorEtapa.get(etapa.id) ?? []),
  }));

  return {
    funil,
    colunas,
    total_cartoes: colunas.reduce((soma, coluna) => soma + coluna.cartoes.length, 0),
    atingiu_limite: vinculos.length >= LIMITE_QUADRO,
  };
}
