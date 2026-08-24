import type { Metadata } from 'next';
import { AVISO } from '@/components/ui';
import { GerenciadorFunis } from '@/components/crm/GerenciadorFunis';
import { organizacaoAtual } from '@/lib/crm/dados';
import { listarFunisParaGestao } from '@/lib/crm/funis';

export const metadata: Metadata = { title: 'Funis · ByTech3' };

/**
 * Gestão dos funis da organização.
 *
 * Vendedor VÊ a estrutura (a policy de `pipelines` libera SELECT para todo
 * membro) mas não a edita: os controles não aparecem para ele. Isso é moldar a
 * interface pelo papel — a barreira real continua sendo a RLS, que recusa a
 * escrita mesmo que alguém chame a Server Action por fora.
 */
export default async function PaginaFunis() {
  const organizacao = await organizacaoAtual();
  const funis = await listarFunisParaGestao(organizacao.organization_id);

  const podeGerenciar = organizacao.papel === 'admin' || organizacao.papel === 'gestor';

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Funis</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Cada funil é um quadro com suas próprias etapas. O funil padrão é onde todo lead novo
          entra.
        </p>
      </header>

      {!organizacao.acesso_ativo && (
        <p className={AVISO}>
          <span className="font-semibold">Acesso somente leitura.</span> O período de teste terminou:
          o banco recusa alterações na estrutura dos funis até a licença ser reativada.
        </p>
      )}

      {!podeGerenciar && (
        <p className={AVISO}>
          A estrutura dos funis é definida por gestores e administradores. Você pode consultar,
          abrir os quadros e trabalhar os leads normalmente.
        </p>
      )}

      <GerenciadorFunis funis={funis} podeGerenciar={podeGerenciar} />
    </div>
  );
}
