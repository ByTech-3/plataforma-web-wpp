import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { criarClienteServidor } from '@/lib/supabase/server';
import { AVISO, CARTAO } from '@/components/ui';
import { FormLead } from '@/components/crm/FormLead';
import { criarLeadAction } from '@/lib/crm/acoes';
import { carregarFunilPadrao, listarMembros, organizacaoAtual } from '@/lib/crm/dados';

export const metadata: Metadata = { title: 'Novo lead · ByTech3' };

export default async function PaginaNovoLead() {
  const supabase = await criarClienteServidor();

  // `getSession()` lê o cookie sem ir à rede. O `getUser()` que estava aqui
  // consultava o servidor de auth de novo, depois de o `proxy.ts` já ter feito
  // exatamente isso nesta requisição — um salto de rede pago duas vezes. O id
  // só preenche o campo "responsável"; a autorização é da RLS.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect('/login');

  const organizacao = await organizacaoAtual();
  const [membros, funil] = await Promise.all([
    listarMembros(organizacao.organization_id),
    carregarFunilPadrao(organizacao.organization_id),
  ]);

  const ehGestor = organizacao.papel === 'admin' || organizacao.papel === 'gestor';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <Link
          href="/crm"
          className="text-sm text-texto-2 hover:underline"
        >
          ← Voltar para os leads
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Novo lead</h1>
      </header>

      {!organizacao.acesso_ativo && (
        <p className={AVISO}>
          <span className="font-semibold">Atenção:</span> o período de teste desta organização
          terminou. O formulário continua aqui, mas o banco vai recusar a gravação enquanto a
          licença não estiver ativa.
        </p>
      )}

      {!funil && (
        <p className={AVISO}>
          Nenhum funil com etapas foi encontrado nesta organização. O lead será criado mesmo assim,
          mas ficará fora do funil até um gestor criar as etapas.
        </p>
      )}

      <div className={CARTAO}>
        <FormLead
          acao={criarLeadAction}
          membros={membros}
          usuarioId={session.user.id}
          podeDistribuir={ehGestor}
          rotuloEnvio="Cadastrar lead"
          rotuloEnviando="Cadastrando…"
          urlCancelar="/crm"
          avisoFunil={
            funil
              ? `Ao ser criado, o lead entra no funil "${funil.pipeline_nome}", na etapa "${funil.primeira_etapa_nome}".`
              : null
          }
        />
      </div>
    </div>
  );
}
