'use client';

/**
 * Os fluxos da organização.
 *
 * A lista mostra sem rodeio quais estão LIGADOS: um fluxo ativo manda mensagem
 * para cliente de verdade, e quem abre esta tela precisa ver isso antes de
 * qualquer outra coisa.
 */
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { criarFluxo, criarFluxoPreAtendimento, excluirFluxo } from '@/lib/crm/acoes-fluxos';
import type { FluxoResumo } from '@/lib/crm/fluxos-tipos';
import type { EstadoAcao } from '@/lib/crm/tipos';
import {
  AVISO,
  BOTAO_MENOR,
  BOTAO_PERIGO,
  BOTAO_PRIMARIO,
  BOTAO_SECUNDARIO,
  CAMPO,
  CARTAO,
  ERRO,
  LINK,
  ROTULO,
  SELO_ACAO,
  SELO_NEUTRO,
  TEXTO_2,
  TEXTO_3,
  TITULO_SECAO,
} from '@/components/ui';

type Props = {
  fluxos: FluxoResumo[];
  webhooks: { id: string; nome: string }[];
  podeGerenciar: boolean;
};

export function ListaDeFluxos({ fluxos, webhooks, podeGerenciar }: Props) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [webhookExemplo, setWebhookExemplo] = useState('');
  const [pendente, iniciar] = useTransition();

  function executar(acao: () => Promise<EstadoAcao & { id?: string }>, irPara = false) {
    setErro(null);
    iniciar(async () => {
      const resultado = await acao();
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      if (irPara && resultado.id) {
        router.push(`/configuracoes/fluxos/${resultado.id}`);
        return;
      }
      router.refresh();
    });
  }

  const ativos = fluxos.filter((fluxo) => fluxo.ativo).length;

  return (
    <div className="space-y-4">
      {erro && <p className={ERRO}>{erro}</p>}

      {ativos > 0 && (
        <p className={AVISO}>
          {ativos === 1 ? 'Há 1 fluxo ativo' : `Há ${ativos} fluxos ativos`} nesta organização. Eles
          rodam sozinhos e podem enviar mensagem para clientes de verdade.
        </p>
      )}

      {fluxos.length === 0 && !criando && (
        <div className={CARTAO}>
          <h2 className={TITULO_SECAO}>Nenhum fluxo ainda</h2>
          <p className={`mt-2 ${TEXTO_2}`}>
            Um fluxo é: <span className="font-medium">quando isto acontecer</span>, faça aquilo. O
            gatilho é um evento do CRM — lead criado, mudou de etapa, ganhou etiqueta — e os passos
            podem responder o cliente, etiquetar ou mover no funil.
          </p>
          <p className={`mt-2 ${TEXTO_2}`}>
            As mensagens saem pelo seu n8n ou pela API oficial do WhatsApp, via webhook. A extensão
            nunca dispara sozinha: automatizar envio pelo WhatsApp Web queima o número da empresa.
          </p>
        </div>
      )}

      <ul className="space-y-3">
        {fluxos.map((fluxo) => (
          <li key={fluxo.id} className={CARTAO}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/configuracoes/fluxos/${fluxo.id}`} className={`${LINK} text-base`}>
                    {fluxo.nome}
                  </Link>
                  {fluxo.ativo ? (
                    <span className={SELO_ACAO}>Ativo</span>
                  ) : (
                    <span className={SELO_NEUTRO}>Desativado</span>
                  )}
                  {fluxo.repetir && <span className={SELO_NEUTRO}>Repete</span>}
                </div>

                {fluxo.descricao && <p className={`mt-1 ${TEXTO_2}`}>{fluxo.descricao}</p>}

                <p className={`mt-1 ${TEXTO_3}`}>
                  {fluxo.total_gatilhos} {fluxo.total_gatilhos === 1 ? 'gatilho' : 'gatilhos'} ·{' '}
                  {fluxo.total_acoes} {fluxo.total_acoes === 1 ? 'passo' : 'passos'} ·{' '}
                  {fluxo.execucoes_recentes} {fluxo.execucoes_recentes === 1 ? 'ação' : 'ações'} nos
                  últimos 7 dias
                </p>
              </div>

              {podeGerenciar && (
                <div className="flex flex-wrap gap-2">
                  <Link href={`/configuracoes/fluxos/${fluxo.id}`} className={BOTAO_MENOR}>
                    Abrir
                  </Link>
                  <BotaoExcluir
                    fluxo={fluxo}
                    pendente={pendente}
                    aoExcluir={() => executar(() => excluirFluxo({ id: fluxo.id }))}
                  />
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      {podeGerenciar &&
        (criando ? (
          <form
            className={CARTAO}
            onSubmit={(evento) => {
              evento.preventDefault();
              executar(() => criarFluxo({ nome, descricao }), true);
            }}
          >
            <h2 className={TITULO_SECAO}>Novo fluxo</h2>

            <label className="mt-4 block">
              <span className={ROTULO}>Nome</span>
              <input
                value={nome}
                onChange={(evento) => setNome(evento.target.value)}
                maxLength={80}
                required
                autoFocus
                placeholder="Boas-vindas ao lead novo"
                className={CAMPO}
              />
            </label>

            <label className="mt-4 block">
              <span className={ROTULO}>Descrição</span>
              <textarea
                value={descricao}
                onChange={(evento) => setDescricao(evento.target.value)}
                maxLength={500}
                rows={2}
                className={CAMPO}
              />
            </label>

            <p className={`mt-4 ${TEXTO_3}`}>
              O fluxo nasce desativado. Você monta o gatilho e os passos, simula com um lead seu e só
              então liga.
            </p>

            <div className="mt-4 flex flex-wrap gap-3">
              <button type="submit" disabled={pendente} className={BOTAO_PRIMARIO}>
                {pendente ? 'Criando…' : 'Criar e montar'}
              </button>
              <button type="button" onClick={() => setCriando(false)} className={BOTAO_SECUNDARIO}>
                Cancelar
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <button type="button" onClick={() => setCriando(true)} className={BOTAO_PRIMARIO}>
              Novo fluxo
            </button>

            {webhooks.length > 0 && (
              <div className="flex flex-wrap items-end gap-2">
                <label>
                  <span className={`${ROTULO} text-xs`}>Ou comece pelo modelo pronto</span>
                  <select
                    value={webhookExemplo}
                    onChange={(evento) => setWebhookExemplo(evento.target.value)}
                    className={CAMPO}
                    aria-label="Webhook do fluxo de exemplo"
                  >
                    <option value="">Escolha o webhook…</option>
                    {webhooks.map((hook) => (
                      <option key={hook.id} value={hook.id}>
                        {hook.nome}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  disabled={pendente || !webhookExemplo}
                  onClick={() =>
                    executar(() => criarFluxoPreAtendimento({ webhook_id: webhookExemplo }), true)
                  }
                  className={BOTAO_SECUNDARIO}
                >
                  Criar “Pré-atendimento”
                </button>
              </div>
            )}
          </div>
        ))}
    </div>
  );
}

function BotaoExcluir({
  fluxo,
  pendente,
  aoExcluir,
}: {
  fluxo: FluxoResumo;
  pendente: boolean;
  aoExcluir: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);

  if (!confirmando) {
    return (
      <button
        type="button"
        onClick={() => setConfirmando(true)}
        disabled={pendente}
        className={BOTAO_PERIGO}
      >
        Excluir
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {fluxo.ativo && (
        <span className="text-xs text-perigo">Este fluxo está ativo.</span>
      )}
      <button type="button" onClick={aoExcluir} disabled={pendente} className={BOTAO_PERIGO}>
        Confirmar
      </button>
      <button type="button" onClick={() => setConfirmando(false)} className={BOTAO_MENOR}>
        Cancelar
      </button>
    </div>
  );
}
