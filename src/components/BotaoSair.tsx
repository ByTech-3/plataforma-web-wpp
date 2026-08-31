'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteBrowser } from '@/lib/supabase/client';
import { BOTAO_MENOR } from '@/components/ui';

export function BotaoSair() {
  const router = useRouter();
  const [saindo, setSaindo] = useState(false);

  async function sair() {
    setSaindo(true);
    const supabase = criarClienteBrowser();
    await supabase.auth.signOut();

    router.replace('/login');
    // Limpa o cache de Server Components renderizados com a sessão antiga.
    router.refresh();
  }

  return (
    <button type="button" onClick={sair} disabled={saindo} className={BOTAO_MENOR}>
      {saindo ? 'Saindo…' : 'Sair'}
    </button>
  );
}
