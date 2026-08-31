'use client';

/**
 * O construtor: quando o fluxo começa, e o que ele faz.
 *
 * DUAS DECISÕES DE INTERFACE QUE VÊM DA NATUREZA DO PRODUTO:
 *
 * 1. O botão de ATIVAR fica embaixo, depois de tudo, e não no cabeçalho. Um
 *    fluxo ligado manda mensagem para cliente de verdade — não é um botão
 *    para se esbarrar enquanto se edita um texto.
 *
 * 2. A ação "enviar mensagem" pede um WEBHOOK, e a tela diz por quê em vez de
 *    apenas oferecer o campo. Quem monta o fluxo precisa entender que a
 *    mensagem sai pelo n8n / API oficial, e não pelo WhatsApp Web do vendedor:
 *    automatizar envio pelo WhatsApp Web queima o número do cliente.
 *
 * Nada aqui decide permissão. `podeGerenciar` só esconde controle que não
 * funcionaria; quem recusa a gravação é a RLS.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  excluirAcao,
  excluirGatilho,
  moverAcao,
  salvarAcao,
  salvarFluxo,
  salvarGatilho,
} from '@/lib/crm/acoes-fluxos';
import {
  EVENTOS,
  ROTULO_ACAO,
  ROTULO_EVENTO,
  VARIAVEIS_DO_MODELO,
  type AcaoFluxo,
  type EventoGatilho,
  type FluxoCompleto,
  type GatilhoFluxo,
  type OpcoesDoConstrutor,
  type TipoAcao,
} from '@/lib/crm/fluxos-tipos';
import { ORIGENS_LEAD } from '@/lib/crm/tipos';
import type { EstadoAcao } from '@/lib/crm/tipos';
import {
  AVISO,
  BOTAO_MENOR,
  BOTAO_PERIGO,
  BOTAO_PRIMARIO,
  BOTAO_SECUNDARIO,
  CAMPO,
  CAMPO_MENOR,
  CARTAO,
  ERRO,
  INFO,
  ROTULO,
  ROTULO_MINI,
  SELO_ACAO,
  SELO_ALERTA,
  SELO_NEUTRO,
  TEXTO_2,
  TEXTO_3,
  TITULO_SECAO,
} from '@/components/ui';

type Props = {
  dados: FluxoCompleto;
  opcoes: OpcoesDoConstrutor;
  podeGerenciar: boolean;
  acessoAtivo: boolean;
};

/** "90" -> "1 h 30 min". Minuto cru vira aritmética mental na cabeça de quem lê. */
export function textoDoAtraso(minutos: number): string {
  if (minutos <= 0) return 'na hora';
  if (minutos < 60) return `${minutos} min depois`;

  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas < 24) return resto ? `${horas} h ${resto} min depois` : `${horas} h depois`;

  const dias = Math.floor(horas / 24);
  const sobra = horas % 24;
  return sobra ? `${dias} d ${sobra} h depois` : `${dias} ${dias === 1 ? 'dia' : 'dias'} depois`;
}

export function ConstrutorDeFluxo({ dados, opcoes, podeGerenciar, acessoAtivo }: Props) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const [gatilhoAberto, setGatilhoAberto] = useState<string | 'novo' | null>(null);
  const [acaoAberta, setAcaoAberta] = useState<string | 'nova' | null>(null);

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

  const semWebhook = opcoes.webhooks.length === 0;

  return (
    <div className="space-y-6">
      {erro && <p className={ERRO}>{erro}</p>}

      {/* ------------------------------------------------------- GATILHOS */}
      <section className={CARTAO}>
        <h2 className={TITULO_SECAO}>Quando este fluxo começa</h2>
        <p className={`mt-1 ${TEXTO_2}`}>
          Cada gatilho é um começo possível. Os filtros dentro de um gatilho se somam: “mudou de
          etapa” <em>e</em> “origem Instagram” só dispara quando as duas coisas valem.
        </p>

        <ul className="mt-4 space-y-2">
          {dados.gatilhos.map((gatilho) =>
            gatilhoAberto === gatilho.id ? (
              <li key={gatilho.id}>
                <FormGatilho
                  inicial={gatilho}
                  opcoes={opcoes}
                  pendente={pendente}
                  aoCancelar={() => setGatilhoAberto(null)}
                  aoSalvar={(valores) =>
                    executar(
                      () => salvarGatilho({ id: gatilho.id, fluxo_id: dados.fluxo.id, ...valores }),
                      () => setGatilhoAberto(null),
                    )
                  }
                />
              </li>
            ) : (
              <li
                key={gatilho.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-padrao border border-linha px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{ROTULO_EVENTO[gatilho.evento]}</p>
                  <p className={`mt-0.5 ${TEXTO_3}`}>{descreverFiltros(gatilho, opcoes)}</p>
                </div>

                {podeGerenciar && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setGatilhoAberto(gatilho.id)}
                      disabled={pendente}
                      className={BOTAO_MENOR}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        executar(() =>
                          excluirGatilho({ id: gatilho.id, fluxo_id: dados.fluxo.id }),
                        )
                      }
                      disabled={pendente}
                      className={BOTAO_PERIGO}
                    >
                      Remover
                    </button>
                  </div>
                )}
              </li>
            ),
          )}
        </ul>

        {dados.gatilhos.length === 0 && gatilhoAberto !== 'novo' && (
          <p className={`mt-4 ${AVISO}`}>
            Sem gatilho, nada faz este fluxo começar — ele nunca vai rodar.
          </p>
        )}

        {gatilhoAberto === 'novo' ? (
          <div className="mt-4">
            <FormGatilho
              opcoes={opcoes}
              pendente={pendente}
              aoCancelar={() => setGatilhoAberto(null)}
              aoSalvar={(valores) =>
                executar(
                  () => salvarGatilho({ fluxo_id: dados.fluxo.id, ...valores }),
                  () => setGatilhoAberto(null),
                )
              }
            />
          </div>
        ) : (
          podeGerenciar && (
            <button
              type="button"
              onClick={() => setGatilhoAberto('novo')}
              disabled={pendente}
              className={`mt-4 ${BOTAO_SECUNDARIO}`}
            >
              Adicionar gatilho
            </button>
          )
        )}
      </section>

      {/* ---------------------------------------------------------- AÇÕES */}
      <section className={CARTAO}>
        <h2 className={TITULO_SECAO}>O que ele faz</h2>
        <p className={`mt-1 ${TEXTO_2}`}>
          Os passos rodam na ordem. A espera de cada um é contada a partir do gatilho, não do passo
          anterior — assim mudar o passo 2 não desloca o passo 3.
        </p>

        {semWebhook && (
          <p className={`mt-4 ${AVISO}`}>
            Nenhum webhook cadastrado. As ações de mensagem e de chamada precisam de um destino —
            cadastre um em Configurações › Webhooks antes.
          </p>
        )}

        <ol className="mt-4 space-y-2">
          {dados.acoes.map((acao, indice) =>
            acaoAberta === acao.id ? (
              <li key={acao.id}>
                <FormAcao
                  inicial={acao}
                  opcoes={opcoes}
                  pendente={pendente}
                  aoCancelar={() => setAcaoAberta(null)}
                  aoSalvar={(valores) =>
                    executar(
                      () => salvarAcao({ id: acao.id, fluxo_id: dados.fluxo.id, ...valores }),
                      () => setAcaoAberta(null),
                    )
                  }
                />
              </li>
            ) : (
              <li
                key={acao.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-padrao border border-linha px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={SELO_NEUTRO}>{indice + 1}</span>
                    <p className="text-sm font-medium">{ROTULO_ACAO[acao.tipo]}</p>
                    <span className={TEXTO_3}>{textoDoAtraso(acao.atraso_minutos)}</span>
                  </div>
                  <p className={`mt-1 break-words ${TEXTO_3}`}>{descreverAcao(acao, opcoes)}</p>
                </div>

                {podeGerenciar && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        executar(() =>
                          moverAcao({ fluxo_id: dados.fluxo.id, id: acao.id, direcao: 'cima' }),
                        )
                      }
                      disabled={pendente || indice === 0}
                      aria-label="Subir este passo"
                      className={BOTAO_MENOR}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        executar(() =>
                          moverAcao({ fluxo_id: dados.fluxo.id, id: acao.id, direcao: 'baixo' }),
                        )
                      }
                      disabled={pendente || indice === dados.acoes.length - 1}
                      aria-label="Descer este passo"
                      className={BOTAO_MENOR}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => setAcaoAberta(acao.id)}
                      disabled={pendente}
                      className={BOTAO_MENOR}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        executar(() => excluirAcao({ id: acao.id, fluxo_id: dados.fluxo.id }))
                      }
                      disabled={pendente}
                      className={BOTAO_PERIGO}
                    >
                      Remover
                    </button>
                  </div>
                )}
              </li>
            ),
          )}
        </ol>

        {acaoAberta === 'nova' ? (
          <div className="mt-4">
            <FormAcao
              opcoes={opcoes}
              pendente={pendente}
              aoCancelar={() => setAcaoAberta(null)}
              aoSalvar={(valores) =>
                executar(
                  () => salvarAcao({ fluxo_id: dados.fluxo.id, ...valores }),
                  () => setAcaoAberta(null),
                )
              }
            />
          </div>
        ) : (
          podeGerenciar && (
            <button
              type="button"
              onClick={() => setAcaoAberta('nova')}
              disabled={pendente}
              className={`mt-4 ${BOTAO_SECUNDARIO}`}
            >
              Adicionar passo
            </button>
          )
        )}
      </section>

      {/* -------------------------------------------------------- ATIVAR */}
      {podeGerenciar && (
        <PainelDeAtivacao
          dados={dados}
          pendente={pendente}
          acessoAtivo={acessoAtivo}
          aoSalvar={(valores) => executar(() => salvarFluxo({ id: dados.fluxo.id, ...valores }))}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------- ATIVAÇÃO

function PainelDeAtivacao({
  dados,
  pendente,
  acessoAtivo,
  aoSalvar,
}: {
  dados: FluxoCompleto;
  pendente: boolean;
  acessoAtivo: boolean;
  aoSalvar: (valores: {
    nome: string;
    descricao: string;
    ativo: boolean;
    repetir: boolean;
  }) => void;
}) {
  const [nome, setNome] = useState(dados.fluxo.nome);
  const [descricao, setDescricao] = useState(dados.fluxo.descricao ?? '');
  const [repetir, setRepetir] = useState(dados.fluxo.repetir);
  const { ativo } = dados.fluxo;

  const completo = dados.gatilhos.length > 0 && dados.acoes.length > 0;

  return (
    <section className={CARTAO}>
      <h2 className={TITULO_SECAO}>Ajustes e ativação</h2>

      <div className="mt-4 space-y-4">
        <label className="block">
          <span className={ROTULO}>Nome</span>
          <input
            value={nome}
            onChange={(evento) => setNome(evento.target.value)}
            maxLength={80}
            className={CAMPO}
          />
        </label>

        <label className="block">
          <span className={ROTULO}>Descrição</span>
          <textarea
            value={descricao}
            onChange={(evento) => setDescricao(evento.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Para que serve, e o que quem vier depois precisa saber."
            className={CAMPO}
          />
        </label>

        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={repetir}
            onChange={(evento) => setRepetir(evento.target.checked)}
            className="mt-1 h-4 w-4"
          />
          <span className="text-sm">
            Pode rodar mais de uma vez para o mesmo lead
            <span className={`mt-0.5 block ${TEXTO_3}`}>
              Deixe desmarcado para boas-vindas e afins. Marcado, um lead que volta a disparar o
              gatilho passa pelo fluxo de novo — e recebe a mensagem de novo.
            </span>
          </span>
        </label>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => aoSalvar({ nome, descricao, ativo, repetir })}
          disabled={pendente}
          className={BOTAO_SECUNDARIO}
        >
          {pendente ? 'Salvando…' : 'Salvar ajustes'}
        </button>

        {ativo ? (
          <button
            type="button"
            onClick={() => aoSalvar({ nome, descricao, ativo: false, repetir })}
            disabled={pendente}
            className={BOTAO_PERIGO}
          >
            Desativar o fluxo
          </button>
        ) : (
          <button
            type="button"
            onClick={() => aoSalvar({ nome, descricao, ativo: true, repetir })}
            disabled={pendente || !completo}
            className={BOTAO_PRIMARIO}
          >
            Ativar o fluxo
          </button>
        )}

        <span className={ativo ? SELO_ACAO : SELO_ALERTA}>
          {ativo ? 'Ativo agora' : 'Desativado'}
        </span>
      </div>

      {!ativo && !completo && (
        <p className={`mt-4 ${INFO}`}>
          Falta {dados.gatilhos.length === 0 ? 'um gatilho' : 'pelo menos um passo'} para este fluxo
          poder ser ativado.
        </p>
      )}

      {!ativo && completo && (
        <p className={`mt-4 ${AVISO}`}>
          Ao ativar, este fluxo passa a rodar para <span className="font-semibold">leads reais</span>{' '}
          a partir do próximo gatilho. Use o simulador acima com um lead seu antes.
        </p>
      )}

      {!acessoAtivo && (
        <p className={`mt-4 ${AVISO}`}>
          O período de teste desta organização terminou. O banco recusa alterações — e a automação
          não dispara enquanto a licença não for reativada.
        </p>
      )}
    </section>
  );
}

// --------------------------------------------------------------- GATILHO

type ValoresGatilho = {
  evento: EventoGatilho;
  pipeline_id: string;
  stage_id: string;
  tag_id: string;
  origem: string;
};

function FormGatilho({
  inicial,
  opcoes,
  pendente,
  aoSalvar,
  aoCancelar,
}: {
  inicial?: GatilhoFluxo;
  opcoes: OpcoesDoConstrutor;
  pendente: boolean;
  aoSalvar: (valores: ValoresGatilho) => void;
  aoCancelar: () => void;
}) {
  const [evento, setEvento] = useState<EventoGatilho>(inicial?.evento ?? 'lead.created');
  const [pipelineId, setPipelineId] = useState(inicial?.pipeline_id ?? '');
  const [stageId, setStageId] = useState(inicial?.stage_id ?? '');
  const [tagId, setTagId] = useState(inicial?.tag_id ?? '');
  const [origem, setOrigem] = useState(inicial?.origem ?? '');

  // Filtrar por etapa só faz sentido nos eventos que carregam uma etapa.
  const usaEtapa = evento === 'lead.stage_changed' || evento === 'lead.pipeline_added';
  const usaTag = evento === 'tag.added' || evento === 'tag.removed';

  return (
    <form
      className="space-y-4 rounded-padrao border border-linha-forte p-4"
      onSubmit={(e) => {
        e.preventDefault();
        aoSalvar({
          evento,
          pipeline_id: usaEtapa ? pipelineId : '',
          stage_id: usaEtapa ? stageId : '',
          tag_id: usaTag ? tagId : '',
          origem,
        });
      }}
    >
      <label className="block">
        <span className={ROTULO}>O que dispara</span>
        <select
          value={evento}
          onChange={(e) => setEvento(e.target.value as EventoGatilho)}
          className={CAMPO}
        >
          {EVENTOS.map((item) => (
            <option key={item} value={item}>
              {ROTULO_EVENTO[item]}
            </option>
          ))}
        </select>
      </label>

      <p className={ROTULO_MINI}>Filtros (opcionais)</p>

      <div className="grid gap-3 sm:grid-cols-2">
        {usaEtapa && (
          <>
            <label className="block">
              <span className={ROTULO}>Funil</span>
              <select
                value={pipelineId}
                onChange={(e) => {
                  setPipelineId(e.target.value);
                  setStageId('');
                }}
                className={CAMPO_MENOR}
              >
                <option value="">Qualquer funil</option>
                {opcoes.funis.map((funil) => (
                  <option key={funil.id} value={funil.id}>
                    {funil.nome}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={ROTULO}>Etapa</span>
              <select
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                className={CAMPO_MENOR}
              >
                <option value="">Qualquer etapa</option>
                {opcoes.etapas
                  .filter((etapa) => !pipelineId || etapa.pipeline_id === pipelineId)
                  .map((etapa) => (
                    <option key={etapa.id} value={etapa.id}>
                      {etapa.nome}
                    </option>
                  ))}
              </select>
            </label>
          </>
        )}

        {usaTag && (
          <label className="block">
            <span className={ROTULO}>Etiqueta</span>
            <select value={tagId} onChange={(e) => setTagId(e.target.value)} className={CAMPO_MENOR}>
              <option value="">Qualquer etiqueta</option>
              {opcoes.tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.nome}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className={ROTULO}>Origem do lead</span>
          <select value={origem} onChange={(e) => setOrigem(e.target.value)} className={CAMPO_MENOR}>
            <option value="">Qualquer origem</option>
            {ORIGENS_LEAD.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pendente} className={BOTAO_PRIMARIO}>
          Salvar gatilho
        </button>
        <button type="button" onClick={aoCancelar} className={BOTAO_SECUNDARIO}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ AÇÃO

type ValoresAcao = {
  tipo: TipoAcao;
  atraso_minutos: number;
  webhook_id: string;
  modelo: string;
  tag_id: string;
  pipeline_id: string;
  stage_id: string;
};

function FormAcao({
  inicial,
  opcoes,
  pendente,
  aoSalvar,
  aoCancelar,
}: {
  inicial?: AcaoFluxo;
  opcoes: OpcoesDoConstrutor;
  pendente: boolean;
  aoSalvar: (valores: ValoresAcao) => void;
  aoCancelar: () => void;
}) {
  const config = (inicial?.config ?? {}) as Record<string, string>;

  const [tipo, setTipo] = useState<TipoAcao>(inicial?.tipo ?? 'mensagem');
  const [atraso, setAtraso] = useState(String(inicial?.atraso_minutos ?? 0));
  const [webhookId, setWebhookId] = useState(config.webhook_id ?? '');
  const [modelo, setModelo] = useState(config.modelo ?? '');
  const [tagId, setTagId] = useState(config.tag_id ?? '');
  const [pipelineId, setPipelineId] = useState(config.pipeline_id ?? '');
  const [stageId, setStageId] = useState(config.stage_id ?? '');

  const minutos = Number(atraso);

  return (
    <form
      className="space-y-4 rounded-padrao border border-linha-forte p-4"
      onSubmit={(e) => {
        e.preventDefault();
        aoSalvar({
          tipo,
          atraso_minutos: Number.isFinite(minutos) ? minutos : 0,
          webhook_id: webhookId,
          modelo,
          tag_id: tagId,
          pipeline_id: pipelineId,
          stage_id: stageId,
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={ROTULO}>O que fazer</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoAcao)} className={CAMPO}>
            {(Object.keys(ROTULO_ACAO) as TipoAcao[]).map((item) => (
              <option key={item} value={item}>
                {ROTULO_ACAO[item]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={ROTULO}>Esperar (minutos após o gatilho)</span>
          <input
            value={atraso}
            onChange={(e) => setAtraso(e.target.value)}
            type="number"
            min={0}
            max={43200}
            className={CAMPO}
          />
          <span className={`mt-1 block ${TEXTO_3}`}>
            {textoDoAtraso(Number.isFinite(minutos) ? minutos : 0)} · máximo 30 dias
          </span>
        </label>
      </div>

      {(tipo === 'mensagem' || tipo === 'webhook') && (
        <label className="block">
          <span className={ROTULO}>Destino</span>
          <select
            value={webhookId}
            onChange={(e) => setWebhookId(e.target.value)}
            required
            className={CAMPO}
          >
            <option value="">Escolha o webhook…</option>
            {opcoes.webhooks.map((hook) => (
              <option key={hook.id} value={hook.id}>
                {hook.nome}
                {hook.ativo ? '' : ' (desativado)'}
              </option>
            ))}
          </select>
        </label>
      )}

      {tipo === 'mensagem' && (
        <>
          <label className="block">
            <span className={ROTULO}>Texto da mensagem</span>
            <textarea
              value={modelo}
              onChange={(e) => setModelo(e.target.value)}
              rows={4}
              maxLength={2000}
              required
              placeholder="Olá {{primeiro_nome}}! Recebi seu contato e já estou vendo o seu caso."
              className={CAMPO}
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <span className={ROTULO_MINI}>Variáveis</span>
            {VARIAVEIS_DO_MODELO.map((variavel) => (
              <button
                key={variavel}
                type="button"
                onClick={() => setModelo((atual) => `${atual}${variavel}`)}
                className="rounded-full bg-superficie-2 px-2 py-0.5 font-mono text-xs text-texto-2 transition hover:bg-linha"
              >
                {variavel}
              </button>
            ))}
          </div>

          <p className={INFO}>
            <span className="font-medium">Esta mensagem sai pelo webhook</span> — para o seu n8n ou
            para a API oficial do WhatsApp —, nunca pela extensão. Disparo automático pelo WhatsApp
            Web é o caminho mais curto para o número da empresa ser banido, e o envio manual do
            vendedor continua funcionando normalmente na ficha do lead.
          </p>
        </>
      )}

      {tipo === 'etiqueta' && (
        <label className="block">
          <span className={ROTULO}>Etiqueta a aplicar</span>
          <select value={tagId} onChange={(e) => setTagId(e.target.value)} required className={CAMPO}>
            <option value="">Escolha a etiqueta…</option>
            {opcoes.tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.nome}
              </option>
            ))}
          </select>
        </label>
      )}

      {tipo === 'mover_etapa' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={ROTULO}>Funil</span>
            <select
              value={pipelineId}
              onChange={(e) => {
                setPipelineId(e.target.value);
                setStageId('');
              }}
              required
              className={CAMPO}
            >
              <option value="">Escolha o funil…</option>
              {opcoes.funis.map((funil) => (
                <option key={funil.id} value={funil.id}>
                  {funil.nome}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className={ROTULO}>Etapa de destino</span>
            <select
              value={stageId}
              onChange={(e) => setStageId(e.target.value)}
              required
              className={CAMPO}
            >
              <option value="">Escolha a etapa…</option>
              {opcoes.etapas
                .filter((etapa) => etapa.pipeline_id === pipelineId)
                .map((etapa) => (
                  <option key={etapa.id} value={etapa.id}>
                    {etapa.nome}
                  </option>
                ))}
            </select>
          </label>

          <p className={`sm:col-span-2 ${INFO}`}>
            Move quem já está neste funil. Um lead que não esteja nele não é colocado lá pela
            automação — mover é mover, não é matricular.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pendente} className={BOTAO_PRIMARIO}>
          Salvar passo
        </button>
        <button type="button" onClick={aoCancelar} className={BOTAO_SECUNDARIO}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------- DESCRIÇÕES

function descreverFiltros(gatilho: GatilhoFluxo, opcoes: OpcoesDoConstrutor): string {
  const partes: string[] = [];

  if (gatilho.pipeline_id) {
    partes.push(
      `funil ${opcoes.funis.find((f) => f.id === gatilho.pipeline_id)?.nome ?? '?'}`,
    );
  }
  if (gatilho.stage_id) {
    partes.push(`etapa ${opcoes.etapas.find((e) => e.id === gatilho.stage_id)?.nome ?? '?'}`);
  }
  if (gatilho.tag_id) {
    partes.push(`etiqueta ${opcoes.tags.find((t) => t.id === gatilho.tag_id)?.nome ?? '?'}`);
  }
  if (gatilho.origem) partes.push(`origem ${gatilho.origem}`);

  return partes.length === 0 ? 'Sem filtros — vale para qualquer lead' : partes.join(' · ');
}

function descreverAcao(acao: AcaoFluxo, opcoes: OpcoesDoConstrutor): string {
  const config = acao.config as Record<string, string>;
  const hook = opcoes.webhooks.find((w) => w.id === config.webhook_id)?.nome ?? '?';

  if (acao.tipo === 'mensagem') {
    const texto = (config.modelo ?? '').replace(/\s+/g, ' ').trim();
    const recorte = texto.length > 120 ? `${texto.slice(0, 120)}…` : texto;
    return `Para "${hook}": ${recorte}`;
  }
  if (acao.tipo === 'webhook') return `Chama "${hook}"`;
  if (acao.tipo === 'etiqueta') {
    return `Aplica "${opcoes.tags.find((t) => t.id === config.tag_id)?.nome ?? '?'}"`;
  }

  const etapa = opcoes.etapas.find((e) => e.id === config.stage_id)?.nome ?? '?';
  const funil = opcoes.funis.find((f) => f.id === config.pipeline_id)?.nome ?? '?';
  return `Move para "${etapa}" no funil "${funil}"`;
}
