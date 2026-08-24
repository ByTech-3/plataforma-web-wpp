import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AVISO } from '@/components/ui';
import { GerenciadorEtapas } from '@/components/crm/GerenciadorEtapas';
import { organizacaoAtual } from '@/lib/crm/dados';
import { carregarFunilParaGestao } from '@/lib/crm/funis';

export const metadata: Metadata = { title: 'Etapas do funil · ByTech3' };

export default async function PaginaEtapasDoFunil({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const organizacao = await organizacaoAtual();
  const dados = await carregarFunilParaGestao(organizacao.organization_id, id);
  if (!dados) notFound();

  const podeGerenciar = organizacao.papel === 'admin' || organizacao.papel === 'gestor';

  return (
    <div className="space-y-6">
      <header>
        <Link href="/funis" className="text-sm text-neutral-600 hover:underline dark:text-neutral-400">
          ← Voltar para os funis
        </Link>

        <h1 className="mt-2 flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
          {dados.funil.nome}
          {dados.funil.padrao && (
            <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              Padrão
            </span>
          )}
          {dados.funil.arquivado && (
            <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
              Arquivado
            </span>
          )}
        </h1>

        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          {dados.funil.total_leads} {dados.funil.total_leads === 1 ? 'lead' : 'leads'} neste funil ·{' '}
          <Link
            href={`/kanban?funil=${dados.funil.id}`}
            className="font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            abrir o quadro
          </Link>
        </p>
      </header>

      {!organizacao.acesso_ativo && (
        <p className={AVISO}>
          <span className="font-semibold">Acesso somente leitura.</span> O período de teste terminou
          e o banco recusa alterações nas etapas.
        </p>
      )}

      {!podeGerenciar && (
        <p className={AVISO}>
          As etapas são definidas por gestores e administradores. Você pode consultar a estrutura.
        </p>
      )}

      <GerenciadorEtapas
        funil={dados.funil}
        etapas={dados.etapas}
        podeGerenciar={podeGerenciar}
      />
    </div>
  );
}
