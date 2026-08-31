'use client';

/**
 * O que a automação tentou entregar, e o que aconteceu com cada tentativa.
 *
 * ESTA TELA É O ANTÍDOTO PARA O PIOR DEFEITO POSSÍVEL num produto de
 * atendimento: "o cliente não recebeu e ninguém sabe por quê". Cada linha traz
 * a situação, quantas tentativas houve, o código HTTP que voltou e o erro.
 *
 * O CORPO DA MENSAGEM NÃO APARECE AQUI, e não é a tela escondendo — a consulta
 * não pede a coluna `payload`. Ele existe no banco porque a retentativa precisa
 * do mesmo corpo, mas colocá-lo numa listagem que o gestor deixa aberta o dia
 * inteiro espalharia o texto de toda conversa automática pela tela.
 */
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { reenviarEntrega } from '@/lib/crm/acoes-fluxos';
import type { EntregaResumo, SituacaoEntrega } from '@/lib/crm/fluxos-tipos';
import { formatarDataHora } from '@/lib/crm/formato';
import {
  BOTAO_MENOR,
  CARTAO,
  ERRO,
  LINK,
  SELO_ACAO,
  SELO_ALERTA,
  SELO_NEUTRO,
  SELO_PERIGO,
  TABELA,
  TABELA_CABECALHO,
  TABELA_CAIXA,
  TABELA_LINHA,
  TABELA_TD,
  TABELA_TH,
  TEXTO_2,
  TEXTO_3,
  TITULO_SECAO,
} from '@/components/ui';

const ROTULO_SITUACAO: Record<SituacaoEntrega, string> = {
  pendente: 'Na fila',
  enviando: 'Enviando',
  entregue: 'Entregue',
  falhou: 'Vai tentar de novo',
  desistiu: 'Não entregue',
};

const SELO_SITUACAO: Record<SituacaoEntrega, string> = {
  pendente: SELO_NEUTRO,
  enviando: SELO_NEUTRO,
  entregue: SELO_ACAO,
  falhou: SELO_ALERTA,
  desistiu: SELO_PERIGO,
};

export function RegistroDeEntregas({
  entregas,
  podeGerenciar,
}: {
  entregas: EntregaResumo[];
  podeGerenciar: boolean;
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function reenviar(id: string) {
    setErro(null);
    iniciar(async () => {
      const resultado = await reenviarEntrega({ id });
      if (resultado.erro) setErro(resultado.erro);
      else router.refresh();
    });
  }

  if (entregas.length === 0) {
    return (
      <div className={CARTAO}>
        <h2 className={TITULO_SECAO}>Nenhuma entrega ainda</h2>
        <p className={`mt-2 ${TEXTO_2}`}>
          Assim que um fluxo ativo disparar, cada chamada de webhook aparece aqui — com o que
          voltou do destino.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {erro && <p className={ERRO}>{erro}</p>}

      <div className={TABELA_CAIXA}>
        <table className={TABELA}>
          <thead className={TABELA_CABECALHO}>
            <tr>
              <th className={TABELA_TH}>Quando</th>
              <th className={TABELA_TH}>Destino</th>
              <th className={TABELA_TH}>Lead</th>
              <th className={TABELA_TH}>Situação</th>
              <th className={TABELA_TH}>Resposta</th>
              <th className={TABELA_TH}>
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {entregas.map((entrega) => (
              <tr key={entrega.id} className={TABELA_LINHA}>
                <td className={`${TABELA_TD} whitespace-nowrap`}>
                  {formatarDataHora(entrega.criado_em)}
                  <span className={`mt-0.5 block ${TEXTO_3}`}>{entrega.evento}</span>
                </td>

                <td className={TABELA_TD}>{entrega.webhook_nome ?? '—'}</td>

                <td className={TABELA_TD}>
                  {entrega.lead_id && entrega.lead_nome ? (
                    <Link href={`/crm/${entrega.lead_id}`} className={LINK}>
                      {entrega.lead_nome}
                    </Link>
                  ) : (
                    <span className="text-texto-3">—</span>
                  )}
                </td>

                <td className={TABELA_TD}>
                  <span className={SELO_SITUACAO[entrega.situacao]}>
                    {ROTULO_SITUACAO[entrega.situacao]}
                  </span>
                  {entrega.tentativas > 1 && (
                    <span className={`mt-0.5 block ${TEXTO_3}`}>
                      {entrega.tentativas} tentativas
                    </span>
                  )}
                </td>

                <td className={`${TABELA_TD} max-w-72`}>
                  {entrega.ultimo_status && (
                    <span className="font-mono text-xs">HTTP {entrega.ultimo_status}</span>
                  )}
                  {entrega.ultimo_erro && (
                    <span className={`block break-words ${TEXTO_3}`}>{entrega.ultimo_erro}</span>
                  )}
                  {!entrega.ultimo_status && !entrega.ultimo_erro && (
                    <span className="text-texto-3">—</span>
                  )}
                </td>

                <td className={`${TABELA_TD} whitespace-nowrap`}>
                  {podeGerenciar &&
                    (entrega.situacao === 'falhou' || entrega.situacao === 'desistiu') && (
                      <button
                        type="button"
                        onClick={() => reenviar(entrega.id)}
                        disabled={pendente}
                        className={BOTAO_MENOR}
                      >
                        Tentar de novo
                      </button>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={TEXTO_3}>
        As entregas concluídas são apagadas depois de 30 dias. “Tentar de novo” zera a contagem e
        devolve a entrega à fila — só vale para o que falhou; o que já foi entregue não é reenviado,
        senão o cliente receberia a mesma mensagem duas vezes.
      </p>
    </div>
  );
}
