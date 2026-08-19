/**
 * proxy.ts — no Next.js 16 este arquivo substitui o antigo `middleware.ts`
 * (mesma funcionalidade, nome novo). Roda antes de cada requisição.
 *
 * Aqui a sessão do Supabase é renovada e o visitante sem sessão é mandado
 * para o login. A proteção que realmente conta está no layout de `(app)` e,
 * acima de tudo, na RLS do banco.
 */
import type { NextRequest } from 'next/server';
import { atualizarSessao } from '@/lib/supabase/proxy-session';

export async function proxy(request: NextRequest) {
  return atualizarSessao(request);
}

export const config = {
  matcher: [
    /*
     * Todas as rotas, exceto:
     *   _next/static, _next/image  -> assets do build
     *   favicon / imagens          -> arquivos estáticos
     * Assim o proxy não gasta uma validação de token por ícone servido.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
