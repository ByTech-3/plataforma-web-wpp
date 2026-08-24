'use client';

/**
 * Lista de funis com criação, ordenação, padrão e arquivamento.
 *
 * As ações são chamadas direto (não por `<form action>`) porque a tela é densa
 * e cada linha tem várias delas — um formulário por botão viraria uma
 * confusão de estados. O erro de cada operação aparece no lugar onde ela foi
 * disparada.
 */
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CAMPO, CARTAO, ERRO, ROTULO } from '@/components/ui';
import {
  alternarArquivamentoFunil,
  criarFunil,
  definirFunilPadrao,
  reordenarFunis,
} from '@/lib/crm/acoes-funis';
import type { EstadoAcao, FunilGerenciavel } from '@/lib/crm/tipos';

const BOTAO_MENOR =
  'rounded-md border border-black/15 px-3 py-1.5 text-xs font-medium transition ' +
  'hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10';

export function GerenciadorFunis({
  funis,
  podeGerenciar,
}: {
  funis: FunilGerenciavel[];
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

  /** Ordem final inteira, para o servidor renumerar sem depender de empates. */
  function mover(indice: number, direcao: -1 | 1) {
    const ativos = funis.filter((funil) => !funil.arquivado);
    const destino = indice + direcao;
    if (destino < 0 || destino >= ativos.length) return;

    const ordem = ativos.map((funil) => funil.id);
    [ordem[indice], ordem[destino]] = [ordem[destino], ordem[indice]];
    executar(() => reordenarFunis({ ids: ordem }));
  }

  const ativos = funis.filter((funil) => !funil.arquivado);
  const arquivados = funis.filter((funil) => funil.arquivado);

  return (
    <div className="space-y-6">
      {erro && <p className={ERRO}>{erro}</p>}

      {podeGerenciar && <FormNovoFunil aoCriar={executar} pendente={pendente} />}

      <section className="space-y-3">
        {ativos.map((funil, indice) => (
          <article key={funil.id} className={CARTAO}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
                  {funil.nome}
                  {funil.padrao && (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      Padrão
                    </span>
                  )}
                </h2>
                {funil.descricao && (
                  <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                    {funil.descricao}
                  </p>
                )}
                <p className="mt-1 text-xs text-neutral-500">
                  {funil.total_etapas} {funil.total_etapas === 1 ? 'etapa' : 'etapas'} ·{' '}
                  {funil.total_leads} {funil.total_leads === 1 ? 'lead' : 'leads'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {podeGerenciar && ativos.length > 1 && (
                  <>
                    <button
                      type="button"
                      className={BOTAO_MENOR}
                      onClick={() => mover(indice, -1)}
                      disabled={pendente || indice === 0}
                      aria-label={`Mover ${funil.nome} para cima`}
                      title="Mover para cima"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={BOTAO_MENOR}
                      onClick={() => mover(indice, 1)}
                      disabled={pendente || indice === ativos.length - 1}
                      aria-label={`Mover ${funil.nome} para baixo`}
                      title="Mover para baixo"
                    >
                      ↓
                    </button>
                  </>
                )}

                <Link href={`/funis/${funil.id}`} className={BOTAO_MENOR}>
                  Etapas
                </Link>

                <Link href={`/kanban?funil=${funil.id}`} className={BOTAO_MENOR}>
                  Abrir quadro
                </Link>

                {podeGerenciar && !funil.padrao && (
                  <button
                    type="button"
                    className={BOTAO_MENOR}
                    disabled={pendente}
                    onClick={() => executar(() => definirFunilPadrao({ id: funil.id }))}
                  >
                    Tornar padrão
                  </button>
                )}

                {podeGerenciar && (
                  <button
                    type="button"
                    className={BOTAO_MENOR}
                    disabled={pendente}
                    onClick={() =>
                      executar(() =>
                        alternarArquivamentoFunil({ id: funil.id, arquivar: true }),
                      )
                    }
                  >
                    Arquivar
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}

        {ativos.length === 0 && (
          <div className={CARTAO}>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Nenhum funil ativo. {podeGerenciar ? 'Crie um acima.' : 'Peça a um gestor para criar.'}
            </p>
          </div>
        )}
      </section>

      {arquivados.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold">Arquivados</h2>
          <p className="mt-1 mb-3 text-xs text-neutral-500">
            Ficam fora do seletor do Kanban e não recebem leads novos. Os dados continuam no banco.
          </p>

          <div className="space-y-2">
            {arquivados.map((funil) => (
              <div
                key={funil.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 px-4 py-3 dark:border-white/15"
              >
                <div>
                  <p className="text-sm font-medium">{funil.nome}</p>
                  <p className="text-xs text-neutral-500">
                    {funil.total_etapas} etapas · {funil.total_leads} leads
                  </p>
                </div>

                {podeGerenciar && (
                  <button
                    type="button"
                    className={BOTAO_MENOR}
                    disabled={pendente}
                    onClick={() =>
                      executar(() =>
                        alternarArquivamentoFunil({ id: funil.id, arquivar: false }),
                      )
                    }
                  >
                    Restaurar
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function FormNovoFunil({
  aoCriar,
  pendente,
}: {
  aoCriar: (acao: () => Promise<EstadoAcao>) => void;
  pendente: boolean;
}) {
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');

  return (
    <form
      className={CARTAO}
      onSubmit={(evento) => {
        evento.preventDefault();
        if (nome.trim().length < 2) return;
        aoCriar(async () => {
          const resultado = await criarFunil({ nome, descricao });
          if (!resultado.erro) {
            setNome('');
            setDescricao('');
          }
          return resultado;
        });
      }}
    >
      <h2 className="text-sm font-semibold">Novo funil</h2>
      <p className="mt-1 mb-4 text-xs text-neutral-500">
        Um funil novo nasce sem etapas — crie as etapas dele na tela seguinte.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={ROTULO} htmlFor="funil-nome">
            Nome
          </label>
          <input
            id="funil-nome"
            className={CAMPO}
            value={nome}
            onChange={(evento) => setNome(evento.target.value)}
            minLength={2}
            maxLength={80}
            required
            placeholder="Campanha de verão"
            disabled={pendente}
          />
        </div>

        <div>
          <label className={ROTULO} htmlFor="funil-descricao">
            Descrição (opcional)
          </label>
          <input
            id="funil-descricao"
            className={CAMPO}
            value={descricao}
            onChange={(evento) => setDescricao(evento.target.value)}
            maxLength={200}
            placeholder="Para que serve este funil"
            disabled={pendente}
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={pendente || nome.trim().length < 2}
        className="mt-4 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
      >
        {pendente ? 'Criando…' : 'Criar funil'}
      </button>
    </form>
  );
}
