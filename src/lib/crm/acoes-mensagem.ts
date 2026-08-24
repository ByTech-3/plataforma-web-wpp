'use server';

/**
 * Autorização e registro do envio de mensagem.
 *
 * O ENVIO em si não passa por aqui: quem envia é a extensão, no navegador do
 * vendedor, direto no WhatsApp Web. O servidor faz as duas pontas —
 * autorizar antes e registrar depois — e nunca vê o texto da mensagem.
 *
 * POR QUE AUTORIZAR ANTES:
 *   A licença e a carteira são decididas pelo banco. Mas o envio acontece FORA
 *   do banco, então não há policy para recusá-lo depois do fato: se a checagem
 *   viesse junto do registro, a mensagem já teria saído para o cliente quando
 *   descobríssemos que o trial venceu. Por isso a permissão é perguntada ao
 *   banco ANTES, com `pode_editar_lead()` — a mesma função que as policies de
 *   escrita usam, e não uma regra paralela escrita no frontend.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { criarClienteServidor } from '@/lib/supabase/server';
import { organizacaoAtual } from './dados';
import { traduzirErroBanco } from './erros';

export type AutorizacaoEnvio =
  | { ok: true; nome: string; telefone: string }
  | { ok: false; motivo: 'sem-lead' | 'sem-telefone' | 'sem-permissao'; mensagem: string };

export async function autorizarEnvio(leadId: string): Promise<AutorizacaoEnvio> {
  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const organizacao = await organizacaoAtual();

  const { data: lead } = await supabase
    .from('leads')
    .select('id, nome, telefone')
    .eq('id', leadId)
    .eq('organization_id', organizacao.organization_id)
    .maybeSingle();

  const encontrado = lead as { id: string; nome: string; telefone: string | null } | null;

  if (!encontrado) {
    return {
      ok: false,
      motivo: 'sem-lead',
      mensagem: 'Lead não encontrado ou fora da sua carteira.',
    };
  }

  // Sem telefone não há para onde enviar. Explicar é melhor que abrir o painel
  // e falhar na hora do envio.
  const digitos = (encontrado.telefone ?? '').replace(/\D/g, '');
  if (digitos.length < 8) {
    return {
      ok: false,
      motivo: 'sem-telefone',
      mensagem:
        'Este lead não tem telefone cadastrado. Edite a ficha e informe o número para poder enviar.',
    };
  }

  // A MESMA função que as policies usam: carteira + licença ativa, decididas
  // no banco. Sem regra paralela no frontend.
  const { data: podeEditar, error } = await supabase.rpc('pode_editar_lead', { p_lead: leadId });

  if (error) {
    return {
      ok: false,
      motivo: 'sem-permissao',
      mensagem: traduzirErroBanco(error, { acao: 'verificar a permissão de envio' }),
    };
  }

  if (podeEditar !== true) {
    return {
      ok: false,
      motivo: 'sem-permissao',
      mensagem: organizacao.acesso_ativo
        ? 'Você não pode enviar mensagem para este lead: ele não está na sua carteira.'
        : 'Envio bloqueado: o período de teste desta organização terminou.',
    };
  }

  return { ok: true, nome: encontrado.nome, telefone: digitos };
}

export type RegistroEnvio = { erro: string | null; aviso?: string };

/**
 * Registra que uma mensagem foi enviada.
 *
 * O CONTEÚDO NÃO ENTRA. Nem no `descricao`, nem no `dados`. Fica registrado o
 * fato, o lead, o autor e o horário — o suficiente para o histórico, o
 * relatório e o gatilho do n8n, e nada além disso.
 *
 * Não existe trigger para este evento (o envio acontece fora do banco), então
 * este é um dos casos que a migration 0002 previu para o app inserir em
 * `activities` por conta própria.
 */
export async function registrarEnvio(leadId: string): Promise<RegistroEnvio> {
  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const organizacao = await organizacaoAtual();

  const { error } = await supabase.from('activities').insert({
    organization_id: organizacao.organization_id,
    lead_id: leadId,
    user_id: user.id,
    tipo: 'message.sent',
    descricao: 'Mensagem enviada pelo WhatsApp',
    dados: {},
  });

  // A mensagem JÁ FOI ENVIADA quando chegamos aqui. Falhar o registro não
  // desfaz nada, e dizer "não enviou" seria mentira — então o erro vira aviso.
  if (error) {
    // 23514 = o check de `activities.tipo` ainda não conhece 'message.sent',
    // ou seja: a migration 0004 não foi rodada.
    const aviso =
      error.code === '23514'
        ? 'A mensagem foi enviada, mas não entrou no histórico: falta rodar a migration 0004.'
        : `A mensagem foi enviada, mas não entrou no histórico: ${error.message}`;

    return { erro: null, aviso };
  }

  // `ultimo_contato_em` existe desde a 0002 exatamente para isto. Falha aqui
  // também não invalida o envio.
  await supabase
    .from('leads')
    .update({ ultimo_contato_em: new Date().toISOString() })
    .eq('id', leadId)
    .eq('organization_id', organizacao.organization_id);

  revalidatePath('/crm');
  revalidatePath(`/crm/${leadId}`);
  revalidatePath('/kanban');

  return { erro: null };
}
