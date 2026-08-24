/**
 * Etiquetas da organização (lado servidor).
 *
 * A RLS já decide o que aparece: `tag_select_membro` libera a leitura para
 * qualquer membro; criar é de qualquer membro com licença; renomear e excluir
 * é de gestor/admin, porque mexe nos leads de todo mundo.
 */
import { cache } from 'react';
import { criarClienteServidor } from '@/lib/supabase/server';
import type { TagLead } from './tipos';

export type TagGerenciavel = TagLead & { total_leads: number };

/** Todas as etiquetas da organização, em ordem alfabética. */
export const listarTags = cache(async function listarTags(
  organizationId: string,
): Promise<TagLead[]> {
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase
    .from('tags')
    .select('id, nome, cor')
    .eq('organization_id', organizationId);

  if (error) {
    throw new Error(`Falha ao carregar as etiquetas: ${error.message}`);
  }

  return ((data ?? []) as TagLead[]).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
});

/** Etiquetas com quantos leads cada uma tem — para a tela de gestão. */
export async function listarTagsParaGestao(
  organizationId: string,
): Promise<TagGerenciavel[]> {
  const supabase = await criarClienteServidor();

  const [tags, vinculosResposta] = await Promise.all([
    listarTags(organizationId),
    supabase.from('lead_tags').select('tag_id').eq('organization_id', organizationId),
  ]);

  const contagem = new Map<string, number>();
  for (const vinculo of (vinculosResposta.data ?? []) as { tag_id: string }[]) {
    contagem.set(vinculo.tag_id, (contagem.get(vinculo.tag_id) ?? 0) + 1);
  }

  return tags.map((tag) => ({ ...tag, total_leads: contagem.get(tag.id) ?? 0 }));
}

/** As etiquetas de um lead. */
export async function tagsDoLead(leadId: string): Promise<TagLead[]> {
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase
    .from('lead_tags')
    .select('tag_id')
    .eq('lead_id', leadId);

  if (error) {
    throw new Error(`Falha ao carregar as etiquetas do lead: ${error.message}`);
  }

  const ids = ((data ?? []) as { tag_id: string }[]).map((linha) => linha.tag_id);
  if (ids.length === 0) return [];

  const { data: tags } = await supabase.from('tags').select('id, nome, cor').in('id', ids);

  return ((tags ?? []) as TagLead[]).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Etapas de todos os funis ativos, para o seletor de filtro da listagem. */
export async function listarEtapasParaFiltro(
  organizationId: string,
): Promise<{ id: string; nome: string; funil: string }[]> {
  const supabase = await criarClienteServidor();

  const [funisResposta, etapasResposta] = await Promise.all([
    supabase
      .from('pipelines')
      .select('id, nome, padrao, posicao')
      .eq('organization_id', organizationId)
      .eq('arquivado', false)
      .order('padrao', { ascending: false })
      .order('posicao', { ascending: true }),
    supabase
      .from('pipeline_stages')
      .select('id, nome, pipeline_id, posicao')
      .eq('organization_id', organizationId)
      .order('posicao', { ascending: true }),
  ]);

  const funis = (funisResposta.data ?? []) as { id: string; nome: string }[];
  const etapas = (etapasResposta.data ?? []) as {
    id: string;
    nome: string;
    pipeline_id: string;
  }[];

  return funis.flatMap((funil) =>
    etapas
      .filter((etapa) => etapa.pipeline_id === funil.id)
      .map((etapa) => ({ id: etapa.id, nome: etapa.nome, funil: funil.nome })),
  );
}
