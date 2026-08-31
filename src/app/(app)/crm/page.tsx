import type { Metadata } from 'next';
import Link from 'next/link';
import { AVISO, CARTAO } from '@/components/ui';
import { EnviarMensagem } from '@/components/crm/EnviarMensagem';
import { FiltrosLeads } from '@/components/crm/FiltrosLeads';
import {
  LIMITE_LISTAGEM,
  listarLeads,
  listarMembros,
  organizacaoAtual,
  temFiltro,
  type FiltrosLead,
} from '@/lib/crm/dados';
import { listarEtapasParaFiltro, listarTags } from '@/lib/crm/tags';
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
  const parametros = await searchParams;
  const mostrarArquivados = parametros.arquivados === '1';

  const texto = (chave: string) =>
    typeof parametros[chave] === 'string' ? (parametros[chave] as string) : undefined;

  const filtros: FiltrosLead = {
    responsavel: texto('responsavel'),
    origem: texto('origem'),
    tag: texto('tag'),
    etapa: texto('etapa'),
    busca: texto('busca'),
  };

  const organizacao = await organizacaoAtual();

  const [{ leads, totalAtivos, totalArquivados }, membros, tags, etapas] = await Promise.all([
    listarLeads(organizacao.organization_id, { incluirArquivados: mostrarArquivados, filtros }),
    listarMembros(organizacao.organization_id),
    listarTags(organizacao.organization_id),
    listarEtapasParaFiltro(organizacao.organization_id),
  ]);

  const ehGestor = organizacao.papel === 'admin' || organizacao.papel === 'gestor';
  const filtrando = temFiltro(filtros);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="mt-1 text-sm text-texto-2">
            {ehGestor
              ? 'Você vê todos os leads da organização.'
              : 'Você vê os seus leads e os que ainda estão sem responsável.'}
          </p>
        </div>

        <Link
          href="/crm/novo"
          className="rounded-padrao bg-acao px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-acao-forte"
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

      <FiltrosLeads membros={membros} tags={tags} etapas={etapas} total={leads.length} />

      {leads.length >= LIMITE_LISTAGEM && (
        <p className={AVISO}>
          Mostrando os {LIMITE_LISTAGEM} leads mais recentes. Os demais existem e continuam no
          banco — a busca e a paginação entram junto com o Kanban.
        </p>
      )}

      {leads.length === 0 ? (
        <div className={CARTAO}>
          <h2 className="text-sm font-semibold">
            {filtrando ? 'Nenhum lead com esses filtros' : 'Nenhum lead por aqui'}
          </h2>
          <p className="mt-2 text-sm text-texto-2">
            {filtrando
              ? 'Ajuste ou limpe os filtros acima para ver mais leads.'
              : mostrarArquivados
                ? 'Nem ativos, nem arquivados.'
                : 'Cadastre o primeiro lead — ele já entra no funil padrão, na primeira etapa.'}
          </p>
          {!filtrando && (
            <Link
              href="/crm/novo"
              className="mt-4 inline-block text-sm font-medium text-acao hover:underline"
            >
              Cadastrar lead
            </Link>
          )}
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
          ? 'rounded-padrao bg-superficie-2 px-3 py-1.5 font-semibold'
          : 'rounded-padrao px-3 py-1.5 text-texto-2 transition hover:bg-superficie-2'
      }
    >
      {children}
    </Link>
  );
}

/** Tabela para telas largas. */
function TabelaLeads({ leads }: { leads: LeadDaTela[] }) {
  return (
    <div className="hidden overflow-x-auto rounded-grande border border-linha md:block">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-linha text-xs uppercase tracking-wide text-texto-3">
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
              className="border-b border-linha last:border-0 hover:bg-superficie-2"
            >
              <td className="px-4 py-3">
                <Link
                  href={`/crm/${lead.id}`}
                  className="font-medium text-acao hover:underline"
                >
                  {lead.nome}
                </Link>
                {lead.arquivado && <SeloArquivado />}
                {lead.previsao_fechamento && (
                  <p className="mt-0.5 text-xs text-texto-3">
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
                  <span className="text-texto-3">Sem responsável</span>
                )}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">{formatarMoeda(lead.valor)}</td>
              <td className="px-4 py-3">
                <Etapa lead={lead} />
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-texto-2">
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
          className="rounded-grande border border-linha p-4 text-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <Link
              href={`/crm/${lead.id}`}
              className="font-semibold text-acao hover:underline"
            >
              {lead.nome}
            </Link>
            <span className="whitespace-nowrap">{formatarMoeda(lead.valor)}</span>
          </div>

          {lead.arquivado && <SeloArquivado />}

          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-texto-2">
            <div>
              <dt className="text-texto-3">Telefone</dt>
              <dd>{ouTraco(lead.telefone)}</dd>
            </div>
            <div>
              <dt className="text-texto-3">Origem</dt>
              <dd>{lead.origem}</dd>
            </div>
            <div>
              <dt className="text-texto-3">Responsável</dt>
              <dd>{lead.responsavel?.nome ?? 'Sem responsável'}</dd>
            </div>
            <div>
              <dt className="text-texto-3">Etapa</dt>
              <dd>
                <Etapa lead={lead} />
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-texto-3">Criado em</dt>
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
    return <span className="text-xs text-texto-3">Fora do funil</span>;
  }

  const cor =
    lead.etapa.tipo === 'ganho'
      ? 'bg-acao-suave text-acao'
      : lead.etapa.tipo === 'perdido'
        ? 'bg-perigo/15 text-perigo'
        : 'bg-info-suave text-info';

  return (
    <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${cor}`}>
      {lead.etapa.stage_nome}
    </span>
  );
}

function SeloArquivado() {
  return (
    <span className="ml-2 inline-block rounded-full bg-alerta-suave px-2 py-0.5 text-xs font-medium text-alerta">
      Arquivado
    </span>
  );
}
