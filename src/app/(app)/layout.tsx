import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { criarClienteServidor } from '@/lib/supabase/server';
import { carregarContexto } from '@/lib/contexto';
import { BotaoSair } from '@/components/BotaoSair';
import { BarraLateral } from '@/components/BarraLateral';
import { SELO_ALERTA, SELO_NEUTRO } from '@/components/ui';

/**
 * Casca das páginas internas: navegação lateral + cabeçalho de contexto.
 *
 * A proteção que vale é a RLS. Aqui a verificação é de rota, e ela ficou
 * enxuta de propósito: o `proxy.ts` já validou o token contra o servidor de
 * auth nesta mesma requisição, então `getSession()` lê o cookie SEM ir à rede,
 * e quem autoriza de fato é `meu_contexto()`, que roda com o JWT do usuário.
 */
export default async function LayoutApp({ children }: { children: ReactNode }) {
  const supabase = await criarClienteServidor();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect('/login');
  }

  // Sem organização o usuário ainda não terminou o cadastro.
  const contexto = await carregarContexto();
  if (contexto.length === 0) {
    redirect('/onboarding');
  }

  const organizacao = contexto[0];
  const emTrial = organizacao.status === 'trial';

  return (
    <div className="min-h-full">
      <BarraLateral />

      {/* `md:pl-56` abre espaço para a barra lateral; `pb-20` no celular
          impede que a barra inferior cubra o fim da página. */}
      <div className="flex min-h-full flex-col pb-20 md:pb-0 md:pl-56">
        <header className="sticky top-0 z-20 border-b border-linha bg-fundo/85 backdrop-blur">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <p className="truncate text-sm font-semibold text-texto">
                {organizacao.organizacao_nome}
              </p>

              {!organizacao.acesso_ativo ? (
                <span className={SELO_ALERTA}>Somente leitura</span>
              ) : (
                emTrial &&
                organizacao.dias_restantes !== null && (
                  <span className={SELO_NEUTRO}>
                    Teste · {organizacao.dias_restantes}{' '}
                    {organizacao.dias_restantes === 1 ? 'dia' : 'dias'}
                  </span>
                )
              )}
            </div>

            <div className="flex items-center gap-3">
              <span className="hidden truncate text-sm text-texto-2 lg:inline">
                {session.user.email}
              </span>
              <BotaoSair />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
