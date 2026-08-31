import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ROTULO_PAPEL,
  ROTULO_STATUS,
  carregarContexto,
  type ContextoOrganizacao,
} from '@/lib/contexto';
import { AVISO, CARTAO } from '@/components/ui';

export const metadata: Metadata = { title: 'Painel · ByTech3' };

export default async function PaginaDashboard() {
  // O layout já garantiu que existe sessão e organização; `cache()` faz esta
  // chamada reaproveitar o resultado da mesma renderização.
  const [organizacao] = await carregarContexto();

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {organizacao.organizacao_nome}
        </h1>
        <p className="mt-1 text-sm text-texto-2">
          Você acessa como{' '}
          <span className="font-medium">{ROTULO_PAPEL[organizacao.papel]}</span>.
        </p>
      </header>

      {!organizacao.acesso_ativo && (
        <p className={AVISO}>
          <span className="font-semibold">Acesso somente leitura.</span> O período
          de teste desta organização terminou. Os dados continuam aqui, mas novos
          registros estão bloqueados — e o bloqueio é aplicado pelo banco, não
          apenas por esta tela.
        </p>
      )}

      <section className="grid gap-4 sm:grid-cols-3">
        <Cartao titulo="Organização" valor={organizacao.organizacao_nome}>
          {organizacao.organizacao_slug ?? '—'}
        </Cartao>

        <Cartao titulo="Seu papel" valor={ROTULO_PAPEL[organizacao.papel]}>
          {descricaoPapel(organizacao.papel)}
        </Cartao>

        <Cartao titulo="Plano" valor={rotuloStatus(organizacao)}>
          {descricaoTrial(organizacao)}
        </Cartao>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Atalho
          titulo="CRM"
          descricao="Carteira de leads: origem, responsável, valor e etapa, com histórico registrado a cada mudança."
          href="/crm"
          acao="Abrir o CRM"
        />
        <Atalho
          titulo="Kanban"
          descricao="O funil em colunas. Arraste o lead entre as etapas — cada movimento entra sozinho na linha do tempo."
          href="/kanban"
          acao="Abrir o Kanban"
        />
      </section>

      <section className={CARTAO}>
        <h2 className="text-sm font-semibold">Em breve</h2>
        <ul className="mt-3 space-y-2 text-sm text-texto-2">
          <li>
            <span className="font-medium text-texto">
              Tags e filtros
            </span>{' '}
            — etiquetar leads e filtrar por responsável, origem, tag e etapa.
          </li>
          <li>
            <span className="font-medium text-texto">Inbox</span> — as
            conversas recentes do WhatsApp com os dados do CRM ao lado.
          </li>
          <li>
            <span className="font-medium text-texto">
              Equipe
            </span>{' '}
            — convidar vendedores e definir permissões.
          </li>
        </ul>
      </section>
    </div>
  );
}

function Atalho({
  titulo,
  descricao,
  href,
  acao,
}: {
  titulo: string;
  descricao: string;
  href: string;
  acao: string;
}) {
  return (
    <div className={`flex flex-col ${CARTAO}`}>
      <h2 className="text-sm font-semibold">{titulo}</h2>
      <p className="mt-2 flex-1 text-sm text-texto-2">{descricao}</p>
      <Link
        href={href}
        className="mt-4 inline-block self-start rounded-padrao bg-acao px-4 py-2 text-sm font-semibold text-white transition hover:bg-acao-forte"
      >
        {acao}
      </Link>
    </div>
  );
}

function Cartao({
  titulo,
  valor,
  children,
}: {
  titulo: string;
  valor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-grande border border-linha p-5">
      <p className="text-xs font-medium uppercase tracking-widest text-texto-3">
        {titulo}
      </p>
      <p className="mt-2 truncate text-lg font-semibold">{valor}</p>
      <p className="mt-1 text-xs text-texto-3">{children}</p>
    </div>
  );
}

function rotuloStatus(organizacao: ContextoOrganizacao) {
  if (!organizacao.status) return 'Sem assinatura';
  return ROTULO_STATUS[organizacao.status];
}

function descricaoTrial(organizacao: ContextoOrganizacao) {
  if (organizacao.status !== 'trial') {
    return organizacao.acesso_ativo ? 'Acesso liberado' : 'Acesso restrito';
  }

  const dias = organizacao.dias_restantes;
  if (dias === null) return 'Sem data de término';
  if (dias <= 0) return 'Teste encerrado';
  return dias === 1 ? 'Último dia de teste' : `${dias} dias restantes`;
}

function descricaoPapel(papel: ContextoOrganizacao['papel']) {
  switch (papel) {
    case 'admin':
      return 'Gerencia usuários e assinatura';
    case 'gestor':
      return 'Vê todos os leads da empresa';
    case 'vendedor':
      return 'Vê a própria carteira';
  }
}
