'use client';

/**
 * Webhooks da organização: cadastrar, editar e ver o estado da fila.
 *
 * O SEGREDO NUNCA É MOSTRADO. Não é a tela escondendo: o `grant` de coluna da
 * migration 0005 não dá SELECT nele para `authenticated`, então ele não chega
 * até aqui nem que alguém peça. O campo escreve por cima; em branco, mantém o
 * que está no banco.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  criarWebhook,
  excluirWebhook,
  salvarWebhook,
} from '@/lib/crm/acoes-fluxos';
import type { WebhookResumo } from '@/lib/crm/fluxos-tipos';
import {
  BOTAO_MENOR,
  BOTAO_PERIGO,
  BOTAO_PRIMARIO,
  BOTAO_SECUNDARIO,
  CAMPO,
  CARTAO,
  CARTAO_INTERNO,
  ERRO,
  INFO,
  ROTULO,
  ROTULO_MINI,
  SELO_ALERTA,
  SELO_NEUTRO,
  SELO_PERIGO,
  TEXTO_2,
  TEXTO_3,
  TITULO_SECAO,
} from '@/components/ui';
import type { EstadoAcao } from '@/lib/crm/tipos';

type Props = {
  webhooks: WebhookResumo[];
  podeGerenciar: boolean;
};

export function GerenciadorWebhooks({ webhooks, podeGerenciar }: Props) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function executar(acao: () => Promise<EstadoAcao>, aoDarCerto?: () => void) {
    setErro(null);
    iniciar(async () => {
      const resultado = await acao();
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      aoDarCerto?.();
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {erro && <p className={ERRO}>{erro}</p>}

      {webhooks.length === 0 && !criando && (
        <div className={CARTAO}>
          <h2 className={TITULO_SECAO}>Nenhum destino cadastrado</h2>
          <p className={`mt-2 ${TEXTO_2}`}>
            Um webhook é o endereço para onde a automação manda o que precisa sair — o seu fluxo no
            n8n, ou a API oficial do WhatsApp. É por ele que a mensagem automática vai: a extensão
            nunca dispara sozinha, porque isso queima o número do cliente.
          </p>
        </div>
      )}

      {webhooks.map((webhook) =>
        editando === webhook.id ? (
          <Formulario
            key={webhook.id}
            inicial={webhook}
            pendente={pendente}
            aoCancelar={() => setEditando(null)}
            aoSalvar={(valores) =>
              executar(
                () => salvarWebhook({ id: webhook.id, ...valores }),
                () => setEditando(null),
              )
            }
          />
        ) : (
          <Linha
            key={webhook.id}
            webhook={webhook}
            podeGerenciar={podeGerenciar}
            pendente={pendente}
            aoEditar={() => setEditando(webhook.id)}
            aoExcluir={() => executar(() => excluirWebhook({ id: webhook.id }))}
          />
        ),
      )}

      {criando ? (
        <Formulario
          pendente={pendente}
          aoCancelar={() => setCriando(false)}
          aoSalvar={(valores) =>
            executar(
              () => criarWebhook({ nome: valores.nome, url: valores.url, segredo: valores.segredo }),
              () => setCriando(false),
            )
          }
        />
      ) : (
        podeGerenciar && (
          <button type="button" onClick={() => setCriando(true)} className={BOTAO_PRIMARIO}>
            Novo webhook
          </button>
        )
      )}
    </div>
  );
}

function Linha({
  webhook,
  podeGerenciar,
  pendente,
  aoEditar,
  aoExcluir,
}: {
  webhook: WebhookResumo;
  podeGerenciar: boolean;
  pendente: boolean;
  aoEditar: () => void;
  aoExcluir: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);

  return (
    <div className={CARTAO}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className={TITULO_SECAO}>{webhook.nome}</h2>
            {webhook.ativo ? (
              <span className={SELO_NEUTRO}>Ativo</span>
            ) : (
              <span className={SELO_ALERTA}>Desativado</span>
            )}
            {webhook.na_fila > 0 && (
              <span className={SELO_NEUTRO}>{webhook.na_fila} na fila</span>
            )}
            {webhook.desistiu > 0 && (
              <span className={SELO_PERIGO}>{webhook.desistiu} sem entregar</span>
            )}
          </div>

          <p className={`mt-1 truncate font-mono ${TEXTO_3}`}>{webhook.url}</p>
          <p className={`mt-1 ${TEXTO_3}`}>
            Até {webhook.max_tentativas} tentativas · limite de {webhook.timeout_ms} ms por chamada
          </p>
        </div>

        {podeGerenciar && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={aoEditar} disabled={pendente} className={BOTAO_MENOR}>
              Editar
            </button>
            {confirmando ? (
              <>
                <button
                  type="button"
                  onClick={aoExcluir}
                  disabled={pendente}
                  className={BOTAO_PERIGO}
                >
                  Confirmar exclusão
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmando(false)}
                  className={BOTAO_MENOR}
                >
                  Cancelar
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmando(true)}
                disabled={pendente}
                className={BOTAO_PERIGO}
              >
                Excluir
              </button>
            )}
          </div>
        )}
      </div>

      {confirmando && webhook.na_fila > 0 && (
        <p className="mt-3 rounded-padrao border border-alerta-linha bg-alerta-suave px-3.5 py-2.5 text-sm text-alerta">
          Há {webhook.na_fila} {webhook.na_fila === 1 ? 'entrega' : 'entregas'} esperando neste
          destino. Excluir o webhook joga {webhook.na_fila === 1 ? 'ela' : 'elas'} fora — quem
          estava esperando a mensagem não vai recebê-la.
        </p>
      )}
    </div>
  );
}

type Valores = { nome: string; url: string; ativo: boolean; segredo: string };

function Formulario({
  inicial,
  pendente,
  aoSalvar,
  aoCancelar,
}: {
  inicial?: WebhookResumo;
  pendente: boolean;
  aoSalvar: (valores: Valores) => void;
  aoCancelar: () => void;
}) {
  const [nome, setNome] = useState(inicial?.nome ?? '');
  const [url, setUrl] = useState(inicial?.url ?? '');
  const [ativo, setAtivo] = useState(inicial?.ativo ?? true);
  const [segredo, setSegredo] = useState('');

  return (
    <form
      className={CARTAO}
      onSubmit={(evento) => {
        evento.preventDefault();
        aoSalvar({ nome, url, ativo, segredo });
      }}
    >
      <h2 className={TITULO_SECAO}>{inicial ? 'Editar webhook' : 'Novo webhook'}</h2>

      <div className="mt-4 space-y-4">
        <label className="block">
          <span className={ROTULO}>Nome</span>
          <input
            value={nome}
            onChange={(evento) => setNome(evento.target.value)}
            maxLength={80}
            required
            placeholder="n8n — atendimento"
            className={CAMPO}
          />
        </label>

        <label className="block">
          <span className={ROTULO}>Endereço (https)</span>
          <input
            value={url}
            onChange={(evento) => setUrl(evento.target.value)}
            type="url"
            required
            placeholder="https://n8n.suaempresa.com.br/webhook/atendimento"
            className={`${CAMPO} font-mono`}
          />
          <span className={`mt-1 block ${TEXTO_3}`}>
            Só https, e nunca endereço interno (localhost, rede privada, metadados da nuvem). O
            banco recusa os demais — é ele que faz a chamada.
          </span>
        </label>

        <label className="block">
          <span className={ROTULO}>Segredo da assinatura</span>
          <input
            value={segredo}
            onChange={(evento) => setSegredo(evento.target.value)}
            type="password"
            minLength={16}
            autoComplete="new-password"
            placeholder={inicial ? 'Deixe em branco para manter o atual' : 'Em branco = o banco sorteia um'}
            className={`${CAMPO} font-mono`}
          />
          <span className={`mt-1 block ${TEXTO_3}`}>
            Cada entrega vai assinada em <code>X-ByTech3-Assinatura</code> com HMAC-SHA256 deste
            segredo. Configure a mesma conferência no n8n — sem ela, quem descobrir a URL pode
            disparar mensagens em nome da sua empresa.
          </span>
        </label>

        {inicial && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={ativo}
              onChange={(evento) => setAtivo(evento.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm">Ativo</span>
          </label>
        )}
      </div>

      <p className={`mt-4 ${INFO}`}>
        <span className="font-medium">O segredo não é lido de volta.</span> Nem por esta tela, nem
        pela API: a coluna não tem permissão de leitura. Guarde-o onde você configura o n8n. Para
        trocá-lo, escreva um novo aqui.
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <button type="submit" disabled={pendente} className={BOTAO_PRIMARIO}>
          {pendente ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" onClick={aoCancelar} className={BOTAO_SECUNDARIO}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

/** Cabeçalho explicativo, reaproveitado pela página. */
export function ExplicacaoWebhooks() {
  return (
    <div className={CARTAO_INTERNO}>
      <p className={ROTULO_MINI}>Como funciona</p>
      <p className={`mt-2 ${TEXTO_2}`}>
        O banco chama o endereço configurado, assinado, e guarda cada tentativa. Se o destino cair,
        ele insiste com intervalos crescentes (1, 2, 4, 8 e 16 minutos) e depois desiste — sempre
        deixando registrado o motivo, na aba de entregas.
      </p>
    </div>
  );
}
