/**
 * Renovação de sessão + checagem otimista de rota, executada no proxy.ts.
 *
 * Duas responsabilidades:
 *
 *  1. RENOVAR O TOKEN. O access token do Supabase é curto. Sem alguém
 *     renovando e regravando o cookie a cada requisição, o usuário é
 *     deslogado sozinho no meio do uso. É esta função que faz isso.
 *
 *  2. CHECAGEM OTIMISTA. Se não há sessão no cookie, manda para o /login antes
 *     de renderizar qualquer coisa. É UX, não segurança — o proxy roda em toda
 *     rota (inclusive prefetch), então aqui NÃO se consulta banco.
 *     A verificação que vale é a do layout protegido + a RLS no Supabase.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './env';

/** Rotas que um visitante sem sessão pode abrir. */
const ROTAS_PUBLICAS = ['/login', '/cadastro', '/auth'];

function ehRotaPublica(pathname: string) {
  return ROTAS_PUBLICAS.some(
    (rota) => pathname === rota || pathname.startsWith(`${rota}/`),
  );
}

export async function atualizarSessao(request: NextRequest) {
  let resposta = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesParaGravar) {
        cookiesParaGravar.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        resposta = NextResponse.next({ request });
        cookiesParaGravar.forEach(({ name, value, options }) => {
          resposta.cookies.set(name, value, options);
        });
      },
    },
  });

  // getUser() valida o token com o servidor de auth e dispara a renovação.
  // Não trocar por getSession() aqui: getSession() lê o cookie sem validar.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Sem sessão em rota interna -> login (guardando o destino pretendido).
  if (!user && !ehRotaPublica(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('proximo', pathname);
    return NextResponse.redirect(url);
  }

  // Já logado tentando abrir login/cadastro -> dashboard.
  if (user && (pathname === '/login' || pathname === '/cadastro')) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // IMPORTANTE: devolver este objeto de resposta como está. Ele carrega os
  // cookies renovados; criar outra resposta aqui perderia a sessão nova.
  return resposta;
}
