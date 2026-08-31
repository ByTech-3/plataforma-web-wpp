import type { Metadata } from 'next';
import Link from 'next/link';
import { LINK_DISCRETO, TEXTO_2, TITULO_TELA } from '@/components/ui';
import { RegistroDeEntregas } from '@/components/crm/RegistroDeEntregas';
import { organizacaoAtual } from '@/lib/crm/dados';
import { listarEntregas } from '@/lib/crm/fluxos';

export const metadata: Metadata = { title: 'Entregas · ByTech3' };

/**
 * O registro das chamadas de webhook.
 *
 * A policy de SELECT segue a carteira: o gestor vê tudo, o vendedor vê as
 * entregas dos leads que ele já enxerga. Esta página só desenha o que voltou.
 */
export default async function PaginaEntregas() {
  const organizacao = await organizacaoAtual();
  const entregas = await listarEntregas(organizacao.organization_id);

  const podeGerenciar = organizacao.papel === 'admin' || organizacao.papel === 'gestor';

  return (
    <div className="space-y-6">
      <header>
        <Link href="/configuracoes" className={`text-sm ${LINK_DISCRETO}`}>
          ← Voltar para configurações
        </Link>
        <h1 className={`mt-2 ${TITULO_TELA}`}>Entregas</h1>
        <p className={`mt-1 ${TEXTO_2}`}>
          Cada chamada que a automação fez, com o que o destino respondeu.
        </p>
      </header>

      <RegistroDeEntregas entregas={entregas} podeGerenciar={podeGerenciar} />
    </div>
  );
}
