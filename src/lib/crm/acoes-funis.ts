'use server';

/**
 * Gestão de funis e etapas.
 *
 * Quem autoriza é a RLS: `pipeline_insert_gestor`, `stage_update_gestor` e
 * companhia exigem gestor/admin COM licença ativa. Este arquivo não
 * reimplementa essa regra — ele deixa a tentativa acontecer e traduz a recusa.
 *
 * As telas escondem os controles de quem é vendedor porque a estrutura do
 * funil é decisão de gestão (a migration 0002 diz isso na cara: "vendedor usa,
 * não redesenha"). Isso é moldar a interface pelo papel, não bloquear no
 * frontend: mesmo que alguém chame a Server Action direto, a policy recusa.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { criarClienteServidor } from '@/lib/supabase/server';
import { organizacaoAtual } from './dados';
import { traduzirErroBanco } from './erros';
import type { EstadoAcao, TipoEtapa } from './tipos';

const TIPOS: TipoEtapa[] = ['aberta', 'ganho', 'perdido'];

/** Espaçamento da renumeração. Igual ao do Kanban, pelo mesmo motivo. */
const PASSO = 10;

type Contexto = {
  supabase: Awaited<ReturnType<typeof criarClienteServidor>>;
  organizationId: string;
  acessoAtivo: boolean;
};

/** Sessão + organização. Server Action é endpoint POST: confere sempre. */
async function comContexto(): Promise<Contexto> {
  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const organizacao = await organizacaoAtual();
  return {
    supabase,
    organizationId: organizacao.organization_id,
    acessoAtivo: organizacao.acesso_ativo,
  };
}

function atualizarTelas(pipelineId?: string) {
  revalidatePath('/funis');
  revalidatePath('/kanban');
  revalidatePath('/crm');
  if (pipelineId) revalidatePath(`/funis/${pipelineId}`);
}

/**
 * Zero linhas alteradas sem erro = a policy recusou em silêncio. Dizer que
 * salvou seria mentir na tela.
 */
function recusaSilenciosa(acessoAtivo: boolean, alvo: string): string {
  return acessoAtivo
    ? `Nada foi alterado: ${alvo} não existe mais ou você não tem permissão para editá-lo.`
    : 'Nada foi alterado: o período de teste terminou e o banco está aceitando apenas leitura.';
}

function validarNome(nome: string, minimo: number, maximo: number, oQue: string): string | null {
  const limpo = nome.trim();
  if (limpo.length < minimo) return `Informe o nome ${oQue} (mínimo ${minimo} caracteres).`;
  if (limpo.length > maximo) return `O nome ${oQue} passa de ${maximo} caracteres.`;
  return null;
}

// ------------------------------------------------------------------ FUNIS

export async function criarFunil(entrada: {
  nome: string;
  descricao: string;
}): Promise<EstadoAcao> {
  const erroNome = validarNome(entrada.nome, 2, 80, 'do funil');
  if (erroNome) return { erro: erroNome };

  const { supabase, organizationId, acessoAtivo } = await comContexto();

  // Nasce no fim da lista.
  const { data: ultimos } = await supabase
    .from('pipelines')
    .select('posicao')
    .eq('organization_id', organizationId)
    .order('posicao', { ascending: false })
    .limit(1);

  const posicao = (((ultimos ?? []) as { posicao: number }[])[0]?.posicao ?? -PASSO) + PASSO;

  const { error } = await supabase.from('pipelines').insert({
    organization_id: organizationId,
    nome: entrada.nome.trim(),
    descricao: entrada.descricao.trim() || null,
    posicao,
    padrao: false,
    arquivado: false,
  });

  if (error) {
    if (error.code === '23505') {
      return { erro: 'Já existe um funil com esse nome nesta organização.' };
    }
    return { erro: traduzirErroBanco(error, { acessoAtivo, acao: 'criar o funil' }) };
  }

  atualizarTelas();
  return { erro: null };
}

export async function salvarFunil(entrada: {
  id: string;
  nome: string;
  descricao: string;
}): Promise<EstadoAcao> {
  const erroNome = validarNome(entrada.nome, 2, 80, 'do funil');
  if (erroNome) return { erro: erroNome };

  const { supabase, organizationId, acessoAtivo } = await comContexto();

  const { data, error } = await supabase
    .from('pipelines')
    .update({ nome: entrada.nome.trim(), descricao: entrada.descricao.trim() || null })
    .eq('id', entrada.id)
    .eq('organization_id', organizationId)
    .select('id');

  if (error) {
    if (error.code === '23505') {
      return { erro: 'Já existe um funil com esse nome nesta organização.' };
    }
    return { erro: traduzirErroBanco(error, { acessoAtivo, acao: 'salvar o funil' }) };
  }
  if ((data ?? []).length === 0) return { erro: recusaSilenciosa(acessoAtivo, 'este funil') };

  atualizarTelas(entrada.id);
  return { erro: null };
}

export async function alternarArquivamentoFunil(entrada: {
  id: string;
  arquivar: boolean;
}): Promise<EstadoAcao> {
  const { supabase, organizationId, acessoAtivo } = await comContexto();

  // Arquivar o padrão deixaria a organização com um funil padrão invisível: o
  // Kanban e a criação de lead filtram arquivados e cairiam no fallback sem
  // ninguém entender por quê.
  if (entrada.arquivar) {
    const { data: funil } = await supabase
      .from('pipelines')
      .select('padrao')
      .eq('id', entrada.id)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if ((funil as { padrao: boolean } | null)?.padrao) {
      return {
        erro: 'Este é o funil padrão. Defina outro como padrão antes de arquivá-lo.',
      };
    }
  }

  const { data, error } = await supabase
    .from('pipelines')
    .update({ arquivado: entrada.arquivar })
    .eq('id', entrada.id)
    .eq('organization_id', organizationId)
    .select('id');

  if (error) {
    return {
      erro: traduzirErroBanco(error, {
        acessoAtivo,
        acao: entrada.arquivar ? 'arquivar o funil' : 'restaurar o funil',
      }),
    };
  }
  if ((data ?? []).length === 0) return { erro: recusaSilenciosa(acessoAtivo, 'este funil') };

  atualizarTelas(entrada.id);
  return { erro: null };
}

/**
 * Define o funil padrão.
 *
 * São dois UPDATEs, e a ORDEM importa: existe um índice único parcial
 * (`idx_pipelines_um_padrao`) que permite um único padrão por organização.
 * Marcar o novo antes de desmarcar o antigo violaria o índice. Se o segundo
 * passo falhar, a organização fica sem padrão — situação que o app tolera,
 * porque a busca do funil padrão cai para o primeiro da ordem.
 */
export async function definirFunilPadrao(entrada: { id: string }): Promise<EstadoAcao> {
  const { supabase, organizationId, acessoAtivo } = await comContexto();

  const { error: erroLimpeza } = await supabase
    .from('pipelines')
    .update({ padrao: false })
    .eq('organization_id', organizationId)
    .eq('padrao', true);

  if (erroLimpeza) {
    return {
      erro: traduzirErroBanco(erroLimpeza, { acessoAtivo, acao: 'trocar o funil padrão' }),
    };
  }

  const { data, error } = await supabase
    .from('pipelines')
    .update({ padrao: true, arquivado: false })
    .eq('id', entrada.id)
    .eq('organization_id', organizationId)
    .select('id');

  if (error) {
    return { erro: traduzirErroBanco(error, { acessoAtivo, acao: 'definir o funil padrão' }) };
  }
  if ((data ?? []).length === 0) return { erro: recusaSilenciosa(acessoAtivo, 'este funil') };

  atualizarTelas(entrada.id);
  return { erro: null };
}

/**
 * Reordena pela lista completa de ids, renumerando todo mundo.
 *
 * Receber a ordem final inteira, em vez de "sobe um", evita o problema de
 * posições empatadas — que existem de verdade: os funis criados pela migration
 * nascem todos em `posicao = 0`.
 */
export async function reordenarFunis(entrada: { ids: string[] }): Promise<EstadoAcao> {
  const { supabase, organizationId, acessoAtivo } = await comContexto();

  const respostas = await Promise.all(
    entrada.ids.map((id, indice) =>
      supabase
        .from('pipelines')
        .update({ posicao: indice * PASSO })
        .eq('id', id)
        .eq('organization_id', organizationId)
        .select('id'),
    ),
  );

  const erro = respostas.find((resposta) => resposta.error)?.error;
  if (erro) {
    return { erro: traduzirErroBanco(erro, { acessoAtivo, acao: 'reordenar os funis' }) };
  }
  if (respostas.every((resposta) => (resposta.data ?? []).length === 0)) {
    return { erro: recusaSilenciosa(acessoAtivo, 'este funil') };
  }

  atualizarTelas();
  return { erro: null };
}

// ----------------------------------------------------------------- ETAPAS

function validarEtapa(entrada: { nome: string; tipo: string; cor: string }): string | null {
  const erroNome = validarNome(entrada.nome, 1, 60, 'da etapa');
  if (erroNome) return erroNome;

  if (!TIPOS.includes(entrada.tipo as TipoEtapa)) {
    return 'Tipo de etapa inválido.';
  }
  if (entrada.cor && !/^#[0-9a-fA-F]{6}$/.test(entrada.cor)) {
    return 'Cor inválida.';
  }
  return null;
}

export async function criarEtapa(entrada: {
  pipeline_id: string;
  nome: string;
  tipo: string;
  cor: string;
}): Promise<EstadoAcao> {
  const invalido = validarEtapa(entrada);
  if (invalido) return { erro: invalido };

  const { supabase, organizationId, acessoAtivo } = await comContexto();

  const { data: ultimas } = await supabase
    .from('pipeline_stages')
    .select('posicao')
    .eq('pipeline_id', entrada.pipeline_id)
    .order('posicao', { ascending: false })
    .limit(1);

  const posicao = (((ultimas ?? []) as { posicao: number }[])[0]?.posicao ?? -PASSO) + PASSO;

  const { error } = await supabase.from('pipeline_stages').insert({
    organization_id: organizationId,
    pipeline_id: entrada.pipeline_id,
    nome: entrada.nome.trim(),
    tipo: entrada.tipo,
    cor: entrada.cor || null,
    posicao,
  });

  if (error) {
    if (error.code === '23505') {
      return { erro: 'Já existe uma etapa com esse nome neste funil.' };
    }
    return { erro: traduzirErroBanco(error, { acessoAtivo, acao: 'criar a etapa' }) };
  }

  atualizarTelas(entrada.pipeline_id);
  return { erro: null };
}

export async function salvarEtapa(entrada: {
  id: string;
  pipeline_id: string;
  nome: string;
  tipo: string;
  cor: string;
}): Promise<EstadoAcao> {
  const invalido = validarEtapa(entrada);
  if (invalido) return { erro: invalido };

  const { supabase, organizationId, acessoAtivo } = await comContexto();

  const { data, error } = await supabase
    .from('pipeline_stages')
    .update({ nome: entrada.nome.trim(), tipo: entrada.tipo, cor: entrada.cor || null })
    .eq('id', entrada.id)
    .eq('organization_id', organizationId)
    .select('id');

  if (error) {
    if (error.code === '23505') {
      return { erro: 'Já existe uma etapa com esse nome neste funil.' };
    }
    return { erro: traduzirErroBanco(error, { acessoAtivo, acao: 'salvar a etapa' }) };
  }
  if ((data ?? []).length === 0) return { erro: recusaSilenciosa(acessoAtivo, 'esta etapa') };

  atualizarTelas(entrada.pipeline_id);
  return { erro: null };
}

/**
 * Exclui a etapa.
 *
 * O que acontece com os leads que estavam nela: a FK composta de
 * `lead_pipeline` tem `on delete cascade`, então eles SAEM DO FUNIL — mas
 * continuam existindo, com ficha e histórico. O trigger registra um
 * `lead.pipeline_removed` para cada um, então nada some sem deixar rastro.
 * A tela avisa quantos leads serão afetados antes de confirmar.
 */
export async function excluirEtapa(entrada: {
  id: string;
  pipeline_id: string;
}): Promise<EstadoAcao> {
  const { supabase, organizationId, acessoAtivo } = await comContexto();

  const { data, error } = await supabase
    .from('pipeline_stages')
    .delete()
    .eq('id', entrada.id)
    .eq('organization_id', organizationId)
    .select('id');

  if (error) {
    return { erro: traduzirErroBanco(error, { acessoAtivo, acao: 'excluir a etapa' }) };
  }
  if ((data ?? []).length === 0) {
    return {
      erro: 'Nada foi excluído: a etapa não existe mais ou você não tem permissão.',
    };
  }

  atualizarTelas(entrada.pipeline_id);
  return { erro: null };
}

export async function reordenarEtapas(entrada: {
  pipeline_id: string;
  ids: string[];
}): Promise<EstadoAcao> {
  const { supabase, organizationId, acessoAtivo } = await comContexto();

  const respostas = await Promise.all(
    entrada.ids.map((id, indice) =>
      supabase
        .from('pipeline_stages')
        .update({ posicao: indice * PASSO })
        .eq('id', id)
        .eq('organization_id', organizationId)
        .select('id'),
    ),
  );

  const erro = respostas.find((resposta) => resposta.error)?.error;
  if (erro) {
    return { erro: traduzirErroBanco(erro, { acessoAtivo, acao: 'reordenar as etapas' }) };
  }
  if (respostas.every((resposta) => (resposta.data ?? []).length === 0)) {
    return { erro: recusaSilenciosa(acessoAtivo, 'esta etapa') };
  }

  atualizarTelas(entrada.pipeline_id);
  return { erro: null };
}
