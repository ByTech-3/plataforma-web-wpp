'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteBrowser } from '@/lib/supabase/client';

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
    <button
      type="button"
      onClick={sair}
      disabled={saindo}
      className="rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium transition hover:bg-black/5 disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10"
    >
      {saindo ? 'Saindo…' : 'Sair'}
    </button>
  );
}
