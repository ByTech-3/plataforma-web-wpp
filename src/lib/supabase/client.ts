/**
 * Cliente Supabase para o BROWSER (componentes com "use client").
 *
 * Usa `createBrowserClient` do @supabase/ssr: a sessão é guardada em COOKIE,
 * não em localStorage. É isso que permite ao servidor (Server Components e
 * proxy.ts) enxergar quem está logado e aplicar a RLS com o JWT do usuário.
 *
 * O que este cliente consegue ler ou escrever é decidido pela RLS no banco.
 * Nenhuma regra de segurança da plataforma vive neste arquivo.
 */
import { createBrowserClient } from '@supabase/ssr';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './env';

export function criarClienteBrowser() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
