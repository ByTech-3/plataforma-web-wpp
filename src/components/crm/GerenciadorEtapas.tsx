'use client';

/**
 * Edição das etapas de um funil: nome, tipo, cor, ordem e exclusão.
 *
 * O TIPO é o campo que mais importa e o que menos aparenta: é dele que os
 * relatórios vão tirar taxa de conversão, sem depender do nome que o cliente
 * deu à coluna. Por isso ele tem explicação na tela, e não só um seletor.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CAMPO, CARTAO, ERRO, ROTULO } from '@/components/ui';
import {
  criarEtapa,
  excluirEtapa,
  reordenarEtapas,
  salvarEtapa,
  salvarFunil,
} from '@/lib/crm/acoes-funis';
import {
  COR_PADRAO_TIPO,
  ROTULO_TIPO_ETAPA,
  type EstadoAcao,
  type EtapaGerenciavel,
  type FunilGerenciavel,
  type TipoEtapa,
} from '@/lib/crm/tipos';

const TIPOS: TipoEtapa[] = ['aberta', 'ganho', 'perdido'];

const BOTAO_MENOR =
  'rounded-md border border-black/15 px-3 py-1.5 text-xs font-medium transition ' +
  'hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10';

export function GerenciadorEtapas({
  funil,
  etapas,
  podeGerenciar,
}: {
  funil: FunilGerenciavel;
  etapas: EtapaGerenciavel[];
  podeGerenciar: boolean;
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function executar(acao: () => Promise<EstadoAcao>) {
    setErro(null);
    iniciar(async () => {
      const resultado = await acao();
      if (resultado.erro) setErro(resultado.erro);
      else router.refresh();
    });
  }

  function mover(indice: number, direcao: -1 | 1) {
    const destino = indice + direcao;
    if (destino < 0 || destino >= etapas.length) return;

    const ordem = etapas.map((etapa) => etapa.id);
    [ordem[indice], ordem[destino]] = [ordem[destino], ordem[indice]];
    executar(() => reordenarEtapas({ pipeline_id: funil.id, ids: ordem }));
  }

  return (
    <div className="space-y-6">
      {erro && <p className={ERRO}>{erro}</p>}

      {podeGerenciar && <DadosDoFunil funil={funil} executar={executar} pendente={pendente} />}

      <section className={CARTAO}>
        <h2 className="text-sm font-semibold">Etapas</h2>
        <p className="mt-1 mb-4 text-xs text-neutral-500">
          A ordem aqui é a ordem das colunas no quadro. O <strong>tipo</strong> diz o que a etapa
          significa para os relatórios — qual delas conta como venda fechada e qual conta como
          perda — independente do nome que você der a ela.
        </p>

        {etapas.length === 0 ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Este funil ainda não tem etapas. Enquanto não tiver, o quadro dele fica sem colunas.
          </p>
        ) : (
          <ul className="space-y-3">
            {etapas.map((etapa, indice) => (
              <LinhaEtapa
                key={etapa.id}
                etapa={etapa}
                pipelineId={funil.id}
                podeGerenciar={podeGerenciar}
                pendente={pendente}
                primeira={indice === 0}
                ultima={indice === etapas.length - 1}
                executar={executar}
                aoMover={(direcao) => mover(indice, direcao)}
              />
            ))}
          </ul>
        )}
      </section>

      {podeGerenciar && <FormNovaEtapa pipelineId={funil.id} executar={executar} pendente={pendente} />}
    </div>
  );
}

function DadosDoFunil({
  funil,
  executar,
  pendente,
}: {
  funil: FunilGerenciavel;
  executar: (acao: () => Promise<EstadoAcao>) => void;
  pendente: boolean;
}) {
  const [nome, setNome] = useState(funil.nome);
  const [descricao, setDescricao] = useState(funil.descricao ?? '');

  const mudou = nome !== funil.nome || descricao !== (funil.descricao ?? '');

  return (
    <form
      className={CARTAO}
      onSubmit={(evento) => {
        evento.preventDefault();
        executar(() => salvarFunil({ id: funil.id, nome, descricao }));
      }}
    >
      <h2 className="text-sm font-semibold">Dados do funil</h2>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={ROTULO} htmlFor="nome-funil">
            Nome
          </label>
          <input
            id="nome-funil"
            className={CAMPO}
            value={nome}
            onChange={(evento) => setNome(evento.target.value)}
            minLength={2}
            maxLength={80}
            required
            disabled={pendente}
          />
        </div>

        <div>
          <label className={ROTULO} htmlFor="descricao-funil">
            Descrição
          </label>
          <input
            id="descricao-funil"
            className={CAMPO}
            value={descricao}
            onChange={(evento) => setDescricao(evento.target.value)}
            maxLength={200}
            disabled={pendente}
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={pendente || !mudou}
        className="mt-4 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
      >
        {pendente ? 'Salvando…' : 'Salvar'}
      </button>
    </form>
  );
}

function LinhaEtapa({
  etapa,
  pipelineId,
  podeGerenciar,
  pendente,
  primeira,
  ultima,
  executar,
  aoMover,
}: {
  etapa: EtapaGerenciavel;
  pipelineId: string;
  podeGerenciar: boolean;
  pendente: boolean;
  primeira: boolean;
  ultima: boolean;
  executar: (acao: () => Promise<EstadoAcao>) => void;
  aoMover: (direcao: -1 | 1) => void;
}) {
  const [nome, setNome] = useState(etapa.nome);
  const [tipo, setTipo] = useState<TipoEtapa>(etapa.tipo);
  const [cor, setCor] = useState(etapa.cor ?? COR_PADRAO_TIPO[etapa.tipo]);

  const mudou = nome !== etapa.nome || tipo !== etapa.tipo || cor !== (etapa.cor ?? COR_PADRAO_TIPO[etapa.tipo]);

  function confirmarExclusao() {
    const aviso =
      etapa.total_leads > 0
        ? `A etapa "${etapa.nome}" tem ${etapa.total_leads} lead(s). Eles NÃO serão apagados, ` +
          'mas sairão do funil e precisarão ser recolocados um a um. Continuar?'
        : `Excluir a etapa "${etapa.nome}"?`;

    if (!window.confirm(aviso)) return;
    executar(() => excluirEtapa({ id: etapa.id, pipeline_id: pipelineId }));
  }

  return (
    <li className="rounded-lg border border-black/10 p-3 dark:border-white/15">
      <div className="flex flex-wrap items-end gap-3">
        <span
          aria-hidden
          className="mb-2 h-4 w-4 shrink-0 rounded-full border border-black/10"
          style={{ background: etapa.cor ?? COR_PADRAO_TIPO[etapa.tipo] }}
        />

        <div className="min-w-40 flex-1">
          <label className="mb-1 block text-xs font-medium" htmlFor={`nome-${etapa.id}`}>
            Nome
          </label>
          <input
            id={`nome-${etapa.id}`}
            className={CAMPO}
            value={nome}
            onChange={(evento) => setNome(evento.target.value)}
            maxLength={60}
            disabled={!podeGerenciar || pendente}
          />
        </div>

        <div className="min-w-36">
          <label className="mb-1 block text-xs font-medium" htmlFor={`tipo-${etapa.id}`}>
            Tipo
          </label>
          <select
            id={`tipo-${etapa.id}`}
            className={CAMPO}
            value={tipo}
            onChange={(evento) => setTipo(evento.target.value as TipoEtapa)}
            disabled={!podeGerenciar || pendente}
          >
            {TIPOS.map((valor) => (
              <option key={valor} value={valor}>
                {ROTULO_TIPO_ETAPA[valor]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium" htmlFor={`cor-${etapa.id}`}>
            Cor
          </label>
          <input
            id={`cor-${etapa.id}`}
            type="color"
            value={cor}
            onChange={(evento) => setCor(evento.target.value)}
            disabled={!podeGerenciar || pendente}
            className="h-9 w-14 cursor-pointer rounded-md border border-black/15 bg-transparent dark:border-white/20"
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="mr-auto text-xs text-neutral-500">
          {etapa.total_leads} {etapa.total_leads === 1 ? 'lead' : 'leads'} nesta etapa
        </span>

        {podeGerenciar && (
          <>
            <button
              type="button"
              className={BOTAO_MENOR}
              disabled={pendente || primeira}
              onClick={() => aoMover(-1)}
              aria-label={`Mover ${etapa.nome} para cima`}
            >
              ↑
            </button>
            <button
              type="button"
              className={BOTAO_MENOR}
              disabled={pendente || ultima}
              onClick={() => aoMover(1)}
              aria-label={`Mover ${etapa.nome} para baixo`}
            >
              ↓
            </button>
            <button
              type="button"
              className={BOTAO_MENOR}
              disabled={pendente || !mudou}
              onClick={() =>
                executar(() =>
                  salvarEtapa({ id: etapa.id, pipeline_id: pipelineId, nome, tipo, cor }),
                )
              }
            >
              Salvar
            </button>
            <button
              type="button"
              className={`${BOTAO_MENOR} text-red-700 dark:text-red-400`}
              disabled={pendente}
              onClick={confirmarExclusao}
            >
              Excluir
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function FormNovaEtapa({
  pipelineId,
  executar,
  pendente,
}: {
  pipelineId: string;
  executar: (acao: () => Promise<EstadoAcao>) => void;
  pendente: boolean;
}) {
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<TipoEtapa>('aberta');
  const [cor, setCor] = useState(COR_PADRAO_TIPO.aberta);

  return (
    <form
      className={CARTAO}
      onSubmit={(evento) => {
        evento.preventDefault();
        if (nome.trim().length === 0) return;
        executar(async () => {
          const resultado = await criarEtapa({ pipeline_id: pipelineId, nome, tipo, cor });
          if (!resultado.erro) {
            setNome('');
            setTipo('aberta');
            setCor(COR_PADRAO_TIPO.aberta);
          }
          return resultado;
        });
      }}
    >
      <h2 className="text-sm font-semibold">Nova etapa</h2>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-40 flex-1">
          <label className={ROTULO} htmlFor="nova-etapa-nome">
            Nome
          </label>
          <input
            id="nova-etapa-nome"
            className={CAMPO}
            value={nome}
            onChange={(evento) => setNome(evento.target.value)}
            maxLength={60}
            required
            placeholder="Proposta enviada"
            disabled={pendente}
          />
        </div>

        <div className="min-w-36">
          <label className={ROTULO} htmlFor="nova-etapa-tipo">
            Tipo
          </label>
          <select
            id="nova-etapa-tipo"
            className={CAMPO}
            value={tipo}
            onChange={(evento) => {
              const novo = evento.target.value as TipoEtapa;
              setTipo(novo);
              setCor(COR_PADRAO_TIPO[novo]);
            }}
            disabled={pendente}
          >
            {TIPOS.map((valor) => (
              <option key={valor} value={valor}>
                {ROTULO_TIPO_ETAPA[valor]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={ROTULO} htmlFor="nova-etapa-cor">
            Cor
          </label>
          <input
            id="nova-etapa-cor"
            type="color"
            value={cor}
            onChange={(evento) => setCor(evento.target.value)}
            disabled={pendente}
            className="h-9 w-14 cursor-pointer rounded-md border border-black/15 bg-transparent dark:border-white/20"
          />
        </div>

        <button
          type="submit"
          disabled={pendente || nome.trim().length === 0}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
        >
          {pendente ? 'Adicionando…' : 'Adicionar etapa'}
        </button>
      </div>
    </form>
  );
}
