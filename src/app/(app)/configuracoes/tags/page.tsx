import type { Metadata } from 'next';
import Link from 'next/link';
import { AVISO } from '@/components/ui';
import { GerenciadorTags } from '@/components/crm/GerenciadorTags';
import { organizacaoAtual } from '@/lib/crm/dados';
import { listarTagsParaGestao } from '@/lib/crm/tags';

export const metadata: Metadata = { title: 'Etiquetas · ByTech3' };

export default async function PaginaTags() {
  const organizacao = await organizacaoAtual();
  const tags = await listarTagsParaGestao(organizacao.organization_id);

  const ehGestor = organizacao.papel === 'admin' || organizacao.papel === 'gestor';

  return (
    <div className="space-y-6">
      <header>
        <Link
          href="/configuracoes"
          className="text-sm text-neutral-600 hover:underline dark:text-neutral-400"
        >
          ← Voltar para configurações
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Etiquetas</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Servem para marcar leads e filtrar a listagem e o quadro.
        </p>
      </header>

      {!organizacao.acesso_ativo && (
        <p className={AVISO}>
          <span className="font-semibold">Acesso somente leitura.</span> O período de teste terminou
          e o banco recusa alterações.
        </p>
      )}

      {!ehGestor && (
        <p className={AVISO}>
          Você pode criar etiquetas novas. Renomear e excluir é de gestores e administradores,
          porque afeta os leads de toda a equipe.
        </p>
      )}

      <GerenciadorTags tags={tags} podeGerenciar={ehGestor} />
    </div>
  );
}
