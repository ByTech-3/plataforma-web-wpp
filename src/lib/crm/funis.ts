/**
 * Leitura dos funis para a tela de gestão (lado servidor).
 *
 * Diferente de `listarFunis` (que alimenta o seletor do Kanban e só mostra os
 * ativos), aqui os arquivados TAMBÉM aparecem: é nesta tela que eles voltam.
 *
 * Quem decide o que o usuário enxerga continua sendo a RLS — a policy de
 * `pipelines` libera SELECT para qualquer membro da organização, e a escrita
 * só para gestor/admin com licença ativa.
 */
import { criarClienteServidor } from '@/lib/supabase/server';
import type { EtapaGerenciavel, FunilGerenciavel, TipoEtapa } from './tipos';

/**
 * Quantos leads há em cada funil e em cada etapa.
 *
 * Contado a partir de `lead_pipeline`, que a RLS já filtra pela carteira. Para
 * gestor/admin — que são quem gerencia funil — isso é a organização inteira.
 */
async function contarVinculos(organizationId: string): Promise<{
  porFunil: Map<string, number>;
  porEtapa: Map<string, number>;
}> {
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase
    .from('lead_pipeline')
    .select('pipeline_id, stage_id')
    .eq('organization_id', organizationId);

  if (error) {
    throw new Error(`Falha ao contar os leads dos funis: ${error.message}`);
  }

  const porFunil = new Map<string, number>();
  const porEtapa = new Map<string, number>();

  for (const vinculo of (data ?? []) as { pipeline_id: string; stage_id: string }[]) {
    porFunil.set(vinculo.pipeline_id, (porFunil.get(vinculo.pipeline_id) ?? 0) + 1);
    porEtapa.set(vinculo.stage_id, (porEtapa.get(vinculo.stage_id) ?? 0) + 1);
  }

  return { porFunil, porEtapa };
}

export async function listarFunisParaGestao(
  organizationId: string,
): Promise<FunilGerenciavel[]> {
  const supabase = await criarClienteServidor();

  const [funisResposta, etapasResposta, contagens] = await Promise.all([
    supabase
      .from('pipelines')
      .select('id, nome, descricao, posicao, padrao, arquivado')
      .eq('organization_id', organizationId)
      .order('arquivado', { ascending: true })
      .order('posicao', { ascending: true }),
    supabase.from('pipeline_stages').select('pipeline_id').eq('organization_id', organizationId),
    contarVinculos(organizationId),
  ]);

  if (funisResposta.error) {
    throw new Error(`Falha ao carregar os funis: ${funisResposta.error.message}`);
  }
  if (etapasResposta.error) {
    throw new Error(`Falha ao carregar as etapas: ${etapasResposta.error.message}`);
  }

  const etapasPorFunil = new Map<string, number>();
  for (const etapa of (etapasResposta.data ?? []) as { pipeline_id: string }[]) {
    etapasPorFunil.set(etapa.pipeline_id, (etapasPorFunil.get(etapa.pipeline_id) ?? 0) + 1);
  }

  return (
    (funisResposta.data ?? []) as {
      id: string;
      nome: string;
      descricao: string | null;
      posicao: number;
      padrao: boolean;
      arquivado: boolean;
    }[]
  ).map((funil) => ({
    ...funil,
    total_etapas: etapasPorFunil.get(funil.id) ?? 0,
    total_leads: contagens.porFunil.get(funil.id) ?? 0,
  }));
}

export async function carregarFunilParaGestao(
  organizationId: string,
  pipelineId: string,
): Promise<{ funil: FunilGerenciavel; etapas: EtapaGerenciavel[] } | null> {
  const supabase = await criarClienteServidor();

  const [funilResposta, etapasResposta, contagens] = await Promise.all([
    supabase
      .from('pipelines')
      .select('id, nome, descricao, posicao, padrao, arquivado')
      .eq('organization_id', organizationId)
      .eq('id', pipelineId)
      .maybeSingle(),
    supabase
      .from('pipeline_stages')
      .select('id, nome, tipo, cor, posicao')
      .eq('pipeline_id', pipelineId)
      .order('posicao', { ascending: true }),
    contarVinculos(organizationId),
  ]);

  if (funilResposta.error) {
    throw new Error(`Falha ao carregar o funil: ${funilResposta.error.message}`);
  }
  if (!funilResposta.data) return null;

  if (etapasResposta.error) {
    throw new Error(`Falha ao carregar as etapas: ${etapasResposta.error.message}`);
  }

  const bruto = funilResposta.data as {
    id: string;
    nome: string;
    descricao: string | null;
    posicao: number;
    padrao: boolean;
    arquivado: boolean;
  };

  const etapas = (
    (etapasResposta.data ?? []) as {
      id: string;
      nome: string;
      tipo: TipoEtapa;
      cor: string | null;
      posicao: number;
    }[]
  ).map((etapa) => ({ ...etapa, total_leads: contagens.porEtapa.get(etapa.id) ?? 0 }));

  return {
    funil: {
      ...bruto,
      total_etapas: etapas.length,
      total_leads: contagens.porFunil.get(bruto.id) ?? 0,
    },
    etapas,
  };
}
