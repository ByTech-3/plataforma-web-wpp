'use server';

/**
 * Criação de lead a partir de uma conversa da Inbox.
 *
 * A conversa NÃO vira lead sozinha: nada aqui roda sem o vendedor arrastar o
 * cartão para uma etapa. É a decisão dele que cria o registro.
 *
 * Não insere em `activities`: os triggers da migration 0002 já registram
 * `lead.created` e `lead.pipeline_added`.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { criarClienteServidor } from '@/lib/supabase/server';
import { organizacaoAtual } from './dados';
import { traduzirErroBanco } from './erros';
import { calcularPosicao, carregarColuna, renumerarVizinhos } from './ordem';
import type { EstadoAcao, PedidoCriarDaConversa } from './tipos';

/** Origem fixa: veio de uma conversa do WhatsApp, e o banco valida a lista. */
const ORIGEM_WHATSAPP = 'WhatsApp direto';

export async function criarLeadDaConversa(
  pedido: PedidoCriarDaConversa,
): Promise<EstadoAcao & { lead_id?: string }> {
  const conversaId = String(pedido?.conversa_id ?? '');
  const stageId = String(pedido?.stage_id ?? '');
  const indicePedido = Number(pedido?.indice ?? 0);

  if (!conversaId || !stageId || !Number.isInteger(indicePedido) || indicePedido < 0) {
    return { erro: 'Movimento inválido.' };
  }

  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const organizacao = await organizacaoAtual();

  // A conversa precisa ser desta organização E deste usuário — a policy já
  // garante, mas o filtro explícito evita depender só dela.
  const { data: conversa, error: erroConversa } = await supabase
    .from('whatsapp_conversas')
    .select('id, titulo, telefone, lead_id')
    .eq('id', conversaId)
    .eq('organization_id', organizacao.organization_id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (erroConversa) {
    return { erro: traduzirErroBanco(erroConversa, { acao: 'ler a conversa' }) };
  }
  if (!conversa) {
    return { erro: 'Conversa não encontrada. Atualize a Inbox.' };
  }

  const atual = conversa as {
    id: string;
    titulo: string | null;
    telefone: string | null;
    lead_id: string | null;
  };

  // Já virou lead antes (dois arrastos seguidos, duas abas abertas). Não é
  // erro do usuário, e criar de novo seria justamente o duplicado que a Inbox
  // existe para evitar.
  if (atual.lead_id) {
    return {
      erro: 'Esta conversa já virou lead. Atualize a Inbox para ver a ficha dela.',
      lead_id: atual.lead_id,
    };
  }

  const nome = (pedido.nome ?? atual.titulo ?? '').trim();
  if (nome.length < 2) {
    return { erro: 'Informe o nome do lead (mínimo 2 caracteres).' };
  }

  // O telefone confirmado no formulário vence o capturado; string vazia é
  // "o vendedor disse que não sabe", e vira null em vez de texto vazio.
  const telefone =
    pedido.telefone === undefined ? atual.telefone : pedido.telefone?.trim() || null;

  // A etapa precisa ser desta organização; daí sai o funil de destino.
  const { data: etapa, error: erroEtapa } = await supabase
    .from('pipeline_stages')
    .select('id, pipeline_id')
    .eq('id', stageId)
    .eq('organization_id', organizacao.organization_id)
    .maybeSingle();

  if (erroEtapa) {
    return { erro: traduzirErroBanco(erroEtapa, { acao: 'ler a etapa de destino' }) };
  }
  if (!etapa) {
    return { erro: 'Etapa de destino inválida. Atualize a página.' };
  }

  const pipelineId = (etapa as { pipeline_id: string }).pipeline_id;

  const { data: leadCriado, error: erroLead } = await supabase
    .from('leads')
    .insert({
      organization_id: organizacao.organization_id,
      nome,
      telefone,
      origem: ORIGEM_WHATSAPP,
      responsavel_id: user.id,
      criado_por: user.id,
    })
    .select('id')
    .single();

  if (erroLead) {
    return {
      erro: traduzirErroBanco(erroLead, {
        acessoAtivo: organizacao.acesso_ativo,
        acao: 'criar o lead',
      }),
    };
  }

  const leadId = (leadCriado as { id: string }).id;

  // Posição na coluna de destino, pela mesma regra do arrasto entre etapas.
  const { cartoes: coluna } = await carregarColuna(supabase, pipelineId, stageId);
  const { indice, posicao, precisaRenumerar } = calcularPosicao(coluna, indicePedido);

  const { data: vinculo, error: erroVinculo } = await supabase
    .from('lead_pipeline')
    .insert({
      organization_id: organizacao.organization_id,
      lead_id: leadId,
      pipeline_id: pipelineId,
      stage_id: stageId,
      posicao,
    })
    .select('id')
    .single();

  // O lead existe mesmo que o vínculo falhe — e a ficha dele mostra "fora do
  // funil" com o reparo à mão. Desfazer o lead aqui seria pior: ele já tem
  // histórico gravado pelo trigger.
  if (!erroVinculo && precisaRenumerar) {
    await renumerarVizinhos(supabase, coluna, indice, (vinculo as { id: string }).id);
  }

  // Amarra a conversa ao lead: é o que faz a Inbox parar de oferecê-la e
  // passar a mostrá-la como "já é lead".
  await supabase
    .from('whatsapp_conversas')
    .update({ lead_id: leadId })
    .eq('id', conversaId)
    .eq('user_id', user.id);

  revalidatePath('/kanban');
  revalidatePath('/crm');

  return { erro: null, lead_id: leadId };
}
