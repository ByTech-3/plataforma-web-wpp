/**
 * Cliente Supabase para o SERVIDOR (Server Components, Server Actions,
 * Route Handlers).
 *
 * Lê a sessão dos cookies da requisição e envia o JWT do usuário ao Supabase.
 * Consequência importante: toda query feita por aqui passa pela RLS COM A
 * IDENTIDADE DO USUÁRIO. O servidor não tem superpoderes — ele enxerga
 * exatamente a mesma fatia de dados que o usuário enxergaria.
 *
 * Um cliente novo por render. Nunca reaproveitar entre requisições, senão a
 * sessão de um usuário vazaria para outro.
 */
import { cache } from 'react';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './env';

/**
 * `cache()` memoriza dentro de UMA renderização.
 *
 * Uma tela do CRM chama isto oito, dez vezes — cada camada de dados pedia o
 * seu cliente, e cada pedido relia os cookies e montava um cliente novo. Agora
 * é um por requisição.
 *
 * Continua sendo um cliente NOVO a cada requisição, que é o que importa para a
 * segurança: reaproveitar entre requisições vazaria a sessão de um usuário
 * para outro.
 */
export const criarClienteServidor = cache(async function criarClienteServidor() {
  // No Next 16 `cookies()` é assíncrono.
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesParaGravar) {
        try {
          cookiesParaGravar.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components não podem gravar cookies. Silenciar aqui é
          // seguro PORQUE o proxy.ts renova a sessão a cada requisição e
          // grava os cookies atualizados na resposta.
        }
      },
    },
  });
});
