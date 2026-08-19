'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { criarClienteBrowser } from '@/lib/supabase/client';
import { BOTAO_PRIMARIO, CAMPO, ERRO, ROTULO } from '@/components/ui';

export function FormLogin() {
  const router = useRouter();
  const parametros = useSearchParams();
  const [enviando, setEnviando] = useState(false);
  // `?erro=` chega quando o link de confirmação de e-mail falha.
  const [erro, setErro] = useState<string | null>(parametros.get('erro'));

  async function aoEnviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);

    const dados = new FormData(evento.currentTarget);
    const supabase = criarClienteBrowser();

    const { error } = await supabase.auth.signInWithPassword({
      email: String(dados.get('email') ?? '').trim(),
      password: String(dados.get('senha') ?? ''),
    });

    if (error) {
      setErro(traduzirErro(error.message));
      setEnviando(false);
      return;
    }

    // Volta para onde o usuário tentou ir antes de ser barrado pelo proxy.
    // `startsWith('/')` evita open redirect para domínio externo.
    const proximo = parametros.get('proximo');
    const destino = proximo && proximo.startsWith('/') ? proximo : '/dashboard';

    router.replace(destino);
    // Sem isto os Server Components continuariam renderizados como deslogado.
    router.refresh();
  }

  return (
    <form onSubmit={aoEnviar} className="space-y-4">
      {erro && <p className={ERRO}>{erro}</p>}

      <div>
        <label className={ROTULO} htmlFor="email">
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className={CAMPO}
          disabled={enviando}
        />
      </div>

      <div>
        <label className={ROTULO} htmlFor="senha">
          Senha
        </label>
        <input
          id="senha"
          name="senha"
          type="password"
          required
          autoComplete="current-password"
          className={CAMPO}
          disabled={enviando}
        />
      </div>

      <button type="submit" className={BOTAO_PRIMARIO} disabled={enviando}>
        {enviando ? 'Entrando…' : 'Entrar'}
      </button>

      <p className="text-center text-sm text-neutral-600 dark:text-neutral-400">
        Ainda não tem conta?{' '}
        <Link
          href="/cadastro"
          className="font-medium text-emerald-700 hover:underline dark:text-emerald-400"
        >
          Criar conta
        </Link>
      </p>
    </form>
  );
}

function traduzirErro(mensagem: string) {
  if (/invalid login credentials/i.test(mensagem)) {
    return 'E-mail ou senha incorretos.';
  }
  if (/email not confirmed/i.test(mensagem)) {
    return 'Confirme seu e-mail antes de entrar.';
  }
  return mensagem;
}
