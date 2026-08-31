/**
 * Fluxos, webhooks e entregas (lado servidor).
 *
 * Quem decide o que aparece é a RLS (migration 0005): todo membro LÊ a
 * automação — o vendedor merece saber o que dispara em nome dele —, e só
 * gestor/admin escreve. Nada aqui refaz essa checagem; o que a tela faz com
 * `podeGerenciar` é esconder controle inútil, não impor barreira.
 *
 * O SEGREDO DO WEBHOOK NÃO É SELECIONADO EM LUGAR NENHUM DESTE ARQUIVO, e não
 * é por disciplina: o `grant` de coluna da 0005 não dá SELECT nele para
 * `authenticated`. Pedir a coluna aqui devolveria erro, não o segredo.
 *
 * Este módulo é SÓ SERVIDOR. Não importe em componente com "use client".
 */
import { cache } from 'react';
import { criarClienteServidor } from '@/lib/supabase/server';
import {
  type AcaoFluxo,
  type EntregaResumo,
  type FluxoCompleto,
  type FluxoResumo,
  type GatilhoFluxo,
  type OpcoesDoConstrutor,
  type PassoSimulado,
  type SituacaoEntrega,
  type WebhookResumo,
} from './fluxos-tipos';

/**
 * Reexporta o vocabulário e os tipos para quem já importava daqui.
 *
 * A definição mora em `fluxos-tipos.ts` porque as telas do construtor são
 * componentes de cliente: se os rótulos morassem neste arquivo, importá-los
 * arrastaria o cliente do Supabase para o bundle do navegador.
 */
export * from './fluxos-tipos';


// ----------------------------------------------------------------- LEITURA

/**
 * Webhooks da organização, com o estado da fila de cada um.
 *
 * Os contadores vêm de uma segunda consulta e não de um `count` por webhook:
 * são duas idas ao banco no total, em vez de uma por linha da tela.
 */
export const listarWebhooks = cache(async function listarWebhooks(
  organizationId: string,
): Promise<WebhookResumo[]> {
  const supabase = await criarClienteServidor();

  const [hooks, fila] = await Promise.all([
    supabase
      .from('webhooks')
      .select('id, nome, url, ativo, max_tentativas, timeout_ms')
      .eq('organization_id', organizationId)
      .order('nome'),
    supabase
      .from('webhook_entregas')
      .select('webhook_id, situacao')
      .eq('organization_id', organizationId)
      .in('situacao', ['pendente', 'enviando', 'falhou', 'desistiu']),
  ]);

  if (hooks.error) {
    throw new Error(`Falha ao carregar os webhooks: ${hooks.error.message}`);
  }

  const contagem = new Map<string, { na_fila: number; desistiu: number }>();
  for (const linha of (fila.data ?? []) as { webhook_id: string; situacao: SituacaoEntrega }[]) {
    const atual = contagem.get(linha.webhook_id) ?? { na_fila: 0, desistiu: 0 };
    if (linha.situacao === 'desistiu') atual.desistiu += 1;
    else atual.na_fila += 1;
    contagem.set(linha.webhook_id, atual);
  }

  return ((hooks.data ?? []) as Omit<WebhookResumo, 'na_fila' | 'desistiu'>[]).map((hook) => ({
    ...hook,
    na_fila: contagem.get(hook.id)?.na_fila ?? 0,
    desistiu: contagem.get(hook.id)?.desistiu ?? 0,
  }));
});

/** Os fluxos da organização, com o tamanho e o movimento de cada um. */
export async function listarFluxos(organizationId: string): Promise<FluxoResumo[]> {
  const supabase = await criarClienteServidor();

  const seteDiasAtras = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const [fluxos, gatilhos, acoes, execucoes] = await Promise.all([
    supabase
      .from('fluxos')
      .select('id, nome, descricao, ativo, repetir')
      .eq('organization_id', organizationId)
      .order('nome'),
    supabase.from('fluxo_gatilhos').select('fluxo_id').eq('organization_id', organizationId),
    supabase.from('fluxo_acoes').select('fluxo_id').eq('organization_id', organizationId),
    supabase
      .from('fluxo_execucoes')
      .select('fluxo_id')
      .eq('organization_id', organizationId)
      .eq('situacao', 'executada')
      .gte('criado_em', seteDiasAtras),
  ]);

  if (fluxos.error) {
    throw new Error(`Falha ao carregar os fluxos: ${fluxos.error.message}`);
  }

  const contar = (linhas: { fluxo_id: string }[] | null) => {
    const mapa = new Map<string, number>();
    for (const linha of linhas ?? []) {
      mapa.set(linha.fluxo_id, (mapa.get(linha.fluxo_id) ?? 0) + 1);
    }
    return mapa;
  };

  const porGatilho = contar(gatilhos.data as { fluxo_id: string }[] | null);
  const porAcao = contar(acoes.data as { fluxo_id: string }[] | null);
  const porExecucao = contar(execucoes.data as { fluxo_id: string }[] | null);

  type Linha = Omit<FluxoResumo, 'total_gatilhos' | 'total_acoes' | 'execucoes_recentes'>;

  return ((fluxos.data ?? []) as Linha[]).map((fluxo) => ({
    ...fluxo,
    total_gatilhos: porGatilho.get(fluxo.id) ?? 0,
    total_acoes: porAcao.get(fluxo.id) ?? 0,
    execucoes_recentes: porExecucao.get(fluxo.id) ?? 0,
  }));
}

/** Um fluxo com seus gatilhos e ações. `null` quando não é desta organização. */
export async function carregarFluxo(
  organizationId: string,
  fluxoId: string,
): Promise<FluxoCompleto | null> {
  const supabase = await criarClienteServidor();

  const [fluxo, gatilhos, acoes] = await Promise.all([
    supabase
      .from('fluxos')
      .select('id, nome, descricao, ativo, repetir')
      .eq('id', fluxoId)
      .eq('organization_id', organizationId)
      .maybeSingle(),
    supabase
      .from('fluxo_gatilhos')
      .select('id, evento, pipeline_id, stage_id, tag_id, origem')
      .eq('fluxo_id', fluxoId)
      .order('criado_em'),
    supabase
      .from('fluxo_acoes')
      .select('id, ordem, tipo, config, atraso_minutos')
      .eq('fluxo_id', fluxoId)
      .order('ordem'),
  ]);

  if (!fluxo.data) return null;

  const lista = (acoes.data ?? []) as AcaoFluxo[];

  return {
    fluxo: {
      ...(fluxo.data as Omit<FluxoResumo, 'total_gatilhos' | 'total_acoes' | 'execucoes_recentes'>),
      total_gatilhos: (gatilhos.data ?? []).length,
      total_acoes: lista.length,
      execucoes_recentes: 0,
    },
    gatilhos: (gatilhos.data ?? []) as GatilhoFluxo[],
    acoes: lista,
  };
}

/** Tudo que os seletores do construtor precisam, em paralelo. */
export async function opcoesDoConstrutor(
  organizationId: string,
): Promise<OpcoesDoConstrutor> {
  const supabase = await criarClienteServidor();

  const [webhooks, tags, funis, etapas] = await Promise.all([
    supabase
      .from('webhooks')
      .select('id, nome, ativo')
      .eq('organization_id', organizationId)
      .order('nome'),
    supabase.from('tags').select('id, nome').eq('organization_id', organizationId).order('nome'),
    supabase
      .from('pipelines')
      .select('id, nome')
      .eq('organization_id', organizationId)
      .eq('arquivado', false)
      .order('posicao'),
    supabase
      .from('pipeline_stages')
      .select('id, nome, pipeline_id')
      .eq('organization_id', organizationId)
      .order('posicao'),
  ]);

  return {
    webhooks: (webhooks.data ?? []) as OpcoesDoConstrutor['webhooks'],
    tags: (tags.data ?? []) as OpcoesDoConstrutor['tags'],
    funis: (funis.data ?? []) as OpcoesDoConstrutor['funis'],
    etapas: (etapas.data ?? []) as OpcoesDoConstrutor['etapas'],
  };
}

/**
 * As últimas entregas da organização.
 *
 * O `payload` NÃO é selecionado. Ele existe no banco porque uma retentativa
 * precisa do mesmo corpo, mas trazê-lo para a tela colocaria o texto das
 * mensagens numa listagem que qualquer gestor deixa aberta o dia inteiro.
 * Quem precisa auditar um corpo específico consulta o banco.
 */
export async function listarEntregas(
  organizationId: string,
  limite = 60,
): Promise<EntregaResumo[]> {
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase
    .from('webhook_entregas')
    .select(
      'id, evento, situacao, tentativas, proxima_em, ultimo_status, ultimo_erro, ' +
        'criado_em, entregue_em, webhook_id, lead_id',
    )
    .eq('organization_id', organizationId)
    .order('criado_em', { ascending: false })
    .limit(limite);

  if (error) {
    throw new Error(`Falha ao carregar as entregas: ${error.message}`);
  }

  type Linha = Omit<EntregaResumo, 'webhook_nome' | 'lead_nome'> & {
    webhook_id: string;
    lead_id: string | null;
  };

  // `as unknown` no meio: o `select` é montado por concatenação, então o
  // Supabase não consegue inferir as colunas e devolve um tipo genérico.
  const linhas = (data ?? []) as unknown as Linha[];
  if (linhas.length === 0) return [];

  const idsHooks = [...new Set(linhas.map((linha) => linha.webhook_id))];
  const idsLeads = [...new Set(linhas.map((linha) => linha.lead_id).filter(Boolean))] as string[];

  const [hooks, leads] = await Promise.all([
    supabase.from('webhooks').select('id, nome').in('id', idsHooks),
    idsLeads.length > 0
      ? supabase.from('leads').select('id, nome').in('id', idsLeads)
      : Promise.resolve({ data: [] }),
  ]);

  const nomeHook = new Map(
    ((hooks.data ?? []) as { id: string; nome: string }[]).map((h) => [h.id, h.nome]),
  );
  const nomeLead = new Map(
    ((leads.data ?? []) as { id: string; nome: string }[]).map((l) => [l.id, l.nome]),
  );

  return linhas.map((linha) => ({
    ...linha,
    webhook_nome: nomeHook.get(linha.webhook_id) ?? null,
    // `null` aqui pode ser "lead apagado" OU "fora da sua carteira" — a RLS
    // dos leads não distingue os dois, e a tela não deve inventar a diferença.
    lead_nome: linha.lead_id ? nomeLead.get(linha.lead_id) ?? null : null,
  }));
}

/**
 * O que o fluxo faria com este lead. Não escreve nada.
 *
 * A guarda de organização e de carteira está DENTRO da função do banco
 * (`simular_fluxo`, migration 0005), não aqui: simular com o lead do colega
 * mostraria dado que a RLS esconde.
 */
export async function simularFluxo(
  fluxoId: string,
  leadId: string,
): Promise<{ passos: PassoSimulado[]; erro: string | null }> {
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase.rpc('simular_fluxo', {
    p_fluxo: fluxoId,
    p_lead: leadId,
  });

  if (error) {
    return { passos: [], erro: error.message };
  }

  return { passos: (data ?? []) as PassoSimulado[], erro: null };
}
