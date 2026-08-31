'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteBrowser } from '@/lib/supabase/client';
import { garantirOrganizacao } from '@/lib/organizacao';
import { BOTAO_PRIMARIO, CAMPO, ERRO, ROTULO } from '@/components/ui';

export function FormOnboarding({ nomeSugerido }: { nomeSugerido: string }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(Boolean(nomeSugerido));
  const tentouAutomatico = useRef(false);

  async function criar(nomeEmpresa: string) {
    setErro(null);
    setEnviando(true);
    try {
      await garantirOrganizacao(criarClienteBrowser(), nomeEmpresa);
      router.replace('/dashboard');
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível criar a organização.');
      setEnviando(false);
    }
  }

  // O usuário já informou o nome da empresa no cadastro: cria sozinho, sem
  // pedir a mesma coisa duas vezes. Se falhar, o formulário abaixo assume.
  useEffect(() => {
    if (!nomeSugerido || tentouAutomatico.current) return;
    tentouAutomatico.current = true;
    void criar(nomeSugerido);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nomeSugerido]);

  if (enviando && !erro) {
    return (
      <p className="text-sm text-texto-2">
        Criando sua organização e iniciando o período de teste…
      </p>
    );
  }

  return (
    <form
      onSubmit={(evento) => {
        evento.preventDefault();
        const dados = new FormData(evento.currentTarget);
        void criar(String(dados.get('nome_empresa') ?? '').trim());
      }}
      className="space-y-4"
    >
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
          defaultValue={nomeSugerido}
          autoComplete="organization"
          className={CAMPO}
          disabled={enviando}
        />
      </div>

      <button type="submit" className={BOTAO_PRIMARIO} disabled={enviando}>
        {enviando ? 'Criando…' : 'Criar organização e iniciar teste'}
      </button>
    </form>
  );
}
