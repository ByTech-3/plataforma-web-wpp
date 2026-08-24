'use client';

/**
 * Enviar mensagem pelo WhatsApp, a partir do CRM.
 *
 * O QUE ACONTECE ONDE:
 *   servidor  → autoriza (carteira + licença, decididas pelo banco) e, depois,
 *               registra o EVENTO no histórico.
 *   navegador → fala com a extensão, que abre a conversa, lê e envia.
 *
 * O TEXTO DA MENSAGEM NUNCA VAI AO SERVIDOR. Ele sai deste campo, atravessa a
 * extensão e entra no WhatsApp. As mensagens lidas para dar contexto vivem em
 * memória enquanto este painel está aberto e somem quando ele fecha — não há
 * tabela, cache nem storage para elas.
 *
 * DUAS ESPERAS SEPARADAS, de propósito: a autorização (rápida, do servidor) e
 * o contexto da conversa (mais lento, depende da extensão e do WhatsApp). O
 * campo de mensagem libera assim que a primeira volta — quem já sabe o que vai
 * escrever não fica esperando o histórico carregar.
 *
 * UMA MENSAGEM POR VEZ, sempre iniciada por um clique do vendedor. Não existe
 * fila, agendamento nem repetição aqui: automação de envio pelo WhatsApp Web é
 * o caminho mais curto para o número do cliente ser banido.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { autorizarEnvio, registrarEnvio } from '@/lib/crm/acoes-mensagem';
import { SEM_EXTENSAO, perguntarExtensao, type MensagemLida } from '@/lib/crm/ponte-extensao';

type Props = {
  leadId: string;
  nome: string;
  variante?: 'botao' | 'discreto';
};

type Autorizacao =
  | { fase: 'verificando' }
  | { fase: 'liberado'; telefone: string }
  | { fase: 'bloqueado'; mensagem: string };

type Contexto =
  | { fase: 'carregando' }
  | { fase: 'pronto'; mensagens: MensagemLida[]; navegou: boolean; recarregou: boolean }
  | { fase: 'sem-extensao' }
  | { fase: 'sem-aba' }
  | { fase: 'erro'; mensagem: string };

const BOTAO_PRINCIPAL =
  'rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition ' +
  'hover:bg-emerald-700 disabled:opacity-60';

const BOTAO_SECUNDARIO =
  'rounded-md border border-black/15 px-3 py-1.5 text-xs font-medium transition ' +
  'hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10';

export function EnviarMensagem({ leadId, nome, variante = 'botao' }: Props) {
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <button
        type="button"
        draggable={false}
        onClick={(evento) => {
          evento.stopPropagation();
          setAberto(true);
        }}
        className={variante === 'botao' ? BOTAO_PRINCIPAL : BOTAO_SECUNDARIO}
      >
        Enviar mensagem
      </button>

      {aberto && <PainelEnvio leadId={leadId} nome={nome} aoFechar={() => setAberto(false)} />}
    </>
  );
}

function PainelEnvio({
  leadId,
  nome,
  aoFechar,
}: {
  leadId: string;
  nome: string;
  aoFechar: () => void;
}) {
  const [autorizacao, setAutorizacao] = useState<Autorizacao>({ fase: 'verificando' });
  const [contexto, setContexto] = useState<Contexto>({ fase: 'carregando' });
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const campo = useRef<HTMLTextAreaElement>(null);

  /** Contexto da conversa: depende da extensão, então roda depois e à parte. */
  const carregarContexto = useCallback(async (telefone: string) => {
    const leitura = await perguntarExtensao({ tipo: 'whatsapp/ler', telefone });

    if (leitura === SEM_EXTENSAO) {
      setContexto({ fase: 'sem-extensao' });
      return;
    }
    if (leitura.estado === 'sem-aba') {
      setContexto({ fase: 'sem-aba' });
      return;
    }
    if (leitura.estado === 'conversa-nao-abriu') {
      setContexto({
        fase: 'erro',
        mensagem:
          'Não consegui abrir esta conversa no WhatsApp Web. O número pode não ter WhatsApp.',
      });
      return;
    }
    if (leitura.estado === 'erro') {
      setContexto({ fase: 'erro', mensagem: leitura.mensagem });
      return;
    }

    setContexto({
      fase: 'pronto',
      mensagens: leitura.mensagens ?? [],
      navegou: leitura.navegou ?? false,
      recarregou: leitura.recarregou ?? false,
    });
  }, []);

  const preparar = useCallback(async () => {
    const permissao = await autorizarEnvio(leadId);

    if (!permissao.ok) {
      setAutorizacao({ fase: 'bloqueado', mensagem: permissao.mensagem });
      setContexto({ fase: 'erro', mensagem: permissao.mensagem });
      return;
    }

    // Libera o campo já: o contexto continua carregando por baixo.
    setAutorizacao({ fase: 'liberado', telefone: permissao.telefone });
    void carregarContexto(permissao.telefone);
  }, [leadId, carregarContexto]);

  function recomecar() {
    setContexto({ fase: 'carregando' });
    setResultado(null);
    if (autorizacao.fase === 'liberado') {
      void carregarContexto(autorizacao.telefone);
    } else {
      setAutorizacao({ fase: 'verificando' });
      void preparar();
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void preparar();
  }, [preparar]);

  useEffect(() => {
    if (autorizacao.fase === 'liberado') campo.current?.focus();
  }, [autorizacao.fase]);

  async function enviar() {
    if (autorizacao.fase !== 'liberado' || !texto.trim() || enviando) return;

    setEnviando(true);
    setResultado(null);

    const envio = await perguntarExtensao({
      tipo: 'whatsapp/enviar',
      telefone: autorizacao.telefone,
      texto: texto.trim(),
    });

    if (envio === SEM_EXTENSAO) {
      setEnviando(false);
      setResultado({ tipo: 'erro', texto: 'A extensão não respondeu. Recarregue a página.' });
      return;
    }
    if (envio.estado !== 'ok') {
      setEnviando(false);
      setResultado({
        tipo: 'erro',
        texto:
          envio.estado === 'erro'
            ? envio.mensagem
            : envio.estado === 'sem-aba'
              ? 'O WhatsApp Web não está aberto.'
              : 'Não consegui abrir esta conversa no WhatsApp Web.',
      });
      return;
    }

    // Enviou. O registro é o EVENTO, sem o conteúdo — e se ele falhar, o aviso
    // diz isso sem afirmar que a mensagem não saiu.
    const registro = await registrarEnvio(leadId);
    setEnviando(false);
    setTexto('');
    setResultado({
      tipo: 'ok',
      texto: registro.aviso ?? 'Mensagem enviada e registrada no histórico do lead.',
    });

    void carregarContexto(autorizacao.telefone);
  }

  const podeEscrever = autorizacao.fase === 'liberado';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={aoFechar}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-black/10 bg-white shadow-xl dark:border-white/15 dark:bg-neutral-900"
        onClick={(evento) => evento.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-black/10 px-5 py-4 dark:border-white/15">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">Mensagem para {nome}</h2>
            <p className="text-xs text-neutral-500">Enviada pelo seu WhatsApp Web</p>
          </div>
          <button type="button" onClick={aoFechar} className={BOTAO_SECUNDARIO}>
            Fechar
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <Conteudo autorizacao={autorizacao} contexto={contexto} aoTentarDeNovo={recomecar} />
        </div>

        {podeEscrever && (
          <footer className="border-t border-black/10 px-5 py-4 dark:border-white/15">
            {resultado && (
              <p
                className={`mb-3 rounded-md px-3 py-2 text-sm ${
                  resultado.tipo === 'ok'
                    ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-400'
                    : 'bg-red-500/10 text-red-700 dark:text-red-400'
                }`}
              >
                {resultado.texto}
              </p>
            )}

            <textarea
              ref={campo}
              value={texto}
              onChange={(evento) => setTexto(evento.target.value)}
              rows={3}
              maxLength={1000}
              disabled={enviando}
              placeholder="Escreva a mensagem…"
              className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/25 disabled:opacity-60 dark:border-white/20"
            />

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void enviar()}
                disabled={enviando || texto.trim().length === 0}
                className={BOTAO_PRINCIPAL}
              >
                {enviando ? 'Enviando…' : 'Enviar'}
              </button>
              <span className="text-xs text-neutral-500">
                Uma mensagem por vez, enviada por você.
              </span>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}

function Conteudo({
  autorizacao,
  contexto,
  aoTentarDeNovo,
}: {
  autorizacao: Autorizacao;
  contexto: Contexto;
  aoTentarDeNovo: () => void;
}) {
  if (autorizacao.fase === 'bloqueado') {
    return <Aviso tom="amarelo">{autorizacao.mensagem}</Aviso>;
  }

  if (contexto.fase === 'sem-extensao') {
    return (
      <Aviso tom="amarelo">
        A extensão do ByTech3 não foi encontrada neste navegador. Instale-a e recarregue esta
        página para enviar mensagens daqui.
      </Aviso>
    );
  }

  if (contexto.fase === 'sem-aba') {
    return (
      <div className="space-y-3">
        <Aviso tom="amarelo">
          O WhatsApp Web não está aberto. Abra-o em outra aba, deixe-o conectado e atualize aqui.
        </Aviso>
        <div className="flex flex-wrap gap-3">
          <a
            href="https://web.whatsapp.com"
            target="_blank"
            rel="noopener noreferrer"
            className={BOTAO_PRINCIPAL}
          >
            Abrir o WhatsApp Web
          </a>
          <button type="button" onClick={aoTentarDeNovo} className={BOTAO_SECUNDARIO}>
            Já abri — atualizar
          </button>
        </div>
      </div>
    );
  }

  if (contexto.fase === 'erro') {
    return (
      <div className="space-y-3">
        <Aviso tom="vermelho">{contexto.mensagem}</Aviso>
        <button type="button" onClick={aoTentarDeNovo} className={BOTAO_SECUNDARIO}>
          Tentar de novo
        </button>
      </div>
    );
  }

  if (contexto.fase === 'carregando') {
    return (
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        {autorizacao.fase === 'verificando'
          ? 'Verificando permissão…'
          : 'Abrindo a conversa no WhatsApp…'}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {contexto.recarregou ? (
        <Aviso tom="neutro">
          Este contato ainda não tinha conversa, então o WhatsApp precisou abrir uma nova.
        </Aviso>
      ) : (
        contexto.navegou && (
          <Aviso tom="neutro">
            A aba do WhatsApp estava em outra conversa e foi levada até esta.
          </Aviso>
        )
      )}

      <p className="text-xs font-medium uppercase tracking-widest text-neutral-500">
        Últimas mensagens
      </p>

      {contexto.mensagens.length === 0 ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Nenhuma mensagem nesta conversa ainda.
        </p>
      ) : (
        <ul className="space-y-2">
          {contexto.mensagens.map((mensagem, indice) => (
            <li
              key={`${indice}-${mensagem.horario ?? ''}`}
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                mensagem.direcao === 'saida'
                  ? 'ml-auto bg-emerald-500/10 text-emerald-900 dark:text-emerald-200'
                  : 'bg-black/5 dark:bg-white/10'
              }`}
            >
              <p className="whitespace-pre-wrap wrap-break-word">{mensagem.texto}</p>
              {mensagem.horario && (
                <p className="mt-1 text-[11px] text-neutral-500">{mensagem.horario}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="pt-2 text-[11px] text-neutral-500">
        Lidas ao vivo do seu WhatsApp. Não ficam guardadas em lugar nenhum.
      </p>
    </div>
  );
}

function Aviso({
  tom,
  children,
}: {
  tom: 'amarelo' | 'vermelho' | 'neutro';
  children: React.ReactNode;
}) {
  const estilos = {
    amarelo: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-400',
    vermelho: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400',
    neutro:
      'border-black/10 bg-black/5 text-neutral-700 dark:border-white/15 dark:bg-white/10 dark:text-neutral-300',
  }[tom];

  return <p className={`rounded-md border px-3 py-2.5 text-sm ${estilos}`}>{children}</p>;
}
