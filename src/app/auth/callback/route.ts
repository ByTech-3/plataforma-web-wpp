/**
 * Retorno do link de confirmação de e-mail (e de futuros fluxos de e-mail,
 * como recuperação de senha).
 *
 * Este projeto Supabase exige confirmação de e-mail, então o cadastro NÃO
 * devolve sessão na hora: o usuário recebe um link, e é este handler que
 * transforma o link em sessão gravada nos cookies.
 *
 * Dois formatos são aceitos:
 *   ?code=...        fluxo PKCE (o normal com @supabase/ssr)
 *   ?token_hash=...  fluxo de OTP, usado por alguns modelos de e-mail
 *
 * Route Handler, e não página, porque aqui é permitido gravar cookies.
 */
import { NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { criarClienteServidor } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);

  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const tipo = searchParams.get('type') as EmailOtpType | null;

  // Só destinos internos: evita virar trampolim para site externo.
  const solicitado = searchParams.get('next');
  const destino = solicitado?.startsWith('/') ? solicitado : '/dashboard';

  const supabase = await criarClienteServidor();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(destino, origin));
    }
    return redirecionarComErro(origin, error.message);
  }

  if (tokenHash && tipo) {
    const { error } = await supabase.auth.verifyOtp({
      type: tipo,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(new URL(destino, origin));
    }
    return redirecionarComErro(origin, error.message);
  }

  return redirecionarComErro(origin, 'Link de confirmação inválido ou incompleto.');
}

function redirecionarComErro(origin: string, mensagem: string) {
  const url = new URL('/login', origin);
  url.searchParams.set('erro', mensagem);
  return NextResponse.redirect(url);
}
