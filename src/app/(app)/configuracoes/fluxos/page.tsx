import type { Metadata } from 'next';
import Link from 'next/link';
import { AVISO, LINK, LINK_DISCRETO, TEXTO_2, TITULO_TELA } from '@/components/ui';
import { ListaDeFluxos } from '@/components/crm/ListaDeFluxos';
import { organizacaoAtual } from '@/lib/crm/dados';
import { listarFluxos, listarWebhooks } from '@/lib/crm/fluxos';

export const metadata: Metadata = { title: 'Fluxos · ByTech3' };

/**
 * Automações de atendimento.
 *
 * Os dois carregamentos vão juntos: a lista de webhooks alimenta o atalho do
 * modelo pronto e não depende dos fluxos.
 */
export default async function PaginaFluxos() {
  const organizacao = await organizacaoAtual();

  const [fluxos, webhooks] = await Promise.all([
    listarFluxos(organizacao.organization_id),
    listarWebhooks(organizacao.organization_id),
  ]);

  const podeGerenciar = organizacao.papel === 'admin' || organizacao.papel === 'gestor';

  return (
    <div className="space-y-6">
      <header>
        <Link href="/configuracoes" className={`text-sm ${LINK_DISCRETO}`}>
          ← Voltar para configurações
        </Link>
        <h1 className={`mt-2 ${TITULO_TELA}`}>Fluxos de atendimento</h1>
        <p className={`mt-1 ${TEXTO_2}`}>
          Quando isto acontecer, faça aquilo. Veja também as{' '}
          <Link href="/configuracoes/entregas" className={LINK}>
            entregas
          </Link>{' '}
          e os{' '}
          <Link href="/configuracoes/webhooks" className={LINK}>
            webhooks
          </Link>
          .
        </p>
      </header>

      {webhooks.length === 0 && podeGerenciar && (
        <p className={AVISO}>
          Nenhum webhook cadastrado ainda. As ações de mensagem precisam de um destino —{' '}
          <Link href="/configuracoes/webhooks" className={LINK}>
            cadastre o primeiro
          </Link>
          .
        </p>
      )}

      {!organizacao.acesso_ativo && (
        <p className={AVISO}>
          <span className="font-semibold">Acesso somente leitura.</span> O período de teste terminou:
          além de recusar alterações, o banco não dispara automação enquanto a licença estiver
          inativa.
        </p>
      )}

      {!podeGerenciar && (
        <p className={AVISO}>
          Os fluxos são montados por gestores e administradores. Você pode consultar o que roda em
          nome da equipe.
        </p>
      )}

      <ListaDeFluxos
        fluxos={fluxos}
        webhooks={webhooks.map((hook) => ({ id: hook.id, nome: hook.nome }))}
        podeGerenciar={podeGerenciar}
      />
    </div>
  );
}
