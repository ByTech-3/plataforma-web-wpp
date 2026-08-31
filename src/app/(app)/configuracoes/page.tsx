import type { Metadata } from 'next';
import Link from 'next/link';
import { AVISO, CARTAO } from '@/components/ui';
import { ROTULO_PAPEL, ROTULO_STATUS } from '@/lib/contexto';
import { organizacaoAtual } from '@/lib/crm/dados';

export const metadata: Metadata = { title: 'Configurações · ByTech3' };

/**
 * Ponto único de configuração.
 *
 * Antes, funis ficavam num item de menu e etiquetas não existiam em lugar
 * nenhum. Quem configura o CRM procura tudo no mesmo lugar.
 */
export default async function PaginaConfiguracoes() {
  const organizacao = await organizacaoAtual();
  const ehGestor = organizacao.papel === 'admin' || organizacao.papel === 'gestor';

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="mt-1 text-sm text-texto-2">
          Estrutura do CRM, etiquetas e dados da organização.
        </p>
      </header>

      {!organizacao.acesso_ativo && (
        <p className={AVISO}>
          <span className="font-semibold">Acesso somente leitura.</span> O período de teste terminou:
          o banco recusa alterações de configuração até a licença ser reativada.
        </p>
      )}

      <section className="grid gap-4 sm:grid-cols-2">
        <Atalho
          titulo="Funis e etapas"
          descricao="Crie funis, defina as etapas de cada um, a ordem, o tipo e a cor. Escolha qual é o funil padrão."
          href="/funis"
          acao="Gerenciar funis"
          restrito={!ehGestor}
        />
        <Atalho
          titulo="Etiquetas"
          descricao="As etiquetas que aparecem nos leads e nos filtros. Criar é de qualquer um; renomear e excluir, de gestores."
          href="/configuracoes/tags"
          acao="Gerenciar etiquetas"
        />
        <Atalho
          titulo="Fluxos de atendimento"
          descricao="Quando isto acontecer, faça aquilo: responder o lead novo, etiquetar, mover no funil. As mensagens saem pelo n8n ou pela API oficial — nunca pela extensão."
          href="/configuracoes/fluxos"
          acao="Montar fluxos"
          restrito={!ehGestor}
        />
        <Atalho
          titulo="Webhooks e entregas"
          descricao="Os destinos das chamadas automáticas e o registro do que foi entregue, do que falhou e por quê."
          href="/configuracoes/webhooks"
          acao="Ver webhooks"
          restrito={!ehGestor}
        />
      </section>

      <section className={CARTAO}>
        <h2 className="text-sm font-semibold">Organização</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <Dado rotulo="Nome">{organizacao.organizacao_nome}</Dado>
          <Dado rotulo="Seu papel">{ROTULO_PAPEL[organizacao.papel]}</Dado>
          <Dado rotulo="Plano">
            {organizacao.status ? ROTULO_STATUS[organizacao.status] : 'Sem assinatura'}
            {organizacao.status === 'trial' && organizacao.dias_restantes !== null && (
              <span className="text-texto-3">
                {' '}
                · {organizacao.dias_restantes} dia(s)
              </span>
            )}
          </Dado>
        </dl>
        <p className="mt-4 text-xs text-texto-3">
          Convidar vendedores e definir permissões entra numa fase própria. Hoje os membros são
          adicionados direto no banco.
        </p>
      </section>
    </div>
  );
}

function Atalho({
  titulo,
  descricao,
  href,
  acao,
  restrito = false,
}: {
  titulo: string;
  descricao: string;
  href: string;
  acao: string;
  restrito?: boolean;
}) {
  return (
    <div className={`flex flex-col ${CARTAO}`}>
      <h2 className="text-sm font-semibold">{titulo}</h2>
      <p className="mt-2 flex-1 text-sm text-texto-2">{descricao}</p>
      {restrito && (
        <p className="mt-2 text-xs text-texto-3">Você pode consultar, mas não editar.</p>
      )}
      <Link
        href={href}
        className="mt-4 inline-block self-start rounded-padrao border border-linha-forte px-4 py-2 text-sm font-medium transition hover:bg-superficie-2"
      >
        {acao}
      </Link>
    </div>
  );
}

function Dado({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-widest text-texto-3">{rotulo}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}
