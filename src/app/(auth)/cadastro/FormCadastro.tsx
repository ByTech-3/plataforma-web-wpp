'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { criarClienteBrowser } from '@/lib/supabase/client';
import { garantirOrganizacao } from '@/lib/organizacao';
import { AVISO, BOTAO_PRIMARIO, CAMPO, ERRO, ROTULO } from '@/components/ui';

export function FormCadastro() {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmarEmail, setConfirmarEmail] = useState(false);

  async function aoEnviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErro(null);

    const dados = new FormData(evento.currentTarget);
    const nomeCompleto = String(dados.get('nome_completo') ?? '').trim();
    const nomeEmpresa = String(dados.get('nome_empresa') ?? '').trim();
    const email = String(dados.get('email') ?? '').trim();
    const senha = String(dados.get('senha') ?? '');

    if (nomeEmpresa.length < 2) {
      setErro('Informe o nome da empresa (mínimo 2 caracteres).');
      return;
    }
    if (senha.length < 8) {
      setErro('A senha precisa ter pelo menos 8 caracteres.');
      return;
    }

    setEnviando(true);
    const supabase = criarClienteBrowser();

    // O nome da empresa vai junto do cadastro. Se este projeto exigir
    // confirmação de e-mail, não existe sessão agora — e o /onboarding usa
    // esse mesmo dado para criar a organização no primeiro login.
    const { data, error } = await supabase.auth.signUp({
      email,
      password: senha,
      options: {
        data: { nome_completo: nomeCompleto, nome_empresa: nomeEmpresa },
        // Para onde o link do e-mail de confirmação deve voltar.
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setErro(traduzirErro(error.message));
      setEnviando(false);
      return;
    }

    // Sem sessão = o Supabase está exigindo confirmação por e-mail.
    if (!data.session) {
      setConfirmarEmail(true);
      setEnviando(false);
      return;
    }

    try {
      await garantirOrganizacao(supabase, nomeEmpresa);
    } catch (e) {
      setErro(
        `Conta criada, mas a organização falhou: ${
          e instanceof Error ? e.message : 'erro desconhecido'
        }. Faça login para concluir.`,
      );
      setEnviando(false);
      return;
    }

    router.replace('/dashboard');
    router.refresh();
  }

  if (confirmarEmail) {
    return (
      <div className="space-y-4">
        <p className={AVISO}>
          Conta criada. Enviamos um link de confirmação para o seu e-mail —
          abra-o <span className="font-semibold">neste mesmo navegador</span>.
          Ele traz você de volta já autenticado, e a organização com o período de
          teste é criada automaticamente.
        </p>
        <Link
          href="/login"
          className="block text-center text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400"
        >
          Ir para o login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={aoEnviar} className="space-y-4">
      {erro && <p className={ERRO}>{erro}</p>}

      <div>
        <label className={ROTULO} htmlFor="nome_empresa">
          Nome da empresa
        </label>
        <input
          id="nome_empresa"
          name="nome_empresa"
          type="text"
          required
          minLength={2}
          maxLength={120}
          autoComplete="organization"
          placeholder="Academia Corpo em Movimento"
          className={CAMPO}
          disabled={enviando}
        />
        <p className="mt-1.5 text-xs text-neutral-500">
          Cria sua organização com 14 dias de teste. Você entra como
          administrador.
        </p>
      </div>

      <div>
        <label className={ROTULO} htmlFor="nome_completo">
          Seu nome
        </label>
        <input
          id="nome_completo"
          name="nome_completo"
          type="text"
          required
          autoComplete="name"
          className={CAMPO}
          disabled={enviando}
        />
      </div>

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
          minLength={8}
          autoComplete="new-password"
          className={CAMPO}
          disabled={enviando}
        />
        <p className="mt-1.5 text-xs text-neutral-500">Mínimo de 8 caracteres.</p>
      </div>

      <button type="submit" className={BOTAO_PRIMARIO} disabled={enviando}>
        {enviando ? 'Criando conta…' : 'Criar conta e iniciar teste'}
      </button>

      <p className="text-center text-sm text-neutral-600 dark:text-neutral-400">
        Já tem conta?{' '}
        <Link
          href="/login"
          className="font-medium text-emerald-700 hover:underline dark:text-emerald-400"
        >
          Entrar
        </Link>
      </p>
    </form>
  );
}

function traduzirErro(mensagem: string) {
  if (/already registered|already been registered/i.test(mensagem)) {
    return 'Já existe uma conta com este e-mail.';
  }
  if (/password/i.test(mensagem) && /least/i.test(mensagem)) {
    return 'Senha muito curta para a política do projeto.';
  }
  return mensagem;
}
