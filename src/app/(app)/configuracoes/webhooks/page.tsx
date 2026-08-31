import type { Metadata } from 'next';
import Link from 'next/link';
import { AVISO, LINK_DISCRETO, TEXTO_2, TITULO_TELA } from '@/components/ui';
import {
  ExplicacaoWebhooks,
  GerenciadorWebhooks,
} from '@/components/crm/GerenciadorWebhooks';
import { organizacaoAtual } from '@/lib/crm/dados';
import { listarWebhooks } from '@/lib/crm/fluxos';

export const metadata: Metadata = { title: 'Webhooks · ByTech3' };

/**
 * Destinos das chamadas automáticas.
 *
 * Vendedor VÊ (a policy libera SELECT para todo membro — quem trabalha os
 * leads merece saber o que dispara em nome dele) mas não edita. A barreira é
 * a RLS; `podeGerenciar` só esconde botão que não funcionaria.
 */
export default async function PaginaWebhooks() {
  const organizacao = await organizacaoAtual();
  const webhooks = await listarWebhooks(organizacao.organization_id);

  const podeGerenciar = organizacao.papel === 'admin' || organizacao.papel === 'gestor';

  return (
    <div className="space-y-6">
      <header>
        <Link href="/configuracoes" className={`text-sm ${LINK_DISCRETO}`}>
          ← Voltar para configurações
        </Link>
        <h1 className={`mt-2 ${TITULO_TELA}`}>Webhooks</h1>
        <p className={`mt-1 ${TEXTO_2}`}>
          Para onde a automação manda o que precisa sair: o seu fluxo no n8n, ou a API oficial do
          WhatsApp.
        </p>
      </header>

      <ExplicacaoWebhooks />

      {!organizacao.acesso_ativo && (
        <p className={AVISO}>
          <span className="font-semibold">Acesso somente leitura.</span> O período de teste terminou:
          o banco recusa alterações e a automação não dispara enquanto a licença não for reativada.
        </p>
      )}

      {!podeGerenciar && (
        <p className={AVISO}>
          Webhooks são configurados por gestores e administradores. Você pode consultar.
        </p>
      )}

      <GerenciadorWebhooks webhooks={webhooks} podeGerenciar={podeGerenciar} />
    </div>
  );
}
