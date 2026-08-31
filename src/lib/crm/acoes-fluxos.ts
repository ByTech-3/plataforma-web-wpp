'use server';

/**
 * Escrita de webhooks, fluxos, gatilhos e ações.
 *
 * QUEM AUTORIZA É A RLS (migration 0005): criar e editar automação é de
 * gestor/admin, e depende de licença ativa. Este arquivo não repete essa
 * decisão — ele deixa a tentativa chegar ao banco e traduz a recusa. Quando o
 * UPDATE volta com ZERO LINHAS sem erro, é a policy tendo recusado em
 * silêncio: por isso todo update aqui pede `.select()` e confere o tamanho.
 *
 * NÃO insere em `activities`. A automação registra o que fez em
 * `fluxo_execucoes`, e os efeitos dela (etiqueta aplicada, etapa movida)
 * geram os eventos pelos triggers de sempre. Registrar aqui duplicaria.
 *
 * A RESTRIÇÃO DO PRODUTO, DE NOVO: a ação `mensagem` guarda um webhook de
 * destino. Não existe, em nenhuma linha deste arquivo, caminho para a
 * extensão. Envio automático pelo WhatsApp Web queima o número do cliente.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { criarClienteServidor } from '@/lib/supabase/server';
import { organizacaoAtual } from './dados';
import { traduzirErroBanco } from './erros';
import type { EstadoAcao } from './tipos';
import type { EventoGatilho, PassoSimulado, TipoAcao } from './fluxos';

async function comContexto() {
  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const organizacao = await organizacaoAtual();
  return { supabase, organizacao, user };
}

function atualizarTelas(fluxoId?: string) {
  revalidatePath('/configuracoes/fluxos');
  revalidatePath('/configuracoes/webhooks');
  revalidatePath('/configuracoes/entregas');
  if (fluxoId) revalidatePath(`/configuracoes/fluxos/${fluxoId}`);
}

/**
 * A frase para quando o banco aceita a operação e não muda linha nenhuma.
 *
 * É o caso mais confuso do produto: nenhum erro na tela e nada acontecendo.
 * São duas causas, e a mensagem diz as duas em vez de escolher uma.
 */
function nadaMudou(acessoAtivo: boolean, acao: string): string {
  return acessoAtivo
    ? `Nada foi ${acao}: gerenciar automação é de gestor ou administrador.`
    : `Nada foi ${acao}: o período de teste terminou e o banco só aceita leitura.`;
}

// ---------------------------------------------------------------- WEBHOOKS

/**
 * A mesma checagem que a função `url_de_webhook_segura` do banco faz.
 *
 * REPETIDA DE PROPÓSITO, e a barreira continua sendo a do banco: o `check` da
 * coluna recusa a gravação venha ela de onde vier. O que esta cópia entrega é
 * a frase explicando POR QUE o endereço não serve, em vez de um erro de
 * constraint. Se as duas divergirem, quem manda é o banco.
 */
function urlAceitavel(url: string): string | null {
  if (!/^https:\/\//i.test(url)) {
    return 'O endereço precisa começar com https:// — sem TLS, o segredo e os dados do lead viajariam em texto claro.';
  }

  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'Endereço inválido.';
  }

  if (!host.includes('.')) {
    return 'O endereço precisa ser um domínio público.';
  }

  const privado =
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^0\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /\.local$/.test(host) ||
    /\.internal$/.test(host);

  if (privado) {
    return 'Endereços internos (localhost, rede privada, metadados da nuvem) não são aceitos.';
  }

  return null;
}

export async function criarWebhook(entrada: {
  nome: string;
  url: string;
  segredo: string;
}): Promise<EstadoAcao> {
  const nome = entrada.nome.trim();
  if (nome.length < 1 || nome.length > 80) return { erro: 'Informe um nome de até 80 caracteres.' };

  const invalida = urlAceitavel(entrada.url.trim());
  if (invalida) return { erro: invalida };

  const segredo = entrada.segredo.trim();
  if (segredo && segredo.length < 16) {
    return { erro: 'O segredo precisa ter pelo menos 16 caracteres. Deixe em branco para o banco gerar um.' };
  }

  const { supabase, organizacao, user } = await comContexto();

  const { error } = await supabase.from('webhooks').insert({
    organization_id: organizacao.organization_id,
    nome,
    url: entrada.url.trim(),
    // Em branco: o `default` da coluna sorteia 32 bytes. Melhor que um segredo
    // curto digitado às pressas.
    ...(segredo ? { segredo } : {}),
    criado_por: user.id,
  });

  if (error) {
    if (error.code === '23505') return { erro: 'Já existe um webhook com esse nome.' };
    if (error.code === '23514') {
      return { erro: 'O banco recusou este endereço. Só https, e nunca endereço interno.' };
    }
    return {
      erro: traduzirErroBanco(error, {
        acessoAtivo: organizacao.acesso_ativo,
        acao: 'criar o webhook',
      }),
    };
  }

  atualizarTelas();
  return { erro: null };
}

export async function salvarWebhook(entrada: {
  id: string;
  nome: string;
  url: string;
  ativo: boolean;
  /** Em branco = mantém o que está lá. O app nunca lê o segredo de volta. */
  segredo: string;
}): Promise<EstadoAcao> {
  const nome = entrada.nome.trim();
  if (nome.length < 1 || nome.length > 80) return { erro: 'Informe um nome de até 80 caracteres.' };

  const invalida = urlAceitavel(entrada.url.trim());
  if (invalida) return { erro: invalida };

  const segredo = entrada.segredo.trim();
  if (segredo && segredo.length < 16) {
    return { erro: 'O segredo precisa ter pelo menos 16 caracteres.' };
  }

  const { supabase, organizacao } = await comContexto();

  const { data, error } = await supabase
    .from('webhooks')
    .update({
      nome,
      url: entrada.url.trim(),
      ativo: entrada.ativo,
      ...(segredo ? { segredo } : {}),
    })
    .eq('id', entrada.id)
    .eq('organization_id', organizacao.organization_id)
    .select('id');

  if (error) {
    if (error.code === '23505') return { erro: 'Já existe um webhook com esse nome.' };
    return {
      erro: traduzirErroBanco(error, {
        acessoAtivo: organizacao.acesso_ativo,
        acao: 'salvar o webhook',
      }),
    };
  }
  if ((data ?? []).length === 0) {
    return { erro: nadaMudou(organizacao.acesso_ativo, 'salvo') };
  }

  atualizarTelas();
  return { erro: null };
}

/**
 * Exclui o webhook.
 *
 * O `on delete cascade` leva junto as entregas dele — inclusive as que ainda
 * não saíram. É por isso que a tela avisa quantas estão na fila antes: apagar
 * um webhook com fila cheia é jogar fora mensagem que o cliente esperava.
 */
export async function excluirWebhook(entrada: { id: string }): Promise<EstadoAcao> {
  const { supabase, organizacao } = await comContexto();

  const { data, error } = await supabase
    .from('webhooks')
    .delete()
    .eq('id', entrada.id)
    .eq('organization_id', organizacao.organization_id)
    .select('id');

  if (error) {
    if (error.code === '23503') {
      return { erro: 'Há ações de fluxo apontando para este webhook. Remova-as antes.' };
    }
    return { erro: traduzirErroBanco(error, { acao: 'excluir o webhook' }) };
  }
  if ((data ?? []).length === 0) {
    return { erro: nadaMudou(organizacao.acesso_ativo, 'excluído') };
  }

  atualizarTelas();
  return { erro: null };
}

/** Devolve à fila uma entrega que falhou. Zera as tentativas, no banco. */
export async function reenviarEntrega(entrada: { id: string }): Promise<EstadoAcao> {
  const { supabase, organizacao } = await comContexto();

  const { error } = await supabase.rpc('reenfileirar_entrega', { p_entrega: entrada.id });

  if (error) {
    return {
      erro: traduzirErroBanco(error, {
        acessoAtivo: organizacao.acesso_ativo,
        acao: 'reenviar a entrega',
      }),
    };
  }

  atualizarTelas();
  return { erro: null };
}

// ------------------------------------------------------------------ FLUXOS

export async function criarFluxo(entrada: {
  nome: string;
  descricao: string;
}): Promise<EstadoAcao & { id?: string }> {
  const nome = entrada.nome.trim();
  if (nome.length < 1 || nome.length > 80) return { erro: 'Informe um nome de até 80 caracteres.' };

  const { supabase, organizacao, user } = await comContexto();

  const { data, error } = await supabase
    .from('fluxos')
    .insert({
      organization_id: organizacao.organization_id,
      nome,
      descricao: entrada.descricao.trim() || null,
      criado_por: user.id,
      // `ativo` não é enviado: o default do banco é `false`, e é assim que
      // tem de ser. Fluxo que nasce ligado dispara para a base inteira antes
      // de alguém conferir o que ele faz.
    })
    .select('id')
    .maybeSingle();

  if (error) {
    if (error.code === '23505') return { erro: 'Já existe um fluxo com esse nome.' };
    return {
      erro: traduzirErroBanco(error, {
        acessoAtivo: organizacao.acesso_ativo,
        acao: 'criar o fluxo',
      }),
    };
  }
  if (!data) {
    return { erro: nadaMudou(organizacao.acesso_ativo, 'criado') };
  }

  atualizarTelas();
  return { erro: null, id: (data as { id: string }).id };
}

export async function salvarFluxo(entrada: {
  id: string;
  nome: string;
  descricao: string;
  ativo: boolean;
  repetir: boolean;
}): Promise<EstadoAcao> {
  const nome = entrada.nome.trim();
  if (nome.length < 1 || nome.length > 80) return { erro: 'Informe um nome de até 80 caracteres.' };

  const { supabase, organizacao } = await comContexto();

  // Ligar um fluxo sem gatilho ou sem ação não dá erro nenhum no banco — ele
  // simplesmente nunca faz nada, e o gestor fica esperando. A recusa é aqui,
  // com a frase que explica o que falta.
  if (entrada.ativo) {
    const [gatilhos, acoes] = await Promise.all([
      supabase.from('fluxo_gatilhos').select('id').eq('fluxo_id', entrada.id).limit(1),
      supabase.from('fluxo_acoes').select('id').eq('fluxo_id', entrada.id).limit(1),
    ]);

    if ((gatilhos.data ?? []).length === 0) {
      return { erro: 'Este fluxo não tem gatilho: nada o faria começar. Escolha o que dispara antes de ativar.' };
    }
    if ((acoes.data ?? []).length === 0) {
      return { erro: 'Este fluxo não tem nenhuma ação: ele começaria e não faria nada.' };
    }
  }

  const { data, error } = await supabase
    .from('fluxos')
    .update({
      nome,
      descricao: entrada.descricao.trim() || null,
      ativo: entrada.ativo,
      repetir: entrada.repetir,
    })
    .eq('id', entrada.id)
    .eq('organization_id', organizacao.organization_id)
    .select('id');

  if (error) {
    if (error.code === '23505') return { erro: 'Já existe um fluxo com esse nome.' };
    return {
      erro: traduzirErroBanco(error, {
        acessoAtivo: organizacao.acesso_ativo,
        acao: 'salvar o fluxo',
      }),
    };
  }
  if ((data ?? []).length === 0) {
    return { erro: nadaMudou(organizacao.acesso_ativo, 'salvo') };
  }

  atualizarTelas(entrada.id);
  return { erro: null };
}

export async function excluirFluxo(entrada: { id: string }): Promise<EstadoAcao> {
  const { supabase, organizacao } = await comContexto();

  const { data, error } = await supabase
    .from('fluxos')
    .delete()
    .eq('id', entrada.id)
    .eq('organization_id', organizacao.organization_id)
    .select('id');

  if (error) {
    return { erro: traduzirErroBanco(error, { acao: 'excluir o fluxo' }) };
  }
  if ((data ?? []).length === 0) {
    return { erro: nadaMudou(organizacao.acesso_ativo, 'excluído') };
  }

  atualizarTelas();
  return { erro: null };
}

// ---------------------------------------------------------------- GATILHOS

export async function salvarGatilho(entrada: {
  id?: string;
  fluxo_id: string;
  evento: EventoGatilho;
  pipeline_id: string;
  stage_id: string;
  tag_id: string;
  origem: string;
}): Promise<EstadoAcao> {
  const { supabase, organizacao } = await comContexto();

  const linha = {
    organization_id: organizacao.organization_id,
    fluxo_id: entrada.fluxo_id,
    evento: entrada.evento,
    // Vazio vira `null`: no banco, `null` significa "não filtra por isso".
    pipeline_id: entrada.pipeline_id || null,
    stage_id: entrada.stage_id || null,
    tag_id: entrada.tag_id || null,
    origem: entrada.origem || null,
  };

  const consulta = entrada.id
    ? supabase.from('fluxo_gatilhos').update(linha).eq('id', entrada.id).select('id')
    : supabase.from('fluxo_gatilhos').insert(linha).select('id');

  const { data, error } = await consulta;

  if (error) {
    return {
      erro: traduzirErroBanco(error, {
        acessoAtivo: organizacao.acesso_ativo,
        acao: 'salvar o gatilho',
      }),
    };
  }
  if ((data ?? []).length === 0) {
    return { erro: nadaMudou(organizacao.acesso_ativo, 'salvo') };
  }

  atualizarTelas(entrada.fluxo_id);
  return { erro: null };
}

export async function excluirGatilho(entrada: {
  id: string;
  fluxo_id: string;
}): Promise<EstadoAcao> {
  const { supabase, organizacao } = await comContexto();

  const { data, error } = await supabase
    .from('fluxo_gatilhos')
    .delete()
    .eq('id', entrada.id)
    .eq('organization_id', organizacao.organization_id)
    .select('id');

  if (error) return { erro: traduzirErroBanco(error, { acao: 'excluir o gatilho' }) };
  if ((data ?? []).length === 0) {
    return { erro: nadaMudou(organizacao.acesso_ativo, 'excluído') };
  }

  atualizarTelas(entrada.fluxo_id);
  return { erro: null };
}

// ------------------------------------------------------------------- AÇÕES

/**
 * Cria ou atualiza um passo do fluxo.
 *
 * A validação do `config` por tipo NÃO está aqui: ela é o trigger
 * `valida_acao_de_fluxo` da migration 0005, que confere também se o webhook,
 * a etiqueta e a etapa são desta organização. Este arquivo só monta o objeto
 * e traduz a recusa — assim não existe uma segunda regra para divergir.
 */
export async function salvarAcao(entrada: {
  id?: string;
  fluxo_id: string;
  tipo: TipoAcao;
  atraso_minutos: number;
  webhook_id?: string;
  modelo?: string;
  tag_id?: string;
  pipeline_id?: string;
  stage_id?: string;
}): Promise<EstadoAcao> {
  const { supabase, organizacao } = await comContexto();

  const atraso = Number.isFinite(entrada.atraso_minutos)
    ? Math.max(0, Math.min(43200, Math.trunc(entrada.atraso_minutos)))
    : 0;

  let config: Record<string, unknown> = {};
  if (entrada.tipo === 'mensagem') {
    config = { webhook_id: entrada.webhook_id ?? '', modelo: (entrada.modelo ?? '').trim() };
  } else if (entrada.tipo === 'webhook') {
    config = { webhook_id: entrada.webhook_id ?? '' };
  } else if (entrada.tipo === 'etiqueta') {
    config = { tag_id: entrada.tag_id ?? '' };
  } else {
    config = { pipeline_id: entrada.pipeline_id ?? '', stage_id: entrada.stage_id ?? '' };
  }

  let ordem = 0;
  if (!entrada.id) {
    // A última + 1. Uma consulta a mais, mas o `unique (fluxo_id, ordem)`
    // não perdoa palpite.
    const { data: ultima } = await supabase
      .from('fluxo_acoes')
      .select('ordem')
      .eq('fluxo_id', entrada.fluxo_id)
      .order('ordem', { ascending: false })
      .limit(1)
      .maybeSingle();

    ordem = ((ultima as { ordem: number } | null)?.ordem ?? -1) + 1;
  }

  const consulta = entrada.id
    ? supabase
        .from('fluxo_acoes')
        .update({ tipo: entrada.tipo, config, atraso_minutos: atraso })
        .eq('id', entrada.id)
        .select('id')
    : supabase
        .from('fluxo_acoes')
        .insert({
          organization_id: organizacao.organization_id,
          fluxo_id: entrada.fluxo_id,
          ordem,
          tipo: entrada.tipo,
          config,
          atraso_minutos: atraso,
        })
        .select('id');

  const { data, error } = await consulta;

  if (error) {
    // P0001 são as mensagens do trigger de validação, já em português e
    // específicas ("A ação mensagem precisa de um modelo de texto.").
    return {
      erro: traduzirErroBanco(error, {
        acessoAtivo: organizacao.acesso_ativo,
        acao: 'salvar a ação',
      }),
    };
  }
  if ((data ?? []).length === 0) {
    return { erro: nadaMudou(organizacao.acesso_ativo, 'salvo') };
  }

  atualizarTelas(entrada.fluxo_id);
  return { erro: null };
}

export async function excluirAcao(entrada: {
  id: string;
  fluxo_id: string;
}): Promise<EstadoAcao> {
  const { supabase, organizacao } = await comContexto();

  const { data, error } = await supabase
    .from('fluxo_acoes')
    .delete()
    .eq('id', entrada.id)
    .eq('organization_id', organizacao.organization_id)
    .select('id');

  if (error) return { erro: traduzirErroBanco(error, { acao: 'excluir a ação' }) };
  if ((data ?? []).length === 0) {
    return { erro: nadaMudou(organizacao.acesso_ativo, 'excluído') };
  }

  atualizarTelas(entrada.fluxo_id);
  return { erro: null };
}

/**
 * Troca duas ações de lugar.
 *
 * Feito em três passos por causa do `unique (fluxo_id, ordem)`: a primeira vai
 * para uma ordem que ninguém usa (-1), a segunda ocupa o lugar dela, e a
 * primeira desce para o lugar da segunda. Um "update os dois de uma vez"
 * esbarraria no índice no meio do caminho.
 */
export async function moverAcao(entrada: {
  fluxo_id: string;
  id: string;
  direcao: 'cima' | 'baixo';
}): Promise<EstadoAcao> {
  const { supabase, organizacao } = await comContexto();

  const { data: acoes } = await supabase
    .from('fluxo_acoes')
    .select('id, ordem')
    .eq('fluxo_id', entrada.fluxo_id)
    .order('ordem');

  const lista = (acoes ?? []) as { id: string; ordem: number }[];
  const indice = lista.findIndex((acao) => acao.id === entrada.id);
  const vizinho = entrada.direcao === 'cima' ? indice - 1 : indice + 1;

  if (indice < 0 || vizinho < 0 || vizinho >= lista.length) {
    return { erro: null };
  }

  const atual = lista[indice];
  const outro = lista[vizinho];

  const passo = async (id: string, ordem: number) =>
    supabase
      .from('fluxo_acoes')
      .update({ ordem })
      .eq('id', id)
      .eq('organization_id', organizacao.organization_id)
      .select('id');

  const primeiro = await passo(atual.id, -1);
  if (primeiro.error) {
    return {
      erro: traduzirErroBanco(primeiro.error, {
        acessoAtivo: organizacao.acesso_ativo,
        acao: 'reordenar as ações',
      }),
    };
  }
  if ((primeiro.data ?? []).length === 0) {
    return { erro: nadaMudou(organizacao.acesso_ativo, 'alterado') };
  }

  await passo(outro.id, atual.ordem);
  await passo(atual.id, outro.ordem);

  atualizarTelas(entrada.fluxo_id);
  return { erro: null };
}

// -------------------------------------------------------------- SIMULAÇÃO

/**
 * O que o fluxo faria com este lead — sem fazer nada.
 *
 * Não chama `revalidatePath`: nada mudou. É uma Server Action só porque o
 * simulador é um componente de cliente e a consulta precisa do cliente do
 * servidor, com o JWT do usuário.
 *
 * As duas guardas (organização e carteira) estão DENTRO de `simular_fluxo`,
 * no banco: simular com o lead do colega mostraria dado que a RLS esconde.
 */
export async function simularFluxoAction(entrada: {
  fluxo_id: string;
  lead_id: string;
}): Promise<{ erro: string | null; passos: PassoSimulado[] }> {
  if (!entrada.lead_id) {
    return { erro: 'Escolha um lead para ver o que aconteceria com ele.', passos: [] };
  }

  const { supabase } = await comContexto();

  const { data, error } = await supabase.rpc('simular_fluxo', {
    p_fluxo: entrada.fluxo_id,
    p_lead: entrada.lead_id,
  });

  if (error) {
    // 42501 vem das guardas da função, com a frase já pronta em português.
    return { erro: error.message, passos: [] };
  }

  return { erro: null, passos: (data ?? []) as PassoSimulado[] };
}

// ------------------------------------------------------- MODELO DE EXEMPLO

/**
 * Cria o fluxo "Pré-atendimento", DESATIVADO, para o gestor revisar.
 *
 * Quem monta é a função do banco: assim o exemplo e as regras de validação
 * moram juntos, e um exemplo nunca nasce inválido.
 */
export async function criarFluxoPreAtendimento(entrada: {
  webhook_id: string;
}): Promise<EstadoAcao & { id?: string }> {
  const { supabase, organizacao } = await comContexto();

  if (!entrada.webhook_id) {
    return { erro: 'Escolha antes o webhook que vai receber as mensagens deste fluxo.' };
  }

  const { data, error } = await supabase.rpc('criar_fluxo_pre_atendimento', {
    p_org: organizacao.organization_id,
    p_webhook: entrada.webhook_id,
  });

  if (error) {
    return {
      erro: traduzirErroBanco(error, {
        acessoAtivo: organizacao.acesso_ativo,
        acao: 'criar o fluxo de exemplo',
      }),
    };
  }

  atualizarTelas();
  return { erro: null, id: (data as string | null) ?? undefined };
}
