import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { criarClienteServidor } from '@/lib/supabase/server';
import { carregarContexto } from '@/lib/contexto';
import { BotaoSair } from '@/components/BotaoSair';
import { NavPrincipal } from '@/components/NavPrincipal';

/**
 * Layout das páginas internas. É AQUI que a proteção de rota vale — o
 * redirecionamento do proxy.ts é só uma checagem otimista de cookie.
 *
 * `getUser()` valida o token contra o servidor de auth do Supabase. Não usar
 * `getSession()` para decidir acesso: ele confia no cookie sem verificar.
 *
 * Lembrando que nem isto é a última linha de defesa — a RLS é. Mesmo que este
 * layout tivesse um furo, o banco continuaria devolvendo apenas os dados da
 * organização do usuário.
 */
export default async function LayoutApp({ children }: { children: ReactNode }) {
  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Sem organização o usuário ainda não terminou o cadastro.
  const contexto = await carregarContexto();
  if (contexto.length === 0) {
    redirect('/onboarding');
  }

  const organizacao = contexto[0];

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-black/10 dark:border-white/15">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-widest text-neutral-500">
              ByTech3
            </p>
            <p className="truncate text-sm font-semibold">
              {organizacao.organizacao_nome}
            </p>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            <NavPrincipal />
            <span className="hidden truncate text-sm text-neutral-600 lg:inline dark:text-neutral-400">
              {user.email}
            </span>
            <BotaoSair />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">{children}</main>
    </div>
  );
}
