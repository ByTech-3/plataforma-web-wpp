import type { Metadata } from 'next';
import Link from 'next/link';
import { AVISO, CARTAO } from '@/components/ui';
import { QuadroKanban } from '@/components/crm/QuadroKanban';
import { SeletorFunil } from '@/components/crm/SeletorFunil';
import { FiltrosLeads } from '@/components/crm/FiltrosLeads';
import { moverCartaoAction } from '@/lib/crm/acoes';
import { criarLeadDaConversa } from '@/lib/crm/acoes-inbox';
import { listarInbox } from '@/lib/crm/inbox';
import {
  LIMITE_QUADRO,
  carregarQuadro,
  listarFunis,
  listarMembros,
  organizacaoAtual,
  temFiltro,
  type FiltrosLead,
} from '@/lib/crm/dados';
import { listarTags } from '@/lib/crm/tags';
import { formatarMoeda } from '@/lib/crm/formato';
import type { CartaoConversa, ColunaKanban } from '@/lib/crm/tipos';

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
  const parametros = await searchParams;
  const funilPedido = typeof parametros.funil === 'string' ? parametros.funil : null;

  const texto = (chave: string) =>
    typeof parametros[chave] === 'string' ? (parametros[chave] as string) : undefined;

  // A etapa não entra: no quadro, as etapas SÃO as colunas.
  const filtros: FiltrosLead = {
    responsavel: texto('responsavel'),
    origem: texto('origem'),
    tag: texto('tag'),
    busca: texto('busca'),
  };

  const organizacao = await organizacaoAtual();

  // Nada aqui depende do quadro: pedir em sequência somava idas ao banco que
  // cabem na mesma janela de tempo.
  const [funis, inbox, membros, tags] = await Promise.all([
    listarFunis(organizacao.organization_id),
    listarInbox(organizacao.organization_id),
    listarMembros(organizacao.organization_id),
    listarTags(organizacao.organization_id),
  ]);

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
  const quadro = await carregarQuadro(organizacao.organization_id, funilId, filtros);

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
          <p className="mt-1 text-sm text-texto-2">
            {quadro.total_cartoes} {quadro.total_cartoes === 1 ? 'lead' : 'leads'} no funil ·{' '}
            {formatarMoeda(somaTotal)} em negociação
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SeletorFunil funis={funis} atual={funilId} />
          <Link
            href={`/funis/${funilId}`}
            className="rounded-padrao border border-linha-forte px-4 py-2.5 text-sm font-medium transition hover:bg-superficie-2"
          >
            Editar etapas
          </Link>
          <Link
            href="/crm/novo"
            className="rounded-padrao bg-acao px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-acao-forte"
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

      <FiltrosLeads membros={membros} tags={tags} total={quadro.total_cartoes} />

      {/* A Inbox é a primeira coluna de TODO quadro, inclusive de um funil
          recém-criado: por isso o quadro não é mais considerado "vazio" só
          porque nenhum lead entrou nele ainda. */}
      {quadro.total_cartoes === 0 && inbox.length === 0 && !temFiltro(filtros) ? (
        <div className={CARTAO}>
          <h2 className="text-sm font-semibold">Nenhum lead neste funil ainda</h2>
          <p className="mt-2 text-sm text-texto-2">
            Todo lead cadastrado entra automaticamente no funil padrão, na primeira etapa. Leads
            arquivados não aparecem aqui, e leads que ficaram fora do funil têm o aviso na própria
            ficha, com o botão para colocá-los no quadro.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/crm/novo"
              className="text-sm font-medium text-acao hover:underline"
            >
              Cadastrar lead
            </Link>
            <Link
              href="/crm"
              className="text-sm font-medium text-texto-2 hover:underline"
            >
              Ver a lista de leads
            </Link>
          </div>
        </div>
      ) : (
        <>
          <p className="text-xs text-texto-3">
            Arraste os cartões entre as colunas. Cada troca de etapa entra sozinha na linha do tempo
            do lead — quem registra é o banco.
          </p>
          {/* `-mx-6 px-6` faz a rolagem horizontal ir de borda a borda do
              container, em vez de parar na margem e dar a impressão de que a
              última coluna está cortada.

              A `key` remonta o quadro quando os dados do servidor mudam, para
              o estado local (usado no arrasto otimista) não ficar velho. */}
          <div className="-mx-6 px-6">
            <QuadroKanban
              key={assinatura(quadro.colunas, inbox)}
              colunasIniciais={quadro.colunas}
              inboxInicial={inbox}
              mover={moverCartaoAction}
              criarDaConversa={criarLeadDaConversa}
              tagsDisponiveis={tags}
            />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Impressão digital dos dados do servidor: muda quando um cartão se move ou
 * quando a Inbox é recapturada. É ela que remonta o quadro e descarta o estado
 * otimista assim que os dados de verdade chegam.
 */
function assinatura(colunas: ColunaKanban[], inbox: CartaoConversa[]): string {
  const quadro = colunas
    .map(
      (coluna) =>
        `${coluna.id}:${coluna.cartoes.map((cartao) => `${cartao.vinculo_id}@${cartao.posicao}`).join(',')}`,
    )
    .join('|');

  const conversas = inbox.map((conversa) => `${conversa.id}:${conversa.situacao}`).join(',');

  return `${quadro}#${conversas}`;
}

function Aviso({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className={`mx-auto max-w-lg ${CARTAO}`}>
      <h1 className="text-lg font-semibold">{titulo}</h1>
      <p className="mt-2 text-sm text-texto-2">{children}</p>
      <Link
        href="/crm"
        className="mt-4 inline-block text-sm font-medium text-acao hover:underline"
      >
        Ir para a lista de leads
      </Link>
    </div>
  );
}
