import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { criarClienteServidor } from '@/lib/supabase/server';
import { AVISO, CARTAO } from '@/components/ui';
import { AcaoLead } from '@/components/crm/AcaoLead';
import { FormLead } from '@/components/crm/FormLead';
import { alternarArquivamentoAction, atualizarLeadAction } from '@/lib/crm/acoes';
import { carregarLead, listarMembros, organizacaoAtual } from '@/lib/crm/dados';

export const metadata: Metadata = { title: 'Editar lead · ByTech3' };

export default async function PaginaEditarLead({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const organizacao = await organizacaoAtual();
  const lead = await carregarLead(organizacao.organization_id, id);
  if (!lead) notFound();

  const membros = await listarMembros(organizacao.organization_id);
  const ehGestor = organizacao.papel === 'admin' || organizacao.papel === 'gestor';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <Link
          href={`/crm/${lead.id}`}
          className="text-sm text-neutral-600 hover:underline dark:text-neutral-400"
        >
          ← Voltar para a ficha
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Editar lead</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Cada alteração entra na linha do tempo do lead, com autor e horário.
        </p>
      </header>

      {!organizacao.acesso_ativo && (
        <p className={AVISO}>
          <span className="font-semibold">Acesso somente leitura.</span> O período de teste terminou
          e o banco vai recusar o salvamento até a licença ser reativada.
        </p>
      )}

      <div className={CARTAO}>
        <FormLead
          acao={atualizarLeadAction}
          membros={membros}
          usuarioId={user.id}
          podeDistribuir={ehGestor}
          lead={lead}
          rotuloEnvio="Salvar alterações"
          rotuloEnviando="Salvando…"
          urlCancelar={`/crm/${lead.id}`}
        />
      </div>

      <div className={CARTAO}>
        <h2 className="text-sm font-semibold">
          {lead.arquivado ? 'Restaurar lead' : 'Arquivar lead'}
        </h2>
        <p className="mt-1 mb-4 text-sm text-neutral-600 dark:text-neutral-400">
          {lead.arquivado
            ? 'O lead volta a aparecer na listagem e no funil.'
            : 'O lead sai da listagem do dia a dia, mas continua no banco com todo o histórico. Não existe exclusão: descarte aqui é sempre reversível.'}
        </p>
        <AcaoLead
          acao={alternarArquivamentoAction}
          campos={{ lead_id: lead.id, arquivar: lead.arquivado ? '0' : '1' }}
          rotulo={lead.arquivado ? 'Restaurar lead' : 'Arquivar lead'}
          rotuloEnviando={lead.arquivado ? 'Restaurando…' : 'Arquivando…'}
        />
      </div>
    </div>
  );
}
