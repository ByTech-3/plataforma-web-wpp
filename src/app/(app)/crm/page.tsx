import type { Metadata } from 'next';
import Link from 'next/link';
import { AVISO, CARTAO } from '@/components/ui';
import { EnviarMensagem } from '@/components/crm/EnviarMensagem';
import { LIMITE_LISTAGEM, listarLeads, organizacaoAtual } from '@/lib/crm/dados';
import { formatarData, formatarDataHora, formatarMoeda, ouTraco } from '@/lib/crm/formato';
import type { LeadDaTela } from '@/lib/crm/tipos';

export const metadata: Metadata = { title: 'CRM · Leads · ByTech3' };

/**
 * Listagem de leads.
 *
 * A regra de carteira (CLAUDE.md §5) não é aplicada aqui: a policy
 * `lead_select_carteira` já devolve apenas o que este usuário pode ver —
 * gestor/admin recebem a organização inteira, vendedor recebe os seus mais os
 * sem responsável. Esta página apenas desenha o que o banco autorizou.
 *
 * Arquivados ficam ocultos por padrão (`?arquivados=1` mostra).
 */
export default async function PaginaCrm({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>;
}) {
  const filtros = await searchParams;
  const mostrarArquivados = filtros.arquivados === '1';

  const organizacao = await organizacaoAtual();
  const { leads, totalAtivos, totalArquivados } = await listarLeads(organizacao.organization_id, {
    incluirArquivados: mostrarArquivados,
  });

  const ehGestor = organizacao.papel === 'admin' || organizacao.papel === 'gestor';

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            {ehGestor
              ? 'Você vê todos os leads da organização.'
              : 'Você vê os seus leads e os que ainda estão sem responsável.'}
          </p>
        </div>

        <Link
          href="/crm/novo"
          className="rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
        >
          Novo lead
        </Link>
      </header>

      {!organizacao.acesso_ativo && (
        <p className={AVISO}>
          <span className="font-semibold">Acesso somente leitura.</span> O período de teste desta
          organização terminou. A lista continua disponível, mas gravações são recusadas pelo banco
          — não apenas por esta tela.
        </p>
      )}

      <nav className="flex items-center gap-2 text-sm">
        <FiltroLink ativo={!mostrarArquivados} href="/crm">
          Ativos ({totalAtivos})
        </FiltroLink>
        <FiltroLink ativo={mostrarArquivados} href="/crm?arquivados=1">
          Incluir arquivados ({totalArquivados})
        </FiltroLink>
      </nav>

      {leads.length >= LIMITE_LISTAGEM && (
        <p className={AVISO}>
          Mostrando os {LIMITE_LISTAGEM} leads mais recentes. Os demais existem e continuam no
          banco — a busca e a paginação entram junto com o Kanban.
        </p>
      )}

      {leads.length === 0 ? (
        <div className={CARTAO}>
          <h2 className="text-sm font-semibold">Nenhum lead por aqui</h2>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            {mostrarArquivados
              ? 'Nem ativos, nem arquivados.'
              : 'Cadastre o primeiro lead — ele já entra no funil padrão, na primeira etapa.'}
          </p>
          <Link
            href="/crm/novo"
            className="mt-4 inline-block text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            Cadastrar lead
          </Link>
        </div>
      ) : (
        <>
          <TabelaLeads leads={leads} />
          <ListaLeads leads={leads} />
        </>
      )}
    </div>
  );
}

function FiltroLink({
  ativo,
  href,
  children,
}: {
  ativo: boolean;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={ativo ? 'page' : undefined}
      className={
        ativo
          ? 'rounded-md bg-black/5 px-3 py-1.5 font-semibold dark:bg-white/10'
          : 'rounded-md px-3 py-1.5 text-neutral-600 transition hover:bg-black/5 dark:text-neutral-400 dark:hover:bg-white/10'
      }
    >
      {children}
    </Link>
  );
}

/** Tabela para telas largas. */
function TabelaLeads({ leads }: { leads: LeadDaTela[] }) {
  return (
    <div className="hidden overflow-x-auto rounded-xl border border-black/10 md:block dark:border-white/15">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-black/10 text-xs uppercase tracking-wide text-neutral-500 dark:border-white/15">
          <tr>
            <th className="px-4 py-3 font-medium">Nome</th>
            <th className="px-4 py-3 font-medium">Telefone</th>
            <th className="px-4 py-3 font-medium">Origem</th>
            <th className="px-4 py-3 font-medium">Responsável</th>
            <th className="px-4 py-3 font-medium">Valor</th>
            <th className="px-4 py-3 font-medium">Etapa</th>
            <th className="px-4 py-3 font-medium">Criado em</th>
            <th className="px-4 py-3 font-medium"><span className="sr-only">Ações</span></th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr
              key={lead.id}
              className="border-b border-black/5 last:border-0 hover:bg-black/3 dark:border-white/10 dark:hover:bg-white/4"
            >
              <td className="px-4 py-3">
                <Link
                  href={`/crm/${lead.id}`}
                  className="font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                >
                  {lead.nome}
                </Link>
                {lead.arquivado && <SeloArquivado />}
                {lead.previsao_fechamento && (
                  <p className="mt-0.5 text-xs text-neutral-500">
                    Previsão: {formatarData(lead.previsao_fechamento)}
                  </p>
                )}
              </td>
              <td className="px-4 py-3">{ouTraco(lead.telefone)}</td>
              <td className="px-4 py-3">{lead.origem}</td>
              <td className="px-4 py-3">
                {lead.responsavel ? (
                  lead.responsavel.nome
                ) : (
                  <span className="text-neutral-500">Sem responsável</span>
                )}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">{formatarMoeda(lead.valor)}</td>
              <td className="px-4 py-3">
                <Etapa lead={lead} />
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-neutral-600 dark:text-neutral-400">
                {formatarDataHora(lead.criado_em)}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                {lead.telefone && (
                  <EnviarMensagem leadId={lead.id} nome={lead.nome} variante="discreto" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Mesma informação em cartões, para telas estreitas. */
function ListaLeads({ leads }: { leads: LeadDaTela[] }) {
  return (
    <ul className="space-y-3 md:hidden">
      {leads.map((lead) => (
        <li
          key={lead.id}
          className="rounded-xl border border-black/10 p-4 text-sm dark:border-white/15"
        >
          <div className="flex items-start justify-between gap-3">
            <Link
              href={`/crm/${lead.id}`}
              className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
            >
              {lead.nome}
            </Link>
            <span className="whitespace-nowrap">{formatarMoeda(lead.valor)}</span>
          </div>

          {lead.arquivado && <SeloArquivado />}

          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-neutral-600 dark:text-neutral-400">
            <div>
              <dt className="text-neutral-500">Telefone</dt>
              <dd>{ouTraco(lead.telefone)}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Origem</dt>
              <dd>{lead.origem}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Responsável</dt>
              <dd>{lead.responsavel?.nome ?? 'Sem responsável'}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Etapa</dt>
              <dd>
                <Etapa lead={lead} />
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-neutral-500">Criado em</dt>
              <dd>{formatarDataHora(lead.criado_em)}</dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}

function Etapa({ lead }: { lead: LeadDaTela }) {
  if (!lead.etapa) {
    return <span className="text-xs text-neutral-500">Fora do funil</span>;
  }

  const cor =
    lead.etapa.tipo === 'ganho'
      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
      : lead.etapa.tipo === 'perdido'
        ? 'bg-red-500/15 text-red-700 dark:text-red-400'
        : 'bg-sky-500/15 text-sky-700 dark:text-sky-400';

  return (
    <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${cor}`}>
      {lead.etapa.stage_nome}
    </span>
  );
}

function SeloArquivado() {
  return (
    <span className="ml-2 inline-block rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
      Arquivado
    </span>
  );
}
