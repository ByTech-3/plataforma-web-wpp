import type { Metadata } from 'next';
import { FormCadastro } from './FormCadastro';
import { CARTAO } from '@/components/ui';

export const metadata: Metadata = { title: 'Criar conta · ByTech3' };

export default function PaginaCadastro() {
  return (
    <div className={CARTAO}>
      <h1 className="text-xl font-semibold tracking-tight">Criar conta</h1>
      <p className="mt-1 mb-6 text-sm text-texto-2">
        Sua empresa começa com 14 dias de teste, sem cartão.
      </p>

      <FormCadastro />
    </div>
  );
}
