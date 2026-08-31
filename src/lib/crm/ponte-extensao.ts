/**
 * Conversa do app com a extensão (lado navegador).
 *
 * O app roda no domínio da Vercel e a extensão trabalha no WhatsApp Web. O
 * canal entre os dois é um content script que a extensão injeta NAS PÁGINAS
 * DESTE APP e que repassa os pedidos ao service worker dela.
 *
 * Não há ID de extensão no código: se ela estiver instalada, responde; se não,
 * o pedido expira e a tela diz que a extensão não foi encontrada. É isso que
 * faz o mesmo código funcionar com a extensão carregada sem compactação e com
 * a publicada na Chrome Web Store, que têm IDs diferentes.
 *
 * NADA DE CONTEÚDO DE MENSAGEM SAI DAQUI PARA O SERVIDOR. O texto vai do
 * navegador do vendedor direto para o WhatsApp, pela extensão.
 */

const MARCA_APP = 'bytech3-app';
const MARCA_EXTENSAO = 'bytech3-extensao';

export type MensagemLida = {
  direcao: 'entrada' | 'saida';
  texto: string;
  horario: string | null;
};

export type PedidoPonte =
  | { tipo: 'whatsapp/status' }
  | { tipo: 'whatsapp/ler'; telefone: string }
  | { tipo: 'whatsapp/enviar'; telefone: string; texto: string };

/**
 * Por que a conversa não abriu. Espelha o tipo da extensão — os dois projetos
 * são separados, então o contrato é repetido de propósito, não importado.
 */
export type MotivoNaoAbriu = 'sem-conversa-previa' | 'nao-encontrada' | 'sem-resposta';

export type RespostaPonte =
  | { estado: 'sem-aba' }
  | { estado: 'conversa-nao-abriu'; motivo?: MotivoNaoAbriu; registro?: string[] }
  | { estado: 'erro'; mensagem: string }
  | {
      estado: 'ok';
      mensagens?: MensagemLida[];
      navegou?: boolean;
      recarregou?: boolean;
      registro?: string[];
    };

/**
 * Imprime no console o rastro de como a extensão tentou abrir a conversa.
 *
 * Vai para o console e não para a tela porque é diagnóstico de quem dá
 * suporte, não informação para o vendedor. Na tela fica só a frase que ele
 * consegue agir em cima.
 */
export function registrarRastro(rotulo: string, registro?: string[]): void {
  if (!registro || registro.length === 0) return;
  console.groupCollapsed(`[ByTech3] ${rotulo}`);
  for (const linha of registro) console.log(linha);
  console.groupEnd();
}

/** Quando nem a ponte responde: a extensão não está instalada nesta janela. */
export const SEM_EXTENSAO = 'sem-extensao' as const;

let contador = 0;

/**
 * Faz um pedido e espera a resposta.
 *
 * O tempo limite é generoso nos pedidos que podem navegar a aba do WhatsApp
 * (recarregar a página inteira leva segundos) e curto na checagem de presença,
 * que só precisa saber se alguém está do outro lado.
 */
export function perguntarExtensao(
  pedido: PedidoPonte,
  tempoLimiteMs = 30_000,
): Promise<RespostaPonte | typeof SEM_EXTENSAO> {
  if (typeof window === 'undefined') return Promise.resolve(SEM_EXTENSAO);

  contador += 1;
  const id = `${Date.now()}-${contador}`;

  return new Promise((resolver) => {
    const relogio = window.setTimeout(() => {
      window.removeEventListener('message', aoResponder);
      resolver(SEM_EXTENSAO);
    }, tempoLimiteMs);

    function aoResponder(evento: MessageEvent) {
      // Só a própria janela: um iframe de terceiro não responde por nós.
      if (evento.source !== window) return;

      const dados = evento.data as
        | { fonte?: string; id?: string; resposta?: RespostaPonte }
        | null;

      if (!dados || dados.fonte !== MARCA_EXTENSAO || dados.id !== id) return;

      window.clearTimeout(relogio);
      window.removeEventListener('message', aoResponder);
      resolver(dados.resposta ?? { estado: 'erro', mensagem: 'Resposta vazia da extensão.' });
    }

    window.addEventListener('message', aoResponder);
    window.postMessage({ fonte: MARCA_APP, id, pedido }, window.location.origin);
  });
}

/** A extensão está instalada e enxergando uma aba do WhatsApp? */
export async function verificarExtensao(): Promise<RespostaPonte | typeof SEM_EXTENSAO> {
  return perguntarExtensao({ tipo: 'whatsapp/status' }, 2_000);
}
