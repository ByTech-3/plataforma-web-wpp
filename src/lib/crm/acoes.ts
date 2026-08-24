'use server';

/**
 * Server Actions do CRM — criar, editar, arquivar e restaurar leads.
 *
 * TRÊS COISAS QUE ESTE ARQUIVO NÃO FAZ, DE PROPÓSITO:
 *
 *  1. Não decide quem pode escrever. Server Action é um endpoint POST público
 *     para quem tem sessão; a autorização real está nas policies de RLS, que
 *     rodam com o JWT do usuário. Aqui só conferimos que existe sessão.
 *
 *  2. Não insere em `activities`. Criação, edição, arquivamento, troca de
 *     etapa e tags já são registrados pelos triggers do banco (migration 0002,
 *     PASSO 8). Registrar de novo aqui duplicaria a linha do tempo.
 *
 *  3. Não bloqueia por licença vencida escondendo botão. A tentativa acontece,
 *     a policy recusa (`org_acesso_ativo`) e a recusa vira mensagem clara.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { criarClienteServidor } from '@/lib/supabase/server';
import { carregarFunilPadrao, organizacaoAtual } from './dados';
import { traduzirErroBanco } from './erros';
import { calcularPosicao, carregarColuna, renumerarVizinhos } from './ordem';
import {
  ORIGEM_PADRAO,
  ehOrigemValida,
  type EstadoAcao,
  type EstadoFormLead,
  type PedidoMover,
  type ValoresFormLead,
} from './tipos';

function lerValores(dados: FormData): ValoresFormLead {
  const texto = (campo: string) => String(dados.get(campo) ?? '').trim();
  return {
    nome: texto('nome'),
    telefone: texto('telefone'),
    email: texto('email'),
    origem: texto('origem') || ORIGEM_PADRAO,
    responsavel_id: texto('responsavel_id'),
    valor: texto('valor'),
    previsao_fechamento: texto('previsao_fechamento'),
  };
}

type Campos = {
  nome: string;
  telefone: string | null;
  email: string | null;
  origem: string;
  responsavel_id: string | null;
  valor: number | null;
  previsao_fechamento: string | null;
};

/** Validação de forma (não de permissão). Devolve o erro ou os campos limpos. */
function validar(valores: ValoresFormLead): { erro: string } | { campos: Campos } {
  if (valores.nome.length < 2) {
    return { erro: 'Informe o nome do lead (mínimo 2 caracteres).' };
  }
  if (valores.nome.length > 200) {
    return { erro: 'O nome do lead está longo demais (máximo 200 caracteres).' };
  }
  if (!ehOrigemValida(valores.origem)) {
    return { erro: 'Origem inválida. Escolha uma das opções da lista.' };
  }
  if (valores.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valores.email)) {
    return { erro: 'E-mail inválido.' };
  }
  if (valores.previsao_fechamento && !/^\d{4}-\d{2}-\d{2}$/.test(valores.previsao_fechamento)) {
    return { erro: 'Previsão de fechamento inválida.' };
  }

  let valor: number | null = null;
  if (valores.valor) {
    // Aceita "1500,50" e "1500.50": o campo é numérico, mas teclado brasileiro
    // manda vírgula em alguns navegadores.
    valor = Number(valores.valor.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(valor)) {
      return { erro: 'Valor inválido. Use apenas números.' };
    }
    if (valor < 0) {
      return { erro: 'O valor do negócio não pode ser negativo.' };
    }
  }

  return {
    campos: {
      nome: valores.nome,
      telefone: valores.telefone || null,
      email: valores.email || null,
      origem: valores.origem,
      responsavel_id: valores.responsavel_id || null,
      valor,
      previsao_fechamento: valores.previsao_fechamento || null,
    },
  };
}

function falha(
  erro: string,
  valores: ValoresFormLead,
  estadoAnterior: EstadoFormLead,
): EstadoFormLead {
  return { erro, valores, tentativa: estadoAnterior.tentativa + 1 };
}

/**
 * Cria o lead e o coloca no funil padrão, na primeira etapa.
 *
 * São dois INSERTs (leads, depois lead_pipeline) porque `lead_pipeline` é
 * tabela própria. Se o segundo falhar, o lead NÃO é desfeito: ele existe, com
 * histórico, e a ficha mostra "fora de qualquer funil" com um botão para
 * colocá-lo lá. Apagar um lead recém-criado para "limpar" seria pior — e a
 * migration foi explícita em nunca destruir histórico.
 */
export async function criarLeadAction(
  estadoAnterior: EstadoFormLead,
  dados: FormData,
): Promise<EstadoFormLead> {
  const valores = lerValores(dados);
  const validado = validar(valores);
  if ('erro' in validado) return falha(validado.erro, valores, estadoAnterior);

  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const organizacao = await organizacaoAtual();

  const { data: leadCriado, error } = await supabase
    .from('leads')
    .insert({
      ...validado.campos,
      organization_id: organizacao.organization_id,
      criado_por: user.id,
    })
    .select('id')
    .single();

  if (error) {
    return falha(
      traduzirErroBanco(error, {
        acessoAtivo: organizacao.acesso_ativo,
        acao: 'criar o lead',
      }),
      valores,
      estadoAnterior,
    );
  }

  const leadId = (leadCriado as { id: string }).id;
  const funil = await carregarFunilPadrao(organizacao.organization_id);

  if (funil) {
    // Erro aqui não invalida o lead: a ficha avisa e oferece o reparo.
    await supabase.from('lead_pipeline').insert({
      organization_id: organizacao.organization_id,
      lead_id: leadId,
      pipeline_id: funil.pipeline_id,
      stage_id: funil.primeira_etapa_id,
      posicao: 0,
    });
  }

  revalidatePath('/crm');
  redirect(`/crm/${leadId}`);
}

export async function atualizarLeadAction(
  estadoAnterior: EstadoFormLead,
  dados: FormData,
): Promise<EstadoFormLead> {
  const leadId = String(dados.get('lead_id') ?? '');
  if (!leadId) {
    return { erro: 'Lead não informado.', valores: null, tentativa: estadoAnterior.tentativa + 1 };
  }

  const valores = lerValores(dados);
  const validado = validar(valores);
  if ('erro' in validado) return falha(validado.erro, valores, estadoAnterior);

  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const organizacao = await organizacaoAtual();

  // `organization_id` NÃO entra no update: o trigger `tg_valida_lead` recusa a
  // troca de organização, e nem deve haver caminho de código que tente.
  const { data: atualizado, error } = await supabase
    .from('leads')
    .update(validado.campos)
    .eq('id', leadId)
    .eq('organization_id', organizacao.organization_id)
    .select('id');

  if (error) {
    return falha(
      traduzirErroBanco(error, {
        acessoAtivo: organizacao.acesso_ativo,
        acao: 'salvar as alterações',
      }),
      valores,
      estadoAnterior,
    );
  }

  // Zero linhas com licença vencida: o UPDATE não bate na policy e o Postgres
  // devolve sucesso sem ter alterado nada. Silenciar isso seria mentir na tela.
  if ((atualizado ?? []).length === 0) {
    return falha(
      organizacao.acesso_ativo
        ? 'Nada foi salvo: este lead não está na sua carteira ou não existe mais.'
        : 'Nada foi salvo: o período de teste terminou e o banco está aceitando apenas leitura.',
      valores,
      estadoAnterior,
    );
  }

  revalidatePath('/crm');
  revalidatePath(`/crm/${leadId}`);
  redirect(`/crm/${leadId}`);
}

/**
 * Arquiva ou restaura. Nunca apaga: o histórico em `activities` perderia o
 * contexto, e a própria migration trata arquivamento como descarte reversível.
 */
export async function alternarArquivamentoAction(
  _estadoAnterior: EstadoAcao,
  dados: FormData,
): Promise<EstadoAcao> {
  const leadId = String(dados.get('lead_id') ?? '');
  const arquivar = String(dados.get('arquivar') ?? '') === '1';
  if (!leadId) return { erro: 'Lead não informado.' };

  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const organizacao = await organizacaoAtual();

  const { data, error } = await supabase
    .from('leads')
    .update({ arquivado: arquivar })
    .eq('id', leadId)
    .eq('organization_id', organizacao.organization_id)
    .select('id');

  if (error) {
    return {
      erro: traduzirErroBanco(error, {
        acessoAtivo: organizacao.acesso_ativo,
        acao: arquivar ? 'arquivar o lead' : 'restaurar o lead',
      }),
    };
  }

  if ((data ?? []).length === 0) {
    return {
      erro: organizacao.acesso_ativo
        ? 'Nada foi alterado: este lead não está na sua carteira ou não existe mais.'
        : 'Nada foi alterado: o período de teste terminou e o banco está aceitando apenas leitura.',
    };
  }

  revalidatePath('/crm');
  revalidatePath(`/crm/${leadId}`);
  return { erro: null };
}

/**
 * Reparo: coloca no funil padrão um lead que ficou de fora — porque o vínculo
 * falhou na criação ou porque o lead entrou por outro caminho (a extensão do
 * WhatsApp, na Fase 6, grava só a ficha).
 */
export async function entrarNoFunilPadraoAction(
  _estadoAnterior: EstadoAcao,
  dados: FormData,
): Promise<EstadoAcao> {
  const leadId = String(dados.get('lead_id') ?? '');
  if (!leadId) return { erro: 'Lead não informado.' };

  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const organizacao = await organizacaoAtual();
  const funil = await carregarFunilPadrao(organizacao.organization_id);

  if (!funil) {
    return {
      erro:
        'Esta organização não tem nenhum funil com etapas. Peça a um gestor para criar ' +
        'o funil antes de mover leads.',
    };
  }

  const { error } = await supabase.from('lead_pipeline').insert({
    organization_id: organizacao.organization_id,
    lead_id: leadId,
    pipeline_id: funil.pipeline_id,
    stage_id: funil.primeira_etapa_id,
    posicao: 0,
  });

  if (error) {
    return {
      erro: traduzirErroBanco(error, {
        acessoAtivo: organizacao.acesso_ativo,
        acao: 'colocar o lead no funil',
      }),
    };
  }

  revalidatePath('/crm');
  revalidatePath(`/crm/${leadId}`);
  return { erro: null };
}




/**
 * Move um cartão de etapa e/ou de posição dentro da coluna.
 *
 * O cliente manda a intenção (etapa de destino + índice na coluna); o número
 * da `posicao` é calculado AQUI, sobre o estado atual do banco. Se fosse
 * calculado no browser, dois vendedores arrastando ao mesmo tempo gravariam
 * posições deduzidas de uma tela velha.
 *
 * O evento `lead.stage_changed` NÃO é inserido por esta função: o trigger
 * `log_lead_pipeline` já o grava quando o `stage_id` muda — e só quando muda,
 * porque reordenar cartão dentro da mesma coluna não é evento de negócio.
 */
export async function moverCartaoAction(pedido: PedidoMover): Promise<EstadoAcao> {
  const vinculoId = String(pedido?.vinculo_id ?? '');
  const stageId = String(pedido?.stage_id ?? '');
  const indicePedido = Number(pedido?.indice ?? 0);

  if (!vinculoId || !stageId || !Number.isInteger(indicePedido) || indicePedido < 0) {
    return { erro: 'Movimento inválido.' };
  }

  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const organizacao = await organizacaoAtual();

  // O vínculo precisa estar visível para este usuário. A policy de SELECT já
  // aplica a carteira, então "não encontrado" aqui cobre tanto "não existe"
  // quanto "não é seu" — de propósito.
  const { data: vinculo, error: erroVinculo } = await supabase
    .from('lead_pipeline')
    .select('id, lead_id, pipeline_id, stage_id')
    .eq('id', vinculoId)
    .eq('organization_id', organizacao.organization_id)
    .maybeSingle();

  if (erroVinculo) {
    return { erro: traduzirErroBanco(erroVinculo, { acao: 'mover o cartão' }) };
  }
  if (!vinculo) {
    return { erro: 'Cartão não encontrado ou fora da sua carteira. Atualize a página.' };
  }

  const atual = vinculo as { id: string; pipeline_id: string; stage_id: string };

  // A etapa de destino tem que ser do mesmo funil. A FK composta do banco já
  // recusaria, mas o erro dela é ilegível para quem está usando o quadro.
  const { data: etapaDestino, error: erroEtapa } = await supabase
    .from('pipeline_stages')
    .select('id')
    .eq('id', stageId)
    .eq('pipeline_id', atual.pipeline_id)
    .maybeSingle();

  if (erroEtapa) {
    return { erro: traduzirErroBanco(erroEtapa, { acao: 'mover o cartão' }) };
  }
  if (!etapaDestino) {
    return { erro: 'Etapa de destino inválida para este funil. Atualize a página.' };
  }

  // Coluna de destino como ela está agora, sem o cartão que está sendo movido.
  const { cartoes: coluna, erro: erroVizinhos } = await carregarColuna(
    supabase,
    atual.pipeline_id,
    stageId,
    vinculoId,
  );

  if (erroVizinhos) {
    return { erro: `Não foi possível mover o cartão: ${erroVizinhos}` };
  }

  const { indice, posicao: novaPosicao, precisaRenumerar } = calcularPosicao(
    coluna,
    indicePedido,
  );

  // O cartão movido primeiro: é o UPDATE que pode ser recusado por licença
  // vencida, e nesse caso nada mais deve ser tocado.
  const { data: movido, error: erroMover } = await supabase
    .from('lead_pipeline')
    .update({ stage_id: stageId, posicao: novaPosicao })
    .eq('id', vinculoId)
    .select('id');

  if (erroMover) {
    return {
      erro: traduzirErroBanco(erroMover, {
        acessoAtivo: organizacao.acesso_ativo,
        acao: 'mover o cartão',
      }),
    };
  }

  // Zero linhas com erro nenhum: a policy recusou em silêncio (licença vencida
  // ou lead fora da carteira). Dizer que moveu seria mentir na tela.
  if ((movido ?? []).length === 0) {
    return {
      erro: organizacao.acesso_ativo
        ? 'O cartão não foi movido: este lead não está na sua carteira ou saiu do funil.'
        : 'O cartão não foi movido: o período de teste terminou e o banco está aceitando apenas leitura.',
    };
  }

  if (precisaRenumerar) {
    // Quem enxerga o cartão na coluna também pode editá-lo (mesma carteira),
    // então estes UPDATEs só falhariam por licença — e ela já foi validada
    // acima pelo cartão movido.
    await renumerarVizinhos(supabase, coluna, indice, vinculoId);
  }

  revalidatePath('/kanban');
  revalidatePath('/crm');
  revalidatePath(`/crm/${(vinculo as { lead_id: string }).lead_id}`);
  return { erro: null };
}
