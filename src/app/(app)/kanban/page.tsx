import type { Metadata } from 'next';
import Link from 'next/link';
import { AVISO, CARTAO } from '@/components/ui';
import { QuadroKanban } from '@/components/crm/QuadroKanban';
import { SeletorFunil } from '@/components/crm/SeletorFunil';
import { moverCartaoAction } from '@/lib/crm/acoes';
import { LIMITE_QUADRO, carregarQuadro, listarFunis, organizacaoAtual } from '@/lib/crm/dados';
import { formatarMoeda } from '@/lib/crm/formato';
import type { ColunaKanban } from '@/lib/crm/tipos';

export const metadata: Metadata = { title: 'Kanban · ByTech3' };

/**
 * Quadro do funil.
 *
 * Os cartões vêm de `lead_pipeline` já filtrados pela carteira: a policy
 * `lead_pipeline_select_carteira` chama `pode_ver_lead`, então o vendedor
 * recebe menos cartões que o gestor na mesma coluna — e nada nesta página
 * precisa saber disso.
 */
export default async function PaginaKanban({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>;
}) {
  const filtros = await searchParams;
  const funilPedido = typeof filtros.funil === 'string' ? filtros.funil : null;

  const organizacao = await organizacaoAtual();
  const funis = await listarFunis(organizacao.organization_id);

  if (funis.length === 0) {
    return (
      <Aviso titulo="Nenhum funil nesta organização">
        Toda organização nasce com um funil padrão. Se ele foi apagado, um gestor precisa criar
        outro antes de o quadro existir.
      </Aviso>
    );
  }

  // Funil pedido pela URL, se for mesmo desta organização; senão, o padrão.
  const funilId = funis.find((funil) => funil.id === funilPedido)?.id ?? funis[0].id;
  const quadro = await carregarQuadro(organizacao.organization_id, funilId);

  if (!quadro) {
    return (
      <Aviso titulo="Funil não encontrado">
        Ele não existe ou não pertence a esta organização.
      </Aviso>
    );
  }

  if (quadro.colunas.length === 0) {
    return (
      <Aviso titulo={`O funil "${quadro.funil.nome}" não tem etapas`}>
        Um funil sem etapas não tem colunas para mostrar. Um gestor precisa criar as etapas deste
        funil.
      </Aviso>
    );
  }

  const somaTotal = quadro.colunas.reduce(
    (total, coluna) => total + coluna.cartoes.reduce((soma, cartao) => soma + (cartao.valor ?? 0), 0),
    0,
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{quadro.funil.nome}</h1>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            {quadro.total_cartoes} {quadro.total_cartoes === 1 ? 'lead' : 'leads'} no funil ·{' '}
            {formatarMoeda(somaTotal)} em negociação
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SeletorFunil funis={funis} atual={funilId} />
          <Link
            href="/crm/novo"
            className="rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
          >
            Novo lead
          </Link>
        </div>
      </header>

      {!organizacao.acesso_ativo && (
        <p className={AVISO}>
          <span className="font-semibold">Acesso somente leitura.</span> O período de teste desta
          organização terminou. Você pode arrastar, mas o banco vai recusar a gravação e o cartão
          volta para o lugar — o bloqueio é da policy, não desta tela.
        </p>
      )}

      {quadro.atingiu_limite && (
        <p className={AVISO}>
          Este funil tem mais de {LIMITE_QUADRO} vínculos e o quadro mostra apenas os primeiros. Os
          demais continuam no banco.
        </p>
      )}

      {quadro.total_cartoes === 0 ? (
        <div className={CARTAO}>
          <h2 className="text-sm font-semibold">Nenhum lead neste funil ainda</h2>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            Todo lead cadastrado entra automaticamente no funil padrão, na primeira etapa. Leads
            arquivados não aparecem aqui, e leads que ficaram fora do funil têm o aviso na própria
            ficha, com o botão para colocá-los no quadro.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/crm/novo"
              className="text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400"
            >
              Cadastrar lead
            </Link>
            <Link
              href="/crm"
              className="text-sm font-medium text-neutral-600 hover:underline dark:text-neutral-400"
            >
              Ver a lista de leads
            </Link>
          </div>
        </div>
      ) : (
        <>
          <p className="text-xs text-neutral-500">
            Arraste os cartões entre as colunas. Cada troca de etapa entra sozinha na linha do tempo
            do lead — quem registra é o banco.
          </p>
          {/* A `key` remonta o quadro quando os dados do servidor mudam, para o
              estado local (usado no arrasto otimista) não ficar velho. */}
          <QuadroKanban
            key={assinatura(quadro.colunas)}
            colunasIniciais={quadro.colunas}
            mover={moverCartaoAction}
          />
        </>
      )}
    </div>
  );
}

/** Impressão digital dos dados do servidor: muda quando algum cartão se move. */
function assinatura(colunas: ColunaKanban[]): string {
  return colunas
    .map(
      (coluna) =>
        `${coluna.id}:${coluna.cartoes.map((cartao) => `${cartao.vinculo_id}@${cartao.posicao}`).join(',')}`,
    )
    .join('|');
}

function Aviso({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className={`mx-auto max-w-lg ${CARTAO}`}>
      <h1 className="text-lg font-semibold">{titulo}</h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{children}</p>
      <Link
        href="/crm"
        className="mt-4 inline-block text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400"
      >
        Ir para a lista de leads
      </Link>
    </div>
  );
}
