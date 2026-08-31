'use client';

/**
 * "O que este fluxo faria com o Fulano?"
 *
 * POR QUE ELE EXISTE:
 *   Automação erra em silêncio e erra na frente do cliente. Um `{{nome}}` que
 *   vira vazio, um atraso em minutos que alguém digitou pensando em horas, um
 *   passo apontando para a etapa errada — nada disso aparece na configuração;
 *   aparece na mensagem que o cliente recebeu. Aqui aparece antes.
 *
 * O QUE ELE NÃO FAZ: nada. Não agenda, não entrega, não registra activity. A
 * função do banco é `stable` e só monta a lista.
 */
import { useState, useTransition } from 'react';
import { simularFluxoAction } from '@/lib/crm/acoes-fluxos';
import { ROTULO_ACAO, type PassoSimulado } from '@/lib/crm/fluxos-tipos';
import { formatarDataHora } from '@/lib/crm/formato';
import {
  BOTAO_SECUNDARIO,
  CAMPO,
  CARTAO,
  ERRO,
  INFO,
  ROTULO,
  SELO_NEUTRO,
  TEXTO_2,
  TEXTO_3,
  TITULO_SECAO,
} from '@/components/ui';

type Props = {
  fluxoId: string;
  /** Leads da carteira de quem está olhando — a RLS já filtrou. */
  leads: { id: string; nome: string }[];
};

export function SimuladorDeFluxo({ fluxoId, leads }: Props) {
  const [leadId, setLeadId] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [passos, setPassos] = useState<PassoSimulado[] | null>(null);
  const [pendente, iniciar] = useTransition();

  function simular() {
    setErro(null);
    iniciar(async () => {
      const resultado = await simularFluxoAction({ fluxo_id: fluxoId, lead_id: leadId });
      if (resultado.erro) {
        setErro(resultado.erro);
        setPassos(null);
        return;
      }
      setPassos(resultado.passos);
    });
  }

  return (
    <section className={CARTAO}>
      <h2 className={TITULO_SECAO}>Simular antes de ativar</h2>
      <p className={`mt-1 ${TEXTO_2}`}>
        Escolha um lead da sua carteira e veja os passos com o texto já preenchido. Nada é enviado,
        agendado ou registrado.
      </p>

      {leads.length === 0 ? (
        <p className={`mt-4 ${INFO}`}>
          Você ainda não tem nenhum lead para simular. Cadastre um e volte aqui.
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="min-w-56 flex-1">
            <span className={ROTULO}>Lead</span>
            <select
              value={leadId}
              onChange={(evento) => setLeadId(evento.target.value)}
              className={CAMPO}
            >
              <option value="">Escolha um lead…</option>
              {leads.map((lead) => (
                <option key={lead.id} value={lead.id}>
                  {lead.nome}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={simular}
            disabled={pendente || !leadId}
            className={BOTAO_SECUNDARIO}
          >
            {pendente ? 'Simulando…' : 'Simular'}
          </button>
        </div>
      )}

      {erro && <p className={`mt-4 ${ERRO}`}>{erro}</p>}

      {passos && passos.length === 0 && (
        <p className={`mt-4 ${INFO}`}>
          Este fluxo não tem nenhum passo — não faria nada com ninguém.
        </p>
      )}

      {passos && passos.length > 0 && (
        <ol className="mt-4 space-y-3">
          {passos.map((passo) => (
            <li key={passo.ordem} className="rounded-padrao border border-linha p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={SELO_NEUTRO}>{passo.ordem + 1}</span>
                <span className="text-sm font-medium">{ROTULO_ACAO[passo.tipo]}</span>
                <span className={TEXTO_3}>{formatarDataHora(passo.quando)}</span>
              </div>

              <p className={`mt-2 ${TEXTO_2}`}>{passo.resumo}</p>

              {passo.destino && (
                <p className={`mt-1 ${TEXTO_3}`}>Destino: {passo.destino}</p>
              )}

              {passo.texto !== null && (
                <p className="mt-3 whitespace-pre-wrap rounded-padrao bg-superficie-2 px-3 py-2 text-sm">
                  {passo.texto}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}

      {passos && passos.some((passo) => passo.tipo === 'mensagem' && !passo.destino) && (
        <p className={`mt-4 ${ERRO}`}>
          Um dos passos de mensagem está sem webhook de destino. Ele falharia na execução.
        </p>
      )}
    </section>
  );
}
