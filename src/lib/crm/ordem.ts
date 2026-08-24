/**
 * Posição dos cartões dentro de uma coluna do Kanban.
 *
 * Existe como módulo próprio porque agora tem DOIS usuários: mover um cartão
 * entre etapas e criar um lead a partir da Inbox. A regra de ordenação é
 * sutil (média entre vizinhos, com renumeração quando a média não cria um
 * valor entre eles) — duas cópias divergiriam, e o sintoma seria cartão
 * voltando sozinho para o lugar de onde saiu.
 *
 * Só servidor: recebe o cliente Supabase já autenticado de quem chamou, então
 * tudo aqui passa pela RLS com a identidade do usuário.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { paraNumero } from './formato';

/**
 * Distância padrão entre vizinhos. Com 1000, cabem uns 10 movimentos no mesmo
 * vão antes de a fração ficar pequena demais — e aí a coluna é renumerada.
 */
export const PASSO_POSICAO = 1000;

export type CartaoDaColuna = { id: string; posicao: number; entrou_na_etapa_em: string };

/** Mesma ordem da tela: `posicao` manda, empate cai para o mais recente. */
export function ordenarColuna(cartoes: CartaoDaColuna[]): CartaoDaColuna[] {
  return [...cartoes].sort(
    (a, b) =>
      a.posicao - b.posicao ||
      new Date(b.entrou_na_etapa_em).getTime() - new Date(a.entrou_na_etapa_em).getTime(),
  );
}

/**
 * A coluna como ela está agora, opcionalmente sem um cartão (o que está sendo
 * movido não deve contar como vizinho de si mesmo).
 */
export async function carregarColuna(
  supabase: SupabaseClient,
  pipelineId: string,
  stageId: string,
  ignorarVinculoId?: string,
): Promise<{ cartoes: CartaoDaColuna[]; erro: string | null }> {
  let consulta = supabase
    .from('lead_pipeline')
    .select('id, posicao, entrou_na_etapa_em')
    .eq('pipeline_id', pipelineId)
    .eq('stage_id', stageId);

  if (ignorarVinculoId) consulta = consulta.neq('id', ignorarVinculoId);

  const { data, error } = await consulta;
  if (error) return { cartoes: [], erro: error.message };

  const cartoes = ordenarColuna(
    ((data ?? []) as { id: string; posicao: unknown; entrou_na_etapa_em: string }[]).map(
      (linha) => ({
        id: linha.id,
        posicao: paraNumero(linha.posicao) ?? 0,
        entrou_na_etapa_em: linha.entrou_na_etapa_em,
      }),
    ),
  );

  return { cartoes, erro: null };
}

/**
 * Onde encaixar um cartão no índice pedido.
 *
 * `precisaRenumerar` fica verdadeiro quando a média não produz um valor
 * realmente entre os vizinhos. Não é caso raro: os leads criados antes do
 * Kanban entraram todos com `posicao = 0`, e a média entre 0 e 0 continua 0.
 */
export function calcularPosicao(
  coluna: CartaoDaColuna[],
  indicePedido: number,
): { indice: number; posicao: number; precisaRenumerar: boolean } {
  const indice = Math.min(Math.max(indicePedido, 0), coluna.length);
  const anterior = coluna[indice - 1]?.posicao;
  const proximo = coluna[indice]?.posicao;

  let posicao: number;
  if (anterior === undefined && proximo === undefined) {
    posicao = PASSO_POSICAO;
  } else if (anterior === undefined) {
    posicao = proximo! - PASSO_POSICAO;
  } else if (proximo === undefined) {
    posicao = anterior + PASSO_POSICAO;
  } else {
    posicao = (anterior + proximo) / 2;
  }

  const precisaRenumerar =
    anterior !== undefined &&
    proximo !== undefined &&
    (posicao <= anterior || posicao >= proximo);

  return {
    indice,
    posicao: precisaRenumerar ? (indice + 1) * PASSO_POSICAO : posicao,
    precisaRenumerar,
  };
}

/**
 * Reespaça os vizinhos depois de uma inserção que não coube.
 *
 * O cartão recém-posicionado é pulado (ele já foi gravado com o valor certo).
 * Falhas individuais são ignoradas de propósito: a esta altura o movimento
 * principal já foi aceito pelo banco, e o pior caso aqui é a ordem sair
 * aproximada — nunca o cartão parar na etapa errada.
 */
export async function renumerarVizinhos(
  supabase: SupabaseClient,
  coluna: CartaoDaColuna[],
  indice: number,
  idDoCartao: string,
): Promise<void> {
  const ordemFinal = [...coluna];
  ordemFinal.splice(indice, 0, { id: idDoCartao, posicao: 0, entrou_na_etapa_em: '' });

  await Promise.all(
    ordemFinal.map((cartao, posicaoNaColuna) => {
      if (cartao.id === idDoCartao) return null;
      return supabase
        .from('lead_pipeline')
        .update({ posicao: (posicaoNaColuna + 1) * PASSO_POSICAO })
        .eq('id', cartao.id);
    }),
  );
}
