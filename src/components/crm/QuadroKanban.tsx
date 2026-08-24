'use client';

/**
 * Quadro Kanban com arrastar e soltar nativo (HTML5 Drag and Drop).
 *
 * Sem biblioteca: o quadro é usado no desktop, e a API nativa dá conta de
 * arrastar cartão entre colunas. Como arrastar não funciona no toque, cada
 * cartão também tem um seletor "mover para" — que aparece nas telas estreitas
 * e serve de caminho pelo teclado, que o arrastar não oferece.
 *
 * O cliente decide POSIÇÃO VISUAL (qual coluna, entre quais cartões) e manda a
 * intenção. Quem calcula o número gravado em `lead_pipeline.posicao` é o
 * servidor, com os dados frescos do banco.
 *
 * A movimentação é otimista: o cartão anda na hora e volta sozinho se o banco
 * recusar (licença vencida, lead fora da carteira), com o motivo na tela. Nada
 * é escondido preventivamente — quem recusa é a policy.
 */
import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { ERRO } from '@/components/ui';
import { formatarMoeda } from '@/lib/crm/formato';
import {
  COR_PADRAO_TIPO,
  type CartaoKanban,
  type ColunaKanban,
  type EstadoAcao,
  type PedidoMover,
} from '@/lib/crm/tipos';

type Props = {
  colunasIniciais: ColunaKanban[];
  mover: (pedido: PedidoMover) => Promise<EstadoAcao>;
};

type Arrasto = { vinculoId: string; colunaId: string; indice: number };
type Alvo = { colunaId: string; indice: number };

/** Cor escolhida na gestão do funil; na falta dela, a cor do tipo. */
function corDaEtapa(coluna: ColunaKanban): string {
  return coluna.cor ?? COR_PADRAO_TIPO[coluna.tipo];
}

/** Em que posição da lista o cursor está, comparando com o meio de cada cartão. */
function calcularIndice(lista: HTMLElement | null, clientY: number): number {
  if (!lista) return 0;
  const cartoes = Array.from(lista.querySelectorAll<HTMLElement>('[data-cartao]'));
  for (let i = 0; i < cartoes.length; i += 1) {
    const area = cartoes[i].getBoundingClientRect();
    if (clientY < area.top + area.height / 2) return i;
  }
  return cartoes.length;
}

export function QuadroKanban({ colunasIniciais, mover }: Props) {
  const [colunas, setColunas] = useState(colunasIniciais);
  const [arrasto, setArrasto] = useState<Arrasto | null>(null);
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function aplicarMovimento(
    origem: Arrasto,
    colunaDestinoId: string,
    indiceVisual: number,
  ) {
    const anterior = colunas;

    const copia = colunas.map((coluna) => ({ ...coluna, cartoes: [...coluna.cartoes] }));
    const colunaOrigem = copia.find((coluna) => coluna.id === origem.colunaId);
    const colunaDestino = copia.find((coluna) => coluna.id === colunaDestinoId);
    if (!colunaOrigem || !colunaDestino) return;

    const [cartao] = colunaOrigem.cartoes.splice(origem.indice, 1);
    if (!cartao) return;

    // O índice visual conta com o cartão arrastado ainda no lugar antigo.
    // Na mesma coluna, tirá-lo de lá desloca tudo o que vem depois.
    let indice = indiceVisual;
    if (origem.colunaId === colunaDestinoId && origem.indice < indiceVisual) {
      indice -= 1;
    }
    indice = Math.min(Math.max(indice, 0), colunaDestino.cartoes.length);

    // Soltou no mesmo lugar: não vale uma ida ao banco (nem um evento no
    // histórico, se fosse troca de etapa).
    if (origem.colunaId === colunaDestinoId && indice === origem.indice) return;

    colunaDestino.cartoes.splice(indice, 0, cartao);

    setErro(null);
    setColunas(copia);

    iniciar(async () => {
      const resultado = await mover({
        vinculo_id: cartao.vinculo_id,
        stage_id: colunaDestinoId,
        indice,
      });

      if (resultado.erro) {
        setColunas(anterior);
        setErro(resultado.erro);
      }
    });
  }

  return (
    <div className="space-y-3">
      {erro && <p className={ERRO}>{erro}</p>}

      {/* Indicador discreto no lugar de esmaecer o quadro: apagar a tela
          inteira a cada arrasto dá a impressão de que o sistema travou, e o
          cartão já se moveu de forma otimista — não há o que esperar. */}
      <p
        aria-live="polite"
        className={`h-4 text-xs text-neutral-500 transition-opacity ${
          pendente ? 'opacity-100' : 'opacity-0'
        }`}
      >
        Salvando a posição…
      </p>

      <div className="flex gap-4 overflow-x-auto pb-4" aria-busy={pendente}>
        {colunas.map((coluna) => (
          <Coluna
            key={coluna.id}
            coluna={coluna}
            arrasto={arrasto}
            alvo={alvo}
            colunas={colunas}
            aoIniciarArrasto={setArrasto}
            aoTerminarArrasto={() => {
              setArrasto(null);
              setAlvo(null);
            }}
            aoPassarPorCima={setAlvo}
            aoSoltar={(indiceVisual) => {
              if (arrasto) aplicarMovimento(arrasto, coluna.id, indiceVisual);
              setArrasto(null);
              setAlvo(null);
            }}
            aoEscolherEtapa={(cartao, indiceNaOrigem, destinoId) => {
              const destino = colunas.find((item) => item.id === destinoId);
              if (!destino) return;
              aplicarMovimento(
                { vinculoId: cartao.vinculo_id, colunaId: coluna.id, indice: indiceNaOrigem },
                destinoId,
                destino.cartoes.length,
              );
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Coluna({
  coluna,
  colunas,
  arrasto,
  alvo,
  aoIniciarArrasto,
  aoTerminarArrasto,
  aoPassarPorCima,
  aoSoltar,
  aoEscolherEtapa,
}: {
  coluna: ColunaKanban;
  colunas: ColunaKanban[];
  arrasto: Arrasto | null;
  alvo: Alvo | null;
  aoIniciarArrasto: (arrasto: Arrasto) => void;
  aoTerminarArrasto: () => void;
  aoPassarPorCima: (alvo: Alvo) => void;
  aoSoltar: (indiceVisual: number) => void;
  aoEscolherEtapa: (cartao: CartaoKanban, indice: number, destinoId: string) => void;
}) {
  const lista = useRef<HTMLDivElement>(null);

  const total = coluna.cartoes.length;
  const soma = coluna.cartoes.reduce((acumulado, cartao) => acumulado + (cartao.valor ?? 0), 0);
  const recebendo = Boolean(arrasto) && alvo?.colunaId === coluna.id;

  return (
    <section
      className={`flex max-h-[calc(100vh-14rem)] w-72 shrink-0 flex-col rounded-xl border transition ${
        recebendo
          ? 'border-emerald-500 bg-emerald-500/5'
          : 'border-black/10 bg-black/2 dark:border-white/15 dark:bg-white/2'
      }`}
      onDragOver={(evento) => {
        if (!arrasto) return;
        // Sem preventDefault o navegador não considera esta área um destino
        // válido e o "drop" nunca chega.
        evento.preventDefault();
        evento.dataTransfer.dropEffect = 'move';
        aoPassarPorCima({ colunaId: coluna.id, indice: calcularIndice(lista.current, evento.clientY) });
      }}
      onDrop={(evento) => {
        evento.preventDefault();
        aoSoltar(calcularIndice(lista.current, evento.clientY));
      }}
    >
      <header className="shrink-0 border-b border-black/10 px-3 py-3 dark:border-white/15">
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: corDaEtapa(coluna) }}
            aria-hidden
          />
          <h2 className="truncate text-sm font-semibold">{coluna.nome}</h2>
          <span className="ml-auto rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-white/10 dark:text-neutral-400">
            {total}
          </span>
        </div>
        <p className="mt-1 text-xs text-neutral-500">{formatarMoeda(soma)}</p>
      </header>

      {/* A coluna rola por dentro. Sem isto, uma etapa com muitos cartões
          estica a página inteira e o cabeçalho das outras colunas some da
          vista — que é a sensação de "conteúdo cortado". */}
      <div ref={lista} className="flex min-h-32 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {coluna.cartoes.map((cartao, indice) => (
          <div key={cartao.vinculo_id}>
            {recebendo && alvo?.indice === indice && <Marcador />}
            <Cartao
              cartao={cartao}
              colunas={colunas}
              colunaId={coluna.id}
              arrastando={arrasto?.vinculoId === cartao.vinculo_id}
              aoIniciarArrasto={() =>
                aoIniciarArrasto({
                  vinculoId: cartao.vinculo_id,
                  colunaId: coluna.id,
                  indice,
                })
              }
              aoTerminarArrasto={aoTerminarArrasto}
              aoEscolherEtapa={(destinoId) => aoEscolherEtapa(cartao, indice, destinoId)}
            />
          </div>
        ))}

        {recebendo && alvo?.indice === total && <Marcador />}

        {total === 0 && !recebendo && (
          <p className="px-1 py-6 text-center text-xs text-neutral-500">
            Nenhum lead nesta etapa.
          </p>
        )}
      </div>
    </section>
  );
}

function Marcador() {
  return <div className="mb-2 h-0.5 rounded-full bg-emerald-500" aria-hidden />;
}

function Cartao({
  cartao,
  colunas,
  colunaId,
  arrastando,
  aoIniciarArrasto,
  aoTerminarArrasto,
  aoEscolherEtapa,
}: {
  cartao: CartaoKanban;
  colunas: ColunaKanban[];
  colunaId: string;
  arrastando: boolean;
  aoIniciarArrasto: () => void;
  aoTerminarArrasto: () => void;
  aoEscolherEtapa: (destinoId: string) => void;
}) {
  return (
    <article
      data-cartao
      draggable
      onDragStart={(evento) => {
        // Alguns navegadores só iniciam o arrasto se houver dado no dataTransfer.
        evento.dataTransfer.setData('text/plain', cartao.vinculo_id);
        evento.dataTransfer.effectAllowed = 'move';
        aoIniciarArrasto();
      }}
      onDragEnd={aoTerminarArrasto}
      className={`cursor-grab rounded-lg border border-black/10 bg-white p-3 shadow-sm transition active:cursor-grabbing dark:border-white/15 dark:bg-neutral-900 ${
        arrastando ? 'opacity-40' : ''
      }`}
    >
      <Link
        href={`/crm/${cartao.lead_id}`}
        className="block truncate text-sm font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
        // Sem isto, arrastar pelo nome vira "arrastar um link" no Firefox.
        draggable={false}
      >
        {cartao.nome}
      </Link>

      {cartao.telefone && (
        <p className="mt-1 truncate text-xs text-neutral-600 dark:text-neutral-400">
          {cartao.telefone}
        </p>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{formatarMoeda(cartao.valor)}</span>
        <span className="truncate text-xs text-neutral-500" title={cartao.responsavel?.nome}>
          {cartao.responsavel?.nome ?? 'Sem responsável'}
        </span>
      </div>

      {cartao.tags.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1">
          {cartao.tags.map((tag) => (
            <li
              key={tag.id}
              className="rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={
                tag.cor
                  ? { backgroundColor: `${tag.cor}22`, color: tag.cor }
                  : undefined
              }
            >
              <span className={tag.cor ? '' : 'text-neutral-600 dark:text-neutral-400'}>
                {tag.nome}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Caminho sem arrastar: telas de toque e teclado. */}
      <label className="mt-3 block sm:hidden">
        <span className="sr-only">Mover {cartao.nome} para outra etapa</span>
        <select
          value={colunaId}
          onChange={(evento) => aoEscolherEtapa(evento.target.value)}
          className="w-full rounded-md border border-black/15 bg-transparent px-2 py-1 text-xs dark:border-white/20"
        >
          {colunas.map((coluna) => (
            <option key={coluna.id} value={coluna.id}>
              {coluna.id === colunaId ? `Etapa: ${coluna.nome}` : `Mover para ${coluna.nome}`}
            </option>
          ))}
        </select>
      </label>
    </article>
  );
}
