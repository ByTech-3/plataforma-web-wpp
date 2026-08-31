/**
 * Esqueletos de carregamento.
 *
 * POR QUE ESQUELETO E NÃO UM SPINNER: o spinner no meio da tela diz "espere" e
 * não diz mais nada — a página some, aparece um giro, e a página volta com
 * outro formato. O esqueleto desenha ANTES o formato que vai chegar, então a
 * troca de tela não pisca e o olho já sabe onde a informação vai cair.
 *
 * Quem monta isto é o Next: cada `loading.tsx` é um Suspense automático em
 * volta da rota. O esqueleto aparece no instante do clique, sem esperar
 * nenhuma ida ao banco.
 *
 * REGRA DE OURO: o esqueleto tem que ter a MESMA estrutura da tela real —
 * mesmo cabeçalho, mesmo número aproximado de blocos, mesmas alturas. Um
 * esqueleto que não bate com o conteúdo é pior que nenhum, porque o salto no
 * fim chama mais atenção do que a espera.
 */

/** Um retângulo cinza pulsando. `className` define largura e altura. */
export function Barra({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-padrao bg-superficie-2 ${className}`} />;
}

/**
 * Cabeçalho de tela: título grande, uma linha de apoio e (opcional) os botões
 * da direita. Todas as telas internas começam assim.
 */
export function CabecalhoEsqueleto({ acoes = 0 }: { acoes?: number }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-2">
        <Barra className="h-8 w-52" />
        <Barra className="h-4 w-72" />
      </div>

      {acoes > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {Array.from({ length: acoes }, (_, indice) => (
            <Barra key={indice} className="h-10 w-32" />
          ))}
        </div>
      )}
    </header>
  );
}

/** A barra de filtros que fica acima da lista e do quadro. */
export function FiltrosEsqueleto() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Barra className="h-9 w-56" />
      <Barra className="h-9 w-40" />
      <Barra className="h-9 w-40" />
      <Barra className="h-9 w-36" />
    </div>
  );
}

/**
 * A listagem de leads: tabela nas telas largas, cartões nas estreitas — as
 * mesmas duas formas que a tela real usa.
 */
export function TabelaEsqueleto({ linhas = 8 }: { linhas?: number }) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-grande border border-linha md:block">
        <div className="border-b border-linha px-4 py-3">
          <Barra className="h-3 w-24" />
        </div>
        {Array.from({ length: linhas }, (_, indice) => (
          <div
            key={indice}
            className="flex items-center gap-4 border-b border-linha px-4 py-3.5 last:border-0"
          >
            <Barra className="h-4 flex-[2]" />
            <Barra className="h-4 flex-1" />
            <Barra className="h-4 flex-1" />
            <Barra className="h-4 flex-1" />
            <Barra className="h-6 w-24 rounded-full" />
          </div>
        ))}
      </div>

      <ul className="space-y-3 md:hidden">
        {Array.from({ length: 4 }, (_, indice) => (
          <li key={indice} className="space-y-3 rounded-grande border border-linha p-4">
            <Barra className="h-5 w-40" />
            <Barra className="h-3 w-full" />
            <Barra className="h-3 w-2/3" />
          </li>
        ))}
      </ul>
    </>
  );
}

/** Colunas do Kanban, com cartões de alturas variadas para não parecer grade. */
export function QuadroEsqueleto({ colunas = 4 }: { colunas?: number }) {
  const alturas = ['h-24', 'h-20', 'h-28', 'h-20', 'h-24'];

  return (
    <div className="-mx-6 flex gap-4 overflow-hidden px-6">
      {Array.from({ length: colunas }, (_, coluna) => (
        <div key={coluna} className="w-72 shrink-0 space-y-3 rounded-grande bg-superficie-2/60 p-3">
          <div className="flex items-center justify-between">
            <Barra className="h-4 w-28" />
            <Barra className="h-4 w-8" />
          </div>
          {Array.from({ length: 3 }, (_, cartao) => (
            <div key={cartao} className="rounded-grande border border-linha bg-fundo p-3">
              <Barra className={`w-full ${alturas[(coluna + cartao) % alturas.length]}`} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Grade de cartões — atalhos, funis, etiquetas. */
export function CartoesEsqueleto({
  quantidade = 4,
  colunas = 'sm:grid-cols-2',
}: {
  quantidade?: number;
  colunas?: string;
}) {
  return (
    <div className={`grid gap-4 ${colunas}`}>
      {Array.from({ length: quantidade }, (_, indice) => (
        <div key={indice} className="space-y-3 rounded-grande border border-linha p-5">
          <Barra className="h-4 w-32" />
          <Barra className="h-3 w-full" />
          <Barra className="h-3 w-4/5" />
          <Barra className="h-9 w-36" />
        </div>
      ))}
    </div>
  );
}

/** Um formulário: pares de rótulo + campo, e os botões no fim. */
export function FormularioEsqueleto({ campos = 6 }: { campos?: number }) {
  return (
    <div className="space-y-5 rounded-grande border border-linha p-5">
      {Array.from({ length: campos }, (_, indice) => (
        <div key={indice} className="space-y-2">
          <Barra className="h-3 w-24" />
          <Barra className="h-10 w-full" />
        </div>
      ))}
      <div className="flex gap-3 pt-2">
        <Barra className="h-10 w-36" />
        <Barra className="h-10 w-24" />
      </div>
    </div>
  );
}
