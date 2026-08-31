import { Suspense } from 'react';
import type { Metadata } from 'next';
import { FormLogin } from './FormLogin';
import { CARTAO } from '@/components/ui';

export const metadata: Metadata = { title: 'Entrar · ByTech3' };

export default function PaginaLogin() {
  return (
    <div className={CARTAO}>
      <h1 className="text-xl font-semibold tracking-tight">Entrar</h1>
      <p className="mt-1 mb-6 text-sm text-texto-2">
        Acesse o painel da sua empresa.
      </p>

      {/* Suspense porque o formulário lê `?proximo=` da URL. */}
      <Suspense fallback={<p className="text-sm text-texto-3">Carregando…</p>}>
        <FormLogin />
      </Suspense>
    </div>
  );
}
