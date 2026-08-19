import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { criarClienteServidor } from '@/lib/supabase/server';
import { carregarContexto } from '@/lib/contexto';
import { FormOnboarding } from './FormOnboarding';
import { CARTAO } from '@/components/ui';

export const metadata: Metadata = { title: 'Criar organização · ByTech3' };

/**
 * Rede de segurança do cadastro.
 *
 * Se o projeto Supabase exigir confirmação de e-mail, no momento do signup
 * ainda não existe sessão — e sem sessão `criar_organizacao()` não roda
 * (ela depende de auth.uid()). Então a organização nasce aqui, no primeiro
 * login, usando o nome da empresa guardado nos metadados do usuário.
 *
 * Fica fora do grupo (app) de propósito: aquele layout redireciona para cá
 * quando não há organização, e isso viraria um laço infinito.
 */
export default async function PaginaOnboarding() {
  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Já tem organização? Então não há onboarding a fazer.
  const contexto = await carregarContexto();
  if (contexto.length > 0) {
    redirect('/dashboard');
  }

  const nomeSugerido =
    typeof user.user_metadata?.nome_empresa === 'string'
      ? user.user_metadata.nome_empresa
      : '';

  return (
    <div className="flex min-h-full items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <p className="text-center text-xs font-medium uppercase tracking-widest text-neutral-500">
          ByTech3
        </p>

        <div className={`mt-8 ${CARTAO}`}>
          <h1 className="text-xl font-semibold tracking-tight">
            Vamos criar sua organização
          </h1>
          <p className="mt-1 mb-6 text-sm text-neutral-600 dark:text-neutral-400">
            É o último passo do cadastro. O período de teste começa agora.
          </p>

          <FormOnboarding nomeSugerido={nomeSugerido} />
        </div>
      </div>
    </div>
  );
}
